// @vitest-environment jsdom
//
// Task #5 — Verify save/dirty/external-change wiring with multiple editors
// mounted simultaneously (issue #440 hidden-stack fix).
//
// After the fix <App> keeps all recently-opened editors in the DOM (inactive
// ones rendered with `hidden`). This file tests that the wiring between App
// and those multiple Editor instances is correct:
//
//   1. onSave path isolation: each editor's onSave closure writes to its own
//      path. Background editor A's autosave does NOT write to active tab B's
//      path.
//
//   2. closeTab for background dirty tab (single-X): closing a background
//      dirty tab reads the correct buffer/disk refs and writes to the correct
//      path — not the active tab's path. (Extends App-saveBuffer case 4 for
//      the multi-mount scenario.)
//
//   3. dirtyTabId isolation: when the background editor calls onDirtyChange,
//      the dirty dot must follow the tab that is actually dirty — not bleed
//      onto the active (clean) tab.
//      BUG in current implementation: all editors share a single `isDirty`
//      useState(false); TabBar receives `dirtyTabId = isDirty ? activeTabId : null`,
//      so a background dirty editor incorrectly marks the active tab dirty.
//      This test is RED against current code, GREEN after the dirty-per-tab fix.
//
//   4. Close Others with mixed dirty tabs: closing all tabs while A is dirty
//      in the background and B is active calls confirmUnsavedChanges for A
//      (background) and writes A's path — not B's.
//
// Strategy: vi.hoisted + App stub. The Editor stub here exposes per-filePath
// callbacks (onBufferChange, onDirtyChange, onFlushSave) so tests can drive
// state for any specific editor, active or hidden.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import React from 'react'

// ---------------------------------------------------------------------------
// Hoisted capture refs
// ---------------------------------------------------------------------------

const { tabBarCapture, editorRegistry, saveModeOverride } = vi.hoisted(() => {
  // TabBar props captured on each render
  const tabBarCapture: {
    onClose: ((id: string) => void) | null
    onActivate: ((id: string) => void) | null
    tabs: { id: string; path?: string }[]
    activeId: string | null
    dirtyTabId: string | null
  } = { onClose: null, onActivate: null, tabs: [], activeId: null, dirtyTabId: null }

  // Per-filePath registry of the most recent props passed to each Editor stub.
  // Tests use this to drive onBufferChange, onDirtyChange, onFlushSave for
  // specific editors (active or hidden) without coupling to render order.
  const editorRegistry: Map<
    string,
    {
      onBufferChange: ((c: string) => void) | undefined
      onDirtyChange: ((d: boolean) => void) | undefined
      onFlushSave: ((fn: () => Promise<void>) => void) | undefined
      onSave: ((c: string) => void) | undefined
      isActive: boolean
    }
  > = new Map()

  // Tests that need auto mode flip this to 'auto' before render.
  const saveModeOverride: { value: 'auto' | 'manual' } = { value: 'manual' }

  return { tabBarCapture, editorRegistry, saveModeOverride }
})

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../TabBar', () => ({
  TabBar: (props: {
    onClose: (id: string) => void
    onActivate: (id: string) => void
    tabs: { id: string }[]
    activeId: string | null
    dirtyTabId: string | null
    onNewTab: () => void
  }) => {
    tabBarCapture.onClose = props.onClose
    tabBarCapture.onActivate = props.onActivate
    tabBarCapture.tabs = props.tabs
    tabBarCapture.activeId = props.activeId
    tabBarCapture.dirtyTabId = props.dirtyTabId
    return (
      <div data-testid="tab-bar">
        {props.tabs.map((t) => (
          <button key={t.id} data-testid={`close-tab-${t.id}`} onClick={() => props.onClose(t.id)}>
            close {t.id}
          </button>
        ))}
      </div>
    )
  },
}))

vi.mock('../Editor', () => ({
  Editor: (props: Record<string, unknown>) => {
    const filePath = props.filePath as string
    // Register this editor's callbacks so tests can drive them by path.
    editorRegistry.set(filePath, {
      onBufferChange: props.onBufferChange as ((c: string) => void) | undefined,
      onDirtyChange: props.onDirtyChange as ((d: boolean) => void) | undefined,
      onFlushSave: props.onFlushSave as ((fn: () => Promise<void>) => void) | undefined,
      onSave: props.onSave as ((c: string) => void) | undefined,
      isActive: props.isActive as boolean,
    })
    return (
      <div
        data-testid="editor-stub"
        data-filepath={filePath}
        data-is-active={String(props.isActive)}
      />
    )
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
      <button
        data-testid="open-note-b"
        onClick={() => props.onSelect?.({ path: '/vault/note-b.md', isDir: false }, {})}
      >
        open B
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
  useSetting: (key: string) => (key === 'saveMode' ? saveModeOverride.value : undefined),
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

let fileWriteMock: ReturnType<typeof vi.fn>
let confirmUnsavedMock: ReturnType<typeof vi.fn>

function setupMarvin() {
  fileWriteMock = vi.fn().mockResolvedValue(undefined)
  confirmUnsavedMock = vi.fn().mockResolvedValue('save')

  Object.assign(window, {
    marvin: {
      app: {
        showContextMenu: vi.fn().mockResolvedValue(null),
        canPaste: vi.fn().mockResolvedValue(false),
        onMenuAction: vi.fn(() => noop),
        setMenuNoteContext: vi.fn(),
        confirmUnsavedChanges: confirmUnsavedMock,
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
        write: fileWriteMock,
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

/** Drive buffer divergence for a specific editor by path. */
function typeInEditor(filePath: string, content: string) {
  const reg = editorRegistry.get(filePath)
  act(() => {
    reg?.onBufferChange?.(content)
  })
}

/** Drive dirty-change notification for a specific editor by path. */
function setEditorDirty(filePath: string, dirty: boolean) {
  const reg = editorRegistry.get(filePath)
  act(() => {
    reg?.onDirtyChange?.(dirty)
  })
}

function findTabId(pathFragment: string): string {
  const tab = tabBarCapture.tabs.find((t) => (t as { path?: string }).path?.includes(pathFragment))
  if (!tab) throw new Error(`No tab found for path fragment: ${pathFragment}`)
  return tab.id
}

function tabPaths(): (string | undefined)[] {
  return tabBarCapture.tabs.map((t) => (t as { path?: string }).path)
}

afterEach(() => {
  saveModeOverride.value = 'manual'
  editorRegistry.clear()
})

// ---------------------------------------------------------------------------
// 1. onSave path isolation
// ---------------------------------------------------------------------------

describe('multi-editor — onSave path isolation', () => {
  beforeEach(() => {
    saveModeOverride.value = 'auto'
    setupMarvin()
  })
  afterEach(() => vi.restoreAllMocks())

  it("background editor A's onSave writes to A's path, not to B's path", async () => {
    // Open A then B. With hidden-stack both editors are mounted; B is active.
    await renderBootstrapped()
    await openNote('open-note-a')
    await openNote('open-note-b')

    // Both editors should be registered now (hidden-stack keeps A mounted).
    expect(editorRegistry.has('/vault/note-a.md')).toBe(true)
    expect(editorRegistry.has('/vault/note-b.md')).toBe(true)

    // Simulate A's editor triggering its onSave (e.g. autosave debounce fires
    // while A is hidden). The per-tab closure must write to A's path.
    const editorA = editorRegistry.get('/vault/note-a.md')
    await act(async () => {
      await editorA?.onSave?.('content from A')
    })

    // file.write must have been called with A's path.
    expect(fileWriteMock).toHaveBeenCalledWith('/vault/note-a.md', 'content from A')

    // It must NOT have been called with B's path.
    const callsToB = fileWriteMock.mock.calls.filter(([path]) => path === '/vault/note-b.md')
    expect(callsToB).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 2. closeTab for background dirty tab (single-X)
// ---------------------------------------------------------------------------

describe('multi-editor — closeTab background dirty tab', () => {
  beforeEach(() => {
    saveModeOverride.value = 'manual'
    setupMarvin()
  })
  afterEach(() => vi.restoreAllMocks())

  it('closing dirty background tab prompts for it and writes the correct path', async () => {
    confirmUnsavedMock.mockResolvedValue('save')

    await renderBootstrapped()
    // Open A, type (diverge buffer), switch to B.
    await openNote('open-note-a')
    typeInEditor('/vault/note-a.md', 'edited A')
    await openNote('open-note-b')

    // B is now active; A is a background dirty tab.
    expect(tabBarCapture.activeId).toBe(findTabId('note-b'))

    // Close A from the background.
    const tabAId = findTabId('note-a')
    await act(async () => {
      fireEvent.click(screen.getByTestId(`close-tab-${tabAId}`))
    })
    await act(async () => {})

    // Should have prompted for A.
    expect(confirmUnsavedMock).toHaveBeenCalledWith('note-a.md')

    // Should have written A's buffer to A's path.
    expect(fileWriteMock).toHaveBeenCalledWith('/vault/note-a.md', 'edited A')

    // A should be gone; B should remain.
    expect(tabPaths()).not.toContain('/vault/note-a.md')
    expect(tabPaths()).toContain('/vault/note-b.md')
  })

  it('closing a clean background tab does not prompt and does not write', async () => {
    await renderBootstrapped()
    await openNote('open-note-a')
    // No typeInEditor — buffer matches disk.
    await openNote('open-note-b')

    const tabAId = findTabId('note-a')
    await act(async () => {
      fireEvent.click(screen.getByTestId(`close-tab-${tabAId}`))
    })
    await act(async () => {})

    // No confirmation for a clean tab.
    expect(confirmUnsavedMock).not.toHaveBeenCalled()
    expect(fileWriteMock).not.toHaveBeenCalled()
    expect(tabPaths()).not.toContain('/vault/note-a.md')
  })
})

// ---------------------------------------------------------------------------
// 3. dirtyTabId isolation — background editor must not bleed dirty dot
// ---------------------------------------------------------------------------
//
// BUG IN CURRENT CODE: App uses a single `isDirty` boolean shared by all
// editors via `onDirtyChange={setIsDirty}`. TabBar receives
// `dirtyTabId={isDirty ? activeTabId : null}`. When a background editor calls
// onDirtyChange(true), the active tab gets the dirty dot — wrong.
//
// RED against current code, GREEN after per-tab dirty-state fix.

describe('multi-editor — dirtyTabId isolation (RED until per-tab dirty fix)', () => {
  beforeEach(() => {
    saveModeOverride.value = 'manual'
    setupMarvin()
  })
  afterEach(() => vi.restoreAllMocks())

  it('background editor becoming dirty does NOT set dirtyTabId to the active tab', async () => {
    // Open A (background), then open B (active). Both editors are mounted.
    await renderBootstrapped()
    await openNote('open-note-a')
    await openNote('open-note-b')

    const tabBId = findTabId('note-b')
    expect(tabBarCapture.activeId).toBe(tabBId)

    // Initially no tab is dirty.
    expect(tabBarCapture.dirtyTabId).toBeNull()

    // Background editor A calls onDirtyChange(true).
    // The dirty dot should follow A — not bleed to the active tab B.
    setEditorDirty('/vault/note-a.md', true)

    // CORRECT behavior: dirtyTabId should be A's id (or a per-tab mechanism).
    // CURRENT BUG:     dirtyTabId is set to activeTabId (B's id).
    //
    // Assert the BUG does NOT occur: active tab B must NOT become dirty.
    expect(tabBarCapture.dirtyTabId).not.toBe(tabBId)
  })

  it('active editor becoming dirty sets dirtyTabId to its own tab', async () => {
    await renderBootstrapped()
    await openNote('open-note-a')
    await openNote('open-note-b')

    const tabBId = findTabId('note-b')

    // Active editor B calls onDirtyChange(true).
    setEditorDirty('/vault/note-b.md', true)

    // The active tab B should be marked dirty.
    expect(tabBarCapture.dirtyTabId).toBe(tabBId)
  })

  it('background editor clearing dirty does NOT clear the active tab dirty dot', async () => {
    await renderBootstrapped()
    await openNote('open-note-a')
    await openNote('open-note-b')

    const tabBId = findTabId('note-b')

    // Make active tab B dirty first.
    setEditorDirty('/vault/note-b.md', true)
    expect(tabBarCapture.dirtyTabId).toBe(tabBId)

    // Background editor A calls onDirtyChange(false) (e.g. after autosave).
    // This must NOT clear B's dirty dot.
    setEditorDirty('/vault/note-a.md', false)

    // B's dirty dot must persist.
    expect(tabBarCapture.dirtyTabId).toBe(tabBId)
  })
})

// ---------------------------------------------------------------------------
// 4. Close Others with mixed dirty/clean tabs
// ---------------------------------------------------------------------------

describe('multi-editor — Close Others with mixed dirty tabs', () => {
  beforeEach(() => {
    saveModeOverride.value = 'manual'
    setupMarvin()
  })
  afterEach(() => vi.restoreAllMocks())

  it('Close Others (via onClose loop) prompts for dirty background tab and writes its path', async () => {
    confirmUnsavedMock.mockResolvedValue('save')

    await renderBootstrapped()
    // Open A (dirty), then B (active, clean).
    await openNote('open-note-a')
    typeInEditor('/vault/note-a.md', 'A dirty content')
    await openNote('open-note-b')

    // Simulate TabBar's "Close Others" — calls onClose for all tabs except B.
    const tabAId = findTabId('note-a')
    await act(async () => {
      tabBarCapture.onClose?.(tabAId)
    })
    await act(async () => {})

    // A is dirty — should have been prompted.
    expect(confirmUnsavedMock).toHaveBeenCalledWith('note-a.md')
    // A's buffer should have been written to A's path.
    expect(fileWriteMock).toHaveBeenCalledWith('/vault/note-a.md', 'A dirty content')
    // A is removed; B stays.
    expect(tabPaths()).not.toContain('/vault/note-a.md')
    expect(tabPaths()).toContain('/vault/note-b.md')
  })
})
