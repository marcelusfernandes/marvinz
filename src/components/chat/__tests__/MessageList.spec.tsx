import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
// Count UserBubble renders through a thin wrapper around the real component,
// so the memoization test below sees exactly when a row re-renders.
const bubbleRenders = vi.hoisted(() => ({ count: 0 }))
vi.mock('../UserBubble', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../UserBubble')>()
  return {
    ...actual,
    UserBubble: (props: Parameters<typeof actual.UserBubble>[0]) => {
      bubbleRenders.count += 1
      return <actual.UserBubble {...props} />
    },
  }
})

import { MessageList } from '../MessageList'
import { useChatStore } from '../../../lib/chat/store'
import type { SessionId } from '../../../lib/chat/types'

const SID = 's1' as SessionId

function resetStore() {
  useChatStore.setState({ sessions: {}, activeSessionId: null })
}

describe('MessageList', () => {
  beforeEach(() => {
    resetStore()
    bubbleRenders.count = 0
    // jsdom has no scrollTo; useStickToBottom calls it when the list grows.
    Element.prototype.scrollTo = vi.fn()
  })

  it('renders the empty state when the session has no messages', () => {
    useChatStore.getState().startSession(SID, 'claude', '/vault')
    render(<MessageList sessionId={SID} />)
    expect(screen.getByText('Start a conversation')).toBeInTheDocument()
    expect(screen.queryByRole('log')).not.toBeInTheDocument()
  })

  it('renders the empty state when the session does not exist', () => {
    render(<MessageList sessionId={'missing' as SessionId} />)
    expect(screen.getByText('Start a conversation')).toBeInTheDocument()
  })

  it('renders a log list with a user message row', () => {
    const store = useChatStore.getState()
    store.startSession(SID, 'claude', '/vault')
    store.appendUserMessage(SID, 'hello marvin')

    render(<MessageList sessionId={SID} />)
    const log = screen.getByRole('log')
    expect(log).toBeInTheDocument()
    expect(log).toHaveAttribute('aria-live', 'polite')
    expect(screen.getByText('hello marvin')).toBeInTheDocument()
  })

  it('renders one row per message in order', () => {
    const store = useChatStore.getState()
    store.startSession(SID, 'claude', '/vault')
    store.appendUserMessage(SID, 'first')
    store.appendUserMessage(SID, 'second')

    const { container } = render(<MessageList sessionId={SID} />)
    const rows = container.querySelectorAll('.chat-message-row')
    expect(rows).toHaveLength(2)
    expect(screen.getByText('first')).toBeInTheDocument()
    expect(screen.getByText('second')).toBeInTheDocument()
  })

  it('does not re-render existing rows when an unrelated message is appended (#648)', () => {
    const store = useChatStore.getState()
    store.startSession(SID, 'claude', '/vault')
    store.appendUserMessage(SID, 'one')
    store.appendUserMessage(SID, 'two')
    const onRewind = vi.fn()
    render(<MessageList sessionId={SID} onRewind={onRewind} />)
    expect(bubbleRenders.count).toBe(2)

    // Ordering changes, so MessageList itself re-renders; the two existing
    // rows must not, or React.memo on MessageRow is doing nothing.
    useChatStore.getState().appendUserMessage(SID, 'three')

    expect(screen.getByText('three')).toBeInTheDocument()
    expect(bubbleRenders.count).toBe(3)
  })
})
