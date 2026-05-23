import { memo } from 'react'
import { TimelineItem, type TimelineDotState } from './TimelineItem'
import { StreamingMarkdown } from './StreamingMarkdown'
import { ToolBody } from './tool-bodies'
import { basename, readPath } from './tool-bodies/types'
import { ToolApprovalGate, type ApprovalDecision } from './ToolApprovalGate'
import { useToolApproval } from '../../lib/chat/useToolApproval'
import type {
  AssistantBlock,
  AssistantMessage,
  SessionId,
  ToolCallId,
  ToolStatus,
} from '../../lib/chat/types'

type Props = {
  sessionId: SessionId
  message: AssistantMessage
}

function dotStateForTool(status: ToolStatus): TimelineDotState {
  switch (status) {
    case 'pending_approval':
      return 'amber'
    case 'running':
      return 'running'
    case 'ok':
      return 'green'
    case 'error':
    case 'denied':
      return 'red'
    case 'cancelled':
      return 'outline'
  }
}

function dotLabelForTool(status: ToolStatus): string {
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
}

type ToolBlock = Extract<AssistantBlock, { kind: 'tool_use' }>

function ToolHeader({ block }: { block: ToolBlock }) {
  const path = readPath(block.input)
  return (
    <>
      <span className="chat-tool-header-name">{block.tool}</span>
      {path && (
        <span className="chat-tool-pill" title={path}>
          {basename(path)}
        </span>
      )}
      {block.durationMs != null && block.status !== 'pending_approval' && (
        <span className="chat-tool-meta">{formatDuration(block.durationMs)}</span>
      )}
    </>
  )
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function AssistantMessageCardImpl({ sessionId, message }: Props) {
  const { decide } = useToolApproval(sessionId)
  const onDecide = (toolUseId: ToolCallId, decision: ApprovalDecision) => {
    void decide(toolUseId, decision)
  }
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
        return (
          <TimelineItem
            key={block.id}
            kind="tool"
            dotState={dotStateForTool(block.status)}
            dotLabel={dotLabelForTool(block.status)}
            header={<ToolHeader block={block} />}
          >
            <ToolBody
              toolUseId={block.id}
              tool={block.tool}
              input={block.input}
              status={block.status}
              result={block.result}
              errorMessage={block.errorMessage}
              durationMs={block.durationMs}
              snapshotSaved={block.snapshotSaved}
              snapshotTurnId={block.snapshotTurnId}
            />
            {block.status === 'pending_approval' && (
              <ToolApprovalGate
                toolUseId={block.id}
                onDecide={onDecide}
                deadlineAt={block.approvalDeadlineAt}
              />
            )}
            {block.status === 'denied' && (
              <div className="chat-approval-status" data-state="denied">
                Denied
              </div>
            )}
          </TimelineItem>
        )
      })}
    </ol>
  )
}

/**
 * Memoized assistant card. Parent (MessageList) passes the message reference
 * by selector — only this card rerenders when its message changes (or the
 * session id changes, which is rare; both are referentially-stable inputs).
 */
export const AssistantMessageCard = memo(
  AssistantMessageCardImpl,
  // Intentional reference-only check; relies on store's immutable updates per message.
  (prev, next) =>
    prev.message === next.message && prev.sessionId === next.sessionId,
)
