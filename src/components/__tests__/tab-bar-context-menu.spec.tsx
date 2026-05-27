/**
 * Tests for the TabBar native context menu (issue #176).
 *
 * Strategy:
 *  - Render TabBar directly with controlled tabs and mock callbacks.
 *  - Right-click a tab and assert window.marvin.app.showContextMenu is called
 *    with the correct MenuItemSpec[] in order.
 *  - Mock the IPC response to each action id and assert the correct handler
 *    is invoked (onClose for close/closeOthers/closeRight/closeAll, shell.reveal
 *    for reveal).
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, act } from '@testing-library/react'

vi.mock('../Icon', () => ({
  Icon: () => null,
}))

vi.mock('../../lib/fileIcons', () => ({
  fileIconFor: () => 'file',
}))

// ---------------------------------------------------------------------------
// window.marvin mock
// ---------------------------------------------------------------------------

type MenuItemSpec =
  | { kind: 'item'; id: string; label: string; enabled?: boolean }
  | { kind: 'separator' }

let showContextMenuMock: ReturnType<typeof vi.fn>
let shellRevealMock: ReturnType<typeof vi.fn>

function setupMarvinMock() {
  showContextMenuMock = vi.fn().mockResolvedValue(null)
  shellRevealMock = vi.fn().mockResolvedValue(undefined)
  Object.assign(window, {
    marvin: {
      app: {
        showContextMenu: showContextMenuMock,
        canPaste: vi.fn().mockResolvedValue(false),
      },
      shell: {
        reveal: shellRevealMock,
        openExternal: vi.fn(),
      },
    },
  })
}

// ---------------------------------------------------------------------------
// Import component after mocks
// ---------------------------------------------------------------------------

import { TabBar } from '../TabBar'

// ---------------------------------------------------------------------------
// Fake tab data
// ---------------------------------------------------------------------------

const tabA = { type: 'note' as const, id: 'a', path: '/vault/alpha.md' }
const tabB = { type: 'note' as const, id: 'b', path: '/vault/beta.md' }
const tabC = { type: 'note' as const, id: 'c', path: '/vault/gamma.md' }

// ---------------------------------------------------------------------------
// Render helpers
// ---------------------------------------------------------------------------

function renderTabs(tabs = [tabA, tabB, tabC], activeId = 'b') {
  const onClose = vi.fn()
  const onActivate = vi.fn()
  const onNewBrowserTab = vi.fn()
  const utils = render(
    <TabBar
      tabs={tabs}
      activeId={activeId}
      onActivate={onActivate}
      onClose={onClose}
      onNewBrowserTab={onNewBrowserTab}
    />,
  )
  return { ...utils, onClose, onActivate, onNewBrowserTab }
}

function getTabAt(container: HTMLElement, index: number): HTMLElement {
  const tabs = container.querySelectorAll('.tab')
  if (!tabs[index]) throw new Error(`No tab at index ${index}`)
  return tabs[index] as HTMLElement
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  setupMarvinMock()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// IPC payload — menu items order and structure
// ---------------------------------------------------------------------------

describe('TabBar — context menu IPC payload', () => {
  it('calls showContextMenu once when right-clicking a middle tab', async () => {
    const { container } = renderTabs()
    await act(async () => {
      fireEvent.contextMenu(getTabAt(container, 1))
      await new Promise((r) => setTimeout(r, 10))
    })
    expect(showContextMenuMock).toHaveBeenCalledTimes(1)
  })

  it('sends items array as first argument', async () => {
    const { container } = renderTabs()
    await act(async () => {
      fireEvent.contextMenu(getTabAt(container, 1))
      await new Promise((r) => setTimeout(r, 10))
    })
    const [items] = showContextMenuMock.mock.calls[0] as [MenuItemSpec[]]
    expect(Array.isArray(items)).toBe(true)
  })

  it('first item is Close with id "close"', async () => {
    const { container } = renderTabs()
    await act(async () => {
      fireEvent.contextMenu(getTabAt(container, 1))
      await new Promise((r) => setTimeout(r, 10))
    })
    const [items] = showContextMenuMock.mock.calls[0] as [MenuItemSpec[]]
    const first = items[0] as Extract<MenuItemSpec, { kind: 'item' }>
    expect(first.kind).toBe('item')
    expect(first.id).toBe('close')
  })

  it('second item is Close Others with id "closeOthers"', async () => {
    const { container } = renderTabs()
    await act(async () => {
      fireEvent.contextMenu(getTabAt(container, 1))
      await new Promise((r) => setTimeout(r, 10))
    })
    const [items] = showContextMenuMock.mock.calls[0] as [MenuItemSpec[]]
    const second = items[1] as Extract<MenuItemSpec, { kind: 'item' }>
    expect(second.kind).toBe('item')
    expect(second.id).toBe('closeOthers')
  })

  it('third item is Close to the Right with id "closeRight"', async () => {
    const { container } = renderTabs()
    await act(async () => {
      fireEvent.contextMenu(getTabAt(container, 1))
      await new Promise((r) => setTimeout(r, 10))
    })
    const [items] = showContextMenuMock.mock.calls[0] as [MenuItemSpec[]]
    const third = items[2] as Extract<MenuItemSpec, { kind: 'item' }>
    expect(third.kind).toBe('item')
    expect(third.id).toBe('closeRight')
  })

  it('fourth item is Close All with id "closeAll"', async () => {
    const { container } = renderTabs()
    await act(async () => {
      fireEvent.contextMenu(getTabAt(container, 1))
      await new Promise((r) => setTimeout(r, 10))
    })
    const [items] = showContextMenuMock.mock.calls[0] as [MenuItemSpec[]]
    const fourth = items[3] as Extract<MenuItemSpec, { kind: 'item' }>
    expect(fourth.kind).toBe('item')
    expect(fourth.id).toBe('closeAll')
  })

  it('fifth item is a separator', async () => {
    const { container } = renderTabs()
    await act(async () => {
      fireEvent.contextMenu(getTabAt(container, 1))
      await new Promise((r) => setTimeout(r, 10))
    })
    const [items] = showContextMenuMock.mock.calls[0] as [MenuItemSpec[]]
    expect(items[4].kind).toBe('separator')
  })

  it('sixth item is Reveal in Finder with id "reveal"', async () => {
    const { container } = renderTabs()
    await act(async () => {
      fireEvent.contextMenu(getTabAt(container, 1))
      await new Promise((r) => setTimeout(r, 10))
    })
    const [items] = showContextMenuMock.mock.calls[0] as [MenuItemSpec[]]
    const sixth = items[5] as Extract<MenuItemSpec, { kind: 'item' }>
    expect(sixth.kind).toBe('item')
    expect(sixth.id).toBe('reveal')
  })
})

// ---------------------------------------------------------------------------
// Enabled/disabled state — Close Others
// ---------------------------------------------------------------------------

describe('TabBar — Close Others enabled state', () => {
  it('is disabled when only one tab is open', async () => {
    const { container } = renderTabs([tabA], 'a')
    await act(async () => {
      fireEvent.contextMenu(getTabAt(container, 0))
      await new Promise((r) => setTimeout(r, 10))
    })
    const [items] = showContextMenuMock.mock.calls[0] as [MenuItemSpec[]]
    const item = items.find(
      (i): i is Extract<MenuItemSpec, { kind: 'item' }> =>
        i.kind === 'item' && i.id === 'closeOthers',
    )
    expect(item?.enabled).toBe(false)
  })

  it('is enabled when two or more tabs are open', async () => {
    const { container } = renderTabs([tabA, tabB], 'a')
    await act(async () => {
      fireEvent.contextMenu(getTabAt(container, 0))
      await new Promise((r) => setTimeout(r, 10))
    })
    const [items] = showContextMenuMock.mock.calls[0] as [MenuItemSpec[]]
    const item = items.find(
      (i): i is Extract<MenuItemSpec, { kind: 'item' }> =>
        i.kind === 'item' && i.id === 'closeOthers',
    )
    expect(item?.enabled).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Enabled/disabled state — Close to the Right
// ---------------------------------------------------------------------------

describe('TabBar — Close to the Right enabled state', () => {
  it('is disabled when right-clicked tab is the last tab', async () => {
    const { container } = renderTabs([tabA, tabB, tabC], 'a')
    await act(async () => {
      fireEvent.contextMenu(getTabAt(container, 2))
      await new Promise((r) => setTimeout(r, 10))
    })
    const [items] = showContextMenuMock.mock.calls[0] as [MenuItemSpec[]]
    const item = items.find(
      (i): i is Extract<MenuItemSpec, { kind: 'item' }> =>
        i.kind === 'item' && i.id === 'closeRight',
    )
    expect(item?.enabled).toBe(false)
  })

  it('is enabled when right-clicked tab is not the last tab', async () => {
    const { container } = renderTabs([tabA, tabB, tabC], 'a')
    await act(async () => {
      fireEvent.contextMenu(getTabAt(container, 1))
      await new Promise((r) => setTimeout(r, 10))
    })
    const [items] = showContextMenuMock.mock.calls[0] as [MenuItemSpec[]]
    const item = items.find(
      (i): i is Extract<MenuItemSpec, { kind: 'item' }> =>
        i.kind === 'item' && i.id === 'closeRight',
    )
    expect(item?.enabled).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Action dispatch — close
// ---------------------------------------------------------------------------

describe('TabBar — close action', () => {
  it('calls onClose with the right-clicked tab id', async () => {
    showContextMenuMock.mockResolvedValue('close')
    const { container, onClose } = renderTabs()
    await act(async () => {
      fireEvent.contextMenu(getTabAt(container, 1))
      await new Promise((r) => setTimeout(r, 30))
    })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledWith(tabB.id)
  })
})

// ---------------------------------------------------------------------------
// Action dispatch — closeOthers
// ---------------------------------------------------------------------------

describe('TabBar — closeOthers action', () => {
  it('calls onClose for every tab except the right-clicked one', async () => {
    showContextMenuMock.mockResolvedValue('closeOthers')
    const { container, onClose } = renderTabs([tabA, tabB, tabC], 'a')
    await act(async () => {
      fireEvent.contextMenu(getTabAt(container, 1))
      await new Promise((r) => setTimeout(r, 30))
    })
    expect(onClose).toHaveBeenCalledTimes(2)
    expect(onClose).toHaveBeenCalledWith(tabA.id)
    expect(onClose).toHaveBeenCalledWith(tabC.id)
    expect(onClose).not.toHaveBeenCalledWith(tabB.id)
  })
})

// ---------------------------------------------------------------------------
// Action dispatch — closeRight
// ---------------------------------------------------------------------------

describe('TabBar — closeRight action', () => {
  it('calls onClose for every tab to the right of the right-clicked tab', async () => {
    showContextMenuMock.mockResolvedValue('closeRight')
    const { container, onClose } = renderTabs([tabA, tabB, tabC], 'a')
    await act(async () => {
      fireEvent.contextMenu(getTabAt(container, 1))
      await new Promise((r) => setTimeout(r, 30))
    })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledWith(tabC.id)
    expect(onClose).not.toHaveBeenCalledWith(tabA.id)
    expect(onClose).not.toHaveBeenCalledWith(tabB.id)
  })
})

// ---------------------------------------------------------------------------
// Action dispatch — closeAll
// ---------------------------------------------------------------------------

describe('TabBar — closeAll action', () => {
  it('calls onClose for every tab', async () => {
    showContextMenuMock.mockResolvedValue('closeAll')
    const { container, onClose } = renderTabs([tabA, tabB, tabC], 'a')
    await act(async () => {
      fireEvent.contextMenu(getTabAt(container, 1))
      await new Promise((r) => setTimeout(r, 30))
    })
    expect(onClose).toHaveBeenCalledTimes(3)
    expect(onClose).toHaveBeenCalledWith(tabA.id)
    expect(onClose).toHaveBeenCalledWith(tabB.id)
    expect(onClose).toHaveBeenCalledWith(tabC.id)
  })
})

// ---------------------------------------------------------------------------
// Action dispatch — reveal
// ---------------------------------------------------------------------------

describe('TabBar — reveal action', () => {
  it('calls shell.reveal with the file path of the right-clicked tab', async () => {
    showContextMenuMock.mockResolvedValue('reveal')
    const { container } = renderTabs()
    await act(async () => {
      fireEvent.contextMenu(getTabAt(container, 1))
      await new Promise((r) => setTimeout(r, 30))
    })
    expect(shellRevealMock).toHaveBeenCalledTimes(1)
    expect(shellRevealMock).toHaveBeenCalledWith(tabB.path)
  })
})

// ---------------------------------------------------------------------------
// Null action — no side effects
// ---------------------------------------------------------------------------

describe('TabBar — null action (dismissed menu)', () => {
  it('does not call onClose when showContextMenu resolves null', async () => {
    showContextMenuMock.mockResolvedValue(null)
    const { container, onClose } = renderTabs()
    await act(async () => {
      fireEvent.contextMenu(getTabAt(container, 1))
      await new Promise((r) => setTimeout(r, 30))
    })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('does not call shell.reveal when showContextMenu resolves null', async () => {
    showContextMenuMock.mockResolvedValue(null)
    const { container } = renderTabs()
    await act(async () => {
      fireEvent.contextMenu(getTabAt(container, 1))
      await new Promise((r) => setTimeout(r, 30))
    })
    expect(shellRevealMock).not.toHaveBeenCalled()
  })
})
