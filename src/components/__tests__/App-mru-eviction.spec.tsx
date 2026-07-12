// @vitest-environment jsdom
//
// Task #9 — MRU eviction cap (AC#4, issue #440).
//
// App.tsx keeps up to MAX_MOUNTED_EDITORS (6) note-tab Editors mounted at
// once. When a 7th tab is activated the least-recently-active editor is
// evicted (unmounted). Re-activating an evicted tab remounts it (rebuild-
// on-activate fallback — expected; history resets at the LRU boundary).
//
// Strategy: same mount/unmount lifecycle tracking pattern as
// editor-undo-tab-switch.spec.tsx. FileTree stub exposes 8 buttons so
// tests can open 7+ tabs without touching the shared 2-button stub in the
// companion spec.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import React from 'react'

// ---------------------------------------------------------------------------
// Hoisted capture refs
// ---------------------------------------------------------------------------

const { tabBarCapture, editorLifecycle, editorPropsByPath } = vi.hoisted(() => {
  const tabBarCapture: {
    onActivate: ((id: string) => void) | null
    onClose: ((id: string) => void) | null
    tabs: { id: string; path?: string }[]
    activeId: string | null
  } = { onActivate: null, onClose: null, tabs: [], activeId: null }

  const editorLifecycle: { filePath: string; event: 'mount' | 'unmount' }[] = []

  // Latest rendered props per filePath (issue #560) — lets tests read the
  // `initialContent` a (re)mounted Editor was seeded with, and drive
  // `onSave`/`onBufferChange` for a specific tab without it being active.
  const editorPropsByPath = new Map<string, Record<string, unknown>>()

  return { tabBarCapture, editorLifecycle, editorPropsByPath }
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
    tabBarCapture.onActivate = props.onActivate
    tabBarCapture.onClose = props.onClose
    tabBarCapture.tabs = props.tabs
    tabBarCapture.activeId = props.activeId
    return (
      <div data-testid="tab-bar">
        {props.tabs.map((t) => (
          <button
            key={t.id}
            data-testid={`activate-tab-${t.id}`}
            onClick={() => props.onActivate(t.id)}
          >
            activate {t.id}
          </button>
        ))}
      </div>
    )
  },
}))

// Editor stub tracks mount/unmount lifecycle for each filePath.
vi.mock('../Editor', () => ({
  Editor: (props: Record<string, unknown>) => {
    const filePath = props.filePath as string
    editorPropsByPath.set(filePath, props)
    React.useEffect(() => {
      editorLifecycle.push({ filePath, event: 'mount' })
      return () => {
        editorLifecycle.push({ filePath, event: 'unmount' })
      }
    }, [filePath])
    return (
      <div
        data-testid="editor-stub"
        data-filepath={filePath}
        data-is-active={String(props.isActive)}
      />
    )
  },
}))

// FileTree with 8 notes so tests can exceed MAX_MOUNTED_EDITORS (6).
vi.mock('../FileTree', () => ({
  FileTree: (props: {
    onSelect?: (node: { path: string; isDir: boolean }, mods: Record<string, boolean>) => void
  }) => (
    <div>
      {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
        <button
          key={n}
          data-testid={`open-note-${n}`}
          onClick={() => props.onSelect?.({ path: `/vault/note-${n}.md`, isDir: false }, {})}
        >
          open {n}
        </button>
      ))}
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

async function openNote(n: number) {
  await act(async () => {
    fireEvent.click(screen.getByTestId(`open-note-${n}`))
  })
  await act(async () => {})
}

function findTabId(n: number): string {
  const path = `/vault/note-${n}.md`
  const tab = tabBarCapture.tabs.find((t) => (t as { path?: string }).path === path)
  if (!tab) throw new Error(`No tab found for note-${n}`)
  return tab.id
}

async function switchToTab(id: string) {
  await act(async () => {
    tabBarCapture.onActivate?.(id)
  })
  await act(async () => {})
}

/** True if the editor for this path is currently mounted (last event is 'mount'). */
function isMounted(filePath: string): boolean {
  for (let i = editorLifecycle.length - 1; i >= 0; i--) {
    if (editorLifecycle[i].filePath === filePath) {
      return editorLifecycle[i].event === 'mount'
    }
  }
  return false
}

/** Count distinct mount cycles for a filePath (each unmount+remount = +1). */
function mountCount(filePath: string): number {
  let count = 0
  let mounted = false
  for (const entry of editorLifecycle) {
    if (entry.filePath !== filePath) continue
    if (entry.event === 'mount' && !mounted) {
      count++
      mounted = true
    } else if (entry.event === 'unmount') {
      mounted = false
    }
  }
  return count
}

/** The `initialContent` prop the currently (re)mounted Editor for this
 * filePath was last rendered with — what a fresh mount seeds `value` from. */
function latestInitialContent(filePath: string): string | undefined {
  return editorPropsByPath.get(filePath)?.initialContent as string | undefined
}

/** Simulates the real Editor's debounced autosave firing for a background
 * (possibly inactive/evicted) tab, exactly like `onSave` wired in App.tsx.
 * `handleSave` is async (awaits `window.marvin.file.write`), so this awaits
 * the act() callback to flush it deterministically before returning. */
async function triggerSave(filePath: string, content: string) {
  const onSave = editorPropsByPath.get(filePath)?.onSave as
    | ((c: string) => void | Promise<void>)
    | undefined
  await act(async () => {
    await onSave?.(content)
  })
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  setupMarvin()
  editorLifecycle.length = 0
  editorPropsByPath.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// MRU eviction tests
// ---------------------------------------------------------------------------

describe('MRU eviction cap — MAX_MOUNTED_EDITORS = 6 (AC#4, issue #440)', () => {
  it('opening exactly 6 tabs mounts all 6, none evicted', async () => {
    await renderBootstrapped()

    // Open notes 1–6 in sequence.
    for (let n = 1; n <= 6; n++) {
      await openNote(n)
    }

    // All 6 should be mounted — cap not exceeded.
    for (let n = 1; n <= 6; n++) {
      expect(isMounted(`/vault/note-${n}.md`)).toBe(true)
    }
  })

  it('opening a 7th tab evicts the least-recently-active editor (note 1)', async () => {
    // Activation order: 1, 2, 3, 4, 5, 6, 7.
    // After opening 7, editorMru = [7, 6, 5, 4, 3, 2, 1].
    // Top 6 = [7, 6, 5, 4, 3, 2]. Note 1 is evicted.
    await renderBootstrapped()

    for (let n = 1; n <= 7; n++) {
      await openNote(n)
    }

    // Notes 2–7 (the 6 most recent) must be mounted.
    for (let n = 2; n <= 7; n++) {
      expect(isMounted(`/vault/note-${n}.md`)).toBe(true)
    }

    // Note 1 (LRU) must have been unmounted.
    expect(isMounted('/vault/note-1.md')).toBe(false)
  })

  it('opening 8 tabs: notes 3–8 mounted, notes 1 and 2 evicted', async () => {
    await renderBootstrapped()

    for (let n = 1; n <= 8; n++) {
      await openNote(n)
    }

    for (let n = 3; n <= 8; n++) {
      expect(isMounted(`/vault/note-${n}.md`)).toBe(true)
    }
    expect(isMounted('/vault/note-1.md')).toBe(false)
    expect(isMounted('/vault/note-2.md')).toBe(false)
  })

  it('re-activating an evicted tab remounts it (rebuild-on-activate fallback)', async () => {
    // Open 7 tabs — note 1 is evicted.
    await renderBootstrapped()

    for (let n = 1; n <= 7; n++) {
      await openNote(n)
    }

    expect(isMounted('/vault/note-1.md')).toBe(false)

    // Activate note 1 — it was evicted so it re-enters the MRU and remounts.
    const tab1Id = findTabId(1)
    await switchToTab(tab1Id)

    // Note 1 must now be mounted again.
    expect(isMounted('/vault/note-1.md')).toBe(true)
    // It was mounted, unmounted, then remounted — so mountCount >= 2.
    expect(mountCount('/vault/note-1.md')).toBeGreaterThanOrEqual(2)
  })

  it('re-activating note 1 after eviction causes the new LRU (note 2) to be evicted', async () => {
    // Open 7: MRU = [7,6,5,4,3,2,1], note 1 evicted.
    // Switch to 1: MRU = [1,7,6,5,4,3,2], note 2 evicted, note 1 remounted.
    await renderBootstrapped()

    for (let n = 1; n <= 7; n++) {
      await openNote(n)
    }

    const tab1Id = findTabId(1)
    await switchToTab(tab1Id)

    // Note 1 is back; note 2 must now be the evicted one.
    expect(isMounted('/vault/note-1.md')).toBe(true)
    expect(isMounted('/vault/note-2.md')).toBe(false)

    // Notes 3–7 must still be mounted.
    for (let n = 3; n <= 7; n++) {
      expect(isMounted(`/vault/note-${n}.md`)).toBe(true)
    }
  })

  it('tab count stays at 6 mounted editors after any number of switches', async () => {
    // Open 7 tabs, then switch between them several times. At every point
    // at most MAX_MOUNTED_EDITORS (6) editors should be mounted.
    await renderBootstrapped()

    for (let n = 1; n <= 7; n++) {
      await openNote(n)
    }

    // Switch back and forth between various tabs.
    await switchToTab(findTabId(1))
    await switchToTab(findTabId(3))
    await switchToTab(findTabId(5))
    await switchToTab(findTabId(2))

    // Count currently mounted editors.
    const mountedCount = [1, 2, 3, 4, 5, 6, 7].filter((n) =>
      isMounted(`/vault/note-${n}.md`)
    ).length

    expect(mountedCount).toBeLessThanOrEqual(6)
  })
})

// ---------------------------------------------------------------------------
// Regression: stale-content revert on evict → reactivate (issue #560)
//
// Coverage boundary: Editor is stubbed here, so these tests only observe
// `initialContent` (= NoteTab.content) — they lock in the `handleSave`
// setTabs-advancement fix. They do NOT exercise Editor.tsx:502-508's reset
// effect or verify that autosave never writes reverted content back to
// disk; that needs a real (non-stubbed) Editor and is out of scope here.
// ---------------------------------------------------------------------------

describe('Eviction must not revert saved content on reactivate (issue #560)', () => {
  it('reactivating an evicted tab seeds the remounted Editor from the last saved content, not the open-time snapshot', async () => {
    await renderBootstrapped()

    // Open note 1 and autosave an edit for it (mirrors Editor's debounced
    // onSave firing while note 1 is still mounted/active).
    await openNote(1)
    await triggerSave('/vault/note-1.md', 'edited and saved content for note 1')

    // Open 6 more tabs so note 1 falls outside MAX_MOUNTED_EDITORS and its
    // Editor unmounts (evicted, per the existing MRU coverage above).
    for (let n = 2; n <= 7; n++) {
      await openNote(n)
    }
    expect(isMounted('/vault/note-1.md')).toBe(false)

    // Reactivate note 1 — its Editor remounts fresh.
    const tab1Id = findTabId(1)
    await switchToTab(tab1Id)
    expect(isMounted('/vault/note-1.md')).toBe(true)

    // The remounted Editor must seed from the saved content, not the
    // tab-open-time disk snapshot ('initial content', per the file.read mock).
    expect(latestInitialContent('/vault/note-1.md')).toBe('edited and saved content for note 1')
  })

  it('the latest of two autosaves wins and survives evict → reactivate (last-write, not first-write)', async () => {
    await renderBootstrapped()

    // Two successive autosaves for note 1 before it gets evicted — the
    // remounted Editor must seed from the second (latest), not the first.
    await openNote(1)
    await triggerSave('/vault/note-1.md', 'first autosaved content')
    await triggerSave('/vault/note-1.md', 'second autosaved content')

    for (let n = 2; n <= 7; n++) {
      await openNote(n)
    }
    expect(isMounted('/vault/note-1.md')).toBe(false)

    const tab1Id = findTabId(1)
    await switchToTab(tab1Id)
    expect(isMounted('/vault/note-1.md')).toBe(true)

    expect(latestInitialContent('/vault/note-1.md')).toBe('second autosaved content')
  })
})
