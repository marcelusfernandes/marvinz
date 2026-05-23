import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import type { ToolCallId } from '../../lib/chat/types'

export type ApprovalRemember = 'session' | 'always'

export type ApprovalDecision = {
  kind: 'allow' | 'deny'
  remember?: ApprovalRemember
}

type Props = {
  toolUseId: ToolCallId
  onDecide: (toolUseId: ToolCallId, decision: ApprovalDecision) => void
  /** Optional hint slot — e.g., diff toggle button rendered next to actions. */
  hint?: ReactNode
  /** Wall-clock ms when main times out the approval; drives countdown copy. */
  deadlineAt?: number
  disabled?: boolean
}

function useRemainingMs(deadlineAt: number | undefined): number | null {
  const [remaining, setRemaining] = useState<number | null>(() =>
    deadlineAt ? Math.max(0, deadlineAt - Date.now()) : null,
  )
  useEffect(() => {
    if (!deadlineAt) {
      setRemaining(null)
      return
    }
    const tick = () => {
      const ms = Math.max(0, deadlineAt - Date.now())
      setRemaining(ms)
      return ms
    }
    if (tick() === 0) return
    const handle = window.setInterval(() => {
      if (tick() === 0) window.clearInterval(handle)
    }, 1000)
    return () => window.clearInterval(handle)
  }, [deadlineAt])
  return remaining
}

function formatRemaining(ms: number): string {
  const totalSec = Math.ceil(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

/**
 * Inline approval gate. Renders [Allow] [Allow always] [Deny] side-by-side.
 *
 * NOT a modal: composer stays interactive. No focus trap. The Allow button
 * autofocuses so keyboard users can confirm with Enter, but focus can leave
 * the gate at any time (e.g., to scroll, to type in the composer).
 *
 * Esc cancels (sends deny) when focus is inside the gate — local handler
 * only, no global listener that would fight other components.
 */
export function ToolApprovalGate({
  toolUseId,
  onDecide,
  hint,
  deadlineAt,
  disabled = false,
}: Props) {
  const allowRef = useRef<HTMLButtonElement>(null)
  const remainingMs = useRemainingMs(deadlineAt)

  useEffect(() => {
    if (disabled) return
    allowRef.current?.focus()
  }, [disabled])

  const allow = useCallback(
    () => onDecide(toolUseId, { kind: 'allow' }),
    [onDecide, toolUseId],
  )
  const allowAlways = useCallback(
    () => onDecide(toolUseId, { kind: 'allow', remember: 'session' }),
    [onDecide, toolUseId],
  )
  const deny = useCallback(
    () => onDecide(toolUseId, { kind: 'deny' }),
    [onDecide, toolUseId],
  )

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (disabled) return
      if (e.key === 'Escape') {
        e.preventDefault()
        deny()
      }
    },
    [deny, disabled],
  )

  return (
    <div
      className="chat-approval-gate"
      role="group"
      aria-label="Tool approval"
      onKeyDown={handleKeyDown}
    >
      <button
        ref={allowRef}
        type="button"
        className="chat-approval-btn primary"
        data-action="allow"
        onClick={allow}
        disabled={disabled}
      >
        Allow
      </button>
      <button
        type="button"
        className="chat-approval-btn"
        data-action="allow-always"
        onClick={allowAlways}
        disabled={disabled}
        title="Allow this tool for the rest of the session"
      >
        Allow always
      </button>
      <button
        type="button"
        className="chat-approval-btn"
        data-action="deny"
        onClick={deny}
        disabled={disabled}
      >
        Deny
      </button>
      {remainingMs != null && (
        <div className="chat-approval-hint" data-role="countdown">
          {remainingMs > 0
            ? `Expires in ${formatRemaining(remainingMs)}`
            : 'Expired'}
        </div>
      )}
      {hint !== undefined && <div className="chat-approval-hint">{hint}</div>}
    </div>
  )
}
