// @vitest-environment jsdom
//
// Regression tests for issue #440:
// Editor undo history (and cursor/scroll) is destroyed on tab switch because
// src/App.tsx:2063 remounts the <Editor> keyed by `${activeTab.id}#${activeTab.path}`.
//
// These tests MUST FAIL against current code and PASS after the fix
// (hidden-stack render keyed by stable tab.id).
//
// Strategy: track how many times each Editor instance is mounted by recording
// every render call with its filePath.  A remount is detected via a useEffect
// cleanup that fires on unmount, after which the next positive render entry for
// the same filePath is a remount.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import React from 'react'

// ---------------------------------------------------------------------------
// Hoisted capture refs — must be set up before vi.mock calls
// ---------------------------------------------------------------------------

const { tabBarCapture, editorLifecycle, saveModeRef } = vi.hoisted(() => {
  // TabBar capture: onActivate lets us switch tabs programmatically
  const tabBarCapture: {
    onActivate: ((id: string) => void) | null
    onClose: ((id: string) => void) | null
    tabs: { id: string; path?: string }[]
    activeId: string | null
  } = { onActivate: null, onClose: null, tabs: [], activeId: null }

  // Lifecycle log: each entry is either a mount (+1) or unmount (-1) event
  // for a given filePath.
  const editorLifecycle: { filePath: string; event: 'mount' | 'unmount' }[] = []

  const saveModeRef: { value: 'auto' | 'manual' } = { value: 'manual' }

  return { tabBarCapture, editorLifecycle, saveModeRef }
})

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../TabBar', () => ({
  TabBar: (props: {
    onClose: (id: string) => void
    tabs: { id: string }[]
    activeId: string | null
    onActivate: (id: string) => void
    onNewTab: () => void
    dirtyTabId: string | null
  }) => {
    tabBarCapture.onClose = props.onClose
    tabBarCapture.onActivate = props.onActivate
    tabBarCapture.tabs = props.tabs
    tabBarCapture.activeId = props.activeId
    return (
      <div data-testid="tab-bar">
        {props.tabs.map((t) => (
          <button
            key={t.id}
            data-testid={`tab-${t.id}`}
            onClick={() => props.onActivate(t.id)}
          >
            activate {t.id}
          </button>
        ))}
      </div>
    )
  },
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

    return (
      <div
        data-testid={`editor-stub`}
        data-filepath={filePath}
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
  useSetting: (key: string) => (key === 'saveMode' ? saveModeRef.value : undefined),
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

function findTabId(pathFragment: string): string {
  const tab = tabBarCapture.tabs.find((t) => t.path?.includes(pathFragment))
  if (!tab) throw new Error(`No tab found for path fragment: ${pathFragment}`)
  return tab.id
}

async function switchToTab(tabId: string) {
  await act(async () => {
    tabBarCapture.onActivate?.(tabId)
  })
  await act(async () => {})
}

/**
 * Count how many times the Editor for filePath was mounted (i.e., how many
 * distinct mount events appear after an unmount, plus the initial mount).
 */
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

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  setupMarvin()
  editorLifecycle.length = 0
  saveModeRef.value = 'manual'
})

afterEach(() => {
  vi.restoreAllMocks()
  saveModeRef.value = 'manual'
})

// ---------------------------------------------------------------------------
// Suite 1: confirm the BUG exists (these assertions match current behavior)
// These will need to be updated/removed once the fix lands.
// ---------------------------------------------------------------------------

describe('issue #440 — current broken behavior: Editor remounts on tab switch', () => {
  it('switching away from tab A then back remounts its Editor (undo history lost)', async () => {
    // Documents the bug: Editor for A is destroyed+recreated on each switch,
    // so CodeMirror EditorState (undo stack, cursor, scroll) is wiped.
    await renderBootstrapped()
    await openNote('open-note-a')
    await openNote('open-note-b')
    const tabAId = findTabId('note-a')

    // Return to A
    await switchToTab(tabAId)

    // BUG: current code unmounts and remounts Editor on every tab switch.
    // mountCountForPath returns 2 because the Editor for A was destroyed when
    // we switched to B and recreated when we switched back.
    expect(mountCountForPath('/vault/note-a.md')).toBe(2)
  })

  it('switching between two tabs remounts both Editors', async () => {
    await renderBootstrapped()
    await openNote('open-note-a')
    await openNote('open-note-b')
    const tabAId = findTabId('note-a')
    const tabBId = findTabId('note-b')

    // A → B → A → B
    await switchToTab(tabAId)
    await switchToTab(tabBId)

    // Both are remounted multiple times under the current regime.
    expect(mountCountForPath('/vault/note-a.md')).toBeGreaterThanOrEqual(2)
    expect(mountCountForPath('/vault/note-b.md')).toBeGreaterThanOrEqual(2)
  })
})

// ---------------------------------------------------------------------------
// Suite 2: REQUIRED behavior after fix (these FAIL against current code)
// ---------------------------------------------------------------------------

describe('issue #440 — required fix: Editor must NOT remount on tab switch', () => {
  it('switching away from A and back must mount the Editor for A exactly once', async () => {
    // FAILS against current code (mountCount is 2).
    // Passes after hidden-stack fix (task #2).
    await renderBootstrapped()
    await openNote('open-note-a')
    const tabAId = findTabId('note-a')
    await openNote('open-note-b')

    // Switch back to A
    await switchToTab(tabAId)

    expect(mountCountForPath('/vault/note-a.md')).toBe(1)
  })

  it('switching A → B → A → B must mount each Editor exactly once', async () => {
    // FAILS against current code.
    await renderBootstrapped()
    await openNote('open-note-a')
    const tabAId = findTabId('note-a')
    await openNote('open-note-b')
    const tabBId = findTabId('note-b')

    await switchToTab(tabAId)
    await switchToTab(tabBId)

    expect(mountCountForPath('/vault/note-a.md')).toBe(1)
    expect(mountCountForPath('/vault/note-b.md')).toBe(1)
  })

  it('Editor DOM node for tab A is still in the document after switching away and back', async () => {
    // FAILS against current code: the node is removed from DOM when the tab is
    // deactivated (because the Editor is unmounted).
    await renderBootstrapped()
    await openNote('open-note-a')
    const tabAId = findTabId('note-a')

    // Capture the editor DOM node while A is active.
    const editorNodeBefore = screen.queryByTestId('editor-stub')
    expect(editorNodeBefore).not.toBeNull()

    await openNote('open-note-b')

    // After switching to B, the current code removes the Editor for A from DOM.
    // The fix keeps it hidden (display:none).
    await switchToTab(tabAId)

    // After switching back, the node should be connected to the document.
    // Fails against current code: editorNodeBefore is detached (was unmounted).
    expect(document.body.contains(editorNodeBefore)).toBe(true)
  })
})
