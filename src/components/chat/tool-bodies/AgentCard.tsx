import { memo } from 'react'
import type { ToolBodyProps } from './types'
import { readString } from './types'

/**
 * Agent (sub-agent dispatch) card. Renders a nested timeline-style block
 * indented 24px so the parent timeline retains its bullet line while the
 * dispatched task reads as a child unit.
 *
 * The prompt is shown verbatim; sub-agent stream output (if available) lands
 * in `result` and is rendered as a secondary text block.
 */
function AgentCardImpl({ tool, input, status, result, errorMessage }: ToolBodyProps) {
  const description = readString(input, 'description')
  const subagentType = readString(input, 'subagent_type') ?? readString(input, 'type')
  const prompt = readString(input, 'prompt')

  const output = formatAgentResult(result, errorMessage)

  return (
    <div className="chat-tool-card chat-tool-card-agent" data-tool={tool}>
      <div className="chat-tool-agent-head">
        {subagentType && (
          <span className="chat-tool-pill chat-tool-agent-type">{subagentType}</span>
        )}
        {description && <span className="chat-tool-agent-desc">{description}</span>}
      </div>
      {prompt && <p className="chat-tool-agent-prompt">{prompt}</p>}
      {output && (
        <div
          className="chat-tool-agent-output"
          data-error={status === 'error' ? 'true' : undefined}
        >
          {output}
        </div>
      )}
    </div>
  )
}

function formatAgentResult(result: unknown, errorMessage: string | undefined): string | null {
  if (errorMessage) return errorMessage
  if (typeof result === 'string') return result
  if (result && typeof result === 'object') {
    const r = result as Record<string, unknown>
    if (typeof r.message === 'string') return r.message
    if (typeof r.output === 'string') return r.output
  }
  return null
}

export const AgentCard = memo(AgentCardImpl)
