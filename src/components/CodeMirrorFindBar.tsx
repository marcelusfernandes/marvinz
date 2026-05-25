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
function scrollSelectionIntoView(view: EditorView): void {
  requestAnimationFrame(() => {
    const sel = view.state.selection.main
    let coords
    try {
      coords = view.coordsAtPos(sel.from)
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

/** Walks all matches of `query` in the editor's document and returns the
 * total plus the 1-based index of the current main selection (if it
 * exactly covers one of those matches). Empty query short-circuits to
 * `{ total: 0, current: null }`. */
function computeCmMatchCount(
  view: EditorView,
  query: string,
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
}

/**
 * Floating Find / Replace bar for the CodeMirror raw-source editor.
 * Drives `@codemirror/search` commands directly; the default top panel is
 * not opened. Replace row is collapsed by default; click the leading
 * chevron to expand.
 */
export function CodeMirrorFindBar({ view, onClose, initialReplaceExpanded }: Props) {
  const [query, setQuery] = useState('')
  const [replace, setReplace] = useState('')
  // Replace row visibility. Initial value: the prop (when Cmd+Alt+F forced
  // it open) or the persisted preference, falling back to collapsed.
  const [replaceExpanded, setReplaceExpanded] = useState<boolean>(
    () => initialReplaceExpanded ?? readReplaceExpanded(),
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

  // Push the typed query into the @codemirror/search state so highlights
  // and findNext/findPrevious operate on it. Immediately after applying the
  // query, jump+scroll to the nearest match so the user sees the result
  // without having to press Enter — matches Notion / VS Code behavior.
  // `findNext` returns false when the doc has no match for the query, so
  // it's safe to call unconditionally; scrollSelectionIntoView is a no-op
  // when the selection didn't move.
  useEffect(() => {
    view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: query, replace })) })
    if (query) {
      const moved = findNext(view)
      if (moved) scrollSelectionIntoView(view)
    }
  }, [query, replace, view])

  // Clear the search query when the bar closes so highlights disappear.
  useEffect(() => {
    return () => {
      view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: '' })) })
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
    replaceNext(view)
    scrollSelectionIntoView(view)
    setNavTick((n) => n + 1)
  }
  const runReplaceAll = () => {
    replaceAll(view)
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
    <div
      className="md-find"
      role="search"
      data-testid="cm-search-panel"
      onKeyDown={handleKeyDown}
    >
      <div className="md-find-row">
        <button
          type="button"
          className={`icon-btn md-find-toggle${
            replaceExpanded ? ' md-find-toggle--active' : ''
          }`}
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
          {!query
            ? ''
            : matchInfo.total === 0
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
