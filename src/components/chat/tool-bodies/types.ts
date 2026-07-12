import type { ToolStatus, ToolCallId } from '../../../lib/chat/types'

/**
 * Common shape every tool body receives. Individual cards narrow the `input`
 * field via `parseInput()` helpers — the renderer treats unknown tool inputs
 * defensively so a malformed payload renders the GenericToolCard fallback
 * rather than crashing the timeline.
 */
export type ToolBodyProps = {
  toolUseId: ToolCallId
  tool: string
  input: unknown
  status: ToolStatus
  result?: unknown
  errorMessage?: string
  durationMs?: number
  /** Pre-edit snapshot outcome for Edit/Write — drives the "Saved" badge. */
  snapshotSaved?: boolean
  /** Snapshot turn id — pass to `snapshot.read(turnId, relPath)` for the pre-edit content. */
  snapshotTurnId?: string
  /** Open the resolved file in the editor pane (filename pill click). */
  onOpenFile?: (path: string) => void
}

/**
 * Single source of truth for ToolStatus → human-readable label, shared by every
 * tool-use surface (timeline dot, edit/write sublines) so the same status never
 * renders divergent text. The trailing `never` assignment makes adding a
 * ToolStatus value without a label a compile error.
 */
export function toolStatusLabel(status: ToolStatus): string {
  switch (status) {
    case 'pending_approval':
      return 'Awaiting approval'
    case 'running':
      return 'Running'
    case 'ok':
      return 'Completed'
    case 'error':
      return 'Failed'
    case 'denied':
      return 'Denied'
    case 'cancelled':
      return 'Cancelled'
  }
  const exhaustive: never = status
  return exhaustive
}

/** Heuristic: pull a primary "path-like" identifier from common tool inputs. */
export function readPath(input: unknown): string | null {
  if (!input || typeof input !== 'object') return null
  const obj = input as Record<string, unknown>
  for (const key of ['file_path', 'path', 'filename', 'file']) {
    const value = obj[key]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return null
}

export function readString(input: unknown, key: string): string | null {
  if (!input || typeof input !== 'object') return null
  const value = (input as Record<string, unknown>)[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

export function basename(path: string): string {
  const ix = path.lastIndexOf('/')
  return ix === -1 ? path : path.slice(ix + 1)
}
