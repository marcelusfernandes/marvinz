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
import { marvin } from '../lib/marvinApi'
import type { ContentHit } from '../types'

export type { PaletteItem }

type Props = {
  items: PaletteItem[]
  onPick: (item: PaletteItem, replaceCurrent: boolean, line?: number) => void
  onClose: () => void
  vaultPath?: string
}

const CONTENT_DEBOUNCE_MS = 200
const CONTENT_MIN_QUERY = 2

function contentHitToItem(hit: ContentHit): PaletteItem {
  return {
    path: hit.path,
    rel: hit.rel,
    name: hit.name,
    isMarkdown: hit.name.endsWith('.md'),
  }
}

function rangesToIndices(ranges: { start: number; end: number }[]): number[] {
  const out: number[] = []
  for (const r of ranges) for (let i = r.start; i < r.end; i++) out.push(i)
  return out
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

type FlatEntry = { kind: 'file'; result: ScoredPaletteItem } | { kind: 'content'; hit: ContentHit }

type DisplayRow =
  | { kind: 'header'; label: string; loading?: boolean }
  | { kind: 'item'; result: ScoredPaletteItem; itemIdx: number }
  | { kind: 'content-item'; hit: ContentHit; itemIdx: number }
  | { kind: 'rg-unavailable' }

export function CommandPalette({ items, onPick, onClose, vaultPath = '' }: Props) {
  const [query, setQuery] = useState('')
  const [activeIdx, setActiveIdx] = useState(0)
  const [contentHits, setContentHits] = useState<ContentHit[]>([])
  const [contentLoading, setContentLoading] = useState(false)
  const [rgUnavailable, setRgUnavailable] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const searchGenRef = useRef(0)
  const iconTheme = useSetting('iconTheme') ?? 'codicon'

  const results = useMemo(() => rankPaletteItems(items, query), [items, query])

  useEffect(() => {
    // Reset stale state below threshold and bail out before scheduling IPC.
    if (query.length < CONTENT_MIN_QUERY) {
      searchGenRef.current++
      setContentHits([])
      setContentLoading(false)
      setRgUnavailable(false)
      return
    }
    const timer = setTimeout(() => {
      const gen = ++searchGenRef.current
      setContentLoading(true)
      marvin.search
        .content(query)
        .then((res) => {
          if (gen !== searchGenRef.current) return
          if (Array.isArray(res)) {
            setContentHits(res)
            setRgUnavailable(false)
          } else {
            setContentHits([])
            setRgUnavailable(true)
          }
        })
        .catch(() => {
          if (gen !== searchGenRef.current) return
          setContentHits([])
        })
        .finally(() => {
          if (gen !== searchGenRef.current) return
          setContentLoading(false)
        })
    }, CONTENT_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query, vaultPath])

  const { displayList, flatItems } = useMemo(() => {
    const buckets = new Map<PaletteCategory, ScoredPaletteItem[]>()
    for (const r of results) {
      const cat = categorizeItem(r.item)
      const arr = buckets.get(cat)
      if (arr) arr.push(r)
      else buckets.set(cat, [r])
    }
    const display: DisplayRow[] = []
    const flat: FlatEntry[] = []
    for (const cat of SECTION_ORDER) {
      const bucket = buckets.get(cat)
      if (!bucket || bucket.length === 0) continue
      const label =
        bucket.length > 1 ? `${SECTION_LABEL[cat]} (${bucket.length})` : SECTION_LABEL[cat]
      display.push({ kind: 'header', label })
      for (const r of bucket) {
        display.push({ kind: 'item', result: r, itemIdx: flat.length })
        flat.push({ kind: 'file', result: r })
      }
    }
    if (rgUnavailable) {
      display.push({ kind: 'header', label: 'Content matches' })
      display.push({ kind: 'rg-unavailable' })
    } else if (contentHits.length > 0) {
      const label =
        contentHits.length > 1 ? `Content matches (${contentHits.length})` : 'Content matches'
      display.push({ kind: 'header', label, loading: contentLoading })
      for (const hit of contentHits) {
        display.push({ kind: 'content-item', hit, itemIdx: flat.length })
        flat.push({ kind: 'content', hit })
      }
    } else if (contentLoading) {
      display.push({ kind: 'header', label: 'Content matches', loading: true })
    }
    return { displayList: display, flatItems: flat }
  }, [results, contentHits, contentLoading, rgUnavailable])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    setActiveIdx(0)
  }, [query])

  useEffect(() => {
    const node = listRef.current?.querySelector(
      `[data-item-idx="${activeIdx}"]`
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
      if (!sel) return
      if (sel.kind === 'file') {
        onPick(sel.result.item, e.metaKey || e.ctrlKey)
      } else {
        onPick(contentHitToItem(sel.hit), e.metaKey || e.ctrlKey, sel.hit.line)
      }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()} onKeyDown={handleKey}>
        <input
          ref={inputRef}
          className="palette-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={
            vaultPath ? `Search in ${vaultPath.split('/').pop() || 'vault'}…` : 'Search files…'
          }
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
                  <div key={`header-${rowIdx}-${row.label}`} className="palette-section-header">
                    {row.label}
                    {row.loading && (
                      <span
                        className="palette-section-loading"
                        data-testid="content-search-loading"
                      >
                        Searching…
                      </span>
                    )}
                  </div>
                )
              }
              if (row.kind === 'rg-unavailable') {
                return (
                  <div key={`rg-unavailable-${rowIdx}`} className="palette-rg-unavailable">
                    Content search requires ripgrep — install via <code>brew install ripgrep</code>
                  </div>
                )
              }
              if (row.kind === 'content-item') {
                const { hit, itemIdx } = row
                return (
                  <button
                    type="button"
                    key={`content-${hit.path}-${hit.line}`}
                    data-item-idx={itemIdx}
                    className={`palette-row palette-row-content${itemIdx === activeIdx ? ' active' : ''}`}
                    onMouseEnter={() => setActiveIdx(itemIdx)}
                    onClick={(e) => onPick(contentHitToItem(hit), e.metaKey || e.ctrlKey, hit.line)}
                  >
                    <div className="palette-row-line1">
                      {iconTheme === 'material' ? (
                        <MaterialIcon
                          name={hit.name}
                          isDir={false}
                          className="material-file-icon"
                        />
                      ) : (
                        <Icon name={fileIconFor(hit.name)} className="palette-icon" size={14} />
                      )}
                      <span className="palette-name">{hit.name}</span>
                      <span className="palette-rel">{stripBasename(hit.rel, hit.name)}</span>
                      <span className="palette-line">L{hit.line}</span>
                    </div>
                    {hit.lineText && (
                      <div className="palette-row-line2">
                        <HighlightedMatch
                          text={hit.lineText}
                          matches={rangesToIndices(hit.matchRanges ?? [])}
                        />
                      </div>
                    )}
                  </button>
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
          <span>
            <span className="kbd-combo">
              <kbd>↑</kbd>
              <kbd>↓</kbd>
            </span>{' '}
            navigate
          </span>
          <span>
            <kbd>Enter</kbd> open in new tab
          </span>
          <span>
            <span className="kbd-combo">
              <kbd>⌘</kbd>
              <kbd>Enter</kbd>
            </span>{' '}
            open in current tab
          </span>
          <span>
            <kbd>Esc</kbd> close
          </span>
        </div>
      </div>
    </div>
  )
}
