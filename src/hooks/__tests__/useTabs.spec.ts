// @vitest-environment jsdom
//
// Unit tests for the useTabs hook (issue #578, extract useTabs hook), written
// against the real module — this is step 4/5's extraction target, not a
// stub. Two groups:
//
//   - Parity (must pass immediately): performCloseTab's neighbor
//     reassignment, renameInTabs' path/back/forward remap + live-buffer
//     carry, closeTabsUnder's nested-close + reassignment. These mirror the
//     App-level characterization in App-tab-lifecycle.spec.tsx and
//     App-close-tabs-under.spec.tsx — proof the extraction preserved
//     behavior, not new coverage.
//
//   - New behavior (RED against the pure-extraction commit): forgetPath must
//     clear a path from BOTH lastDiskContentRef and bufferContentRef on
//     close/rename/closeTabsUnder (today performCloseTab only clears
//     bufferContentRef and closeTabsUnder only clears lastDiskContentRef —
//     renameInTabs already remaps both correctly), and closing a tab must
//     prune its id from editorMru (today it only grows). These lock in the
//     TARGET behavior the follow-up fix commit must satisfy.

import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useTabs } from '../useTabs'
import type { NoteTab } from '../../lib/tabs'

function noteTab(overrides: Partial<NoteTab> & Pick<NoteTab, 'id' | 'path'>): NoteTab {
  return {
    type: 'note',
    content: '',
    version: 1,
    back: [],
    forward: [],
    ...overrides,
  }
}

function setup() {
  return renderHook(() => useTabs({ closeBrowserTab: vi.fn() }))
}

// ---------------------------------------------------------------------------
// Parity — must pass immediately (extraction is a pure refactor)
// ---------------------------------------------------------------------------

describe('useTabs — parity with pre-extraction App.tsx behavior', () => {
  it('performCloseTab removes the tab and reassigns activeTabId to the neighbor that shifts into its slot', () => {
    const { result } = setup()
    act(() => {
      result.current.setTabs([
        noteTab({ id: 'a', path: '/vault/a.md' }),
        noteTab({ id: 'b', path: '/vault/b.md' }),
        noteTab({ id: 'c', path: '/vault/c.md' }),
      ])
      result.current.setActiveTabId('b')
    })

    act(() => {
      result.current.performCloseTab('b')
    })

    expect(result.current.tabs.map((t) => t.id)).toEqual(['a', 'c'])
    expect(result.current.activeTabId).toBe('c')
  })

  it('performCloseTab sets activeTabId to null when closing the last remaining tab', () => {
    const { result } = setup()
    act(() => {
      result.current.setTabs([noteTab({ id: 'a', path: '/vault/a.md' })])
      result.current.setActiveTabId('a')
    })

    act(() => {
      result.current.performCloseTab('a')
    })

    expect(result.current.tabs).toEqual([])
    expect(result.current.activeTabId).toBeNull()
  })

  it('renameInTabs remaps path/back/forward and carries the live buffer over content', () => {
    const { result } = setup()
    act(() => {
      result.current.setTabs([
        noteTab({
          id: 'a',
          path: '/vault/old.md',
          content: 'saved on disk',
          back: ['/vault/old.md', '/vault/other.md'],
          forward: ['/vault/old.md'],
        }),
      ])
      result.current.bufferContentRef.current.set('/vault/old.md', 'unsaved live edit')
    })

    act(() => {
      result.current.renameInTabs('/vault/old.md', '/vault/new.md')
    })

    const tab = result.current.tabs[0] as NoteTab
    expect(tab.path).toBe('/vault/new.md')
    expect(tab.back).toEqual(['/vault/new.md', '/vault/other.md'])
    expect(tab.forward).toEqual(['/vault/new.md'])
    expect(tab.content).toBe('unsaved live edit')
  })

  it('closeTabsUnder closes every tab nested under the root and reassigns activeTabId to the first remaining tab', () => {
    const { result } = setup()
    act(() => {
      result.current.setTabs([
        noteTab({ id: 'c', path: '/vault/note-c.md' }),
        noteTab({ id: 'a', path: '/vault/sub/note-a.md' }),
        noteTab({ id: 'b', path: '/vault/sub/note-b.md' }),
      ])
      result.current.setActiveTabId('b')
    })

    act(() => {
      result.current.closeTabsUnder('/vault/sub')
    })

    expect(result.current.tabs.map((t) => t.id)).toEqual(['c'])
    expect(result.current.activeTabId).toBe('c')
  })
})

// ---------------------------------------------------------------------------
// New behavior — RED against the pure-extraction commit (bugs intact)
// ---------------------------------------------------------------------------

describe('useTabs — forgetPath dual-map cleanup (target behavior, currently unmet)', () => {
  it('performCloseTab clears the closed path from BOTH bufferContentRef and lastDiskContentRef', () => {
    const { result } = setup()
    act(() => {
      result.current.setTabs([noteTab({ id: 'a', path: '/vault/a.md' })])
      result.current.bufferContentRef.current.set('/vault/a.md', 'buffered')
      result.current.lastDiskContentRef.current.set('/vault/a.md', 'on disk')
    })

    act(() => {
      result.current.performCloseTab('a')
    })

    expect(result.current.bufferContentRef.current.has('/vault/a.md')).toBe(false)
    expect(result.current.lastDiskContentRef.current.has('/vault/a.md')).toBe(false)
  })

  it('closeTabsUnder clears nested paths from BOTH bufferContentRef and lastDiskContentRef', () => {
    const { result } = setup()
    act(() => {
      result.current.setTabs([noteTab({ id: 'a', path: '/vault/sub/a.md' })])
      result.current.bufferContentRef.current.set('/vault/sub/a.md', 'buffered')
      result.current.lastDiskContentRef.current.set('/vault/sub/a.md', 'on disk')
    })

    act(() => {
      result.current.closeTabsUnder('/vault/sub')
    })

    expect(result.current.lastDiskContentRef.current.has('/vault/sub/a.md')).toBe(false)
    expect(result.current.bufferContentRef.current.has('/vault/sub/a.md')).toBe(false)
  })
})

describe('useTabs — editorMru pruning (target behavior, currently unmet)', () => {
  it('performCloseTab removes the closed tab id from editorMru instead of leaving it to grow unbounded', () => {
    const { result } = setup()
    act(() => {
      result.current.setTabs([
        noteTab({ id: 'a', path: '/vault/a.md' }),
        noteTab({ id: 'b', path: '/vault/b.md' }),
      ])
      result.current.setEditorMru(['b', 'a'])
    })

    act(() => {
      result.current.performCloseTab('a')
    })

    expect(result.current.editorMru).not.toContain('a')
  })
})
