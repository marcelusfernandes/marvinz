import { memo, useEffect, useState } from 'react'
import { DiffCard } from '../DiffCard'
import type { ToolBodyProps } from './types'
import { basename, readPath, readString } from './types'

/**
 * Edit tool card (PRD §6.2, AC1). Compact by default: filename pill +
 * change-summary subline + Saved badge. Inline diff is opt-in via the
 * "Show diff" button — the heavier DiffCard mounts only when expanded.
 */
function EditCardImpl({
  tool,
  input,
  status,
  result,
  snapshotSaved,
  snapshotTurnId,
  onOpenFile,
}: ToolBodyProps) {
  const path = readPath(input)
  const newContent = readString(input, 'new_string') ?? readString(input, 'content')
  const oldContent = readString(input, 'old_string')
  const summary = buildChangeSummary(status, newContent, oldContent, result)
  const [showDiff, setShowDiff] = useState(false)
  const [snapshotOldText, setSnapshotOldText] = useState<string | null>(null)
  const canOpen = !!path && !!onOpenFile
  const canToggleDiff = status === 'ok' && !!path

  // Fetch the pre-edit snapshot content once the user opens the diff. Falls
  // back to Edit's `old_string` payload when the snapshot is unavailable.
  useEffect(() => {
    if (!showDiff || !canToggleDiff) return
    if (!snapshotTurnId || !path) return
    if (snapshotOldText !== null) return
    let cancelled = false
    ;(async () => {
      try {
        const vaultRoot = await window.marvin.vault.current()
        if (cancelled) return
        const relPath = toRelPath(path, vaultRoot)
        if (!relPath) return
        const res = await window.marvin.snapshot.read(snapshotTurnId, relPath)
        if (cancelled) return
        if (res.ok) setSnapshotOldText(res.data)
      } catch {
        // Fail-soft — the DiffCard will render with the input fallback.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [showDiff, canToggleDiff, snapshotTurnId, path, snapshotOldText])

  const handlePillClick = () => {
    if (canOpen && path) onOpenFile!(path)
  }

  const handleToggle = () => {
    if (!canToggleDiff) return
    setShowDiff((v) => !v)
  }

  return (
    <div className="chat-tool-card chat-tool-card-edit" data-tool={tool}>
      <div className="chat-tool-card-edit-row">
        <button
          type="button"
          className="chat-tool-pill chat-tool-pill-button"
          data-risk="destructive"
          title={path ?? undefined}
          onClick={handlePillClick}
          disabled={!canOpen}
        >
          {path ? basename(path) : '(no path)'}
        </button>
        {summary && <span className="chat-tool-subline">{summary}</span>}
        {snapshotSaved && (
          <span
            className="chat-tool-saved-badge"
            data-badge="saved"
            aria-label="A snapshot of this file was saved. View versions →"
            title="A snapshot of this file was saved. View versions →"
          >
            Saved
          </span>
        )}
        {canToggleDiff && (
          <button
            type="button"
            className="chat-tool-expand chat-tool-edit-diff-toggle"
            data-action="expand-diff"
            onClick={handleToggle}
            aria-expanded={showDiff}
          >
            {showDiff ? 'Hide diff' : 'Show diff'}
          </button>
        )}
      </div>
      {showDiff && canToggleDiff && (
        <DiffCard
          oldText={snapshotOldText ?? oldContent ?? ''}
          newText={newContent ?? ''}
          fileName={path ? basename(path) : undefined}
          onOpenInEditor={canOpen ? () => onOpenFile!(path!) : undefined}
        />
      )}
    </div>
  )
}

/**
 * Snapshot APIs work in vault-relative paths. The Edit tool's input typically
 * gives us an absolute path; we strip the vault root. If the path is already
 * relative (no leading slash), pass it through. Returns null when the path
 * lies outside the vault — the diff falls back to `old_string` from the input.
 */
function toRelPath(absOrRel: string, vaultRoot: string | null): string | null {
  if (!absOrRel.startsWith('/')) return absOrRel
  if (!vaultRoot) return null
  const prefix = vaultRoot.endsWith('/') ? vaultRoot : `${vaultRoot}/`
  if (absOrRel.startsWith(prefix)) return absOrRel.slice(prefix.length)
  return null
}

function buildChangeSummary(
  status: ToolBodyProps['status'],
  newContent: string | null,
  oldContent: string | null,
  result: unknown,
): string | null {
  if (status === 'error') return 'Failed'
  if (status === 'denied') return 'Denied'
  if (status === 'cancelled') return 'Cancelled'
  if (status === 'pending_approval') return 'Pending approval'

  const newLines = countLines(newContent)
  const oldLines = countLines(oldContent)
  const diff = newLines - oldLines

  if (diff > 0) return `Added ${diff} ${diff === 1 ? 'line' : 'lines'}`
  if (diff < 0) {
    const n = -diff
    return `Removed ${n} ${n === 1 ? 'line' : 'lines'}`
  }
  if (newLines > 0 || oldLines > 0) return 'Modified'
  return resultMessage(result) ?? 'Modified'
}

function countLines(text: string | null): number {
  if (!text) return 0
  return text.split('\n').length
}

function resultMessage(result: unknown): string | null {
  if (typeof result === 'string') return result
  if (result && typeof result === 'object') {
    const m = (result as Record<string, unknown>).message
    if (typeof m === 'string') return m
  }
  return null
}

export const EditCard = memo(EditCardImpl)
