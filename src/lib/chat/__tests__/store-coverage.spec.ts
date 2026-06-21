import { describe, it, expect, beforeEach } from 'vitest'
import {
  useChatStore,
  setStreamingScheduler,
  resetStreamingBuffers,
  flushPendingDeltas,
} from '../store'
import type { AssistantBlock } from '../types'

// ---------------------------------------------------------------------------
// Synchronous rAF scheduler
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
// setActiveSession
// ---------------------------------------------------------------------------

describe('setActiveSession', () => {
  beforeEach(resetStore)

  it('updates activeSessionId to the given id', () => {
    getStore().startSession('s1', 'claude', '/vault')
    getStore().startSession('s2', 'codex', '/vault2')
    getStore().setActiveSession('s1')
    expect(getStore().activeSessionId).toBe('s1')
    getStore().setActiveSession('s2')
    expect(getStore().activeSessionId).toBe('s2')
  })

  it('sets activeSessionId to null', () => {
    getStore().startSession('s1', 'claude', '/vault')
    getStore().setActiveSession(null)
    expect(getStore().activeSessionId).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// setComposerDraft
// ---------------------------------------------------------------------------

describe('setComposerDraft', () => {
  beforeEach(() => {
    resetStore()
    getStore().startSession(SID, 'claude', '/vault')
  })

  it('updates the draft text in the composer', () => {
    getStore().setComposerDraft(SID, 'hello world')
    expect(getSession(SID).composer.draft).toBe('hello world')
  })

  it('is a no-op when draft is already the same value', () => {
    getStore().setComposerDraft(SID, 'same')
    const before = getSession(SID)
    getStore().setComposerDraft(SID, 'same')
    const after = getSession(SID)
    expect(before).toBe(after)
  })

  it('clears draft to empty string', () => {
    getStore().setComposerDraft(SID, 'typed something')
    getStore().setComposerDraft(SID, '')
    expect(getSession(SID).composer.draft).toBe('')
  })

  it('preserves existing mentions when updating draft', () => {
    getStore().setComposerMentions(SID, [{ path: '/note.md' }])
    getStore().setComposerDraft(SID, 'new draft')
    expect(getSession(SID).composer.mentions).toEqual([{ path: '/note.md' }])
  })

  it('is a no-op for unknown session id', () => {
    expect(() => getStore().setComposerDraft('ghost', 'hi')).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// setComposerMentions
// ---------------------------------------------------------------------------

describe('setComposerMentions', () => {
  beforeEach(() => {
    resetStore()
    getStore().startSession(SID, 'claude', '/vault')
  })

  it('updates mentions in the composer', () => {
    const mentions = [{ path: '/notes/a.md' }, { path: '/notes/b.md', line: 5 }]
    getStore().setComposerMentions(SID, mentions)
    expect(getSession(SID).composer.mentions).toEqual(mentions)
  })

  it('clears mentions to empty array', () => {
    getStore().setComposerMentions(SID, [{ path: '/note.md' }])
    getStore().setComposerMentions(SID, [])
    expect(getSession(SID).composer.mentions).toEqual([])
  })

  it('preserves draft when updating mentions', () => {
    getStore().setComposerDraft(SID, 'draft text')
    getStore().setComposerMentions(SID, [{ path: '/file.md' }])
    expect(getSession(SID).composer.draft).toBe('draft text')
  })

  it('is a no-op for unknown session id', () => {
    expect(() => getStore().setComposerMentions('ghost', [])).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// setPermissionMode
// ---------------------------------------------------------------------------

describe('setPermissionMode', () => {
  beforeEach(() => {
    resetStore()
    getStore().startSession(SID, 'claude', '/vault')
  })

  it('sets permission mode to acceptEdits', () => {
    getStore().setPermissionMode(SID, 'acceptEdits')
    expect(getSession(SID).permissionMode).toBe('acceptEdits')
  })

  it('sets permission mode to plan', () => {
    getStore().setPermissionMode(SID, 'plan')
    expect(getSession(SID).permissionMode).toBe('plan')
  })

  it('sets permission mode to auto', () => {
    getStore().setPermissionMode(SID, 'auto')
    expect(getSession(SID).permissionMode).toBe('auto')
  })

  it('is a no-op when mode is already the same', () => {
    getStore().setPermissionMode(SID, 'default')
    const before = getSession(SID)
    getStore().setPermissionMode(SID, 'default')
    const after = getSession(SID)
    expect(before).toBe(after)
  })

  it('is a no-op for unknown session id', () => {
    expect(() => getStore().setPermissionMode('ghost', 'auto')).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// applyStreamEvent: session-init
// ---------------------------------------------------------------------------

describe('applyStreamEvent: session-init', () => {
  beforeEach(setup)

  it('sets cliSessionId on first session-init', () => {
    getStore().applyStreamEvent(SID, {
      type: 'session-init',
      sessionId: SID,
      provider: 'claude',
      cliSessionId: 'cli-abc-123',
      model: 'claude-3-5',
      cwd: '/vault',
      startedAt: Date.now(),
    })
    expect(getSession(SID).cliSessionId).toBe('cli-abc-123')
  })

  it('is a no-op when cliSessionId is already the same value', () => {
    getStore().applyStreamEvent(SID, {
      type: 'session-init',
      sessionId: SID,
      provider: 'claude',
      cliSessionId: 'cli-abc-123',
      model: 'claude-3-5',
      cwd: '/vault',
      startedAt: Date.now(),
    })
    const before = getSession(SID)
    getStore().applyStreamEvent(SID, {
      type: 'session-init',
      sessionId: SID,
      provider: 'claude',
      cliSessionId: 'cli-abc-123',
      model: 'claude-3-5',
      cwd: '/vault',
      startedAt: Date.now(),
    })
    const after = getSession(SID)
    expect(before).toBe(after)
  })

  it('updates cliSessionId when it changes', () => {
    getStore().applyStreamEvent(SID, {
      type: 'session-init',
      sessionId: SID,
      provider: 'claude',
      cliSessionId: 'cli-first',
      model: 'claude-3-5',
      cwd: '/vault',
      startedAt: Date.now(),
    })
    getStore().applyStreamEvent(SID, {
      type: 'session-init',
      sessionId: SID,
      provider: 'claude',
      cliSessionId: 'cli-second',
      model: 'claude-3-5',
      cwd: '/vault',
      startedAt: Date.now(),
    })
    expect(getSession(SID).cliSessionId).toBe('cli-second')
  })
})

// ---------------------------------------------------------------------------
// applyStreamEvent: error and crashed
// ---------------------------------------------------------------------------

describe('applyStreamEvent: error', () => {
  beforeEach(setup)

  it('sets turnState to error on error event', () => {
    getStore().applyStreamEvent(SID, {
      type: 'error',
      sessionId: SID,
      code: 'TIMEOUT',
      message: 'Request timed out',
      recoverable: false,
    })
    expect(getSession(SID).turnState).toBe('error')
  })

  it('sets turnState to error on recoverable error', () => {
    getStore().applyStreamEvent(SID, {
      type: 'error',
      sessionId: SID,
      code: 'RATE_LIMIT',
      message: 'Rate limited',
      recoverable: true,
    })
    expect(getSession(SID).turnState).toBe('error')
  })
})

describe('applyStreamEvent: crashed', () => {
  beforeEach(setup)

  it('sets turnState to error on crashed event with exit code', () => {
    getStore().applyStreamEvent(SID, {
      type: 'crashed',
      sessionId: SID,
      exitCode: 1,
      signal: null,
    })
    expect(getSession(SID).turnState).toBe('error')
  })

  it('sets turnState to error on crashed event with signal', () => {
    getStore().applyStreamEvent(SID, {
      type: 'crashed',
      sessionId: SID,
      exitCode: null,
      signal: 'SIGKILL',
    })
    expect(getSession(SID).turnState).toBe('error')
  })
})

// ---------------------------------------------------------------------------
// applyStreamEvent: turn-result
// ---------------------------------------------------------------------------

describe('applyStreamEvent: turn-result', () => {
  beforeEach(setup)

  it('accumulates inputTokens and outputTokens', () => {
    getStore().applyStreamEvent(SID, {
      type: 'turn-result',
      sessionId: SID,
      usage: { inputTokens: 100, outputTokens: 50 },
      costUSD: 0.01,
      durationMs: 1200,
    })
    const { tokenUsage } = getSession(SID)
    expect(tokenUsage.inputTokens).toBe(100)
    expect(tokenUsage.outputTokens).toBe(50)
  })

  it('accumulates tokens across multiple turn-result events', () => {
    getStore().applyStreamEvent(SID, {
      type: 'turn-result',
      sessionId: SID,
      usage: { inputTokens: 100, outputTokens: 50 },
      costUSD: 0.01,
      durationMs: 1000,
    })
    getStore().applyStreamEvent(SID, {
      type: 'turn-result',
      sessionId: SID,
      usage: { inputTokens: 200, outputTokens: 80 },
      costUSD: 0.02,
      durationMs: 2000,
    })
    const { tokenUsage } = getSession(SID)
    expect(tokenUsage.inputTokens).toBe(300)
    expect(tokenUsage.outputTokens).toBe(130)
  })

  it('accumulates cacheReadTokens and cacheWriteTokens', () => {
    getStore().applyStreamEvent(SID, {
      type: 'turn-result',
      sessionId: SID,
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 500, cacheWriteTokens: 200 },
      costUSD: 0,
      durationMs: 0,
    })
    const { tokenUsage } = getSession(SID)
    expect(tokenUsage.cacheReadTokens).toBe(500)
    expect(tokenUsage.cacheWriteTokens).toBe(200)
  })

  it('sets turnState to idle when no pending approvals', () => {
    getStore().applyStreamEvent(SID, {
      type: 'turn-result',
      sessionId: SID,
      usage: { inputTokens: 0, outputTokens: 0 },
      costUSD: 0,
      durationMs: 0,
    })
    expect(getSession(SID).turnState).toBe('idle')
  })

  it('sets turnState to awaiting_approval when pending approvals exist', () => {
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
      type: 'turn-result',
      sessionId: SID,
      usage: { inputTokens: 0, outputTokens: 0 },
      costUSD: 0,
      durationMs: 0,
    })
    expect(getSession(SID).turnState).toBe('awaiting_approval')
  })
})

// ---------------------------------------------------------------------------
// applyStreamEvent: turn-snapshot-summary
// ---------------------------------------------------------------------------

describe('applyStreamEvent: turn-snapshot-summary', () => {
  beforeEach(() => {
    resetStore()
    getStore().startSession(SID, 'claude', '/vault')
  })

  it('backfills turnId on the most recent user message', () => {
    const userMid = getStore().appendUserMessage(SID, 'make some changes')
    getStore().applyStreamEvent(SID, {
      type: 'turn-snapshot-summary',
      sessionId: SID,
      turnId: 'turn-xyz',
      fileCount: 2,
      fileNames: ['a.md', 'b.md'],
    })
    const msg = getMsg(SID, userMid)
    expect(msg?.role === 'user' && msg.turnId).toBe('turn-xyz')
  })

  it('is idempotent — returns same session ref when turnId already backfilled', () => {
    getStore().appendUserMessage(SID, 'change stuff')
    const ev = {
      type: 'turn-snapshot-summary' as const,
      sessionId: SID,
      turnId: 'turn-abc',
      fileCount: 1,
      fileNames: ['note.md'],
    }
    getStore().applyStreamEvent(SID, ev)
    const before = getSession(SID)
    getStore().applyStreamEvent(SID, ev)
    const after = getSession(SID)
    expect(before).toBe(after)
  })

  it('does not affect session when there are no user messages', () => {
    getStore().applyStreamEvent(SID, {
      type: 'message-start',
      sessionId: SID,
      messageId: MID,
      role: 'assistant',
    })
    const before = getSession(SID)
    getStore().applyStreamEvent(SID, {
      type: 'turn-snapshot-summary',
      sessionId: SID,
      turnId: 'turn-no-user',
      fileCount: 0,
      fileNames: [],
    })
    const after = getSession(SID)
    expect(before).toBe(after)
  })
})

// ---------------------------------------------------------------------------
// applyStreamEvent: snapshot-warning
// ---------------------------------------------------------------------------

describe('applyStreamEvent: snapshot-warning', () => {
  beforeEach(setup)

  it('does not change session state — returns same ref', () => {
    const before = getSession(SID)
    getStore().applyStreamEvent(SID, {
      type: 'snapshot-warning',
      sessionId: SID,
      toolUseId: 'tu1',
      filePath: '/vault/note.md',
      reason: 'file too large',
    })
    const after = getSession(SID)
    expect(before).toBe(after)
  })
})

// ---------------------------------------------------------------------------
// applyStreamEvent: thinking-delta
// ---------------------------------------------------------------------------

describe('applyStreamEvent: thinking-delta via ref buffer', () => {
  beforeEach(setup)

  it('accumulates thinking deltas and flush creates a thinking block', () => {
    getStore().applyStreamEvent(SID, {
      type: 'thinking-delta',
      sessionId: SID,
      messageId: MID,
      delta: 'Let me think',
      seq: 0,
    })
    getStore().applyStreamEvent(SID, {
      type: 'thinking-delta',
      sessionId: SID,
      messageId: MID,
      delta: ' about this',
      seq: 1,
    })
    flushPendingDeltas()
    const thinkingBlock = getBlocks(SID, MID).find((b) => b.kind === 'thinking')
    expect(thinkingBlock).toBeDefined()
    if (thinkingBlock?.kind === 'thinking') {
      expect(thinkingBlock.text).toBe('Let me think about this')
    }
  })

  it('thinking and text blocks are separate in same message', () => {
    getStore().applyStreamEvent(SID, {
      type: 'thinking-delta',
      sessionId: SID,
      messageId: MID,
      delta: 'Reasoning',
      seq: 0,
    })
    getStore().applyStreamEvent(SID, {
      type: 'text-delta',
      sessionId: SID,
      messageId: MID,
      delta: 'Answer',
      seq: 0,
    })
    flushPendingDeltas()
    const thinkingBlock = getBlocks(SID, MID).find((b) => b.kind === 'thinking')
    const textBlock = getBlocks(SID, MID).find((b) => b.kind === 'text')
    expect(thinkingBlock).toBeDefined()
    expect(textBlock).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// applyStreamEvent: tool-result — isError branches
// ---------------------------------------------------------------------------

describe('applyStreamEvent: tool-result — isError branches', () => {
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

  it('sets errorMessage from string output on error', () => {
    getStore().applyStreamEvent(SID, {
      type: 'tool-result',
      sessionId: SID,
      toolUseId: 'tu1',
      output: 'permission denied',
      isError: true,
      durationMs: 10,
    })
    const block = getToolBlock(SID, MID, 'tu1')
    if (block?.kind === 'tool_use') {
      expect(block.errorMessage).toBe('permission denied')
    }
  })

  it('does not set errorMessage when output is an object on error', () => {
    getStore().applyStreamEvent(SID, {
      type: 'tool-result',
      sessionId: SID,
      toolUseId: 'tu1',
      output: { code: 1, stderr: 'err' },
      isError: true,
      durationMs: 10,
    })
    const block = getToolBlock(SID, MID, 'tu1')
    if (block?.kind === 'tool_use') {
      expect(block.errorMessage).toBeUndefined()
    }
  })

  it('sets durationMs on error result', () => {
    getStore().applyStreamEvent(SID, {
      type: 'tool-result',
      sessionId: SID,
      toolUseId: 'tu1',
      output: 'err',
      isError: true,
      durationMs: 999,
    })
    const block = getToolBlock(SID, MID, 'tu1')
    if (block?.kind === 'tool_use') {
      expect(block.durationMs).toBe(999)
    }
  })
})

// ---------------------------------------------------------------------------
// applyStreamEvent: tool-use with snapshotTurnId — backfills user turnId
// ---------------------------------------------------------------------------

describe('applyStreamEvent: tool-use with snapshotTurnId', () => {
  beforeEach(() => {
    resetStore()
    getStore().startSession(SID, 'claude', '/vault')
  })

  it('backfills turnId on the user message when snapshotTurnId is present', () => {
    const userMid = getStore().appendUserMessage(SID, 'do something')
    getStore().applyStreamEvent(SID, {
      type: 'message-start',
      sessionId: SID,
      messageId: MID,
      role: 'assistant',
    })
    getStore().applyStreamEvent(SID, {
      type: 'tool-use',
      sessionId: SID,
      messageId: MID,
      toolUseId: 'tu1',
      name: 'Edit',
      input: {},
      snapshotSaved: true,
      snapshotTurnId: 'turn-snap-1',
    })
    const userMsg = getMsg(SID, userMid)
    expect(userMsg?.role === 'user' && userMsg.turnId).toBe('turn-snap-1')
  })

  it('does not backfill when snapshotTurnId is absent', () => {
    const userMid = getStore().appendUserMessage(SID, 'do something')
    getStore().applyStreamEvent(SID, {
      type: 'message-start',
      sessionId: SID,
      messageId: MID,
      role: 'assistant',
    })
    getStore().applyStreamEvent(SID, {
      type: 'tool-use',
      sessionId: SID,
      messageId: MID,
      toolUseId: 'tu2',
      name: 'Bash',
      input: {},
    })
    const userMsg = getMsg(SID, userMid)
    expect(userMsg?.role === 'user' && userMsg.turnId).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// applyStreamEvent: message-start with non-assistant role
// ---------------------------------------------------------------------------

describe('applyStreamEvent: message-start non-assistant role', () => {
  beforeEach(() => {
    resetStore()
    getStore().startSession(SID, 'claude', '/vault')
  })

  it('ignores message-start with role user (not assistant)', () => {
    getStore().applyStreamEvent(SID, {
      type: 'message-start',
      sessionId: SID,
      messageId: 'u-msg-1',
      role: 'user',
    })
    expect(getMsg(SID, 'u-msg-1')).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// closeSession — active session falls back to null when no sessions remain
// ---------------------------------------------------------------------------

describe('closeSession — last session closed', () => {
  beforeEach(resetStore)

  it('sets activeSessionId to null when the only session is closed', () => {
    getStore().startSession('s1', 'claude', '/vault')
    getStore().closeSession('s1')
    expect(getStore().activeSessionId).toBeNull()
  })

  it('keeps activeSessionId unchanged when a non-active session is closed', () => {
    getStore().startSession('s1', 'claude', '/vault')
    getStore().startSession('s2', 'codex', '/vault2')
    getStore().setActiveSession('s1')
    getStore().closeSession('s2')
    expect(getStore().activeSessionId).toBe('s1')
  })
})

// ---------------------------------------------------------------------------
// backfillUserTurnId — already has turnId (early return)
// ---------------------------------------------------------------------------

describe('backfillUserTurnId — turnId already present', () => {
  beforeEach(() => {
    resetStore()
    getStore().startSession(SID, 'claude', '/vault')
  })

  it('does not overwrite an existing user turnId', () => {
    getStore().appendUserMessage(SID, 'first question')
    getStore().applyStreamEvent(SID, {
      type: 'message-start',
      sessionId: SID,
      messageId: MID,
      role: 'assistant',
    })
    getStore().applyStreamEvent(SID, {
      type: 'turn-snapshot-summary',
      sessionId: SID,
      turnId: 'turn-first',
      fileCount: 1,
      fileNames: ['a.md'],
    })
    const second = getStore().appendUserMessage(SID, 'second question')
    getStore().applyStreamEvent(SID, {
      type: 'turn-snapshot-summary',
      sessionId: SID,
      turnId: 'turn-second',
      fileCount: 1,
      fileNames: ['b.md'],
    })
    const secondMsg = getMsg(SID, second)
    expect(secondMsg?.role === 'user' && secondMsg.turnId).toBe('turn-second')
  })
})

// ---------------------------------------------------------------------------
// withSession — returns empty when session not found
// ---------------------------------------------------------------------------

describe('withSession guard — unknown session', () => {
  beforeEach(resetStore)

  it('applyStreamEvent is safe for unknown session id', () => {
    expect(() =>
      getStore().applyStreamEvent('no-session', {
        type: 'error',
        sessionId: 'no-session',
        code: 'ERR',
        message: 'test',
        recoverable: false,
      })
    ).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// approveTool — status transition when block is NOT in pending_approval
// ---------------------------------------------------------------------------

describe('approveTool — non-pending block', () => {
  beforeEach(() => {
    setup()
    getStore().applyStreamEvent(SID, {
      type: 'tool-use',
      sessionId: SID,
      messageId: MID,
      toolUseId: 'tu1',
      name: 'Bash',
      input: {},
    })
    // tool-result makes block 'ok', not 'pending_approval'
    getStore().applyStreamEvent(SID, {
      type: 'tool-result',
      sessionId: SID,
      toolUseId: 'tu1',
      output: 'done',
      isError: false,
      durationMs: 10,
    })
  })

  it('does not change a block that is already ok when approveTool is called', () => {
    const blockBefore = getToolBlock(SID, MID, 'tu1')
    getStore().approveTool(SID, 'tu1', true)
    const blockAfter = getToolBlock(SID, MID, 'tu1')
    expect(blockBefore?.kind === 'tool_use' && blockBefore.status).toBe('ok')
    expect(blockAfter?.kind === 'tool_use' && blockAfter.status).toBe('ok')
  })
})

// ---------------------------------------------------------------------------
// permission-request with snapshotTurnId — backfills user turnId
// ---------------------------------------------------------------------------

describe('applyStreamEvent: permission-request with snapshotTurnId', () => {
  beforeEach(() => {
    resetStore()
    getStore().startSession(SID, 'claude', '/vault')
  })

  it('backfills turnId on user message when permission-request has snapshotTurnId', () => {
    const userMid = getStore().appendUserMessage(SID, 'do stuff')
    getStore().applyStreamEvent(SID, {
      type: 'message-start',
      sessionId: SID,
      messageId: MID,
      role: 'assistant',
    })
    getStore().applyStreamEvent(SID, {
      type: 'permission-request',
      sessionId: SID,
      toolUseId: 'tu-snap',
      toolName: 'Write',
      input: {},
      risk: 'destructive',
      suggestion: 'review',
      snapshotSaved: true,
      snapshotTurnId: 'turn-snap-perm',
    })
    const userMsg = getMsg(SID, userMid)
    expect(userMsg?.role === 'user' && userMsg.turnId).toBe('turn-snap-perm')
  })
})
