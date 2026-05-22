import { useEffect, useMemo, useRef, useState } from 'react'
import type { FileChangeSource } from '../types'
import { DiffViewer } from './DiffViewer'
import { formatRelativeTime } from '../lib/relativeTime'

type Props = {
  filePath: string
  /** Called on demand to read the latest in-memory buffer when showing the
   * diff. Kept as a getter (not a value) so the parent doesn't have to lift
   * every keystroke into React state. */
  getCurrentBuffer: () => string
  diskContent: string
  diskChangedAt: number
  source: FileChangeSource
  onAcceptDisk: () => void | Promise<void>
  onKeepMine: () => void | Promise<void>
  onDismiss?: () => void
}

export function ExternalChangeBanner({
  filePath,
  getCurrentBuffer,
  diskContent,
  diskChangedAt,
  source,
  onAcceptDisk,
  onKeepMine,
  onDismiss,
}: Props) {
  const [showDiff, setShowDiff] = useState(false)
  const [busy, setBusy] = useState<null | 'reload' | 'keep'>(null)
  const reloadBtnRef = useRef<HTMLButtonElement>(null)

  const fileLabel = useMemo(() => filePath.split('/').pop() ?? filePath, [filePath])
  const relativeTime = formatRelativeTime(diskChangedAt)
  const sourceLabel = source === 'agent' ? 'Claude' : 'External change'
  const headline =
    source === 'agent'
      ? `Claude modified ${fileLabel} (${relativeTime})`
      : `Modified outside the editor (${relativeTime})`

  useEffect(() => {
    // Move keyboard focus into the banner so screen readers and keyboard users
    // can act on it without hunting. We focus the primary action ("Reload")
    // intentionally — Escape still dismisses.
    reloadBtnRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!onDismiss) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onDismiss])

  const runAction = async (kind: 'reload' | 'keep', fn: () => void | Promise<void>) => {
    if (busy) return
    setBusy(kind)
    try {
      await fn()
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <div
        className={`external-change-banner external-change-banner-${source}`}
        role="alert"
        aria-live="assertive"
        aria-label={`${sourceLabel}: ${fileLabel} changed on disk while you were editing`}
      >
        <div className="external-change-banner-text">
          <span className="external-change-banner-source">{sourceLabel}</span>
          <span className="external-change-banner-headline">{headline}</span>
          <span className="external-change-banner-hint">
            Your unsaved edits are preserved. Choose how to resolve the conflict.
          </span>
        </div>
        <div className="external-change-banner-actions" role="group" aria-label="Conflict actions">
          <button
            type="button"
            className="external-change-banner-btn ghost"
            onClick={() => setShowDiff(true)}
            aria-haspopup="dialog"
          >
            View diff
          </button>
          <button
            ref={reloadBtnRef}
            type="button"
            className="external-change-banner-btn primary"
            disabled={busy !== null}
            onClick={() => runAction('reload', onAcceptDisk)}
          >
            {busy === 'reload' ? 'Reloading…' : 'Reload'}
          </button>
          <button
            type="button"
            className="external-change-banner-btn ghost"
            disabled={busy !== null}
            onClick={() => runAction('keep', onKeepMine)}
          >
            {busy === 'keep' ? 'Keeping…' : 'Keep my version'}
          </button>
        </div>
      </div>

      {showDiff && (
        <ExternalChangeDiffModal
          fileLabel={fileLabel}
          mine={getCurrentBuffer()}
          theirs={diskContent}
          sourceLabel={sourceLabel}
          onClose={() => setShowDiff(false)}
        />
      )}
    </>
  )
}

type DiffModalProps = {
  fileLabel: string
  mine: string
  theirs: string
  sourceLabel: string
  onClose: () => void
}

function ExternalChangeDiffModal({
  fileLabel,
  mine,
  theirs,
  sourceLabel,
  onClose,
}: DiffModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    dialogRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className="external-change-diff-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="external-change-diff-title"
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="external-change-diff-header">
          <div>
            <h2 id="external-change-diff-title" className="external-change-diff-title">
              Conflict in {fileLabel}
            </h2>
            <p className="external-change-diff-subtitle">
              Your unsaved buffer vs. the version now on disk ({sourceLabel}).
            </p>
          </div>
          <button
            type="button"
            className="snapshot-close"
            onClick={onClose}
            aria-label="Close diff"
          >
            ✕
          </button>
        </header>
        <div className="external-change-diff-body">
          <DiffViewer
            before={theirs}
            after={mine}
            beforeLabel="On disk"
            afterLabel="My buffer"
            mode="split"
          />
        </div>
      </div>
    </div>
  )
}
