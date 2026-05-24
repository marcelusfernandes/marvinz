import { useEffect, useMemo, useRef, useState } from 'react'
import {
  type PaletteItem,
  type ScoredPaletteItem,
  rankPaletteItems,
  stripBasename,
} from '../lib/paletteRanker'
import { categorizeItem, type PaletteCategory } from '../lib/paletteCategory'
import { HighlightedMatch } from './HighlightedMatch'
import { Icon } from './Icon'
import { MaterialIcon } from './MaterialIcon'
import { fileIconFor } from '../lib/fileIcons'
import { useSetting } from '../lib/settingsStore'

export type { PaletteItem }

type Props = {
  items: PaletteItem[]
  onPick: (item: PaletteItem, replaceCurrent: boolean) => void
  onClose: () => void
}

const SECTION_ORDER: PaletteCategory[] = ['note', 'other', 'agent', 'command', 'rule', 'hook']

const SECTION_LABEL: Record<PaletteCategory, string> = {
  note: 'Notes',
  other: 'Other',
  agent: 'Agents',
  command: 'Commands',
  rule: 'Rules',
  hook: 'Hooks',
}

type DisplayRow =
  | { kind: 'header'; label: string }
  | { kind: 'item'; result: ScoredPaletteItem; itemIdx: number }

export function CommandPalette({ items, onPick, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [activeIdx, setActiveIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const iconTheme = useSetting('iconTheme') ?? 'codicon'

  const results = useMemo(() => rankPaletteItems(items, query), [items, query])

  const { displayList, flatItems } = useMemo(() => {
    const buckets = new Map<PaletteCategory, ScoredPaletteItem[]>()
    for (const r of results) {
      const cat = categorizeItem(r.item)
      const arr = buckets.get(cat)
      if (arr) arr.push(r)
      else buckets.set(cat, [r])
    }
    const display: DisplayRow[] = []
    const flat: ScoredPaletteItem[] = []
    for (const cat of SECTION_ORDER) {
      const bucket = buckets.get(cat)
      if (!bucket || bucket.length === 0) continue
      const label = bucket.length > 1 ? `${SECTION_LABEL[cat]} (${bucket.length})` : SECTION_LABEL[cat]
      display.push({ kind: 'header', label })
      for (const r of bucket) {
        display.push({ kind: 'item', result: r, itemIdx: flat.length })
        flat.push(r)
      }
    }
    return { displayList: display, flatItems: flat }
  }, [results])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    setActiveIdx(0)
  }, [query])

  useEffect(() => {
    const node = listRef.current?.querySelector(
      `[data-item-idx="${activeIdx}"]`,
    ) as HTMLElement | null
    node?.scrollIntoView({ block: 'nearest' })
  }, [activeIdx, displayList])

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx((i) => Math.min(i + 1, flatItems.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const sel = flatItems[activeIdx]
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
          {displayList.length === 0 ? (
            <div className="palette-empty">No results</div>
          ) : (
            displayList.map((row, rowIdx) => {
              if (row.kind === 'header') {
                return (
                  <div
                    key={`header-${rowIdx}-${row.label}`}
                    className="palette-section-header"
                  >
                    {row.label}
                  </div>
                )
              }
              const { result: r, itemIdx } = row
              return (
                <button
                  type="button"
                  key={r.item.path}
                  data-item-idx={itemIdx}
                  className={`palette-row${itemIdx === activeIdx ? ' active' : ''}`}
                  onMouseEnter={() => setActiveIdx(itemIdx)}
                  onClick={(e) => onPick(r.item, e.metaKey || e.ctrlKey)}
                >
                  {iconTheme === 'material' ? (
                    <MaterialIcon name={r.item.name} isDir={false} className="material-file-icon" />
                  ) : (
                    <Icon name={fileIconFor(r.item.name)} className="palette-icon" size={14} />
                  )}
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
              )
            })
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
