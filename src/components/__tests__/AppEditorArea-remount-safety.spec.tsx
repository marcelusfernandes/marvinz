// @vitest-environment jsdom
//
// Issue #585 (AppEditorArea region-component extraction) — belt-and-suspenders
// on top of editor-undo-tab-switch.spec.tsx's #440 regression coverage.
//
// That file proves the editor stack survives a TAB SWITCH (activeTabId
// changes) without remounting. This file proves the weaker, more common case
// explicitly: an UNRELATED App re-render — one that changes some other piece
// of App state (sidebarHidden, via the "Hide sidebar" toggle) while
// tabs/activeTabId stay untouched — must not remount the editor stack either.
// A tab switch is a strictly stronger perturbation (it changes the very props
// AppEditorArea keys its stack on), so surviving it implies surviving this;
// this test exists so a future regression in AppEditorArea's own rendering
// (e.g. an accidental new wrapper, a key derived from something that
// shouldn't affect it) is caught directly rather than inferred.
//
// Same technique as editor-undo-tab-switch.spec.tsx: an Editor stub logs
// mount/unmount via a useEffect cleanup; a remount shows up as an extra
// mount/unmount pair for the same filePath, and the DOM node identity changes.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import React from 'react'

// ---------------------------------------------------------------------------
// Hoisted capture refs
// ---------------------------------------------------------------------------

const { editorLifecycle } = vi.hoisted(() => {
  const editorLifecycle: { filePath: string; event: 'mount' | 'unmount' }[] = []
  return { editorLifecycle }
})

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../TabBar', () => ({
  TabBar: (props: { tabs: { id: string }[]; activeId: string | null }) => (
    <div data-testid="tab-bar" data-active={props.activeId ?? ''} />
  ),
}))

// Editor stub: records mount/unmount events so tests can count remounts.
vi.mock('../Editor', () => ({
  Editor: (props: Record<string, unknown>) => {
    const filePath = props.filePath as string

    React.useEffect(() => {
      editorLifecycle.push({ filePath, event: 'mount' })
      return () => {
        editorLifecycle.push({ filePath, event: 'unmount' })
      }
    }, [filePath])

    return <div data-testid="editor-stub" data-filepath={filePath} />
  },
}))

vi.mock('../FileTree', () => ({
  FileTree: (props: {
    onSelect?: (node: { path: string; isDir: boolean }, mods: Record<string, boolean>) => void
  }) => (
    <button
      data-testid="open-note-a"
      onClick={() => props.onSelect?.({ path: '/vault/note-a.md', isDir: false }, {})}
    >
      open A
    </button>
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
        read: vi.fn().mockResolvedValue('initial content'),
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
// App import — AFTER all mocks
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

function mountCountForPath(filePath: string): number {
  let count = 0
  let isMounted = false
  for (const entry of editorLifecycle) {
    if (entry.filePath !== filePath) continue
    if (entry.event === 'mount') {
      if (!isMounted) {
        count++
        isMounted = true
      }
    } else {
      isMounted = false
    }
  }
  return count
}

beforeEach(() => {
  setupMarvin()
  editorLifecycle.length = 0
  // sidebarHidden's initial useState reads localStorage, which persists
  // across spec files within the same jsdom worker — clear it so the
  // "Hide sidebar" toggle starts from a deterministic (visible) state.
  window.localStorage.removeItem('marvin:sidebarHidden')
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// Suite: AppEditorArea must NOT remount the editor stack on an unrelated
// App re-render (#585)
// ---------------------------------------------------------------------------

describe('AppEditorArea (#585) — unrelated App re-render must not remount the editor stack', () => {
  it('toggling the sidebar (no tab-state change) mounts the active editor exactly once', async () => {
    await renderBootstrapped()
    await openNote('open-note-a')

    const editorNodeBefore = screen.queryByTestId('editor-stub')
    expect(editorNodeBefore).not.toBeNull()
    expect(mountCountForPath('/vault/note-a.md')).toBe(1)

    // Unrelated re-render: hides the sidebar. tabs/activeTabId are untouched.
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Hide sidebar'))
    })

    expect(mountCountForPath('/vault/note-a.md')).toBe(1)
    // Same DOM node, not a same-testid replacement — proves no remount, not
    // just a coincidentally-matching re-mount.
    expect(screen.queryByTestId('editor-stub')).toBe(editorNodeBefore)
    expect(document.body.contains(editorNodeBefore)).toBe(true)
  })

  it('toggling the sidebar twice (hide, then show) still mounts the active editor exactly once', async () => {
    await renderBootstrapped()
    await openNote('open-note-a')
    const editorNodeBefore = screen.queryByTestId('editor-stub')

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Hide sidebar'))
    })
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Show sidebar'))
    })

    expect(mountCountForPath('/vault/note-a.md')).toBe(1)
    expect(screen.queryByTestId('editor-stub')).toBe(editorNodeBefore)
  })
})
