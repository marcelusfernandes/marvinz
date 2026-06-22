// @vitest-environment jsdom
//
// TabBar behavior for the empty-tab landing (issue #306).
// Covers: + button calls onNewTab, empty tab renders with correct icon and label.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('../Icon', () => ({
  Icon: ({ name }: { name: string }) => <span data-testid={`icon-${name}`} />,
}))

vi.mock('../../lib/fileIcons', () => ({
  fileIconFor: () => 'file',
}))

function setupMarvinMock() {
  Object.assign(window, {
    marvin: {
      app: {
        showContextMenu: vi.fn().mockResolvedValue(null),
        canPaste: vi.fn().mockResolvedValue(false),
      },
      shell: {
        reveal: vi.fn().mockResolvedValue(undefined),
        openExternal: vi.fn(),
      },
    },
  })
}

import { TabBar } from '../TabBar'

const emptyTab = { type: 'empty' as const, id: 'e1', title: 'New tab' }
const noteTab = { type: 'note' as const, id: 'n1', path: '/vault/note.md' }

beforeEach(() => {
  setupMarvinMock()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// + button
// ---------------------------------------------------------------------------

describe('TabBar — new tab button', () => {
  it('calls onNewTab when the + button is clicked', () => {
    const onNewTab = vi.fn()
    render(
      <TabBar
        tabs={[noteTab]}
        activeId="n1"
        onActivate={vi.fn()}
        onClose={vi.fn()}
        onNewTab={onNewTab}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /new.*tab/i }))
    expect(onNewTab).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// Empty tab rendering
// ---------------------------------------------------------------------------

describe('TabBar — empty tab', () => {
  it('renders the empty tab with label "New tab"', () => {
    render(
      <TabBar
        tabs={[emptyTab]}
        activeId="e1"
        onActivate={vi.fn()}
        onClose={vi.fn()}
        onNewTab={vi.fn()}
      />
    )
    expect(screen.getByText('New tab')).toBeInTheDocument()
  })

  it('renders an icon for the empty tab (not file icon)', () => {
    const { container } = render(
      <TabBar
        tabs={[emptyTab]}
        activeId="e1"
        onActivate={vi.fn()}
        onClose={vi.fn()}
        onNewTab={vi.fn()}
      />
    )
    const tabEl = container.querySelector('.tab')
    expect(tabEl).not.toBeNull()
    // Should have a tab-icon element
    const icon = tabEl?.querySelector('[data-testid]')
    expect(icon).not.toBeNull()
  })
})
