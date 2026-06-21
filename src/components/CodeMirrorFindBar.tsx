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
import { Icon } from './Icon'
import { readReplaceExpanded, writeReplaceExpanded } from '../lib/findBarPrefs'
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
  // Replace row visibility. Initial value: the prop (when Cmd+Alt+F forced
  // it open) or the persisted preference, falling back to collapsed.
  const [replaceExpanded, setReplaceExpanded] = useState<boolean>(
    () => initialReplaceExpanded ?? readReplaceExpanded()
  )
  // Bumped after every navigation command so the match-count readout
  // recomputes once the new selection has been applied.
  const [navTick, setNavTick] = useState(0)
  const [matchInfo, setMatchInfo] = useState<{ total: number; current: number | null }>({
    total: 0,
    current: null,
  })
  const findInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    findInputRef.current?.focus()
    findInputRef.current?.select()
  }, [])

  const toggleReplace = () => {
    setReplaceExpanded((prev) => {
      const next = !prev
      writeReplaceExpanded(next)
      return next
    })
  }

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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
      view.focus()
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (e.shiftKey) runFindPrev()
      else runFindNext()
    }
  }

  return (
    <div className="md-find" role="search" data-testid="cm-search-panel" onKeyDown={handleKeyDown}>
      <div className="md-find-row">
        <button
          type="button"
          className={`icon-btn md-find-toggle${replaceExpanded ? ' md-find-toggle--active' : ''}`}
          onClick={toggleReplace}
          title={replaceExpanded ? 'Hide replace' : 'Show replace'}
          aria-label={replaceExpanded ? 'Hide replace row' : 'Show replace row'}
          aria-expanded={replaceExpanded}
          data-testid="cm-replace-toggle"
        >
          <Icon name="replace" size={16} />
        </button>
        <input
          ref={findInputRef}
          type="text"
          className="md-find-input"
          placeholder="Find"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Find"
          data-testid="cm-search-input"
        />
        <span
          className={`md-find-count${
            !query || matchInfo.total === 0 ? ' md-find-count--empty' : ''
          }`}
          aria-live="polite"
          data-testid="cm-search-count"
        >
          {!query || matchInfo.total === 0
            ? 'No results'
            : matchInfo.current !== null
              ? `${matchInfo.current} of ${matchInfo.total}`
              : `${matchInfo.total} ${matchInfo.total === 1 ? 'match' : 'matches'}`}
        </span>
        <button
          type="button"
          className="icon-btn"
          onClick={runFindPrev}
          title="Previous match (Shift+Enter)"
          aria-label="Previous match"
          data-testid="cm-search-prev"
        >
          <Icon name="chevron-up" size={16} />
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={runFindNext}
          title="Next match (Enter)"
          aria-label="Next match"
          data-testid="cm-search-next"
        >
          <Icon name="chevron-down" size={16} />
        </button>
        <button
          type="button"
          className="icon-btn md-find-close"
          onClick={onClose}
          title="Close (Esc)"
          aria-label="Close find panel"
          data-testid="cm-search-close"
        >
          <Icon name="close" size={16} />
        </button>
      </div>
      {replaceExpanded && (
        <div className="md-find-row md-find-row--replace">
          <input
            type="text"
            className="md-find-input md-find-input--bare"
            placeholder="Replace with..."
            value={replace}
            onChange={(e) => setReplace(e.target.value)}
            aria-label="Replace"
            data-testid="cm-replace-input"
          />
          <button
            type="button"
            className="icon-btn"
            onClick={runReplaceAll}
            title="Replace all"
            aria-label="Replace all"
            data-testid="cm-replace-all"
          >
            <Icon name="replace-all" size={16} />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={runReplaceNext}
            title="Replace (Enter)"
            aria-label="Replace"
            data-testid="cm-replace-next"
          >
            <Icon name="replace" size={16} />
          </button>
        </div>
      )}
    </div>
  )
}
