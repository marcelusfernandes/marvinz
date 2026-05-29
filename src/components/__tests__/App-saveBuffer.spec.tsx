// @vitest-environment jsdom
//
// Integration tests for the dirty-close guard and saveBuffer (issue #410).
//
// saveBuffer is internal to App; we exercise it through the observable close
// flow. The manual-mode prompt is the native confirm sheet, mocked here via
// window.marvin.app.confirmUnsavedChanges. Cases:
//
//   1. manual + dirty active tab + Save: confirm returns 'save', file.write
//      called with buffered content, tab removed.
//   2. manual + dirty + file.write rejects: tab stays open, buffer preserved
//      (the no-silent-data-loss guarantee).
//   3. auto mode + dirty active tab: file.write called, tab removed, NO confirm.
//   4. manual + dirty non-active tab: editing A, switching to B, then closing A
//      prompts for A and writes A's buffer path-keyed.
//   5. manual + Discard: confirm returns 'discard', tab removed, no write.
//   6. manual + Cancel: confirm returns 'cancel', tab stays, no write.
//
// Strategy: vi.hoisted + App stub pattern from App-menu-action-wire.spec.tsx.
// TabBar stub captures onClose + tabs so we can trigger closeTab and assert.
// Editor stub captures onBufferChange to drive buffer divergence.
// settingsStore mock is overrideable per describe block via a hoisted ref.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import React from 'react'

// ---------------------------------------------------------------------------
// Hoisted capture refs
// ---------------------------------------------------------------------------

const { tabBarProps, lastEditorProps, saveModeOverride } = vi.hoisted(() => {
  const tabBarProps: {
    onClose: ((id: string) => void) | null
    tabs: { id: string; path?: string }[]
    activeId: string | null
  } = { onClose: null, tabs: [], activeId: null }

  const lastEditorProps: {
    current: Record<string, unknown> | null
  } = { current: null }

  // Tests that need auto mode flip this to 'auto' before render.
  const saveModeOverride: { value: 'auto' | 'manual' } = { value: 'manual' }

  return { tabBarProps, lastEditorProps, saveModeOverride }
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
    tabBarProps.onClose = props.onClose
    tabBarProps.tabs = props.tabs
    tabBarProps.activeId = props.activeId
    return (
      <div data-testid="tab-bar">
        {props.tabs.map((t) => (
          <button
            key={t.id}
            data-testid={`close-tab-${t.id}`}
            onClick={() => props.onClose(t.id)}
          >
            close {t.id}
          </button>
        ))}
      </div>
    )
  },
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
  useSetting: (key: string) =>
    key === 'saveMode' ? saveModeOverride.value : undefined,
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

// Drives bufferContentRef divergence via the active Editor's onBufferChange.
function typeInEditor(content: string) {
  const onBufferChange = lastEditorProps.current?.onBufferChange as
    | ((c: string) => void)
    | undefined
  act(() => {
    onBufferChange?.(content)
  })
}

function findTabId(pathFragment: string): string {
  const tab = tabBarProps.tabs.find((t) => (t as { path?: string }).path?.includes(pathFragment))
  if (!tab) throw new Error(`No tab found for path fragment: ${pathFragment}`)
  return tab.id
}

function tabPaths(): (string | undefined)[] {
  return tabBarProps.tabs.map((t) => (t as { path?: string }).path)
}

// ---------------------------------------------------------------------------
// 1. Manual mode — active dirty tab — Save
// ---------------------------------------------------------------------------

describe('App close-guard — manual mode, active dirty tab', () => {
  beforeEach(() => {
    saveModeOverride.value = 'manual'
    setupMarvin()
  })
  afterEach(() => vi.restoreAllMocks())

  it('Save prompt calls file.write with buffered content and removes the tab', async () => {
    confirmUnsavedMock.mockResolvedValue('save')
    await renderBootstrapped()
    await openNote('open-note-a')
    typeInEditor('edited content')

    const tabAId = findTabId('note-a')
    await act(async () => {
      fireEvent.click(screen.getByTestId(`close-tab-${tabAId}`))
    })
    await act(async () => {})

    // Native confirm prompted with the file's basename
    expect(confirmUnsavedMock).toHaveBeenCalledWith('note-a.md')
    expect(fileWriteMock).toHaveBeenCalledWith('/vault/note-a.md', 'edited content')
    expect(tabPaths()).not.toContain('/vault/note-a.md')
  })
})

// ---------------------------------------------------------------------------
// 2. Abort-on-failure — the no-silent-data-loss guarantee
// ---------------------------------------------------------------------------

describe('App close-guard — abort on write failure', () => {
  beforeEach(() => {
    saveModeOverride.value = 'manual'
    setupMarvin()
  })
  afterEach(() => vi.restoreAllMocks())

  it('when file.write rejects, tab stays open and buffer is NOT dropped', async () => {
    confirmUnsavedMock.mockResolvedValue('save')
    fileWriteMock.mockRejectedValue(new Error('disk full'))

    await renderBootstrapped()
    await openNote('open-note-a')
    typeInEditor('edited content')

    const tabAId = findTabId('note-a')
    await act(async () => {
      fireEvent.click(screen.getByTestId(`close-tab-${tabAId}`))
    })
    await act(async () => {})

    expect(confirmUnsavedMock).toHaveBeenCalledTimes(1)

    // Tab must still be present — abort-on-failure
    expect(tabPaths()).toContain('/vault/note-a.md')

    // Attempting close again still prompts (buffer still dirty)
    await act(async () => {
      fireEvent.click(screen.getByTestId(`close-tab-${tabAId}`))
    })
    await act(async () => {})
    expect(confirmUnsavedMock).toHaveBeenCalledTimes(2)
  })
})

// ---------------------------------------------------------------------------
// 3. Auto mode — dirty active tab — no dialog, direct flush
// ---------------------------------------------------------------------------

describe('App close-guard — auto mode', () => {
  beforeEach(() => {
    saveModeOverride.value = 'auto'
    setupMarvin()
  })
  afterEach(() => vi.restoreAllMocks())

  it('closes dirty tab without prompting and calls file.write', async () => {
    await renderBootstrapped()
    await openNote('open-note-a')
    typeInEditor('edited content')

    const tabAId = findTabId('note-a')
    await act(async () => {
      fireEvent.click(screen.getByTestId(`close-tab-${tabAId}`))
    })
    await act(async () => {})

    // No prompt in auto mode
    expect(confirmUnsavedMock).not.toHaveBeenCalled()

    // file.write called with the buffer
    expect(fileWriteMock).toHaveBeenCalledWith('/vault/note-a.md', 'edited content')

    // Tab removed
    expect(tabPaths()).not.toContain('/vault/note-a.md')
  })
})

// ---------------------------------------------------------------------------
// 4. Manual mode — non-active dirty tab
// ---------------------------------------------------------------------------

describe('App close-guard — manual mode, non-active dirty tab', () => {
  beforeEach(() => {
    saveModeOverride.value = 'manual'
    setupMarvin()
  })
  afterEach(() => vi.restoreAllMocks())

  it('closing a dirty background tab prompts for it and writes the correct path', async () => {
    confirmUnsavedMock.mockResolvedValue('save')
    await renderBootstrapped()

    // Open A, type, then switch to B — A becomes a background dirty tab
    await openNote('open-note-a')
    typeInEditor('buffer of A')
    await openNote('open-note-b')

    // Close A from the background
    const tabAId = findTabId('note-a')
    await act(async () => {
      fireEvent.click(screen.getByTestId(`close-tab-${tabAId}`))
    })
    await act(async () => {})

    // Prompted with A's file name; writes A's buffer, not B's
    expect(confirmUnsavedMock).toHaveBeenCalledWith('note-a.md')
    expect(fileWriteMock).toHaveBeenCalledWith('/vault/note-a.md', 'buffer of A')
    expect(tabPaths()).not.toContain('/vault/note-a.md')
    // B remains open
    expect(tabPaths()).toContain('/vault/note-b.md')
  })
})

// ---------------------------------------------------------------------------
// 5 & 6. Manual mode — Discard and Cancel
// ---------------------------------------------------------------------------

describe('App close-guard — manual mode, Discard and Cancel', () => {
  beforeEach(() => {
    saveModeOverride.value = 'manual'
    setupMarvin()
  })
  afterEach(() => vi.restoreAllMocks())

  it('Discard removes the tab without writing', async () => {
    confirmUnsavedMock.mockResolvedValue('discard')
    await renderBootstrapped()
    await openNote('open-note-a')
    typeInEditor('edited content')

    const tabAId = findTabId('note-a')
    await act(async () => {
      fireEvent.click(screen.getByTestId(`close-tab-${tabAId}`))
    })
    await act(async () => {})

    expect(confirmUnsavedMock).toHaveBeenCalledWith('note-a.md')
    expect(fileWriteMock).not.toHaveBeenCalled()
    expect(tabPaths()).not.toContain('/vault/note-a.md')
  })

  it('Cancel keeps the tab and does not write', async () => {
    confirmUnsavedMock.mockResolvedValue('cancel')
    await renderBootstrapped()
    await openNote('open-note-a')
    typeInEditor('edited content')

    const tabAId = findTabId('note-a')
    await act(async () => {
      fireEvent.click(screen.getByTestId(`close-tab-${tabAId}`))
    })
    await act(async () => {})

    expect(confirmUnsavedMock).toHaveBeenCalledWith('note-a.md')
    expect(fileWriteMock).not.toHaveBeenCalled()
    expect(tabPaths()).toContain('/vault/note-a.md')
  })
})
