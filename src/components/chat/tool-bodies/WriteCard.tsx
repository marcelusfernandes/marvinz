import { memo } from 'react'
import type { ToolBodyProps } from './types'
import { basename, readPath, readString } from './types'

/**
 * Write/Edit tool card. Renders the destination filename pill with a small
 * stats subline summarising the change ("Created", "+5 / -3").
 *
 * Diff preview (codemirror/merge) is opt-in and deferred to a follow-up —
 * Sprint 3 ships the structural card; the merge view lands when the diff
 * payload is part of the tool input/result.
 */
function WriteCardImpl({ tool, input, status, result }: ToolBodyProps) {
  const path = readPath(input)
  const newContent = readString(input, 'content') ?? readString(input, 'new_string')
  const oldContent = readString(input, 'old_string')

  const subline = buildSubline(tool, status, newContent, oldContent, result)

  return (
    <div className="chat-tool-card chat-tool-card-write" data-tool={tool}>
      <span className="chat-tool-pill" data-risk="destructive" title={path ?? undefined}>
        {path ? basename(path) : '(no path)'}
      </span>
      {subline && <span className="chat-tool-subline">{subline}</span>}
    </div>
  )
}

function buildSubline(
  tool: string,
  status: ToolBodyProps['status'],
  newContent: string | null,
  oldContent: string | null,
  result: unknown
): string | null {
  if (status === 'error') return 'Failed'
  if (status === 'denied') return 'Denied'
  if (status === 'cancelled') return 'Cancelled'

  const added = newContent ? newContent.split('\n').length : 0
  const removed = oldContent ? oldContent.split('\n').length : 0

  if (tool === 'Write' || tool === 'create_file') {
    if (status === 'ok') return resultMessage(result) ?? 'Created'
    return added > 0 ? `Creating · ${added} lines` : 'Creating'
  }
  if (tool === 'Edit' || tool === 'edit_file') {
    if (added === 0 && removed === 0) {
      return status === 'ok' ? 'Modified' : 'Editing'
    }
    return `+${added} / -${removed}`
  }
  return resultMessage(result)
}

function resultMessage(result: unknown): string | null {
  if (typeof result === 'string') return result
  if (result && typeof result === 'object') {
    const m = (result as Record<string, unknown>).message
    if (typeof m === 'string') return m
  }
  return null
}

export const WriteCard = memo(WriteCardImpl)
