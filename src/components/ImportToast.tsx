import { useEffect } from 'react'
import { Icon } from './Icon'

export type ImportToastState = 'success' | 'partial' | 'error'

type Props = {
  state: ImportToastState
  message: string
  onDismiss: () => void
  autoDismissMs?: number
}

const DEFAULT_DURATION_MS: Record<ImportToastState, number> = {
  success: 3000,
  partial: 5000,
  error: 5000,
}

export function ImportToast({ state, message, onDismiss, autoDismissMs }: Props) {
  const duration = autoDismissMs ?? DEFAULT_DURATION_MS[state]

  useEffect(() => {
    if (duration <= 0) return
    const id = window.setTimeout(onDismiss, duration)
    return () => window.clearTimeout(id)
  }, [duration, onDismiss])

  return (
    <div className={`import-toast ${state}`} role="status" aria-live="polite">
      <StatusDot state={state} />
      <span className="import-toast-text">{message}</span>
      <button
        type="button"
        className="import-toast-dismiss"
        onClick={onDismiss}
        aria-label="Dismiss import notification"
      >
        <Icon name="close" />
      </button>
    </div>
  )
}

function StatusDot({ state }: { state: ImportToastState }) {
  return <span className={`import-toast-dot ${state}`} aria-hidden="true" />
}
