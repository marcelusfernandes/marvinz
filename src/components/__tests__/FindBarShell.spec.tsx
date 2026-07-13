// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const writeReplaceExpanded = vi.fn()
vi.mock('../../lib/findBarPrefs', () => ({
  readReplaceExpanded: () => false,
  writeReplaceExpanded: (v: boolean) => writeReplaceExpanded(v),
}))

import { FindBarShell } from '../FindBarShell'

function baseProps(overrides: Partial<React.ComponentProps<typeof FindBarShell>> = {}) {
  return {
    testIdPrefix: 'cm',
    query: '',
    onQueryChange: vi.fn(),
    replace: '',
    onReplaceChange: vi.fn(),
    matchInfo: { total: 0, current: null },
    onFindNext: vi.fn(),
    onFindPrev: vi.fn(),
    onReplaceNext: vi.fn(),
    onReplaceAll: vi.fn(),
    onClose: vi.fn(),
    focusEditor: vi.fn(),
    ...overrides,
  }
}

beforeEach(() => writeReplaceExpanded.mockClear())

describe('FindBarShell (#588)', () => {
  it('focuses the find input on mount', () => {
    render(<FindBarShell {...baseProps()} />)
    expect(document.activeElement).toBe(screen.getByTestId('cm-search-input'))
  })

  it('parametrizes every data-testid by the prefix', () => {
    render(<FindBarShell {...baseProps({ testIdPrefix: 'pm', initialReplaceExpanded: true })} />)
    for (const id of [
      'pm-search-panel',
      'pm-replace-toggle',
      'pm-search-input',
      'pm-search-count',
      'pm-search-prev',
      'pm-search-next',
      'pm-search-close',
      'pm-replace-input',
      'pm-replace-all',
      'pm-replace-next',
    ]) {
      expect(screen.getByTestId(id)).toBeInTheDocument()
    }
  })

  it('Escape closes AND refocuses the editor; the close button closes WITHOUT refocusing', () => {
    const onClose = vi.fn()
    const focusEditor = vi.fn()
    render(<FindBarShell {...baseProps({ onClose, focusEditor })} />)

    fireEvent.keyDown(screen.getByTestId('cm-search-panel'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(focusEditor).toHaveBeenCalledTimes(1)

    onClose.mockClear()
    focusEditor.mockClear()
    fireEvent.click(screen.getByTestId('cm-search-close'))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(focusEditor).not.toHaveBeenCalled()
  })

  it('Enter finds next, Shift+Enter finds prev', () => {
    const onFindNext = vi.fn()
    const onFindPrev = vi.fn()
    render(<FindBarShell {...baseProps({ onFindNext, onFindPrev })} />)
    const panel = screen.getByTestId('cm-search-panel')

    fireEvent.keyDown(panel, { key: 'Enter' })
    expect(onFindNext).toHaveBeenCalledTimes(1)
    expect(onFindPrev).not.toHaveBeenCalled()

    fireEvent.keyDown(panel, { key: 'Enter', shiftKey: true })
    expect(onFindPrev).toHaveBeenCalledTimes(1)
  })

  it('toggle reveals the replace row and persists the preference', () => {
    render(<FindBarShell {...baseProps()} />)
    expect(screen.queryByTestId('cm-replace-input')).toBeNull()

    fireEvent.click(screen.getByTestId('cm-replace-toggle'))
    expect(screen.getByTestId('cm-replace-input')).toBeInTheDocument()
    expect(writeReplaceExpanded).toHaveBeenCalledWith(true)
  })

  it('initialReplaceExpanded starts the replace row open', () => {
    render(<FindBarShell {...baseProps({ initialReplaceExpanded: true })} />)
    expect(screen.getByTestId('cm-replace-input')).toBeInTheDocument()
  })

  it('renders the match-count readout for empty / current / count-only states', () => {
    const { rerender } = render(<FindBarShell {...baseProps()} />)
    expect(screen.getByTestId('cm-search-count').textContent).toBe('No results')

    rerender(<FindBarShell {...baseProps({ query: 'x', matchInfo: { total: 5, current: 2 } })} />)
    expect(screen.getByTestId('cm-search-count').textContent).toBe('2 of 5')

    rerender(
      <FindBarShell {...baseProps({ query: 'x', matchInfo: { total: 3, current: null } })} />
    )
    expect(screen.getByTestId('cm-search-count').textContent).toBe('3 matches')
  })

  it('typing in the find input calls onQueryChange (controlled)', () => {
    const onQueryChange = vi.fn()
    render(<FindBarShell {...baseProps({ onQueryChange })} />)
    fireEvent.change(screen.getByTestId('cm-search-input'), { target: { value: 'foo' } })
    expect(onQueryChange).toHaveBeenCalledWith('foo')
  })
})
