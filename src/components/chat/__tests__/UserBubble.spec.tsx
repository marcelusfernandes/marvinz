import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { UserBubble } from '../UserBubble'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function shortText() {
  return 'Hello world'
}

function longText(lines = 7) {
  return Array.from({ length: lines }, (_, i) => `Line ${i + 1}`).join('\n')
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe('UserBubble — rendering', () => {
  it('renders the text content', () => {
    render(<UserBubble text="Hello world" />)
    expect(screen.getByText('Hello world')).toBeInTheDocument()
  })

  it('renders the rewind button with aria-label', () => {
    render(<UserBubble text="Hello" />)
    const btn = screen.getByRole('button', { name: /rewind to this message/i })
    expect(btn).toBeInTheDocument()
  })

  it('rewind button is disabled when no onRewind prop provided', () => {
    render(<UserBubble text="Hello" />)
    const btn = screen.getByRole('button', { name: /rewind to this message/i })
    expect(btn).toBeDisabled()
  })

  it('rewind button is enabled when onRewind prop is provided with a turnId', () => {
    render(<UserBubble text="Hello" turnId="t1" onRewind={() => {}} />)
    const btn = screen.getByRole('button', { name: /rewind to this message/i })
    expect(btn).not.toBeDisabled()
  })

  it('rewind button is disabled when onRewind is provided but turnId is missing', () => {
    render(<UserBubble text="Hello" onRewind={() => {}} />)
    const btn = screen.getByRole('button', { name: /rewind to this message/i })
    expect(btn).toBeDisabled()
  })

  it('uses chat-bubble-user class on the container', () => {
    const { container } = render(<UserBubble text="Hello" />)
    expect(container.querySelector('.chat-bubble-user')).toBeInTheDocument()
  })

  it('renders body in chat-bubble-body element', () => {
    const { container } = render(<UserBubble text="Hello world" />)
    const body = container.querySelector('.chat-bubble-body')
    expect(body).toBeInTheDocument()
    expect(body?.textContent).toContain('Hello world')
  })
})

// ---------------------------------------------------------------------------
// Show more / less toggle
// ---------------------------------------------------------------------------

describe('UserBubble — show more/less', () => {
  it('does not show toggle button when text is short (≤5 lines)', () => {
    render(<UserBubble text={shortText()} />)
    expect(screen.queryByRole('button', { name: /show more/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /show less/i })).not.toBeInTheDocument()
  })

  it('shows "Show more" toggle button when text exceeds 5 lines', () => {
    render(<UserBubble text={longText(7)} />)
    expect(screen.getByRole('button', { name: /show more/i })).toBeInTheDocument()
  })

  it('starts collapsed when text exceeds 5 lines', () => {
    const { container } = render(<UserBubble text={longText(7)} />)
    const body = container.querySelector('.chat-bubble-body')
    expect(body?.classList.contains('collapsed')).toBe(true)
  })

  it('expands on "Show more" click and shows "Show less"', () => {
    render(<UserBubble text={longText(7)} />)
    const toggle = screen.getByRole('button', { name: /show more/i })
    fireEvent.click(toggle)
    expect(screen.getByRole('button', { name: /show less/i })).toBeInTheDocument()
  })

  it('removes collapsed class after expanding', () => {
    const { container } = render(<UserBubble text={longText(7)} />)
    const toggle = screen.getByRole('button', { name: /show more/i })
    fireEvent.click(toggle)
    const body = container.querySelector('.chat-bubble-body')
    expect(body?.classList.contains('collapsed')).toBe(false)
  })

  it('collapses again on "Show less" click', () => {
    render(<UserBubble text={longText(7)} />)
    fireEvent.click(screen.getByRole('button', { name: /show more/i }))
    fireEvent.click(screen.getByRole('button', { name: /show less/i }))
    expect(screen.getByRole('button', { name: /show more/i })).toBeInTheDocument()
  })

  it('text at exactly 5 lines does not trigger toggle (not > 5)', () => {
    render(<UserBubble text={longText(5)} />)
    expect(screen.queryByRole('button', { name: /show more/i })).not.toBeInTheDocument()
  })

  it('text at exactly 6 lines triggers toggle (> 5)', () => {
    render(<UserBubble text={longText(6)} />)
    expect(screen.getByRole('button', { name: /show more/i })).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Rewind callback
// ---------------------------------------------------------------------------

describe('UserBubble — rewind', () => {
  it('calls onRewind with the turnId when rewind button is clicked', () => {
    let receivedTurn: string | undefined
    render(
      <UserBubble
        text="Hello"
        turnId="turn-123"
        onRewind={(turnId) => {
          receivedTurn = turnId
        }}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /rewind to this message/i }))
    expect(receivedTurn).toBe('turn-123')
  })
})
