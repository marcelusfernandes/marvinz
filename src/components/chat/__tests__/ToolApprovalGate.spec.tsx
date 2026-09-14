import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { ToolApprovalGate, type ApprovalDecision } from '../ToolApprovalGate'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDecide() {
  return vi.fn<(toolUseId: string, decision: ApprovalDecision) => void>()
}

// ---------------------------------------------------------------------------
// Structure
// ---------------------------------------------------------------------------

describe('ToolApprovalGate — structure', () => {
  it('renders a group container with aria-label "Tool approval"', () => {
    const { container } = render(<ToolApprovalGate toolUseId="tu1" onDecide={makeDecide()} />)
    const group = container.querySelector('[role="group"]')
    expect(group).toBeInTheDocument()
    expect(group?.getAttribute('aria-label')).toBe('Tool approval')
  })

  it('has chat-approval-gate class', () => {
    const { container } = render(<ToolApprovalGate toolUseId="tu1" onDecide={makeDecide()} />)
    expect(container.querySelector('.chat-approval-gate')).toBeInTheDocument()
  })

  it('renders Allow button', () => {
    render(<ToolApprovalGate toolUseId="tu1" onDecide={makeDecide()} />)
    expect(screen.getByRole('button', { name: /^allow$/i })).toBeInTheDocument()
  })

  it('renders Allow always button', () => {
    render(<ToolApprovalGate toolUseId="tu1" onDecide={makeDecide()} />)
    expect(screen.getByRole('button', { name: /allow always/i })).toBeInTheDocument()
  })

  it('renders Deny button', () => {
    render(<ToolApprovalGate toolUseId="tu1" onDecide={makeDecide()} />)
    expect(screen.getByRole('button', { name: /^deny$/i })).toBeInTheDocument()
  })

  it('Allow button has data-action="allow"', () => {
    const { container } = render(<ToolApprovalGate toolUseId="tu1" onDecide={makeDecide()} />)
    expect(container.querySelector('[data-action="allow"]')).toBeInTheDocument()
  })

  it('Allow always button has data-action="allow-always"', () => {
    const { container } = render(<ToolApprovalGate toolUseId="tu1" onDecide={makeDecide()} />)
    expect(container.querySelector('[data-action="allow-always"]')).toBeInTheDocument()
  })

  it('Deny button has data-action="deny"', () => {
    const { container } = render(<ToolApprovalGate toolUseId="tu1" onDecide={makeDecide()} />)
    expect(container.querySelector('[data-action="deny"]')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Allow button — fires correct decision
// ---------------------------------------------------------------------------

describe('ToolApprovalGate — Allow button', () => {
  it('calls onDecide with kind=allow and no remember when Allow is clicked', () => {
    const onDecide = makeDecide()
    render(<ToolApprovalGate toolUseId="tu1" onDecide={onDecide} />)
    fireEvent.click(screen.getByRole('button', { name: /^allow$/i }))
    expect(onDecide).toHaveBeenCalledOnce()
    expect(onDecide).toHaveBeenCalledWith('tu1', { kind: 'allow' })
  })

  it('passes the correct toolUseId', () => {
    const onDecide = makeDecide()
    render(<ToolApprovalGate toolUseId="tu-xyz" onDecide={onDecide} />)
    fireEvent.click(screen.getByRole('button', { name: /^allow$/i }))
    expect(onDecide).toHaveBeenCalledWith('tu-xyz', expect.any(Object))
  })
})

// ---------------------------------------------------------------------------
// Allow always button — fires correct decision
// ---------------------------------------------------------------------------

describe('ToolApprovalGate — Allow always button', () => {
  it('calls onDecide with kind=allow and remember=session when Allow always is clicked', () => {
    const onDecide = makeDecide()
    render(<ToolApprovalGate toolUseId="tu1" onDecide={onDecide} />)
    fireEvent.click(screen.getByRole('button', { name: /allow always/i }))
    expect(onDecide).toHaveBeenCalledOnce()
    expect(onDecide).toHaveBeenCalledWith('tu1', { kind: 'allow', remember: 'session' })
  })
})

// ---------------------------------------------------------------------------
// Deny button — fires correct decision
// ---------------------------------------------------------------------------

describe('ToolApprovalGate — Deny button', () => {
  it('calls onDecide with kind=deny when Deny is clicked', () => {
    const onDecide = makeDecide()
    render(<ToolApprovalGate toolUseId="tu1" onDecide={onDecide} />)
    fireEvent.click(screen.getByRole('button', { name: /^deny$/i }))
    expect(onDecide).toHaveBeenCalledOnce()
    expect(onDecide).toHaveBeenCalledWith('tu1', { kind: 'deny' })
  })
})

// ---------------------------------------------------------------------------
// Keyboard — Escape sends deny
// ---------------------------------------------------------------------------

describe('ToolApprovalGate — Escape key', () => {
  it('calls onDecide with kind=deny when Escape is pressed inside the gate', () => {
    const onDecide = makeDecide()
    const { container } = render(<ToolApprovalGate toolUseId="tu1" onDecide={onDecide} />)
    const gate = container.querySelector('.chat-approval-gate') as HTMLElement
    fireEvent.keyDown(gate, { key: 'Escape' })
    expect(onDecide).toHaveBeenCalledWith('tu1', { kind: 'deny' })
  })

  it('does not fire deny when Escape is pressed on a non-gate element', () => {
    const onDecide = makeDecide()
    render(<ToolApprovalGate toolUseId="tu1" onDecide={onDecide} />)
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(onDecide).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// disabled prop
// ---------------------------------------------------------------------------

describe('ToolApprovalGate — disabled', () => {
  it('disables all buttons when disabled=true', () => {
    render(<ToolApprovalGate toolUseId="tu1" onDecide={makeDecide()} disabled />)
    const buttons = screen.getAllByRole('button')
    expect(buttons.every((b) => (b as HTMLButtonElement).disabled)).toBe(true)
  })

  it('buttons are enabled when disabled=false', () => {
    render(<ToolApprovalGate toolUseId="tu1" onDecide={makeDecide()} disabled={false} />)
    const buttons = screen.getAllByRole('button')
    expect(buttons.every((b) => !(b as HTMLButtonElement).disabled)).toBe(true)
  })

  it('does not call onDecide when clicking Allow while disabled', () => {
    const onDecide = makeDecide()
    render(<ToolApprovalGate toolUseId="tu1" onDecide={onDecide} disabled />)
    fireEvent.click(screen.getByRole('button', { name: /^allow$/i }))
    expect(onDecide).not.toHaveBeenCalled()
  })

  it('does not call onDecide on Escape when disabled', () => {
    const onDecide = makeDecide()
    const { container } = render(<ToolApprovalGate toolUseId="tu1" onDecide={onDecide} disabled />)
    const gate = container.querySelector('.chat-approval-gate') as HTMLElement
    fireEvent.keyDown(gate, { key: 'Escape' })
    expect(onDecide).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// hint slot
// ---------------------------------------------------------------------------

describe('ToolApprovalGate — hint slot', () => {
  it('renders hint content when hint prop is provided', () => {
    render(<ToolApprovalGate toolUseId="tu1" onDecide={makeDecide()} hint={<span>diff</span>} />)
    expect(screen.getByText('diff')).toBeInTheDocument()
  })

  it('does not render hint container when hint is not provided', () => {
    const { container } = render(<ToolApprovalGate toolUseId="tu1" onDecide={makeDecide()} />)
    expect(container.querySelector('.chat-approval-hint')).not.toBeInTheDocument()
  })

  it('hint container has chat-approval-hint class', () => {
    const { container } = render(
      <ToolApprovalGate toolUseId="tu1" onDecide={makeDecide()} hint={<span>x</span>} />
    )
    expect(container.querySelector('.chat-approval-hint')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// onDecide called exactly once per action
// ---------------------------------------------------------------------------

describe('ToolApprovalGate — single call per action', () => {
  it('clicking Allow fires onDecide exactly once', () => {
    const onDecide = makeDecide()
    render(<ToolApprovalGate toolUseId="tu1" onDecide={onDecide} />)
    fireEvent.click(screen.getByRole('button', { name: /^allow$/i }))
    expect(onDecide).toHaveBeenCalledTimes(1)
  })

  it('clicking Deny fires onDecide exactly once', () => {
    const onDecide = makeDecide()
    render(<ToolApprovalGate toolUseId="tu1" onDecide={onDecide} />)
    fireEvent.click(screen.getByRole('button', { name: /^deny$/i }))
    expect(onDecide).toHaveBeenCalledTimes(1)
  })

  it('clicking Allow always fires onDecide exactly once', () => {
    const onDecide = makeDecide()
    render(<ToolApprovalGate toolUseId="tu1" onDecide={onDecide} />)
    fireEvent.click(screen.getByRole('button', { name: /allow always/i }))
    expect(onDecide).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// deadlineAt countdown — exercises useRemainingMs + formatRemaining
// ---------------------------------------------------------------------------

describe('ToolApprovalGate — deadline countdown', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders no countdown when deadlineAt is omitted', () => {
    const { container } = render(<ToolApprovalGate toolUseId="tu1" onDecide={makeDecide()} />)
    expect(container.querySelector('[data-role="countdown"]')).not.toBeInTheDocument()
  })

  it('renders "Expires in m:ss" for a future deadline', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(1_000_000))
    // 95s out → 1:35
    render(
      <ToolApprovalGate toolUseId="tu1" onDecide={makeDecide()} deadlineAt={1_000_000 + 95_000} />
    )
    const countdown = screen.getByText(/Expires in/)
    expect(countdown).toHaveTextContent('Expires in 1:35')
  })

  it('ticks the countdown down as time advances', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2_000_000))
    render(
      <ToolApprovalGate toolUseId="tu1" onDecide={makeDecide()} deadlineAt={2_000_000 + 10_000} />
    )
    expect(screen.getByText(/Expires in/)).toHaveTextContent('Expires in 0:10')
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(screen.getByText(/Expires in/)).toHaveTextContent('Expires in 0:07')
  })

  it('renders "Expired" once the deadline has passed', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(3_000_000))
    render(<ToolApprovalGate toolUseId="tu1" onDecide={makeDecide()} deadlineAt={3_000_000 - 1} />)
    expect(screen.getByText('Expired')).toBeInTheDocument()
  })

  it('renders both countdown and hint slots together', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(4_000_000))
    render(
      <ToolApprovalGate
        toolUseId="tu1"
        onDecide={makeDecide()}
        deadlineAt={4_000_000 + 30_000}
        hint={<span>view diff</span>}
      />
    )
    expect(screen.getByText(/Expires in/)).toBeInTheDocument()
    expect(screen.getByText('view diff')).toBeInTheDocument()
  })
})
