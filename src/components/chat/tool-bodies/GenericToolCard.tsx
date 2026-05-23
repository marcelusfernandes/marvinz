import { memo, useState } from 'react'
import type { ToolBodyProps } from './types'

/**
 * Fallback card for any tool the renderer doesn't have a dedicated card for
 * (e.g., MCP tools added after Marvin shipped). Shows the input as
 * pretty-printed JSON, collapsed by default to keep timeline scannable.
 */
function GenericToolCardImpl({ tool, input, status, result, errorMessage }: ToolBodyProps) {
  const [expanded, setExpanded] = useState(false)
  const inputText = safeStringify(input)
  const showOutput = status === 'ok' || status === 'error'

  return (
    <div className="chat-tool-card chat-tool-card-generic" data-tool={tool}>
      <button
        type="button"
        className="chat-tool-expand"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        {expanded ? 'Hide input' : 'Show input'}
      </button>
      {expanded && (
        <pre className="chat-tool-io" data-channel="in">
          <code>{inputText}</code>
        </pre>
      )}
      {showOutput && (
        <pre
          className="chat-tool-io"
          data-channel="out"
          data-error={status === 'error' ? 'true' : undefined}
        >
          <code>{formatResult(result, errorMessage)}</code>
        </pre>
      )}
    </div>
  )
}

function safeStringify(v: unknown): string {
  if (v == null) return ''
  try {
    return JSON.stringify(v, null, 2)
  } catch {
    return String(v)
  }
}

function formatResult(result: unknown, errorMessage: string | undefined): string {
  if (errorMessage) return errorMessage
  if (typeof result === 'string') return result
  return safeStringify(result)
}

export const GenericToolCard = memo(GenericToolCardImpl)
