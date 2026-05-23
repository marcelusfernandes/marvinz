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
}

function emptySession(
  id: SessionId,
  agentId: Provider,
  vaultPath: string,
): Session {
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
  }
}

function withSession(
  state: { sessions: Record<SessionId, Session> },
  sid: SessionId,
  update: (s: Session) => Session,
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
  patch: (b: Extract<AssistantBlock, { kind: 'tool_use' }>) => AssistantBlock,
): Message {
  if (msg.role !== 'assistant') return msg
  const idx = msg.blocks.findIndex(
    (b) => b.kind === 'tool_use' && b.id === toolUseId,
  )
  if (idx === -1) return msg
  const block = msg.blocks[idx]
  if (block.kind !== 'tool_use') return msg
  const next = patch(block)
  if (next === block) return msg
  const blocks = msg.blocks.slice()
  blocks[idx] = next
  return { ...msg, blocks }
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
        state.activeSessionId === id
          ? (Object.keys(rest)[0] ?? null)
          : state.activeSessionId
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
      })),
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
        ev.seq,
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
            b.status === 'pending_approval' ? { ...b, status: nextStatus } : b,
          )
          if (next !== m) {
            messages[mid] = next
            changed = true
          }
        }
        if (!changed) return s
        const pendingApprovals = s.pendingApprovals.filter(
          (id) => id !== toolCallId,
        )
        return {
          ...s,
          messages,
          pendingApprovals,
          turnState: pendingApprovals.length === 0 ? 'streaming' : s.turnState,
        }
      }),
    ),

  setComposerDraft: (sid, draft) =>
    set((state) =>
      withSession(state, sid, (s) =>
        s.composer.draft === draft
          ? s
          : { ...s, composer: { ...s.composer, draft } },
      ),
    ),

  setComposerMentions: (sid, mentions) =>
    set((state) =>
      withSession(state, sid, (s) => ({
        ...s,
        composer: { ...s.composer, mentions },
      })),
    ),
}))

// ---------- event reducer ----------

function applyEvent(s: Session, ev: ChatStreamEvent): Session {
  switch (ev.type) {
    case 'session-init':
      return s.cliSessionId === ev.cliSessionId
        ? s
        : { ...s, cliSessionId: ev.cliSessionId }

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
      }
      return {
        ...s,
        messages: { ...s.messages, [ev.messageId]: appendBlock(target, block) },
      }
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
          errorMessage:
            ev.isError && typeof ev.output === 'string'
              ? ev.output
              : b.errorMessage,
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
      const existing = last.blocks.find(
        (b) => b.kind === 'tool_use' && b.id === ev.toolUseId,
      )
      const updated = existing
        ? updateToolBlock(last, ev.toolUseId, (b) =>
            b.status === 'pending_approval'
              ? b
              : { ...b, status: 'pending_approval' },
          )
        : appendBlock(last, {
            kind: 'tool_use',
            id: ev.toolUseId,
            tool: ev.toolName,
            input: ev.input,
            status: 'pending_approval',
          })
      const pendingApprovals = s.pendingApprovals.includes(ev.toolUseId)
        ? s.pendingApprovals
        : [...s.pendingApprovals, ev.toolUseId]
      return {
        ...s,
        messages: { ...s.messages, [last.id]: updated },
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
      }
    }

    case 'turn-result':
      return {
        ...s,
        tokenUsage: {
          inputTokens: s.tokenUsage.inputTokens + ev.usage.inputTokens,
          outputTokens: s.tokenUsage.outputTokens + ev.usage.outputTokens,
          cacheReadTokens:
            (s.tokenUsage.cacheReadTokens ?? 0) +
            (ev.usage.cacheReadTokens ?? 0),
          cacheWriteTokens:
            (s.tokenUsage.cacheWriteTokens ?? 0) +
            (ev.usage.cacheWriteTokens ?? 0),
        },
        turnState: s.pendingApprovals.length > 0 ? 'awaiting_approval' : 'idle',
      }

    case 'error':
    case 'crashed':
      return { ...s, turnState: 'error' }
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

function keyOf(
  sid: SessionId,
  mid: MessageId,
  kind: DeltaKind,
): DeltaKey {
  return `${sid}:${mid}:${kind}` as DeltaKey
}

function pushStreamDelta(
  sid: SessionId,
  mid: MessageId,
  kind: DeltaKind,
  delta: string,
  seq: number,
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
        (b) =>
          (b.kind === 'text' || b.kind === 'thinking') &&
          b.id === d.blockId,
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
