import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'
import { readReplaceExpanded, writeReplaceExpanded } from '../lib/findBarPrefs'

type Props = {
  /** Test-id prefix (`cm` / `pm`) so the two surfaces keep distinct selectors. */
  testIdPrefix: string
  /** Controlled find query (owned by the surface, which drives its search engine). */
  query: string
  onQueryChange: (value: string) => void
  /** Controlled replace text. */
  replace: string
  onReplaceChange: (value: string) => void
  /** Precomputed match readout from the surface's engine. */
  matchInfo: { total: number; current: number | null }
  onFindNext: () => void
  onFindPrev: () => void
  onReplaceNext: () => void
  onReplaceAll: () => void
  /** Close button + Escape both invoke this. */
  onClose: () => void
  /** Escape additionally refocuses the editor surface (the close button does not). */
  focusEditor?: () => void
  /**
   * When true (e.g. Cmd+Alt+F), the Replace row starts expanded regardless of
   * the persisted preference. The user's manual toggle still wins and is
   * written back to localStorage.
   */
  initialReplaceExpanded?: boolean
}

/**
 * Shared presentational shell for the CodeMirror and ProseMirror find/replace
 * bars (#588). Owns the replace-row expand state + prefs, focus-on-mount, the
 * Escape/Enter keyboard handling, and the whole `md-find` render tree. The
 * search engines stay per-surface: each caller passes engine-backed callbacks
 * and a precomputed `matchInfo`. Purely presentational — no `@codemirror/*` or
 * `prosemirror-*` imports here.
 */
export function FindBarShell({
  testIdPrefix,
  query,
  onQueryChange,
  replace,
  onReplaceChange,
  matchInfo,
  onFindNext,
  onFindPrev,
  onReplaceNext,
  onReplaceAll,
  onClose,
  focusEditor,
  initialReplaceExpanded,
}: Props) {
  // Replace row visibility. Initial value: the prop (when Cmd+Alt+F forced
  // it open) or the persisted preference, falling back to collapsed.
  const [replaceExpanded, setReplaceExpanded] = useState<boolean>(
    () => initialReplaceExpanded ?? readReplaceExpanded()
  )
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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
      focusEditor?.()
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (e.shiftKey) onFindPrev()
      else onFindNext()
    }
  }

  return (
    <div
      className="md-find"
      role="search"
      data-testid={`${testIdPrefix}-search-panel`}
      onKeyDown={handleKeyDown}
    >
      <div className="md-find-row">
        <button
          type="button"
          className={`icon-btn md-find-toggle${replaceExpanded ? ' md-find-toggle--active' : ''}`}
          onClick={toggleReplace}
          title={replaceExpanded ? 'Hide replace' : 'Show replace'}
          aria-label={replaceExpanded ? 'Hide replace row' : 'Show replace row'}
          aria-expanded={replaceExpanded}
          data-testid={`${testIdPrefix}-replace-toggle`}
        >
          <Icon name="replace" size={16} />
        </button>
        <input
          ref={findInputRef}
          type="text"
          className="md-find-input"
          placeholder="Find"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          aria-label="Find"
          data-testid={`${testIdPrefix}-search-input`}
        />
        <span
          className={`md-find-count${!query || matchInfo.total === 0 ? ' md-find-count--empty' : ''}`}
          aria-live="polite"
          data-testid={`${testIdPrefix}-search-count`}
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
          onClick={onFindPrev}
          title="Previous match (Shift+Enter)"
          aria-label="Previous match"
          data-testid={`${testIdPrefix}-search-prev`}
        >
          <Icon name="chevron-up" size={16} />
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={onFindNext}
          title="Next match (Enter)"
          aria-label="Next match"
          data-testid={`${testIdPrefix}-search-next`}
        >
          <Icon name="chevron-down" size={16} />
        </button>
        <button
          type="button"
          className="icon-btn md-find-close"
          onClick={onClose}
          title="Close (Esc)"
          aria-label="Close find panel"
          data-testid={`${testIdPrefix}-search-close`}
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
            onChange={(e) => onReplaceChange(e.target.value)}
            aria-label="Replace"
            data-testid={`${testIdPrefix}-replace-input`}
          />
          <button
            type="button"
            className="icon-btn"
            onClick={onReplaceAll}
            title="Replace all"
            aria-label="Replace all"
            data-testid={`${testIdPrefix}-replace-all`}
          >
            <Icon name="replace-all" size={16} />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={onReplaceNext}
            title="Replace (Enter)"
            aria-label="Replace"
            data-testid={`${testIdPrefix}-replace-next`}
          >
            <Icon name="replace" size={16} />
          </button>
        </div>
      )}
    </div>
  )
}
