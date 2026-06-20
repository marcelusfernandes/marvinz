// @vitest-environment jsdom
//
// Focused tests for FileTreeToolbar after commit 3c36f47 removed the
// Refresh button (onRefresh prop dropped; chokidar handles auto-reload).
//
// Positive assertion (New file button present) guards against a vacuous pass
// if the component fails to render at all.

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('../Icon', () => ({ Icon: () => null }))

import { FileTreeToolbar } from '../FileTreeToolbar'

function baseProps(overrides: Partial<Parameters<typeof FileTreeToolbar>[0]> = {}) {
  return {
    isAnyOpen: false,
    onNewFile: vi.fn(),
    onNewFolder: vi.fn(),
    onToggleAll: vi.fn(),
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Refresh button removal
// ---------------------------------------------------------------------------

describe('FileTreeToolbar — Refresh button removed', () => {
  it('renders the New file button (positive guard — component is alive)', () => {
    render(<FileTreeToolbar {...baseProps()} />)
    expect(screen.getByLabelText('New file')).toBeInTheDocument()
  })

  it('does NOT render a button with aria-label "Refresh"', () => {
    render(<FileTreeToolbar {...baseProps()} />)
    expect(screen.queryByLabelText('Refresh')).toBeNull()
  })

  it('does NOT render a button with title "Refresh"', () => {
    render(<FileTreeToolbar {...baseProps()} />)
    expect(screen.queryByTitle('Refresh')).toBeNull()
  })

  it('renders exactly three buttons (New file, New folder, Toggle all)', () => {
    render(<FileTreeToolbar {...baseProps()} />)
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(3)
  })
})
