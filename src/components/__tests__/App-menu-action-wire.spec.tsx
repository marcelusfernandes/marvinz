// @vitest-environment jsdom
//
// Integration tests for issue #400 — App.tsx wires the native app menu
// (window.marvin.app.onMenuAction) to the same handlers the keyboard
// shortcuts use. The main-process menu template + IPC plumbing is covered by
// electron/__tests__; this spec is about the renderer-side dispatch: each
// action string is captured from onMenuAction and we assert the resulting
// renderer effect (modal opens, creatingIn set, IPC call, etc.).
//
// Strategy mirrors App-selection-chip-wire.spec.tsx: mock heavy UI as stubs
// that capture props, expose the onMenuAction callback via a hoisted ref, then
// fire actions and assert.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import React from 'react'

// ---------------------------------------------------------------------------
// Hoisted capture refs
// ---------------------------------------------------------------------------

const { menuActionCb, lastEditorProps, lastFileTreeProps, lastAgentsPaneProps, flushSaveSpy } =
  vi.hoisted(() => {
    const menuActionCb: { fire: ((action: string) => void) | null } = { fire: null }
    const lastEditorProps: { current: Record<string, unknown> | null } = { current: null }
    const lastFileTreeProps: { current: Record<string, unknown> | null } = { current: null }
    const lastAgentsPaneProps: { current: Record<string, unknown> | null } = { current: null }
    const flushSaveSpy = vi.fn().mockResolvedValue(undefined)
    return { menuActionCb, lastEditorProps, lastFileTreeProps, lastAgentsPaneProps, flushSaveSpy }
  })

// ---------------------------------------------------------------------------
// Mock heavy UI — capture the props we assert on, stub the rest
// ---------------------------------------------------------------------------

vi.mock('../Editor', () => ({
  Editor: (props: Record<string, unknown>) => {
    lastEditorProps.current = props
    // Mirror the real Editor: register a flush fn so App's flushSaveRef points
    // at it. Lets the 'save' action assert the flush is actually invoked.
    const onFlushSave = props.onFlushSave as ((fn: () => Promise<void>) => void) | undefined
    onFlushSave?.(flushSaveSpy)
    return <div data-testid="editor-stub" />
  },
}))

// FileTree exposes a button to open a test note (so Editor renders) and
// captures props so we can read creatingIn after a new-note action.
vi.mock('../FileTree', () => ({
  FileTree: (props: Record<string, unknown>) => {
    lastFileTreeProps.current = props
    const onSelect = props.onSelect as
      | ((node: { path: string; isDir: boolean }, mods: Record<string, boolean>) => void)
      | undefined
    return (
      <button
        data-testid="open-note-btn"
        onClick={() => onSelect?.({ path: '/vault/note.md', isDir: false }, {})}
      >
        open note
      </button>
    )
  },
}))

// Modals render a marker only when mounted (App mounts them conditionally on
// paletteOpen / settingsOpen), so presence === open.
vi.mock('../CommandPalette', () => ({
  CommandPalette: () => <div data-testid="command-palette" />,
}))
vi.mock('../SettingsModal', () => ({
  SettingsModal: () => <div data-testid="settings-modal" />,
}))

vi.mock('../AgentsPane', () => ({
  AgentsPane: (props: Record<string, unknown>) => {
    lastAgentsPaneProps.current = props
    return <div data-testid="agents-pane-stub" />
  },
}))
vi.mock('../FileTreeToolbar', () => ({ FileTreeToolbar: () => null }))
vi.mock('../Splitter', () => ({
  Splitter: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))
vi.mock('../InputDialog', () => ({ InputDialog: () => null }))
vi.mock('../TopBar', () => ({ TopBar: () => null }))
vi.mock('../SnapshotPanel', () => ({ SnapshotPanel: () => null }))
vi.mock('../SnapshotToast', () => ({ SnapshotToast: () => null }))
vi.mock('../ImportToast', () => ({ ImportToast: () => null }))
vi.mock('../ExternalChangeBanner', () => ({ ExternalChangeBanner: () => null }))
vi.mock('../BrowserPane', () => ({ BrowserPane: () => null }))
vi.mock('../ImageViewer', () => ({ ImageViewer: () => null }))
vi.mock('../PdfViewer', () => ({ PdfViewer: () => null }))
vi.mock('../DocxViewer', () => ({ DocxViewer: () => null }))
vi.mock('../Icon', () => ({
  Icon: ({ name }: { name: string }) => <span data-testid={`icon-${name}`} />,
}))
vi.mock('../MaterialIcon', () => ({ MaterialIcon: () => null }))
vi.mock('../../lib/fileIcons', () => ({ fileIconFor: () => 'file' }))
vi.mock('../../lib/settingsStore', () => ({
  seedFromMain: vi.fn(),
  useSetting: (key: string) => {
    if (key === 'saveMode') return 'auto'
    return undefined
  },
}))
vi.mock('../../lib/colorTheme', () => ({
  useColorTheme: vi.fn(),
  useAgentsPaneTransparent: vi.fn(),
  useEditorEffects: vi.fn(),
}))
vi.mock('../../lib/visualStyle', () => ({ useVisualStyle: () => 'modern' }))
vi.mock('../../lib/paletteRanker', () => ({}))

// ---------------------------------------------------------------------------
// window.marvin mock — app.onMenuAction captures the renderer callback
// ---------------------------------------------------------------------------

function noop() {}

function setupMarvinMock() {
  Object.assign(window, {
    marvin: {
      app: {
        showContextMenu: vi.fn().mockResolvedValue(null),
        canPaste: vi.fn().mockResolvedValue(false),
        onMenuAction: vi.fn((cb: (action: string) => void) => {
          menuActionCb.fire = cb
          return () => {
            menuActionCb.fire = null
          }
        }),
      },
      shell: { reveal: vi.fn(), openExternal: vi.fn() },
      vault: {
        tree: vi.fn().mockResolvedValue([]),
        watch: vi.fn().mockResolvedValue(undefined),
        onChanged: vi.fn().mockReturnValue(noop),
        pick: vi.fn().mockResolvedValue(null),
        current: vi.fn().mockResolvedValue('/vault'),
      },
      file: {
        pick: vi.fn().mockResolvedValue(null),
        read: vi.fn().mockResolvedValue('# hello'),
        write: vi.fn().mockResolvedValue(undefined),
        create: vi.fn().mockResolvedValue('/vault/new.md'),
        writeBinary: vi.fn().mockResolvedValue(''),
        onChanged: vi.fn().mockReturnValue(noop),
        exportPdf: vi.fn().mockResolvedValue(undefined),
      },
      folder: { create: vi.fn().mockResolvedValue(undefined) },
      path: {
        rename: vi.fn().mockResolvedValue(undefined),
        trash: vi.fn().mockResolvedValue(undefined),
      },
      settings: {
        get: vi.fn().mockResolvedValue({ vaultPath: '/vault' }),
        set: vi.fn().mockResolvedValue({}),
      },
      agent: { detect: vi.fn().mockResolvedValue('/usr/bin/agent') },
      claude: { detect: vi.fn().mockResolvedValue(null) },
      browser: {
        setAllHidden: vi.fn().mockResolvedValue(undefined),
        setActive: vi.fn().mockResolvedValue(undefined),
        navigate: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        onEvent: vi.fn().mockReturnValue(noop),
      },
      snapshot: {
        onTurnCompleted: vi.fn().mockReturnValue(noop),
        listTurns: vi.fn().mockResolvedValue({ ok: true, data: [] }),
        saveBuffer: vi.fn().mockResolvedValue(undefined),
        saveExternalChange: vi.fn().mockResolvedValue(undefined),
      },
      editor: {
        writeClipboard: vi.fn().mockResolvedValue(undefined),
        readClipboard: vi.fn().mockResolvedValue(''),
      },
      fs: {
        importExternal: vi.fn().mockResolvedValue({ imported: [], skipped: [] }),
        getPathForFile: vi.fn((f: File) => f.name),
      },
      search: { content: vi.fn().mockResolvedValue([]) },
      pty: {
        spawn: vi.fn().mockResolvedValue({ pid: 0 }),
        write: vi.fn(),
        resize: vi.fn(),
        kill: vi.fn(),
        onData: vi.fn().mockReturnValue(noop),
        onExit: vi.fn().mockReturnValue(noop),
      },
      office: {
        readDocx: vi.fn().mockResolvedValue({ html: '', messages: [] }),
        writeDocx: vi.fn().mockResolvedValue(undefined),
      },
    },
  })
}

// ---------------------------------------------------------------------------
// App import (after mocks)
// ---------------------------------------------------------------------------

import App from '../../App'

// ---------------------------------------------------------------------------
// Render helpers
// ---------------------------------------------------------------------------

async function renderBootstrapped() {
  render(<App />)
  // settings.get resolves with a vaultPath → vault is active after this tick.
  await act(async () => {})
}

async function renderWithNoteTab() {
  await renderBootstrapped()
  await act(async () => {
    fireEvent.click(screen.getByTestId('open-note-btn'))
  })
  await act(async () => {})
}

// Bootstraps with no persisted vault so vault-gated actions early-return.
async function renderNoVault() {
  ;(window.marvin.settings.get as ReturnType<typeof vi.fn>).mockResolvedValue({})
  render(<App />)
  await act(async () => {})
}

function fireMenu(action: string) {
  act(() => {
    menuActionCb.fire?.(action)
  })
}

// ===========================================================================
// Subscription contract
// ===========================================================================

describe('App menu-action wire — subscription', () => {
  beforeEach(() => setupMarvinMock())
  afterEach(() => vi.restoreAllMocks())

  it('subscribes to onMenuAction on mount', async () => {
    await renderBootstrapped()
    expect(window.marvin.app.onMenuAction).toHaveBeenCalledTimes(1)
    expect(typeof menuActionCb.fire).toBe('function')
  })

  it('unsubscribes on unmount', async () => {
    const { unmount } = render(<App />)
    await act(async () => {})
    expect(typeof menuActionCb.fire).toBe('function')
    act(() => unmount())
    expect(menuActionCb.fire).toBeNull()
  })
})

// ===========================================================================
// State-only actions
// ===========================================================================

describe('App menu-action wire — modals and state', () => {
  beforeEach(() => setupMarvinMock())
  afterEach(() => vi.restoreAllMocks())

  it("'settings' opens the settings modal", async () => {
    await renderBootstrapped()
    expect(screen.queryByTestId('settings-modal')).toBeNull()
    fireMenu('settings')
    expect(screen.getByTestId('settings-modal')).toBeTruthy()
  })

  it("'command-palette' opens the palette when a vault is active", async () => {
    await renderBootstrapped()
    expect(screen.queryByTestId('command-palette')).toBeNull()
    fireMenu('command-palette')
    expect(screen.getByTestId('command-palette')).toBeTruthy()
  })

  it("'new-note' sets creatingIn at the vault root", async () => {
    await renderBootstrapped()
    expect(lastFileTreeProps.current?.creatingIn).toBeNull()
    fireMenu('new-note')
    expect(lastFileTreeProps.current?.creatingIn).toEqual({
      parentDir: '/vault',
      kind: 'file',
    })
  })

  it("'find' bumps openFindTick on the active editor", async () => {
    await renderWithNoteTab()
    const before = lastEditorProps.current?.openFindTick as number
    fireMenu('find')
    expect(lastEditorProps.current?.openFindTick).toBe(before + 1)
  })
})

// ===========================================================================
// IPC-backed actions
// ===========================================================================

describe('App menu-action wire — IPC actions', () => {
  beforeEach(() => setupMarvinMock())
  afterEach(() => vi.restoreAllMocks())

  it("'open-vault' invokes vault.pick", async () => {
    await renderBootstrapped()
    fireMenu('open-vault')
    expect(window.marvin.vault.pick).toHaveBeenCalledTimes(1)
  })

  it("'export-pdf' exports the active note's path", async () => {
    await renderWithNoteTab()
    fireMenu('export-pdf')
    expect(window.marvin.file.exportPdf).toHaveBeenCalledWith('/vault/note.md')
  })

  it("'reveal' reveals the active note's path", async () => {
    await renderWithNoteTab()
    fireMenu('reveal')
    expect(window.marvin.shell.reveal).toHaveBeenCalledWith('/vault/note.md')
  })

  it("'new-agent-terminal' bumps the AgentsPane newTabTick", async () => {
    await renderBootstrapped()
    const before = lastAgentsPaneProps.current?.newTabTick as number
    fireMenu('new-agent-terminal')
    await act(async () => {})
    const after = lastAgentsPaneProps.current?.newTabTick as number
    expect(after).toBe(before + 1)
  })

  it("'save' flushes the active editor when a note tab is active", async () => {
    await renderWithNoteTab()
    flushSaveSpy.mockClear()
    fireMenu('save')
    expect(flushSaveSpy).toHaveBeenCalledTimes(1)
  })
})

// ===========================================================================
// Vault / active-note gating (mirrors the keydown early-returns)
// ===========================================================================

describe('App menu-action wire — gating', () => {
  beforeEach(() => setupMarvinMock())
  afterEach(() => vi.restoreAllMocks())

  it("'export-pdf' is a no-op when no note tab is active", async () => {
    await renderBootstrapped()
    fireMenu('export-pdf')
    expect(window.marvin.file.exportPdf).not.toHaveBeenCalled()
  })

  it("'reveal' is a no-op when no note tab is active", async () => {
    await renderBootstrapped()
    fireMenu('reveal')
    expect(window.marvin.shell.reveal).not.toHaveBeenCalled()
  })

  it("'save' is a no-op when no note tab is active", async () => {
    await renderBootstrapped()
    flushSaveSpy.mockClear()
    fireMenu('save')
    expect(flushSaveSpy).not.toHaveBeenCalled()
  })

  it("'new-agent-terminal' is a no-op when no vault is active", async () => {
    await renderNoVault()
    const before = lastAgentsPaneProps.current?.newTabTick as number | undefined
    fireMenu('new-agent-terminal')
    await act(async () => {})
    const after = lastAgentsPaneProps.current?.newTabTick as number | undefined
    expect(after).toBe(before)
  })
})
