// @vitest-environment jsdom

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../Icon', () => ({
  Icon: ({ name }: { name: string }) => <span data-testid={`icon-${name}`} />,
}))

import { EmptyTab } from '../EmptyTab'

function renderEmptyTab(overrides: Partial<Parameters<typeof EmptyTab>[0]> = {}) {
  const props = {
    onOpenBrowser: vi.fn(),
    onCreateNote: vi.fn(),
    onChooseFile: vi.fn(),
    isVaultOpen: true,
    ...overrides,
  }
  const utils = render(<EmptyTab {...props} />)
  return { ...utils, ...props }
}

// ---------------------------------------------------------------------------
// Render — titles and icons present
// ---------------------------------------------------------------------------

describe('EmptyTab — render', () => {
  it('renders Browser card title', () => {
    renderEmptyTab()
    expect(screen.getByText('Browser')).toBeInTheDocument()
  })

  it('renders New note card title', () => {
    renderEmptyTab()
    expect(screen.getByText('New note')).toBeInTheDocument()
  })

  it('renders an icon for Browser card', () => {
    renderEmptyTab()
    const card = screen.getByText('Browser').closest('[role="button"], button')
    expect(card?.querySelector('[data-testid]')).not.toBeNull()
  })

  it('renders an icon for New note card', () => {
    renderEmptyTab()
    const card = screen.getByText('New note').closest('[role="button"], button')
    expect(card?.querySelector('[data-testid]')).not.toBeNull()
  })

  it('renders description text inside the Browser card', () => {
    renderEmptyTab()
    const card = screen.getByText('Browser').closest('[role="button"], button')
    // Card should contain more than just the title span
    expect(card?.textContent?.length).toBeGreaterThan('Browser'.length)
  })
})

// ---------------------------------------------------------------------------
// Click — Browser calls onOpenBrowser once
// ---------------------------------------------------------------------------

describe('EmptyTab — click Browser', () => {
  it('calls onOpenBrowser once when the Browser card is clicked', () => {
    const { onOpenBrowser } = renderEmptyTab()
    fireEvent.click(screen.getByText('Browser'))
    expect(onOpenBrowser).toHaveBeenCalledTimes(1)
  })

  it('does not call onCreateNote when Browser is clicked', () => {
    const { onCreateNote } = renderEmptyTab()
    fireEvent.click(screen.getByText('Browser'))
    expect(onCreateNote).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Click — New note calls onCreateNote once
// ---------------------------------------------------------------------------

describe('EmptyTab — click New note', () => {
  it('calls onCreateNote once when the New note card is clicked', () => {
    const { onCreateNote } = renderEmptyTab()
    fireEvent.click(screen.getByText('New note'))
    expect(onCreateNote).toHaveBeenCalledTimes(1)
  })

  it('does not call onOpenBrowser when New note is clicked', () => {
    const { onOpenBrowser } = renderEmptyTab()
    fireEvent.click(screen.getByText('New note'))
    expect(onOpenBrowser).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Keyboard — Enter fires the callback
// ---------------------------------------------------------------------------

describe('EmptyTab — keyboard accessibility', () => {
  it('fires onOpenBrowser when Enter is pressed on the focused Browser button', async () => {
    const { onOpenBrowser } = renderEmptyTab()
    const card = screen.getByText('Browser').closest('[role="button"], button') as HTMLElement
    card.focus()
    await userEvent.keyboard('{Enter}')
    expect(onOpenBrowser).toHaveBeenCalledTimes(1)
  })

  it('fires onCreateNote when Enter is pressed on the focused New note button', async () => {
    const { onCreateNote } = renderEmptyTab()
    const card = screen.getByText('New note').closest('[role="button"], button') as HTMLElement
    card.focus()
    await userEvent.keyboard('{Enter}')
    expect(onCreateNote).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// Disabled cards — vault-gated entry points
// ---------------------------------------------------------------------------

describe('EmptyTab — disabled cards (vault closed)', () => {
  it('Files card is disabled when isVaultOpen is false', () => {
    renderEmptyTab({ isVaultOpen: false })
    const card = screen.getByText('Files').closest('button') as HTMLButtonElement
    expect(card.disabled).toBe(true)
  })

  it('New note card is disabled when isVaultOpen is false', () => {
    renderEmptyTab({ isVaultOpen: false })
    const card = screen.getByText('New note').closest('button') as HTMLButtonElement
    expect(card.disabled).toBe(true)
  })

  it('New note card is enabled by default (vault assumed open)', () => {
    renderEmptyTab()
    const card = screen.getByText('New note').closest('button') as HTMLButtonElement
    expect(card.disabled).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Files card — enabled when vault open, calls onChooseFile on click
// ---------------------------------------------------------------------------

describe('EmptyTab — Files card', () => {
  it('renders Files card title', () => {
    renderEmptyTab()
    expect(screen.getByText('Files')).toBeInTheDocument()
  })

  it('is enabled when isVaultOpen is true', () => {
    renderEmptyTab({ isVaultOpen: true })
    const card = screen.getByText('Files').closest('button') as HTMLButtonElement
    expect(card.disabled).toBe(false)
  })

  it('calls onChooseFile once when clicked', () => {
    const { onChooseFile } = renderEmptyTab()
    fireEvent.click(screen.getByText('Files'))
    expect(onChooseFile).toHaveBeenCalledTimes(1)
  })

  it('does not call other handlers when Files is clicked', () => {
    const { onOpenBrowser, onCreateNote } = renderEmptyTab()
    fireEvent.click(screen.getByText('Files'))
    expect(onOpenBrowser).not.toHaveBeenCalled()
    expect(onCreateNote).not.toHaveBeenCalled()
  })

  it('does not call onChooseFile when disabled (vault closed)', () => {
    const { onChooseFile } = renderEmptyTab({ isVaultOpen: false })
    fireEvent.click(screen.getByText('Files'))
    expect(onChooseFile).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Revisão card — enabled when vault open, calls onChooseReview on click
// ---------------------------------------------------------------------------

describe('EmptyTab — Revisão card (removed until #361)', () => {
  // The Revisão card is gated out of the UI until #361 wires the git diff
  // source (vault:gitStatus + vault:gitDiff IPCs). When that lands, restore
  // the entry point + a real test suite here.
  it.todo('Revisão card is rendered once #361 wires the git diff source')

  it('Revisão card is not present in the landing today', () => {
    renderEmptyTab()
    expect(screen.queryByText('Revisão')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// No inline px/hex styles
// ---------------------------------------------------------------------------

describe('EmptyTab — no hardcoded styles', () => {
  it('root element has no inline style attribute with px values', () => {
    const { container } = renderEmptyTab()
    const allElements = container.querySelectorAll('[style]')
    allElements.forEach((el: Element) => {
      const style = el.getAttribute('style') ?? ''
      expect(style).not.toMatch(/:\s*\d+px/)
      expect(style).not.toMatch(/#[0-9a-fA-F]{3,6}/)
    })
  })
})
