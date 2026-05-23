import { memo } from 'react'
import { TimelineItem } from './TimelineItem'
import { StreamingMarkdown } from './StreamingMarkdown'
import type { AssistantBlock, AssistantMessage } from '../../lib/chat/types'

type Props = {
  message: AssistantMessage
}

function dotStateForTool(status: AssistantBlock & { kind: 'tool_use' }) {
  switch (status.status) {
    case 'pending_approval':
      return 'amber' as const
    case 'running':
      return 'running' as const
    case 'ok':
      return 'green' as const
    case 'error':
      return 'red' as const
    case 'denied':
    case 'cancelled':
      return 'outline' as const
  }
}

function AssistantMessageCardImpl({ message }: Props) {
  // Asymmetric bubble pattern: NO container around assistant content. The
  // bullets render directly on the panel bg.
  return (
    <ol className="chat-timeline" role="presentation">
      {message.blocks.map((block) => {
        if (block.kind === 'thinking') {
          return (
            <TimelineItem key={block.id} kind="thinking">
              <span className="chat-thinking-label">Thinking</span>
              {block.text && (
                <p className="chat-thinking-text">{block.text}</p>
              )}
            </TimelineItem>
          )
        }
        if (block.kind === 'text') {
          return (
            <TimelineItem key={block.id} kind="text">
              <StreamingMarkdown text={block.text} streaming={!message.done} />
            </TimelineItem>
          )
        }
        // tool_use — minimal Sprint 2 render (full ToolBody is Sprint 3).
        return (
          <TimelineItem
            key={block.id}
            kind="tool"
            dotState={dotStateForTool(block)}
          >
            <span className="chat-tool-label">
              <strong>{block.tool}</strong>
            </span>
          </TimelineItem>
        )
      })}
    </ol>
  )
}

/**
 * Memoized assistant card. Parent (MessageList) passes the message reference
 * by selector — only this card rerenders when its message changes.
 */
export const AssistantMessageCard = memo(
  AssistantMessageCardImpl,
  (prev, next) => prev.message === next.message,
)
