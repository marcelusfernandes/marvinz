// @vitest-environment jsdom
//
// Issue #581, AC5's "update on vault switch" clause — the genuine remaining
// gap after AppContext.spec.tsx (contract test: provider propagates + updates
// on a synthetic rerender) and the 23 specs migrated onto renderWithAppContext
// (leaf consumption, post-migration). Neither of those exercises App's REAL
// wiring: handlePickVault -> setVaultPath -> the `<AppProvider
// vaultPath={vaultPath}>` binding at App.tsx. This test drives that real path
// and observes the provider's actual value via a probe, so it's green now
// (the provider is already wired, App.tsx:1866) and stays green once
// Editor/LiveMarkdown/AgentTerminal/AgentsPane/FileTree drop vaultPath as a
// prop — it doesn't touch those components at all.
//
// Mirrors App-menu-action-wire.spec.tsx's harness (onMenuAction capture,
// window.marvin mock) — reuses the 'open-vault' menu action as the switch
// trigger, same as that file's IPC-actions describe block.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import React from 'react'
import { useAppContext } from '../../context/AppContext'

// ---------------------------------------------------------------------------
// Hoisted capture ref
// ---------------------------------------------------------------------------

const { menuActionCb } = vi.hoisted(() => {
  const menuActionCb: { fire: ((action: string) => void) | null } = { fire: null }
  return { menuActionCb }
})

// ---------------------------------------------------------------------------
// Mocks — FileTreeToolbar becomes the AppContext probe; everything else is
// stubbed out as usual for an App-level test.
// ---------------------------------------------------------------------------

function VaultPathProbe() {
  const { vaultPath } = useAppContext()
  return <div data-testid="vault-context-probe">{vaultPath ?? '(none)'}</div>
}

vi.mock('../FileTreeToolbar', () => ({ FileTreeToolbar: () => <VaultPathProbe /> }))

vi.mock('../Editor', () => ({ Editor: () => <div data-testid="editor-stub" /> }))
vi.mock('../FileTree', () => ({ FileTree: () => <div data-testid="file-tree-stub" /> }))
vi.mock('../AgentsPane', () => ({ AgentsPane: () => null }))
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
        onMenuAction: vi.fn((cb: (action: string) => void) => {
          menuActionCb.fire = cb
          return () => {
            menuActionCb.fire = null
          }
        }),
        setMenuNoteContext: vi.fn(),
        confirmUnsavedChanges: vi.fn().mockResolvedValue('discard'),
      },
      shell: { reveal: vi.fn(), openExternal: vi.fn() },
      vault: {
        tree: vi.fn().mockResolvedValue([]),
        watch: vi.fn().mockResolvedValue(undefined),
        onChanged: vi.fn().mockReturnValue(noop),
        pick: vi.fn().mockResolvedValue('/vault-b'),
        current: vi.fn().mockResolvedValue('/vault-a'),
      },
      file: {
        pick: vi.fn().mockResolvedValue(null),
        read: vi.fn().mockResolvedValue('content'),
        write: vi.fn().mockResolvedValue(undefined),
        create: vi.fn().mockResolvedValue('/vault-a/new.md'),
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
        get: vi.fn().mockResolvedValue({ vaultPath: '/vault-a' }),
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

function fireMenu(action: string) {
  act(() => {
    menuActionCb.fire?.(action)
  })
}

beforeEach(() => {
  setupMarvin()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// App -> AppProvider wiring across a real vault switch
// ---------------------------------------------------------------------------

describe('App vaultPath -> AppContext wiring on a real vault switch (#581, AC5)', () => {
  it('the provider carries the bootstrapped vaultPath before any switch', async () => {
    await renderBootstrapped()
    expect(screen.getByTestId('vault-context-probe').textContent).toBe('/vault-a')
  })

  it('the provider flips to the new vaultPath after handlePickVault (open-vault menu action)', async () => {
    await renderBootstrapped()
    expect(screen.getByTestId('vault-context-probe').textContent).toBe('/vault-a')

    fireMenu('open-vault')
    await act(async () => {})

    expect(window.marvin.vault.pick).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('vault-context-probe').textContent).toBe('/vault-b')
  })

  it('re-selecting the same vault is a no-op that leaves the provider value unchanged', async () => {
    ;(window.marvin.vault.pick as ReturnType<typeof vi.fn>).mockResolvedValue('/vault-a')
    await renderBootstrapped()
    expect(screen.getByTestId('vault-context-probe').textContent).toBe('/vault-a')

    fireMenu('open-vault')
    await act(async () => {})

    expect(screen.getByTestId('vault-context-probe').textContent).toBe('/vault-a')
  })
})
