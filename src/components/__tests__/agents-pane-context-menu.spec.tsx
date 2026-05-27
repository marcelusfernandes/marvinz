/**
 * Tests for the AgentsPane native context menu (issue #175).
 *
 * Strategy:
 *  - Render AgentsPane directly with a fake installed agent.
 *  - Open a tab via the "+ New terminal" button so a tab exists.
 *  - Right-click the tab button and assert window.marvin.app.showContextMenu
 *    is called with the correct MenuItemSpec[] in order.
 *  - Mock the IPC response to each action id and assert the correct
 *    handler is invoked (close, closeOthers, restart, rename).
 *  - For rename: assert InputDialog is rendered with the correct initialValue
 *    and that submitting updates the tab label.
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, act } from '@testing-library/react'
import type { AgentDef } from '../AgentTerminal'

// Capture the real jsdom localStorage before any test mock can replace it.
const realLocalStorage = window.localStorage

// ---------------------------------------------------------------------------
// Stub heavy sub-components AgentsPane imports
// ---------------------------------------------------------------------------

vi.mock('../AgentTerminal', () => ({
  AgentTerminal: ({ ptyId }: { ptyId: string }) => (
    <div data-testid={`terminal-${ptyId}`} />
  ),
}))

vi.mock('../chat/ChatPanel', () => ({
  ChatPanel: ({ sessionId }: { sessionId: string }) => (
    <div data-testid={`chat-${sessionId}`} />
  ),
}))

vi.mock('../ContextMenu', () => ({
  ContextMenu: () => null,
}))

vi.mock('../Icon', () => ({
  Icon: () => null,
}))

// Capture InputDialog props so we can assert initialValue and call onSubmit/onCancel.
type InputDialogProps = {
  title: string
  initialValue?: string
  onSubmit: (value: string) => void
  onCancel: () => void
}
let capturedInputDialog: InputDialogProps | null = null

vi.mock('../InputDialog', () => ({
  InputDialog: (props: InputDialogProps) => {
    capturedInputDialog = props
    return (
      <div
        data-testid="input-dialog"
        data-title={props.title}
        data-initial={props.initialValue ?? ''}
      />
    )
  },
}))

vi.mock('../../lib/settingsStore', () => ({
  useSetting: () => false,
}))

vi.mock('../../lib/colorTheme', () => ({
  useColorTheme: () => 'light',
}))

// ---------------------------------------------------------------------------
// window.marvin mock
// ---------------------------------------------------------------------------

type MenuItemSpec =
  | { kind: 'item'; id: string; label: string; enabled?: boolean }
  | { kind: 'separator' }

let showContextMenuMock: ReturnType<typeof vi.fn>

function setupMarvinMock() {
  showContextMenuMock = vi.fn().mockResolvedValue(null)
  Object.assign(window, {
    marvin: {
      app: {
        showContextMenu: showContextMenuMock,
        canPaste: vi.fn().mockResolvedValue(false),
      },
    },
    localStorage: {
      getItem: vi.fn().mockReturnValue(null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    },
  })
}

// ---------------------------------------------------------------------------
// Import component after mocks
// ---------------------------------------------------------------------------

import { AgentsPane } from '../AgentsPane'

// ---------------------------------------------------------------------------
// Fake agent definitions
// ---------------------------------------------------------------------------

const fakeAgent: AgentDef = {
  id: 'claude',
  name: 'Claude',
  binaryPath: '/usr/local/bin/claude',
}

const fakeAgentCodex: AgentDef = {
  id: 'codex',
  name: 'Codex',
  binaryPath: '/usr/local/bin/codex',
}

const twoAgents = [fakeAgent, fakeAgentCodex]

// ---------------------------------------------------------------------------
// Default props
// ---------------------------------------------------------------------------

function defaultProps(agents: AgentDef[] = [fakeAgent]) {
  return {
    agents,
    vaultPath: '/vault',
    newTabTick: 0,
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function renderWithOneTab(agents: AgentDef[] = [fakeAgent]) {
  capturedInputDialog = null
  const utils = render(<AgentsPane {...defaultProps(agents)} />)
  // Click the "New terminal" button to open one tab.
  await act(async () => {
    const plusBtn = utils.container.querySelector('.agent-new-plus') as HTMLElement
    if (plusBtn) fireEvent.click(plusBtn)
    await new Promise((r) => setTimeout(r, 10))
  })
  return utils
}

async function renderWithTwoTabs() {
  capturedInputDialog = null
  const utils = render(<AgentsPane {...defaultProps()} />)
  await act(async () => {
    const plusBtn = utils.container.querySelector('.agent-new-plus') as HTMLElement
    if (plusBtn) {
      fireEvent.click(plusBtn)
      await new Promise((r) => setTimeout(r, 10))
      fireEvent.click(plusBtn)
      await new Promise((r) => setTimeout(r, 10))
    }
  })
  return utils
}

function rightClickFirstTab(container: HTMLElement) {
  const tabBtn = container.querySelector('.agent-tab-main') as HTMLElement
  if (!tabBtn) throw new Error('No .agent-tab-main found — tab not rendered')
  fireEvent.contextMenu(tabBtn)
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  setupMarvinMock()
})

afterEach(() => {
  capturedInputDialog = null
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// IPC payload — menu items
// ---------------------------------------------------------------------------

describe('AgentsPane — tab context menu IPC payload', () => {
  it('calls showContextMenu once when right-clicking a tab', async () => {
    const { container } = await renderWithOneTab()
    await act(async () => {
      rightClickFirstTab(container)
      await new Promise((r) => setTimeout(r, 10))
    })
    expect(showContextMenuMock).toHaveBeenCalledTimes(1)
  })

  it('sends items array as first argument', async () => {
    const { container } = await renderWithOneTab()
    await act(async () => {
      rightClickFirstTab(container)
      await new Promise((r) => setTimeout(r, 10))
    })
    const [items] = showContextMenuMock.mock.calls[0] as [MenuItemSpec[]]
    expect(Array.isArray(items)).toBe(true)
  })

  it('includes close item first', async () => {
    const { container } = await renderWithOneTab()
    await act(async () => {
      rightClickFirstTab(container)
      await new Promise((r) => setTimeout(r, 10))
    })
    const [items] = showContextMenuMock.mock.calls[0] as [MenuItemSpec[]]
    const first = items[0] as Extract<MenuItemSpec, { kind: 'item' }>
    expect(first.kind).toBe('item')
    expect(first.id).toBe('close')
  })

  it('includes closeOthers item second', async () => {
    const { container } = await renderWithOneTab()
    await act(async () => {
      rightClickFirstTab(container)
      await new Promise((r) => setTimeout(r, 10))
    })
    const [items] = showContextMenuMock.mock.calls[0] as [MenuItemSpec[]]
    const second = items[1] as Extract<MenuItemSpec, { kind: 'item' }>
    expect(second.kind).toBe('item')
    expect(second.id).toBe('closeOthers')
  })

  it('includes a separator as third item', async () => {
    const { container } = await renderWithOneTab()
    await act(async () => {
      rightClickFirstTab(container)
      await new Promise((r) => setTimeout(r, 10))
    })
    const [items] = showContextMenuMock.mock.calls[0] as [MenuItemSpec[]]
    expect(items[2].kind).toBe('separator')
  })

  it('includes restart item fourth', async () => {
    const { container } = await renderWithOneTab()
    await act(async () => {
      rightClickFirstTab(container)
      await new Promise((r) => setTimeout(r, 10))
    })
    const [items] = showContextMenuMock.mock.calls[0] as [MenuItemSpec[]]
    const fourth = items[3] as Extract<MenuItemSpec, { kind: 'item' }>
    expect(fourth.kind).toBe('item')
    expect(fourth.id).toBe('restart')
  })

  it('includes rename item fifth', async () => {
    const { container } = await renderWithOneTab()
    await act(async () => {
      rightClickFirstTab(container)
      await new Promise((r) => setTimeout(r, 10))
    })
    const [items] = showContextMenuMock.mock.calls[0] as [MenuItemSpec[]]
    const fifth = items[4] as Extract<MenuItemSpec, { kind: 'item' }>
    expect(fifth.kind).toBe('item')
    expect(fifth.id).toBe('rename')
  })

  it('closeOthers is disabled when only one tab is open', async () => {
    const { container } = await renderWithOneTab()
    await act(async () => {
      rightClickFirstTab(container)
      await new Promise((r) => setTimeout(r, 10))
    })
    const [items] = showContextMenuMock.mock.calls[0] as [MenuItemSpec[]]
    const closeOthers = items.find(
      (i): i is Extract<MenuItemSpec, { kind: 'item' }> =>
        i.kind === 'item' && i.id === 'closeOthers',
    )
    expect(closeOthers?.enabled).toBe(false)
  })

  it('closeOthers is enabled when two or more tabs are open', async () => {
    const { container } = await renderWithTwoTabs()
    await act(async () => {
      rightClickFirstTab(container)
      await new Promise((r) => setTimeout(r, 10))
    })
    const [items] = showContextMenuMock.mock.calls[0] as [MenuItemSpec[]]
    const closeOthers = items.find(
      (i): i is Extract<MenuItemSpec, { kind: 'item' }> =>
        i.kind === 'item' && i.id === 'closeOthers',
    )
    expect(closeOthers?.enabled).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Action dispatch — close
// ---------------------------------------------------------------------------

describe('AgentsPane — close action', () => {
  it('removes the tab when "close" action is returned', async () => {
    showContextMenuMock.mockResolvedValue('close')
    const { container } = await renderWithOneTab()
    expect(container.querySelectorAll('.agent-tab').length).toBe(1)
    await act(async () => {
      rightClickFirstTab(container)
      await new Promise((r) => setTimeout(r, 30))
    })
    expect(container.querySelectorAll('.agent-tab').length).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Action dispatch — closeOthers
// ---------------------------------------------------------------------------

describe('AgentsPane — closeOthers action', () => {
  it('keeps only the right-clicked tab when "closeOthers" is returned', async () => {
    showContextMenuMock.mockResolvedValue('closeOthers')
    const { container } = await renderWithTwoTabs()
    expect(container.querySelectorAll('.agent-tab').length).toBe(2)
    await act(async () => {
      rightClickFirstTab(container)
      await new Promise((r) => setTimeout(r, 30))
    })
    expect(container.querySelectorAll('.agent-tab').length).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Action dispatch — restart
// ---------------------------------------------------------------------------

describe('AgentsPane — restart action', () => {
  it('re-mounts the tab content with a new ptyId when "restart" is returned', async () => {
    showContextMenuMock.mockResolvedValue('restart')
    // Use a non-chat agent so the terminal mock is rendered (chat agents use ChatPanel).
    const terminalAgent: AgentDef = { id: 'custom', name: 'Custom', binaryPath: '/bin/custom' }
    const { container } = await renderWithOneTab([terminalAgent])
    const terminalsBefore = container.querySelectorAll('[data-testid^="terminal-"]')
    expect(terminalsBefore.length).toBe(1)
    const idBefore = terminalsBefore[0].getAttribute('data-testid')
    await act(async () => {
      rightClickFirstTab(container)
      await new Promise((r) => setTimeout(r, 30))
    })
    // After restart the terminal is re-mounted with a new ptyId (incremented counter).
    const terminalsAfter = container.querySelectorAll('[data-testid^="terminal-"]')
    expect(terminalsAfter.length).toBe(1)
    expect(terminalsAfter[0].getAttribute('data-testid')).not.toBe(idBefore)
  })
})

// ---------------------------------------------------------------------------
// Rename flow
// ---------------------------------------------------------------------------

describe('AgentsPane — rename flow', () => {
  it('renders InputDialog when "rename" action is returned', async () => {
    showContextMenuMock.mockResolvedValue('rename')
    const { container } = await renderWithOneTab()
    await act(async () => {
      rightClickFirstTab(container)
      await new Promise((r) => setTimeout(r, 30))
    })
    expect(container.querySelector('[data-testid="input-dialog"]')).not.toBeNull()
  })

  it('passes current tab label as initialValue to InputDialog', async () => {
    showContextMenuMock.mockResolvedValue('rename')
    const { container } = await renderWithOneTab()
    await act(async () => {
      rightClickFirstTab(container)
      await new Promise((r) => setTimeout(r, 30))
    })
    expect(capturedInputDialog).not.toBeNull()
    // Default label for claude tab 1 is "Claude 1"
    expect(capturedInputDialog!.initialValue).toBe('Claude 1')
  })

  it('updates tab label when InputDialog onSubmit is called', async () => {
    showContextMenuMock.mockResolvedValue('rename')
    const { container } = await renderWithOneTab()
    await act(async () => {
      rightClickFirstTab(container)
      await new Promise((r) => setTimeout(r, 30))
    })
    expect(capturedInputDialog).not.toBeNull()
    await act(async () => {
      capturedInputDialog!.onSubmit('My Agent')
    })
    const tabName = container.querySelector('.agent-tab-name')
    expect(tabName?.textContent).toBe('My Agent')
  })

  it('closes InputDialog when onCancel is called', async () => {
    showContextMenuMock.mockResolvedValue('rename')
    const { container } = await renderWithOneTab()
    await act(async () => {
      rightClickFirstTab(container)
      await new Promise((r) => setTimeout(r, 30))
    })
    expect(container.querySelector('[data-testid="input-dialog"]')).not.toBeNull()
    await act(async () => {
      capturedInputDialog!.onCancel()
    })
    expect(container.querySelector('[data-testid="input-dialog"]')).toBeNull()
  })

  it('does not change label when InputDialog is cancelled', async () => {
    showContextMenuMock.mockResolvedValue('rename')
    const { container } = await renderWithOneTab()
    const labelBefore = container.querySelector('.agent-tab-name')?.textContent
    await act(async () => {
      rightClickFirstTab(container)
      await new Promise((r) => setTimeout(r, 30))
    })
    await act(async () => {
      capturedInputDialog!.onCancel()
    })
    expect(container.querySelector('.agent-tab-name')?.textContent).toBe(labelBefore)
  })
})

// ---------------------------------------------------------------------------
// Null action — no side effects
// ---------------------------------------------------------------------------

describe('AgentsPane — null action (dismissed menu)', () => {
  it('does not close any tab when showContextMenu resolves null', async () => {
    showContextMenuMock.mockResolvedValue(null)
    const { container } = await renderWithOneTab()
    await act(async () => {
      rightClickFirstTab(container)
      await new Promise((r) => setTimeout(r, 30))
    })
    expect(container.querySelectorAll('.agent-tab').length).toBe(1)
  })

  it('does not render InputDialog when showContextMenu resolves null', async () => {
    showContextMenuMock.mockResolvedValue(null)
    const { container } = await renderWithOneTab()
    await act(async () => {
      rightClickFirstTab(container)
      await new Promise((r) => setTimeout(r, 30))
    })
    expect(container.querySelector('[data-testid="input-dialog"]')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Agent picker chevron
// ---------------------------------------------------------------------------

function clickChevron(container: HTMLElement) {
  const btn = container.querySelector('.agent-new-chevron') as HTMLElement
  if (!btn) throw new Error('No .agent-new-chevron found — chevron not rendered')
  fireEvent.click(btn)
}

describe('AgentsPane — agent picker chevron', () => {
  it('calls showContextMenu with the two picker items when chevron is clicked', async () => {
    const { container } = render(<AgentsPane {...defaultProps(twoAgents)} />)
    await act(async () => {
      clickChevron(container)
      await new Promise((r) => setTimeout(r, 30))
    })
    expect(showContextMenuMock).toHaveBeenCalledWith([
      { kind: 'item', id: 'claude', label: 'Claude Code' },
      { kind: 'item', id: 'codex', label: 'Codex' },
    ])
  })

  it('adds a claude tab when picker resolves "claude"', async () => {
    showContextMenuMock.mockResolvedValue('claude')
    const { container } = render(<AgentsPane {...defaultProps(twoAgents)} />)
    await act(async () => {
      clickChevron(container)
      await new Promise((r) => setTimeout(r, 30))
    })
    const tabs = container.querySelectorAll('.agent-tab[data-agent="claude"]')
    expect(tabs.length).toBe(1)
  })

  it('adds a codex tab when picker resolves "codex"', async () => {
    showContextMenuMock.mockResolvedValue('codex')
    const { container } = render(<AgentsPane {...defaultProps(twoAgents)} />)
    await act(async () => {
      clickChevron(container)
      await new Promise((r) => setTimeout(r, 30))
    })
    const tabs = container.querySelectorAll('.agent-tab[data-agent="codex"]')
    expect(tabs.length).toBe(1)
  })

  it('adds no tab when picker resolves null', async () => {
    showContextMenuMock.mockResolvedValue(null)
    const { container } = render(<AgentsPane {...defaultProps(twoAgents)} />)
    await act(async () => {
      clickChevron(container)
      await new Promise((r) => setTimeout(r, 30))
    })
    expect(container.querySelectorAll('.agent-tab').length).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Persistence — helpers used by the persistence describe blocks
// ---------------------------------------------------------------------------

const TAB_LABELS_KEY = 'marvin.tabLabels'

function setupMarvinMockRealStorage() {
  showContextMenuMock = vi.fn().mockResolvedValue(null)
  // Restore the real jsdom localStorage (setupMarvinMock replaces it with a
  // plain mock object) and set up window.marvin.
  Object.defineProperty(window, 'localStorage', {
    value: realLocalStorage,
    writable: true,
    configurable: true,
  })
  Object.assign(window, {
    marvin: {
      app: {
        showContextMenu: showContextMenuMock,
        canPaste: vi.fn().mockResolvedValue(false),
      },
    },
  })
}

// ---------------------------------------------------------------------------
// Persistence — GC: orphan labels are removed on mount
// ---------------------------------------------------------------------------

describe('AgentsPane — persistence: GC', () => {
  beforeEach(() => {
    setupMarvinMockRealStorage()
    realLocalStorage.clear()
  })

  afterEach(() => {
    capturedInputDialog = null
    vi.restoreAllMocks()
    realLocalStorage.clear()
  })

  it('removes orphan label entries that have no matching tab on mount', async () => {
    // Pre-seed an orphan entry (no matching tab will exist).
    realLocalStorage.setItem(TAB_LABELS_KEY, JSON.stringify({ orphanTab: 'Orphan Label' }))
    // Mount with no tabs initially — hydration effect runs, finds no matching
    // tab ids, and writes back an empty map (GC).
    await act(async () => {
      render(<AgentsPane {...defaultProps()} />)
      await new Promise((r) => setTimeout(r, 20))
    })
    const stored = JSON.parse(realLocalStorage.getItem(TAB_LABELS_KEY) ?? '{}')
    expect(stored).not.toHaveProperty('orphanTab')
  })

  it('removes all entries when no tabs exist at mount time', async () => {
    realLocalStorage.setItem(
      TAB_LABELS_KEY,
      JSON.stringify({ 'claude-1': 'A', 'claude-2': 'B' }),
    )
    await act(async () => {
      render(<AgentsPane {...defaultProps()} />)
      await new Promise((r) => setTimeout(r, 20))
    })
    const stored = JSON.parse(realLocalStorage.getItem(TAB_LABELS_KEY) ?? 'null')
    // All entries were orphans (no tabs on mount) — map is empty or key removed.
    expect(Object.keys(stored ?? {}).length).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Persistence — write-through: rename writes label to localStorage
// ---------------------------------------------------------------------------

describe('AgentsPane — persistence: write-through', () => {
  beforeEach(() => {
    setupMarvinMockRealStorage()
    realLocalStorage.clear()
  })

  afterEach(() => {
    capturedInputDialog = null
    vi.restoreAllMocks()
    realLocalStorage.clear()
  })

  it('writes the new label to localStorage when a tab is renamed', async () => {
    showContextMenuMock.mockResolvedValue('rename')
    const { container } = await renderWithOneTab()
    await act(async () => {
      rightClickFirstTab(container)
      await new Promise((r) => setTimeout(r, 30))
    })
    await act(async () => {
      capturedInputDialog!.onSubmit('My Custom Label')
    })
    const stored = JSON.parse(realLocalStorage.getItem(TAB_LABELS_KEY) ?? '{}')
    const tabId = Object.keys(stored)[0]
    expect(stored[tabId]).toBe('My Custom Label')
  })

  it('removes the label from localStorage when rename is submitted with empty string', async () => {
    showContextMenuMock.mockResolvedValue('rename')
    const { container } = await renderWithOneTab()
    // Rename to something first.
    await act(async () => {
      rightClickFirstTab(container)
      await new Promise((r) => setTimeout(r, 30))
    })
    await act(async () => {
      capturedInputDialog!.onSubmit('Temp Label')
    })
    // Now rename to empty.
    showContextMenuMock.mockResolvedValue('rename')
    await act(async () => {
      rightClickFirstTab(container)
      await new Promise((r) => setTimeout(r, 30))
    })
    await act(async () => {
      capturedInputDialog!.onSubmit('  ')
    })
    const stored = JSON.parse(realLocalStorage.getItem(TAB_LABELS_KEY) ?? '{}')
    expect(Object.keys(stored).length).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Persistence — restart preservation: renamed label survives restart
// ---------------------------------------------------------------------------

describe('AgentsPane — persistence: restart preservation', () => {
  beforeEach(() => {
    setupMarvinMockRealStorage()
    realLocalStorage.clear()
  })

  afterEach(() => {
    capturedInputDialog = null
    vi.restoreAllMocks()
    realLocalStorage.clear()
  })

  it('reapplies the renamed label to the new tab after restart', async () => {
    // Step 1: rename the tab.
    showContextMenuMock.mockResolvedValue('rename')
    const { container } = await renderWithOneTab()
    await act(async () => {
      rightClickFirstTab(container)
      await new Promise((r) => setTimeout(r, 30))
    })
    await act(async () => {
      capturedInputDialog!.onSubmit('Renamed Agent')
    })
    const tabNameBefore = container.querySelector('.agent-tab-name')?.textContent
    expect(tabNameBefore).toBe('Renamed Agent')

    // Step 2: restart the tab via context menu.
    showContextMenuMock.mockResolvedValue('restart')
    await act(async () => {
      rightClickFirstTab(container)
      await new Promise((r) => setTimeout(r, 50))
    })

    // Step 3: the restarted tab should still show the renamed label.
    const tabNameAfter = container.querySelector('.agent-tab-name')?.textContent
    expect(tabNameAfter).toBe('Renamed Agent')
  })

  it('updates localStorage to use the new tab id after restart', async () => {
    showContextMenuMock.mockResolvedValue('rename')
    const { container } = await renderWithOneTab()
    await act(async () => {
      rightClickFirstTab(container)
      await new Promise((r) => setTimeout(r, 30))
    })
    await act(async () => {
      capturedInputDialog!.onSubmit('Restarted Label')
    })

    const storedBefore = JSON.parse(realLocalStorage.getItem(TAB_LABELS_KEY) ?? '{}')
    const oldTabId = Object.keys(storedBefore)[0]

    // Restart.
    showContextMenuMock.mockResolvedValue('restart')
    await act(async () => {
      rightClickFirstTab(container)
      await new Promise((r) => setTimeout(r, 50))
    })

    const storedAfter = JSON.parse(realLocalStorage.getItem(TAB_LABELS_KEY) ?? '{}')
    // Old id should be removed.
    expect(storedAfter).not.toHaveProperty(oldTabId)
    // New id should carry the label.
    const values = Object.values(storedAfter)
    expect(values).toContain('Restarted Label')
  })
})
