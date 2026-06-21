/**
 * Tests for the file tree context menu after migration to app:show-context-menu IPC.
 * Issue #174: native context menus for File Tree and Properties.
 *
 * Strategy:
 *  - Mock FileTree to capture the onContextMenu prop App passes to it.
 *  - Call that prop directly with a synthetic event and a fake FileNode.
 *  - Assert window.marvin.app.showContextMenu is called with the correct MenuItemSpec[].
 *  - Assert the returned action id triggers the correct handler.
 *
 * Avoids testing the full render pipeline by capturing the handler closure.
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'
import type { FileNode } from '../../types'
import { setupVirtualizerMocks } from './_virtualizerSetup'

// ---------------------------------------------------------------------------
// Capture the onContextMenu prop that App passes to FileTree
// ---------------------------------------------------------------------------

type ContextMenuHandler = (e: React.MouseEvent, node: FileNode) => void
let capturedOnContextMenu: ContextMenuHandler | null = null

vi.mock('../FileTree', () => ({
  FileTree: (props: { onContextMenu: ContextMenuHandler }) => {
    capturedOnContextMenu = props.onContextMenu
    return <div data-testid="file-tree" />
  },
}))

// ---------------------------------------------------------------------------
// Stub heavy components App imports
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
vi.mock('../ExternalChangeBanner', () => ({ ExternalChangeBanner: () => null }))
vi.mock('../AgentsPane', () => ({ AgentsPane: () => null }))
vi.mock('../BrowserPane', () => ({ BrowserPane: () => null }))
vi.mock('../ImageViewer', () => ({ ImageViewer: () => null }))
vi.mock('../Icon', () => ({ Icon: () => null }))

vi.mock('../../lib/settingsStore', () => ({
  seedFromMain: vi.fn(),
  useSetting: (_key: string, fallback: unknown) => [fallback, vi.fn()],
}))
vi.mock('../../lib/colorTheme', () => ({
  useColorTheme: () => 'light',
  useAgentsPaneTransparent: () => false,
  useEditorEffects: () => {},
}))
vi.mock('../../lib/visualStyle', () => ({ useVisualStyle: () => 'modern' }))
vi.mock('../../lib/paletteRanker', () => ({}))

// ---------------------------------------------------------------------------
// window.marvin mock
// ---------------------------------------------------------------------------

type MenuItemSpec =
  | { kind: 'item'; id: string; label: string; enabled?: boolean }
  | { kind: 'separator' }

let showContextMenuMock: ReturnType<typeof vi.fn>
let shellRevealMock: ReturnType<typeof vi.fn>
let trashMock: ReturnType<typeof vi.fn>

function noop() {}

function setupMarvinMock() {
  showContextMenuMock = vi.fn()
  shellRevealMock = vi.fn().mockResolvedValue(undefined)
  trashMock = vi.fn().mockResolvedValue(undefined)

  // Attach marvin directly to the existing jsdom window to preserve native
  // DOM methods (addEventListener, localStorage, etc.).
  Object.assign(window, {
    marvin: {
      app: {
        showContextMenu: showContextMenuMock,
        canPaste: vi.fn().mockResolvedValue(false),
        onMenuAction: vi.fn(() => () => {}),
        setMenuNoteContext: vi.fn(),
      },
      shell: {
        reveal: shellRevealMock,
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
        trash: trashMock,
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
    },
  })
}

// ---------------------------------------------------------------------------
// Import App after all mocks
// ---------------------------------------------------------------------------

import App from '../../App'

// ---------------------------------------------------------------------------
// Fake nodes
// ---------------------------------------------------------------------------

const fakeFile: FileNode = { path: '/vault/note.md', name: 'note.md', isDir: false, children: [] }
const fakeDir: FileNode = { path: '/vault/folder', name: 'folder', isDir: true, children: [] }

// ---------------------------------------------------------------------------
// Synthetic right-click event
// ---------------------------------------------------------------------------

function fakeRightClick(): React.MouseEvent {
  return {
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    clientX: 100,
    clientY: 100,
  } as unknown as React.MouseEvent
}

// ---------------------------------------------------------------------------
// Render App and wait for bootstrap to complete (settings.get resolves → FileTree renders)
// ---------------------------------------------------------------------------

async function renderApp() {
  capturedOnContextMenu = null
  await act(async () => {
    render(<App />)
    // Allow all async effects (settings.get, agent.detect, vault.watch, vault.tree) to settle
    await new Promise((r) => setTimeout(r, 50))
  })
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

// ---------------------------------------------------------------------------
// IPC payload — file node
// ---------------------------------------------------------------------------

describe('File Tree — file node context menu IPC payload', () => {
  it('calls showContextMenu when right-clicking a file node', async () => {
    showContextMenuMock.mockResolvedValue(null)
    await renderApp()
    expect(capturedOnContextMenu).toBeTypeOf('function')
    await act(async () => {
      await capturedOnContextMenu!(fakeRightClick(), fakeFile)
    })
    expect(showContextMenuMock).toHaveBeenCalledTimes(1)
    const [items] = showContextMenuMock.mock.calls[0] as [MenuItemSpec[]]
    expect(Array.isArray(items)).toBe(true)
  })

  it('includes Rename item with id "rename" for a file', async () => {
    showContextMenuMock.mockResolvedValue(null)
    await renderApp()
    await act(async () => {
      await capturedOnContextMenu!(fakeRightClick(), fakeFile)
    })
    const [items] = showContextMenuMock.mock.calls[0] as [MenuItemSpec[]]
    const rename = items.find(
      (i) => i.kind === 'item' && (i as Extract<MenuItemSpec, { kind: 'item' }>).id === 'rename'
    ) as Extract<MenuItemSpec, { kind: 'item' }> | undefined
    expect(rename?.label).toBe('Rename')
  })

  it('includes Reveal in Finder item with id "reveal" for a file', async () => {
    showContextMenuMock.mockResolvedValue(null)
    await renderApp()
    await act(async () => {
      await capturedOnContextMenu!(fakeRightClick(), fakeFile)
    })
    const [items] = showContextMenuMock.mock.calls[0] as [MenuItemSpec[]]
    const reveal = items.find(
      (i) => i.kind === 'item' && (i as Extract<MenuItemSpec, { kind: 'item' }>).id === 'reveal'
    ) as Extract<MenuItemSpec, { kind: 'item' }> | undefined
    expect(reveal?.label).toBe('Reveal in Finder')
  })

  it('includes Move file to Trash item with id "trash" for a file', async () => {
    showContextMenuMock.mockResolvedValue(null)
    await renderApp()
    await act(async () => {
      await capturedOnContextMenu!(fakeRightClick(), fakeFile)
    })
    const [items] = showContextMenuMock.mock.calls[0] as [MenuItemSpec[]]
    const trash = items.find(
      (i) => i.kind === 'item' && (i as Extract<MenuItemSpec, { kind: 'item' }>).id === 'trash'
    ) as Extract<MenuItemSpec, { kind: 'item' }> | undefined
    expect(trash?.label).toBe('Move file to Trash')
  })

  it('includes View versions item with id "versions" for a file', async () => {
    showContextMenuMock.mockResolvedValue(null)
    await renderApp()
    await act(async () => {
      await capturedOnContextMenu!(fakeRightClick(), fakeFile)
    })
    const [items] = showContextMenuMock.mock.calls[0] as [MenuItemSpec[]]
    const versions = items.find(
      (i) => i.kind === 'item' && (i as Extract<MenuItemSpec, { kind: 'item' }>).id === 'versions'
    ) as Extract<MenuItemSpec, { kind: 'item' }> | undefined
    expect(versions?.label).toBe('View versions…')
  })

  it('does NOT include new-note or new-folder items for a file', async () => {
    showContextMenuMock.mockResolvedValue(null)
    await renderApp()
    await act(async () => {
      await capturedOnContextMenu!(fakeRightClick(), fakeFile)
    })
    const [items] = showContextMenuMock.mock.calls[0] as [MenuItemSpec[]]
    const ids = items
      .filter((i) => i.kind === 'item')
      .map((i) => (i as Extract<MenuItemSpec, { kind: 'item' }>).id)
    expect(ids).not.toContain('new-note')
    expect(ids).not.toContain('new-folder')
  })
})

// ---------------------------------------------------------------------------
// IPC payload — directory node
// ---------------------------------------------------------------------------

describe('File Tree — directory node context menu IPC payload', () => {
  it('includes New note here with id "new-note" for a directory', async () => {
    showContextMenuMock.mockResolvedValue(null)
    await renderApp()
    await act(async () => {
      await capturedOnContextMenu!(fakeRightClick(), fakeDir)
    })
    const [items] = showContextMenuMock.mock.calls[0] as [MenuItemSpec[]]
    const item = items.find(
      (i) => i.kind === 'item' && (i as Extract<MenuItemSpec, { kind: 'item' }>).id === 'new-note'
    ) as Extract<MenuItemSpec, { kind: 'item' }> | undefined
    expect(item?.label).toBe('New note here')
  })

  it('includes New folder here with id "new-folder" for a directory', async () => {
    showContextMenuMock.mockResolvedValue(null)
    await renderApp()
    await act(async () => {
      await capturedOnContextMenu!(fakeRightClick(), fakeDir)
    })
    const [items] = showContextMenuMock.mock.calls[0] as [MenuItemSpec[]]
    const item = items.find(
      (i) => i.kind === 'item' && (i as Extract<MenuItemSpec, { kind: 'item' }>).id === 'new-folder'
    ) as Extract<MenuItemSpec, { kind: 'item' }> | undefined
    expect(item?.label).toBe('New folder here')
  })

  it('labels trash item as "Move folder to Trash" for a directory', async () => {
    showContextMenuMock.mockResolvedValue(null)
    await renderApp()
    await act(async () => {
      await capturedOnContextMenu!(fakeRightClick(), fakeDir)
    })
    const [items] = showContextMenuMock.mock.calls[0] as [MenuItemSpec[]]
    const trash = items.find(
      (i) => i.kind === 'item' && (i as Extract<MenuItemSpec, { kind: 'item' }>).id === 'trash'
    ) as Extract<MenuItemSpec, { kind: 'item' }> | undefined
    expect(trash?.label).toBe('Move folder to Trash')
  })

  it('does NOT include versions item for a directory', async () => {
    showContextMenuMock.mockResolvedValue(null)
    await renderApp()
    await act(async () => {
      await capturedOnContextMenu!(fakeRightClick(), fakeDir)
    })
    const [items] = showContextMenuMock.mock.calls[0] as [MenuItemSpec[]]
    const ids = items
      .filter((i) => i.kind === 'item')
      .map((i) => (i as Extract<MenuItemSpec, { kind: 'item' }>).id)
    expect(ids).not.toContain('versions')
  })
})

// ---------------------------------------------------------------------------
// Action dispatch
// ---------------------------------------------------------------------------

describe('File Tree — action dispatch from context menu', () => {
  it('calls shell.reveal with file path when "reveal" action is returned for a file', async () => {
    showContextMenuMock.mockResolvedValue('reveal')
    await renderApp()
    await act(async () => {
      await capturedOnContextMenu!(fakeRightClick(), fakeFile)
    })
    expect(shellRevealMock).toHaveBeenCalledWith(fakeFile.path)
  })

  it('calls shell.reveal with dir path when "reveal" action is returned for a directory', async () => {
    showContextMenuMock.mockResolvedValue('reveal')
    await renderApp()
    await act(async () => {
      await capturedOnContextMenu!(fakeRightClick(), fakeDir)
    })
    expect(shellRevealMock).toHaveBeenCalledWith(fakeDir.path)
  })

  it('does nothing when showContextMenu resolves null', async () => {
    showContextMenuMock.mockResolvedValue(null)
    await renderApp()
    await act(async () => {
      await capturedOnContextMenu!(fakeRightClick(), fakeFile)
    })
    expect(shellRevealMock).not.toHaveBeenCalled()
    expect(trashMock).not.toHaveBeenCalled()
  })
})
