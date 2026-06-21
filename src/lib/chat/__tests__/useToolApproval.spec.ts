import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useChatStore, resetStreamingBuffers } from '../store'
import { useToolApproval } from '../useToolApproval'

// ---------------------------------------------------------------------------
// IPC stub — window.marvin.agent.request mock
// ---------------------------------------------------------------------------

function makeAgentStub() {
  return {
    request: vi.fn(() => Promise.resolve({ ok: true as const })),
    onEvent: vi.fn(() => () => {}),
  }
}

type AgentStub = ReturnType<typeof makeAgentStub>
let agent: AgentStub

function resetStore() {
  resetStreamingBuffers()
  useChatStore.setState({ sessions: {}, activeSessionId: null })
}

function seedSession(sid = 's1') {
  useChatStore.getState().startSession(sid, 'claude', '/vault')
  // Add an assistant message with a pending tool block
  useChatStore.getState().applyStreamEvent(sid, {
    type: 'message-start',
    sessionId: sid,
    messageId: 'm1',
    role: 'assistant',
  })
  useChatStore.getState().applyStreamEvent(sid, {
    type: 'permission-request',
    sessionId: sid,
    toolUseId: 'tu1',
    toolName: 'Bash',
    input: { command: 'ls' },
    risk: 'safe',
    suggestion: 'review',
  })
}

beforeEach(() => {
  agent = makeAgentStub()
  Object.defineProperty(globalThis, 'window', {
    value: {
      ...(typeof window !== 'undefined' ? window : {}),
      marvin: { agent },
    },
    writable: true,
    configurable: true,
  })
  resetStore()
})

afterEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// useToolApproval — allow
// ---------------------------------------------------------------------------

describe('useToolApproval — allow', () => {
  it('optimistically transitions block to running', async () => {
    seedSession()
    const { result } = renderHook(() => useToolApproval('s1'))

    await act(async () => {
      await result.current.allow('tu1')
    })

    const session = useChatStore.getState().sessions['s1']
    const block = Object.values(session.messages)
      .flatMap((m) => (m.role === 'assistant' ? m.blocks : []))
      .find((b) => b.kind === 'tool_use' && b.id === 'tu1')
    expect(block?.kind === 'tool_use' && block.status).toBe('running')
  })

  it('sends an approval IPC request with kind=allow', async () => {
    seedSession()
    const { result } = renderHook(() => useToolApproval('s1'))

    await act(async () => {
      await result.current.allow('tu1')
    })

    expect(agent.request).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'approval',
        sessionId: 's1',
        toolUseId: 'tu1',
        decision: { kind: 'allow' },
      })
    )
  })

  it('removes tu1 from pendingApprovals after allow', async () => {
    seedSession()
    const { result } = renderHook(() => useToolApproval('s1'))

    await act(async () => {
      await result.current.allow('tu1')
    })

    expect(useChatStore.getState().sessions['s1'].pendingApprovals).not.toContain('tu1')
  })
})

// ---------------------------------------------------------------------------
// useToolApproval — allowAlways
// ---------------------------------------------------------------------------

describe('useToolApproval — allowAlways', () => {
  it('sends approval with remember: "session"', async () => {
    seedSession()
    const { result } = renderHook(() => useToolApproval('s1'))

    await act(async () => {
      await result.current.allowAlways('tu1')
    })

    expect(agent.request).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: { kind: 'allow', remember: 'session' },
      })
    )
  })

  it('optimistically transitions block to running', async () => {
    seedSession()
    const { result } = renderHook(() => useToolApproval('s1'))

    await act(async () => {
      await result.current.allowAlways('tu1')
    })

    const session = useChatStore.getState().sessions['s1']
    const block = Object.values(session.messages)
      .flatMap((m) => (m.role === 'assistant' ? m.blocks : []))
      .find((b) => b.kind === 'tool_use' && b.id === 'tu1')
    expect(block?.kind === 'tool_use' && block.status).toBe('running')
  })
})

// ---------------------------------------------------------------------------
// useToolApproval — deny
// ---------------------------------------------------------------------------

describe('useToolApproval — deny', () => {
  it('optimistically transitions block to denied', async () => {
    seedSession()
    const { result } = renderHook(() => useToolApproval('s1'))

    await act(async () => {
      await result.current.deny('tu1')
    })

    const session = useChatStore.getState().sessions['s1']
    const block = Object.values(session.messages)
      .flatMap((m) => (m.role === 'assistant' ? m.blocks : []))
      .find((b) => b.kind === 'tool_use' && b.id === 'tu1')
    expect(block?.kind === 'tool_use' && block.status).toBe('denied')
  })

  it('sends an approval IPC request with kind=deny', async () => {
    seedSession()
    const { result } = renderHook(() => useToolApproval('s1'))

    await act(async () => {
      await result.current.deny('tu1')
    })

    expect(agent.request).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'approval',
        sessionId: 's1',
        toolUseId: 'tu1',
        decision: { kind: 'deny' },
      })
    )
  })

  it('removes tu1 from pendingApprovals after deny', async () => {
    seedSession()
    const { result } = renderHook(() => useToolApproval('s1'))

    await act(async () => {
      await result.current.deny('tu1')
    })

    expect(useChatStore.getState().sessions['s1'].pendingApprovals).not.toContain('tu1')
  })
})

// ---------------------------------------------------------------------------
// useToolApproval — decide (direct)
// ---------------------------------------------------------------------------

describe('useToolApproval — decide', () => {
  it('forwards arbitrary decision to IPC', async () => {
    seedSession()
    const { result } = renderHook(() => useToolApproval('s1'))

    await act(async () => {
      await result.current.decide('tu1', { kind: 'allow', remember: 'session' })
    })

    expect(agent.request).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: { kind: 'allow', remember: 'session' },
      })
    )
  })

  it('does not throw when window.marvin is unavailable', async () => {
    Object.defineProperty(globalThis, 'window', {
      value: {},
      writable: true,
      configurable: true,
    })
    seedSession()
    const { result } = renderHook(() => useToolApproval('s1'))

    await expect(
      act(async () => {
        await result.current.decide('tu1', { kind: 'allow' })
      })
    ).resolves.not.toThrow()
  })

  it('does not throw when IPC request rejects', async () => {
    agent.request.mockRejectedValueOnce(new Error('IPC failure'))
    seedSession()
    const { result } = renderHook(() => useToolApproval('s1'))

    await expect(
      act(async () => {
        await result.current.deny('tu1')
      })
    ).resolves.not.toThrow()
  })

  it('IPC is called exactly once per decision', async () => {
    seedSession()
    const { result } = renderHook(() => useToolApproval('s1'))

    await act(async () => {
      await result.current.allow('tu1')
    })

    expect(agent.request).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// useToolApproval — concurrent approvals
// ---------------------------------------------------------------------------

describe('useToolApproval — concurrent approvals', () => {
  it('handles two pending tools independently', async () => {
    useChatStore.getState().startSession('s1', 'claude', '/vault')
    useChatStore.getState().applyStreamEvent('s1', {
      type: 'message-start',
      sessionId: 's1',
      messageId: 'm1',
      role: 'assistant',
    })
    useChatStore.getState().applyStreamEvent('s1', {
      type: 'permission-request',
      sessionId: 's1',
      toolUseId: 'tu1',
      toolName: 'Bash',
      input: {},
      risk: 'safe',
      suggestion: 'review',
    })
    useChatStore.getState().applyStreamEvent('s1', {
      type: 'permission-request',
      sessionId: 's1',
      toolUseId: 'tu2',
      toolName: 'Write',
      input: {},
      risk: 'destructive',
      suggestion: 'review',
    })

    const { result } = renderHook(() => useToolApproval('s1'))

    await act(async () => {
      await result.current.allow('tu1')
    })
    await act(async () => {
      await result.current.deny('tu2')
    })

    const session = useChatStore.getState().sessions['s1']
    const blocks = Object.values(session.messages)
      .flatMap((m) => (m.role === 'assistant' ? m.blocks : []))
      .filter((b) => b.kind === 'tool_use')

    const tu1 = blocks.find((b) => b.kind === 'tool_use' && b.id === 'tu1')
    const tu2 = blocks.find((b) => b.kind === 'tool_use' && b.id === 'tu2')

    expect(tu1?.kind === 'tool_use' && tu1.status).toBe('running')
    expect(tu2?.kind === 'tool_use' && tu2.status).toBe('denied')
    expect(session.pendingApprovals).toHaveLength(0)
  })

  it('denying first does not affect second pending approval', async () => {
    useChatStore.getState().startSession('s1', 'claude', '/vault')
    useChatStore.getState().applyStreamEvent('s1', {
      type: 'message-start',
      sessionId: 's1',
      messageId: 'm1',
      role: 'assistant',
    })
    useChatStore.getState().applyStreamEvent('s1', {
      type: 'permission-request',
      sessionId: 's1',
      toolUseId: 'tu1',
      toolName: 'Bash',
      input: {},
      risk: 'safe',
      suggestion: 'review',
    })
    useChatStore.getState().applyStreamEvent('s1', {
      type: 'permission-request',
      sessionId: 's1',
      toolUseId: 'tu2',
      toolName: 'Write',
      input: {},
      risk: 'destructive',
      suggestion: 'review',
    })

    const { result } = renderHook(() => useToolApproval('s1'))

    await act(async () => {
      await result.current.deny('tu1')
    })

    // tu2 still pending
    expect(useChatStore.getState().sessions['s1'].pendingApprovals).toContain('tu2')
    const session = useChatStore.getState().sessions['s1']
    const tu2 = Object.values(session.messages)
      .flatMap((m) => (m.role === 'assistant' ? m.blocks : []))
      .find((b) => b.kind === 'tool_use' && b.id === 'tu2')
    expect(tu2?.kind === 'tool_use' && tu2.status).toBe('pending_approval')
  })
})
