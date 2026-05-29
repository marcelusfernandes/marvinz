/**
 * TDD tests for external file import: drag from Finder (FileTree) and paste (sidebar aside).
 * Issues #193 (drag) and #194 (paste).
 *
 * Strategy:
 *  - For drag: mock FileTree to capture the vaultPath + onMove props; render a real FileTree
 *    to test handlers directly, since they live inside the component.
 *  - For paste: render App and fire paste events on the sidebar aside.
 *  - Mock window.marvin.fs.importExternal and window.marvin.fs.getPathForFile.
 *  - Tests are RED until react implements the feature.
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'
import { FileTree } from '../FileTree'
import { setupVirtualizerMocks } from './_virtualizerSetup'

// ---------------------------------------------------------------------------
// Stub heavy App-level components (only needed for paste tests that render App)
// ---------------------------------------------------------------------------

vi.mock('../Editor', () => ({ Editor: () => null }))
vi.mock('../FileTreeToolbar', () => ({ FileTreeToolbar: () => null }))
vi.mock('../TabBar', () => ({ TabBar: () => null }))
vi.mock('../Splitter', () => ({
  Splitter: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))
vi.mock('../InputDialog', () => ({
  InputDialog: ({ title }: { title: string }) => (
    <div data-testid="input-dialog" data-title={title} />
  ),
}))
vi.mock('../CommandPalette', () => ({ CommandPalette: () => null }))
vi.mock('../SettingsModal', () => ({ SettingsModal: () => null }))
vi.mock('../TopBar', () => ({ TopBar: () => null }))
vi.mock('../SnapshotPanel', () => ({ SnapshotPanel: () => null }))
vi.mock('../SnapshotToast', () => ({ SnapshotToast: () => null }))
vi.mock('../ImportToast', () => ({ ImportToast: () => null }))
vi.mock('../ExternalChangeBanner', () => ({ ExternalChangeBanner: () => null }))
vi.mock('../AgentsPane', () => ({ AgentsPane: () => null }))
vi.mock('../BrowserPane', () => ({ BrowserPane: () => null }))
vi.mock('../ImageViewer', () => ({ ImageViewer: () => null }))
vi.mock('../Icon', () => ({ Icon: () => null }))
vi.mock('../MaterialIcon', () => ({ MaterialIcon: () => null }))

vi.mock('../../lib/settingsStore', () => ({
  seedFromMain: vi.fn(),
  useSetting: (_key: string, fallback: unknown) => [fallback, vi.fn()],
}))
vi.mock('../../lib/colorTheme', () => ({ useColorTheme: () => 'light', useAgentsPaneTransparent: () => false, useEditorEffects: () => {} }))
vi.mock('../../lib/visualStyle', () => ({ useVisualStyle: () => 'modern' }))
vi.mock('../../lib/paletteRanker', () => ({}))

// ---------------------------------------------------------------------------
// window.marvin mock helpers
// ---------------------------------------------------------------------------

let importExternalMock: ReturnType<typeof vi.fn>
let getPathForFileMock: ReturnType<typeof vi.fn>

function noop() {}

function setupMarvinMock() {
  importExternalMock = vi.fn().mockResolvedValue({ imported: [], skipped: [] })
  getPathForFileMock = vi.fn((file: File) => `/resolved${file.name}`)

  Object.assign(window, {
    marvin: {
      app: {
        showContextMenu: vi.fn().mockResolvedValue(null),
        canPaste: vi.fn().mockResolvedValue(false),
        onMenuAction: vi.fn(() => () => {}),
        setMenuNoteContext: vi.fn(),
      },
      shell: {
        reveal: vi.fn().mockResolvedValue(undefined),
        openExternal: vi.fn(),
      },
      vault: {
        tree: vi.fn().mockResolvedValue([]),
        watch: vi.fn().mockResolvedValue(undefined),
        onChanged: vi.fn().mockReturnValue(noop),
        pick: vi.fn().mockResolvedValue(null),
      },
      file: {
        read: vi.fn().mockResolvedValue(''),
        write: vi.fn().mockResolvedValue(undefined),
        create: vi.fn().mockResolvedValue(undefined),
        onChanged: vi.fn().mockReturnValue(noop),
      },
      folder: {
        create: vi.fn().mockResolvedValue(undefined),
      },
      path: {
        rename: vi.fn().mockResolvedValue(undefined),
        trash: vi.fn().mockResolvedValue(undefined),
      },
      settings: {
        get: vi.fn().mockResolvedValue({ vaultPath: '/vault' }),
        set: vi.fn().mockResolvedValue({}),
        onChange: vi.fn().mockReturnValue(noop),
      },
      agent: {
        detect: vi.fn().mockResolvedValue(null),
      },
      browser: {
        setAllHidden: vi.fn().mockResolvedValue(undefined),
        setActive: vi.fn().mockResolvedValue(undefined),
        navigate: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        onEvent: vi.fn().mockReturnValue(noop),
      },
      snapshot: {
        onTurnCompleted: vi.fn().mockReturnValue(noop),
        listTurns: vi.fn().mockResolvedValue([]),
        saveBuffer: vi.fn().mockResolvedValue(undefined),
        saveExternalChange: vi.fn().mockResolvedValue(undefined),
      },
      editor: {
        writeClipboard: vi.fn().mockResolvedValue(undefined),
        readClipboard: vi.fn().mockResolvedValue(''),
      },
      fs: {
        importExternal: importExternalMock,
        getPathForFile: getPathForFileMock,
      },
    },
  })
}

// ---------------------------------------------------------------------------
// Helper: build a fake DataTransfer for drag events
// ---------------------------------------------------------------------------

function makeExternalDragTransfer(files: File[]): DataTransfer {
  const dt = {
    types: ['Files'],
    files: files as unknown as FileList,
    dropEffect: 'none' as DataTransfer['dropEffect'],
    effectAllowed: 'all' as DataTransfer['effectAllowed'],
    getData: vi.fn(() => ''),
    setData: vi.fn(),
    clearData: vi.fn(),
    setDragImage: vi.fn(),
    items: [] as unknown as DataTransferItemList,
  }
  return dt as unknown as DataTransfer
}

function makeInternalDragTransfer(srcPath: string): DataTransfer {
  const dt = {
    types: ['application/x-marvin-path'],
    files: [] as unknown as FileList,
    dropEffect: 'none' as DataTransfer['dropEffect'],
    effectAllowed: 'all' as DataTransfer['effectAllowed'],
    getData: vi.fn((mime: string) =>
      mime === 'application/x-marvin-path' ? srcPath : '',
    ),
    setData: vi.fn(),
    clearData: vi.fn(),
    setDragImage: vi.fn(),
    items: [] as unknown as DataTransferItemList,
  }
  return dt as unknown as DataTransfer
}

/** Build a DOM DragEvent with a mocked dataTransfer and overridden preventDefault. */
function makeDragEvent(
  type: 'dragover' | 'drop',
  dt: DataTransfer,
  targetEl: Element,
): Event & { dataTransfer: DataTransfer; preventDefault: ReturnType<typeof vi.fn> } {
  const event = new Event(type, { bubbles: true, cancelable: true })
  const preventDefaultMock = vi.fn()
  Object.defineProperty(event, 'dataTransfer', { value: dt, writable: false })
  Object.defineProperty(event, 'preventDefault', { value: preventDefaultMock, writable: false })
  // target is set by the browser when dispatched, but we need it for the closest() guard
  // in handleRootDrop. We dispatch on the ul directly so event.target will be the ul.
  void targetEl
  return event as Event & { dataTransfer: DataTransfer; preventDefault: ReturnType<typeof vi.fn> }
}

// ---------------------------------------------------------------------------
// FileTree default props
// ---------------------------------------------------------------------------

const defaultTreeProps = {
  nodes: [
    { path: '/vault/folder', name: 'folder', isDir: true, children: [] },
    { path: '/vault/note.md', name: 'note.md', isDir: false, children: [] },
  ],
  vaultPath: '/vault',
  selectedPaths: new Set<string>(),
  activeFilePath: null,
  openPaths: new Set<string>(),
  onToggleOpen: vi.fn(),
  onSelect: vi.fn(),
  onContextMenu: vi.fn(),
  onMove: vi.fn(),
  onImportResult: vi.fn(),
  creatingIn: null,
  onCreatingInChange: vi.fn(),
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let restoreVirtualizer: () => void

beforeEach(() => {
  restoreVirtualizer = setupVirtualizerMocks()
  setupMarvinMock()
})

afterEach(() => {
  vi.restoreAllMocks()
  restoreVirtualizer()
})

// ===========================================================================
// DRAG — FileTree external drop
// ===========================================================================

describe('FileTree — external drag from Finder (issue #193)', () => {
  it('dragOver on root: accepts Files type and sets dropEffect to copy', async () => {
    const file = new File([''], 'photo.png', { type: 'image/png' })
    const dt = makeExternalDragTransfer([file])
    const { container } = render(<FileTree {...defaultTreeProps} />)
    const ul = container.querySelector('ul.file-tree')!

    const dragOverEvent = makeDragEvent('dragover', dt, ul)

    await act(async () => {
      ul.dispatchEvent(dragOverEvent)
    })

    // After the feature is implemented, dropEffect should be 'copy' and
    // preventDefault should have been called.
    expect(dragOverEvent.preventDefault).toHaveBeenCalled()
    expect(dt.dropEffect).toBe('copy')
  })

  it('dragOver on root: does not accept internal drags (keeps move dropEffect)', async () => {
    const dt = makeInternalDragTransfer('/vault/note.md')
    const { container } = render(<FileTree {...defaultTreeProps} />)
    const ul = container.querySelector('ul.file-tree')!

    const dragOverEvent = makeDragEvent('dragover', dt, ul)

    await act(async () => {
      ul.dispatchEvent(dragOverEvent)
    })

    // Internal drag: dropEffect stays 'move' (unchanged from current behavior)
    expect(dt.dropEffect).toBe('move')
  })

  it('drop on root: calls importExternal with file paths and vaultPath as destDir', async () => {
    const file = new File([''], 'photo.png', { type: 'image/png' })
    getPathForFileMock.mockReturnValue('/external/photo.png')
    const dt = makeExternalDragTransfer([file])
    const { container } = render(<FileTree {...defaultTreeProps} />)
    const ul = container.querySelector('ul.file-tree')!

    const dropEvent = makeDragEvent('drop', dt, ul)

    await act(async () => {
      ul.dispatchEvent(dropEvent)
      await Promise.resolve()
    })

    expect(getPathForFileMock).toHaveBeenCalledWith(file)
    expect(importExternalMock).toHaveBeenCalledWith(['/external/photo.png'], '/vault')
  })

  it('drop on root: calls importExternal with all files when multiple files dropped', async () => {
    const file1 = new File([''], 'a.md', { type: 'text/markdown' })
    const file2 = new File([''], 'b.md', { type: 'text/markdown' })
    getPathForFileMock
      .mockReturnValueOnce('/external/a.md')
      .mockReturnValueOnce('/external/b.md')
    const dt = makeExternalDragTransfer([file1, file2])
    const { container } = render(<FileTree {...defaultTreeProps} />)
    const ul = container.querySelector('ul.file-tree')!

    const dropEvent = makeDragEvent('drop', dt, ul)

    await act(async () => {
      ul.dispatchEvent(dropEvent)
      await Promise.resolve()
    })

    expect(importExternalMock).toHaveBeenCalledWith(
      ['/external/a.md', '/external/b.md'],
      '/vault',
    )
  })

  it('drop on root: calls preventDefault to suppress Electron default file drop', async () => {
    const file = new File([''], 'photo.png', { type: 'image/png' })
    const dt = makeExternalDragTransfer([file])
    const { container } = render(<FileTree {...defaultTreeProps} />)
    const ul = container.querySelector('ul.file-tree')!

    const dropEvent = makeDragEvent('drop', dt, ul)

    await act(async () => {
      ul.dispatchEvent(dropEvent)
      await Promise.resolve()
    })

    expect(dropEvent.preventDefault).toHaveBeenCalled()
  })

  it('drop on root: does NOT call importExternal when internal DRAG_MIME drop occurs', async () => {
    const dt = makeInternalDragTransfer('/vault/note.md')
    const onMove = vi.fn()
    const { container } = render(<FileTree {...defaultTreeProps} onMove={onMove} />)
    const ul = container.querySelector('ul.file-tree')!

    const dropEvent = makeDragEvent('drop', dt, ul)

    await act(async () => {
      ul.dispatchEvent(dropEvent)
      await Promise.resolve()
    })

    // Internal drop → onMove, not importExternal
    expect(importExternalMock).not.toHaveBeenCalled()
    expect(onMove).toHaveBeenCalledWith('/vault/note.md', '/vault')
  })

  it('drop on folder row: calls importExternal with the folder path as destDir', async () => {
    const file = new File([''], 'photo.png', { type: 'image/png' })
    getPathForFileMock.mockReturnValue('/external/photo.png')
    const dt = makeExternalDragTransfer([file])

    const openPaths = new Set(['/vault/folder'])
    const { container } = render(
      <FileTree {...defaultTreeProps} openPaths={openPaths} />,
    )

    // The folder button renders as a .file-tree-row.dir button
    const folderBtn = container.querySelector('button.file-tree-row.dir')!

    const dropEvent = makeDragEvent('drop', dt, folderBtn)

    await act(async () => {
      folderBtn.dispatchEvent(dropEvent)
      await Promise.resolve()
    })

    expect(importExternalMock).toHaveBeenCalledWith(['/external/photo.png'], '/vault/folder')
  })
})

// ===========================================================================
// PASTE — sidebar aside (issue #194)
// ===========================================================================

// Import App after mocks
import App from '../../App'

async function renderApp() {
  let container: HTMLElement | null = null
  await act(async () => {
    const result = render(<App />)
    container = result.container
    await new Promise(r => setTimeout(r, 50))
  })
  return container!
}

function makePasteEvent(files: File[]): ClipboardEvent {
  const dt = {
    files: files as unknown as FileList,
    getData: vi.fn(() => ''),
    items: [] as unknown as DataTransferItemList,
    types: files.length > 0 ? ['Files'] : [] as string[],
  }
  const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent
  Object.defineProperty(event, 'clipboardData', { value: dt, writable: false })
  Object.defineProperty(event, 'preventDefault', { value: vi.fn(), writable: false })
  return event
}

describe('Sidebar aside — paste from clipboard (issue #194)', () => {
  it('paste with files: calls importExternal with resolved paths and vaultPath', async () => {
    const file = new File([''], 'doc.md', { type: 'text/markdown' })
    getPathForFileMock.mockReturnValue('/external/doc.md')
    const container = await renderApp()
    const aside = container.querySelector('aside.sidebar')!

    const pasteEvent = makePasteEvent([file])

    await act(async () => {
      aside.dispatchEvent(pasteEvent)
      await Promise.resolve()
    })

    expect(getPathForFileMock).toHaveBeenCalledWith(file)
    expect(importExternalMock).toHaveBeenCalledWith(['/external/doc.md'], '/vault')
  })

  it('paste with files: calls preventDefault to block editor fallback', async () => {
    const file = new File([''], 'doc.md', { type: 'text/markdown' })
    getPathForFileMock.mockReturnValue('/external/doc.md')
    const container = await renderApp()
    const aside = container.querySelector('aside.sidebar')!

    const pasteEvent = makePasteEvent([file])

    await act(async () => {
      aside.dispatchEvent(pasteEvent)
      await Promise.resolve()
    })

    expect(
      (pasteEvent.preventDefault as unknown as ReturnType<typeof vi.fn>).mock.calls.length,
    ).toBeGreaterThan(0)
  })

  it('paste with empty clipboard: does NOT call importExternal', async () => {
    const container = await renderApp()
    const aside = container.querySelector('aside.sidebar')!

    const pasteEvent = makePasteEvent([])

    await act(async () => {
      aside.dispatchEvent(pasteEvent)
      await Promise.resolve()
    })

    expect(importExternalMock).not.toHaveBeenCalled()
  })

  it('paste inside an input element: does NOT call importExternal (preserves text paste)', async () => {
    const file = new File([''], 'doc.md', { type: 'text/markdown' })
    const container = await renderApp()

    // Fire paste from an INPUT inside the aside
    const input = document.createElement('input')
    const aside = container.querySelector('aside.sidebar')!
    aside.appendChild(input)

    const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent
    const dt = { files: [file] as unknown as FileList, getData: vi.fn(), items: [] as unknown as DataTransferItemList, types: ['Files'] }
    Object.defineProperty(event, 'clipboardData', { value: dt, writable: false })
    Object.defineProperty(event, 'target', { value: input, writable: false })
    Object.defineProperty(event, 'preventDefault', { value: vi.fn(), writable: false })

    await act(async () => {
      input.dispatchEvent(event)
      await Promise.resolve()
    })

    expect(importExternalMock).not.toHaveBeenCalled()
    aside.removeChild(input)
  })

  it('paste inside a textarea element: does NOT call importExternal', async () => {
    const file = new File([''], 'doc.md', { type: 'text/markdown' })
    const container = await renderApp()
    const textarea = document.createElement('textarea')
    const aside = container.querySelector('aside.sidebar')!
    aside.appendChild(textarea)

    const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent
    const dt = { files: [file] as unknown as FileList, getData: vi.fn(), items: [] as unknown as DataTransferItemList, types: ['Files'] }
    Object.defineProperty(event, 'clipboardData', { value: dt, writable: false })
    Object.defineProperty(event, 'target', { value: textarea, writable: false })
    Object.defineProperty(event, 'preventDefault', { value: vi.fn(), writable: false })

    await act(async () => {
      textarea.dispatchEvent(event)
      await Promise.resolve()
    })

    expect(importExternalMock).not.toHaveBeenCalled()
    aside.removeChild(textarea)
  })

  it('paste with active note tab: destDir is parent dir of active note (not vaultPath)', async () => {
    // Return a file nested in a subdir from vault.tree so clicking it opens a note tab.
    const noteNode = { path: '/vault/subdir/note.md', name: 'note.md', isDir: false, children: [] }
    const subdirNode = { path: '/vault/subdir', name: 'subdir', isDir: true, children: [noteNode] }
    ;(window.marvin.vault.tree as ReturnType<typeof vi.fn>).mockResolvedValue([subdirNode])
    ;(window.marvin.file.read as ReturnType<typeof vi.fn>).mockResolvedValue('# note')

    const file = new File([''], 'import.md', { type: 'text/markdown' })
    getPathForFileMock.mockReturnValue('/external/import.md')

    let container: HTMLElement | null = null
    await act(async () => {
      const result = render(<App />)
      container = result.container
      await new Promise(r => setTimeout(r, 50))
    })

    // Click the subdir to expand it, then click the note to open a tab.
    const subdirBtn = container!.querySelector('button.file-tree-row.dir')
    if (subdirBtn) {
      await act(async () => {
        subdirBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        await new Promise(r => setTimeout(r, 20))
      })
    }
    const noteBtn = container!.querySelector('button.file-tree-row:not(.dir)')
    if (noteBtn) {
      await act(async () => {
        noteBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        await new Promise(r => setTimeout(r, 20))
      })
    }

    const aside = container!.querySelector('aside.sidebar')!
    const pasteEvent = makePasteEvent([file])

    await act(async () => {
      aside.dispatchEvent(pasteEvent)
      await Promise.resolve()
    })

    // destDir should be '/vault/subdir' (parent of the active note), not '/vault'
    expect(importExternalMock).toHaveBeenCalledWith(['/external/import.md'], '/vault/subdir')
  })
})

// ===========================================================================
// onImportResult callback — FileTree drop (issue #195)
// ===========================================================================

describe('FileTree — onImportResult callback after drop', () => {
  it('calls onImportResult with ok:true and the result when importExternal resolves', async () => {
    const file = new File([''], 'photo.png', { type: 'image/png' })
    getPathForFileMock.mockReturnValue('/external/photo.png')
    const importResult = { imported: ['/vault/photo.png'], skipped: [] }
    importExternalMock.mockResolvedValue(importResult)
    const onImportResult = vi.fn()

    const { container } = render(
      <FileTree {...defaultTreeProps} onImportResult={onImportResult} />,
    )
    const ul = container.querySelector('ul.file-tree')!
    const dropEvent = makeDragEvent('drop', makeExternalDragTransfer([file]), ul)

    await act(async () => {
      ul.dispatchEvent(dropEvent)
      await Promise.resolve()
    })

    expect(onImportResult).toHaveBeenCalledWith({
      ok: true,
      result: importResult,
      destDir: '/vault',
    })
  })

  it('calls onImportResult with ok:false when importExternal rejects', async () => {
    const file = new File([''], 'photo.png', { type: 'image/png' })
    getPathForFileMock.mockReturnValue('/external/photo.png')
    importExternalMock.mockRejectedValue(new Error('disk full'))
    const onImportResult = vi.fn()

    const { container } = render(
      <FileTree {...defaultTreeProps} onImportResult={onImportResult} />,
    )
    const ul = container.querySelector('ul.file-tree')!
    const dropEvent = makeDragEvent('drop', makeExternalDragTransfer([file]), ul)

    await act(async () => {
      ul.dispatchEvent(dropEvent)
      await Promise.resolve()
    })

    expect(onImportResult).toHaveBeenCalledWith({ ok: false, error: 'disk full' })
  })
})
