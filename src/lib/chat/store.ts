// Single Zustand store for chat sessions. Streaming hot path lives OUTSIDE
// React: text/thinking deltas append to a mutable Map<…> buffer and a single
// rAF coalescer flushes them into the store at ~one commit per frame.
// Components subscribe per-message with shallow equality so only the
// streaming card rerenders.
//
// Reference: chat-design-v1.md §8.3. Pattern used by Linear, Vercel AI SDK,
// Claude.ai.

import { create } from 'zustand'
import { shallow } from 'zustand/shallow'
import { nanoid } from 'nanoid'
import type {
  AssistantBlock,
  AssistantMessage,
  ChatStreamEvent,
  Mention,
  Message,
  MessageId,
  PermissionMode,
  Provider,
  Session,
  SessionId,
  ToolCallId,
  ToolStatus,
} from './types'

type ChatStore = {
  sessions: Record<SessionId, Session>
  activeSessionId: SessionId | null

  startSession: (id: SessionId, agentId: Provider, vaultPath: string) => void
  closeSession: (id: SessionId) => void
  setActiveSession: (id: SessionId | null) => void

  appendUserMessage: (sid: SessionId, text: string) => MessageId
  /** Apply a non-delta stream event synchronously through the reducer. */
  applyStreamEvent: (sid: SessionId, ev: ChatStreamEvent) => void

  approveTool: (sid: SessionId, toolCallId: ToolCallId, approved: boolean) => void
  setComposerDraft: (sid: SessionId, draft: string) => void
  setComposerMentions: (sid: SessionId, mentions: Mention[]) => void
  setPermissionMode: (sid: SessionId, mode: PermissionMode) => void
  /** Mark whether a live CLI child is running for this session (C1-2). */
  setSessionLive: (sid: SessionId, live: boolean) => void
  /** Clear the error banner and, if errored, re-enter streaming (C1-4 retry). */
  clearError: (sid: SessionId) => void
  /** Queue a follow-up message to send when the current turn ends (C1-3). */
  enqueueMessage: (sid: SessionId, text: string) => void
  /** Remove and ignore the head of the queue (after it has been dispatched). */
  dequeueMessage: (sid: SessionId) => void
  /** Mark the turn as cancelling (drives the "Stopping…" state) (C1-5). */
  setCancelling: (sid: SessionId, cancelling: boolean) => void
  /** Force a hung turn back to idle if the terminating event never arrived (C1-5). */
  forceIdle: (sid: SessionId) => void
}

function emptySession(id: SessionId, agentId: Provider, vaultPath: string): Session {
  return {
    id,
    agentId,
    vaultPath,
    messages: {},
    ordering: [],
    pendingApprovals: [],
    turnState: 'idle',
    tokenUsage: { inputTokens: 0, outputTokens: 0 },
    composer: { draft: '', mentions: [] },
    permissionMode: 'default',
  }
}

function withSession(
  state: { sessions: Record<SessionId, Session> },
  sid: SessionId,
  update: (s: Session) => Session
): Partial<ChatStore> {
  const current = state.sessions[sid]
  if (!current) return {}
  const next = update(current)
  if (next === current) return {}
  return { sessions: { ...state.sessions, [sid]: next } }
}

function appendBlock(msg: Message, block: AssistantBlock): Message {
  if (msg.role !== 'assistant') return msg
  return { ...msg, blocks: [...msg.blocks, block] }
}

function updateToolBlock(
  msg: Message,
  toolUseId: ToolCallId,
  patch: (b: Extract<AssistantBlock, { kind: 'tool_use' }>) => AssistantBlock
): Message {
  if (msg.role !== 'assistant') return msg
  const idx = msg.blocks.findIndex((b) => b.kind === 'tool_use' && b.id === toolUseId)
  if (idx === -1) return msg
  const block = msg.blocks[idx]
  if (block.kind !== 'tool_use') return msg
  const next = patch(block)
  if (next === block) return msg
  const blocks = msg.blocks.slice()
  blocks[idx] = next
  return { ...msg, blocks }
}

/**
 * Walk ordering newest → oldest and tag the most recent user message that
 * doesn't yet have a turnId. Returns the same `messages` reference if no
 * change is needed (so callers can shallow-compare for early-out).
 */
function backfillUserTurnId(
  ordering: MessageId[],
  messages: Record<MessageId, Message>,
  turnId: string
): Record<MessageId, Message> {
  for (let i = ordering.length - 1; i >= 0; i--) {
    const mid = ordering[i]
    const m = messages[mid]
    if (!m || m.role !== 'user') continue
    if (m.turnId) return messages
    return { ...messages, [mid]: { ...m, turnId } }
  }
  return messages
}

export const useChatStore = create<ChatStore>((set) => ({
  sessions: {},
  activeSessionId: null,

  startSession: (id, agentId, vaultPath) =>
    set((state) => {
      if (state.sessions[id]) {
        return { activeSessionId: id }
      }
      return {
        sessions: { ...state.sessions, [id]: emptySession(id, agentId, vaultPath) },
        activeSessionId: id,
      }
    }),

  closeSession: (id) =>
    set((state) => {
      if (!state.sessions[id]) return {}
      const rest = { ...state.sessions }
      delete rest[id]
      const nextActive =
        state.activeSessionId === id ? (Object.keys(rest)[0] ?? null) : state.activeSessionId
      return { sessions: rest, activeSessionId: nextActive }
    }),

  setActiveSession: (id) => set({ activeSessionId: id }),

  appendUserMessage: (sid, text) => {
    const messageId = `m-${nanoid(10)}`
    set((state) =>
      withSession(state, sid, (s) => ({
        ...s,
        messages: {
          ...s.messages,
          [messageId]: {
            id: messageId,
            role: 'user',
            text,
            createdAt: Date.now(),
          },
        },
        ordering: [...s.ordering, messageId],
        turnState: 'streaming',
        // A new turn clears any prior error banner (C1-4).
        lastError: undefined,
      }))
    )
    return messageId
  },

  applyStreamEvent: (sid, ev) => {
    if (ev.type === 'text-delta' || ev.type === 'thinking-delta') {
      // Deltas go through the ref buffer + rAF coalescer.
      pushStreamDelta(
        ev.sessionId,
        ev.messageId,
        ev.type === 'text-delta' ? 'text' : 'thinking',
        ev.delta,
        ev.seq
      )
      return
    }
    if (ev.type === 'message-end' && pendingDeltas.size > 0) {
      flushPendingDeltas()
    }
    set((state) => withSession(state, sid, (s) => applyEvent(s, ev)))
  },

  approveTool: (sid, toolCallId, approved) =>
    set((state) =>
      withSession(state, sid, (s) => {
        const nextStatus: ToolStatus = approved ? 'running' : 'denied'
        const messages = { ...s.messages }
        let changed = false
        for (const mid of s.ordering) {
          const m = messages[mid]
          if (!m || m.role !== 'assistant') continue
          const next = updateToolBlock(m, toolCallId, (b) =>
            b.status === 'pending_approval' ? { ...b, status: nextStatus } : b
          )
          if (next !== m) {
            messages[mid] = next
            changed = true
          }
        }
        if (!changed) return s
        const pendingApprovals = s.pendingApprovals.filter((id) => id !== toolCallId)
        return {
          ...s,
          messages,
          pendingApprovals,
          turnState: pendingApprovals.length === 0 ? 'streaming' : s.turnState,
        }
      })
    ),

  setComposerDraft: (sid, draft) =>
    set((state) =>
      withSession(state, sid, (s) =>
        s.composer.draft === draft ? s : { ...s, composer: { ...s.composer, draft } }
      )
    ),

  setComposerMentions: (sid, mentions) =>
    set((state) =>
      withSession(state, sid, (s) => ({
        ...s,
        composer: { ...s.composer, mentions },
      }))
    ),

  setPermissionMode: (sid, mode) =>
    set((state) =>
      withSession(state, sid, (s) =>
        s.permissionMode === mode ? s : { ...s, permissionMode: mode }
      )
    ),

  setSessionLive: (sid, live) =>
    set((state) => withSession(state, sid, (s) => (s.live === live ? s : { ...s, live }))),

  clearError: (sid) =>
    set((state) =>
      withSession(state, sid, (s) =>
        s.lastError === undefined && s.turnState !== 'error'
          ? s
          : {
              ...s,
              lastError: undefined,
              // A retry re-enters streaming; leave non-error states untouched.
              turnState: s.turnState === 'error' ? 'streaming' : s.turnState,
            }
      )
    ),

  enqueueMessage: (sid, text) =>
    set((state) => withSession(state, sid, (s) => ({ ...s, queue: [...(s.queue ?? []), text] }))),

  dequeueMessage: (sid) =>
    set((state) =>
      withSession(state, sid, (s) =>
        s.queue && s.queue.length > 0 ? { ...s, queue: s.queue.slice(1) } : s
      )
    ),

  setCancelling: (sid, cancelling) =>
    set((state) =>
      withSession(state, sid, (s) => (s.cancelling === cancelling ? s : { ...s, cancelling }))
    ),

  forceIdle: (sid) =>
    set((state) =>
      withSession(state, sid, (s) =>
        s.turnState === 'idle' && !s.cancelling ? s : { ...s, turnState: 'idle', cancelling: false }
      )
    ),
}))

// ---------- event reducer ----------

function applyEvent(s: Session, ev: ChatStreamEvent): Session {
  switch (ev.type) {
    case 'session-init':
      // The CLI confirmed a live child. Record its id and mark the session live
      // so follow-up sends continue it via `input` rather than respawning.
      return s.cliSessionId === ev.cliSessionId && s.live
        ? s
        : { ...s, cliSessionId: ev.cliSessionId, live: true }

    case 'message-start': {
      if (ev.role !== 'assistant') return s
      if (s.messages[ev.messageId]) return s
      const msg: AssistantMessage = {
        id: ev.messageId,
        role: 'assistant',
        blocks: [],
        createdAt: Date.now(),
        done: false,
      }
      return {
        ...s,
        messages: { ...s.messages, [ev.messageId]: msg },
        ordering: [...s.ordering, ev.messageId],
        turnState: 'streaming',
      }
    }

    case 'text-delta':
    case 'thinking-delta':
      // Handled by the ref buffer; never routed through the reducer.
      return s

    case 'tool-use': {
      const target = s.messages[ev.messageId]
      if (!target || target.role !== 'assistant') return s
      if (target.blocks.some((b) => b.kind === 'tool_use' && b.id === ev.toolUseId)) {
        return s
      }
      const block: AssistantBlock = {
        kind: 'tool_use',
        id: ev.toolUseId,
        tool: ev.name,
        input: ev.input,
        status: 'running',
        snapshotSaved: ev.snapshotSaved,
        snapshotTurnId: ev.snapshotTurnId,
      }
      const messages = { ...s.messages, [ev.messageId]: appendBlock(target, block) }
      const withTurnId = ev.snapshotTurnId
        ? backfillUserTurnId(s.ordering, messages, ev.snapshotTurnId)
        : messages
      return { ...s, messages: withTurnId }
    }

    case 'tool-result': {
      const messages = { ...s.messages }
      let changed = false
      for (const mid of s.ordering) {
        const m = messages[mid]
        if (!m || m.role !== 'assistant') continue
        const next = updateToolBlock(m, ev.toolUseId, (b) => ({
          ...b,
          status: ev.isError ? 'error' : 'ok',
          result: ev.output,
          durationMs: ev.durationMs,
          errorMessage: ev.isError && typeof ev.output === 'string' ? ev.output : b.errorMessage,
        }))
        if (next !== m) {
          messages[mid] = next
          changed = true
        }
      }
      return changed ? { ...s, messages } : s
    }

    case 'permission-request': {
      // Mark the last assistant message's tool block as pending_approval;
      // create it if the tool-use event hasn't arrived yet.
      const lastId = s.ordering[s.ordering.length - 1]
      const last = lastId ? s.messages[lastId] : undefined
      if (!last || last.role !== 'assistant') return s
      const deadline = typeof ev.timeoutMs === 'number' ? Date.now() + ev.timeoutMs : undefined
      const existing = last.blocks.find((b) => b.kind === 'tool_use' && b.id === ev.toolUseId)
      const updated = existing
        ? updateToolBlock(last, ev.toolUseId, (b) =>
            b.status === 'pending_approval' &&
            b.approvalDeadlineAt === deadline &&
            b.snapshotSaved === ev.snapshotSaved &&
            b.snapshotTurnId === ev.snapshotTurnId
              ? b
              : {
                  ...b,
                  status: 'pending_approval',
                  approvalDeadlineAt: deadline,
                  snapshotSaved: ev.snapshotSaved,
                  snapshotTurnId: ev.snapshotTurnId,
                }
          )
        : appendBlock(last, {
            kind: 'tool_use',
            id: ev.toolUseId,
            tool: ev.toolName,
            input: ev.input,
            status: 'pending_approval',
            approvalDeadlineAt: deadline,
            snapshotSaved: ev.snapshotSaved,
            snapshotTurnId: ev.snapshotTurnId,
          })
      const pendingApprovals = s.pendingApprovals.includes(ev.toolUseId)
        ? s.pendingApprovals
        : [...s.pendingApprovals, ev.toolUseId]
      const baseMessages = { ...s.messages, [last.id]: updated }
      const messages = ev.snapshotTurnId
        ? backfillUserTurnId(s.ordering, baseMessages, ev.snapshotTurnId)
        : baseMessages
      return {
        ...s,
        messages,
        pendingApprovals,
        turnState: 'awaiting_approval',
      }
    }

    case 'message-end': {
      const target = s.messages[ev.messageId]
      if (!target || target.role !== 'assistant') return s
      if (target.done) return s
      const turnState =
        ev.stopReason === 'tool_use'
          ? 'awaiting_approval'
          : s.pendingApprovals.length > 0
            ? 'awaiting_approval'
            : 'idle'
      return {
        ...s,
        messages: { ...s.messages, [ev.messageId]: { ...target, done: true } },
        turnState,
        cancelling: false,
      }
    }

    case 'turn-snapshot-summary': {
      // Idempotent fallback — usually the tool-use event has already tagged
      // the user message via backfillUserTurnId. Keep this so non-Edit turns
      // that still touch files (rare) still get the Rewind affordance.
      const messages = backfillUserTurnId(s.ordering, s.messages, ev.turnId)
      return messages === s.messages ? s : { ...s, messages }
    }

    case 'snapshot-warning':
      // Surfaced via toast in ChatPanel, not reduced into session state.
      return s

    case 'turn-result':
      return {
        ...s,
        tokenUsage: {
          inputTokens: s.tokenUsage.inputTokens + ev.usage.inputTokens,
          outputTokens: s.tokenUsage.outputTokens + ev.usage.outputTokens,
          cacheReadTokens: (s.tokenUsage.cacheReadTokens ?? 0) + (ev.usage.cacheReadTokens ?? 0),
          cacheWriteTokens: (s.tokenUsage.cacheWriteTokens ?? 0) + (ev.usage.cacheWriteTokens ?? 0),
        },
        turnState: s.pendingApprovals.length > 0 ? 'awaiting_approval' : 'idle',
        cancelling: false,
      }

    case 'crashed':
      // The child is gone — the next send must spawn a fresh session.
      return {
        ...s,
        turnState: 'error',
        live: false,
        cancelling: false,
        lastError: {
          message:
            ev.exitCode != null
              ? `The agent stopped unexpectedly (exit ${ev.exitCode}).`
              : 'The agent stopped unexpectedly.',
          recoverable: false,
        },
      }

    case 'error':
      // Unrecoverable errors kill the child; recoverable ones (e.g. a single
      // malformed stream line) leave the session live. Surface both as a banner.
      return {
        ...s,
        turnState: 'error',
        live: ev.recoverable ? s.live : false,
        lastError: { message: ev.message, recoverable: ev.recoverable, code: ev.code },
        cancelling: false,
      }
  }
}

// ---------- ref-buffer + rAF coalescer ----------

type DeltaKind = 'text' | 'thinking'
type DeltaKey = `${SessionId}:${MessageId}:${DeltaKind}`

type PendingDelta = {
  sessionId: SessionId
  messageId: MessageId
  blockId: string
  kind: DeltaKind
  text: string
  /** Highest seq merged into this pending buffer (idempotency). */
  lastSeq: number
}

const pendingDeltas = new Map<DeltaKey, PendingDelta>()
/** Sticky block id per (session, message, kind) — survives flushes. */
const blockIdByKey = new Map<DeltaKey, string>()
/** Highest seq committed to the store per key (cross-flush idempotency). */
const appliedSeq = new Map<DeltaKey, number>()

let rafHandle: number | null = null
let scheduleRaf: (cb: () => void) => number = (cb) =>
  typeof requestAnimationFrame !== 'undefined'
    ? requestAnimationFrame(cb)
    : (setTimeout(cb, 16) as unknown as number)
let cancelRaf: (handle: number) => void = (handle) => {
  if (typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(handle)
  else clearTimeout(handle as unknown as ReturnType<typeof setTimeout>)
}

/** Test seam — override the scheduler. */
export function setStreamingScheduler(opts: {
  schedule: (cb: () => void) => number
  cancel: (handle: number) => void
}) {
  scheduleRaf = opts.schedule
  cancelRaf = opts.cancel
}

/** Drop buffered deltas without flushing (test/cleanup). */
export function resetStreamingBuffers() {
  pendingDeltas.clear()
  blockIdByKey.clear()
  appliedSeq.clear()
  if (rafHandle != null) {
    cancelRaf(rafHandle)
    rafHandle = null
  }
}

function keyOf(sid: SessionId, mid: MessageId, kind: DeltaKind): DeltaKey {
  return `${sid}:${mid}:${kind}` as DeltaKey
}

function pushStreamDelta(
  sid: SessionId,
  mid: MessageId,
  kind: DeltaKind,
  delta: string,
  seq: number
) {
  const key = keyOf(sid, mid, kind)
  const lastApplied = appliedSeq.get(key)
  if (lastApplied != null && seq <= lastApplied) return

  let blockId = blockIdByKey.get(key)
  if (!blockId) {
    blockId = `b-${nanoid(8)}`
    blockIdByKey.set(key, blockId)
  }
  const existing = pendingDeltas.get(key)
  if (existing) {
    if (seq <= existing.lastSeq) return
    existing.text += delta
    existing.lastSeq = seq
  } else {
    pendingDeltas.set(key, {
      sessionId: sid,
      messageId: mid,
      blockId,
      kind,
      text: delta,
      lastSeq: seq,
    })
  }
  if (rafHandle == null) {
    rafHandle = scheduleRaf(flushPendingDeltas)
  }
}

/** Flush all buffered deltas into the store. */
export function flushPendingDeltas() {
  if (rafHandle != null) {
    cancelRaf(rafHandle)
    rafHandle = null
  }
  if (pendingDeltas.size === 0) return
  const drained = Array.from(pendingDeltas.values())
  pendingDeltas.clear()

  useChatStore.setState((state) => {
    const sessions = { ...state.sessions }
    let anyChanged = false
    for (const d of drained) {
      const s = sessions[d.sessionId]
      if (!s) continue
      const m = s.messages[d.messageId]
      if (!m || m.role !== 'assistant') continue
      const existingIdx = m.blocks.findIndex(
        (b) => (b.kind === 'text' || b.kind === 'thinking') && b.id === d.blockId
      )
      let nextMsg: AssistantMessage
      if (existingIdx === -1) {
        const newBlock: AssistantBlock =
          d.kind === 'thinking'
            ? { kind: 'thinking', id: d.blockId, text: d.text }
            : { kind: 'text', id: d.blockId, text: d.text }
        nextMsg = { ...m, blocks: [...m.blocks, newBlock] }
      } else {
        const block = m.blocks[existingIdx]
        if (block.kind !== 'text' && block.kind !== 'thinking') continue
        const blocks = m.blocks.slice()
        blocks[existingIdx] = { ...block, text: block.text + d.text }
        nextMsg = { ...m, blocks }
      }
      sessions[d.sessionId] = {
        ...s,
        messages: { ...s.messages, [d.messageId]: nextMsg },
      }
      appliedSeq.set(keyOf(d.sessionId, d.messageId, d.kind), d.lastSeq)
      anyChanged = true
    }
    return anyChanged ? { sessions } : {}
  })
}

/**
 * IPC entry point. Delegates to the store: deltas hit the ref buffer; the
 * rest go through the immutable reducer. Equivalent to
 * `useChatStore.getState().applyStreamEvent(ev.sessionId, ev)`, kept as a
 * separate export to make the streaming hot-path call site explicit.
 */
export function dispatchStreamEvent(ev: ChatStreamEvent) {
  useChatStore.getState().applyStreamEvent(ev.sessionId, ev)
}

export { shallow }
