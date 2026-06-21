// @vitest-environment jsdom
//
// Unified selection model for FileTree (issue #348).
//
// Replaces the deleted file-tree-selected-folder.spec.tsx which tested the
// old selectedFolderPath / onSelectFolder / .folder-selected API.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { useState } from 'react'
import { FileTree } from '../FileTree'
import type { SelectModifiers } from '../FileTree'
import { smallTree } from './file-tree-fixtures'
import { setupVirtualizerMocks } from './_virtualizerSetup'
import { flattenVisibleTree } from '../../lib/flattenVisibleTree'
import type { FileNode } from '../../types'

vi.mock('../../lib/settingsStore', () => ({
  seedFromMain: vi.fn(),
  useSetting: (key: string) => (key === 'iconTheme' ? undefined : undefined),
  subscribe: vi.fn(() => () => {}),
  getSettings: vi.fn(() => ({})),
}))

vi.mock('../Icon', () => ({
  Icon: ({ name, className }: { name: string; className?: string }) => (
    <span data-testid={`icon-${name}`} className={className} />
  ),
}))

vi.mock('../MaterialIcon', () => ({
  MaterialIcon: ({ name, className }: { name: string; className?: string }) => (
    <img data-testid={`material-icon-${name}`} className={className} alt="" />
  ),
}))

function setupMarvinMock() {
  Object.assign(window, {
    marvin: {
      fs: {
        getPathForFile: vi.fn((f: File) => `/resolved/${f.name}`),
        importExternal: vi.fn().mockResolvedValue({ imported: [], skipped: [] }),
      },
    },
  })
}

function baseProps(overrides: Partial<Parameters<typeof FileTree>[0]> = {}) {
  return {
    nodes: smallTree,
    vaultPath: '/vault',
    selectedPaths: new Set<string>(),
    activeFilePath: null as string | null,
    openPaths: new Set<string>(),
    creatingIn: null,
    onToggleOpen: vi.fn(),
    onSelect: vi.fn(),
    onCreatingInChange: vi.fn(),
    onContextMenu: vi.fn(),
    onMove: vi.fn(),
    onImportResult: vi.fn(),
    ...overrides,
  }
}

let restoreVirtualizer: () => void

beforeEach(() => {
  restoreVirtualizer = setupVirtualizerMocks()
  setupMarvinMock()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  restoreVirtualizer()
})

// ===========================================================================
// 1. Folder row gains .selected when selectedPaths contains its path
//    (replaces "applies folder-selected class to folder matching selectedFolderPath")
// ===========================================================================

describe('FileTree — folder row .selected class', () => {
  it('folder button gains .selected when its path is in selectedPaths', () => {
    render(<FileTree {...baseProps({ selectedPaths: new Set(['/vault/docs']) })} />)
    expect(screen.getByText('docs').closest('button')!.classList.contains('selected')).toBe(true)
  })

  it('sibling folder does NOT gain .selected', () => {
    render(<FileTree {...baseProps({ selectedPaths: new Set(['/vault/docs']) })} />)
    expect(screen.getByText('assets').closest('button')!.classList.contains('selected')).toBe(false)
  })

  it('no folder is .selected when selectedPaths is empty', () => {
    const { container } = render(<FileTree {...baseProps()} />)
    container.querySelectorAll('button.file-tree-row.dir').forEach((btn) => {
      expect(btn.classList.contains('selected')).toBe(false)
    })
  })

  it('no .folder-selected class exists anywhere (old class removed)', () => {
    const { container } = render(
      <FileTree {...baseProps({ selectedPaths: new Set(['/vault/docs']) })} />
    )
    expect(container.querySelector('.folder-selected')).toBeNull()
  })
})

// ===========================================================================
// 2. Clicking a folder calls onSelect(folderNode) — same handler as file
//    (replaces "onSelectFolder callback" tests)
// ===========================================================================

describe('FileTree — folder click uses unified onSelect', () => {
  it('clicking a folder calls onSelect with that folder node', () => {
    const onSelect = vi.fn<(node: FileNode, mods: SelectModifiers) => void>()
    render(<FileTree {...baseProps({ onSelect })} />)
    fireEvent.click(screen.getByText('docs').closest('button')!)
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/vault/docs', isDir: true }),
      { cmdOrCtrl: false, shift: false }
    )
  })

  it('clicking a folder also calls onToggleOpen (expand/collapse preserved)', () => {
    const onSelect = vi.fn()
    const onToggleOpen = vi.fn<(path: string) => void>()
    render(<FileTree {...baseProps({ onSelect, onToggleOpen })} />)
    fireEvent.click(screen.getByText('docs').closest('button')!)
    expect(onToggleOpen).toHaveBeenCalledWith('/vault/docs')
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/vault/docs', isDir: true }),
      { cmdOrCtrl: false, shift: false }
    )
  })

  it('clicking a file does NOT call onToggleOpen', () => {
    const onToggleOpen = vi.fn()
    render(<FileTree {...baseProps({ onToggleOpen })} />)
    fireEvent.click(screen.getByText('readme').closest('button')!)
    expect(onToggleOpen).not.toHaveBeenCalled()
  })
})

// ===========================================================================
// 3. Selection clears on re-render with empty Set
//    (replaces "selectedFolderPath clears on vault change")
// ===========================================================================

describe('FileTree — .selected disappears when selectedPaths becomes empty', () => {
  it('removes .selected from folder button when selectedPaths resets to empty Set', () => {
    const { rerender } = render(
      <FileTree {...baseProps({ selectedPaths: new Set(['/vault/docs']) })} />
    )
    expect(screen.getByText('docs').closest('button')!.classList.contains('selected')).toBe(true)

    rerender(<FileTree {...baseProps({ selectedPaths: new Set() })} />)
    expect(screen.getByText('docs').closest('button')!.classList.contains('selected')).toBe(false)
  })

  it('removes .selected from file button when selectedPaths resets to empty Set', () => {
    const { rerender } = render(
      <FileTree {...baseProps({ selectedPaths: new Set(['/vault/readme.md']) })} />
    )
    expect(screen.getByText('readme').closest('button')!.classList.contains('selected')).toBe(true)

    rerender(<FileTree {...baseProps({ selectedPaths: new Set() })} />)
    expect(screen.getByText('readme').closest('button')!.classList.contains('selected')).toBe(false)
  })
})

// ===========================================================================
// 4. .active-file class driven by activeFilePath (new concept in #348)
// ===========================================================================

describe('FileTree — .active-file class', () => {
  it('applies .active-file to the file row matching activeFilePath', () => {
    render(
      <FileTree
        {...baseProps({
          selectedPaths: new Set(['/vault/readme.md']),
          activeFilePath: '/vault/readme.md',
        })}
      />
    )
    expect(screen.getByText('readme').closest('button')!.classList.contains('active-file')).toBe(
      true
    )
  })

  it('does NOT apply .active-file when activeFilePath is null', () => {
    render(
      <FileTree
        {...baseProps({
          selectedPaths: new Set(['/vault/readme.md']),
          activeFilePath: null,
        })}
      />
    )
    expect(screen.getByText('readme').closest('button')!.classList.contains('active-file')).toBe(
      false
    )
  })

  it('.selected and .active-file coexist on the same file row', () => {
    render(
      <FileTree
        {...baseProps({
          selectedPaths: new Set(['/vault/readme.md']),
          activeFilePath: '/vault/readme.md',
        })}
      />
    )
    const btn = screen.getByText('readme').closest('button')!
    expect(btn.classList.contains('selected')).toBe(true)
    expect(btn.classList.contains('active-file')).toBe(true)
  })

  it('.active-file is absent when activeFilePath matches a non-visible node', () => {
    // docs is closed so intro.md is not rendered
    const { container } = render(
      <FileTree {...baseProps({ activeFilePath: '/vault/docs/intro.md' })} />
    )
    container.querySelectorAll('button.file-tree-row').forEach((btn) => {
      expect(btn.classList.contains('active-file')).toBe(false)
    })
  })
})

// ===========================================================================
// 5. FileTree forwards modifier flags to onSelect (issue #349)
// ===========================================================================

describe('FileTree — onSelect receives modifier flags', () => {
  it('plain click passes { cmdOrCtrl: false, shift: false }', () => {
    const onSelect = vi.fn<(node: FileNode, mods: SelectModifiers) => void>()
    render(<FileTree {...baseProps({ onSelect })} />)
    fireEvent.click(screen.getByText('readme').closest('button')!)
    expect(onSelect).toHaveBeenCalledTimes(1)
    const [, mods] = onSelect.mock.calls[0]
    expect(mods).toEqual({ cmdOrCtrl: false, shift: false })
  })

  it('Cmd-click passes { cmdOrCtrl: true, shift: false }', () => {
    const onSelect = vi.fn<(node: FileNode, mods: SelectModifiers) => void>()
    render(<FileTree {...baseProps({ onSelect })} />)
    fireEvent.click(screen.getByText('readme').closest('button')!, { metaKey: true })
    const [, mods] = onSelect.mock.calls[0]
    expect(mods).toEqual({ cmdOrCtrl: true, shift: false })
  })

  it('Shift-click passes { cmdOrCtrl: false, shift: true }', () => {
    const onSelect = vi.fn<(node: FileNode, mods: SelectModifiers) => void>()
    render(<FileTree {...baseProps({ onSelect })} />)
    fireEvent.click(screen.getByText('readme').closest('button')!, { shiftKey: true })
    const [, mods] = onSelect.mock.calls[0]
    expect(mods).toEqual({ cmdOrCtrl: false, shift: true })
  })

  it('Ctrl-click (non-Mac) passes { cmdOrCtrl: true, shift: false }', () => {
    const onSelect = vi.fn<(node: FileNode, mods: SelectModifiers) => void>()
    render(<FileTree {...baseProps({ onSelect })} />)
    fireEvent.click(screen.getByText('readme').closest('button')!, { ctrlKey: true })
    const [, mods] = onSelect.mock.calls[0]
    expect(mods).toEqual({ cmdOrCtrl: true, shift: false })
  })

  it('folder click also passes modifiers', () => {
    const onSelect = vi.fn<(node: FileNode, mods: SelectModifiers) => void>()
    render(<FileTree {...baseProps({ onSelect })} />)
    fireEvent.click(screen.getByText('docs').closest('button')!, { metaKey: true })
    expect(onSelect).toHaveBeenCalledTimes(1)
    const [node, mods] = onSelect.mock.calls[0]
    expect(node).toMatchObject({ path: '/vault/docs', isDir: true })
    expect(mods).toEqual({ cmdOrCtrl: true, shift: false })
  })
})

// ===========================================================================
// 6. Multi-select logic: Cmd-click toggle + Shift-click range (issue #349)
//
// Uses a stateful wrapper that mirrors App.tsx's handleTreeSelect logic so we
// can assert the resulting selectedPaths and .selected classes after each gesture.
// ===========================================================================

function MultiSelectWrapper({
  initialSelectedPaths = new Set<string>(),
  initialAnchorPath = null as string | null,
  openPaths = new Set<string>(),
}: {
  initialSelectedPaths?: Set<string>
  initialAnchorPath?: string | null
  openPaths?: Set<string>
}) {
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(initialSelectedPaths)
  const [anchorPath, setAnchorPath] = useState<string | null>(initialAnchorPath)

  function handleSelect(node: FileNode, mods: SelectModifiers) {
    const path = node.path
    if (mods.cmdOrCtrl) {
      setSelectedPaths((prev) => {
        const next = new Set(prev)
        if (next.has(path)) next.delete(path)
        else next.add(path)
        return next
      })
      setAnchorPath(path)
    } else if (mods.shift && anchorPath) {
      const flat = flattenVisibleTree(smallTree, openPaths)
      const anchorIdx = flat.findIndex((it) => it.node.path === anchorPath)
      const currentIdx = flat.findIndex((it) => it.node.path === path)
      if (anchorIdx >= 0) {
        const [lo, hi] = anchorIdx < currentIdx ? [anchorIdx, currentIdx] : [currentIdx, anchorIdx]
        const range = flat.slice(lo, hi + 1).map((it) => it.node.path)
        setSelectedPaths(new Set(range))
      } else {
        // anchor no longer visible — fall back to single-select
        setSelectedPaths(new Set([path]))
        setAnchorPath(path)
      }
    } else {
      setSelectedPaths(new Set([path]))
      setAnchorPath(path)
    }
  }

  return (
    <FileTree
      nodes={smallTree}
      vaultPath="/vault"
      selectedPaths={selectedPaths}
      activeFilePath={null}
      openPaths={openPaths}
      creatingIn={null}
      onToggleOpen={vi.fn()}
      onSelect={handleSelect}
      onCreatingInChange={vi.fn()}
      onContextMenu={vi.fn()}
      onMove={vi.fn()}
      onImportResult={vi.fn()}
    />
  )
}

describe('multi-select — plain click resets', () => {
  it('plain click on a file sets selectedPaths to { clicked.path }', () => {
    render(
      <MultiSelectWrapper initialSelectedPaths={new Set(['/vault/docs', '/vault/readme.md'])} />
    )
    fireEvent.click(screen.getByText('assets').closest('button')!)
    expect(screen.getByText('assets').closest('button')!.classList.contains('selected')).toBe(true)
    expect(screen.getByText('docs').closest('button')!.classList.contains('selected')).toBe(false)
    expect(screen.getByText('readme').closest('button')!.classList.contains('selected')).toBe(false)
  })
})

describe('multi-select — Cmd-click', () => {
  it('Cmd-click on unselected item adds it to the set', () => {
    render(<MultiSelectWrapper initialSelectedPaths={new Set(['/vault/readme.md'])} />)
    fireEvent.click(screen.getByText('docs').closest('button')!, { metaKey: true })
    expect(screen.getByText('readme').closest('button')!.classList.contains('selected')).toBe(true)
    expect(screen.getByText('docs').closest('button')!.classList.contains('selected')).toBe(true)
  })

  it('Cmd-click on selected item removes it from the set', () => {
    render(
      <MultiSelectWrapper initialSelectedPaths={new Set(['/vault/readme.md', '/vault/docs'])} />
    )
    fireEvent.click(screen.getByText('docs').closest('button')!, { metaKey: true })
    expect(screen.getByText('docs').closest('button')!.classList.contains('selected')).toBe(false)
    expect(screen.getByText('readme').closest('button')!.classList.contains('selected')).toBe(true)
  })

  it('repeated Cmd-click toggles back on (add → remove → add)', () => {
    render(<MultiSelectWrapper initialSelectedPaths={new Set(['/vault/readme.md'])} />)
    const docsBtn = screen.getByText('docs').closest('button')!
    fireEvent.click(docsBtn, { metaKey: true })
    expect(docsBtn.classList.contains('selected')).toBe(true)
    fireEvent.click(docsBtn, { metaKey: true })
    expect(docsBtn.classList.contains('selected')).toBe(false)
    fireEvent.click(docsBtn, { metaKey: true })
    expect(docsBtn.classList.contains('selected')).toBe(true)
  })
})

describe('multi-select — Shift-click range', () => {
  it('Shift-click extends selection from anchor to clicked item (forward)', () => {
    // With openPaths empty, flat order is: docs, assets, readme
    // anchor = docs, shift-click readme → range = [docs, assets, readme]
    render(
      <MultiSelectWrapper
        initialSelectedPaths={new Set(['/vault/docs'])}
        initialAnchorPath="/vault/docs"
      />
    )
    fireEvent.click(screen.getByText('readme').closest('button')!, { shiftKey: true })
    expect(screen.getByText('docs').closest('button')!.classList.contains('selected')).toBe(true)
    expect(screen.getByText('assets').closest('button')!.classList.contains('selected')).toBe(true)
    expect(screen.getByText('readme').closest('button')!.classList.contains('selected')).toBe(true)
  })

  it('Shift-click extends selection from anchor to clicked item (reversed — item before anchor)', () => {
    // anchor = readme, shift-click docs → range = [docs, assets, readme]
    render(
      <MultiSelectWrapper
        initialSelectedPaths={new Set(['/vault/readme.md'])}
        initialAnchorPath="/vault/readme.md"
      />
    )
    fireEvent.click(screen.getByText('docs').closest('button')!, { shiftKey: true })
    expect(screen.getByText('docs').closest('button')!.classList.contains('selected')).toBe(true)
    expect(screen.getByText('assets').closest('button')!.classList.contains('selected')).toBe(true)
    expect(screen.getByText('readme').closest('button')!.classList.contains('selected')).toBe(true)
  })

  it('Shift-click with null anchor falls back to single-select', () => {
    render(<MultiSelectWrapper />)
    fireEvent.click(screen.getByText('readme').closest('button')!, { shiftKey: true })
    expect(screen.getByText('readme').closest('button')!.classList.contains('selected')).toBe(true)
    expect(screen.getByText('docs').closest('button')!.classList.contains('selected')).toBe(false)
    expect(screen.getByText('assets').closest('button')!.classList.contains('selected')).toBe(false)
  })

  it('Shift-click anchor preserved — second Shift-click from same anchor', () => {
    // anchor = docs, shift-click readme → [docs, assets, readme]
    // shift-click assets again → [docs, assets] (anchor still docs)
    render(
      <MultiSelectWrapper
        initialSelectedPaths={new Set(['/vault/docs'])}
        initialAnchorPath="/vault/docs"
      />
    )
    fireEvent.click(screen.getByText('readme').closest('button')!, { shiftKey: true })
    fireEvent.click(screen.getByText('assets').closest('button')!, { shiftKey: true })
    expect(screen.getByText('docs').closest('button')!.classList.contains('selected')).toBe(true)
    expect(screen.getByText('assets').closest('button')!.classList.contains('selected')).toBe(true)
    expect(screen.getByText('readme').closest('button')!.classList.contains('selected')).toBe(false)
  })

  it('collapsed folder children do not enter shift-click range', () => {
    // openPaths empty — docs children (intro.md, guide.md) are not visible
    // anchor = docs, shift-click readme → range = [docs, assets, readme], not 5 items
    render(
      <MultiSelectWrapper
        initialSelectedPaths={new Set(['/vault/docs'])}
        initialAnchorPath="/vault/docs"
        openPaths={new Set()}
      />
    )
    fireEvent.click(screen.getByText('readme').closest('button')!, { shiftKey: true })
    const allSelected = document.querySelectorAll('button.file-tree-row.selected')
    expect(allSelected).toHaveLength(3) // docs, assets, readme — not intro.md or guide.md
  })
})

// ===========================================================================
// 7. Empty-area click clears selection (issue #349, reviewer observation C)
// ===========================================================================

describe('multi-select — empty-area click clears selection', () => {
  it('clicking the empty area below the tree clears selectedPaths', () => {
    const onClearSelection = vi.fn()
    const { container } = render(
      <FileTree
        {...baseProps({
          selectedPaths: new Set(['/vault/readme.md', '/vault/docs']),
          onClearSelection,
        })}
      />
    )
    // Click the tree container itself (not a row) — handleEmptyAreaClick guards .file-tree-row children
    const treeEl = container.querySelector('[role="tree"]')!
    fireEvent.click(treeEl)
    expect(onClearSelection).toHaveBeenCalledTimes(1)
  })

  it('clicking a file row does NOT clear selection (closest .file-tree-row guard)', () => {
    const onClearSelection = vi.fn()
    render(
      <FileTree
        {...baseProps({
          selectedPaths: new Set(['/vault/readme.md']),
          onClearSelection,
        })}
      />
    )
    fireEvent.click(screen.getByText('readme').closest('button')!)
    expect(onClearSelection).not.toHaveBeenCalled()
  })
})
