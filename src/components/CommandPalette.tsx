import { useEffect, useMemo, useRef, useState } from 'react'
import { fuzzyMatch } from '../lib/fuzzy'

export type PaletteItem = {
  /** Absolute path on disk */
  path: string
  /** Vault-relative path, used for display + matching */
  rel: string
  /** Just the filename */
  name: string
  /** Whether this is a markdown note (opens in tab) or other (reveal in Finder) */
  isMarkdown: boolean
}

type Props = {
  items: PaletteItem[]
  onPick: (item: PaletteItem, replaceCurrent: boolean) => void
  onClose: () => void
}

const MAX_RESULTS = 60

type Scored = {
  item: PaletteItem
  score: number
  nameMatches: number[]
  relMatches: number[]
}

function rankItems(items: PaletteItem[], query: string): Scored[] {
  if (!query.trim()) {
    return items.slice(0, MAX_RESULTS).map((item) => ({
      item,
      score: 0,
      nameMatches: [],
      relMatches: [],
    }))
  }
  const out: Scored[] = []
  for (const item of items) {
    const nameHit = fuzzyMatch(item.name, query)
    const relHit = fuzzyMatch(item.rel, query)
    if (!nameHit && !relHit) continue
    // Filename matches weigh ~2x more than full-path matches.
    const nameScore = nameHit ? nameHit.score * 2 : 0
    const relScore = relHit ? relHit.score : 0
    out.push({
      item,
      score: nameScore + relScore,
      nameMatches: nameHit?.matches ?? [],
      relMatches: relHit?.matches ?? [],
    })
  }
  out.sort((a, b) => b.score - a.score)
  return out.slice(0, MAX_RESULTS)
}

export function CommandPalette({ items, onPick, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [activeIdx, setActiveIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const results = useMemo(() => rankItems(items, query), [items, query])

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
                <span className="palette-name">
                  {highlight(r.item.name, r.nameMatches)}
                  {!r.item.isMarkdown && <span className="palette-ext-tag">file</span>}
                </span>
                <span className="palette-rel">
                  {highlight(stripBasename(r.item.rel, r.item.name), r.relMatches, r.item.rel.length - r.item.name.length)}
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

function stripBasename(rel: string, name: string): string {
  // The "directory part" of rel; if rel === name, we're at vault root.
  if (rel === name) return ''
  const cut = rel.length - name.length
  return rel.slice(0, Math.max(0, cut - 1)) // strip trailing slash
}

/**
 * Render a string with bold spans on the matched indices.
 * If `bound` is supplied, only highlight indices < bound (used to ignore matches
 * that fell on the basename portion when we already highlight that separately).
 */
function highlight(text: string, indices: number[], bound?: number) {
  if (indices.length === 0) return text
  const filtered = bound != null ? indices.filter((i) => i < bound) : indices
  if (filtered.length === 0) return text
  const parts: Array<string | React.ReactElement> = []
  let cursor = 0
  for (const i of filtered) {
    if (i > cursor) parts.push(text.slice(cursor, i))
    parts.push(<mark key={i}>{text[i]}</mark>)
    cursor = i + 1
  }
  if (cursor < text.length) parts.push(text.slice(cursor))
  return parts
}
