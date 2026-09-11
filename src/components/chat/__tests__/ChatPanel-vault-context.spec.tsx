// @vitest-environment jsdom
//
// Issue #618 (ChatPanel/Composer chain of #581's vaultPath drilling removal).
// Written BEFORE react-dev migrates ChatPanel/Composer off the vaultPath
// prop, against the CURRENT code — ChatPanel and Composer still take
// vaultPath as a prop today. Rendered inside AppProvider (renderWithAppContext)
// so this net stays valid once they read useAppContext() instead, mirroring
// the strategy used for the 4 components in #581.
//
// The switch tests (#2, #3, #4) pass the new vaultPath to BOTH the JSX prop
// (still required today) and renderWithAppContext's rerender(ui, {vaultPath})
// context override, kept in sync. Once ChatPanel/Composer drop the prop,
// react-dev's mechanical JSX-prop-removal pass (the same edit applied to
// every other call site) can strip the now-unwanted vaultPath="..." attribute
// from these render/rerender calls too — the context override already
// threaded through keeps the assertions valid without a test rewrite.
//
// Covers:
//   1. A session captures the vaultPath current at its creation
//      (ChatPanel's startSession effect is gated on `!exists`, so this only
//      fires once per sessionId) — parity/characterization of today's
//      behavior, not a new guarantee.
//   2. A NEW session opened after a vault switch picks up the NEW vaultPath
//      (the "startSession must use the new vaultPath post-switch" case).
//   3. An EXISTING session's stored vaultPath is untouched by a later switch
//      (the flip side of #2 — documents the idempotent-startSession
//      boundary so it isn't silently widened or narrowed by the eventual
//      context migration).
//   4. Composer's drop handler (reached through ChatPanel, not in isolation)
//      uses the vaultPath current AT THE MOMENT OF THE DROP EVENT, not the
//      value captured at initial mount — the stale-closure risk flagged for
//      #618. Asserted by switching vaultPath on an already-mounted
//      ChatPanel/Composer instance (real store, no setDraft mock) and firing
//      the drop only after that switch has rendered.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from '@testing-library/react'
import { forwardRef } from 'react'
import { renderWithAppContext } from '../../__tests__/renderWithAppContext'
import { useChatStore, resetStreamingBuffers } from '../../../lib/chat/store'

// ---------------------------------------------------------------------------
// Mocks — heavy/unrelated children stubbed; Composer renders for real (its
// drop handler is what test #4 exercises).
// ---------------------------------------------------------------------------

vi.mock('../ChatHeader', () => ({ ChatHeader: () => null }))
vi.mock('../MessageList', () => ({ MessageList: () => null }))
vi.mock('../Icon', () => ({ Icon: () => null }))
vi.mock('../ModePill', () => ({
  ModePill: forwardRef(() => null),
  MODE_OPTIONS: [{ value: 'default', label: 'Ask before edits', hint: '' }],
}))
vi.mock('../ModesPicker', () => ({ ModesPicker: () => null }))

import { ChatPanel } from '../ChatPanel'

// ---------------------------------------------------------------------------
// window.marvin.agent stub — needed by useChatSession's IPC bridge and
// ChatPanel's turn-snapshot-summary listener.
// ---------------------------------------------------------------------------

function setupAgentStub() {
  Object.assign(window, {
    marvin: {
      agent: {
        onEvent: vi.fn(() => () => {}),
        request: vi.fn(() => Promise.resolve({ ok: true as const })),
      },
    },
  })
}

function resetStore() {
  resetStreamingBuffers()
  useChatStore.setState({ sessions: {}, activeSessionId: null })
}

function getComposer(): HTMLElement {
  return document.querySelector('.chat-composer') as HTMLElement
}

function makeDropEvent(internalPath: string) {
  const event = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent
  Object.defineProperty(event, 'dataTransfer', {
    value: {
      types: ['application/x-marvin-path'],
      dropEffect: 'none',
      getData: (k: string) => (k === 'application/x-marvin-path' ? internalPath : ''),
    },
    writable: false,
  })
  Object.defineProperty(event, 'preventDefault', { value: vi.fn(), writable: false })
  Object.defineProperty(event, 'stopPropagation', { value: vi.fn(), writable: false })
  return event
}

beforeEach(() => {
  setupAgentStub()
  resetStore()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// 1-3. startSession vaultPath capture across a switch
// ---------------------------------------------------------------------------

describe('ChatPanel — startSession vaultPath capture (#618)', () => {
  it('a new session captures the vaultPath current at creation', async () => {
    renderWithAppContext(<ChatPanel sessionId="s1" provider="claude" />, {
      vaultPath: '/vault-a',
    })
    await act(async () => {})

    expect(useChatStore.getState().sessions['s1']?.vaultPath).toBe('/vault-a')
  })

  it('a new session opened after a vault switch picks up the new vaultPath', async () => {
    const { rerender } = renderWithAppContext(<ChatPanel sessionId="s1" provider="claude" />, {
      vaultPath: '/vault-a',
    })
    await act(async () => {})
    expect(useChatStore.getState().sessions['s1']?.vaultPath).toBe('/vault-a')

    // Vault switch + a NEW chat tab (new sessionId) opened after it. Passes
    // vaultPath: '/vault-b' to BOTH the JSX prop (still required today) and
    // rerender's context override, so this stays a real switch once
    // ChatPanel drops the prop and only the context arg remains.
    await act(async () => {
      rerender(<ChatPanel sessionId="s2" provider="claude" />, {
        vaultPath: '/vault-b',
      })
    })

    expect(useChatStore.getState().sessions['s2']?.vaultPath).toBe('/vault-b')
  })

  it("an existing session's stored vaultPath is untouched by a later switch (idempotent startSession)", async () => {
    const { rerender } = renderWithAppContext(<ChatPanel sessionId="s1" provider="claude" />, {
      vaultPath: '/vault-a',
    })
    await act(async () => {})
    expect(useChatStore.getState().sessions['s1']?.vaultPath).toBe('/vault-a')

    // Same session, vault switches underneath it — startSession is gated on
    // `!exists`, so the already-created session keeps its original vaultPath.
    await act(async () => {
      rerender(<ChatPanel sessionId="s1" provider="claude" />, {
        vaultPath: '/vault-b',
      })
    })

    expect(useChatStore.getState().sessions['s1']?.vaultPath).toBe('/vault-a')
  })
})

// ---------------------------------------------------------------------------
// 4. Composer's drop handler — no stale closure across a switch
// ---------------------------------------------------------------------------

describe("ChatPanel -> Composer's drop handler — live vaultPath, no stale closure (#618)", () => {
  it('a drop that would no-op with no vault succeeds after switching to a real vault', async () => {
    const { rerender } = renderWithAppContext(<ChatPanel sessionId="s1" provider="claude" />, {
      vaultPath: null,
    })
    await act(async () => {})

    await act(async () => {
      getComposer().dispatchEvent(makeDropEvent('/vault-b/note.md'))
    })
    // No vault open — the drop must no-op (Composer's own vaultPath guard).
    expect(useChatStore.getState().sessions['s1']?.composer.draft).toBe('')

    // Switch to a real vault on the SAME mounted instance, then drop again —
    // asserting on the value live at THIS event, not the empty one captured
    // when the component first mounted.
    await act(async () => {
      rerender(<ChatPanel sessionId="s1" provider="claude" />, {
        vaultPath: '/vault-b',
      })
    })

    await act(async () => {
      getComposer().dispatchEvent(makeDropEvent('/vault-b/note.md'))
    })

    expect(useChatStore.getState().sessions['s1']?.composer.draft).toBe('/vault-b/note.md ')
  })

  it('a drop that would succeed with a vault open no-ops after switching to no vault', async () => {
    const { rerender } = renderWithAppContext(<ChatPanel sessionId="s1" provider="claude" />, {
      vaultPath: '/vault-a',
    })
    await act(async () => {})

    await act(async () => {
      rerender(<ChatPanel sessionId="s1" provider="claude" />, { vaultPath: null })
    })

    await act(async () => {
      getComposer().dispatchEvent(makeDropEvent('/vault-a/note.md'))
    })

    expect(useChatStore.getState().sessions['s1']?.composer.draft).toBe('')
  })
})
