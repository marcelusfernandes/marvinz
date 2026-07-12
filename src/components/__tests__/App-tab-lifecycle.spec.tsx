// @vitest-environment jsdom
//
// Characterization tests for issue #578 (extract useTabs hook). Written
// BEFORE the extraction, against the CURRENT App.tsx tab state machine, to
// lock in observable behavior the refactor must preserve. Not new features —
// gaps identified in the M2 test net audit: the existing App-saveBuffer /
// App-multi-editor-wiring / App-mru-eviction / App-rename-buffer /
// App-navigation-* specs cover dirty-close guards, rename, eviction, and
// content-integrity thoroughly, but never assert on `activeTabId` after
// closing the ACTIVE tab (which neighbor takes over) or closing the LAST
// open tab, nor on open-path deduplication.
//
// Covers (performCloseTab, App.tsx ~930-956; openInTab, App.tsx ~748-810):
//   1. Opening an already-open path activates the existing tab instead of
//      duplicating it.
//   2. Closing the active tab in the MIDDLE of the list activates the tab
//      that shifts into its old index (the next tab), per
//      `next[idx] ?? next[idx - 1] ?? null`.
//   3. Closing the active tab at the END of the list falls back to the
//      previous tab (`next[idx]` is undefined there, so `next[idx - 1]`).
//   4. Closing the last remaining tab sets `activeTabId` to null.
//   5. Closing a non-active (background) tab never changes `activeTabId`.
//
// Strategy: same App-stub harness as App-saveBuffer.spec.tsx (TabBar/Editor/
// FileTree stubs, window.marvin mock). All tabs stay clean (no typing), so
// closeTab's dirty-guard path is never engaged — this file is purely about
// the close/open mechanics, not the save-guard flows already covered
// elsewhere.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import React from 'react'

// ---------------------------------------------------------------------------
// Hoisted capture refs
// ---------------------------------------------------------------------------

const { tabBarProps } = vi.hoisted(() => {
  const tabBarProps: {
    onClose: ((id: string) => void) | null
    onActivate: ((id: string) => void) | null
    tabs: { id: string; path?: string }[]
    activeId: string | null
  } = { onClose: null, onActivate: null, tabs: [], activeId: null }
  return { tabBarProps }
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
    tabBarProps.onClose = props.onClose
    tabBarProps.onActivate = props.onActivate
    tabBarProps.tabs = props.tabs
    tabBarProps.activeId = props.activeId
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
  Editor: () => <div data-testid="editor-stub" />,
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
      <button
        data-testid="open-note-c"
        onClick={() => props.onSelect?.({ path: '/vault/note-c.md', isDir: false }, {})}
      >
        open C
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

async function closeTab(id: string) {
  await act(async () => {
    fireEvent.click(screen.getByTestId(`close-tab-${id}`))
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

beforeEach(() => {
  setupMarvin()
  tabBarProps.tabs = []
  tabBarProps.activeId = null
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// 1. Open-path deduplication
// ---------------------------------------------------------------------------

describe('Tab lifecycle characterization (#578) — open deduplication', () => {
  it('opening an already-open path activates the existing tab instead of duplicating it', async () => {
    await renderBootstrapped()
    await openNote('open-note-a')
    await openNote('open-note-b')
    expect(tabPaths()).toHaveLength(2)
    expect(tabBarProps.activeId).toBe(findTabId('note-b'))

    // Re-select A from the file tree — must reactivate, not duplicate.
    await openNote('open-note-a')

    expect(tabPaths()).toHaveLength(2)
    expect(tabBarProps.activeId).toBe(findTabId('note-a'))
  })
})

// ---------------------------------------------------------------------------
// 2-5. Close-tab active-reassignment matrix
// ---------------------------------------------------------------------------

describe('Tab lifecycle characterization (#578) — active-tab reassignment on close', () => {
  it('closing the active tab in the middle of the list activates the tab that shifts into its slot (the next tab)', async () => {
    await renderBootstrapped()
    await openNote('open-note-a')
    await openNote('open-note-b')
    await openNote('open-note-c')
    // tabs = [A, B, C], activate B (the middle one).
    const bId = findTabId('note-b')
    await act(async () => {
      tabBarProps.onActivate?.(bId)
    })
    await act(async () => {})
    expect(tabBarProps.activeId).toBe(bId)

    await closeTab(bId)

    // next = [A, C]; idx of B was 1; next[1] = C.
    expect(tabPaths()).not.toContain('/vault/note-b.md')
    expect(tabBarProps.activeId).toBe(findTabId('note-c'))
  })

  it('closing the active tab at the end of the list falls back to the previous tab', async () => {
    await renderBootstrapped()
    await openNote('open-note-a')
    await openNote('open-note-b')
    await openNote('open-note-c')
    // C is active (last opened).
    const cId = findTabId('note-c')
    expect(tabBarProps.activeId).toBe(cId)

    await closeTab(cId)

    // next = [A, B]; idx of C was 2; next[2] is undefined -> next[1] = B.
    expect(tabPaths()).not.toContain('/vault/note-c.md')
    expect(tabBarProps.activeId).toBe(findTabId('note-b'))
  })

  it('closing the last remaining tab sets activeTabId to null', async () => {
    await renderBootstrapped()
    await openNote('open-note-a')
    const aId = findTabId('note-a')
    expect(tabBarProps.activeId).toBe(aId)

    await closeTab(aId)

    expect(tabPaths()).toHaveLength(0)
    expect(tabBarProps.activeId).toBeNull()
  })

  it('closing a non-active (background) tab never changes activeTabId', async () => {
    await renderBootstrapped()
    await openNote('open-note-a')
    await openNote('open-note-b')
    // B is active; close A from the background.
    const bId = findTabId('note-b')
    const aId = findTabId('note-a')
    expect(tabBarProps.activeId).toBe(bId)

    await closeTab(aId)

    expect(tabPaths()).not.toContain('/vault/note-a.md')
    expect(tabBarProps.activeId).toBe(bId)
  })
})
