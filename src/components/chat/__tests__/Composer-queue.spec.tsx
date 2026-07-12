// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Composer } from '../Composer'
import { useChatStore } from '../../../lib/chat/store'
import type { SessionId } from '../../../lib/chat/types'

const SID = 's1' as SessionId

function resetStore() {
  useChatStore.setState({ sessions: {}, activeSessionId: null })
  useChatStore.getState().startSession(SID, 'claude', '/vault')
}

function typeInComposer(text: string) {
  const textarea = screen.getByPlaceholderText('Ask Marvin...')
  fireEvent.change(textarea, { target: { value: text } })
  return textarea
}

describe('Composer — send-while-streaming queue (C1-3)', () => {
  beforeEach(resetStore)

  it('queues the message instead of sending while streaming', () => {
    const onSend = vi.fn()
    render(<Composer sessionId={SID} onSend={onSend} vaultPath="/vault" isStreaming />)
    const textarea = typeInComposer('follow up')
    fireEvent.keyDown(textarea, { key: 'Enter' })

    expect(onSend).not.toHaveBeenCalled()
    expect(useChatStore.getState().sessions[SID].queue).toEqual(['follow up'])
  })

  it('sends immediately when not streaming', () => {
    const onSend = vi.fn()
    render(<Composer sessionId={SID} onSend={onSend} vaultPath="/vault" isStreaming={false} />)
    const textarea = typeInComposer('go now')
    fireEvent.keyDown(textarea, { key: 'Enter' })

    expect(onSend).toHaveBeenCalledWith('go now')
    expect(useChatStore.getState().sessions[SID].queue ?? []).toEqual([])
  })

  it('shows a queued-count indicator', () => {
    useChatStore.getState().enqueueMessage(SID, 'a')
    useChatStore.getState().enqueueMessage(SID, 'b')
    render(<Composer sessionId={SID} onSend={vi.fn()} vaultPath="/vault" isStreaming />)
    expect(screen.getByText('2 queued')).toBeInTheDocument()
  })

  it('disables the stop button and labels it Stopping while cancelling (C1-5)', () => {
    useChatStore.getState().appendUserMessage(SID, 'go')
    useChatStore.getState().setCancelling(SID, true)
    render(
      <Composer
        sessionId={SID}
        onSend={vi.fn()}
        onCancel={vi.fn()}
        vaultPath="/vault"
        isStreaming
      />
    )
    const btn = screen.getByRole('button', { name: /stopping/i })
    expect(btn).toBeDisabled()
  })
})
