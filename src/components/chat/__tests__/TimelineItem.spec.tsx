import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TimelineItem } from '../TimelineItem'

// ---------------------------------------------------------------------------
// Rendering — structure
// ---------------------------------------------------------------------------

describe('TimelineItem — DOM structure', () => {
  it('renders as an <li> element', () => {
    const { container } = render(<TimelineItem kind="text">Content</TimelineItem>)
    expect(container.querySelector('li')).toBeInTheDocument()
  })

  it('has chat-timeline-item class', () => {
    const { container } = render(<TimelineItem kind="text">Content</TimelineItem>)
    expect(container.querySelector('.chat-timeline-item')).toBeInTheDocument()
  })

  it('sets data-kind attribute from kind prop', () => {
    const { container } = render(<TimelineItem kind="thinking">Content</TimelineItem>)
    expect(container.querySelector('[data-kind="thinking"]')).toBeInTheDocument()
  })

  it('renders bullet dot with chat-timeline-dot class', () => {
    const { container } = render(<TimelineItem kind="text">Content</TimelineItem>)
    expect(container.querySelector('.chat-timeline-dot')).toBeInTheDocument()
  })

  it('renders body in chat-timeline-body element', () => {
    const { container } = render(<TimelineItem kind="text">Hello</TimelineItem>)
    expect(container.querySelector('.chat-timeline-body')).toBeInTheDocument()
  })

  it('renders children inside the body', () => {
    render(<TimelineItem kind="text">Timeline content</TimelineItem>)
    expect(screen.getByText('Timeline content')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// kind="thinking"
// ---------------------------------------------------------------------------

describe('TimelineItem — kind thinking', () => {
  it('sets data-kind="thinking"', () => {
    const { container } = render(<TimelineItem kind="thinking">Thinking…</TimelineItem>)
    expect(container.querySelector('[data-kind="thinking"]')).toBeInTheDocument()
  })

  it('dot defaults to outline state for thinking', () => {
    const { container } = render(<TimelineItem kind="thinking">Thinking…</TimelineItem>)
    expect(container.querySelector('[data-state="outline"]')).toBeInTheDocument()
  })

  it('dot is aria-hidden (decorative)', () => {
    const { container } = render(<TimelineItem kind="thinking">Thinking…</TimelineItem>)
    const dot = container.querySelector('.chat-timeline-dot')
    expect(dot?.getAttribute('aria-hidden')).toBe('true')
  })
})

// ---------------------------------------------------------------------------
// kind="text"
// ---------------------------------------------------------------------------

describe('TimelineItem — kind text', () => {
  it('sets data-kind="text"', () => {
    const { container } = render(<TimelineItem kind="text">Plain text</TimelineItem>)
    expect(container.querySelector('[data-kind="text"]')).toBeInTheDocument()
  })

  it('uses outline dotState by default', () => {
    const { container } = render(<TimelineItem kind="text">Plain text</TimelineItem>)
    expect(container.querySelector('[data-state="outline"]')).toBeInTheDocument()
  })

  it('renders children content', () => {
    render(<TimelineItem kind="text">Assistant response</TimelineItem>)
    expect(screen.getByText('Assistant response')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// kind="tool"
// ---------------------------------------------------------------------------

describe('TimelineItem — kind tool', () => {
  it('sets data-kind="tool"', () => {
    const { container } = render(<TimelineItem kind="tool">Tool output</TimelineItem>)
    expect(container.querySelector('[data-kind="tool"]')).toBeInTheDocument()
  })

  it('accepts green dotState', () => {
    const { container } = render(
      <TimelineItem kind="tool" dotState="green">
        Success
      </TimelineItem>
    )
    expect(container.querySelector('[data-state="green"]')).toBeInTheDocument()
  })

  it('accepts amber dotState', () => {
    const { container } = render(
      <TimelineItem kind="tool" dotState="amber">
        Pending
      </TimelineItem>
    )
    expect(container.querySelector('[data-state="amber"]')).toBeInTheDocument()
  })

  it('accepts red dotState', () => {
    const { container } = render(
      <TimelineItem kind="tool" dotState="red">
        Error
      </TimelineItem>
    )
    expect(container.querySelector('[data-state="red"]')).toBeInTheDocument()
  })

  it('accepts running dotState', () => {
    const { container } = render(
      <TimelineItem kind="tool" dotState="running">
        Executing…
      </TimelineItem>
    )
    expect(container.querySelector('[data-state="running"]')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// No bubble container (asymmetric pattern)
// ---------------------------------------------------------------------------

describe('TimelineItem — asymmetric bubble pattern', () => {
  it('does not render any chat-bubble class container', () => {
    const { container } = render(<TimelineItem kind="text">Assistant content</TimelineItem>)
    expect(container.querySelector('[class*="bubble"]')).not.toBeInTheDocument()
  })

  it('content is not inside a card or panel container', () => {
    const { container } = render(<TimelineItem kind="text">Direct content</TimelineItem>)
    // Only expected classes: chat-timeline-item, chat-timeline-dot, chat-timeline-body
    const li = container.querySelector('li')
    const classes = Array.from(li?.querySelectorAll('[class]') ?? []).flatMap((el) =>
      Array.from(el.classList)
    )
    const noCardClass = classes.every(
      (c) => !c.includes('card') && !c.includes('panel') && !c.includes('bubble')
    )
    expect(noCardClass).toBe(true)
  })
})
