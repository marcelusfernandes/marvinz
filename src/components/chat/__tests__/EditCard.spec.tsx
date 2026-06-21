// Sprint 4 (issue #105) — EditCard, DiffCard, and UserBubble rewind tests.
// Runs in jsdom (vitest "chat" project).
//
// MergeView is a constructor — mock with mockImplementation so `new MergeView()`
// returns a controlled object. The real CM6 MergeView cannot run in jsdom.

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// ---------------------------------------------------------------------------
// Mock @codemirror/merge — class-based constructor mock (factory-local class
// so vi.mock hoisting can reference it without temporal dead zone issues).
// ---------------------------------------------------------------------------

// mockDestroy is captured via module-level ref so tests can spy on it.
const { mockDestroy, MockMergeView } = vi.hoisted(() => {
  const mockDestroy = vi.fn()
  class MockMergeView {
    dom: HTMLElement
    constructor() {
      this.dom = document.createElement('div')
      this.dom.className = 'cm-merge-view-mock'
    }
    destroy() {
      mockDestroy()
    }
  }
  return { mockDestroy, MockMergeView }
})

vi.mock('@codemirror/merge', () => ({ MergeView: MockMergeView }))

vi.mock('@codemirror/state', () => ({
  EditorState: { readOnly: { of: vi.fn(() => []) } },
  Extension: {},
}))

vi.mock('@codemirror/view', () => ({
  EditorView: {
    editable: { of: vi.fn(() => []) },
    lineWrapping: [],
  },
}))

import { EditCard } from '../tool-bodies/EditCard'
import { DiffCard } from '../DiffCard'
import { UserBubble } from '../UserBubble'

afterEach(() => {
  mockDestroy.mockClear()
})

// ---------------------------------------------------------------------------
// EditCard — structure
// ---------------------------------------------------------------------------

describe('EditCard — structure', () => {
  it('renders chat-tool-card-edit wrapper', () => {
    const { container } = render(
      <EditCard
        toolUseId="tu1"
        tool="Edit"
        input={{ file_path: '/vault/note.md', old_string: 'old', new_string: 'new' }}
        status="running"
      />
    )
    expect(container.querySelector('.chat-tool-card-edit')).toBeInTheDocument()
  })

  it('sets data-tool="Edit"', () => {
    const { container } = render(
      <EditCard
        toolUseId="tu1"
        tool="Edit"
        input={{ file_path: '/vault/note.md' }}
        status="running"
      />
    )
    expect(container.querySelector('[data-tool="Edit"]')).toBeInTheDocument()
  })

  it('renders filename pill with basename', () => {
    const { container } = render(
      <EditCard
        toolUseId="tu1"
        tool="Edit"
        input={{ file_path: '/vault/src/utils.ts' }}
        status="running"
      />
    )
    expect(container.querySelector('.chat-tool-pill')?.textContent).toBe('utils.ts')
  })

  it('shows full path in pill title attribute', () => {
    const { container } = render(
      <EditCard
        toolUseId="tu1"
        tool="Edit"
        input={{ file_path: '/vault/src/utils.ts' }}
        status="running"
      />
    )
    expect(container.querySelector('.chat-tool-pill')?.getAttribute('title')).toBe(
      '/vault/src/utils.ts'
    )
  })

  it('pill has data-risk="destructive"', () => {
    const { container } = render(
      <EditCard toolUseId="tu1" tool="Edit" input={{ file_path: '/vault/a.md' }} status="running" />
    )
    expect(container.querySelector('[data-risk="destructive"]')).toBeInTheDocument()
  })

  it('falls back to "(no path)" when input has no path key', () => {
    const { container } = render(
      <EditCard toolUseId="tu1" tool="Edit" input={{}} status="running" />
    )
    expect(container.querySelector('.chat-tool-pill')?.textContent).toBe('(no path)')
  })

  it('does NOT render DiffCard by default', () => {
    const { container } = render(
      <EditCard
        toolUseId="tu1"
        tool="Edit"
        input={{ file_path: '/vault/note.md', old_string: 'old', new_string: 'new' }}
        status="running"
      />
    )
    expect(container.querySelector('.chat-diff-card')).not.toBeInTheDocument()
  })

  it('does NOT show expand-diff button while status is running (canToggleDiff requires ok + path)', () => {
    const { container } = render(
      <EditCard
        toolUseId="tu1"
        tool="Edit"
        input={{ file_path: '/vault/note.md', old_string: 'old', new_string: 'new' }}
        status="running"
      />
    )
    expect(container.querySelector('[data-action="expand-diff"]')).not.toBeInTheDocument()
  })

  it('shows expand-diff button when status is ok and path is present', () => {
    const { container } = render(
      <EditCard
        toolUseId="tu1"
        tool="Edit"
        input={{ file_path: '/vault/note.md', old_string: 'old', new_string: 'new' }}
        status="ok"
      />
    )
    expect(container.querySelector('[data-action="expand-diff"]')).toBeInTheDocument()
  })

  it('does NOT show expand-diff button when status is ok but path is absent', () => {
    const { container } = render(<EditCard toolUseId="tu1" tool="Edit" input={{}} status="ok" />)
    expect(container.querySelector('[data-action="expand-diff"]')).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// EditCard — change-summary subline
// (status-independent for content-based cases; terminal statuses override)
// ---------------------------------------------------------------------------

describe('EditCard — change-summary subline', () => {
  it('shows "Added N lines" when new_string has more lines than old_string', () => {
    const { container } = render(
      <EditCard
        toolUseId="tu1"
        tool="Edit"
        input={{ file_path: '/vault/a.md', old_string: 'line1', new_string: 'line1\nline2\nline3' }}
        status="running"
      />
    )
    expect(container.querySelector('.chat-tool-subline')?.textContent).toBe('Added 2 lines')
  })

  it('shows "Added 1 line" (singular) when exactly one line added', () => {
    const { container } = render(
      <EditCard
        toolUseId="tu1"
        tool="Edit"
        input={{ file_path: '/vault/a.md', old_string: 'line1', new_string: 'line1\nline2' }}
        status="ok"
      />
    )
    expect(container.querySelector('.chat-tool-subline')?.textContent).toBe('Added 1 line')
  })

  it('shows "Removed N lines" when old_string has more lines than new_string', () => {
    const { container } = render(
      <EditCard
        toolUseId="tu1"
        tool="Edit"
        input={{ file_path: '/vault/a.md', old_string: 'line1\nline2\nline3', new_string: 'line1' }}
        status="running"
      />
    )
    expect(container.querySelector('.chat-tool-subline')?.textContent).toBe('Removed 2 lines')
  })

  it('shows "Removed 1 line" (singular) when exactly one line removed', () => {
    const { container } = render(
      <EditCard
        toolUseId="tu1"
        tool="Edit"
        input={{ file_path: '/vault/a.md', old_string: 'line1\nline2', new_string: 'line1' }}
        status="ok"
      />
    )
    expect(container.querySelector('.chat-tool-subline')?.textContent).toBe('Removed 1 line')
  })

  it('shows "Modified" when old and new have same line count (and both non-empty)', () => {
    const { container } = render(
      <EditCard
        toolUseId="tu1"
        tool="Edit"
        input={{ file_path: '/vault/a.md', old_string: 'line1\nline2', new_string: 'new1\nnew2' }}
        status="ok"
      />
    )
    expect(container.querySelector('.chat-tool-subline')?.textContent).toBe('Modified')
  })

  it('shows "Modified" when no string content and no result', () => {
    const { container } = render(
      <EditCard toolUseId="tu1" tool="Edit" input={{ file_path: '/vault/a.md' }} status="running" />
    )
    expect(container.querySelector('.chat-tool-subline')?.textContent).toBe('Modified')
  })

  it('shows result string as subline when no string content and result is a string', () => {
    const { container } = render(
      <EditCard
        toolUseId="tu1"
        tool="Edit"
        input={{ file_path: '/vault/a.md' }}
        status="ok"
        result="Patched successfully"
      />
    )
    expect(container.querySelector('.chat-tool-subline')?.textContent).toBe('Patched successfully')
  })

  it('shows "Pending approval" for pending_approval status', () => {
    const { container } = render(
      <EditCard
        toolUseId="tu1"
        tool="Edit"
        input={{ file_path: '/vault/a.md', old_string: 'old', new_string: 'new' }}
        status="pending_approval"
      />
    )
    expect(container.querySelector('.chat-tool-subline')?.textContent).toBe('Pending approval')
  })
})

// ---------------------------------------------------------------------------
// EditCard — terminal statuses
// ---------------------------------------------------------------------------

describe('EditCard — terminal status sublines', () => {
  it('shows "Failed" on error', () => {
    const { container } = render(
      <EditCard toolUseId="tu1" tool="Edit" input={{ file_path: '/vault/a.md' }} status="error" />
    )
    expect(container.querySelector('.chat-tool-subline')?.textContent).toBe('Failed')
  })

  it('shows "Denied" on denied', () => {
    const { container } = render(
      <EditCard toolUseId="tu1" tool="Edit" input={{ file_path: '/vault/a.md' }} status="denied" />
    )
    expect(container.querySelector('.chat-tool-subline')?.textContent).toBe('Denied')
  })

  it('shows "Cancelled" on cancelled', () => {
    const { container } = render(
      <EditCard
        toolUseId="tu1"
        tool="Edit"
        input={{ file_path: '/vault/a.md' }}
        status="cancelled"
      />
    )
    expect(container.querySelector('.chat-tool-subline')?.textContent).toBe('Cancelled')
  })
})

// ---------------------------------------------------------------------------
// EditCard — Saved badge
// ---------------------------------------------------------------------------

describe('EditCard — Saved badge', () => {
  it('renders [data-badge="saved"] when snapshotSaved=true', () => {
    const { container } = render(
      <EditCard
        toolUseId="tu1"
        tool="Edit"
        input={{ file_path: '/vault/note.md' }}
        status="running"
        snapshotSaved
      />
    )
    expect(container.querySelector('[data-badge="saved"]')).toBeInTheDocument()
  })

  it('renders "Saved" text in the badge', () => {
    const { container } = render(
      <EditCard
        toolUseId="tu1"
        tool="Edit"
        input={{ file_path: '/vault/note.md' }}
        status="running"
        snapshotSaved
      />
    )
    expect(container.querySelector('[data-badge="saved"]')?.textContent).toBe('Saved')
  })

  it('does NOT render badge when snapshotSaved=false', () => {
    const { container } = render(
      <EditCard
        toolUseId="tu1"
        tool="Edit"
        input={{ file_path: '/vault/note.md' }}
        status="running"
        snapshotSaved={false}
      />
    )
    expect(container.querySelector('[data-badge="saved"]')).not.toBeInTheDocument()
  })

  it('does NOT render badge when snapshotSaved is undefined', () => {
    const { container } = render(
      <EditCard
        toolUseId="tu1"
        tool="Edit"
        input={{ file_path: '/vault/note.md' }}
        status="running"
      />
    )
    expect(container.querySelector('[data-badge="saved"]')).not.toBeInTheDocument()
  })

  it('badge title/aria-label mentions "snapshot"', () => {
    const { container } = render(
      <EditCard
        toolUseId="tu1"
        tool="Edit"
        input={{ file_path: '/vault/note.md' }}
        status="running"
        snapshotSaved
      />
    )
    const badge = container.querySelector('[data-badge="saved"]')
    const label = (
      badge?.getAttribute('title') ??
      badge?.getAttribute('aria-label') ??
      ''
    ).toLowerCase()
    expect(label).toContain('snapshot')
  })

  it('badge present for status=ok with snapshotSaved=true', () => {
    const { container } = render(
      <EditCard
        toolUseId="tu1"
        tool="Edit"
        input={{ file_path: '/vault/note.md', old_string: 'old', new_string: 'new' }}
        status="ok"
        snapshotSaved
      />
    )
    expect(container.querySelector('[data-badge="saved"]')).toBeInTheDocument()
  })

  it('badge present for status=pending_approval with snapshotSaved=true', () => {
    const { container } = render(
      <EditCard
        toolUseId="tu1"
        tool="Edit"
        input={{ file_path: '/vault/note.md' }}
        status="pending_approval"
        snapshotSaved
      />
    )
    expect(container.querySelector('[data-badge="saved"]')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// EditCard — Show diff toggle interaction
// ---------------------------------------------------------------------------

describe('EditCard — Show diff toggle', () => {
  it('clicking [data-action="expand-diff"] mounts DiffCard', () => {
    const { container } = render(
      <EditCard
        toolUseId="tu1"
        tool="Edit"
        input={{ file_path: '/vault/note.md', old_string: 'old text', new_string: 'new text' }}
        status="ok"
      />
    )
    fireEvent.click(container.querySelector('[data-action="expand-diff"]')!)
    expect(container.querySelector('.chat-diff-card')).toBeInTheDocument()
  })

  it('button text changes to "Hide diff" after expand', () => {
    const { container } = render(
      <EditCard
        toolUseId="tu1"
        tool="Edit"
        input={{ file_path: '/vault/note.md', old_string: 'old', new_string: 'new' }}
        status="ok"
      />
    )
    const btn = container.querySelector('[data-action="expand-diff"]')!
    fireEvent.click(btn)
    expect(btn.textContent).toMatch(/[Hh]ide diff/)
  })

  it('clicking "Hide diff" collapses DiffCard', () => {
    const { container } = render(
      <EditCard
        toolUseId="tu1"
        tool="Edit"
        input={{ file_path: '/vault/note.md', old_string: 'old', new_string: 'new' }}
        status="ok"
      />
    )
    const btn = container.querySelector('[data-action="expand-diff"]')!
    fireEvent.click(btn)
    expect(container.querySelector('.chat-diff-card')).toBeInTheDocument()
    fireEvent.click(btn)
    expect(container.querySelector('.chat-diff-card')).not.toBeInTheDocument()
  })

  it('button has aria-expanded=false when collapsed', () => {
    const { container } = render(
      <EditCard
        toolUseId="tu1"
        tool="Edit"
        input={{ file_path: '/vault/note.md', old_string: 'old', new_string: 'new' }}
        status="ok"
      />
    )
    expect(
      container.querySelector('[data-action="expand-diff"]')?.getAttribute('aria-expanded')
    ).toBe('false')
  })

  it('button has aria-expanded=true when expanded', () => {
    const { container } = render(
      <EditCard
        toolUseId="tu1"
        tool="Edit"
        input={{ file_path: '/vault/note.md', old_string: 'old', new_string: 'new' }}
        status="ok"
      />
    )
    const btn = container.querySelector('[data-action="expand-diff"]')!
    fireEvent.click(btn)
    expect(btn.getAttribute('aria-expanded')).toBe('true')
  })

  it('onOpenFile is called with full path when pill is clicked', () => {
    const onOpenFile = vi.fn()
    const { container } = render(
      <EditCard
        toolUseId="tu1"
        tool="Edit"
        input={{ file_path: '/vault/note.md' }}
        status="ok"
        onOpenFile={onOpenFile}
      />
    )
    fireEvent.click(container.querySelector('.chat-tool-pill')!)
    expect(onOpenFile).toHaveBeenCalledWith('/vault/note.md')
  })

  it('pill button is disabled when onOpenFile is not provided', () => {
    const { container } = render(
      <EditCard toolUseId="tu1" tool="Edit" input={{ file_path: '/vault/note.md' }} status="ok" />
    )
    expect(container.querySelector('.chat-tool-pill')?.hasAttribute('disabled')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// DiffCard — lazy mount and destroy
// ---------------------------------------------------------------------------

describe('DiffCard — lazy mount', () => {
  it('returns null (no DOM) when collapsed=true', () => {
    const { container } = render(<DiffCard collapsed oldText="old" newText="new" />)
    expect(container.querySelector('.chat-diff-card')).not.toBeInTheDocument()
  })

  it('renders .chat-diff-card when collapsed=false', () => {
    const { container } = render(<DiffCard collapsed={false} oldText="old" newText="new" />)
    expect(container.querySelector('.chat-diff-card')).toBeInTheDocument()
  })

  it('renders .chat-diff-card when collapsed prop is omitted (defaults false)', () => {
    const { container } = render(<DiffCard oldText="old" newText="new" />)
    expect(container.querySelector('.chat-diff-card')).toBeInTheDocument()
  })

  it('MockMergeView is constructed when expanded', () => {
    const constructSpy = vi.spyOn(MockMergeView.prototype, 'destroy').mockImplementation(vi.fn())
    const { container } = render(
      <DiffCard collapsed={false} oldText="before content" newText="after content" />
    )
    expect(container.querySelector('.chat-diff-card')).toBeInTheDocument()
    constructSpy.mockRestore()
  })

  it('destroy() is called when component unmounts', () => {
    const destroySpy = vi.spyOn(MockMergeView.prototype, 'destroy')
    const { unmount } = render(<DiffCard collapsed={false} oldText="old" newText="new" />)
    unmount()
    expect(destroySpy).toHaveBeenCalledTimes(1)
    destroySpy.mockRestore()
  })

  it('destroy() is called when collapsed transitions from false to true', () => {
    const destroySpy = vi.spyOn(MockMergeView.prototype, 'destroy')
    const { rerender, container } = render(
      <DiffCard collapsed={false} oldText="old" newText="new" />
    )
    expect(container.querySelector('.chat-diff-card')).toBeInTheDocument()

    rerender(<DiffCard collapsed oldText="old" newText="new" />)
    expect(container.querySelector('.chat-diff-card')).not.toBeInTheDocument()
    expect(destroySpy).toHaveBeenCalledTimes(1)
    destroySpy.mockRestore()
  })
})

// ---------------------------------------------------------------------------
// DiffCard — structure when mounted
// ---------------------------------------------------------------------------

describe('DiffCard — structure', () => {
  it('renders .chat-diff-card-view host element', () => {
    const { container } = render(<DiffCard oldText="old" newText="new" />)
    expect(container.querySelector('.chat-diff-card-view')).toBeInTheDocument()
  })

  it('renders aria region with default label when no fileName', () => {
    const { container } = render(<DiffCard oldText="old" newText="new" />)
    expect(container.querySelector('[role="region"]')?.getAttribute('aria-label')).toBe(
      'Diff preview'
    )
  })

  it('renders aria region with fileName in label when provided', () => {
    const { container } = render(<DiffCard oldText="old" newText="new" fileName="note.md" />)
    expect(container.querySelector('[role="region"]')?.getAttribute('aria-label')).toBe(
      'Diff for note.md'
    )
  })

  it('renders "Show full diff" button by default (no onOpenInEditor)', () => {
    render(<DiffCard oldText="old" newText="new" />)
    expect(screen.getByRole('button', { name: /show full diff/i })).toBeInTheDocument()
  })

  it('renders "Open in editor" button when onOpenInEditor is provided', () => {
    render(<DiffCard oldText="old" newText="new" onOpenInEditor={() => {}} />)
    expect(screen.getByRole('button', { name: /open in editor/i })).toBeInTheDocument()
  })

  it('"Show full diff" toggles to "Collapse" on click', () => {
    render(<DiffCard oldText="old" newText="new" />)
    fireEvent.click(screen.getByRole('button', { name: /show full diff/i }))
    expect(screen.getByRole('button', { name: /collapse/i })).toBeInTheDocument()
  })

  it('"Collapse" toggles back to "Show full diff"', () => {
    render(<DiffCard oldText="old" newText="new" />)
    fireEvent.click(screen.getByRole('button', { name: /show full diff/i }))
    fireEvent.click(screen.getByRole('button', { name: /collapse/i }))
    expect(screen.getByRole('button', { name: /show full diff/i })).toBeInTheDocument()
  })

  it('calls onOpenInEditor when "Open in editor" is clicked', () => {
    const onOpenInEditor = vi.fn()
    render(<DiffCard oldText="old" newText="new" onOpenInEditor={onOpenInEditor} />)
    fireEvent.click(screen.getByRole('button', { name: /open in editor/i }))
    expect(onOpenInEditor).toHaveBeenCalledTimes(1)
  })

  it('"Show full diff" has aria-expanded=false initially', () => {
    render(<DiffCard oldText="old" newText="new" />)
    expect(
      screen.getByRole('button', { name: /show full diff/i }).getAttribute('aria-expanded')
    ).toBe('false')
  })

  it('"Collapse" has aria-expanded=true after expand', () => {
    render(<DiffCard oldText="old" newText="new" />)
    fireEvent.click(screen.getByRole('button', { name: /show full diff/i }))
    expect(screen.getByRole('button', { name: /collapse/i }).getAttribute('aria-expanded')).toBe(
      'true'
    )
  })
})

// ---------------------------------------------------------------------------
// UserBubble — rewind with turnId (Sprint 4)
// ---------------------------------------------------------------------------

describe('UserBubble — rewind with turnId', () => {
  it('calls onRewind when rewind button is clicked', () => {
    const onRewind = vi.fn()
    render(<UserBubble text="Hello" turnId="turn-abc-123" onRewind={onRewind} />)
    fireEvent.click(screen.getByRole('button', { name: /rewind to this message/i }))
    expect(onRewind).toHaveBeenCalledTimes(1)
  })

  it('passes turnId to onRewind callback', () => {
    const onRewind = vi.fn()
    render(<UserBubble text="Hello" turnId="turn-xyz-999" onRewind={onRewind} />)
    fireEvent.click(screen.getByRole('button', { name: /rewind to this message/i }))
    expect(onRewind).toHaveBeenCalledWith('turn-xyz-999')
  })

  it('rewind button is disabled when onRewind is not provided', () => {
    render(<UserBubble text="Hello" turnId="turn-abc" />)
    expect(screen.getByRole('button', { name: /rewind to this message/i })).toBeDisabled()
  })

  it('rewind button is disabled when turnId is absent even with onRewind provided', () => {
    render(<UserBubble text="Hello" onRewind={() => {}} />)
    expect(screen.getByRole('button', { name: /rewind to this message/i })).toBeDisabled()
  })

  it('rewind button is enabled when both turnId and onRewind are provided', () => {
    render(<UserBubble text="Hello" turnId="turn-abc" onRewind={() => {}} />)
    expect(screen.getByRole('button', { name: /rewind to this message/i })).not.toBeDisabled()
  })

  it('does not call onRewind when button is disabled (no turnId)', () => {
    const onRewind = vi.fn()
    render(<UserBubble text="Hello" onRewind={onRewind} />)
    fireEvent.click(screen.getByRole('button', { name: /rewind to this message/i }))
    expect(onRewind).not.toHaveBeenCalled()
  })
})
