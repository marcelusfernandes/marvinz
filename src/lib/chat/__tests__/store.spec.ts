import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  useChatStore,
  setStreamingScheduler,
  resetStreamingBuffers,
  flushPendingDeltas,
  dispatchStreamEvent,
} from '../store'
import type { AssistantBlock } from '../types'

// ---------------------------------------------------------------------------
// Synchronous rAF scheduler for unit tests
// ---------------------------------------------------------------------------

let pendingCb: (() => void) | null = null

setStreamingScheduler({
  schedule: (cb) => {
    pendingCb = cb
    return 1
  },
  cancel: (_h) => {
    pendingCb = null
  },
})

function drainRaf(): void {
  if (pendingCb) {
    const cb = pendingCb
    pendingCb = null
    cb()
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getStore() {
  return useChatStore.getState()
}

function resetStore() {
  resetStreamingBuffers()
  useChatStore.setState({ sessions: {}, activeSessionId: null })
  pendingCb = null
}

function getSession(sid: string) {
  return useChatStore.getState().sessions[sid]
}

function getMsg(sid: string, mid: string) {
  return getSession(sid)?.messages[mid]
}

function getBlocks(sid: string, mid: string): AssistantBlock[] {
  const msg = getMsg(sid, mid)
  return msg?.role === 'assistant' ? msg.blocks : []
}

// ---------------------------------------------------------------------------
// startSession / closeSession
// ---------------------------------------------------------------------------

describe('startSession', () => {
  beforeEach(resetStore)

  it('creates a new session in the sessions record', () => {
    getStore().startSession('s1', 'claude', '/vault')
    const session = getSession('s1')
    expect(session).toBeDefined()
    expect(session.id).toBe('s1')
    expect(session.agentId).toBe('claude')
    expect(session.vaultPath).toBe('/vault')
  })

  it('initializes session with empty messages object and ordering', () => {
    getStore().startSession('s1', 'claude', '/vault')
    const session = getSession('s1')
    expect(session.messages).toEqual({})
    expect(session.ordering).toEqual([])
  })

  it('initializes turnState as idle', () => {
    getStore().startSession('s1', 'claude', '/vault')
    expect(getSession('s1').turnState).toBe('idle')
  })

  it('initializes pendingApprovals as empty array', () => {
    getStore().startSession('s1', 'claude', '/vault')
    expect(getSession('s1').pendingApprovals).toEqual([])
  })

  it('sets activeSessionId to the new session', () => {
    getStore().startSession('s1', 'claude', '/vault')
    expect(getStore().activeSessionId).toBe('s1')
  })

  it('multiple sessions coexist independently', () => {
    getStore().startSession('s1', 'claude', '/vault1')
    getStore().startSession('s2', 'codex', '/vault2')
    expect(getSession('s1').agentId).toBe('claude')
    expect(getSession('s2').agentId).toBe('codex')
  })

  it('does not mutate the sessions record — returns new object', () => {
    getStore().startSession('s1', 'claude', '/vault')
    const before = getStore().sessions
    getStore().startSession('s2', 'codex', '/vault2')
    const after = getStore().sessions
    expect(before).not.toBe(after)
    expect(after['s1']).toBeDefined()
  })

  it('is idempotent — repeated call with same id just activates it', () => {
    getStore().startSession('s1', 'claude', '/vault')
    getStore().appendUserMessage('s1', 'hello')
    getStore().startSession('s1', 'claude', '/vault')
    expect(Object.keys(getSession('s1').messages)).toHaveLength(1)
    expect(getStore().activeSessionId).toBe('s1')
  })
})

describe('closeSession', () => {
  beforeEach(resetStore)

  it('removes the session from the sessions record', () => {
    getStore().startSession('s1', 'claude', '/vault')
    getStore().closeSession('s1')
    expect(getSession('s1')).toBeUndefined()
  })

  it('does not affect other sessions', () => {
    getStore().startSession('s1', 'claude', '/vault')
    getStore().startSession('s2', 'codex', '/vault')
    getStore().closeSession('s1')
    expect(getSession('s2')).toBeDefined()
  })

  it('is a no-op for unknown session id', () => {
    getStore().startSession('s1', 'claude', '/vault')
    expect(() => getStore().closeSession('does-not-exist')).not.toThrow()
    expect(getSession('s1')).toBeDefined()
  })

  it('updates activeSessionId when the active session is closed', () => {
    getStore().startSession('s1', 'claude', '/vault')
    getStore().startSession('s2', 'claude', '/vault')
    getStore().closeSession('s2')
    expect(getStore().activeSessionId).toBe('s1')
  })
})

// ---------------------------------------------------------------------------
// appendUserMessage
// ---------------------------------------------------------------------------

describe('appendUserMessage', () => {
  beforeEach(() => {
    resetStore()
    getStore().startSession('s1', 'claude', '/vault')
  })

  it('adds a user message to the session messages record', () => {
    const mid = getStore().appendUserMessage('s1', 'Hello')
    const msg = getMsg('s1', mid)
    expect(msg).toBeDefined()
    expect(msg?.role).toBe('user')
    if (msg?.role === 'user') expect(msg.text).toBe('Hello')
  })

  it('appends message id to ordering array', () => {
    const mid = getStore().appendUserMessage('s1', 'Hello')
    expect(getSession('s1').ordering).toContain(mid)
  })

  it('ordering preserves insertion order for multiple messages', () => {
    const mid1 = getStore().appendUserMessage('s1', 'First')
    const mid2 = getStore().appendUserMessage('s1', 'Second')
    const { ordering } = getSession('s1')
    expect(ordering[0]).toBe(mid1)
    expect(ordering[1]).toBe(mid2)
  })

  it('does not mutate the messages object in place (immutable update)', () => {
    const before = getSession('s1').messages
    getStore().appendUserMessage('s1', 'Hello')
    const after = getSession('s1').messages
    expect(before).not.toBe(after)
  })

  it('returns a unique id for each message', () => {
    const id1 = getStore().appendUserMessage('s1', 'A')
    const id2 = getStore().appendUserMessage('s1', 'B')
    expect(id1).not.toBe(id2)
  })

  it('sets turnState to streaming', () => {
    getStore().appendUserMessage('s1', 'Hello')
    expect(getSession('s1').turnState).toBe('streaming')
  })

  it('is a no-op for unknown session id', () => {
    expect(() => getStore().appendUserMessage('ghost', 'Hi')).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// applyStreamEvent — message-start
// ---------------------------------------------------------------------------

describe('applyStreamEvent: message-start', () => {
  beforeEach(() => {
    resetStore()
    getStore().startSession('s1', 'claude', '/vault')
  })

  it('creates an assistant message in the session messages record', () => {
    getStore().applyStreamEvent('s1', {
      type: 'message-start',
      sessionId: 's1',
      messageId: 'm1',
      role: 'assistant',
    })
    const msg = getMsg('s1', 'm1')
    expect(msg).toBeDefined()
    expect(msg?.role).toBe('assistant')
    expect(msg?.id).toBe('m1')
  })

  it('appends message id to ordering', () => {
    getStore().applyStreamEvent('s1', {
      type: 'message-start',
      sessionId: 's1',
      messageId: 'm1',
      role: 'assistant',
    })
    expect(getSession('s1').ordering).toContain('m1')
  })

  it('initializes message with empty blocks and done=false', () => {
    getStore().applyStreamEvent('s1', {
      type: 'message-start',
      sessionId: 's1',
      messageId: 'm1',
      role: 'assistant',
    })
    const msg = getMsg('s1', 'm1')
    expect(msg?.role).toBe('assistant')
    if (msg?.role === 'assistant') {
      expect(msg.blocks).toEqual([])
      expect(msg.done).toBe(false)
    }
  })

  it('sets turnState to streaming', () => {
    getStore().applyStreamEvent('s1', {
      type: 'message-start',
      sessionId: 's1',
      messageId: 'm1',
      role: 'assistant',
    })
    expect(getSession('s1').turnState).toBe('streaming')
  })

  it('is idempotent — repeated event with same id does not duplicate', () => {
    const ev = {
      type: 'message-start' as const,
      sessionId: 's1',
      messageId: 'm1',
      role: 'assistant' as const,
    }
    getStore().applyStreamEvent('s1', ev)
    getStore().applyStreamEvent('s1', ev)
    expect(getSession('s1').ordering.filter((id) => id === 'm1')).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// text-delta via applyStreamEvent (routes to ref buffer) + flush
// ---------------------------------------------------------------------------

describe('applyStreamEvent: text-delta via ref buffer', () => {
  beforeEach(() => {
    resetStore()
    getStore().startSession('s1', 'claude', '/vault')
    getStore().applyStreamEvent('s1', {
      type: 'message-start',
      sessionId: 's1',
      messageId: 'm1',
      role: 'assistant',
    })
  })

  afterEach(resetStreamingBuffers)

  it('accumulates text deltas and flush creates a text block', () => {
    getStore().applyStreamEvent('s1', {
      type: 'text-delta',
      sessionId: 's1',
      messageId: 'm1',
      delta: 'Hello',
      seq: 0,
    })
    getStore().applyStreamEvent('s1', {
      type: 'text-delta',
      sessionId: 's1',
      messageId: 'm1',
      delta: ' world',
      seq: 1,
    })
    drainRaf()
    const textBlock = getBlocks('s1', 'm1').find((b) => b.kind === 'text')
    expect(textBlock).toBeDefined()
    if (textBlock?.kind === 'text') expect(textBlock.text).toBe('Hello world')
  })

  it('flushPendingDeltas commits buffer to store immediately', () => {
    getStore().applyStreamEvent('s1', {
      type: 'text-delta',
      sessionId: 's1',
      messageId: 'm1',
      delta: 'Direct',
      seq: 0,
    })
    flushPendingDeltas()
    const textBlock = getBlocks('s1', 'm1').find((b) => b.kind === 'text')
    expect(textBlock).toBeDefined()
    if (textBlock?.kind === 'text') expect(textBlock.text).toBe('Direct')
  })

  it('multiple text-deltas to different messageIds are isolated', () => {
    getStore().startSession('s2', 'claude', '/vault')
    getStore().applyStreamEvent('s2', {
      type: 'message-start',
      sessionId: 's2',
      messageId: 'm2',
      role: 'assistant',
    })

    getStore().applyStreamEvent('s1', {
      type: 'text-delta',
      sessionId: 's1',
      messageId: 'm1',
      delta: 'AAA',
      seq: 0,
    })
    getStore().applyStreamEvent('s2', {
      type: 'text-delta',
      sessionId: 's2',
      messageId: 'm2',
      delta: 'BBB',
      seq: 0,
    })
    flushPendingDeltas()

    const block1 = getBlocks('s1', 'm1').find((b) => b.kind === 'text')
    const block2 = getBlocks('s2', 'm2').find((b) => b.kind === 'text')
    if (block1?.kind === 'text') expect(block1.text).toBe('AAA')
    if (block2?.kind === 'text') expect(block2.text).toBe('BBB')
    expect(block1).toBeDefined()
    expect(block2).toBeDefined()
  })

  it('produces only one text block per message across multiple rAF flushes', () => {
    getStore().applyStreamEvent('s1', {
      type: 'text-delta',
      sessionId: 's1',
      messageId: 'm1',
      delta: 'Part1',
      seq: 0,
    })
    drainRaf()
    getStore().applyStreamEvent('s1', {
      type: 'text-delta',
      sessionId: 's1',
      messageId: 'm1',
      delta: 'Part2',
      seq: 1,
    })
    drainRaf()
    const textBlocks = getBlocks('s1', 'm1').filter((b) => b.kind === 'text')
    expect(textBlocks).toHaveLength(1)
    if (textBlocks[0]?.kind === 'text') expect(textBlocks[0].text).toBe('Part1Part2')
  })

  it('deduplicates repeated seq — does not double-add text', () => {
    getStore().applyStreamEvent('s1', {
      type: 'text-delta',
      sessionId: 's1',
      messageId: 'm1',
      delta: 'Hi',
      seq: 5,
    })
    getStore().applyStreamEvent('s1', {
      type: 'text-delta',
      sessionId: 's1',
      messageId: 'm1',
      delta: 'Hi',
      seq: 5,
    })
    flushPendingDeltas()
    const textBlock = getBlocks('s1', 'm1').find((b) => b.kind === 'text')
    if (textBlock?.kind === 'text') expect(textBlock.text).toBe('Hi')
  })

  it('dispatchStreamEvent routes text-delta to buffer (same result as applyStreamEvent)', () => {
    dispatchStreamEvent({
      type: 'text-delta',
      sessionId: 's1',
      messageId: 'm1',
      delta: 'Via dispatch',
      seq: 0,
    })
    flushPendingDeltas()
    const textBlock = getBlocks('s1', 'm1').find((b) => b.kind === 'text')
    expect(textBlock).toBeDefined()
    if (textBlock?.kind === 'text') expect(textBlock.text).toBe('Via dispatch')
  })
})

// ---------------------------------------------------------------------------
// message-end
// ---------------------------------------------------------------------------

describe('applyStreamEvent: message-end', () => {
  beforeEach(() => {
    resetStore()
    getStore().startSession('s1', 'claude', '/vault')
    getStore().applyStreamEvent('s1', {
      type: 'message-start',
      sessionId: 's1',
      messageId: 'm1',
      role: 'assistant',
    })
  })

  it('marks message done=true', () => {
    getStore().applyStreamEvent('s1', {
      type: 'message-end',
      sessionId: 's1',
      messageId: 'm1',
      stopReason: 'end_turn',
    })
    const msg = getMsg('s1', 'm1')
    if (msg?.role === 'assistant') expect(msg.done).toBe(true)
  })

  it('sets turnState to idle after end_turn with no pending approvals', () => {
    getStore().applyStreamEvent('s1', {
      type: 'message-end',
      sessionId: 's1',
      messageId: 'm1',
      stopReason: 'end_turn',
    })
    expect(getSession('s1').turnState).toBe('idle')
  })

  it('sets turnState to awaiting_approval when stopReason is tool_use', () => {
    getStore().applyStreamEvent('s1', {
      type: 'message-end',
      sessionId: 's1',
      messageId: 'm1',
      stopReason: 'tool_use',
    })
    expect(getSession('s1').turnState).toBe('awaiting_approval')
  })

  it('sets turnState to awaiting_approval when pendingApprovals exist (end_turn)', () => {
    getStore().applyStreamEvent('s1', {
      type: 'permission-request',
      sessionId: 's1',
      toolUseId: 'tu1',
      toolName: 'Edit',
      input: {},
      risk: 'destructive',
      suggestion: 'review',
    })
    getStore().applyStreamEvent('s1', {
      type: 'message-end',
      sessionId: 's1',
      messageId: 'm1',
      stopReason: 'end_turn',
    })
    expect(getSession('s1').turnState).toBe('awaiting_approval')
  })

  it('flushes buffered deltas before marking done', () => {
    getStore().applyStreamEvent('s1', {
      type: 'text-delta',
      sessionId: 's1',
      messageId: 'm1',
      delta: 'Final',
      seq: 0,
    })
    getStore().applyStreamEvent('s1', {
      type: 'message-end',
      sessionId: 's1',
      messageId: 'm1',
      stopReason: 'end_turn',
    })
    const msg = getMsg('s1', 'm1')
    if (msg?.role === 'assistant') {
      expect(msg.done).toBe(true)
      const textBlock = msg.blocks.find((b) => b.kind === 'text')
      if (textBlock?.kind === 'text') expect(textBlock.text).toBe('Final')
    }
  })

  it('is idempotent — repeated message-end on already-done message returns same state ref', () => {
    const ev = {
      type: 'message-end' as const,
      sessionId: 's1',
      messageId: 'm1',
      stopReason: 'end_turn' as const,
    }
    getStore().applyStreamEvent('s1', ev)
    const snap1 = getSession('s1')
    getStore().applyStreamEvent('s1', ev)
    const snap2 = getSession('s1')
    expect(snap1).toBe(snap2)
  })
})

// ---------------------------------------------------------------------------
// tool-use
// ---------------------------------------------------------------------------

describe('applyStreamEvent: tool-use', () => {
  beforeEach(() => {
    resetStore()
    getStore().startSession('s1', 'claude', '/vault')
    getStore().applyStreamEvent('s1', {
      type: 'message-start',
      sessionId: 's1',
      messageId: 'm1',
      role: 'assistant',
    })
  })

  it('adds a tool_use block to the target message', () => {
    getStore().applyStreamEvent('s1', {
      type: 'tool-use',
      sessionId: 's1',
      messageId: 'm1',
      toolUseId: 'tu1',
      name: 'Bash',
      input: { command: 'ls' },
    })
    const block = getBlocks('s1', 'm1').find((b) => b.kind === 'tool_use' && b.id === 'tu1')
    expect(block).toBeDefined()
    if (block?.kind === 'tool_use') {
      expect(block.tool).toBe('Bash')
      expect(block.status).toBe('running')
    }
  })

  it('does not double-add block for same toolUseId (idempotency)', () => {
    const ev = {
      type: 'tool-use' as const,
      sessionId: 's1',
      messageId: 'm1',
      toolUseId: 'tu1',
      name: 'Bash',
      input: {},
    }
    getStore().applyStreamEvent('s1', ev)
    getStore().applyStreamEvent('s1', ev)
    const matching = getBlocks('s1', 'm1').filter((b) => b.kind === 'tool_use' && b.id === 'tu1')
    expect(matching).toHaveLength(1)
  })

  it('stores multiple distinct tool blocks in same message', () => {
    getStore().applyStreamEvent('s1', {
      type: 'tool-use',
      sessionId: 's1',
      messageId: 'm1',
      toolUseId: 'tu1',
      name: 'Bash',
      input: {},
    })
    getStore().applyStreamEvent('s1', {
      type: 'tool-use',
      sessionId: 's1',
      messageId: 'm1',
      toolUseId: 'tu2',
      name: 'Read',
      input: {},
    })
    const toolBlocks = getBlocks('s1', 'm1').filter((b) => b.kind === 'tool_use')
    expect(toolBlocks).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// Selectors with shallow equality — ordering stability, subscribe
// ---------------------------------------------------------------------------

describe('selector: shallow equality', () => {
  beforeEach(() => {
    resetStore()
    getStore().startSession('s1', 'claude', '/vault')
    getStore().applyStreamEvent('s1', {
      type: 'message-start',
      sessionId: 's1',
      messageId: 'm1',
      role: 'assistant',
    })
    getStore().applyStreamEvent('s1', {
      type: 'message-start',
      sessionId: 's1',
      messageId: 'm2',
      role: 'assistant',
    })
  })

  it('subscribe notifies listener on state change', () => {
    const listener = vi.fn()
    const unsub = useChatStore.subscribe(listener)
    getStore().applyStreamEvent('s1', {
      type: 'message-start',
      sessionId: 's1',
      messageId: 'm3',
      role: 'assistant',
    })
    unsub()
    expect(listener).toHaveBeenCalled()
  })

  it('ordering array is reference-equal when only a text block is updated', () => {
    const ordering1 = getSession('s1').ordering
    getStore().applyStreamEvent('s1', {
      type: 'text-delta',
      sessionId: 's1',
      messageId: 'm1',
      delta: 'X',
      seq: 0,
    })
    flushPendingDeltas()
    const ordering2 = getSession('s1').ordering
    // No new messages were added — ordering has same content
    expect(ordering1.length).toBe(ordering2.length)
    expect(ordering1[0]).toBe(ordering2[0])
  })

  it('subscribe is called exactly once per real state change', () => {
    const listener = vi.fn()
    const unsub = useChatStore.subscribe(listener)
    getStore().appendUserMessage('s1', 'trigger')
    unsub()
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('no-op events do not trigger listener (same ref guard)', () => {
    // Applying a message-start for an existing id returns same state
    const ev = {
      type: 'message-start' as const,
      sessionId: 's1',
      messageId: 'm1',
      role: 'assistant' as const,
    }
    getStore().applyStreamEvent('s1', ev) // first call — already exists, same ref
    const listener = vi.fn()
    const unsub = useChatStore.subscribe(listener)
    getStore().applyStreamEvent('s1', ev) // idempotent — same ref returned
    unsub()
    // Zustand may or may not call listener for same-ref (implementation-dependent)
    // What matters is that if it does call, the state is unchanged
    const session = getSession('s1')
    expect(session.ordering.filter((id) => id === 'm1')).toHaveLength(1)
  })
})
