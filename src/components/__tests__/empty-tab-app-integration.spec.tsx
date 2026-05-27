// @vitest-environment jsdom
//
// Integration tests for the Arquivos + Revisão flows wired in App.tsx (issue #307).
// Covers:
//   1. chooseFileFromEmpty — cancel (null pick) keeps empty tab; valid path removes empty tab.
//   2. convertEmptyToDiff  — empty tab mutates to diff tab in-place (same id).
//   3. DiffTab in TabBar   — label uses tab.title, icon is git-compare.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'

// ---------------------------------------------------------------------------
// Mock heavy UI components that are irrelevant to these flows
// ---------------------------------------------------------------------------

vi.mock('../Editor', () => ({ Editor: () => null }))
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
vi.mock('../AgentsPane', () => ({ AgentsPane: () => null }))
vi.mock('../BrowserPane', () => ({ BrowserPane: () => null }))
vi.mock('../ImageViewer', () => ({ ImageViewer: () => null }))
vi.mock('../PdfViewer', () => ({ PdfViewer: () => null }))
vi.mock('../DocxViewer', () => ({ DocxViewer: () => null }))
vi.mock('../DiffViewer', () => ({
  DiffViewer: () => <div data-testid="diff-viewer" />,
}))
vi.mock('../Icon', () => ({
  Icon: ({ name }: { name: string }) => <span data-testid={`icon-${name}`} />,
}))
vi.mock('../MaterialIcon', () => ({ MaterialIcon: () => null }))
vi.mock('../../lib/fileIcons', () => ({ fileIconFor: () => 'file' }))
vi.mock('../../lib/settingsStore', () => ({
  seedFromMain: vi.fn(),
  useSetting: (key: string) => {
    if (key === 'saveMode') return 'auto'
    return undefined
  },
}))
vi.mock('../../lib/colorTheme', () => ({ useColorTheme: vi.fn() }))
vi.mock('../../lib/visualStyle', () => ({ useVisualStyle: () => 'modern' }))
vi.mock('../../lib/paletteRanker', () => ({}))

// ---------------------------------------------------------------------------
// window.marvin mock
// ---------------------------------------------------------------------------

let filePickMock: ReturnType<typeof vi.fn>

function noop() {}

function setupMarvinMock(vaultPath = '/vault') {
  filePickMock = vi.fn().mockResolvedValue(null)

  Object.assign(window, {
    marvin: {
      app: {
        showContextMenu: vi.fn().mockResolvedValue(null),
        canPaste: vi.fn().mockResolvedValue(false),
      },
      shell: { reveal: vi.fn(), openExternal: vi.fn() },
      vault: {
        tree: vi.fn().mockResolvedValue([]),
        watch: vi.fn().mockResolvedValue(undefined),
        onChanged: vi.fn().mockReturnValue(noop),
        pick: vi.fn().mockResolvedValue(null),
        current: vi.fn().mockResolvedValue(vaultPath),
      },
      file: {
        pick: filePickMock,
        read: vi.fn().mockResolvedValue(''),
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
        get: vi.fn().mockResolvedValue({ vaultPath }),
        set: vi.fn().mockResolvedValue({}),
      },
      agent: { detect: vi.fn().mockResolvedValue(null) },
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
// App import (after mocks are declared)
// ---------------------------------------------------------------------------

import App from '../../App'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function renderAppWithEmptyTab() {
  const utils = render(<App />)
  // Wait for bootstrap (settings:get resolves)
  await act(async () => {})
  // Open an empty tab via the + button
  const newTabBtn = screen.getByRole('button', { name: /new.*tab/i })
  await act(async () => { fireEvent.click(newTabBtn) })
  return utils
}

// ---------------------------------------------------------------------------
// chooseFileFromEmpty — cancel path
// ---------------------------------------------------------------------------

describe('chooseFileFromEmpty — cancel (null) keeps empty tab', () => {
  beforeEach(() => setupMarvinMock())
  afterEach(() => vi.restoreAllMocks())

  it('empty tab remains when file picker is canceled', async () => {
    filePickMock.mockResolvedValue(null)
    await renderAppWithEmptyTab()

    const arquivosBtn = screen.getByText('Arquivos').closest('button') as HTMLButtonElement
    await act(async () => { fireEvent.click(arquivosBtn) })

    expect(screen.getByText('Arquivos')).toBeInTheDocument()
    expect(screen.queryByTestId('diff-viewer')).toBeNull()
  })

  it('file.pick is called once when Arquivos is clicked', async () => {
    filePickMock.mockResolvedValue(null)
    await renderAppWithEmptyTab()

    await act(async () => {
      fireEvent.click(screen.getByText('Arquivos').closest('button') as HTMLButtonElement)
    })

    expect(filePickMock).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// chooseFileFromEmpty — valid path removes empty tab
// ---------------------------------------------------------------------------

describe('chooseFileFromEmpty — valid path opens file', () => {
  beforeEach(() => setupMarvinMock())
  afterEach(() => vi.restoreAllMocks())

  it('empty tab is removed when a valid path is returned by the picker', async () => {
    filePickMock.mockResolvedValue('/vault/note.md')
    ;(window.marvin.file.read as ReturnType<typeof vi.fn>).mockResolvedValue('# hello')

    await renderAppWithEmptyTab()

    await act(async () => {
      fireEvent.click(screen.getByText('Arquivos').closest('button') as HTMLButtonElement)
    })
    // Give async openInTab time to finish
    await act(async () => {})

    expect(screen.queryByText('Arquivos')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// convertEmptyToDiff — in-place tab swap
// ---------------------------------------------------------------------------

describe('convertEmptyToDiff — empty tab becomes diff tab', () => {
  beforeEach(() => setupMarvinMock())
  afterEach(() => vi.restoreAllMocks())

  it('DiffViewer is rendered after clicking Revisão', async () => {
    await renderAppWithEmptyTab()

    await act(async () => {
      fireEvent.click(screen.getByText('Revisão').closest('button') as HTMLButtonElement)
    })

    expect(screen.getByTestId('diff-viewer')).toBeInTheDocument()
  })

  it('empty tab landing is gone after clicking Revisão', async () => {
    await renderAppWithEmptyTab()

    await act(async () => {
      fireEvent.click(screen.getByText('Revisão').closest('button') as HTMLButtonElement)
    })

    expect(screen.queryByText('Navegador')).toBeNull()
  })

  it('tab strip shows "Review" label after the swap', async () => {
    await renderAppWithEmptyTab()

    await act(async () => {
      fireEvent.click(screen.getByText('Revisão').closest('button') as HTMLButtonElement)
    })

    expect(screen.getByText('Review')).toBeInTheDocument()
  })

  it('tab id is preserved (same tab slot, not a new tab)', async () => {
    await renderAppWithEmptyTab()

    // Capture the tab element before the swap
    const tabsBefore = document.querySelectorAll('.tab')
    const countBefore = tabsBefore.length

    await act(async () => {
      fireEvent.click(screen.getByText('Revisão').closest('button') as HTMLButtonElement)
    })

    const tabsAfter = document.querySelectorAll('.tab')
    expect(tabsAfter.length).toBe(countBefore)
  })
})

// ---------------------------------------------------------------------------
// DiffTab in TabBar — cosmetics
// ---------------------------------------------------------------------------

describe('TabBar — diff tab cosmetics', () => {
  beforeEach(() => setupMarvinMock())
  afterEach(() => vi.restoreAllMocks())

  it('diff tab shows git-compare icon', async () => {
    await renderAppWithEmptyTab()

    await act(async () => {
      fireEvent.click(screen.getByText('Revisão').closest('button') as HTMLButtonElement)
    })

    const tabEl = document.querySelector('.tab-diff')
    expect(tabEl).not.toBeNull()
    expect(tabEl?.querySelector('[data-testid="icon-git-compare"]')).not.toBeNull()
  })

  it('diff tab has no context-menu reveal (no path to reveal)', async () => {
    await renderAppWithEmptyTab()

    await act(async () => {
      fireEvent.click(screen.getByText('Revisão').closest('button') as HTMLButtonElement)
    })

    const tabEl = document.querySelector('.tab-diff') as HTMLElement
    // Right-clicking the tab should not invoke shell.reveal
    fireEvent.contextMenu(tabEl)
    await act(async () => {})
    expect(window.marvin.shell.reveal).not.toHaveBeenCalled()
  })
})
