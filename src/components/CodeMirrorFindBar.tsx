import { useEffect, useRef, useState } from 'react'
import type { EditorView } from '@codemirror/view'
import {
  SearchCursor,
  SearchQuery,
  findNext,
  findPrevious,
  replaceAll,
  replaceNext,
  setSearchQuery,
} from '@codemirror/search'
import { FindBarShell } from './FindBarShell'
import { clearReplacedFlashes, flashReplaced } from '../lib/cmJustReplacedHighlight'

/** Anchors the current main selection in view with 80px of breathing room
 * below the floating find bar.
 *
 * Why not `EditorView.scrollIntoView({ y: 'center' })`?
 *   CM's built-in effect scrolls inside `view.scrollDOM`, which can differ
 *   from the actual app-level overflow ancestor depending on the host
 *   layout. We mirror the PM bar's approach (manual scrollTo on the real
 *   overflow container) so both surfaces behave identically — and so the
 *   80px offset always matches the `scroll-padding-top` we declared on
 *   the same containers. `requestAnimationFrame` waits for the CM
 *   dispatch + DOM update before measuring. */
function scrollPosIntoView(view: EditorView, pos: number): void {
  requestAnimationFrame(() => {
    let coords
    try {
      coords = view.coordsAtPos(pos)
    } catch {
      return
    }
    if (!coords) return
    const scrollContainer = view.scrollDOM as HTMLElement
    if (!scrollContainer) return
    const containerRect = scrollContainer.getBoundingClientRect()
    const offsetFromTop = coords.top - containerRect.top
    const targetScrollTop = scrollContainer.scrollTop + offsetFromTop - 80
    scrollContainer.scrollTo({ top: targetScrollTop, behavior: 'smooth' })
  })
}

function scrollSelectionIntoView(view: EditorView): void {
  scrollPosIntoView(view, view.state.selection.main.from)
}

/** Walks all matches of `query` in the editor's document and returns the
 * total plus the 1-based index of the current main selection (if it
 * exactly covers one of those matches). Empty query short-circuits to
 * `{ total: 0, current: null }`. */
function computeCmMatchCount(
  view: EditorView,
  query: string
): { total: number; current: number | null } {
  if (!query) return { total: 0, current: null }
  const cursor = new SearchCursor(view.state.doc, query)
  const sel = view.state.selection.main
  let total = 0
  let current: number | null = null
  while (!cursor.next().done) {
    total += 1
    if (current === null && cursor.value.from === sel.from && cursor.value.to === sel.to) {
      current = total
    }
  }
  return { total, current }
}

type Props = {
  /** CodeMirror EditorView to dispatch search commands against. */
  view: EditorView
  /** Closes the bar and clears the active search query. */
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
 * Floating Find / Replace bar for the CodeMirror raw-source editor.
 * Drives `@codemirror/search` commands directly; the default top panel is
 * not opened. Replace row is collapsed by default; click the leading
 * chevron to expand.
 */
export function CodeMirrorFindBar({ view, onClose, initialReplaceExpanded, onReplaced }: Props) {
  const [query, setQuery] = useState('')
  const [replace, setReplace] = useState('')
  // Bumped after every navigation command so the match-count readout
  // recomputes once the new selection has been applied.
  const [navTick, setNavTick] = useState(0)
  const [matchInfo, setMatchInfo] = useState<{ total: number; current: number | null }>({
    total: 0,
    current: null,
  })

  // Push the typed query/replace into the @codemirror/search state. The
  // auto-navigation to the first match only fires when the QUERY changes —
  // editing the Replace text must not move the selection or scroll.
  const prevQueryRef = useRef(query)
  useEffect(() => {
    view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: query, replace })) })
    if (query && query !== prevQueryRef.current) {
      const moved = findNext(view)
      if (moved) scrollSelectionIntoView(view)
    }
    prevQueryRef.current = query
  }, [query, replace, view])

  // Clear the search query when the bar closes so highlights disappear, and
  // drop any lingering "just replaced" flash decorations so the StateField
  // doesn't grow across long sessions.
  useEffect(() => {
    return () => {
      view.dispatch({
        effects: [
          setSearchQuery.of(new SearchQuery({ search: '' })),
          clearReplacedFlashes.of(null),
        ],
      })
    }
  }, [view])

  // Recompute total + current match index when query or navigation changes.
  // Debounced 150ms so SearchCursor walks (linear in doc size) don't run
  // on every keystroke in large files. Empty-query branch shares the same
  // timeout to keep setState out of the effect body (lint rule).
  useEffect(() => {
    const delay = query ? 150 : 0
    const t = window.setTimeout(() => {
      setMatchInfo(computeCmMatchCount(view, query))
    }, delay)
    return () => window.clearTimeout(t)
  }, [query, navTick, view])

  const runFindNext = () => {
    findNext(view)
    scrollSelectionIntoView(view)
    setNavTick((n) => n + 1)
  }
  const runFindPrev = () => {
    findPrevious(view)
    scrollSelectionIntoView(view)
    setNavTick((n) => n + 1)
  }
  const runReplaceNext = () => {
    // Snapshot the active match BEFORE `replaceNext` runs — the command
    // both rewrites that range and auto-advances the selection to the next
    // match. After it returns, `view.state.selection` already points at the
    // next match, so we use the snapshot to (a) flash the just-written
    // range and (b) keep the viewport anchored on it long enough for the
    // user to see the highlight, instead of scrolling away to the next.
    const before = view.state.selection.main
    const replaceLen = replace.length
    const ok = replaceNext(view)
    if (ok) {
      const flashFrom = before.from
      const flashTo = before.from + replaceLen
      view.dispatch({ effects: flashReplaced.of([{ from: flashFrom, to: flashTo }]) })
      scrollPosIntoView(view, flashFrom)
      onReplaced?.(1)
    }
    setNavTick((n) => n + 1)
  }
  const runReplaceAll = () => {
    // Capture every match range BEFORE replaceAll runs so we can flash
    // each post-replace span. Doc positions of later matches shift as
    // earlier ones are rewritten; we accumulate a `delta` per iteration
    // (replaceLen - matchLen) to project the original positions into the
    // post-replace coordinate system.
    const matches: Array<{ from: number; to: number }> = []
    if (query) {
      const cursor = new SearchCursor(view.state.doc, query)
      while (!cursor.next().done) {
        matches.push({ from: cursor.value.from, to: cursor.value.to })
      }
    }
    const total = matches.length
    replaceAll(view)
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
      view.dispatch({ effects: flashReplaced.of(flashes) })
      if (flashes[0]) scrollPosIntoView(view, flashes[0].from)
      onReplaced?.(total)
    }
    setNavTick((n) => n + 1)
  }

  return (
    <FindBarShell
      testIdPrefix="cm"
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
