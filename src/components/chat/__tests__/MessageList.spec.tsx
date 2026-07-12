import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MessageList } from '../MessageList'
import { useChatStore } from '../../../lib/chat/store'
import type { SessionId } from '../../../lib/chat/types'

const SID = 's1' as SessionId

function resetStore() {
  useChatStore.setState({ sessions: {}, activeSessionId: null })
}

describe('MessageList', () => {
  beforeEach(resetStore)

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
})
