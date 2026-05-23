/**
 * Unit tests for the app:show-context-menu and app:can-paste IPC handler contracts.
 * Issue #173: generic context menu IPC replacing editor-specific one.
 *
 * Strategy: mock electron's Menu, MenuItem, clipboard, and BrowserWindow to
 * exercise the handler logic in isolation. The handler is extracted as a
 * testable factory function that mirrors the main.ts showContextMenu impl.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Types (mirror main.ts)
// ---------------------------------------------------------------------------

type MenuItemSpec =
  | { kind: 'item'; id: string; label: string; accelerator?: string; enabled?: boolean }
  | { kind: 'separator' }

// ---------------------------------------------------------------------------
// Mock infrastructure
// ---------------------------------------------------------------------------

type MenuItemOptions = {
  label?: string
  type?: 'separator' | 'normal'
  accelerator?: string
  enabled?: boolean
  click?: () => void
}

let capturedItems: MenuItemOptions[] = []
let capturedPopupArg: { window?: unknown; callback?: () => void } | undefined = undefined

function makeMenuMock() {
  capturedItems = []
  capturedPopupArg = undefined
  return {
    append: vi.fn((item: MenuItemOptions) => { capturedItems.push(item) }),
    popup: vi.fn((arg?: { window?: unknown; callback?: () => void }) => { capturedPopupArg = arg }),
  }
}

let menuInstance = makeMenuMock()

vi.mock('electron', () => ({
  Menu: vi.fn(function (this: Record<string, unknown>) {
    this.append = menuInstance.append
    this.popup = menuInstance.popup
  }),
  MenuItem: vi.fn(function (this: MenuItemOptions, opts: MenuItemOptions) {
    Object.assign(this, opts)
  }),
  clipboard: {
    availableFormats: vi.fn(() => [] as string[]),
  },
  BrowserWindow: {
    fromWebContents: vi.fn(() => null),
  },
  ipcMain: {
    handle: vi.fn(),
  },
}))

import { Menu, MenuItem, clipboard, BrowserWindow } from 'electron'

// ---------------------------------------------------------------------------
// Handler factories — mirror main.ts logic exactly
// ---------------------------------------------------------------------------

function buildContextMenu(
  sender: unknown,
  items: MenuItemSpec[],
): Promise<string | null> {
  return new Promise<string | null>(resolve => {
    let chosen: string | null = null
    const menu = new Menu()
    for (const spec of items) {
      if (spec.kind === 'separator') {
        menu.append(new MenuItem({ type: 'separator' }))
      } else {
        menu.append(new MenuItem({
          label: spec.label,
          accelerator: spec.accelerator,
          enabled: spec.enabled ?? true,
          click: () => { chosen = spec.id },
        }))
      }
    }
    const win = BrowserWindow.fromWebContents(sender as Parameters<typeof BrowserWindow.fromWebContents>[0])
    menu.popup({ window: win ?? undefined, callback: () => resolve(chosen) })
  })
}

function canPaste(): boolean {
  return clipboard.availableFormats().some(f => f.startsWith('text/') || f === 'text')
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function labeledItems() {
  return capturedItems.filter(i => i.label)
}

function separatorItems() {
  return capturedItems.filter(i => i.type === 'separator')
}

function itemByLabel(label: string): MenuItemOptions | undefined {
  return capturedItems.find(i => i.label === label)
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  menuInstance = makeMenuMock()
  vi.clearAllMocks()
  ;(Menu as unknown as ReturnType<typeof vi.fn>).mockImplementation(function (this: Record<string, unknown>) {
    this.append = menuInstance.append
    this.popup = menuInstance.popup
  })
  ;(MenuItem as unknown as ReturnType<typeof vi.fn>).mockImplementation(function (this: MenuItemOptions, opts: MenuItemOptions) {
    Object.assign(this, opts)
  })
  ;(clipboard.availableFormats as ReturnType<typeof vi.fn>).mockReturnValue([])
})

// ---------------------------------------------------------------------------
// 1. Generic handler — items built in order
// ---------------------------------------------------------------------------

describe('app:show-context-menu — items built in order', () => {
  it('appends items in the order provided', () => {
    const items: MenuItemSpec[] = [
      { kind: 'item', id: 'a', label: 'Alpha' },
      { kind: 'separator' },
      { kind: 'item', id: 'b', label: 'Beta' },
    ]
    buildContextMenu(null, items)
    const labels = capturedItems.map(i => i.label ?? '(separator)')
    expect(labels).toEqual(['Alpha', '(separator)', 'Beta'])
  })

  it('appends zero items when given an empty array', () => {
    buildContextMenu(null, [])
    expect(capturedItems).toHaveLength(0)
  })

  it('appends a single item correctly', () => {
    buildContextMenu(null, [{ kind: 'item', id: 'x', label: 'X' }])
    expect(capturedItems).toHaveLength(1)
    expect(capturedItems[0]).toMatchObject({ label: 'X' })
  })

  it('appends a separator as type=separator', () => {
    buildContextMenu(null, [{ kind: 'separator' }])
    expect(capturedItems[0]).toMatchObject({ type: 'separator' })
  })

  it('handles multiple consecutive separators', () => {
    buildContextMenu(null, [{ kind: 'separator' }, { kind: 'separator' }])
    expect(separatorItems()).toHaveLength(2)
    expect(labeledItems()).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 2. Generic handler — enabled defaults to true
// ---------------------------------------------------------------------------

describe('app:show-context-menu — enabled defaults', () => {
  it('defaults enabled to true when not specified', () => {
    buildContextMenu(null, [{ kind: 'item', id: 'a', label: 'A' }])
    expect(capturedItems[0].enabled).toBe(true)
  })

  it('respects enabled=false when specified', () => {
    buildContextMenu(null, [{ kind: 'item', id: 'a', label: 'A', enabled: false }])
    expect(capturedItems[0].enabled).toBe(false)
  })

  it('respects enabled=true when specified', () => {
    buildContextMenu(null, [{ kind: 'item', id: 'a', label: 'A', enabled: true }])
    expect(capturedItems[0].enabled).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 3. Generic handler — accelerator pass-through
// ---------------------------------------------------------------------------

describe('app:show-context-menu — accelerator pass-through', () => {
  it('passes accelerator to MenuItem when provided', () => {
    buildContextMenu(null, [{ kind: 'item', id: 'a', label: 'A', accelerator: 'CmdOrCtrl+Z' }])
    expect(capturedItems[0].accelerator).toBe('CmdOrCtrl+Z')
  })

  it('passes undefined accelerator when not provided', () => {
    buildContextMenu(null, [{ kind: 'item', id: 'a', label: 'A' }])
    expect(capturedItems[0].accelerator).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// 4. Generic handler — popup called with window and callback
// ---------------------------------------------------------------------------

describe('app:show-context-menu — menu.popup', () => {
  it('calls menu.popup after building items', () => {
    buildContextMenu(null, [])
    expect(menuInstance.popup).toHaveBeenCalledTimes(1)
  })

  it('passes window=undefined when BrowserWindow.fromWebContents returns null', () => {
    ;(BrowserWindow.fromWebContents as ReturnType<typeof vi.fn>).mockReturnValue(null)
    buildContextMenu(null, [])
    expect(capturedPopupArg?.window).toBeUndefined()
    expect(typeof capturedPopupArg?.callback).toBe('function')
  })

  it('passes window=win when BrowserWindow.fromWebContents returns a window', () => {
    const fakeWin = { id: 42 }
    ;(BrowserWindow.fromWebContents as ReturnType<typeof vi.fn>).mockReturnValue(fakeWin)
    buildContextMenu({} as Parameters<typeof BrowserWindow.fromWebContents>[0], [])
    expect(capturedPopupArg?.window).toEqual(fakeWin)
  })

  it('passes a callback to popup', () => {
    buildContextMenu(null, [])
    expect(typeof capturedPopupArg?.callback).toBe('function')
  })
})

// ---------------------------------------------------------------------------
// 5. Generic handler — resolves with chosen id or null
// ---------------------------------------------------------------------------

describe('app:show-context-menu — resolves with chosen id or null', () => {
  it('resolves to null when popup callback fires with no click', async () => {
    const promise = buildContextMenu(null, [{ kind: 'item', id: 'x', label: 'X' }])
    capturedPopupArg?.callback?.()
    await expect(promise).resolves.toBeNull()
  })

  it('resolves to the item id when that item is clicked before callback', async () => {
    const promise = buildContextMenu(null, [
      { kind: 'item', id: 'alpha', label: 'Alpha' },
      { kind: 'item', id: 'beta', label: 'Beta' },
    ])
    itemByLabel('Alpha')?.click?.()
    capturedPopupArg?.callback?.()
    await expect(promise).resolves.toBe('alpha')
  })

  it('resolves to the correct id when second item is clicked', async () => {
    const promise = buildContextMenu(null, [
      { kind: 'item', id: 'alpha', label: 'Alpha' },
      { kind: 'item', id: 'beta', label: 'Beta' },
    ])
    itemByLabel('Beta')?.click?.()
    capturedPopupArg?.callback?.()
    await expect(promise).resolves.toBe('beta')
  })

  it('click before callback wins (click sets chosen before resolve)', async () => {
    const promise = buildContextMenu(null, [{ kind: 'item', id: 'z', label: 'Z' }])
    itemByLabel('Z')?.click?.()
    capturedPopupArg?.callback?.()
    await expect(promise).resolves.toBe('z')
  })
})

// ---------------------------------------------------------------------------
// 6. app:can-paste — returns true when clipboard has text formats
// ---------------------------------------------------------------------------

describe('app:can-paste', () => {
  it('returns false when clipboard has no formats', () => {
    ;(clipboard.availableFormats as ReturnType<typeof vi.fn>).mockReturnValue([])
    expect(canPaste()).toBe(false)
  })

  it('returns false when clipboard has only non-text formats', () => {
    ;(clipboard.availableFormats as ReturnType<typeof vi.fn>).mockReturnValue(['image/png', 'image/jpeg'])
    expect(canPaste()).toBe(false)
  })

  it('returns true when clipboard has text/plain', () => {
    ;(clipboard.availableFormats as ReturnType<typeof vi.fn>).mockReturnValue(['text/plain'])
    expect(canPaste()).toBe(true)
  })

  it('returns true when clipboard has text/html', () => {
    ;(clipboard.availableFormats as ReturnType<typeof vi.fn>).mockReturnValue(['text/html'])
    expect(canPaste()).toBe(true)
  })

  it('returns true when clipboard has any text/* format', () => {
    ;(clipboard.availableFormats as ReturnType<typeof vi.fn>).mockReturnValue(['text/rtf'])
    expect(canPaste()).toBe(true)
  })

  it('returns true when clipboard has bare "text" format', () => {
    ;(clipboard.availableFormats as ReturnType<typeof vi.fn>).mockReturnValue(['text'])
    expect(canPaste()).toBe(true)
  })

  it('returns true when text format is mixed with non-text formats', () => {
    ;(clipboard.availableFormats as ReturnType<typeof vi.fn>).mockReturnValue(['image/png', 'text/plain'])
    expect(canPaste()).toBe(true)
  })

  it('calls clipboard.availableFormats once per invocation', () => {
    canPaste()
    expect(clipboard.availableFormats).toHaveBeenCalledTimes(1)
  })
})
