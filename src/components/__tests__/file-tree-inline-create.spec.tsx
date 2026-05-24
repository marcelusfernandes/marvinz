/**
 * TDD tests for FileTree inline create (issue #254).
 * Tests are RED until react implements creatingIn + onCreatingInChange props.
 *
 * Props under test:
 *   creatingIn: { parentDir: string; kind: 'file' | 'folder' } | null
 *   onCreatingInChange: (value: { parentDir: string; kind: 'file' | 'folder' } | null) => void
 *
 * IPC mocks:
 *   window.marvin.file.create(parentDir, name)
 *   window.marvin.folder.create(parentDir, name)
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

let fileCreateMock: ReturnType<typeof vi.fn>
let folderCreateMock: ReturnType<typeof vi.fn>

function setupMarvinMock() {
  fileCreateMock = vi.fn().mockResolvedValue(undefined)
  folderCreateMock = vi.fn().mockResolvedValue(undefined)

  Object.assign(window, {
    marvin: {
      fs: {
        getPathForFile: vi.fn((f: File) => `/resolved/${f.name}`),
        importExternal: vi.fn().mockResolvedValue({ imported: [], skipped: [] }),
      },
      file: {
        create: fileCreateMock,
      },
      folder: {
        create: folderCreateMock,
      },
    },
  })
}

// ---------------------------------------------------------------------------
// Base props builder
// ---------------------------------------------------------------------------

function baseProps(overrides: Partial<Parameters<typeof FileTree>[0]> = {}) {
  return {
    nodes: smallTree,
    vaultPath: '/vault',
    selectedPath: null,
    openPaths: new Set<string>(['/vault/docs']),
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
// Scenario C — inline create row render
// ===========================================================================

describe('FileTree — inline create row render (issue #254)', () => {
  it('renders an inline input with aria-label "New file name" when kind is file', () => {
    render(
      <FileTree
        {...baseProps({
          creatingIn: { parentDir: '/vault/docs', kind: 'file' },
        })}
      />,
    )
    const input = screen.getByRole('textbox', { name: 'New file name' })
    expect(input).toBeTruthy()
  })

  it('renders an inline input with aria-label "New folder name" when kind is folder', () => {
    render(
      <FileTree
        {...baseProps({
          creatingIn: { parentDir: '/vault/docs', kind: 'folder' },
        })}
      />,
    )
    const input = screen.getByRole('textbox', { name: 'New folder name' })
    expect(input).toBeTruthy()
  })

  it('does NOT render an inline input when creatingIn is null', () => {
    render(<FileTree {...baseProps({ creatingIn: null })} />)
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('inline create row has file-tree-row, inline-edit, and kind modifier classes', () => {
    const { container } = render(
      <FileTree
        {...baseProps({
          creatingIn: { parentDir: '/vault/docs', kind: 'file' },
        })}
      />,
    )
    const inlineRow = container.querySelector('.file-tree-row.inline-edit.file')
    expect(inlineRow).not.toBeNull()
  })
})

// ===========================================================================
// Scenario D — Enter key creates file/folder via IPC
// ===========================================================================

describe('FileTree — inline create Enter key (issue #254)', () => {
  it('calls marvin.file.create with parentDir and typed name on Enter', async () => {
    const onCreatingInChange = vi.fn()
    render(
      <FileTree
        {...baseProps({
          creatingIn: { parentDir: '/vault/docs', kind: 'file' },
          onCreatingInChange,
        })}
      />,
    )
    const input = screen.getByRole('textbox', { name: 'New file name' })
    fireEvent.change(input, { target: { value: 'my-note' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await vi.waitFor(() => {
      expect(fileCreateMock).toHaveBeenCalledTimes(1)
      // Appends .md automatically when no extension
      expect(fileCreateMock).toHaveBeenCalledWith('/vault/docs', 'my-note.md')
    })
  })

  it('calls marvin.folder.create with parentDir and typed name on Enter', async () => {
    const onCreatingInChange = vi.fn()
    render(
      <FileTree
        {...baseProps({
          creatingIn: { parentDir: '/vault/docs', kind: 'folder' },
          onCreatingInChange,
        })}
      />,
    )
    const input = screen.getByRole('textbox', { name: 'New folder name' })
    fireEvent.change(input, { target: { value: 'new-folder' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await vi.waitFor(() => {
      expect(folderCreateMock).toHaveBeenCalledTimes(1)
      expect(folderCreateMock).toHaveBeenCalledWith('/vault/docs', 'new-folder')
    })
  })

  it('calls onCreatingInChange(null) after successful create', async () => {
    const onCreatingInChange = vi.fn()
    render(
      <FileTree
        {...baseProps({
          creatingIn: { parentDir: '/vault/docs', kind: 'file' },
          onCreatingInChange,
        })}
      />,
    )
    const input = screen.getByRole('textbox', { name: 'New file name' })
    fireEvent.change(input, { target: { value: 'my-note' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await vi.waitFor(() => {
      expect(onCreatingInChange).toHaveBeenCalledWith(null)
    })
  })

  it('does NOT call marvin.file.create when name is empty on Enter', () => {
    const onCreatingInChange = vi.fn()
    render(
      <FileTree
        {...baseProps({
          creatingIn: { parentDir: '/vault/docs', kind: 'file' },
          onCreatingInChange,
        })}
      />,
    )
    const input = screen.getByRole('textbox', { name: 'New file name' })
    // No change — value stays ''
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(fileCreateMock).not.toHaveBeenCalled()
    expect(onCreatingInChange).not.toHaveBeenCalled()
  })

  it('preserves existing .md extension when user types it explicitly', async () => {
    render(
      <FileTree
        {...baseProps({
          creatingIn: { parentDir: '/vault/docs', kind: 'file' },
          onCreatingInChange: vi.fn(),
        })}
      />,
    )
    const input = screen.getByRole('textbox', { name: 'New file name' })
    fireEvent.change(input, { target: { value: 'my-note.md' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await vi.waitFor(() => {
      // Should NOT double-append .md
      expect(fileCreateMock).toHaveBeenCalledWith('/vault/docs', 'my-note.md')
    })
  })
})

// ===========================================================================
// Scenario E — Duplicate name shows error inline, keeps input open
// ===========================================================================

describe('FileTree — inline create duplicate name error (issue #254)', () => {
  it('shows error class on input and does NOT call onCreatingInChange when IPC rejects with EEXIST', async () => {
    fileCreateMock.mockRejectedValueOnce(new Error('File already exists'))
    const onCreatingInChange = vi.fn()
    render(
      <FileTree
        {...baseProps({
          creatingIn: { parentDir: '/vault/docs', kind: 'file' },
          onCreatingInChange,
        })}
      />,
    )
    const input = screen.getByRole('textbox', { name: 'New file name' })
    fireEvent.change(input, { target: { value: 'intro' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await vi.waitFor(() => {
      // Input must still be present (not cleared)
      const input = screen.getByRole('textbox', { name: 'New file name' })
      expect(input).toBeTruthy()
      // State is NOT cleared — input stays open
      expect(onCreatingInChange).not.toHaveBeenCalled()
      // Error class and aria-invalid applied to the input
      expect(input.classList.contains('input-error')).toBe(true)
      expect(input.getAttribute('aria-invalid')).toBe('true')
    })
  })
})

// ===========================================================================
// Scenario F — Escape and onBlur cancel create
// ===========================================================================

describe('FileTree — inline create Escape and blur cancel (issue #254)', () => {
  it('calls onCreatingInChange(null) on Escape without creating', () => {
    const onCreatingInChange = vi.fn()
    render(
      <FileTree
        {...baseProps({
          creatingIn: { parentDir: '/vault/docs', kind: 'file' },
          onCreatingInChange,
        })}
      />,
    )
    const input = screen.getByRole('textbox', { name: 'New file name' })
    fireEvent.change(input, { target: { value: 'something' } })
    fireEvent.keyDown(input, { key: 'Escape' })

    expect(fileCreateMock).not.toHaveBeenCalled()
    expect(onCreatingInChange).toHaveBeenCalledWith(null)
  })

  it('calls onCreatingInChange(null) on blur without creating', () => {
    const onCreatingInChange = vi.fn()
    render(
      <FileTree
        {...baseProps({
          creatingIn: { parentDir: '/vault/docs', kind: 'file' },
          onCreatingInChange,
        })}
      />,
    )
    const input = screen.getByRole('textbox', { name: 'New file name' })
    fireEvent.change(input, { target: { value: 'something' } })
    fireEvent.blur(input)

    expect(fileCreateMock).not.toHaveBeenCalled()
    expect(onCreatingInChange).toHaveBeenCalledWith(null)
  })
})

// ===========================================================================
// Scenario G — Root inline create (parentDir === vaultPath)
// ===========================================================================

describe('FileTree — inline create at vault root (issue #254)', () => {
  it('renders inline input at the root level when creatingIn.parentDir equals vaultPath', () => {
    render(
      <FileTree
        {...baseProps({
          // openPaths is empty — no folders open, but root row renders in <ul.file-tree> directly
          openPaths: new Set<string>(),
          creatingIn: { parentDir: '/vault', kind: 'file' },
        })}
      />,
    )
    const input = screen.getByRole('textbox', { name: 'New file name' })
    expect(input).toBeTruthy()
  })

  it('calls marvin.file.create with vaultPath as parentDir on Enter at root', async () => {
    render(
      <FileTree
        {...baseProps({
          openPaths: new Set<string>(),
          creatingIn: { parentDir: '/vault', kind: 'file' },
          onCreatingInChange: vi.fn(),
        })}
      />,
    )
    const input = screen.getByRole('textbox', { name: 'New file name' })
    fireEvent.change(input, { target: { value: 'root-note' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await vi.waitFor(() => {
      expect(fileCreateMock).toHaveBeenCalledWith('/vault', 'root-note.md')
    })
  })
})

// ===========================================================================
// Scenario H — Auto-expand closed parent folder when creatingIn is set
// ===========================================================================

describe('FileTree — inline create auto-expand closed folder (issue #254)', () => {
  it('calls onToggleOpen for the parentDir when the target folder is closed', () => {
    const onToggleOpen = vi.fn()
    render(
      <FileTree
        {...baseProps({
          // docs folder is closed (not in openPaths)
          openPaths: new Set<string>(),
          onToggleOpen,
          creatingIn: { parentDir: '/vault/docs', kind: 'file' },
        })}
      />,
    )
    // useEffect fires on mount — onToggleOpen should have been called to expand the folder
    expect(onToggleOpen).toHaveBeenCalledWith('/vault/docs')
  })

  it('does NOT call onToggleOpen when the target folder is already open', () => {
    const onToggleOpen = vi.fn()
    render(
      <FileTree
        {...baseProps({
          openPaths: new Set(['/vault/docs']),
          onToggleOpen,
          creatingIn: { parentDir: '/vault/docs', kind: 'file' },
        })}
      />,
    )
    expect(onToggleOpen).not.toHaveBeenCalled()
  })
})
