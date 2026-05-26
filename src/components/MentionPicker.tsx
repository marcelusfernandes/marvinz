import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  rankPaletteItems,
  stripBasename,
  type PaletteItem,
} from '../lib/paletteRanker'
import { fileIconFor } from '../lib/fileIcons'
import { Icon } from './Icon'
import { HighlightedMatch } from './HighlightedMatch'

/*
 * MentionPicker — Visual Spec
 * ===========================
 * Structural reference: PathSuggest.tsx + .palette-row / .path-suggest-dropdown styles
 *
 * POPOVER (container)
 *   background    : color-mix(in srgb, var(--surface-2) 75%, transparent)
 *                   + backdrop-filter: blur(24px) saturate(180%)
 *   border        : 1px solid var(--border)
 *   border-radius : var(--radius-lg)        // 12px — matches PathSuggest dropdown
 *   box-shadow    : var(--shadow-md)
 *   z-index       : var(--z-popover)        // 100
 *   padding       : var(--space-1)          // 4px inset before rows
 *   width         : anchored to cursor, min ~240px, max ~400px
 *   max-height    : ~260px with overflow-y: auto  (shows ~8–9 rows)
 *   position      : fixed, portalled to document.body
 *
 * ROW (each list item)
 *   height        : ~28px natural (padding-driven, not fixed)
 *   padding       : var(--space-2)          // 8px all sides
 *   gap           : var(--space-2)          // 8px between icon and text columns
 *   border-radius : var(--radius-md)        // 8px
 *   layout        : flex, align-items: center
 *   cursor        : pointer
 *
 * ICON (fileIconFor + <Icon>)
 *   size          : 14px
 *   color (rest)  : var(--text-tertiary)
 *   color (sel)   : var(--text-secondary)
 *   flex          : 0 0 auto
 *
 * TEXT — file name (basename)
 *   font-size     : var(--font-size-sm)     // 12px
 *   font-weight   : 500
 *   color (rest)  : var(--text-secondary)
 *   color (sel)   : var(--text-primary)
 *   white-space: nowrap; overflow: hidden; text-overflow: ellipsis
 *   max-width     : 60% of row
 *
 * TEXT — relative path (parent dir)
 *   font-size     : var(--font-size-xs)     // 10px
 *   color         : var(--text-tertiary)    // both states
 *   flex: 1; overflow: hidden; text-overflow: ellipsis
 *
 * SELECTED STATE (hover / activeIdx keyboard)
 *   background    : var(--accent-bg)
 *   no extra border or outline
 *   only the file name shifts to var(--text-primary)
 *
 * MATCH HIGHLIGHT (<mark>)
 *   background    : transparent
 *   color         : var(--accent-text)      // Marvinz pink
 *   font-weight   : 700
 *
 * EMPTY STATE (zero results)
 *   popover does NOT render — returns null so the editor surface stays clean.
 *
 * MOTION
 *   No enter animation by default (inline inside editor).
 *
 * MAX RESULTS VISIBLE: 8 (MENTION_LIMIT)
 */

const MIN_WIDTH = 240
const MAX_WIDTH = 400
const MAX_HEIGHT = 260
const MENTION_LIMIT = 8

export type MentionPickerProps = {
  query: string
  items: PaletteItem[]
  anchor: { x: number; y: number }
  onSelect: (item: PaletteItem) => void
  onDismiss: () => void
  maxResults?: number
}

/**
 * Floating popover that lists vault files matching the active `@` query,
 * portalled to `document.body` and positioned at a cursor anchor.
 *
 * Surface-agnostic by design: the host editor (CodeMirror in #310, Milkdown
 * in #311) owns the trigger detection, the anchor coordinates, and the
 * insertion side-effects — this component only ranks, renders, and emits
 * selection/dismiss intents.
 *
 * @param query       Current `@`-query string (everything typed after `@`).
 *                    The picker ranks `items` against this with
 *                    `rankPaletteItems` and resets the highlighted row to 0
 *                    whenever the query changes.
 * @param items       All vault files eligible for ranking.
 * @param anchor      Viewport coordinates `{ x, y }` where the popover's
 *                    top-left should sit. Position is `fixed`.
 * @param onSelect    Invoked when the user commits a row via click,
 *                    `Enter`, or `Tab` — receives the chosen `PaletteItem`.
 *                    The caller is responsible for inserting the mention
 *                    and tearing down the picker.
 * @param onDismiss   Invoked when the user presses `Escape` or
 *                    mousedown-clicks outside the popover. The caller
 *                    should unmount the picker in response.
 * @param maxResults  Optional row cap. Defaults to `MENTION_LIMIT` (8).
 *
 * Notes on dismiss semantics:
 * - Outside `mousedown` triggers `onDismiss` immediately (before any focus
 *   shift), which mirrors macOS-style popovers.
 * - `Escape` calls `onDismiss` and `preventDefault`s so it doesn't bubble
 *   to the host editor.
 * - When there are zero ranked results the component renders `null` (no
 *   empty-state UI) so the editor surface stays uncluttered.
 */
export function MentionPicker({
  query,
  items,
  anchor,
  onSelect,
  onDismiss,
  maxResults = MENTION_LIMIT,
}: MentionPickerProps) {
  const results = useMemo(
    () => rankPaletteItems(items, query, maxResults),
    [items, query, maxResults],
  )

  const [selectedIndex, setSelectedIndex] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const root = rootRef.current
      if (!root) return
      if (e.target instanceof Node && root.contains(e.target)) return
      onDismiss()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onDismiss])

  useEffect(() => {
    if (results.length === 0) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex((i) => (i + 1) % results.length)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex((i) => (i - 1 + results.length) % results.length)
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        const sel = results[selectedIndex]
        if (sel) onSelect(sel.item)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onDismiss()
      }
    }
    document.addEventListener('keydown', handler, { capture: true })
    return () => document.removeEventListener('keydown', handler, { capture: true })
  }, [results, selectedIndex, onSelect, onDismiss])

  const style = useMemo(
    () => ({
      left: anchor.x,
      top: anchor.y,
      minWidth: MIN_WIDTH,
      maxWidth: MAX_WIDTH,
      maxHeight: MAX_HEIGHT,
    }),
    [anchor.x, anchor.y],
  )

  if (results.length === 0) return null

  return createPortal(
    <div className="mention-picker" style={style} role="listbox" ref={rootRef}>
      {results.map((r, i) => {
        const dir = stripBasename(r.item.rel, r.item.name)
        return (
          <button
            type="button"
            key={r.item.path}
            className={`mention-picker-row${i === selectedIndex ? ' active' : ''}`}
            role="option"
            aria-selected={i === selectedIndex}
            onMouseEnter={() => setSelectedIndex(i)}
            onClick={() => onSelect(r.item)}
          >
            <Icon
              name={fileIconFor(r.item.name)}
              className="mention-picker-icon"
              size={14}
            />
            <span className="mention-picker-name">
              <HighlightedMatch text={r.item.name} matches={r.nameMatches} />
            </span>
            {dir && (
              <span className="mention-picker-path">
                <HighlightedMatch
                  text={dir}
                  matches={r.relMatches}
                  bound={r.item.rel.length - r.item.name.length}
                />
              </span>
            )}
          </button>
        )
      })}
    </div>,
    document.body,
  )
}
