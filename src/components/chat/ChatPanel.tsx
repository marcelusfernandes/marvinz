import { useEffect } from 'react'
import { useChatStore } from '../../lib/chat/store'
import { useChatSession } from '../../lib/chat/hooks'
import { ChatHeader } from './ChatHeader'
import { MessageList } from './MessageList'
import { Composer } from './Composer'
import type { Provider, SessionId } from '../../lib/chat/types'

export type TurnSummary = {
  turnId: string
  fileNames: string[]
}

type Props = {
  sessionId: SessionId
  provider: Provider
  vaultPath: string
  /** Open SnapshotPanel pre-selected to this turn id (from UserBubble). */
  onRewind?: (turnId: string) => void
  /** Fires when a chat turn finishes with >=1 Edit/Write (drives SnapshotToast). */
  onTurnSummary?: (summary: TurnSummary) => void
}

/**
 * Pane shell that hosts a single chat session. Composes header + message
 * list + composer, all driven by the Zustand store keyed by sessionId.
 *
 * Designed to be embedded by AgentsPane as a tab body (replacing
 * AgentTerminal when the per-tab mode is "chat").
 */
export function ChatPanel({ sessionId, provider, vaultPath, onRewind, onTurnSummary }: Props) {
  const exists = useChatStore((s) => !!s.sessions[sessionId])
  const startSession = useChatStore((s) => s.startSession)

  // Idempotent — if the session already exists, this is a no-op.
  useEffect(() => {
    if (!exists) {
      startSession(sessionId, provider, vaultPath)
    }
  }, [exists, sessionId, provider, vaultPath, startSession])

  // Side-effect listener for turn-snapshot-summary — feeds the parent's
  // SnapshotToast. Runs in parallel to useChatSession's store bridge; main
  // emits the same event to every active onEvent subscriber.
  useEffect(() => {
    if (!onTurnSummary) return
    const w = window as unknown as {
      marvin?: {
        agent?: {
          onEvent?: (
            sid: string,
            cb: (ev: { type: string; turnId?: string; fileNames?: string[] }) => void
          ) => () => void
        }
      }
    }
    const api = w.marvin?.agent
    if (!api?.onEvent) return
    const unsub = api.onEvent(sessionId, (ev) => {
      if (
        ev.type === 'turn-snapshot-summary' &&
        typeof ev.turnId === 'string' &&
        Array.isArray(ev.fileNames) &&
        ev.fileNames.length > 0
      ) {
        onTurnSummary({ turnId: ev.turnId, fileNames: ev.fileNames })
      }
    })
    return () => {
      try {
        unsub()
      } catch {
        // ignore
      }
    }
  }, [sessionId, onTurnSummary])

  const { session, send, cancel } = useChatSession(sessionId)

  if (!session) return null

  const isStreaming = session.turnState === 'streaming'

  return (
    <div className="chat-panel">
      <ChatHeader provider={provider} />
      <div className="chat-panel-body">
        <MessageList sessionId={sessionId} onRewind={onRewind} />
      </div>
      <div className="chat-panel-composer">
        <Composer
          sessionId={sessionId}
          onSend={send}
          onCancel={cancel}
          isStreaming={isStreaming}
          vaultPath={vaultPath}
        />
      </div>
    </div>
  )
}
