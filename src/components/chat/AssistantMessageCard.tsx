import { memo } from 'react'
import { TimelineItem, type TimelineDotState } from './TimelineItem'
import { StreamingMarkdown } from './StreamingMarkdown'
import { ToolBody } from './tool-bodies'
import { basename, readPath, toolStatusLabel } from './tool-bodies/types'
import { ToolApprovalGate, type ApprovalDecision } from './ToolApprovalGate'
import { useToolApproval } from '../../lib/chat/useToolApproval'
import { useChatStore } from '../../lib/chat/store'
import type { MenuItemSpec } from '../../types'
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

function messageText(message: AssistantMessage): string {
  return message.blocks
    .filter((b) => b.kind === 'text')
    .map((b) => (b as Extract<AssistantBlock, { kind: 'text' }>).text)
    .join('\n\n')
    .trim()
}

function AssistantMessageCardImpl({ sessionId, message }: Props) {
  const { decide } = useToolApproval(sessionId)
  const onDecide = (toolUseId: ToolCallId, decision: ApprovalDecision) => {
    void decide(toolUseId, decision)
  }
  const handleContextMenu = async (e: React.MouseEvent<HTMLOListElement>) => {
    e.preventDefault()
    const selection = window.getSelection()?.toString() ?? ''
    const hasSelection = selection.length > 0
    const items: MenuItemSpec[] = [
      {
        kind: 'item',
        id: 'copy',
        label: hasSelection ? 'Copy Selection' : 'Copy Message',
      },
      { kind: 'item', id: 'quote', label: 'Quote in Reply' },
      { kind: 'separator' },
      {
        kind: 'item',
        id: 'rewind',
        label: 'Rewind to Here',
        enabled: false,
      },
    ]
    const action = await window.marvin.app.showContextMenu(items)
    if (!action) return
    const payload = hasSelection ? selection : messageText(message)
    switch (action) {
      case 'copy':
        await window.marvin.editor.writeClipboard(payload)
        break
      case 'quote': {
        const quoted = payload
          .split('\n')
          .map((line) => `> ${line}`)
          .join('\n')
        const store = useChatStore.getState()
        const current = store.sessions[sessionId]?.composer.draft ?? ''
        const next = current ? `${quoted}\n\n${current}` : `${quoted}\n\n`
        store.setComposerDraft(sessionId, next)
        break
      }
    }
  }
  return (
    <ol className="chat-timeline" role="presentation" onContextMenu={handleContextMenu}>
      {message.blocks.map((block) => {
        if (block.kind === 'thinking') {
          return (
            <TimelineItem key={block.id} kind="thinking">
              <span className="chat-thinking-label">Thinking</span>
              {block.text && <p className="chat-thinking-text">{block.text}</p>}
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
            dotLabel={toolStatusLabel(block.status)}
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
  (prev, next) => prev.message === next.message && prev.sessionId === next.sessionId
)
