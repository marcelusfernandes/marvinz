import { useEffect, useMemo, useRef, useState } from 'react'
import {
  type PaletteItem,
  rankPaletteItems,
  stripBasename,
} from '../lib/paletteRanker'
import { HighlightedMatch } from './HighlightedMatch'
import { Icon } from './Icon'
import { fileIconFor } from '../lib/fileIcons'

export type { PaletteItem }

type Props = {
  items: PaletteItem[]
  onPick: (item: PaletteItem, replaceCurrent: boolean) => void
  onClose: () => void
}

export function CommandPalette({ items, onPick, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [activeIdx, setActiveIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const results = useMemo(() => rankPaletteItems(items, query), [items, query])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    setActiveIdx(0)
  }, [query])

  useEffect(() => {
    const el = listRef.current?.children[activeIdx] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeIdx, results])

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx((i) => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const sel = results[activeIdx]
      if (sel) onPick(sel.item, e.metaKey || e.ctrlKey)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div
        className="palette"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={handleKey}
      >
        <input
          ref={inputRef}
          className="palette-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search files…"
          spellCheck={false}
          autoComplete="off"
        />
        <div className="palette-results" ref={listRef}>
          {results.length === 0 ? (
            <div className="palette-empty">No results</div>
          ) : (
            results.map((r, i) => (
              <button
                type="button"
                key={r.item.path}
                className={`palette-row${i === activeIdx ? ' active' : ''}`}
                onMouseEnter={() => setActiveIdx(i)}
                onClick={(e) => onPick(r.item, e.metaKey || e.ctrlKey)}
              >
                <Icon name={fileIconFor(r.item.name)} className="palette-icon" size={14} />
                <span className="palette-name">
                  <HighlightedMatch text={r.item.name} matches={r.nameMatches} />
                  {!r.item.isMarkdown && <span className="palette-ext-tag">file</span>}
                </span>
                <span className="palette-rel">
                  <HighlightedMatch
                    text={stripBasename(r.item.rel, r.item.name)}
                    matches={r.relMatches}
                    bound={r.item.rel.length - r.item.name.length}
                  />
                </span>
              </button>
            ))
          )}
        </div>
        <div className="palette-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
          <span><kbd>Enter</kbd> open in new tab</span>
          <span><kbd>⌘</kbd><kbd>Enter</kbd> open in current tab</span>
          <span><kbd>Esc</kbd> close</span>
        </div>
      </div>
    </div>
  )
}
