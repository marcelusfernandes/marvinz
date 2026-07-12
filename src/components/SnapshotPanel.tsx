import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SnapshotManifest } from '../types'
import { DiffViewer } from './DiffViewer'
import { formatAbsoluteTime, formatRelativeTime } from '../lib/relativeTime'
import { marvin, friendlySnapshotError } from '../lib/marvinApi'

type Props = {
  filePath: string
  relPath: string
  currentContent: string
  initialTurnId?: string
  onClose: () => void
  onRestored: (filePath: string) => void
  onError: (message: string) => void
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'empty' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; versions: SnapshotManifest[] }

type SelectedVersion = {
  turnId: string
  content: string | null
  loading: boolean
  error: string | null
}

export function SnapshotPanel({
  filePath,
  relPath,
  currentContent,
  initialTurnId,
  onClose,
  onRestored,
  onError,
}: Props) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [selected, setSelected] = useState<SelectedVersion | null>(null)
  const [restoring, setRestoring] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const fileLabel = useMemo(() => relPath.split('/').pop() ?? relPath, [relPath])

  const loadVersions = useCallback(async () => {
    setState({ kind: 'loading' })
    try {
      const res = await marvin.snapshot.listForFile(relPath)
      if (!res.ok) {
        setState({ kind: 'error', message: friendlySnapshotError(res.error) })
        return
      }
      const versions = res.data
      if (versions.length === 0) {
        setState({ kind: 'empty' })
        setSelected(null)
        return
      }
      setState({ kind: 'ready', versions })
      const match = initialTurnId ? versions.find((v) => v.turnId === initialTurnId) : undefined
      const preferred = match ?? versions[0]
      setSelected({ turnId: preferred.turnId, content: null, loading: true, error: null })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load versions'
      setState({ kind: 'error', message })
    }
  }, [relPath, initialTurnId])

  useEffect(() => {
    void loadVersions()
  }, [loadVersions])

  useEffect(() => {
    if (!selected || selected.content !== null || selected.error) return
    let cancelled = false
    const turnId = selected.turnId
    ;(async () => {
      try {
        const res = await marvin.snapshot.read(turnId, relPath)
        if (cancelled) return
        if (!res.ok) {
          setSelected((prev) =>
            prev && prev.turnId === turnId
              ? { ...prev, loading: false, error: friendlySnapshotError(res.error) }
              : prev
          )
          return
        }
        setSelected((prev) =>
          prev && prev.turnId === turnId ? { ...prev, content: res.data, loading: false } : prev
        )
      } catch (err) {
        if (cancelled) return
        const message = err instanceof Error ? err.message : 'Failed to read snapshot'
        setSelected((prev) =>
          prev && prev.turnId === turnId ? { ...prev, loading: false, error: message } : prev
        )
      }
    })()
    return () => {
      cancelled = true
    }
  }, [selected, relPath])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    dialogRef.current?.focus()
  }, [])

  const handleSelectVersion = (turnId: string) => {
    setSelected({ turnId, content: null, loading: true, error: null })
  }

  const handleRestore = async () => {
    if (!selected || selected.content === null || restoring) return
    setRestoring(true)
    try {
      const res = await marvin.snapshot.restore(selected.turnId, relPath)
      setRestoring(false)
      if (!res.ok) {
        onError(friendlySnapshotError(res.error))
        return
      }
      onRestored(filePath)
      onClose()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to restore version'
      setRestoring(false)
      onError(message)
    }
  }

  const restoreEnabled = !!selected && selected.content !== null && !restoring

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className="snapshot-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="snapshot-title"
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="snapshot-header">
          <div>
            <h2 id="snapshot-title" className="snapshot-title">
              Versions of {fileLabel}
            </h2>
            <p className="snapshot-subtitle">{relPath}</p>
          </div>
          <button
            type="button"
            className="snapshot-close"
            onClick={onClose}
            aria-label="Close versions panel"
          >
            ✕
          </button>
        </header>

        <div className="snapshot-body">
          <aside className="snapshot-list" aria-label="Versions list">
            {state.kind === 'loading' && <div className="snapshot-empty">Loading…</div>}
            {state.kind === 'error' && <div className="snapshot-error">{state.message}</div>}
            {state.kind === 'empty' && (
              <div className="snapshot-empty">No saved versions for this file yet.</div>
            )}
            {state.kind === 'ready' && (
              <ul role="listbox" aria-label="Available versions" className="snapshot-list-ul">
                {state.versions.map((v) => {
                  const active = selected?.turnId === v.turnId
                  const size = v.files.find((f) => f.relPath === relPath)?.sizeBefore ?? 0
                  return (
                    <li key={v.turnId}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={active}
                        className={`snapshot-version${active ? ' active' : ''}`}
                        onClick={() => handleSelectVersion(v.turnId)}
                      >
                        <span className="snapshot-version-when">
                          {formatRelativeTime(v.timestamp)}
                        </span>
                        <span className="snapshot-version-meta">
                          <span title={formatAbsoluteTime(v.timestamp)}>
                            {new Date(v.timestamp).toLocaleTimeString()}
                          </span>
                          <span>{formatBytes(size)}</span>
                          <span className="snapshot-version-trigger">
                            {labelForTrigger(v.trigger)}
                          </span>
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </aside>

          <section className="snapshot-detail" aria-label="Differences">
            {!selected && state.kind === 'ready' && (
              <div className="snapshot-placeholder">Select a version to see the diff.</div>
            )}
            {selected?.loading && <div className="snapshot-placeholder">Loading snapshot…</div>}
            {selected?.error && <div className="snapshot-error">{selected.error}</div>}
            {selected && selected.content !== null && (
              <DiffViewer
                before={selected.content}
                after={currentContent}
                beforeLabel="Saved version"
                afterLabel="Current"
              />
            )}
          </section>
        </div>

        <footer className="snapshot-footer">
          <span className="snapshot-hint">
            The current content is saved as a snapshot before restoring (undo available).
          </span>
          <div className="snapshot-actions">
            <button type="button" className="modal-btn ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="modal-btn primary"
              disabled={!restoreEnabled}
              onClick={handleRestore}
            >
              {restoring ? 'Restoring…' : 'Restore this version'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function labelForTrigger(trigger: SnapshotManifest['trigger']): string {
  if (trigger === 'file:write') return 'AI'
  if (trigger === 'watcher') return 'external'
  if (trigger === 'restore') return 'restore'
  if (trigger === 'cascade') return 'link rewrite'
  return trigger
}
