import { useRef } from 'react'
import { useChatStore } from '../../lib/chat/store'
import { useStickToBottom } from '../../lib/chat/hooks'
import { UserBubble } from './UserBubble'
import { AssistantMessageCard } from './AssistantMessageCard'
import type { SessionId } from '../../lib/chat/types'

type Props = {
  sessionId: SessionId
  vaultPath?: string
  onRewind?: (turnId: string) => void
}

/**
 * Scroll container for an entire chat conversation. Subscribes only to
 * `ordering` (stable across streaming) so this component does NOT rerender
 * on every token — child cards subscribe per-message.
 *
 * Virtualization deferred to Sprint 9 (per design doc §8.4).
 */
export function MessageList({ sessionId, vaultPath, onRewind }: Props) {
  const scrollRef = useRef<HTMLElement | null>(null)
  const ordering = useChatStore((s) => s.sessions[sessionId]?.ordering)
  const isStreaming = useChatStore(
    (s) => s.sessions[sessionId]?.turnState === 'streaming',
  )
  useStickToBottom(scrollRef, isStreaming ?? false)

  if (!ordering || ordering.length === 0) {
    return (
      <div
        className="chat-message-list empty"
        ref={(el) => {
          scrollRef.current = el
        }}
      >
        <EmptyState />
      </div>
    )
  }

  return (
    <ol
      ref={(el) => {
        scrollRef.current = el
      }}
      className="chat-message-list"
      role="log"
      aria-live="polite"
      aria-relevant="additions"
      aria-atomic="false"
    >
      {ordering.map((mid) => (
        <MessageRow
          key={mid}
          sessionId={sessionId}
          messageId={mid}
          vaultPath={vaultPath}
          onRewind={onRewind}
        />
      ))}
    </ol>
  )
}

function MessageRow({
  sessionId,
  messageId,
  vaultPath,
  onRewind,
}: {
  sessionId: SessionId
  messageId: string
  vaultPath?: string
  onRewind?: (turnId: string) => void
}) {
  const message = useChatStore(
    (s) => s.sessions[sessionId]?.messages[messageId],
  )
  if (!message) return null
  if (message.role === 'user') {
    return (
      <li className="chat-message-row user">
        <UserBubble
          text={message.text}
          turnId={message.turnId}
          onRewind={onRewind}
        />
      </li>
    )
  }
  if (message.role === 'assistant') {
    return (
      <li className="chat-message-row assistant" aria-busy={!message.done}>
        <AssistantMessageCard
          sessionId={sessionId}
          message={message}
          vaultPath={vaultPath}
        />
      </li>
    )
  }
  // system
  return (
    <li className="chat-message-row system">
      <div className="chat-system-text">{message.text}</div>
    </li>
  )
}

function EmptyState() {
  return (
    <div className="chat-empty-state">
      <div className="chat-empty-icon" aria-hidden="true">
        ✨
      </div>
      <h3 className="chat-empty-heading">Start a conversation</h3>
      <p className="chat-empty-sub">Ask Marvin anything about your vault</p>
    </div>
  )
}
