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
      const api = getAgentApi()
      if (!api?.request) return

      // Continue a live Claude session with an incremental turn so context is
      // preserved (C1-2). Codex is one-shot per turn, so it always spawns.
      if (current.live && current.agentId !== 'codex') {
        const res = await api.request({ type: 'input', sessionId, content: trimmed })
        if (res && res.ok) return
        // The child was gone (NO_LIVE_SESSION) — fall through to a fresh start,
        // resuming the prior CLI session id to recover context where possible.
        store.setSessionLive(sessionId, false)
      }

      // Optimistically mark live so a rapid second send (before session-init
      // arrives) takes the input path instead of killing the just-spawned child.
      store.setSessionLive(sessionId, true)
      // PRD AC6: each turn uses the mode that was active at send time. The
      // session.permissionMode is the source of truth; opts.permissionMode
      // exists as an override for explicit per-call control.
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
    },
    [sessionId]
  )

  const cancel = useCallback<UseChatSessionResult['cancel']>(async () => {
    const api = getAgentApi()
    if (!api?.request) return
    await api.request({ type: 'cancel', sessionId })
  }, [sessionId])

  return useMemo(() => ({ session, send, cancel }), [session, send, cancel])
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
