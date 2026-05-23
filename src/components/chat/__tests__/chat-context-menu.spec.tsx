/**
 * Tests for native context menus on UserBubble and AssistantMessageCard (issue #177).
 *
 * Strategy:
 *  - Render each component directly with controlled props.
 *  - Fire contextmenu events and assert window.marvin.app.showContextMenu is
 *    called with the correct MenuItemSpec[] in order.
 *  - Mock the IPC response to each action id and assert the correct handler
 *    fires (writeClipboard, setComposerDraft, onRewind).
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, act } from '@testing-library/react'

vi.mock('../Icon', () => ({ Icon: () => null }))
vi.mock('../StreamingMarkdown', () => ({
  StreamingMarkdown: ({ text }: { text: string }) => <span>{text}</span>,
}))
vi.mock('../TimelineItem', () => ({
  TimelineItem: ({ children }: { children: React.ReactNode }) => <li>{children}</li>,
}))
vi.mock('../ToolApprovalGate', () => ({ ToolApprovalGate: () => null }))
vi.mock('../tool-bodies', () => ({ ToolBody: () => null }))
vi.mock('../../../lib/chat/useToolApproval', () => ({
  useToolApproval: () => ({ decide: vi.fn() }),
}))

// ---------------------------------------------------------------------------
// Chat store mock — isolate setComposerDraft
// ---------------------------------------------------------------------------

const setComposerDraftMock = vi.fn()
const getSessionsMock = vi.fn().mockReturnValue({})

vi.mock('../../../lib/chat/store', () => ({
  useChatStore: Object.assign(
    (selector: (s: { sessions: Record<string, unknown> }) => unknown) =>
      selector({ sessions: {} }),
    {
      getState: () => ({
        sessions: getSessionsMock(),
        setComposerDraft: setComposerDraftMock,
      }),
    },
  ),
}))

// ---------------------------------------------------------------------------
// window.marvin mock
// ---------------------------------------------------------------------------

type MenuItemSpec =
  | { kind: 'item'; id: string; label: string; enabled?: boolean }
  | { kind: 'separator' }

let showContextMenuMock: ReturnType<typeof vi.fn>
let writeClipboardMock: ReturnType<typeof vi.fn>

function setupMarvinMock() {
  showContextMenuMock = vi.fn().mockResolvedValue(null)
  writeClipboardMock = vi.fn().mockResolvedValue(undefined)
  Object.assign(window, {
    marvin: {
      app: { showContextMenu: showContextMenuMock },
      editor: { writeClipboard: writeClipboardMock },
    },
  })
}

// ---------------------------------------------------------------------------
// Import components after mocks
// ---------------------------------------------------------------------------

import { UserBubble } from '../UserBubble'
import { AssistantMessageCard } from '../AssistantMessageCard'
import type { AssistantMessage } from '../../../lib/chat/types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getItems(): MenuItemSpec[] {
  return showContextMenuMock.mock.calls[0][0] as MenuItemSpec[]
}

function fakeAssistantMessage(text = 'Hello from assistant'): AssistantMessage {
  return {
    id: 'msg-1',
    role: 'assistant',
    blocks: [{ kind: 'text', id: 'b1', text }],
    createdAt: Date.now(),
    done: true,
  }
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  setupMarvinMock()
  setComposerDraftMock.mockClear()
  getSessionsMock.mockReturnValue({})
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// UserBubble — IPC payload
// ---------------------------------------------------------------------------

describe('UserBubble — context menu IPC payload', () => {
  it('calls showContextMenu once on right-click', async () => {
    const { container } = render(
      <UserBubble text="Hello" turnId="t1" onRewind={() => {}} sessionId="s1" />,
    )
    await act(async () => {
      fireEvent.contextMenu(container.querySelector('.chat-bubble-user')!)
      await new Promise((r) => setTimeout(r, 10))
    })
    expect(showContextMenuMock).toHaveBeenCalledTimes(1)
  })

  it('first item is copy with id "copy"', async () => {
    const { container } = render(
      <UserBubble text="Hello" turnId="t1" onRewind={() => {}} sessionId="s1" />,
    )
    await act(async () => {
      fireEvent.contextMenu(container.querySelector('.chat-bubble-user')!)
      await new Promise((r) => setTimeout(r, 10))
    })
    const first = getItems()[0] as Extract<MenuItemSpec, { kind: 'item' }>
    expect(first.kind).toBe('item')
    expect(first.id).toBe('copy')
  })

  it('second item is quote with id "quote"', async () => {
    const { container } = render(
      <UserBubble text="Hello" turnId="t1" onRewind={() => {}} sessionId="s1" />,
    )
    await act(async () => {
      fireEvent.contextMenu(container.querySelector('.chat-bubble-user')!)
      await new Promise((r) => setTimeout(r, 10))
    })
    const second = getItems()[1] as Extract<MenuItemSpec, { kind: 'item' }>
    expect(second.kind).toBe('item')
    expect(second.id).toBe('quote')
  })

  it('third item is a separator', async () => {
    const { container } = render(
      <UserBubble text="Hello" turnId="t1" onRewind={() => {}} sessionId="s1" />,
    )
    await act(async () => {
      fireEvent.contextMenu(container.querySelector('.chat-bubble-user')!)
      await new Promise((r) => setTimeout(r, 10))
    })
    expect(getItems()[2].kind).toBe('separator')
  })

  it('fourth item is rewind with id "rewind"', async () => {
    const { container } = render(
      <UserBubble text="Hello" turnId="t1" onRewind={() => {}} sessionId="s1" />,
    )
    await act(async () => {
      fireEvent.contextMenu(container.querySelector('.chat-bubble-user')!)
      await new Promise((r) => setTimeout(r, 10))
    })
    const fourth = getItems()[3] as Extract<MenuItemSpec, { kind: 'item' }>
    expect(fourth.kind).toBe('item')
    expect(fourth.id).toBe('rewind')
  })

  it('rewind item is enabled when turnId and onRewind are provided', async () => {
    const { container } = render(
      <UserBubble text="Hello" turnId="t1" onRewind={() => {}} sessionId="s1" />,
    )
    await act(async () => {
      fireEvent.contextMenu(container.querySelector('.chat-bubble-user')!)
      await new Promise((r) => setTimeout(r, 10))
    })
    const rewind = getItems()[3] as Extract<MenuItemSpec, { kind: 'item' }>
    expect(rewind.enabled).toBe(true)
  })

  it('rewind item is disabled when no onRewind prop', async () => {
    const { container } = render(<UserBubble text="Hello" sessionId="s1" />)
    await act(async () => {
      fireEvent.contextMenu(container.querySelector('.chat-bubble-user')!)
      await new Promise((r) => setTimeout(r, 10))
    })
    const rewind = getItems()[3] as Extract<MenuItemSpec, { kind: 'item' }>
    expect(rewind.enabled).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// UserBubble — copy label based on selection
// ---------------------------------------------------------------------------

describe('UserBubble — copy label', () => {
  it('label is "Copy Message" when no selection', async () => {
    vi.spyOn(window, 'getSelection').mockReturnValue({
      toString: () => '',
    } as Selection)
    const { container } = render(<UserBubble text="Hello" sessionId="s1" />)
    await act(async () => {
      fireEvent.contextMenu(container.querySelector('.chat-bubble-user')!)
      await new Promise((r) => setTimeout(r, 10))
    })
    const copy = getItems()[0] as Extract<MenuItemSpec, { kind: 'item' }>
    expect(copy.label).toBe('Copy Message')
  })

  it('label is "Copy Selection" when text is selected', async () => {
    vi.spyOn(window, 'getSelection').mockReturnValue({
      toString: () => 'selected text',
    } as Selection)
    const { container } = render(<UserBubble text="Hello world" sessionId="s1" />)
    await act(async () => {
      fireEvent.contextMenu(container.querySelector('.chat-bubble-user')!)
      await new Promise((r) => setTimeout(r, 10))
    })
    const copy = getItems()[0] as Extract<MenuItemSpec, { kind: 'item' }>
    expect(copy.label).toBe('Copy Selection')
  })
})

// ---------------------------------------------------------------------------
// UserBubble — action dispatch
// ---------------------------------------------------------------------------

describe('UserBubble — copy action', () => {
  it('calls writeClipboard with full message text when no selection', async () => {
    vi.spyOn(window, 'getSelection').mockReturnValue({ toString: () => '' } as Selection)
    showContextMenuMock.mockResolvedValue('copy')
    const { container } = render(<UserBubble text="Hello world" sessionId="s1" />)
    await act(async () => {
      fireEvent.contextMenu(container.querySelector('.chat-bubble-user')!)
      await new Promise((r) => setTimeout(r, 30))
    })
    expect(writeClipboardMock).toHaveBeenCalledWith('Hello world')
  })

  it('calls writeClipboard with selection text when text is selected', async () => {
    vi.spyOn(window, 'getSelection').mockReturnValue({
      toString: () => 'selected',
    } as Selection)
    showContextMenuMock.mockResolvedValue('copy')
    const { container } = render(<UserBubble text="Hello world" sessionId="s1" />)
    await act(async () => {
      fireEvent.contextMenu(container.querySelector('.chat-bubble-user')!)
      await new Promise((r) => setTimeout(r, 30))
    })
    expect(writeClipboardMock).toHaveBeenCalledWith('selected')
  })
})

describe('UserBubble — quote action', () => {
  it('prepends quoted text to empty composer draft', async () => {
    vi.spyOn(window, 'getSelection').mockReturnValue({ toString: () => '' } as Selection)
    showContextMenuMock.mockResolvedValue('quote')
    getSessionsMock.mockReturnValue({ s1: { composer: { draft: '' } } })
    const { container } = render(
      <UserBubble text="Hello world" sessionId="s1" />,
    )
    await act(async () => {
      fireEvent.contextMenu(container.querySelector('.chat-bubble-user')!)
      await new Promise((r) => setTimeout(r, 30))
    })
    expect(setComposerDraftMock).toHaveBeenCalledWith('s1', '> Hello world\n\n')
  })

  it('prepends quoted text before existing draft', async () => {
    vi.spyOn(window, 'getSelection').mockReturnValue({ toString: () => '' } as Selection)
    showContextMenuMock.mockResolvedValue('quote')
    getSessionsMock.mockReturnValue({ s1: { composer: { draft: 'existing' } } })
    const { container } = render(
      <UserBubble text="Hello" sessionId="s1" />,
    )
    await act(async () => {
      fireEvent.contextMenu(container.querySelector('.chat-bubble-user')!)
      await new Promise((r) => setTimeout(r, 30))
    })
    expect(setComposerDraftMock).toHaveBeenCalledWith('s1', '> Hello\n\nexisting')
  })
})

describe('UserBubble — rewind action', () => {
  it('calls onRewind with turnId', async () => {
    vi.spyOn(window, 'getSelection').mockReturnValue({ toString: () => '' } as Selection)
    showContextMenuMock.mockResolvedValue('rewind')
    const onRewind = vi.fn()
    const { container } = render(
      <UserBubble text="Hello" turnId="turn-abc" onRewind={onRewind} sessionId="s1" />,
    )
    await act(async () => {
      fireEvent.contextMenu(container.querySelector('.chat-bubble-user')!)
      await new Promise((r) => setTimeout(r, 30))
    })
    expect(onRewind).toHaveBeenCalledWith('turn-abc')
  })
})

// ---------------------------------------------------------------------------
// AssistantMessageCard — IPC payload
// ---------------------------------------------------------------------------

describe('AssistantMessageCard — context menu IPC payload', () => {
  it('calls showContextMenu once on right-click', async () => {
    const { container } = render(
      <AssistantMessageCard sessionId="s1" message={fakeAssistantMessage()} />,
    )
    await act(async () => {
      fireEvent.contextMenu(container.querySelector('.chat-timeline')!)
      await new Promise((r) => setTimeout(r, 10))
    })
    expect(showContextMenuMock).toHaveBeenCalledTimes(1)
  })

  it('sends 4 items (copy, quote, separator, rewind)', async () => {
    const { container } = render(
      <AssistantMessageCard sessionId="s1" message={fakeAssistantMessage()} />,
    )
    await act(async () => {
      fireEvent.contextMenu(container.querySelector('.chat-timeline')!)
      await new Promise((r) => setTimeout(r, 10))
    })
    expect(getItems()).toHaveLength(4)
  })

  it('rewind item is always disabled for assistant messages', async () => {
    const { container } = render(
      <AssistantMessageCard sessionId="s1" message={fakeAssistantMessage()} />,
    )
    await act(async () => {
      fireEvent.contextMenu(container.querySelector('.chat-timeline')!)
      await new Promise((r) => setTimeout(r, 10))
    })
    const rewind = getItems()[3] as Extract<MenuItemSpec, { kind: 'item' }>
    expect(rewind.id).toBe('rewind')
    expect(rewind.enabled).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// AssistantMessageCard — copy label based on selection
// ---------------------------------------------------------------------------

describe('AssistantMessageCard — copy label', () => {
  it('label is "Copy Message" when no selection', async () => {
    vi.spyOn(window, 'getSelection').mockReturnValue({ toString: () => '' } as Selection)
    const { container } = render(
      <AssistantMessageCard sessionId="s1" message={fakeAssistantMessage()} />,
    )
    await act(async () => {
      fireEvent.contextMenu(container.querySelector('.chat-timeline')!)
      await new Promise((r) => setTimeout(r, 10))
    })
    const copy = getItems()[0] as Extract<MenuItemSpec, { kind: 'item' }>
    expect(copy.label).toBe('Copy Message')
  })

  it('label is "Copy Selection" when text is selected', async () => {
    vi.spyOn(window, 'getSelection').mockReturnValue({
      toString: () => 'some text',
    } as Selection)
    const { container } = render(
      <AssistantMessageCard sessionId="s1" message={fakeAssistantMessage()} />,
    )
    await act(async () => {
      fireEvent.contextMenu(container.querySelector('.chat-timeline')!)
      await new Promise((r) => setTimeout(r, 10))
    })
    const copy = getItems()[0] as Extract<MenuItemSpec, { kind: 'item' }>
    expect(copy.label).toBe('Copy Selection')
  })
})

// ---------------------------------------------------------------------------
// AssistantMessageCard — action dispatch
// ---------------------------------------------------------------------------

describe('AssistantMessageCard — copy action', () => {
  it('calls writeClipboard with text block content', async () => {
    vi.spyOn(window, 'getSelection').mockReturnValue({ toString: () => '' } as Selection)
    showContextMenuMock.mockResolvedValue('copy')
    const { container } = render(
      <AssistantMessageCard
        sessionId="s1"
        message={fakeAssistantMessage('assistant text')}
      />,
    )
    await act(async () => {
      fireEvent.contextMenu(container.querySelector('.chat-timeline')!)
      await new Promise((r) => setTimeout(r, 30))
    })
    expect(writeClipboardMock).toHaveBeenCalledWith('assistant text')
  })
})

describe('AssistantMessageCard — quote action', () => {
  it('prepends quoted assistant text to empty composer draft', async () => {
    vi.spyOn(window, 'getSelection').mockReturnValue({ toString: () => '' } as Selection)
    showContextMenuMock.mockResolvedValue('quote')
    getSessionsMock.mockReturnValue({ s1: { composer: { draft: '' } } })
    const { container } = render(
      <AssistantMessageCard sessionId="s1" message={fakeAssistantMessage('Hi there')} />,
    )
    await act(async () => {
      fireEvent.contextMenu(container.querySelector('.chat-timeline')!)
      await new Promise((r) => setTimeout(r, 30))
    })
    expect(setComposerDraftMock).toHaveBeenCalledWith('s1', '> Hi there\n\n')
  })
})

// ---------------------------------------------------------------------------
// Null action — no side effects
// ---------------------------------------------------------------------------

describe('context menu — dismissed (null action)', () => {
  it('does not call writeClipboard when menu is dismissed', async () => {
    showContextMenuMock.mockResolvedValue(null)
    const { container } = render(<UserBubble text="Hello" sessionId="s1" />)
    await act(async () => {
      fireEvent.contextMenu(container.querySelector('.chat-bubble-user')!)
      await new Promise((r) => setTimeout(r, 30))
    })
    expect(writeClipboardMock).not.toHaveBeenCalled()
  })

  it('does not call setComposerDraft when menu is dismissed', async () => {
    showContextMenuMock.mockResolvedValue(null)
    const { container } = render(<UserBubble text="Hello" sessionId="s1" />)
    await act(async () => {
      fireEvent.contextMenu(container.querySelector('.chat-bubble-user')!)
      await new Promise((r) => setTimeout(r, 30))
    })
    expect(setComposerDraftMock).not.toHaveBeenCalled()
  })
})
