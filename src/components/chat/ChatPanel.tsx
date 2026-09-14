import { useEffect } from 'react'
import { useChatStore } from '../../lib/chat/store'
import { useChatSession } from '../../lib/chat/hooks'
import { ChatHeader } from './ChatHeader'
import { MessageList } from './MessageList'
import { Composer } from './Composer'
import { ChatErrorBanner } from './ChatErrorBanner'
import type { Provider, SessionId } from '../../lib/chat/types'
import { useAppContext } from '../../context/AppContext'
import { marvin } from '../../lib/marvinApi'

export type TurnSummary = {
  turnId: string
  fileNames: string[]
}

type Props = {
  sessionId: SessionId
  provider: Provider
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
export function ChatPanel({ sessionId, provider, onRewind, onTurnSummary }: Props) {
  const vaultPath = useAppContext().vaultPath ?? ''
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
    // Existence check preserved (not just an onEvent presence check on the
    // typed facade) so this stays a no-op against an older preload build,
    // same as useChatSession's and useToolApproval's getAgentApi() guards.
    if (!window.marvin?.agent?.onEvent) return
    const unsub = marvin.agent.onEvent(sessionId, (ev) => {
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

  const { session, send, cancel, retry } = useChatSession(sessionId)

  if (!session) return null

  // A tool call awaiting approval is still an in-flight turn: sends must queue
  // (a second `input` on the live stdin would interleave) and Stop must work.
  const isStreaming = session.turnState === 'streaming' || session.turnState === 'awaiting_approval'
  const error = session.turnState === 'error' ? session.lastError : undefined

  return (
    <div className="chat-panel">
      <ChatHeader provider={provider} />
      <div className="chat-panel-body">
        <MessageList sessionId={sessionId} onRewind={onRewind} />
      </div>
      {error && (
        <ChatErrorBanner message={error.message} code={error.code} onRetry={() => void retry()} />
      )}
      <div className="chat-panel-composer">
        <Composer sessionId={sessionId} onSend={send} onCancel={cancel} isStreaming={isStreaming} />
      </div>
    </div>
  )
}
