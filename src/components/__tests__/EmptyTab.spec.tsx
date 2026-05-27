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
    ...overrides,
  }
  const utils = render(<EmptyTab {...props} />)
  return { ...utils, ...props }
}

// ---------------------------------------------------------------------------
// Render — titles and icons present
// ---------------------------------------------------------------------------

describe('EmptyTab — render', () => {
  it('renders Navegador card title', () => {
    renderEmptyTab()
    expect(screen.getByText('Navegador')).toBeInTheDocument()
  })

  it('renders Nova nota card title', () => {
    renderEmptyTab()
    expect(screen.getByText('Nova nota')).toBeInTheDocument()
  })

  it('renders an icon for Navegador card', () => {
    renderEmptyTab()
    const card = screen.getByText('Navegador').closest('[role="button"], button')
    expect(card?.querySelector('[data-testid]')).not.toBeNull()
  })

  it('renders an icon for Nova nota card', () => {
    renderEmptyTab()
    const card = screen.getByText('Nova nota').closest('[role="button"], button')
    expect(card?.querySelector('[data-testid]')).not.toBeNull()
  })

  it('renders description text inside the Navegador card', () => {
    renderEmptyTab()
    const card = screen.getByText('Navegador').closest('[role="button"], button')
    // Card should contain more than just the title span
    expect(card?.textContent?.length).toBeGreaterThan('Navegador'.length)
  })
})

// ---------------------------------------------------------------------------
// Click — Navegador calls onOpenBrowser once
// ---------------------------------------------------------------------------

describe('EmptyTab — click Navegador', () => {
  it('calls onOpenBrowser once when the Navegador card is clicked', () => {
    const { onOpenBrowser } = renderEmptyTab()
    fireEvent.click(screen.getByText('Navegador'))
    expect(onOpenBrowser).toHaveBeenCalledTimes(1)
  })

  it('does not call onCreateNote when Navegador is clicked', () => {
    const { onCreateNote } = renderEmptyTab()
    fireEvent.click(screen.getByText('Navegador'))
    expect(onCreateNote).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Click — Nova nota calls onCreateNote once
// ---------------------------------------------------------------------------

describe('EmptyTab — click Nova nota', () => {
  it('calls onCreateNote once when the Nova nota card is clicked', () => {
    const { onCreateNote } = renderEmptyTab()
    fireEvent.click(screen.getByText('Nova nota'))
    expect(onCreateNote).toHaveBeenCalledTimes(1)
  })

  it('does not call onOpenBrowser when Nova nota is clicked', () => {
    const { onOpenBrowser } = renderEmptyTab()
    fireEvent.click(screen.getByText('Nova nota'))
    expect(onOpenBrowser).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Keyboard — Enter fires the callback
// ---------------------------------------------------------------------------

describe('EmptyTab — keyboard accessibility', () => {
  it('fires onOpenBrowser when Enter is pressed on the focused Navegador button', async () => {
    const { onOpenBrowser } = renderEmptyTab()
    const card = screen.getByText('Navegador').closest('[role="button"], button') as HTMLElement
    card.focus()
    await userEvent.keyboard('{Enter}')
    expect(onOpenBrowser).toHaveBeenCalledTimes(1)
  })

  it('fires onCreateNote when Enter is pressed on the focused Nova nota button', async () => {
    const { onCreateNote } = renderEmptyTab()
    const card = screen.getByText('Nova nota').closest('[role="button"], button') as HTMLElement
    card.focus()
    await userEvent.keyboard('{Enter}')
    expect(onCreateNote).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// Disabled cards — Arquivos and Revisão are not interactive
// ---------------------------------------------------------------------------

describe('EmptyTab — disabled cards (sibling sub-issue #307)', () => {
  // Arquivos + Revisão cards aren't rendered in this sub-issue. When #307 lands
  // them as disabled placeholders, replace these `.todo`s with real assertions.
  it.todo('Arquivos card is marked disabled or aria-disabled')
  it.todo('Revisão card is marked disabled or aria-disabled')

  it('Nova nota card is disabled when isVaultOpen is false', () => {
    render(<EmptyTab onOpenBrowser={vi.fn()} onCreateNote={vi.fn()} isVaultOpen={false} />)
    const card = screen.getByText('Nova nota').closest('button') as HTMLButtonElement
    expect(card.disabled).toBe(true)
  })

  it('Nova nota card is enabled by default (vault assumed open)', () => {
    renderEmptyTab()
    const card = screen.getByText('Nova nota').closest('button') as HTMLButtonElement
    expect(card.disabled).toBe(false)
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
