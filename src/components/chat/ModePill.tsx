import { forwardRef } from 'react'
import { Icon } from '../Icon'
import type { PermissionMode } from '../../lib/chat/types'

export type ModeMeta = {
  value: PermissionMode
  label: string
  hint: string
}

export const MODE_OPTIONS: readonly ModeMeta[] = [
  {
    value: 'default',
    label: 'Ask before edits',
    hint: 'Marvin asks before any file write or shell command',
  },
  {
    value: 'acceptEdits',
    label: 'Edit automatically',
    hint: 'All file edits proceed without asking',
  },
  {
    value: 'plan',
    label: 'Plan mode',
    hint: 'Agent plans without touching files',
  },
  {
    value: 'auto',
    label: 'Auto mode',
    hint: 'Marvin chooses the best mode per tool',
  },
]

export function labelForMode(mode: PermissionMode): string {
  return MODE_OPTIONS.find((m) => m.value === mode)?.label ?? 'Ask before edits'
}

type Props = {
  mode: PermissionMode
  expanded?: boolean
  disabled?: boolean
  onClick: () => void
}

/**
 * Composer toolbar pill showing the active permission mode. Click toggles
 * the ModesPicker popover (parent owns open state). Forwarded ref lets the
 * picker anchor itself to the pill.
 */
export const ModePill = forwardRef<HTMLButtonElement, Props>(function ModePill(
  { mode, expanded = false, disabled = false, onClick },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      className="chat-mode-pill"
      data-mode={mode}
      data-expanded={expanded ? 'true' : undefined}
      onClick={onClick}
      disabled={disabled}
      aria-haspopup="listbox"
      aria-expanded={expanded}
      aria-label={`Permission mode: ${labelForMode(mode)}`}
    >
      <span className="chat-mode-pill-label">{labelForMode(mode)}</span>
      <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={12} />
    </button>
  )
})
