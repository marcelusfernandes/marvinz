// @vitest-environment jsdom
//
// Regression coverage for issue #560 (rename/move path) — renaming or
// moving the active note (F2, drag-move, paste-move) must not revert the
// live editor buffer to the tab-open-time disk snapshot. `renameInTabs`
// (src/App.tsx:1553-1591) remaps `lastDiskContentRef`/`bufferContentRef` keys
// on rename but, pre-fix, never advances `NoteTab.content` — so the
// `initialContent` prop handed to a (still-mounted) `Editor` stays at the
// stale open-time value even though only the path changed.
//
// Strategy: same App-stub harness as App-saveBuffer.spec.tsx. FileTree stub
// adds a context-menu trigger (routes to `handleNodeContextMenu` ->
// window.marvin.app.showContextMenu, mocked to resolve 'rename'), and
// InputDialog is stubbed to auto-submit a new basename, driving the same
// `handleCreate` -> `window.marvin.path.rename` -> `renameInTabs` path a real
// F2 rename takes.
//
// Coverage boundary: Editor is stubbed here, so this only observes
// `initialContent` (= NoteTab.content) — it locks in the `renameInTabs`
// setTabs-advancement fix. It does NOT exercise Editor.tsx:502-508's reset
// effect (the actual in-place clobber on a live-mounted instance) or verify
// that a post-rename autosave never writes reverted content back to disk;
// that needs a real (non-stubbed) Editor and is out of scope here.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import React from 'react'

// ---------------------------------------------------------------------------
// Hoisted capture refs
// ---------------------------------------------------------------------------

const { lastEditorProps } = vi.hoisted(() => {
  const lastEditorProps: { current: Record<string, unknown> | null } = { current: null }
  return { lastEditorProps }
})

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../TabBar', () => ({
  TabBar: () => <div data-testid="tab-bar" />,
}))

vi.mock('../Editor', () => ({
  Editor: (props: Record<string, unknown>) => {
    lastEditorProps.current = props
    return <div data-testid="editor-stub" />
  },
}))

vi.mock('../FileTree', () => ({
  FileTree: (props: {
    onSelect?: (node: { path: string; isDir: boolean }, mods: Record<string, boolean>) => void
    onContextMenu?: (
      e: React.MouseEvent,
      node: { name: string; path: string; isDir: boolean }
    ) => void
  }) => (
    <div>
      <button
        data-testid="open-note-a"
        onClick={() => props.onSelect?.({ path: '/vault/note-a.md', isDir: false }, {})}
      >
        open A
      </button>
      <button
        data-testid="context-menu-note-a"
        onClick={(e) =>
          props.onContextMenu?.(e as unknown as React.MouseEvent, {
            name: 'note-a.md',
            path: '/vault/note-a.md',
            isDir: false,
          })
        }
      >
        context menu A
      </button>
    </div>
  ),
}))

vi.mock('../InputDialog', () => ({
  // Auto-submits a fixed new basename so tests can drive the rename flow
  // without simulating text input into a native dialog.
  InputDialog: (props: { onSubmit: (value: string) => void }) => (
    <button data-testid="submit-rename" onClick={() => props.onSubmit('note-a-renamed.md')}>
      submit rename
    </button>
  ),
}))

vi.mock('../AgentsPane', () => ({ AgentsPane: () => null }))
vi.mock('../FileTreeToolbar', () => ({ FileTreeToolbar: () => null }))
vi.mock('../Splitter', () => ({
  Splitter: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))
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
vi.mock('../Icon', () => ({ Icon: () => null }))
vi.mock('../MaterialIcon', () => ({ MaterialIcon: () => null }))
vi.mock('../../lib/fileIcons', () => ({ fileIconFor: () => 'file' }))
vi.mock('../../lib/settingsStore', () => ({
  seedFromMain: vi.fn(),
  useSetting: () => undefined,
}))
vi.mock('../../lib/colorTheme', () => ({
  useColorTheme: vi.fn(),
  useAgentsPaneTransparent: vi.fn(),
  useEditorEffects: vi.fn(),
}))
vi.mock('../../lib/visualStyle', () => ({ useVisualStyle: () => 'modern' }))
vi.mock('../../lib/paletteRanker', () => ({}))

// ---------------------------------------------------------------------------
// window.marvin mock
// ---------------------------------------------------------------------------

function noop() {}

let pathRenameMock: ReturnType<typeof vi.fn>

function setupMarvin() {
  pathRenameMock = vi.fn().mockResolvedValue(undefined)

  Object.assign(window, {
    marvin: {
      app: {
        showContextMenu: vi.fn().mockResolvedValue('rename'),
        canPaste: vi.fn().mockResolvedValue(false),
        onMenuAction: vi.fn(() => noop),
        setMenuNoteContext: vi.fn(),
        confirmUnsavedChanges: vi.fn().mockResolvedValue('discard'),
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
        read: vi.fn().mockResolvedValue('original content'),
        write: vi.fn().mockResolvedValue(undefined),
        create: vi.fn().mockResolvedValue('/vault/new.md'),
        writeBinary: vi.fn().mockResolvedValue(''),
        onChanged: vi.fn().mockReturnValue(noop),
        exportPdf: vi.fn().mockResolvedValue(undefined),
      },
      folder: { create: vi.fn().mockResolvedValue(undefined) },
      path: {
        rename: pathRenameMock,
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
// Helpers
// ---------------------------------------------------------------------------

async function renderBootstrapped() {
  render(<App />)
  await act(async () => {})
}

async function openNote(testId: string) {
  await act(async () => {
    fireEvent.click(screen.getByTestId(testId))
  })
  await act(async () => {})
}

function typeInEditor(content: string) {
  const onBufferChange = lastEditorProps.current?.onBufferChange as
    | ((c: string) => void)
    | undefined
  act(() => {
    onBufferChange?.(content)
  })
}

async function renameActiveNote() {
  await act(async () => {
    fireEvent.click(screen.getByTestId('context-menu-note-a'))
  })
  await act(async () => {})
  await act(async () => {
    fireEvent.click(screen.getByTestId('submit-rename'))
  })
  await act(async () => {})
}

beforeEach(() => {
  setupMarvin()
  lastEditorProps.current = null
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// Regression: stale-content revert on rename/move (issue #560)
// ---------------------------------------------------------------------------

describe('Renaming the active note must not revert the live buffer (issue #560)', () => {
  it('renameInTabs carries the live buffer into NoteTab.content so the path change does not clobber it', async () => {
    await renderBootstrapped()
    await openNote('open-note-a')
    typeInEditor('edited content that must survive the rename')

    await renameActiveNote()

    expect(pathRenameMock).toHaveBeenCalledWith('/vault/note-a.md', '/vault/note-a-renamed.md')
    // Path is now the renamed one, and the Editor's `initialContent` (fed
    // from NoteTab.content) must reflect the live buffer, not the
    // tab-open-time disk snapshot ('original content', per the file.read
    // mock) that renameInTabs never advances pre-fix.
    expect(lastEditorProps.current?.filePath).toBe('/vault/note-a-renamed.md')
    expect(lastEditorProps.current?.initialContent).toBe(
      'edited content that must survive the rename'
    )
  })
})
