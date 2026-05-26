// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'

// ---------------------------------------------------------------------------
// Hoisted mocks — must be available before vi.mock() factories run
// ---------------------------------------------------------------------------

const { mockRankPaletteItems } = vi.hoisted(() => {
  const mockRankPaletteItems = vi.fn()
  return { mockRankPaletteItems }
})

vi.mock('../../lib/paletteRanker', () => ({
  rankPaletteItems: mockRankPaletteItems,
  stripBasename: (rel: string, name: string) => {
    if (rel === name) return ''
    const cut = rel.length - name.length
    return rel.slice(0, Math.max(0, cut - 1))
  },
}))

vi.mock('../../lib/fileIcons', () => ({
  fileIconFor: () => 'file',
}))

vi.mock('../Icon', () => ({
  Icon: ({ name }: { name: string }) => <span data-testid={`icon-${name}`} />,
}))

// ---------------------------------------------------------------------------
// Import component after mocks
// ---------------------------------------------------------------------------

import { MentionPicker } from '../MentionPicker'
import type { PaletteItem, ScoredPaletteItem } from '../../lib/paletteRanker'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeItem(name: string, dir = ''): PaletteItem {
  const rel = dir ? `${dir}/${name}` : name
  return { path: `/vault/${rel}`, rel, name, isMarkdown: true }
}

function scored(item: PaletteItem): ScoredPaletteItem {
  return { item, score: 1, nameMatches: [], relMatches: [] }
}

function defaultProps(overrides: Partial<Parameters<typeof MentionPicker>[0]> = {}) {
  return {
    query: 'note',
    items: [],
    anchor: { x: 100, y: 200 },
    onSelect: vi.fn(),
    onDismiss: vi.fn(),
    ...overrides,
  }
}

beforeEach(() => {
  mockRankPaletteItems.mockReset()
})

// ---------------------------------------------------------------------------
// 1. Renders N rows filtered by query
// ---------------------------------------------------------------------------

describe('MentionPicker — row rendering', () => {
  it('renders one row per ranked result', () => {
    const items = [makeItem('alpha.md'), makeItem('beta.md'), makeItem('gamma.md')]
    mockRankPaletteItems.mockReturnValue(items.map(scored))

    render(<MentionPicker {...defaultProps({ items })} />)

    const rows = screen.getAllByRole('option')
    expect(rows).toHaveLength(3)
  })

  it('shows name and dir path when dir is non-empty', () => {
    const item = makeItem('note.md', 'docs/sub')
    mockRankPaletteItems.mockReturnValue([scored(item)])

    render(<MentionPicker {...defaultProps()} />)

    expect(screen.getByText('note.md')).toBeInTheDocument()
    expect(screen.getByText('docs/sub')).toBeInTheDocument()
  })

  it('omits path span when item is at vault root (no dir)', () => {
    const item = makeItem('root.md')
    mockRankPaletteItems.mockReturnValue([scored(item)])

    render(<MentionPicker {...defaultProps()} />)

    expect(screen.getByText('root.md')).toBeInTheDocument()
    // No path element rendered — no element with mention-picker-path class
    expect(document.querySelector('.mention-picker-path')).toBeNull()
  })

  it('root element has role listbox and class mention-picker', () => {
    mockRankPaletteItems.mockReturnValue([scored(makeItem('a.md'))])

    render(<MentionPicker {...defaultProps()} />)

    const listbox = screen.getByRole('listbox')
    expect(listbox).toHaveClass('mention-picker')
  })
})

// ---------------------------------------------------------------------------
// 2. Returns null when results are empty
// ---------------------------------------------------------------------------

describe('MentionPicker — empty state', () => {
  it('renders nothing when rankPaletteItems returns empty array', () => {
    mockRankPaletteItems.mockReturnValue([])

    const { container } = render(<MentionPicker {...defaultProps()} />)

    expect(container).toBeEmptyDOMElement()
    expect(document.querySelector('.mention-picker')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 3. ArrowDown moves selected index forward
// ---------------------------------------------------------------------------

describe('MentionPicker — ArrowDown navigation', () => {
  it('moves active class to next row on ArrowDown', async () => {
    const items = [makeItem('a.md'), makeItem('b.md'), makeItem('c.md')]
    mockRankPaletteItems.mockReturnValue(items.map(scored))

    render(<MentionPicker {...defaultProps({ items })} />)

    const rows = screen.getAllByRole('option')
    expect(rows[0]).toHaveClass('active')
    expect(rows[0]).toHaveAttribute('aria-selected', 'true')

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    })

    expect(rows[1]).toHaveClass('active')
    expect(rows[1]).toHaveAttribute('aria-selected', 'true')
    expect(rows[0]).not.toHaveClass('active')
  })
})

// ---------------------------------------------------------------------------
// 4. ArrowUp wraps from index 0 to last
// ---------------------------------------------------------------------------

describe('MentionPicker — ArrowUp wrapping', () => {
  it('wraps from index 0 to last item on ArrowUp', async () => {
    const items = [makeItem('a.md'), makeItem('b.md'), makeItem('c.md')]
    mockRankPaletteItems.mockReturnValue(items.map(scored))

    render(<MentionPicker {...defaultProps({ items })} />)

    const rows = screen.getAllByRole('option')
    expect(rows[0]).toHaveClass('active')

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))
    })

    expect(rows[2]).toHaveClass('active')
    expect(rows[2]).toHaveAttribute('aria-selected', 'true')
  })
})

// ---------------------------------------------------------------------------
// 5. Enter dispatches onSelect with highlighted item
// ---------------------------------------------------------------------------

describe('MentionPicker — Enter key', () => {
  it('calls onSelect with the selected item on Enter', async () => {
    const items = [makeItem('first.md'), makeItem('second.md')]
    mockRankPaletteItems.mockReturnValue(items.map(scored))
    const onSelect = vi.fn()

    render(<MentionPicker {...defaultProps({ items, onSelect })} />)

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })

    expect(onSelect).toHaveBeenCalledOnce()
    expect(onSelect).toHaveBeenCalledWith(items[0])
  })
})

// ---------------------------------------------------------------------------
// 6. Tab dispatches onSelect with highlighted item
// ---------------------------------------------------------------------------

describe('MentionPicker — Tab key', () => {
  it('calls onSelect with the selected item on Tab', async () => {
    const items = [makeItem('first.md'), makeItem('second.md')]
    mockRankPaletteItems.mockReturnValue(items.map(scored))
    const onSelect = vi.fn()

    render(<MentionPicker {...defaultProps({ items, onSelect })} />)

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    })

    expect(onSelect).toHaveBeenCalledOnce()
    expect(onSelect).toHaveBeenCalledWith(items[0])
  })
})

// ---------------------------------------------------------------------------
// 7. Escape dispatches onDismiss
// ---------------------------------------------------------------------------

describe('MentionPicker — Escape key', () => {
  it('calls onDismiss on Escape', async () => {
    mockRankPaletteItems.mockReturnValue([scored(makeItem('a.md'))])
    const onDismiss = vi.fn()

    render(<MentionPicker {...defaultProps({ onDismiss })} />)

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })

    expect(onDismiss).toHaveBeenCalledOnce()
  })
})

// ---------------------------------------------------------------------------
// 8. Click on a row dispatches onSelect with that item
// ---------------------------------------------------------------------------

describe('MentionPicker — row click', () => {
  it('calls onSelect with the clicked item', async () => {
    const items = [makeItem('first.md'), makeItem('second.md')]
    mockRankPaletteItems.mockReturnValue(items.map(scored))
    const onSelect = vi.fn()

    render(<MentionPicker {...defaultProps({ items, onSelect })} />)

    const rows = screen.getAllByRole('option')
    await act(async () => {
      fireEvent.click(rows[1])
    })

    expect(onSelect).toHaveBeenCalledOnce()
    expect(onSelect).toHaveBeenCalledWith(items[1])
  })
})

// ---------------------------------------------------------------------------
// 9. mousedown outside the portal dispatches onDismiss
// ---------------------------------------------------------------------------

describe('MentionPicker — outside dismiss', () => {
  it('calls onDismiss on mousedown outside the picker', async () => {
    mockRankPaletteItems.mockReturnValue([scored(makeItem('a.md'))])
    const onDismiss = vi.fn()

    render(<MentionPicker {...defaultProps({ onDismiss })} />)

    const outside = document.createElement('div')
    document.body.appendChild(outside)

    await act(async () => {
      fireEvent.mouseDown(outside)
    })

    expect(onDismiss).toHaveBeenCalledOnce()
    outside.remove()
  })

  // ---------------------------------------------------------------------------
  // 10. mousedown inside does NOT dismiss
  // ---------------------------------------------------------------------------

  it('does NOT call onDismiss on mousedown inside the picker', async () => {
    mockRankPaletteItems.mockReturnValue([scored(makeItem('a.md'))])
    const onDismiss = vi.fn()

    render(<MentionPicker {...defaultProps({ onDismiss })} />)

    const listbox = screen.getByRole('listbox')

    await act(async () => {
      fireEvent.mouseDown(listbox)
    })

    expect(onDismiss).not.toHaveBeenCalled()
  })
})
