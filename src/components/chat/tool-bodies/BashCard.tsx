import { memo, useState } from 'react'
import type { ToolBodyProps } from './types'
import { readString } from './types'

/**
 * Bash tool card. Shows the command in a monospace IN block. If the tool has
 * completed (`status === 'ok' | 'error'`), the OUT block renders the trimmed
 * stdout/stderr.
 *
 * Output is clipped to a small preview by default; user can expand to see
 * the full payload (keeps the timeline scannable).
 */
function BashCardImpl({ tool, input, status, result, errorMessage }: ToolBodyProps) {
  const command = readString(input, 'command') ?? readString(input, 'cmd') ?? ''
  const output = formatOutput(result, errorMessage)
  const [expanded, setExpanded] = useState(false)
  const showOut = status === 'ok' || status === 'error'
  const clipped = output && output.length > 600 && !expanded

  return (
    <div className="chat-tool-card chat-tool-card-bash" data-tool={tool}>
      <pre className="chat-tool-io" data-channel="in">
        <span className="chat-tool-io-label">$</span>
        <code>{command || '(no command)'}</code>
      </pre>
      {showOut && (
        <>
          <pre
            className="chat-tool-io"
            data-channel="out"
            data-error={status === 'error' ? 'true' : undefined}
          >
            <code>{clipped ? `${output.slice(0, 600)}…` : output || '(no output)'}</code>
          </pre>
          {output && output.length > 600 && (
            <button
              type="button"
              className="chat-tool-expand"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? 'Collapse output' : 'Show full output'}
            </button>
          )}
        </>
      )}
    </div>
  )
}

function formatOutput(result: unknown, errorMessage: string | undefined): string {
  if (errorMessage) return errorMessage
  if (typeof result === 'string') return result
  if (result == null) return ''
  if (typeof result === 'object') {
    const r = result as Record<string, unknown>
    if (typeof r.stdout === 'string') return r.stdout
    if (typeof r.output === 'string') return r.output
    try {
      return JSON.stringify(result, null, 2)
    } catch {
      return String(result)
    }
  }
  return String(result)
}

export const BashCard = memo(BashCardImpl)
