// @vitest-environment jsdom
//
// Regression coverage for issue #560, requested by team-lead as priority
// scenarios before QA sign-off:
//
//   1. Navigating within the same tab (goBack/goForward/wikilink-replace)
//      swaps the displayed content — the version bump (9db52b3/94b6f71)
//      forces the Editor to reseed, so it can never keep showing the
//      previous file's content under the new path.
//   2. Navigating back (goBack) to a file with a live, unsaved edited
//      buffer must show that buffer — not a fresh disk re-read. This is
//      about `readFreshContent` (App.tsx:619-624), used unconditionally by
//      goBack/goForward/navigateInActiveTab/navigateOrOpen, which
//      overwrites `bufferContentRef` for the target path with whatever is
//      currently on disk BEFORE the render reads
//      `bufferContentRef.current.get(path) ?? noteTab.content` — so any
//      live edit not yet autosaved is silently discarded on navigating back.
//
// Scenario 3 (a pending autosave never writes the OLD file's stale content
// under the NEW path after navigation) requires the real Editor's internal
// debounce/latestValue race and is covered separately in
// Editor-navigation-autosave-race.spec.tsx.
//
// Strategy: same App-stub harness as App-rename-buffer.spec.tsx /
// App-navigation-version-bump.spec.tsx. Editor is mocked; FileTree opens
// note A. `onBufferChange`/`onNavigate`/`onBack` are driven directly from
// the captured Editor props to simulate typing and in-tab navigation.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import React from 'react'

// ---------------------------------------------------------------------------
// Hoisted capture refs
// ---------------------------------------------------------------------------

const { lastEditorProps, fileOnChangedCb } = vi.hoisted(() => {
  const lastEditorProps: { current: Record<string, unknown> | null } = { current: null }
  const fileOnChangedCb: {
    fire: ((filePath: string, source: 'external' | 'agent') => void) | null
  } = { fire: null }
  return { lastEditorProps, fileOnChangedCb }
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
// Renders a detectable marker (instead of null) so tests can observe
// whether `noteTab.pendingExternalChange` got set — the App only mounts
// this banner when it did (App.tsx: `isActive && noteTab.pendingExternalChange`).
vi.mock('../ExternalChangeBanner', () => ({
  ExternalChangeBanner: () => <div data-testid="external-change-banner" />,
}))
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

// Mutable so Scenario 4/5 can change disk content mid-test to simulate an
// external edit. Reset to the baseline in beforeEach.
let noteADiskContent = 'content A'
let noteBDiskContent = 'content B'

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
        // Both mutable (see `noteADiskContent`/`noteBDiskContent`) so tests
        // can simulate an external disk change mid-test — Scenario 4 uses
        // B's, Scenario 5 uses A's.
        read: vi.fn(async (path: string) =>
          path.includes('note-a') ? noteADiskContent : noteBDiskContent
        ),
        write: vi.fn().mockResolvedValue(undefined),
        create: vi.fn().mockResolvedValue('/vault/new.md'),
        writeBinary: vi.fn().mockResolvedValue(''),
        onChanged: vi.fn((cb: (filePath: string, source: 'external' | 'agent') => void) => {
          fileOnChangedCb.fire = cb
          return () => {
            fileOnChangedCb.fire = null
          }
        }),
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

function typeInEditor(content: string) {
  const onBufferChange = lastEditorProps.current?.onBufferChange as
    | ((c: string) => void)
    | undefined
  act(() => {
    onBufferChange?.(content)
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
  fileOnChangedCb.fire = null
  noteADiskContent = 'content A'
  noteBDiskContent = 'content B'
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// Scenario 1 — in-tab navigation always swaps the displayed content
// ---------------------------------------------------------------------------

describe('Scenario 1 — in-tab navigation swaps content, never shows the previous file under the new path (#560)', () => {
  it('navigating from A to B via wikilink-replace shows B, not a stale copy of A', async () => {
    await renderBootstrapped()
    await openNote('open-note-a')
    expect(lastEditorProps.current?.filePath).toBe('/vault/note-a.md')
    expect(lastEditorProps.current?.initialContent).toBe('content A')

    await navigateOrOpenReplaceCurrent('/vault/note-b.md')

    expect(lastEditorProps.current?.filePath).toBe('/vault/note-b.md')
    expect(lastEditorProps.current?.initialContent).toBe('content B')
    expect(lastEditorProps.current?.initialContent).not.toBe('content A')
  })
})

// ---------------------------------------------------------------------------
// Scenario 2 — goBack to a file with a live unsaved buffer must show the
// buffer, not a fresh (stale, pre-edit) disk re-read
// ---------------------------------------------------------------------------

describe('Scenario 2 — goBack to a file with an unsaved edited buffer shows the live buffer, not disk (#560)', () => {
  it('editing A, navigating away, then going back to A preserves the unsaved edit', async () => {
    await renderBootstrapped()
    await openNote('open-note-a')

    // Edit A but never save it (no autosave simulated here — the buffer only
    // lives in bufferContentRef, exactly like a debounce window still open).
    typeInEditor('edited content for A')

    // Navigate away to B (replace-current, same tab) — A is no longer
    // displayed, but its edited buffer must persist in bufferContentRef.
    await navigateOrOpenReplaceCurrent('/vault/note-b.md')
    expect(lastEditorProps.current?.filePath).toBe('/vault/note-b.md')

    // goBack to A: must seed from the live buffer (bufferContentRef-first),
    // not a fresh disk read that would discard the unsaved edit.
    await goBack()

    expect(lastEditorProps.current?.filePath).toBe('/vault/note-a.md')
    expect(lastEditorProps.current?.initialContent).toBe('edited content for A')
  })
})

// ---------------------------------------------------------------------------
// Scenario 4 (team-lead follow-up) — a file with NO pending edit still seeds
// from a fresh disk read, even if that fresh read diverges from the last
// cached buffer. Discriminates the correct "diverged from last known disk"
// dirty check from a naive "diverged from this fresh read" one: a clean,
// never-edited buffer must never mask a real external disk change.
// ---------------------------------------------------------------------------

describe('Scenario 4 — a clean (never-edited) buffer never masks a fresh external disk change (#560)', () => {
  it('going back to a file that was never edited shows the new disk content, not the stale cached buffer', async () => {
    await renderBootstrapped()
    await openNote('open-note-a')

    // Navigate to B without ever editing it — its buffer is "clean" (equal
    // to the disk content it was seeded from).
    await navigateOrOpenReplaceCurrent('/vault/note-b.md')
    expect(lastEditorProps.current?.initialContent).toBe('content B')

    // Go back to A, then simulate B's file changing on disk while it's not
    // displayed (e.g. an external process/agent edit).
    await goBack()
    noteBDiskContent = 'content B (changed on disk while away)'

    // Forward to B again: B's buffer was never edited, so the fresh disk
    // content must win — it must NOT show the stale pre-change buffer.
    await goForward()

    expect(lastEditorProps.current?.filePath).toBe('/vault/note-b.md')
    expect(lastEditorProps.current?.initialContent).toBe('content B (changed on disk while away)')
  })
})

// ---------------------------------------------------------------------------
// Scenario 5 (follow-up promised to QA on #560) — the symmetric case to
// Scenario 4: a DIRTY (genuinely edited, unsaved) buffer that ALSO has a
// real external disk change land at the same time must surface the
// conflict via the external-change banner, not silently resolve either
// way. This exercises `window.marvin.file.onChanged`'s own isDirty branch
// (App.tsx ~571-593), independent of navigation — a real filesystem watcher
// event racing an in-progress edit.
// ---------------------------------------------------------------------------

describe('Scenario 5 — a dirty buffer plus a concurrent external disk change surfaces the conflict banner (#560 follow-up)', () => {
  it('editing A, then an external change to A while the edit is unsaved, shows the banner and does not silently resolve either way', async () => {
    await renderBootstrapped()
    await openNote('open-note-a')
    const versionBeforeConflict = lastEditorProps.current?.version

    // Genuine pending edit — buffer diverges from the last known disk.
    // (Only reaches bufferContentRef at the App level; the mocked Editor
    // doesn't hold live CodeMirror state, so the real invariant to check
    // here is that nothing forces a reseed — see below.)
    typeInEditor('edited content for A (unsaved)')

    // Simulate an external process changing A's file on disk while the
    // edit is still unsaved (e.g. an agent or another editor).
    noteADiskContent = 'content A (changed externally)'
    await act(async () => {
      fileOnChangedCb.fire?.('/vault/note-a.md', 'external')
    })
    await act(async () => {})

    // Conflict must be surfaced, not silently resolved either way.
    expect(screen.getByTestId('external-change-banner')).toBeTruthy()

    // `version` must NOT bump — the dirty branch only sets
    // `pendingExternalChange`, never touching `content`/`version`. A real
    // (non-mocked) Editor only reseeds on a version bump, so this is what
    // guarantees the live in-progress edit is never silently clobbered by
    // either the user's stale buffer or the fresh external content.
    expect(lastEditorProps.current?.version).toBe(versionBeforeConflict)

    // `noteTab.content` (the tab-open-time snapshot) must also stay put —
    // proving the external content was NOT silently auto-accepted.
    expect(lastEditorProps.current?.initialContent).toBe('content A')
    expect(lastEditorProps.current?.initialContent).not.toBe('content A (changed externally)')
  })
})
