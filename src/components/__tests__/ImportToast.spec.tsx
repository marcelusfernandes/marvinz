// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { ImportToast } from '../ImportToast'
import type { ImportToastState } from '../ImportToast'

vi.mock('../Icon', () => ({ Icon: () => null }))

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

// ===========================================================================
// State class rendering
// ===========================================================================

describe('ImportToast — state class', () => {
  it.each<ImportToastState>(['success', 'partial', 'error'])(
    'renders with class "%s" when state is "%s"',
    (state) => {
      const { container } = render(<ImportToast state={state} message="msg" onDismiss={vi.fn()} />)
      const el = container.firstElementChild!
      expect(el.classList.contains(state)).toBe(true)
    }
  )

  it('always renders the base import-toast class', () => {
    const { container } = render(<ImportToast state="success" message="msg" onDismiss={vi.fn()} />)
    expect(container.firstElementChild?.classList.contains('import-toast')).toBe(true)
  })
})

// ===========================================================================
// Message rendering
// ===========================================================================

describe('ImportToast — message', () => {
  it('renders the provided message text', () => {
    const { getByText } = render(
      <ImportToast state="success" message="3 files imported" onDismiss={vi.fn()} />
    )
    expect(getByText('3 files imported')).toBeTruthy()
  })
})

// ===========================================================================
// Accessibility
// ===========================================================================

describe('ImportToast — accessibility', () => {
  it('has role="status"', () => {
    const { getByRole } = render(<ImportToast state="success" message="ok" onDismiss={vi.fn()} />)
    expect(getByRole('status')).toBeTruthy()
  })

  it('has aria-live="polite"', () => {
    const { getByRole } = render(<ImportToast state="success" message="ok" onDismiss={vi.fn()} />)
    expect(getByRole('status').getAttribute('aria-live')).toBe('polite')
  })
})

// ===========================================================================
// Dismiss button
// ===========================================================================

describe('ImportToast — dismiss button', () => {
  it('calls onDismiss when the dismiss button is clicked', () => {
    const onDismiss = vi.fn()
    const { getByRole } = render(<ImportToast state="success" message="ok" onDismiss={onDismiss} />)
    fireEvent.click(getByRole('button'))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})

// ===========================================================================
// Auto-dismiss
// ===========================================================================

describe('ImportToast — auto-dismiss', () => {
  it('calls onDismiss after the default success duration (3000ms)', () => {
    const onDismiss = vi.fn()
    render(<ImportToast state="success" message="ok" onDismiss={onDismiss} />)
    expect(onDismiss).not.toHaveBeenCalled()
    vi.advanceTimersByTime(2999)
    expect(onDismiss).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('calls onDismiss after the default error duration (5000ms)', () => {
    const onDismiss = vi.fn()
    render(<ImportToast state="error" message="failed" onDismiss={onDismiss} />)
    vi.advanceTimersByTime(4999)
    expect(onDismiss).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('calls onDismiss after the default partial duration (5000ms)', () => {
    const onDismiss = vi.fn()
    render(<ImportToast state="partial" message="some skipped" onDismiss={onDismiss} />)
    vi.advanceTimersByTime(4999)
    expect(onDismiss).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('respects an explicit autoDismissMs override', () => {
    const onDismiss = vi.fn()
    render(<ImportToast state="success" message="ok" onDismiss={onDismiss} autoDismissMs={1000} />)
    vi.advanceTimersByTime(999)
    expect(onDismiss).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('does not auto-dismiss when autoDismissMs is 0', () => {
    const onDismiss = vi.fn()
    render(<ImportToast state="success" message="ok" onDismiss={onDismiss} autoDismissMs={0} />)
    vi.advanceTimersByTime(60_000)
    expect(onDismiss).not.toHaveBeenCalled()
  })
})
