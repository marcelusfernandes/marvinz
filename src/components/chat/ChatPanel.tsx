import { useEffect } from 'react'
import { useChatStore } from '../../lib/chat/store'
import { useChatSession } from '../../lib/chat/hooks'
import { ChatHeader } from './ChatHeader'
import { MessageList } from './MessageList'
import { Composer } from './Composer'
import type { Provider, SessionId } from '../../lib/chat/types'

type Props = {
  sessionId: SessionId
  provider: Provider
  vaultPath: string
}

/**
 * Pane shell that hosts a single chat session. Composes header + message
 * list + composer, all driven by the Zustand store keyed by sessionId.
 *
 * Designed to be embedded by AgentsPane as a tab body (replacing
 * AgentTerminal when the per-tab mode is "chat").
 */
export function ChatPanel({ sessionId, provider, vaultPath }: Props) {
  const exists = useChatStore((s) => !!s.sessions[sessionId])
  const startSession = useChatStore((s) => s.startSession)

  // Idempotent — if the session already exists, this is a no-op.
  useEffect(() => {
    if (!exists) {
      startSession(sessionId, provider, vaultPath)
    }
  }, [exists, sessionId, provider, vaultPath, startSession])

  const { session, send, cancel } = useChatSession(sessionId)

  if (!session) return null

  const isStreaming = session.turnState === 'streaming'

  return (
    <div className="chat-panel">
      <ChatHeader provider={provider} />
      <div className="chat-panel-body">
        <MessageList sessionId={sessionId} />
      </div>
      <div className="chat-panel-composer">
        <Composer
          sessionId={sessionId}
          onSend={send}
          onCancel={cancel}
          isStreaming={isStreaming}
        />
      </div>
    </div>
  )
}
