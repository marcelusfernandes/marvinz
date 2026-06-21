import { describe, it, expect, beforeEach } from 'vitest'
import { useChatStore, setStreamingScheduler, resetStreamingBuffers } from '../store'
import type { AssistantBlock } from '../types'

// ---------------------------------------------------------------------------
// Synchronous rAF scheduler for unit tests
// ---------------------------------------------------------------------------

setStreamingScheduler({
  schedule: (cb) => {
    cb()
    return 1
  },
  cancel: (_h) => {},
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getStore() {
  return useChatStore.getState()
}

function resetStore() {
  resetStreamingBuffers()
  useChatStore.setState({ sessions: {}, activeSessionId: null })
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

function getToolBlock(sid: string, mid: string, toolUseId: string) {
  return getBlocks(sid, mid).find((b) => b.kind === 'tool_use' && b.id === toolUseId)
}

// ---------------------------------------------------------------------------
// Setup — session + assistant message
// ---------------------------------------------------------------------------

const SID = 's1'
const MID = 'm1'

function setup() {
  resetStore()
  getStore().startSession(SID, 'claude', '/vault')
  getStore().applyStreamEvent(SID, {
    type: 'message-start',
    sessionId: SID,
    messageId: MID,
    role: 'assistant',
  })
}

// ---------------------------------------------------------------------------
// permission-request — tool block already exists (via tool-use)
// ---------------------------------------------------------------------------

describe('applyStreamEvent: permission-request — tool block exists', () => {
  beforeEach(() => {
    setup()
    // Emit tool-use first, then permission-request
    getStore().applyStreamEvent(SID, {
      type: 'tool-use',
      sessionId: SID,
      messageId: MID,
      toolUseId: 'tu1',
      name: 'Bash',
      input: { command: 'rm -rf /tmp/test' },
    })
  })

  it('transitions tool block status to pending_approval', () => {
    getStore().applyStreamEvent(SID, {
      type: 'permission-request',
      sessionId: SID,
      toolUseId: 'tu1',
      toolName: 'Bash',
      input: { command: 'rm -rf /tmp/test' },
      risk: 'destructive',
      suggestion: 'review',
    })
    const block = getToolBlock(SID, MID, 'tu1')
    expect(block?.kind === 'tool_use' && block.status).toBe('pending_approval')
  })

  it('sets session turnState to awaiting_approval', () => {
    getStore().applyStreamEvent(SID, {
      type: 'permission-request',
      sessionId: SID,
      toolUseId: 'tu1',
      toolName: 'Bash',
      input: {},
      risk: 'safe',
      suggestion: 'review',
    })
    expect(getSession(SID).turnState).toBe('awaiting_approval')
  })

  it('adds toolUseId to pendingApprovals', () => {
    getStore().applyStreamEvent(SID, {
      type: 'permission-request',
      sessionId: SID,
      toolUseId: 'tu1',
      toolName: 'Bash',
      input: {},
      risk: 'safe',
      suggestion: 'review',
    })
    expect(getSession(SID).pendingApprovals).toContain('tu1')
  })

  it('is idempotent — second permission-request does not duplicate pendingApprovals entry', () => {
    const ev = {
      type: 'permission-request' as const,
      sessionId: SID,
      toolUseId: 'tu1',
      toolName: 'Bash',
      input: {},
      risk: 'safe' as const,
      suggestion: 'review' as const,
    }
    getStore().applyStreamEvent(SID, ev)
    getStore().applyStreamEvent(SID, ev)
    expect(getSession(SID).pendingApprovals.filter((id) => id === 'tu1')).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// permission-request — tool block does NOT exist yet (permission arrived first)
// ---------------------------------------------------------------------------

describe('applyStreamEvent: permission-request — tool block created inline', () => {
  beforeEach(setup)

  it('creates a new tool_use block with pending_approval status', () => {
    getStore().applyStreamEvent(SID, {
      type: 'permission-request',
      sessionId: SID,
      toolUseId: 'tu2',
      toolName: 'Write',
      input: { file_path: '/vault/note.md', content: 'hello' },
      risk: 'destructive',
      suggestion: 'review',
    })
    const block = getToolBlock(SID, MID, 'tu2')
    expect(block).toBeDefined()
    expect(block?.kind === 'tool_use' && block.status).toBe('pending_approval')
  })

  it('preserves toolName in the created block', () => {
    getStore().applyStreamEvent(SID, {
      type: 'permission-request',
      sessionId: SID,
      toolUseId: 'tu2',
      toolName: 'Write',
      input: {},
      risk: 'safe',
      suggestion: 'review',
    })
    const block = getToolBlock(SID, MID, 'tu2')
    if (block?.kind === 'tool_use') expect(block.tool).toBe('Write')
  })

  it('preserves input in the created block', () => {
    const input = { file_path: '/vault/foo.md', content: 'bar' }
    getStore().applyStreamEvent(SID, {
      type: 'permission-request',
      sessionId: SID,
      toolUseId: 'tu3',
      toolName: 'Write',
      input,
      risk: 'destructive',
      suggestion: 'review',
    })
    const block = getToolBlock(SID, MID, 'tu3')
    if (block?.kind === 'tool_use') expect(block.input).toEqual(input)
  })
})

// ---------------------------------------------------------------------------
// permission-request — multiple tools pending
// ---------------------------------------------------------------------------

describe('applyStreamEvent: permission-request — multiple tools', () => {
  beforeEach(setup)

  it('supports multiple simultaneous pending approvals', () => {
    getStore().applyStreamEvent(SID, {
      type: 'permission-request',
      sessionId: SID,
      toolUseId: 'tu1',
      toolName: 'Bash',
      input: {},
      risk: 'safe',
      suggestion: 'review',
    })
    getStore().applyStreamEvent(SID, {
      type: 'permission-request',
      sessionId: SID,
      toolUseId: 'tu2',
      toolName: 'Write',
      input: {},
      risk: 'destructive',
      suggestion: 'review',
    })
    const { pendingApprovals } = getSession(SID)
    expect(pendingApprovals).toContain('tu1')
    expect(pendingApprovals).toContain('tu2')
    expect(pendingApprovals).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// tool-result — updates tool block status
// ---------------------------------------------------------------------------

describe('applyStreamEvent: tool-result', () => {
  beforeEach(() => {
    setup()
    getStore().applyStreamEvent(SID, {
      type: 'tool-use',
      sessionId: SID,
      messageId: MID,
      toolUseId: 'tu1',
      name: 'Bash',
      input: { command: 'ls' },
    })
  })

  it('marks tool block as ok on success', () => {
    getStore().applyStreamEvent(SID, {
      type: 'tool-result',
      sessionId: SID,
      toolUseId: 'tu1',
      output: 'file.txt\nfolder/',
      isError: false,
      durationMs: 120,
    })
    const block = getToolBlock(SID, MID, 'tu1')
    expect(block?.kind === 'tool_use' && block.status).toBe('ok')
  })

  it('marks tool block as error on failure', () => {
    getStore().applyStreamEvent(SID, {
      type: 'tool-result',
      sessionId: SID,
      toolUseId: 'tu1',
      output: 'Permission denied',
      isError: true,
      durationMs: 50,
    })
    const block = getToolBlock(SID, MID, 'tu1')
    expect(block?.kind === 'tool_use' && block.status).toBe('error')
  })

  it('stores the output on the block', () => {
    getStore().applyStreamEvent(SID, {
      type: 'tool-result',
      sessionId: SID,
      toolUseId: 'tu1',
      output: 'result content',
      isError: false,
      durationMs: 10,
    })
    const block = getToolBlock(SID, MID, 'tu1')
    if (block?.kind === 'tool_use') expect(block.result).toBe('result content')
  })

  it('stores durationMs on the block', () => {
    getStore().applyStreamEvent(SID, {
      type: 'tool-result',
      sessionId: SID,
      toolUseId: 'tu1',
      output: 'ok',
      isError: false,
      durationMs: 250,
    })
    const block = getToolBlock(SID, MID, 'tu1')
    if (block?.kind === 'tool_use') expect(block.durationMs).toBe(250)
  })

  it('stores errorMessage on error blocks', () => {
    getStore().applyStreamEvent(SID, {
      type: 'tool-result',
      sessionId: SID,
      toolUseId: 'tu1',
      output: 'Command not found',
      isError: true,
      durationMs: 5,
    })
    const block = getToolBlock(SID, MID, 'tu1')
    if (block?.kind === 'tool_use') expect(block.errorMessage).toBe('Command not found')
  })

  it('is a no-op for unknown toolUseId', () => {
    const before = getSession(SID)
    getStore().applyStreamEvent(SID, {
      type: 'tool-result',
      sessionId: SID,
      toolUseId: 'unknown-tu',
      output: 'noop',
      isError: false,
      durationMs: 0,
    })
    const after = getSession(SID)
    expect(before).toBe(after)
  })

  it('does not mutate blocks array in place (immutable update)', () => {
    const blocksBefore = getBlocks(SID, MID)
    getStore().applyStreamEvent(SID, {
      type: 'tool-result',
      sessionId: SID,
      toolUseId: 'tu1',
      output: 'ok',
      isError: false,
      durationMs: 0,
    })
    const blocksAfter = getBlocks(SID, MID)
    expect(blocksBefore).not.toBe(blocksAfter)
  })
})

// ---------------------------------------------------------------------------
// approveTool — store action
// ---------------------------------------------------------------------------

describe('approveTool', () => {
  beforeEach(() => {
    setup()
    getStore().applyStreamEvent(SID, {
      type: 'permission-request',
      sessionId: SID,
      toolUseId: 'tu1',
      toolName: 'Bash',
      input: {},
      risk: 'safe',
      suggestion: 'review',
    })
  })

  it('transitions block to running when approved=true', () => {
    getStore().approveTool(SID, 'tu1', true)
    const block = getToolBlock(SID, MID, 'tu1')
    expect(block?.kind === 'tool_use' && block.status).toBe('running')
  })

  it('transitions block to denied when approved=false', () => {
    getStore().approveTool(SID, 'tu1', false)
    const block = getToolBlock(SID, MID, 'tu1')
    expect(block?.kind === 'tool_use' && block.status).toBe('denied')
  })

  it('removes toolUseId from pendingApprovals after decision', () => {
    getStore().approveTool(SID, 'tu1', true)
    expect(getSession(SID).pendingApprovals).not.toContain('tu1')
  })

  it('sets turnState to streaming when all approvals resolved', () => {
    getStore().approveTool(SID, 'tu1', true)
    expect(getSession(SID).turnState).toBe('streaming')
  })

  it('keeps turnState as awaiting_approval when other approvals remain', () => {
    getStore().applyStreamEvent(SID, {
      type: 'permission-request',
      sessionId: SID,
      toolUseId: 'tu2',
      toolName: 'Write',
      input: {},
      risk: 'destructive',
      suggestion: 'review',
    })
    getStore().approveTool(SID, 'tu1', true)
    expect(getSession(SID).turnState).toBe('awaiting_approval')
  })

  it('is a no-op for unknown toolUseId', () => {
    const before = getSession(SID)
    getStore().approveTool(SID, 'unknown-tu', true)
    const after = getSession(SID)
    expect(before).toBe(after)
  })
})

// ---------------------------------------------------------------------------
// message-end turnState with pending approvals
// ---------------------------------------------------------------------------

describe('applyStreamEvent: message-end turnState integration', () => {
  beforeEach(setup)

  it('sets turnState to awaiting_approval when pendingApprovals non-empty on end_turn', () => {
    getStore().applyStreamEvent(SID, {
      type: 'permission-request',
      sessionId: SID,
      toolUseId: 'tu1',
      toolName: 'Bash',
      input: {},
      risk: 'safe',
      suggestion: 'review',
    })
    getStore().applyStreamEvent(SID, {
      type: 'message-end',
      sessionId: SID,
      messageId: MID,
      stopReason: 'end_turn',
    })
    expect(getSession(SID).turnState).toBe('awaiting_approval')
  })

  it('sets turnState to idle on end_turn with no pending approvals', () => {
    getStore().applyStreamEvent(SID, {
      type: 'message-end',
      sessionId: SID,
      messageId: MID,
      stopReason: 'end_turn',
    })
    expect(getSession(SID).turnState).toBe('idle')
  })

  it('sets turnState to awaiting_approval on tool_use stop reason', () => {
    getStore().applyStreamEvent(SID, {
      type: 'message-end',
      sessionId: SID,
      messageId: MID,
      stopReason: 'tool_use',
    })
    expect(getSession(SID).turnState).toBe('awaiting_approval')
  })
})

// ---------------------------------------------------------------------------
// Immutability guard
// ---------------------------------------------------------------------------

describe('immutability — permission-request', () => {
  beforeEach(setup)

  it('produces new sessions object reference on permission-request', () => {
    const before = useChatStore.getState().sessions
    getStore().applyStreamEvent(SID, {
      type: 'permission-request',
      sessionId: SID,
      toolUseId: 'tu1',
      toolName: 'Bash',
      input: {},
      risk: 'safe',
      suggestion: 'review',
    })
    const after = useChatStore.getState().sessions
    expect(before).not.toBe(after)
  })

  it('produces new pendingApprovals array reference', () => {
    const pendingBefore = getSession(SID).pendingApprovals
    getStore().applyStreamEvent(SID, {
      type: 'permission-request',
      sessionId: SID,
      toolUseId: 'tu1',
      toolName: 'Bash',
      input: {},
      risk: 'safe',
      suggestion: 'review',
    })
    const pendingAfter = getSession(SID).pendingApprovals
    expect(pendingBefore).not.toBe(pendingAfter)
  })
})
