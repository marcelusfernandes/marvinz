/**
 * TDD tests for FileTree selected folder state (issue #252).
 * Tests are RED until react implements selectedFolderPath + onSelectFolder props.
 *
 * Props under test:
 *   selectedFolderPath: string | null
 *   onSelectFolder: (path: string) => void
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { FileTree } from '../FileTree'
import { smallTree } from './file-tree-fixtures'
import { setupVirtualizerMocks } from './_virtualizerSetup'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Base props builder — includes new selectedFolderPath / onSelectFolder
// ---------------------------------------------------------------------------

function baseProps(overrides: Partial<Parameters<typeof FileTree>[0]> = {}) {
  return {
    nodes: smallTree,
    vaultPath: '/vault',
    selectedPath: null,
    openPaths: new Set<string>(),
    onToggleOpen: vi.fn(),
    onSelect: vi.fn(),
    onContextMenu: vi.fn(),
    onMove: vi.fn(),
    onImportResult: vi.fn(),
    selectedFolderPath: null,
    onSelectFolder: vi.fn(),
    creatingIn: null,
    onCreatingInChange: vi.fn(),
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
// Scenario A — folder-selected CSS class
// ===========================================================================

describe('FileTree — folder-selected class (issue #252)', () => {
  it('applies folder-selected class to the folder button matching selectedFolderPath', () => {
    render(
      <FileTree
        {...baseProps({ selectedFolderPath: '/vault/docs' })}
      />,
    )
    const docsBtn = screen.getByText('docs').closest('button')!
    expect(docsBtn.classList.contains('folder-selected')).toBe(true)
  })

  it('does NOT apply folder-selected to a folder that is not selected', () => {
    render(
      <FileTree
        {...baseProps({ selectedFolderPath: '/vault/docs' })}
      />,
    )
    const assetsBtn = screen.getByText('assets').closest('button')!
    expect(assetsBtn.classList.contains('folder-selected')).toBe(false)
  })

  it('does NOT apply folder-selected to any folder when selectedFolderPath is null', () => {
    const { container } = render(<FileTree {...baseProps()} />)
    const folderBtns = container.querySelectorAll('button.file-tree-row.dir')
    folderBtns.forEach((btn) => {
      expect(btn.classList.contains('folder-selected')).toBe(false)
    })
  })
})

// ===========================================================================
// Scenario B — onSelectFolder callback
// ===========================================================================

describe('FileTree — onSelectFolder callback (issue #252)', () => {
  it('calls onSelectFolder with the folder path when clicking a folder', () => {
    const onSelectFolder = vi.fn()
    render(<FileTree {...baseProps({ onSelectFolder })} />)
    const docsBtn = screen.getByText('docs').closest('button')!
    fireEvent.click(docsBtn)
    expect(onSelectFolder).toHaveBeenCalledTimes(1)
    expect(onSelectFolder).toHaveBeenCalledWith('/vault/docs')
  })

  it('still calls onToggleOpen when clicking a folder (behavior preserved)', () => {
    const onToggleOpen = vi.fn()
    const onSelectFolder = vi.fn()
    render(<FileTree {...baseProps({ onToggleOpen, onSelectFolder })} />)
    const docsBtn = screen.getByText('docs').closest('button')!
    fireEvent.click(docsBtn)
    expect(onToggleOpen).toHaveBeenCalledTimes(1)
    expect(onToggleOpen).toHaveBeenCalledWith('/vault/docs')
    expect(onSelectFolder).toHaveBeenCalledWith('/vault/docs')
  })

  it('does NOT call onSelectFolder when clicking a file', () => {
    const onSelectFolder = vi.fn()
    render(<FileTree {...baseProps({ onSelectFolder })} />)
    const readmeBtn = screen.getByText('readme').closest('button')!
    fireEvent.click(readmeBtn)
    expect(onSelectFolder).not.toHaveBeenCalled()
  })
})

// ===========================================================================
// Scenario C — click on empty root area clears selection
// ===========================================================================

describe('FileTree — click empty area clears selectedFolderPath (issue #252)', () => {
  it('calls onSelectFolder(null) when clicking the root ul outside any row', () => {
    const onSelectFolder = vi.fn()
    const { container } = render(
      <FileTree
        {...baseProps({ selectedFolderPath: '/vault/docs', onSelectFolder })}
      />,
    )
    const ul = container.querySelector('ul.file-tree')!
    fireEvent.click(ul)
    expect(onSelectFolder).toHaveBeenCalledWith(null)
  })
})

// ===========================================================================
// Scenario D — selectedFolderPath clears on vault switch (re-render with null)
// ===========================================================================

describe('FileTree — selectedFolderPath clears on vault change (issue #252)', () => {
  it('removes folder-selected class when selectedFolderPath becomes null on re-render', () => {
    const { rerender } = render(
      <FileTree {...baseProps({ selectedFolderPath: '/vault/docs' })} />,
    )
    const docsBtn = screen.getByText('docs').closest('button')!
    expect(docsBtn.classList.contains('folder-selected')).toBe(true)

    // Simulate App.tsx clearing selectedFolderPath when vault changes
    rerender(<FileTree {...baseProps({ selectedFolderPath: null })} />)
    expect(docsBtn.classList.contains('folder-selected')).toBe(false)
  })
})
