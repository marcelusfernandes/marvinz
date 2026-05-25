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
import { Icon } from './Icon'
import { readReplaceExpanded, writeReplaceExpanded } from '../lib/findBarPrefs'

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
function scrollSelectionIntoView(view: EditorView): void {
  requestAnimationFrame(() => {
    const { from } = view.state.selection
    let coords
    try {
      coords = view.coordsAtPos(from)
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
}

/**
 * Floating Find / Find-and-Replace bar for the Milkdown (ProseMirror)
 * surface. Replace row is collapsed by default; click the leading chevron
 * to expand. Enter/Shift+Enter navigate matches, Esc dismisses.
 */
export function FindReplaceOverlay({ view, onClose, initialReplaceExpanded }: Props) {
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

  // Auto-focus the find input on mount.
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

  // Push query changes into the plugin state so highlights track typing.
  // Immediately after applying the query, jump+scroll to the nearest match
  // so the user sees the result without having to press Enter — matches
  // Notion / VS Code behavior. `findNext` returns false when no match
  // exists; the scroll helper is harmless in that case.
  useEffect(() => {
    const tr = setSearchState(view.state.tr, new SearchQuery({ search: query, replace }))
    view.dispatch(tr)
    if (query) {
      const moved = findNext(view.state, view.dispatch, view)
      if (moved) scrollSelectionIntoView(view)
    }
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

  // Clear the search state when the panel unmounts so highlights disappear.
  useEffect(() => {
    return () => {
      const current = getSearchState(view.state)
      if (!current) return
      const tr = setSearchState(view.state.tr, new SearchQuery({ search: '' }))
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
    replaceNext(view.state, view.dispatch, view)
    scrollSelectionIntoView(view)
    setNavTick((n) => n + 1)
  }
  const runReplaceAll = () => {
    replaceAll(view.state, view.dispatch, view)
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
      data-testid="pm-search-panel"
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
          data-testid="pm-replace-toggle"
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
          data-testid="pm-search-input"
        />
        <span
          className={`md-find-count${
            !query || matchInfo.total === 0 ? ' md-find-count--empty' : ''
          }`}
          aria-live="polite"
          data-testid="pm-search-count"
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
          data-testid="pm-search-prev"
        >
          <Icon name="chevron-up" size={16} />
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={runFindNext}
          title="Next match (Enter)"
          aria-label="Next match"
          data-testid="pm-search-next"
        >
          <Icon name="chevron-down" size={16} />
        </button>
        <button
          type="button"
          className="icon-btn md-find-close"
          onClick={onClose}
          title="Close (Esc)"
          aria-label="Close find panel"
          data-testid="pm-search-close"
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
            data-testid="pm-replace-input"
          />
          <button
            type="button"
            className="icon-btn"
            onClick={runReplaceAll}
            title="Replace all"
            aria-label="Replace all"
            data-testid="pm-replace-all"
          >
            <Icon name="replace-all" size={16} />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={runReplaceNext}
            title="Replace (Enter)"
            aria-label="Replace"
            data-testid="pm-replace-next"
          >
            <Icon name="replace" size={16} />
          </button>
        </div>
      )}
    </div>
  )
}
