// @vitest-environment jsdom
//
// Characterization tests for issue #578 (extract useTabs hook). Written
// BEFORE the extraction, against the CURRENT App.tsx navigation stack
// (`back`/`forward` arrays on a note tab, App.tsx ~811-1118), to lock in
// observable behavior the refactor must preserve. The M2 milestone's
// App-navigation-* specs cover goBack thoroughly (content/version/buffer
// integrity across a single hop) but never exercise: the no-op guards when
// a stack is empty, multi-level back/forward, or forward-stack invalidation
// on a fresh navigation — all standard browser-history semantics the four
// navigate/back/forward/navigateOrOpen blocks are expected to share once
// consolidated into one `swapActiveNote` helper.
//
// Covers:
//   1. goBack no-ops when the back stack is empty (fresh tab).
//   2. goForward no-ops when the forward stack is empty.
//   3. Multi-level history: A -> B -> C, back x2 reaches A, forward x2
//      reaches C, with canBack/canForward reflecting stack depth throughout.
//   4. Navigating to a NEW page after going back invalidates (clears) the
//      forward stack — classic browser back/forward semantics.
//
// Strategy: same App-stub harness as App-navigation-version-bump.spec.tsx.
// FileTree opens note A; Editor stub captures every prop (including
// canBack/canForward) so tests can assert on navigation-stack depth
// directly, not just the resulting content.

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

vi.mock('../AgentsPane', () => ({ AgentsPane: () => null }))
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
        // Distinct, stable content per path so tests can distinguish A/B/C.
        read: vi.fn(async (path: string) => {
          if (path.includes('note-a')) return 'content A'
          if (path.includes('note-b')) return 'content B'
          if (path.includes('note-c')) return 'content C'
          return 'content D'
        }),
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

async function navigateTo(path: string) {
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

/** Snapshot of the Editor props relevant to navigation-stack assertions. */
function editorSnapshot() {
  const props = lastEditorProps.current ?? {}
  return {
    filePath: props.filePath,
    initialContent: props.initialContent,
    canBack: props.canBack,
    canForward: props.canForward,
  }
}

beforeEach(() => {
  setupMarvin()
  lastEditorProps.current = null
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Navigation stack mechanics characterization (#578) — back/forward guards and multi-level history', () => {
  it('goBack no-ops on a fresh tab (empty back stack)', async () => {
    await renderBootstrapped()
    await openNote('open-note-a')

    expect(lastEditorProps.current?.filePath).toBe('/vault/note-a.md')
    expect(lastEditorProps.current?.canBack).toBe(false)
    const versionBefore = lastEditorProps.current?.version

    await goBack()

    expect(lastEditorProps.current?.filePath).toBe('/vault/note-a.md')
    expect(lastEditorProps.current?.version).toBe(versionBefore)
  })

  it('goForward no-ops when the forward stack is empty', async () => {
    await renderBootstrapped()
    await openNote('open-note-a')
    await navigateTo('/vault/note-b.md')

    expect(lastEditorProps.current?.filePath).toBe('/vault/note-b.md')
    expect(lastEditorProps.current?.canForward).toBe(false)
    const versionBefore = lastEditorProps.current?.version

    await goForward()

    expect(lastEditorProps.current?.filePath).toBe('/vault/note-b.md')
    expect(lastEditorProps.current?.version).toBe(versionBefore)
  })

  it('multi-level history: A -> B -> C, back x2 reaches A, forward x2 reaches C', async () => {
    await renderBootstrapped()
    await openNote('open-note-a')
    await navigateTo('/vault/note-b.md')
    await navigateTo('/vault/note-c.md')

    expect(editorSnapshot()).toMatchObject({
      filePath: '/vault/note-c.md',
      canBack: true,
      canForward: false,
    })

    await goBack()
    expect(editorSnapshot()).toMatchObject({
      filePath: '/vault/note-b.md',
      initialContent: 'content B',
      canBack: true,
      canForward: true,
    })

    await goBack()
    expect(editorSnapshot()).toMatchObject({
      filePath: '/vault/note-a.md',
      initialContent: 'content A',
      canBack: false,
      canForward: true,
    })

    await goForward()
    expect(editorSnapshot()).toMatchObject({
      filePath: '/vault/note-b.md',
      canBack: true,
      canForward: true,
    })

    await goForward()
    expect(editorSnapshot()).toMatchObject({
      filePath: '/vault/note-c.md',
      initialContent: 'content C',
      canBack: true,
      canForward: false,
    })
  })

  it('navigating to a NEW page after going back invalidates (clears) the forward stack', async () => {
    await renderBootstrapped()
    await openNote('open-note-a')
    await navigateTo('/vault/note-b.md')
    await navigateTo('/vault/note-c.md')

    await goBack()
    expect(lastEditorProps.current?.filePath).toBe('/vault/note-b.md')
    expect(lastEditorProps.current?.canForward).toBe(true)

    // Navigate to a page OTHER than the one in the forward stack (C) — this
    // is a fresh navigation, not a "redo," so it must clear `forward`.
    await navigateTo('/vault/note-d.md')
    expect(lastEditorProps.current?.filePath).toBe('/vault/note-d.md')
    expect(lastEditorProps.current?.canForward).toBe(false)

    // goForward must now no-op — C is unreachable, the stack was cleared.
    const versionBefore = lastEditorProps.current?.version
    await goForward()
    expect(lastEditorProps.current?.filePath).toBe('/vault/note-d.md')
    expect(lastEditorProps.current?.version).toBe(versionBefore)
  })
})
