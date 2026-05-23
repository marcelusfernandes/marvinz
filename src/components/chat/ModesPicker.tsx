import {
  useCallback,
  useEffect,
  useRef,
  type KeyboardEvent,
  type RefObject,
} from 'react'
import { Icon } from '../Icon'
import { MODE_OPTIONS } from './ModePill'
import type { PermissionMode } from '../../lib/chat/types'

type Props = {
  mode: PermissionMode
  anchorRef: RefObject<HTMLElement | null>
  onSelect: (mode: PermissionMode) => void
  onClose: () => void
}

/**
 * Lightweight listbox popover for switching permission mode. Anchored above
 * the toolbar pill (composer sits at the bottom of the chat panel).
 *
 * Behaviors:
 *  - Esc closes the popover
 *  - Click outside closes
 *  - Up/Down arrow moves focus among options
 *  - Enter/Space selects the focused option
 *  - Selection calls onSelect AND onClose (the picker doesn't keep the
 *    selected state — parent does)
 */
export function ModesPicker({ mode, anchorRef, onSelect, onClose }: Props) {
  const popoverRef = useRef<HTMLUListElement>(null)
  const activeIx = MODE_OPTIONS.findIndex((m) => m.value === mode)

  useEffect(() => {
    const onDocPointerDown = (ev: MouseEvent) => {
      const target = ev.target as Node | null
      if (!target) return
      if (popoverRef.current?.contains(target)) return
      if (anchorRef.current?.contains(target)) return
      onClose()
    }
    const onDocKeyDown = (ev: globalThis.KeyboardEvent) => {
      if (ev.key === 'Escape') {
        ev.preventDefault()
        onClose()
        anchorRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', onDocPointerDown)
    document.addEventListener('keydown', onDocKeyDown)
    return () => {
      document.removeEventListener('mousedown', onDocPointerDown)
      document.removeEventListener('keydown', onDocKeyDown)
    }
  }, [anchorRef, onClose])

  useEffect(() => {
    const ul = popoverRef.current
    if (!ul) return
    const items = ul.querySelectorAll<HTMLLIElement>('[role="option"]')
    items[Math.max(0, activeIx)]?.focus()
    // Only focus on mount — keyboard nav moves focus afterwards.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLUListElement>) => {
      const ul = popoverRef.current
      if (!ul) return
      const items = Array.from(
        ul.querySelectorAll<HTMLLIElement>('[role="option"]'),
      )
      const currentIx = items.findIndex((el) => el === document.activeElement)
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        items[Math.min(items.length - 1, currentIx + 1)]?.focus()
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        items[Math.max(0, currentIx - 1)]?.focus()
      } else if (e.key === 'Home') {
        e.preventDefault()
        items[0]?.focus()
      } else if (e.key === 'End') {
        e.preventDefault()
        items[items.length - 1]?.focus()
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        const opt = MODE_OPTIONS[currentIx]
        if (opt) {
          onSelect(opt.value)
          onClose()
        }
      }
    },
    [onSelect, onClose],
  )

  return (
    <div className="chat-modes-popover" role="presentation">
      <ul
        ref={popoverRef}
        className="chat-modes-list"
        role="listbox"
        aria-label="Permission mode"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        {MODE_OPTIONS.map((opt) => {
          const selected = opt.value === mode
          return (
            <li
              key={opt.value}
              role="option"
              tabIndex={selected ? 0 : -1}
              aria-selected={selected}
              className="chat-modes-item"
              data-selected={selected ? 'true' : undefined}
              onClick={() => {
                onSelect(opt.value)
                onClose()
              }}
            >
              <span className="chat-modes-check" aria-hidden="true">
                {selected ? <Icon name="check" size={14} /> : null}
              </span>
              <span className="chat-modes-text">
                <span className="chat-modes-label">{opt.label}</span>
                <span className="chat-modes-hint">{opt.hint}</span>
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
