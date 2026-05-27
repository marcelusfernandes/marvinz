// @vitest-environment jsdom
//
// Unified selection model for FileTree (issue #348).
//
// Replaces the deleted file-tree-selected-folder.spec.tsx which tested the
// old selectedFolderPath / onSelectFolder / .folder-selected API.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { FileTree } from '../FileTree'
import { smallTree } from './file-tree-fixtures'
import { setupVirtualizerMocks } from './_virtualizerSetup'
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
      <FileTree {...baseProps({ selectedPaths: new Set(['/vault/docs']) })} />,
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
    const onSelect = vi.fn<(node: FileNode) => void>()
    render(<FileTree {...baseProps({ onSelect })} />)
    fireEvent.click(screen.getByText('docs').closest('button')!)
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/vault/docs', isDir: true }),
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
      <FileTree {...baseProps({ selectedPaths: new Set(['/vault/docs']) })} />,
    )
    expect(screen.getByText('docs').closest('button')!.classList.contains('selected')).toBe(true)

    rerender(<FileTree {...baseProps({ selectedPaths: new Set() })} />)
    expect(screen.getByText('docs').closest('button')!.classList.contains('selected')).toBe(false)
  })

  it('removes .selected from file button when selectedPaths resets to empty Set', () => {
    const { rerender } = render(
      <FileTree {...baseProps({ selectedPaths: new Set(['/vault/readme.md']) })} />,
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
      />,
    )
    expect(screen.getByText('readme').closest('button')!.classList.contains('active-file')).toBe(true)
  })

  it('does NOT apply .active-file when activeFilePath is null', () => {
    render(
      <FileTree
        {...baseProps({
          selectedPaths: new Set(['/vault/readme.md']),
          activeFilePath: null,
        })}
      />,
    )
    expect(screen.getByText('readme').closest('button')!.classList.contains('active-file')).toBe(false)
  })

  it('.selected and .active-file coexist on the same file row', () => {
    render(
      <FileTree
        {...baseProps({
          selectedPaths: new Set(['/vault/readme.md']),
          activeFilePath: '/vault/readme.md',
        })}
      />,
    )
    const btn = screen.getByText('readme').closest('button')!
    expect(btn.classList.contains('selected')).toBe(true)
    expect(btn.classList.contains('active-file')).toBe(true)
  })

  it('.active-file is absent when activeFilePath matches a non-visible node', () => {
    // docs is closed so intro.md is not rendered
    const { container } = render(
      <FileTree {...baseProps({ activeFilePath: '/vault/docs/intro.md' })} />,
    )
    container.querySelectorAll('button.file-tree-row').forEach((btn) => {
      expect(btn.classList.contains('active-file')).toBe(false)
    })
  })
})
