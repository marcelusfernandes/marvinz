import { useEffect } from 'react'

type Props = {
  files: string[]
  agentLabel?: string
  onOpenVersions: () => void
  onDismiss: () => void
  autoDismissMs?: number
}

const MAX_FILES_SHOWN = 3

export function SnapshotToast({
  files,
  agentLabel = 'Claude',
  onOpenVersions,
  onDismiss,
  autoDismissMs = 10000,
}: Props) {
  useEffect(() => {
    if (autoDismissMs <= 0) return
    const id = window.setTimeout(onDismiss, autoDismissMs)
    return () => window.clearTimeout(id)
  }, [autoDismissMs, onDismiss])

  if (files.length === 0) return null

  const summary = summarizeFiles(files)

  return (
    <div
      className="snapshot-toast"
      role="status"
      aria-live="polite"
      aria-label={`${agentLabel} modified ${files.length} ${files.length === 1 ? 'file' : 'files'}`}
    >
      <div className="snapshot-toast-body">
        <span className="snapshot-toast-text">
          <strong>{agentLabel}</strong> modified {summary}
        </span>
      </div>
      <div className="snapshot-toast-actions">
        <button
          type="button"
          className="snapshot-toast-btn primary"
          onClick={onOpenVersions}
        >
          View versions
        </button>
        <button
          type="button"
          className="snapshot-toast-btn ghost"
          onClick={onDismiss}
          aria-label="Dismiss notification"
        >
          ✕
        </button>
      </div>
    </div>
  )
}

function summarizeFiles(files: string[]): string {
  const names = files.map((p) => p.split('/').pop() ?? p)
  if (names.length === 1) return names[0]
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  if (names.length <= MAX_FILES_SHOWN) {
    return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
  }
  const shown = names.slice(0, MAX_FILES_SHOWN - 1).join(', ')
  const rest = names.length - (MAX_FILES_SHOWN - 1)
  return `${shown} and ${rest} more ${rest === 1 ? 'file' : 'files'}`
}
