// @vitest-environment jsdom
//
// Regression coverage for issue #560's in-tab-navigation fix (commits
// 9db52b3, 94b6f71): the version-gated Editor reset effect
// (Editor.tsx:502-514, see Editor-reset-effect.spec.tsx) only reseeds
// `value` when `version` bumps. navigateInActiveTab, goBack, goForward, and
// navigateOrOpen (replaceCurrent branch) all swap the active tab's
// path+content in place (same tab id, same mounted Editor instance) — so
// each of them MUST bump `version`, or the Editor would keep showing the
// previous note's content after an in-tab navigation.
//
// Strategy: same App-stub harness as App-rename-buffer.spec.tsx. FileTree
// stub opens note A; Editor stub captures props (path/version/initialContent)
// so tests can read them after driving the four navigation entry points:
//   - onNavigate(path, true)  -> navigateOrOpen replace-current branch
//   - onBack() / onForward()  -> goBack / goForward (wired directly as props)
//   - CommandPalette onPick(item, true) -> navigateInActiveTab (item.isMarkdown)

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import React from 'react'

// ---------------------------------------------------------------------------
// Hoisted capture refs
// ---------------------------------------------------------------------------

const { lastEditorProps, menuActionCb, commandPaletteCapture } = vi.hoisted(() => {
  const lastEditorProps: { current: Record<string, unknown> | null } = { current: null }
  const menuActionCb: { fire: ((action: string) => void) | null } = { fire: null }
  const commandPaletteCapture: {
    onPick: ((item: { path: string; isMarkdown: boolean }, replaceCurrent: boolean) => void) | null
  } = { onPick: null }
  return { lastEditorProps, menuActionCb, commandPaletteCapture }
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
  }) => (
    <div>
      <button
        data-testid="open-note-a"
        onClick={() => props.onSelect?.({ path: '/vault/note-a.md', isDir: false }, {})}
      >
        open A
      </button>
    </div>
  ),
}))

// Captures onPick so tests can simulate picking note B with replaceCurrent —
// the command-palette path to navigateInActiveTab.
vi.mock('../CommandPalette', () => ({
  CommandPalette: (props: {
    onPick: (item: { path: string; isMarkdown: boolean }, replaceCurrent: boolean) => void
  }) => {
    commandPaletteCapture.onPick = props.onPick
    return (
      <button
        data-testid="palette-pick-note-b"
        onClick={() => props.onPick({ path: '/vault/note-b.md', isMarkdown: true }, true)}
      >
        pick note B (replace current)
      </button>
    )
  },
}))

vi.mock('../AgentsPane', () => ({ AgentsPane: () => null }))
vi.mock('../FileTreeToolbar', () => ({ FileTreeToolbar: () => null }))
vi.mock('../Splitter', () => ({
  Splitter: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))
vi.mock('../InputDialog', () => ({ InputDialog: () => null }))
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

function setupMarvin() {
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
        // Distinct content per path so tests can tell A and B apart after a
        // navigation swaps `path`+`content` in place.
        read: vi.fn(async (path: string) => (path.includes('note-a') ? 'content A' : 'content B')),
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

function fireMenu(action: string) {
  act(() => {
    menuActionCb.fire?.(action)
  })
}

async function navigateOrOpenReplaceCurrent(path: string) {
  const onNavigate = lastEditorProps.current?.onNavigate as
    | ((p: string, replaceCurrent: boolean) => Promise<void>)
    | undefined
  await act(async () => {
    await onNavigate?.(path, true)
  })
}

async function goBack() {
  const onBack = lastEditorProps.current?.onBack as (() => Promise<void>) | undefined
  await act(async () => {
    await onBack?.()
  })
}

async function goForward() {
  const onForward = lastEditorProps.current?.onForward as (() => Promise<void>) | undefined
  await act(async () => {
    await onForward?.()
  })
}

beforeEach(() => {
  setupMarvin()
  lastEditorProps.current = null
  menuActionCb.fire = null
  commandPaletteCapture.onPick = null
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// Regression: in-tab navigation must bump version (issue #560)
// ---------------------------------------------------------------------------

describe('In-tab navigation must bump version so the Editor reset effect reseeds (issue #560)', () => {
  it('navigateOrOpen replace-current (wikilink click) swaps path/content and bumps version', async () => {
    await renderBootstrapped()
    await openNote('open-note-a')

    expect(lastEditorProps.current?.filePath).toBe('/vault/note-a.md')
    expect(lastEditorProps.current?.version).toBe(0)

    await navigateOrOpenReplaceCurrent('/vault/note-b.md')

    expect(lastEditorProps.current?.filePath).toBe('/vault/note-b.md')
    expect(lastEditorProps.current?.initialContent).toBe('content B')
    expect(lastEditorProps.current?.version).toBe(1)
  })

  it('goBack / goForward swap path/content and bump version on each step', async () => {
    await renderBootstrapped()
    await openNote('open-note-a')
    await navigateOrOpenReplaceCurrent('/vault/note-b.md')
    expect(lastEditorProps.current?.version).toBe(1)

    await goBack()
    expect(lastEditorProps.current?.filePath).toBe('/vault/note-a.md')
    expect(lastEditorProps.current?.initialContent).toBe('content A')
    expect(lastEditorProps.current?.version).toBe(2)

    await goForward()
    expect(lastEditorProps.current?.filePath).toBe('/vault/note-b.md')
    expect(lastEditorProps.current?.initialContent).toBe('content B')
    expect(lastEditorProps.current?.version).toBe(3)
  })

  it('command-palette pick with replaceCurrent (navigateInActiveTab) bumps version', async () => {
    await renderBootstrapped()
    await openNote('open-note-a')

    fireMenu('command-palette')
    await act(async () => {})

    await act(async () => {
      fireEvent.click(screen.getByTestId('palette-pick-note-b'))
    })
    await act(async () => {})

    expect(lastEditorProps.current?.filePath).toBe('/vault/note-b.md')
    expect(lastEditorProps.current?.initialContent).toBe('content B')
    expect(lastEditorProps.current?.version).toBe(1)
  })
})
