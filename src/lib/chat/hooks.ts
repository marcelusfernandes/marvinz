// Custom hooks for the chat UI. Co-located so components import a single
// surface (Zustand store + IPC subscription + scroll behavior).
//
// See chat-design-v1.md §8.8.

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useChatStore } from './store'
import type { Mention, Message, MessageId, PermissionMode, Session, SessionId } from './types'

function getAgentApi() {
  if (typeof window === 'undefined') return null
  return window.marvin?.agent ?? null
}

// ---------------------------------------------------------------------------
// useChatSession
// ---------------------------------------------------------------------------

export type SendOptions = {
  mentions?: Mention[]
  permissionMode?: PermissionMode
}

export type UseChatSessionResult = {
  session: Session | undefined
  send: (text: string, opts?: SendOptions) => Promise<void>
  cancel: () => Promise<void>
  /** Re-run the last user turn after an error, without duplicating the bubble (C1-4). */
  retry: () => Promise<void>
}

/**
 * Issue one turn to the agent: continue a live Claude session via `input`, or
 * spawn a fresh `start` on the first turn / after the child died (resuming the
 * prior cli session for context). Shared by send (which appends the user bubble
 * first) and retry (which reuses the existing last user message). See C1-2.
 */
async function dispatchTurn(
  sessionId: SessionId,
  current: Session,
  trimmed: string,
  opts?: SendOptions
): Promise<void> {
  const api = getAgentApi()
  if (!api?.request) return
  const store = useChatStore.getState()

  if (current.live && current.agentId !== 'codex') {
    const res = await api.request({ type: 'input', sessionId, content: trimmed })
    if (res && res.ok) return
    store.setSessionLive(sessionId, false)
  }

  store.setSessionLive(sessionId, true)
  const startRes = await api.request({
    type: 'start',
    sessionId,
    provider: current.agentId,
    prompt: trimmed,
    vaultRoot: current.vaultPath,
    permissionMode: opts?.permissionMode ?? current.permissionMode,
    resumeFromSessionId: current.cliSessionId,
  })
  if (startRes && !startRes.ok) store.setSessionLive(sessionId, false)
}

function lastUserText(session: Session): string | undefined {
  for (let i = session.ordering.length - 1; i >= 0; i--) {
    const m = session.messages[session.ordering[i]]
    if (m?.role === 'user') return m.text
  }
  return undefined
}

/**
 * Subscribes to a chat session: bridges main-process agent events into the
 * store, exposes send/cancel handlers, and returns the session snapshot.
 *
 * Cleans up the IPC listener on unmount.
 */
export function useChatSession(sessionId: SessionId): UseChatSessionResult {
  const session = useChatStore((s) => s.sessions[sessionId])

  // Bridge IPC events into the store. The callback identity is stable so we
  // only resubscribe when sessionId changes (mount/unmount semantics).
  useEffect(() => {
    const api = getAgentApi()
    if (!api?.onEvent) return
    const unsub = api.onEvent(sessionId, (ev) => {
      // AgentEvent and ChatStreamEvent are structurally equivalent; cast is safe.
      useChatStore.getState().applyStreamEvent(sessionId, ev as import('./types').ChatStreamEvent)
    })
    return () => {
      try {
        unsub()
      } catch {
        // ignore — listener may already be torn down
      }
    }
  }, [sessionId])

  const send = useCallback<UseChatSessionResult['send']>(
    async (text, opts) => {
      const trimmed = text.trim()
      if (!trimmed) return
      const store = useChatStore.getState()
      const current = store.sessions[sessionId]
      if (!current) return
      store.appendUserMessage(sessionId, trimmed)
      // PRD AC6: each turn uses the mode that was active at send time.
      await dispatchTurn(sessionId, current, trimmed, opts)
    },
    [sessionId]
  )

  const cancel = useCallback<UseChatSessionResult['cancel']>(async () => {
    const api = getAgentApi()
    if (!api?.request) return
    await api.request({ type: 'cancel', sessionId })
  }, [sessionId])

  const retry = useCallback<UseChatSessionResult['retry']>(async () => {
    const store = useChatStore.getState()
    const current = store.sessions[sessionId]
    if (!current) return
    const text = lastUserText(current)
    if (!text) return
    // Clear the error banner and re-run the last turn without re-appending the
    // user bubble (it is already in the transcript).
    store.clearError(sessionId)
    await dispatchTurn(sessionId, current, text)
  }, [sessionId])

  return useMemo(() => ({ session, send, cancel, retry }), [session, send, cancel, retry])
}

// ---------------------------------------------------------------------------
// useChatMessage
// ---------------------------------------------------------------------------

/**
 * Selector-based read of a single message. Subscribers only rerender when
 * THIS message's object reference changes (immutable updates per message
 * keep sibling messages stable).
 */
export function useChatMessage(sessionId: SessionId, messageId: MessageId): Message | undefined {
  return useChatStore((s) => s.sessions[sessionId]?.messages[messageId])
}

// ---------------------------------------------------------------------------
// useStickToBottom
// ---------------------------------------------------------------------------

const STICK_THRESHOLD_PX = 80

/**
 * Keeps a scroll container anchored to the bottom while `active` is true and
 * the user is within ~80px of the bottom. Disengages when the user scrolls
 * up; re-engages once they scroll back into the threshold.
 *
 * Re-anchors on every store update (lightweight — uses `scrollTo` only when
 * within threshold; the actual content reflow already happened).
 */
export function useStickToBottom<T extends HTMLElement>(
  ref: React.RefObject<T | null>,
  active: boolean
): void {
  const stickRef = useRef(true)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onScroll = () => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight
      stickRef.current = distance <= STICK_THRESHOLD_PX
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => el.removeEventListener('scroll', onScroll)
  }, [ref])

  useEffect(() => {
    if (!active) return
    const unsub = useChatStore.subscribe(() => {
      const el = ref.current
      if (!el || !stickRef.current) return
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight
      if (distance <= STICK_THRESHOLD_PX) {
        el.scrollTo({ top: el.scrollHeight })
      }
    })
    return unsub
  }, [ref, active])
}
