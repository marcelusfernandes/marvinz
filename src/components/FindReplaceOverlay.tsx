import { useEffect, useRef, useState } from 'react'
import type { EditorView } from 'prosemirror-view'
import {
  SearchQuery,
  findNext,
  findPrev,
  getMatchHighlights,
  getSearchState,
  replaceAll,
  replaceNext,
  setSearchState,
} from 'prosemirror-search'
import { FindBarShell } from './FindBarShell'
import { justReplacedPluginKey } from '../lib/pmJustReplacedHighlight'

/** Ensures the post-navigation selection is anchored in view with 80px
 * of breathing room below the floating find bar.
 *
 * Why not `view.state.tr.scrollIntoView()`?
 *   PM treats the flag as a hint; with a NO-OP transaction (no doc / no
 *   selection change) the view layer can elide the work. Even when it
 *   doesn't, the scroll lands flush against the editor's scroll DOM —
 *   which is *not* the .md-preview overflow container in our layout, so
 *   the call effectively does nothing for the user.
 *
 * Strategy: walk up from `view.dom` to the real scrolling ancestor
 * (.md-preview / .editor-pane), measure where the selection starts via
 * `coordsAtPos`, and scrollTo with an 80px offset that mirrors the
 * `scroll-padding-top` we use elsewhere. `requestAnimationFrame` waits
 * for the PM dispatch + DOM update to land before measuring. */
function scrollPosIntoView(view: EditorView, pos: number): void {
  requestAnimationFrame(() => {
    let coords
    try {
      coords = view.coordsAtPos(pos)
    } catch {
      return
    }
    if (!coords) return
    const scrollContainer =
      (view.dom.closest('.md-preview') as HTMLElement | null) ??
      (view.dom.closest('.editor-pane') as HTMLElement | null) ??
      (document.scrollingElement as HTMLElement | null)
    if (!scrollContainer) return
    const containerRect = scrollContainer.getBoundingClientRect()
    const offsetFromTop = coords.top - containerRect.top
    const targetScrollTop = scrollContainer.scrollTop + offsetFromTop - 80
    scrollContainer.scrollTo({ top: targetScrollTop, behavior: 'smooth' })
  })
}

function scrollSelectionIntoView(view: EditorView): void {
  scrollPosIntoView(view, view.state.selection.from)
}

/** Computes total matches and the 1-based index of the current selection
 * (if the selection covers one of the highlighted matches). Returns
 * `{ total: 0, current: null }` for empty queries or no matches. */
function computePmMatchCount(view: EditorView): { total: number; current: number | null } {
  const highlights = getMatchHighlights(view.state)
  const decorations = highlights.find()
  if (decorations.length === 0) return { total: 0, current: null }
  const sel = view.state.selection
  let current: number | null = null
  for (let i = 0; i < decorations.length; i++) {
    const d = decorations[i]
    if (d.from === sel.from && d.to === sel.to) {
      current = i + 1
      break
    }
  }
  return { total: decorations.length, current }
}

type Props = {
  /** ProseMirror view to dispatch search transactions on. */
  view: EditorView
  /** Closes the panel and clears the active search query. */
  onClose: () => void
  /**
   * When true (e.g. Cmd+Alt+F), the Replace row starts expanded regardless
   * of the persisted preference. The user's manual toggle still wins and
   * is written back to localStorage.
   */
  initialReplaceExpanded?: boolean
  /** Called after a successful Replace / Replace All so the host can show
   * a toast. `count` is 1 for a single Replace, total for Replace All. */
  onReplaced?: (count: number) => void
}

/**
 * Floating Find / Find-and-Replace bar for the Milkdown (ProseMirror)
 * surface. Replace row is collapsed by default; click the leading chevron
 * to expand. Enter/Shift+Enter navigate matches, Esc dismisses.
 */
export function FindReplaceOverlay({ view, onClose, initialReplaceExpanded, onReplaced }: Props) {
  const [query, setQuery] = useState('')
  const [replace, setReplace] = useState('')
  // Bumped after every navigation command so the match-count readout
  // recomputes once the new selection has been applied.
  const [navTick, setNavTick] = useState(0)
  const [matchInfo, setMatchInfo] = useState<{ total: number; current: number | null }>({
    total: 0,
    current: null,
  })

  // Push query/replace changes into the plugin state so highlights track
  // typing. The auto-navigation to the first match only fires when the
  // QUERY changes — editing the Replace text must not move the selection
  // or scroll the document.
  const prevQueryRef = useRef(query)
  useEffect(() => {
    const tr = setSearchState(view.state.tr, new SearchQuery({ search: query, replace }))
    view.dispatch(tr)
    if (query && query !== prevQueryRef.current) {
      const moved = findNext(view.state, view.dispatch, view)
      if (moved) scrollSelectionIntoView(view)
    }
    prevQueryRef.current = query
  }, [query, replace, view])

  // Recompute match count after query/replace or navigation. Debounced so
  // large documents don't recount on every keystroke. The PM `setSearchState`
  // dispatch above lands synchronously, but the highlights decoration set
  // is rebuilt on the next state apply — a short delay smooths that out.
  // Empty queries fall through the same timeout so the lint rule against
  // synchronous setState-in-effect stays happy.
  useEffect(() => {
    const delay = query ? 150 : 0
    const t = window.setTimeout(() => {
      setMatchInfo(query ? computePmMatchCount(view) : { total: 0, current: null })
    }, delay)
    return () => window.clearTimeout(t)
  }, [query, replace, navTick, view])

  // Clear the search state + any lingering replace-flash decorations when
  // the panel unmounts so the surface returns to a clean slate.
  useEffect(() => {
    return () => {
      const current = getSearchState(view.state)
      let tr = view.state.tr
      if (current) tr = setSearchState(tr, new SearchQuery({ search: '' }))
      tr = tr.setMeta(justReplacedPluginKey, { type: 'clear' })
      view.dispatch(tr)
    }
  }, [view])

  const runFindNext = () => {
    findNext(view.state, view.dispatch, view)
    scrollSelectionIntoView(view)
    setNavTick((n) => n + 1)
  }
  const runFindPrev = () => {
    findPrev(view.state, view.dispatch, view)
    scrollSelectionIntoView(view)
    setNavTick((n) => n + 1)
  }
  const runReplaceNext = () => {
    // Same logic as the CodeMirror side: snapshot the active match BEFORE
    // `replaceNext` rewrites + auto-advances. We need the snapshot positions
    // so we can flash the just-written range and anchor the viewport on it,
    // instead of scrolling away to the auto-advanced next match where the
    // flash would never be seen.
    const before = view.state.selection
    const replaceLen = replace.length
    const ok = replaceNext(view.state, view.dispatch, view)
    if (ok) {
      const flashFrom = before.from
      const flashTo = before.from + replaceLen
      view.dispatch(
        view.state.tr.setMeta(justReplacedPluginKey, {
          type: 'add',
          ranges: [{ from: flashFrom, to: flashTo }],
        })
      )
      scrollPosIntoView(view, flashFrom)
      onReplaced?.(1)
    }
    setNavTick((n) => n + 1)
  }
  const runReplaceAll = () => {
    // Capture every match's range from the active highlight decoration set
    // BEFORE replaceAll runs (positions are stable in the old doc). Then
    // project them into the post-replace coordinate system by accumulating
    // a `delta` per match (replaceLen - matchLen). Dispatch all flashes in
    // one transaction.
    const highlightDecos = getMatchHighlights(view.state).find()
    const matches = highlightDecos.map((d) => ({ from: d.from, to: d.to }))
    const total = matches.length
    replaceAll(view.state, view.dispatch, view)
    if (total > 0) {
      const replaceLen = replace.length
      let delta = 0
      const flashes = matches.map((m) => {
        const matchLen = m.to - m.from
        const newFrom = m.from + delta
        const newTo = newFrom + replaceLen
        delta += replaceLen - matchLen
        return { from: newFrom, to: newTo }
      })
      view.dispatch(view.state.tr.setMeta(justReplacedPluginKey, { type: 'add', ranges: flashes }))
      if (flashes[0]) scrollPosIntoView(view, flashes[0].from)
      onReplaced?.(total)
    }
    setNavTick((n) => n + 1)
  }

  return (
    <FindBarShell
      testIdPrefix="pm"
      query={query}
      onQueryChange={setQuery}
      replace={replace}
      onReplaceChange={setReplace}
      matchInfo={matchInfo}
      onFindNext={runFindNext}
      onFindPrev={runFindPrev}
      onReplaceNext={runReplaceNext}
      onReplaceAll={runReplaceAll}
      onClose={onClose}
      focusEditor={() => view.focus()}
      initialReplaceExpanded={initialReplaceExpanded}
    />
  )
}
