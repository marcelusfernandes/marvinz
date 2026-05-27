/**
 * Tests for FileTree unified selection (issue #348).
 *
 * The old selectedFolderPath + onSelectFolder API is gone.
 * Selection is now a Set<string> (selectedPaths) covering both files and folders.
 * activeFilePath drives the .active-file CSS class on file rows.
 */

// @vitest-environment jsdom

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
    onToggleOpen: vi.fn(),
    onSelect: vi.fn(),
    onCreatingInChange: vi.fn(),
    onContextMenu: vi.fn(),
    onMove: vi.fn(),
    onImportResult: vi.fn(),
    creatingIn: null,
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
// Scenario A — folder .selected class via selectedPaths Set
// ===========================================================================

describe('FileTree — folder selected class (issue #348)', () => {
  it('applies selected class to the folder button whose path is in selectedPaths', () => {
    render(<FileTree {...baseProps({ selectedPaths: new Set(['/vault/docs']) })} />)
    const docsBtn = screen.getByText('docs').closest('button')!
    expect(docsBtn.classList.contains('selected')).toBe(true)
  })

  it('does NOT apply selected to a folder not in selectedPaths', () => {
    render(<FileTree {...baseProps({ selectedPaths: new Set(['/vault/docs']) })} />)
    const assetsBtn = screen.getByText('assets').closest('button')!
    expect(assetsBtn.classList.contains('selected')).toBe(false)
  })

  it('does NOT apply selected to any folder when selectedPaths is empty', () => {
    const { container } = render(<FileTree {...baseProps()} />)
    const folderBtns = container.querySelectorAll('button.file-tree-row.dir')
    folderBtns.forEach((btn) => {
      expect(btn.classList.contains('selected')).toBe(false)
    })
  })

  it('applies selected to a folder and a file simultaneously when both are in selectedPaths', () => {
    render(
      <FileTree
        {...baseProps({
          selectedPaths: new Set(['/vault/docs', '/vault/readme.md']),
        })}
      />,
    )
    const docsBtn = screen.getByText('docs').closest('button')!
    const readmeBtn = screen.getByText('readme').closest('button')!
    expect(docsBtn.classList.contains('selected')).toBe(true)
    expect(readmeBtn.classList.contains('selected')).toBe(true)
  })
})

// ===========================================================================
// Scenario B — .active-file class driven by activeFilePath
// ===========================================================================

describe('FileTree — active-file class (issue #348)', () => {
  it('applies active-file class to the file row matching activeFilePath', () => {
    render(
      <FileTree
        {...baseProps({
          selectedPaths: new Set(['/vault/readme.md']),
          activeFilePath: '/vault/readme.md',
        })}
      />,
    )
    const readmeBtn = screen.getByText('readme').closest('button')!
    expect(readmeBtn.classList.contains('active-file')).toBe(true)
  })

  it('does NOT apply active-file when activeFilePath is null', () => {
    render(
      <FileTree
        {...baseProps({
          selectedPaths: new Set(['/vault/readme.md']),
          activeFilePath: null,
        })}
      />,
    )
    const readmeBtn = screen.getByText('readme').closest('button')!
    expect(readmeBtn.classList.contains('active-file')).toBe(false)
  })

  it('selected and active-file can coexist on the same file row', () => {
    render(
      <FileTree
        {...baseProps({
          selectedPaths: new Set(['/vault/readme.md']),
          activeFilePath: '/vault/readme.md',
        })}
      />,
    )
    const readmeBtn = screen.getByText('readme').closest('button')!
    expect(readmeBtn.classList.contains('selected')).toBe(true)
    expect(readmeBtn.classList.contains('active-file')).toBe(true)
  })

  it('active-file is absent on all rows when activeFilePath does not match any visible node', () => {
    const { container } = render(
      <FileTree {...baseProps({ activeFilePath: '/vault/docs/intro.md' })} />,
    )
    // intro.md is inside docs which is closed — not visible
    const allBtns = container.querySelectorAll('button.file-tree-row')
    allBtns.forEach((btn) => {
      expect(btn.classList.contains('active-file')).toBe(false)
    })
  })
})

// ===========================================================================
// Scenario C — folder click calls onSelect (unified callback)
// ===========================================================================

describe('FileTree — folder click calls onSelect (issue #348)', () => {
  it('calls onSelect with the folder node when clicking a folder', () => {
    const onSelect = vi.fn<(node: FileNode) => void>()
    render(<FileTree {...baseProps({ onSelect })} />)
    const docsBtn = screen.getByText('docs').closest('button')!
    fireEvent.click(docsBtn)
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/vault/docs', isDir: true }),
    )
  })

  it('still calls onToggleOpen when clicking a folder', () => {
    const onToggleOpen = vi.fn<(path: string) => void>()
    const onSelect = vi.fn()
    render(<FileTree {...baseProps({ onToggleOpen, onSelect })} />)
    const docsBtn = screen.getByText('docs').closest('button')!
    fireEvent.click(docsBtn)
    expect(onToggleOpen).toHaveBeenCalledWith('/vault/docs')
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/vault/docs', isDir: true }),
    )
  })
})

// ===========================================================================
// Scenario D — selected clears on re-render with empty Set
// ===========================================================================

describe('FileTree — selectedPaths clears on vault change (issue #348)', () => {
  it('removes selected class when selectedPaths becomes empty on re-render', () => {
    const { rerender } = render(
      <FileTree {...baseProps({ selectedPaths: new Set(['/vault/docs']) })} />,
    )
    const docsBtn = screen.getByText('docs').closest('button')!
    expect(docsBtn.classList.contains('selected')).toBe(true)

    rerender(<FileTree {...baseProps({ selectedPaths: new Set() })} />)
    expect(docsBtn.classList.contains('selected')).toBe(false)
  })

  it('no .folder-selected class exists anywhere (old class removed)', () => {
    const { container } = render(
      <FileTree {...baseProps({ selectedPaths: new Set(['/vault/docs']) })} />,
    )
    expect(container.querySelector('.folder-selected')).toBeNull()
  })
})
