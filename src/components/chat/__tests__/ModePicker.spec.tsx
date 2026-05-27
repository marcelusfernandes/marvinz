import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { createRef } from 'react'
import { ModePill, labelForMode, MODE_OPTIONS } from '../ModePill'
import { ModesPicker } from '../ModesPicker'
import type { PermissionMode } from '../../../lib/chat/types'

// ---------------------------------------------------------------------------
// labelForMode
// ---------------------------------------------------------------------------

describe('labelForMode', () => {
  it('returns "Ask before edits" for default', () => {
    expect(labelForMode('default')).toBe('Ask before edits')
  })

  it('returns "Edit automatically" for acceptEdits', () => {
    expect(labelForMode('acceptEdits')).toBe('Edit automatically')
  })

  it('returns "Plan mode" for plan', () => {
    expect(labelForMode('plan')).toBe('Plan mode')
  })

  it('returns "Auto mode" for auto', () => {
    expect(labelForMode('auto')).toBe('Auto mode')
  })

  it('falls back to "Ask before edits" for unknown mode', () => {
    expect(labelForMode('unknown' as never)).toBe('Ask before edits')
  })
})

// ---------------------------------------------------------------------------
// MODE_OPTIONS — completeness
// ---------------------------------------------------------------------------

describe('MODE_OPTIONS', () => {
  it('contains exactly 4 options', () => {
    expect(MODE_OPTIONS).toHaveLength(4)
  })

  it('covers all 4 PermissionMode values', () => {
    const values = MODE_OPTIONS.map((o) => o.value)
    expect(values).toContain('default')
    expect(values).toContain('acceptEdits')
    expect(values).toContain('plan')
    expect(values).toContain('auto')
  })

  it('every option has a non-empty label and hint', () => {
    for (const opt of MODE_OPTIONS) {
      expect(opt.label.length).toBeGreaterThan(0)
      expect(opt.hint.length).toBeGreaterThan(0)
    }
  })
})

// ---------------------------------------------------------------------------
// ModePill — structure
// ---------------------------------------------------------------------------

describe('ModePill — structure', () => {
  it('renders a button with chat-mode-pill class', () => {
    const { container } = render(
      <ModePill mode="default" onClick={() => {}} />,
    )
    expect(container.querySelector('button.chat-mode-pill')).toBeInTheDocument()
  })

  it('sets data-mode attribute to the current mode', () => {
    const { container } = render(<ModePill mode="plan" onClick={() => {}} />)
    expect(container.querySelector('[data-mode="plan"]')).toBeInTheDocument()
  })

  it('has aria-haspopup="listbox"', () => {
    const { container } = render(<ModePill mode="default" onClick={() => {}} />)
    expect(container.querySelector('[aria-haspopup="listbox"]')).toBeInTheDocument()
  })

  it('aria-expanded is false when expanded prop is not set', () => {
    const { container } = render(<ModePill mode="default" onClick={() => {}} />)
    expect(container.querySelector('[aria-expanded="false"]')).toBeInTheDocument()
  })

  it('aria-expanded is true when expanded=true', () => {
    const { container } = render(<ModePill mode="default" expanded onClick={() => {}} />)
    expect(container.querySelector('[aria-expanded="true"]')).toBeInTheDocument()
  })

  it('sets data-expanded attribute when expanded', () => {
    const { container } = render(<ModePill mode="default" expanded onClick={() => {}} />)
    expect(container.querySelector('[data-expanded="true"]')).toBeInTheDocument()
  })

  it('shows the label text for current mode', () => {
    render(<ModePill mode="acceptEdits" onClick={() => {}} />)
    expect(screen.getByText('Edit automatically')).toBeInTheDocument()
  })

  it('aria-label includes the mode label', () => {
    const { container } = render(<ModePill mode="plan" onClick={() => {}} />)
    const btn = container.querySelector('button')
    expect(btn?.getAttribute('aria-label')).toContain('Plan mode')
  })

  it('is disabled when disabled=true', () => {
    render(<ModePill mode="default" disabled onClick={() => {}} />)
    expect(screen.getByRole('button')).toBeDisabled()
  })

  it('calls onClick when clicked', () => {
    const onClick = vi.fn()
    render(<ModePill mode="default" onClick={onClick} />)
    fireEvent.click(screen.getByRole('button'))
    expect(onClick).toHaveBeenCalledOnce()
  })
})

// ---------------------------------------------------------------------------
// ModesPicker — structure
// ---------------------------------------------------------------------------

describe('ModesPicker — structure', () => {
  function renderPicker(mode: PermissionMode = 'default', onSelect = vi.fn(), onClose = vi.fn()) {
    const ref = createRef<HTMLButtonElement>()
    return render(
      <ModesPicker mode={mode} anchorRef={ref} onSelect={onSelect} onClose={onClose} />,
    )
  }

  it('renders a listbox with role="listbox"', () => {
    const { container } = renderPicker()
    expect(container.querySelector('[role="listbox"]')).toBeInTheDocument()
  })

  it('listbox has aria-label "Permission mode"', () => {
    const { container } = renderPicker()
    expect(container.querySelector('[aria-label="Permission mode"]')).toBeInTheDocument()
  })

  it('renders 4 options', () => {
    const { container } = renderPicker()
    expect(container.querySelectorAll('[role="option"]')).toHaveLength(4)
  })

  it('marks the current mode as selected', () => {
    const { container } = renderPicker('plan')
    const selected = container.querySelectorAll('[aria-selected="true"]')
    expect(selected).toHaveLength(1)
    expect(selected[0]?.textContent).toContain('Plan mode')
  })

  it('sets data-selected="true" on the active option', () => {
    const { container } = renderPicker('auto')
    const sel = container.querySelector('[data-selected="true"]')
    expect(sel?.textContent).toContain('Auto mode')
  })

  it('non-selected options have aria-selected="false"', () => {
    const { container } = renderPicker('default')
    const opts = container.querySelectorAll('[role="option"]')
    const nonSelected = Array.from(opts).filter(
      (o) => o.getAttribute('aria-selected') === 'false',
    )
    expect(nonSelected).toHaveLength(3)
  })

  it('each option shows a label and hint', () => {
    const { container } = renderPicker()
    const labels = container.querySelectorAll('.chat-modes-label')
    const hints = container.querySelectorAll('.chat-modes-hint')
    expect(labels).toHaveLength(4)
    expect(hints).toHaveLength(4)
  })
})

// ---------------------------------------------------------------------------
// ModesPicker — interactions
// ---------------------------------------------------------------------------

describe('ModesPicker — click selection', () => {
  it('calls onSelect with the clicked mode value', () => {
    const onSelect = vi.fn()
    const ref = createRef<HTMLButtonElement>()
    const { container } = render(
      <ModesPicker mode="default" anchorRef={ref} onSelect={onSelect} onClose={vi.fn()} />,
    )
    const planOption = Array.from(container.querySelectorAll('[role="option"]')).find(
      (o) => o.textContent?.includes('Plan mode'),
    ) as HTMLElement
    fireEvent.click(planOption)
    expect(onSelect).toHaveBeenCalledWith('plan')
  })

  it('calls onClose after clicking an option', () => {
    const onClose = vi.fn()
    const ref = createRef<HTMLButtonElement>()
    const { container } = render(
      <ModesPicker mode="default" anchorRef={ref} onSelect={vi.fn()} onClose={onClose} />,
    )
    const firstOption = container.querySelector('[role="option"]') as HTMLElement
    fireEvent.click(firstOption)
    expect(onClose).toHaveBeenCalledOnce()
  })
})

describe('ModesPicker — keyboard navigation', () => {
  function renderPicker(mode = 'default' as const) {
    const onSelect = vi.fn()
    const onClose = vi.fn()
    const ref = createRef<HTMLButtonElement>()
    const utils = render(
      <ModesPicker mode={mode} anchorRef={ref} onSelect={onSelect} onClose={onClose} />,
    )
    return { ...utils, onSelect, onClose }
  }

  it('ArrowDown moves focus to next option', () => {
    const { container } = renderPicker('default')
    const listbox = container.querySelector('[role="listbox"]') as HTMLElement
    const opts = container.querySelectorAll<HTMLElement>('[role="option"]')
    opts[0].focus()
    fireEvent.keyDown(listbox, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(opts[1])
  })

  it('ArrowUp moves focus to previous option', () => {
    const { container } = renderPicker('default')
    const listbox = container.querySelector('[role="listbox"]') as HTMLElement
    const opts = container.querySelectorAll<HTMLElement>('[role="option"]')
    opts[2].focus()
    fireEvent.keyDown(listbox, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(opts[1])
  })

  it('Home moves focus to first option', () => {
    const { container } = renderPicker()
    const listbox = container.querySelector('[role="listbox"]') as HTMLElement
    const opts = container.querySelectorAll<HTMLElement>('[role="option"]')
    opts[3].focus()
    fireEvent.keyDown(listbox, { key: 'Home' })
    expect(document.activeElement).toBe(opts[0])
  })

  it('End moves focus to last option', () => {
    const { container } = renderPicker()
    const listbox = container.querySelector('[role="listbox"]') as HTMLElement
    const opts = container.querySelectorAll<HTMLElement>('[role="option"]')
    opts[0].focus()
    fireEvent.keyDown(listbox, { key: 'End' })
    expect(document.activeElement).toBe(opts[3])
  })

  it('Enter selects focused option and calls onSelect + onClose', () => {
    const { container, onSelect, onClose } = renderPicker()
    const listbox = container.querySelector('[role="listbox"]') as HTMLElement
    const opts = container.querySelectorAll<HTMLElement>('[role="option"]')
    opts[2].focus() // "Plan mode" is index 2
    fireEvent.keyDown(listbox, { key: 'Enter' })
    expect(onSelect).toHaveBeenCalledWith('plan')
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('Space selects focused option', () => {
    const { container, onSelect } = renderPicker()
    const listbox = container.querySelector('[role="listbox"]') as HTMLElement
    const opts = container.querySelectorAll<HTMLElement>('[role="option"]')
    opts[1].focus() // "Edit automatically" is index 1
    fireEvent.keyDown(listbox, { key: ' ' })
    expect(onSelect).toHaveBeenCalledWith('acceptEdits')
  })

  it('Escape calls onClose', () => {
    const { onClose } = renderPicker()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('ArrowDown on last option does not move past end', () => {
    const { container } = renderPicker()
    const listbox = container.querySelector('[role="listbox"]') as HTMLElement
    const opts = container.querySelectorAll<HTMLElement>('[role="option"]')
    opts[3].focus()
    fireEvent.keyDown(listbox, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(opts[3])
  })

  it('ArrowUp on first option does not move before start', () => {
    const { container } = renderPicker()
    const listbox = container.querySelector('[role="listbox"]') as HTMLElement
    const opts = container.querySelectorAll<HTMLElement>('[role="option"]')
    opts[0].focus()
    fireEvent.keyDown(listbox, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(opts[0])
  })
})
