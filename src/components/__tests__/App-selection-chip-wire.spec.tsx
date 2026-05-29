// @vitest-environment jsdom
//
// Integration tests for issue #379 — App.tsx wires onSendSelection + agentKind
// from focused AgentsPane tab down to Editor (and by extension LiveMarkdown).
//
// Strategy: mock Editor + AgentsPane as stubs that capture their props so we
// can verify what App.tsx hands them. FileTree is mocked to expose a trigger
// that opens a note tab so Editor renders. This spec is about the wire-up;
// the chip UI itself is covered by Editor-selection-chip.spec.tsx and
// LiveMarkdown-selection-chip.spec.tsx.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import React from 'react'

// ---------------------------------------------------------------------------
// Hoisted capture refs — must be stable across vi.mock factory scope
// ---------------------------------------------------------------------------

const { lastEditorProps, agentsPaneOnFocusChange, fileTreeOnSelect } = vi.hoisted(() => {
  const lastEditorProps: {
    current: Record<string, unknown> | null
  } = { current: null }

  const agentsPaneOnFocusChange: {
    fire: ((info: { ptyId: string; agentKind: string } | null) => void) | null
  } = { fire: null }

  const fileTreeOnSelect: {
    fn: ((node: { path: string; isDir: boolean }, mods: Record<string, boolean>) => void) | null
  } = { fn: null }

  return { lastEditorProps, agentsPaneOnFocusChange, fileTreeOnSelect }
})

// ---------------------------------------------------------------------------
// Mock heavy UI components — irrelevant to wire-up contract
// ---------------------------------------------------------------------------

vi.mock('../Editor', () => ({
  Editor: (props: Record<string, unknown>) => {
    lastEditorProps.current = props
    return <div data-testid="editor-stub" />
  },
}))

vi.mock('../AgentsPane', () => ({
  AgentsPane: (props: { onFocusChange?: (info: { ptyId: string; agentKind: string } | null) => void }) => {
    agentsPaneOnFocusChange.fire = props.onFocusChange ?? null
    return <div data-testid="agents-pane-stub" />
  },
}))

// FileTree stub renders a button to open a test note via onSelect.
vi.mock('../FileTree', () => ({
  FileTree: (props: { onSelect?: (node: { path: string; isDir: boolean }, mods: Record<string, boolean>) => void }) => {
    fileTreeOnSelect.fn = props.onSelect ?? null
    return (
      <button
        data-testid="open-note-btn"
        onClick={() => props.onSelect?.({ path: '/vault/note.md', isDir: false }, {})}
      >
        open note
      </button>
    )
  },
}))

vi.mock('../FileTreeToolbar', () => ({ FileTreeToolbar: () => null }))
vi.mock('../Splitter', () => ({
  Splitter: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))
vi.mock('../InputDialog', () => ({ InputDialog: () => null }))
vi.mock('../CommandPalette', () => ({ CommandPalette: () => null }))
vi.mock('../SettingsModal', () => ({ SettingsModal: () => null }))
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
vi.mock('../../lib/colorTheme', () => ({ useColorTheme: vi.fn(), useAgentsPaneTransparent: vi.fn(), useEditorEffects: vi.fn() }))
vi.mock('../../lib/visualStyle', () => ({ useVisualStyle: () => 'modern' }))
vi.mock('../../lib/paletteRanker', () => ({}))

// ---------------------------------------------------------------------------
// window.marvin mock
// ---------------------------------------------------------------------------

function noop() {}

function setupMarvinMock() {
  Object.assign(window, {
    marvin: {
      app: {
        showContextMenu: vi.fn().mockResolvedValue(null),
        canPaste: vi.fn().mockResolvedValue(false),
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
      agent: {
        detect: vi.fn().mockResolvedValue('/usr/bin/agent'),
      },
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
  await act(async () => {})
}

// Bootstraps App AND opens a note tab so Editor renders.
async function renderWithNoteTab() {
  render(<App />)
  await act(async () => {})
  await act(async () => {
    fireEvent.click(screen.getByTestId('open-note-btn'))
  })
  // Wait for file.read to settle and Editor to render.
  await act(async () => {})
}

// ===========================================================================
// Contract 1: no agents open → AgentsPane gets the prop, Editor undefined
// ===========================================================================

describe('App selection chip wire — 0 agents: Editor has no onSendSelection', () => {
  beforeEach(() => setupMarvinMock())
  afterEach(() => vi.restoreAllMocks())

  it('AgentsPane receives onFocusChange prop', async () => {
    await renderBootstrapped()
    expect(typeof agentsPaneOnFocusChange.fire).toBe('function')
  })

  it('Editor receives onSendSelection=undefined when no agent is focused', async () => {
    await renderWithNoteTab()
    expect(lastEditorProps.current?.onSendSelection).toBeUndefined()
  })
})

// ===========================================================================
// Contract 2: 1 codex agent focused → Editor gets onSendSelection + agentKind='codex'
// ===========================================================================

describe('App selection chip wire — 1 codex agent focused', () => {
  beforeEach(() => setupMarvinMock())
  afterEach(() => vi.restoreAllMocks())

  it('Editor receives onSendSelection (function) when codex agent is focused', async () => {
    await renderWithNoteTab()

    await act(async () => {
      agentsPaneOnFocusChange.fire?.({ ptyId: 'codex-1', agentKind: 'codex' })
    })

    expect(typeof lastEditorProps.current?.onSendSelection).toBe('function')
  })

  it("Editor receives agentKind='codex' when codex agent is focused", async () => {
    await renderWithNoteTab()

    await act(async () => {
      agentsPaneOnFocusChange.fire?.({ ptyId: 'codex-1', agentKind: 'codex' })
    })

    expect(lastEditorProps.current?.agentKind).toBe('codex')
  })
})

// ===========================================================================
// Contract 3: 1 claude agent focused → Editor gets agentKind='claude-code'
// ===========================================================================

describe('App selection chip wire — 1 claude agent focused', () => {
  beforeEach(() => setupMarvinMock())
  afterEach(() => vi.restoreAllMocks())

  it("Editor receives agentKind='claude-code' when claude agent is focused", async () => {
    await renderWithNoteTab()

    await act(async () => {
      agentsPaneOnFocusChange.fire?.({ ptyId: 'claude-1', agentKind: 'claude-code' })
    })

    expect(lastEditorProps.current?.agentKind).toBe('claude-code')
  })

  it('Editor receives onSendSelection (function) when claude agent is focused', async () => {
    await renderWithNoteTab()

    await act(async () => {
      agentsPaneOnFocusChange.fire?.({ ptyId: 'claude-1', agentKind: 'claude-code' })
    })

    expect(typeof lastEditorProps.current?.onSendSelection).toBe('function')
  })
})

// ===========================================================================
// Contract 4: click simulation — onSendSelection calls pty.write with correct ptyId
// ===========================================================================

describe('App selection chip wire — onSendSelection routes text to focused pty', () => {
  beforeEach(() => setupMarvinMock())
  afterEach(() => vi.restoreAllMocks())

  it('calls pty.write with focused ptyId and formatted text when invoked', async () => {
    await renderWithNoteTab()

    await act(async () => {
      agentsPaneOnFocusChange.fire?.({ ptyId: 'codex-42', agentKind: 'codex' })
    })

    const sendSelection = lastEditorProps.current?.onSendSelection as
      | ((text: string) => void)
      | undefined
    expect(typeof sendSelection).toBe('function')

    await act(async () => {
      sendSelection?.('some selected text')
    })

    expect(window.marvin.pty.write).toHaveBeenCalledWith('codex-42', 'some selected text')
  })

  it('does not call pty.write when no agent is focused', async () => {
    await renderWithNoteTab()
    const sendSelection = lastEditorProps.current?.onSendSelection
    expect(sendSelection).toBeUndefined()
    expect(window.marvin.pty.write).not.toHaveBeenCalled()
  })
})

// ===========================================================================
// Contract 5: focus switch — callback updates to new ptyId
// ===========================================================================

describe('App selection chip wire — focus switch updates ptyId routing', () => {
  beforeEach(() => setupMarvinMock())
  afterEach(() => vi.restoreAllMocks())

  it('routes to new ptyId after focus switches to a different agent tab', async () => {
    await renderWithNoteTab()

    await act(async () => {
      agentsPaneOnFocusChange.fire?.({ ptyId: 'codex-1', agentKind: 'codex' })
    })

    await act(async () => {
      agentsPaneOnFocusChange.fire?.({ ptyId: 'codex-2', agentKind: 'codex' })
    })

    const sendSelection = lastEditorProps.current?.onSendSelection as
      | ((text: string) => void)
      | undefined

    await act(async () => {
      sendSelection?.('hello')
    })

    expect(window.marvin.pty.write).toHaveBeenCalledWith('codex-2', 'hello')
    expect(window.marvin.pty.write).not.toHaveBeenCalledWith('codex-1', 'hello')
  })

  it('onSendSelection becomes undefined when focus is cleared (no active tab)', async () => {
    await renderWithNoteTab()

    await act(async () => {
      agentsPaneOnFocusChange.fire?.({ ptyId: 'codex-1', agentKind: 'codex' })
    })
    expect(typeof lastEditorProps.current?.onSendSelection).toBe('function')

    await act(async () => {
      agentsPaneOnFocusChange.fire?.(null)
    })

    expect(lastEditorProps.current?.onSendSelection).toBeUndefined()
  })
})
