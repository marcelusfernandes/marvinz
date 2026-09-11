// @vitest-environment jsdom
//
// Characterization test for issue #578 (extract useTabs hook). Written BEFORE
// the extraction, against the CURRENT App.tsx tab state machine, to lock in
// observable behavior the refactor must preserve.
//
// Gap: App-tab-lifecycle.spec.tsx characterizes `performCloseTab` (single-tab
// close via the tab bar), but `closeTabsUnder` (App.tsx ~1562-1576, invoked
// from `handleTrash` on folder/file deletion) is a DISTINCT close path with
// its own activeTabId reassignment (`remaining[0]?.id ?? null`, not the
// neighbor-preserving `next[idx] ?? next[idx-1] ?? null` performCloseTab
// uses) and its own multi-tab-at-once removal (every open tab whose path is
// the trashed root or nested under it). Neither was covered anywhere in the
// M2 or #578 test net.
//
// Strategy: same App-stub harness as App-tab-lifecycle.spec.tsx. Drives the
// trash flow through FileTree's onContextMenu callback (mirroring
// handleNodeContextMenu's real signature) with showContextMenu mocked to
// resolve 'trash'.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import React from 'react'
import type { FileNode } from '../../types'

// ---------------------------------------------------------------------------
// Hoisted capture refs
// ---------------------------------------------------------------------------

const { tabBarProps, fileTreeProps } = vi.hoisted(() => {
  const tabBarProps: {
    tabs: { id: string; path?: string }[]
    activeId: string | null
  } = { tabs: [], activeId: null }
  const fileTreeProps: {
    onContextMenu: ((e: React.MouseEvent, node: FileNode) => void) | null
  } = { onContextMenu: null }
  return { tabBarProps, fileTreeProps }
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
    onNewTab: () => void
    dirtyTabId: string | null
  }) => {
    tabBarProps.tabs = props.tabs
    tabBarProps.activeId = props.activeId
    return <div data-testid="tab-bar" />
  },
}))

vi.mock('../Editor', () => ({
  Editor: () => <div data-testid="editor-stub" />,
}))

vi.mock('../FileTree', () => ({
  FileTree: (props: {
    onSelect?: (node: { path: string; isDir: boolean }, mods: Record<string, boolean>) => void
    onContextMenu?: (e: React.MouseEvent, node: FileNode) => void
  }) => {
    fileTreeProps.onContextMenu = props.onContextMenu ?? null
    return (
      <div>
        <button
          data-testid="open-note-a"
          onClick={() => props.onSelect?.({ path: '/vault/sub/note-a.md', isDir: false }, {})}
        >
          open A
        </button>
        <button
          data-testid="open-note-b"
          onClick={() => props.onSelect?.({ path: '/vault/sub/note-b.md', isDir: false }, {})}
        >
          open B
        </button>
        <button
          data-testid="open-note-c"
          onClick={() => props.onSelect?.({ path: '/vault/note-c.md', isDir: false }, {})}
        >
          open C
        </button>
      </div>
    )
  },
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
        showContextMenu: vi.fn().mockResolvedValue('trash'),
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
        read: vi.fn().mockResolvedValue('content'),
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
        capture: vi.fn().mockResolvedValue({ ok: true, data: { snapshotId: 'snap-1' } }),
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

function findTabId(pathFragment: string): string {
  const tab = tabBarProps.tabs.find((t) => (t as { path?: string }).path?.includes(pathFragment))
  if (!tab) throw new Error(`No tab found for path fragment: ${pathFragment}`)
  return tab.id
}

function tabPaths(): (string | undefined)[] {
  return tabBarProps.tabs.map((t) => (t as { path?: string }).path)
}

async function trashFolder(path: string) {
  const fakeEvent = { preventDefault: noop, stopPropagation: noop } as unknown as React.MouseEvent
  await act(async () => {
    fileTreeProps.onContextMenu?.(fakeEvent, { name: path, path, isDir: true })
  })
  await act(async () => {})
}

beforeEach(() => {
  setupMarvin()
  tabBarProps.tabs = []
  tabBarProps.activeId = null
  fileTreeProps.onContextMenu = null
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// closeTabsUnder characterization
// ---------------------------------------------------------------------------

describe('Tab lifecycle characterization (#578) — closeTabsUnder on folder trash', () => {
  it('trashing a folder closes every tab nested under it, leaves unrelated tabs open, and reassigns activeTabId to the first remaining tab', async () => {
    await renderBootstrapped()
    // Open order: C (unrelated), A, B (both under /vault/sub). B ends up active.
    await openNote('open-note-c')
    await openNote('open-note-a')
    await openNote('open-note-b')
    expect(tabPaths()).toHaveLength(3)
    expect(tabBarProps.activeId).toBe(findTabId('note-b'))

    await trashFolder('/vault/sub')

    // A and B (nested under /vault/sub) are gone; C (unrelated) survives.
    expect(tabPaths()).toEqual(['/vault/note-c.md'])
    // closeTabsUnder reassigns via `remaining[0]?.id ?? null` — distinct from
    // performCloseTab's neighbor-preserving `next[idx] ?? next[idx-1] ?? null`.
    expect(tabBarProps.activeId).toBe(findTabId('note-c'))
  })
})
