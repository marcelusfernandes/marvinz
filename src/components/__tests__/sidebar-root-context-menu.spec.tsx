/**
 * Tests for the sidebar root native context menu (issue #177).
 *
 * Strategy:
 *  - Render App (same approach as file-tree-context-menu.spec.tsx).
 *  - Fire contextmenu on the sidebar element (empty space) and assert
 *    window.marvin.app.showContextMenu is called with the correct items.
 *  - Fire contextmenu on a .file-tree-row element and assert IPC is NOT called
 *    (handler bails when the click targets a file tree row).
 *  - Mock each action id response and assert the correct handler fires.
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'

// ---------------------------------------------------------------------------
// Stub heavy components that App imports
// ---------------------------------------------------------------------------

let lastFileTreeProps: Record<string, unknown> = {}
vi.mock('../FileTree', () => ({
  FileTree: (props: Record<string, unknown>) => {
    lastFileTreeProps = props
    return (
      <div data-testid="file-tree">
        <div className="file-tree-row">row</div>
      </div>
    )
  },
}))
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
vi.mock('../../lib/colorTheme', () => ({ useColorTheme: () => 'light', useAgentsPaneTransparent: () => false, useEditorEffects: () => {} }))
vi.mock('../../lib/visualStyle', () => ({ useVisualStyle: () => 'modern' }))
vi.mock('../../lib/paletteRanker', () => ({}))

// ---------------------------------------------------------------------------
// window.marvin mock
// ---------------------------------------------------------------------------

type MenuItemSpec =
  | { kind: 'item'; id: string; label: string; enabled?: boolean }
  | { kind: 'separator' }

let showContextMenuMock: ReturnType<typeof vi.fn>

function noop() {}

function setupMarvinMock() {
  showContextMenuMock = vi.fn().mockResolvedValue(null)

  Object.assign(window, {
    marvin: {
      app: {
        showContextMenu: showContextMenuMock,
        canPaste: vi.fn().mockResolvedValue(false),
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
        create: vi.fn().mockResolvedValue('/vault/new.md'),
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
    },
  })
}

// ---------------------------------------------------------------------------
// Import App after all mocks
// ---------------------------------------------------------------------------

import App from '../../App'

// ---------------------------------------------------------------------------
// Render helpers
// ---------------------------------------------------------------------------

async function renderApp() {
  let result: ReturnType<typeof render>
  await act(async () => {
    result = render(<App />)
    await new Promise((r) => setTimeout(r, 50))
  })
  return result!
}

function getSidebar(container: HTMLElement): HTMLElement {
  const el = container.querySelector('.sidebar')
  if (!el) throw new Error('sidebar not found')
  return el as HTMLElement
}

function getFileTreeRow(container: HTMLElement): HTMLElement {
  const el = container.querySelector('.file-tree-row')
  if (!el) throw new Error('.file-tree-row not found')
  return el as HTMLElement
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  setupMarvinMock()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// IPC payload — empty sidebar area
// ---------------------------------------------------------------------------

describe('Sidebar root — context menu IPC payload', () => {
  it('calls showContextMenu when right-clicking empty sidebar area', async () => {
    const { container } = await renderApp()
    await act(async () => {
      const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
      getSidebar(container).dispatchEvent(e)
      await new Promise((r) => setTimeout(r, 10))
    })
    expect(showContextMenuMock).toHaveBeenCalledTimes(1)
  })

  it('sends array of items as first argument', async () => {
    const { container } = await renderApp()
    await act(async () => {
      getSidebar(container).dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
      )
      await new Promise((r) => setTimeout(r, 10))
    })
    const [items] = showContextMenuMock.mock.calls[0] as [MenuItemSpec[]]
    expect(Array.isArray(items)).toBe(true)
  })

  it('includes new-file item with id "new-file"', async () => {
    const { container } = await renderApp()
    await act(async () => {
      getSidebar(container).dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
      )
      await new Promise((r) => setTimeout(r, 10))
    })
    const [items] = showContextMenuMock.mock.calls[0] as [MenuItemSpec[]]
    const item = items.find(
      (i): i is Extract<MenuItemSpec, { kind: 'item' }> =>
        i.kind === 'item' && i.id === 'new-file',
    )
    expect(item).toBeDefined()
  })

  it('includes new-folder item with id "new-folder"', async () => {
    const { container } = await renderApp()
    await act(async () => {
      getSidebar(container).dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
      )
      await new Promise((r) => setTimeout(r, 10))
    })
    const [items] = showContextMenuMock.mock.calls[0] as [MenuItemSpec[]]
    const item = items.find(
      (i): i is Extract<MenuItemSpec, { kind: 'item' }> =>
        i.kind === 'item' && i.id === 'new-folder',
    )
    expect(item).toBeDefined()
  })

  it('includes refresh item with id "refresh"', async () => {
    const { container } = await renderApp()
    await act(async () => {
      getSidebar(container).dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
      )
      await new Promise((r) => setTimeout(r, 10))
    })
    const [items] = showContextMenuMock.mock.calls[0] as [MenuItemSpec[]]
    const item = items.find(
      (i): i is Extract<MenuItemSpec, { kind: 'item' }> =>
        i.kind === 'item' && i.id === 'refresh',
    )
    expect(item).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// File tree row — handler bails, IPC NOT called
// ---------------------------------------------------------------------------

describe('Sidebar root — bails on file tree row clicks', () => {
  it('does NOT call showContextMenu when right-clicking a file-tree-row', async () => {
    const { container } = await renderApp()
    await act(async () => {
      const row = getFileTreeRow(container)
      row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
      await new Promise((r) => setTimeout(r, 10))
    })
    expect(showContextMenuMock).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Action dispatch — new-file
// ---------------------------------------------------------------------------

describe('Sidebar root — new-file action', () => {
  it('starts inline file create at vault root when "new-file" action is returned', async () => {
    showContextMenuMock.mockResolvedValue('new-file')
    const { container } = await renderApp()
    await act(async () => {
      getSidebar(container).dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
      )
      await new Promise((r) => setTimeout(r, 50))
    })
    expect(lastFileTreeProps.creatingIn).toEqual({ parentDir: '/vault', kind: 'file' })
  })
})

// ---------------------------------------------------------------------------
// Action dispatch — new-folder
// ---------------------------------------------------------------------------

describe('Sidebar root — new-folder action', () => {
  it('starts inline folder create at vault root when "new-folder" action is returned', async () => {
    showContextMenuMock.mockResolvedValue('new-folder')
    const { container } = await renderApp()
    await act(async () => {
      getSidebar(container).dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
      )
      await new Promise((r) => setTimeout(r, 50))
    })
    expect(lastFileTreeProps.creatingIn).toEqual({ parentDir: '/vault', kind: 'folder' })
  })
})

// ---------------------------------------------------------------------------
// Action dispatch — refresh
// ---------------------------------------------------------------------------

describe('Sidebar root — refresh action', () => {
  it('calls vault.tree again when "refresh" action is returned', async () => {
    showContextMenuMock.mockResolvedValue('refresh')
    const { container } = await renderApp()
    const callsBefore = (window.marvin.vault.tree as ReturnType<typeof vi.fn>).mock.calls.length
    await act(async () => {
      getSidebar(container).dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
      )
      await new Promise((r) => setTimeout(r, 50))
    })
    const callsAfter = (window.marvin.vault.tree as ReturnType<typeof vi.fn>).mock.calls.length
    expect(callsAfter).toBeGreaterThan(callsBefore)
  })
})

// ---------------------------------------------------------------------------
// Null action — no side effects
// ---------------------------------------------------------------------------

describe('Sidebar root — dismissed menu (null action)', () => {
  it('does not open any dialog when menu is dismissed', async () => {
    showContextMenuMock.mockResolvedValue(null)
    const { container } = await renderApp()
    await act(async () => {
      getSidebar(container).dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
      )
      await new Promise((r) => setTimeout(r, 30))
    })
    expect(container.querySelector('[data-testid="input-dialog"]')).not.toBeInTheDocument()
  })
})
