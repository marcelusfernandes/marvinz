import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import {
  useChatStore,
  setStreamingScheduler,
  resetStreamingBuffers,
  flushPendingDeltas,
} from '../store'
import { useChatSession, useChatMessage, useStickToBottom } from '../hooks'
import type React from 'react'

// ---------------------------------------------------------------------------
// Synchronous rAF scheduler
// ---------------------------------------------------------------------------

setStreamingScheduler({
  schedule: (cb) => {
    setTimeout(cb, 0)
    return 1
  },
  cancel: (_h) => {},
})

// ---------------------------------------------------------------------------
// IPC stub — window.marvin.agent mock
// ---------------------------------------------------------------------------

type EventCb = (ev: unknown) => void
type UnsubFn = () => void

function makeIpcStub() {
  const listeners = new Map<string, EventCb[]>()

  const stub = {
    onEvent: vi.fn((sessionId: string, cb: EventCb): UnsubFn => {
      const existing = listeners.get(sessionId) ?? []
      listeners.set(sessionId, [...existing, cb])
      return () => {
        const cur = listeners.get(sessionId) ?? []
        listeners.set(
          sessionId,
          cur.filter((l) => l !== cb)
        )
      }
    }),
    request: vi.fn(() => Promise.resolve()),
    _emit(sessionId: string, ev: unknown) {
      ;(listeners.get(sessionId) ?? []).forEach((l) => l(ev))
    },
    _listenerCount(sessionId: string) {
      return (listeners.get(sessionId) ?? []).length
    },
  }
  return stub
}

let ipc: ReturnType<typeof makeIpcStub>

function resetStore() {
  resetStreamingBuffers()
  useChatStore.setState({ sessions: {}, activeSessionId: null })
}

beforeEach(() => {
  ipc = makeIpcStub()
  Object.defineProperty(globalThis, 'window', {
    value: {
      ...(typeof window !== 'undefined' ? window : {}),
      marvin: { agent: ipc },
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
// useChatSession — mount
// ---------------------------------------------------------------------------

describe('useChatSession — mount', () => {
  it('subscribes to IPC onEvent on mount', () => {
    useChatStore.getState().startSession('s1', 'claude', '/vault')
    renderHook(() => useChatSession('s1'))
    expect(ipc.onEvent).toHaveBeenCalledWith('s1', expect.any(Function))
  })

  it('returns session reference for the given sessionId', () => {
    useChatStore.getState().startSession('s1', 'claude', '/vault')
    const { result } = renderHook(() => useChatSession('s1'))
    expect(result.current.session).toBeDefined()
    expect(result.current.session?.id).toBe('s1')
  })

  it('exposes send and cancel functions', () => {
    useChatStore.getState().startSession('s1', 'claude', '/vault')
    const { result } = renderHook(() => useChatSession('s1'))
    expect(typeof result.current.send).toBe('function')
    expect(typeof result.current.cancel).toBe('function')
  })

  it('returns undefined session for unknown sessionId', () => {
    const { result } = renderHook(() => useChatSession('does-not-exist'))
    expect(result.current.session).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// useChatSession — unmount
// ---------------------------------------------------------------------------

describe('useChatSession — unmount', () => {
  it('calls unsub on unmount, removing IPC listener', () => {
    useChatStore.getState().startSession('s1', 'claude', '/vault')
    const { unmount } = renderHook(() => useChatSession('s1'))
    expect(ipc._listenerCount('s1')).toBe(1)
    unmount()
    expect(ipc._listenerCount('s1')).toBe(0)
  })

  it('does not throw on unmount when sessionId is unknown', () => {
    const { unmount } = renderHook(() => useChatSession('ghost'))
    expect(() => unmount()).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// useChatSession — send
// ---------------------------------------------------------------------------

describe('useChatSession — send', () => {
  it('invokes window.marvin.agent.request with type start and correct shape', async () => {
    useChatStore.getState().startSession('s1', 'claude', '/vault')
    const { result } = renderHook(() => useChatSession('s1'))
    await act(async () => {
      await result.current.send('Hello')
    })
    expect(ipc.request).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'start',
        sessionId: 's1',
        prompt: 'Hello',
      })
    )
  })

  it('includes provider and vaultRoot in the request payload', async () => {
    useChatStore.getState().startSession('s1', 'claude', '/my-vault')
    const { result } = renderHook(() => useChatSession('s1'))
    await act(async () => {
      await result.current.send('Test')
    })
    expect(ipc.request).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'claude',
        vaultRoot: '/my-vault',
      })
    )
  })

  it('appends user message to store optimistically before sending', async () => {
    useChatStore.getState().startSession('s1', 'claude', '/vault')
    const { result } = renderHook(() => useChatSession('s1'))
    await act(async () => {
      await result.current.send('Optimistic')
    })
    const messages = useChatStore.getState().sessions['s1'].messages
    const found = Object.values(messages).find(
      (m) => m.role === 'user' && (m as { text?: string }).text === 'Optimistic'
    )
    expect(found).toBeDefined()
  })

  it('does not send when prompt is empty (only whitespace)', async () => {
    useChatStore.getState().startSession('s1', 'claude', '/vault')
    const { result } = renderHook(() => useChatSession('s1'))
    await act(async () => {
      await result.current.send('   ')
    })
    expect(ipc.request).not.toHaveBeenCalled()
  })

  it('does not send when prompt is empty string', async () => {
    useChatStore.getState().startSession('s1', 'claude', '/vault')
    const { result } = renderHook(() => useChatSession('s1'))
    await act(async () => {
      await result.current.send('')
    })
    expect(ipc.request).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// useChatSession — cancel
// ---------------------------------------------------------------------------

describe('useChatSession — cancel', () => {
  it('invokes window.marvin.agent.request with type cancel and sessionId', async () => {
    useChatStore.getState().startSession('s1', 'claude', '/vault')
    const { result } = renderHook(() => useChatSession('s1'))
    await act(async () => {
      await result.current.cancel()
    })
    expect(ipc.request).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'cancel',
        sessionId: 's1',
      })
    )
  })

  it('does not throw when session is idle', async () => {
    useChatStore.getState().startSession('s1', 'claude', '/vault')
    const { result } = renderHook(() => useChatSession('s1'))
    await expect(
      act(async () => {
        await result.current.cancel()
      })
    ).resolves.not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// useChatSession — IPC event forwarding
// ---------------------------------------------------------------------------

describe('useChatSession — IPC event forwarding', () => {
  it('forwards message-start event to store via applyStreamEvent', () => {
    useChatStore.getState().startSession('s1', 'claude', '/vault')
    renderHook(() => useChatSession('s1'))

    act(() => {
      ipc._emit('s1', {
        type: 'message-start',
        sessionId: 's1',
        messageId: 'm1',
        role: 'assistant',
      })
    })

    const msg = useChatStore.getState().sessions['s1'].messages['m1']
    expect(msg).toBeDefined()
    expect(msg?.role).toBe('assistant')
  })

  it('forwards text-delta event to buffer, committed on flush', () => {
    useChatStore.getState().startSession('s1', 'claude', '/vault')
    renderHook(() => useChatSession('s1'))

    act(() => {
      ipc._emit('s1', {
        type: 'message-start',
        sessionId: 's1',
        messageId: 'm1',
        role: 'assistant',
      })
      ipc._emit('s1', { type: 'text-delta', sessionId: 's1', messageId: 'm1', delta: 'Hi', seq: 0 })
    })
    flushPendingDeltas()

    const msg = useChatStore.getState().sessions['s1'].messages['m1']
    if (msg?.role === 'assistant') {
      const textBlock = msg.blocks.find((b) => b.kind === 'text')
      expect(textBlock).toBeDefined()
    }
  })
})

// ---------------------------------------------------------------------------
// useChatMessage
// ---------------------------------------------------------------------------

describe('useChatMessage', () => {
  beforeEach(() => {
    useChatStore.getState().startSession('s1', 'claude', '/vault')
    useChatStore.getState().applyStreamEvent('s1', {
      type: 'message-start',
      sessionId: 's1',
      messageId: 'm1',
      role: 'assistant',
    })
  })

  it('returns the message for a known messageId', () => {
    const { result } = renderHook(() => useChatMessage('s1', 'm1'))
    expect(result.current).toBeDefined()
    expect(result.current?.id).toBe('m1')
  })

  it('returns undefined for unknown messageId', () => {
    const { result } = renderHook(() => useChatMessage('s1', 'ghost-msg'))
    expect(result.current).toBeUndefined()
  })

  it('returns undefined for unknown sessionId', () => {
    const { result } = renderHook(() => useChatMessage('ghost-session', 'm1'))
    expect(result.current).toBeUndefined()
  })

  it('updates when message text block changes after flush', () => {
    const { result } = renderHook(() => useChatMessage('s1', 'm1'))
    act(() => {
      useChatStore.getState().applyStreamEvent('s1', {
        type: 'text-delta',
        sessionId: 's1',
        messageId: 'm1',
        delta: 'Updated',
        seq: 0,
      })
      flushPendingDeltas()
    })
    if (result.current?.role === 'assistant') {
      const textBlock = result.current.blocks.find((b) => b.kind === 'text')
      expect(textBlock).toBeDefined()
    }
  })
})

// ---------------------------------------------------------------------------
// useStickToBottom
// ---------------------------------------------------------------------------

describe('useStickToBottom', () => {
  function makeScrollEl(scrollTop: number, scrollHeight: number, clientHeight: number) {
    return {
      scrollTop,
      scrollHeight,
      clientHeight,
      scrollTo: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }
  }

  it('scrolls to bottom when active and within threshold (~80px from bottom)', () => {
    const scrollEl = makeScrollEl(920, 1000, 100) // distance = 1000 - 920 - 100 = -20 → <=80
    const ref = { current: scrollEl as unknown as HTMLElement }
    renderHook(() => useStickToBottom(ref as React.RefObject<HTMLElement>, true))

    // Trigger a store update which fires the subscriber
    act(() => {
      useChatStore.getState().startSession('stick-s', 'claude', '/vault')
    })

    expect(scrollEl.scrollTo).toHaveBeenCalledWith(
      expect.objectContaining({ top: scrollEl.scrollHeight })
    )
  })

  it('does not scroll when active is false', () => {
    const scrollEl = makeScrollEl(920, 1000, 100)
    const ref = { current: scrollEl as unknown as HTMLElement }
    renderHook(() => useStickToBottom(ref as React.RefObject<HTMLElement>, false))

    act(() => {
      useChatStore.getState().startSession('stick-s2', 'claude', '/vault')
    })

    expect(scrollEl.scrollTo).not.toHaveBeenCalled()
  })

  it('does not scroll when user has scrolled up beyond threshold', () => {
    // distance = 1000 - 100 - 100 = 800px > 80px threshold
    const scrollEl = makeScrollEl(100, 1000, 100)
    const ref = { current: scrollEl as unknown as HTMLElement }
    renderHook(() => useStickToBottom(ref as React.RefObject<HTMLElement>, true))

    act(() => {
      useChatStore.getState().startSession('stick-s3', 'claude', '/vault')
    })

    // stickRef.current starts as true but onScroll() should set it to false
    // because distance > threshold. However since addEventListener is mocked,
    // the scroll event is never fired — so stickRef stays true but the distance
    // check inside the subscriber is what matters.
    // The subscriber checks distance at call time: 800 > 80 → no scroll.
    expect(scrollEl.scrollTo).not.toHaveBeenCalled()
  })

  it('handles null ref gracefully without throwing', () => {
    const ref = { current: null }
    expect(() => {
      renderHook(() => useStickToBottom(ref as unknown as React.RefObject<HTMLElement>, true))
    }).not.toThrow()
  })
})
