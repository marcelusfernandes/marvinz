// Seeds the demo's Claude chat with a complete conversation as INITIAL state,
// so the live demo opens showing the full exchange (assistant reply + a
// write_file tool call awaiting approval) instead of the empty "Start a
// conversation" placeholder.
//
// Why a direct store write rather than replaying agent.onEvent: the streaming
// path (agent.onEvent -> hook -> applyStreamEvent) doesn't materialise messages
// in this embedded build, but a direct write to the chat store renders reliably
// (same path appendUserMessage uses). We build the messages and set them on the
// store via its public setState API — additions in src/demo only, nothing under
// src/lib/chat is modified.

import { useChatStore } from '../lib/chat/store'
import type {
  AssistantMessage,
  Message,
  MessageId,
  Session,
  ToolCallId,
  UserMessage,
} from '../lib/chat/types'

const USER_TEXT = 'Record the file-level patch decision in research-notes.md and snapshot it.'

const ASSISTANT_TEXT =
  'Updated research-notes.md with the file-level patch decision. Snapshot saved at ' +
  '.marvin/snapshots/2026-06-09T14-22.'

/**
 * Write a finished user turn + an assistant reply whose write_file tool call is
 * pending approval (renders the Allow/Deny gate) into the given session.
 * Idempotent: a second call with the same session is a no-op.
 */
export function seedDemoConversation(sessionId: string) {
  const userId: MessageId = `${sessionId}-u1`
  const assistantId: MessageId = `${sessionId}-a1`
  const toolId: ToolCallId = `${sessionId}-t1`

  const user: UserMessage = {
    id: userId,
    role: 'user',
    text: USER_TEXT,
    createdAt: Date.now(),
    turnId: 'demo-turn-1',
  }

  const assistant: AssistantMessage = {
    id: assistantId,
    role: 'assistant',
    createdAt: Date.now(),
    done: true,
    blocks: [
      { kind: 'text', id: `${assistantId}-text`, text: ASSISTANT_TEXT },
      {
        kind: 'tool_use',
        id: toolId,
        tool: 'write_file',
        input: { path: 'research-notes.md' },
        status: 'pending_approval',
        snapshotSaved: true,
        snapshotTurnId: 'demo-turn-1',
      },
    ],
  }

  useChatStore.setState((state) => {
    const session = state.sessions[sessionId]
    if (!session) return {}
    // Already seeded — don't duplicate.
    if (session.ordering.includes(assistantId)) return {}

    const messages: Record<MessageId, Message> = {
      ...session.messages,
      [userId]: user,
      [assistantId]: assistant,
    }
    const next: Session = {
      ...session,
      messages,
      ordering: [...session.ordering, userId, assistantId],
      pendingApprovals: session.pendingApprovals.includes(toolId)
        ? session.pendingApprovals
        : [...session.pendingApprovals, toolId],
      turnState: 'awaiting_approval',
    }
    return { sessions: { ...state.sessions, [sessionId]: next } }
  })
}
