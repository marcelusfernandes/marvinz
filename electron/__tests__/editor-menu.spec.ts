/**
 * Unit tests for the editor:show-context-menu IPC handler contract.
 * Issue #154: native context menu in editors.
 *
 * Strategy: mock electron's Menu, MenuItem, clipboard, and BrowserWindow to
 * exercise the handler logic in isolation. The handler is extracted as a
 * testable factory function that mirrors the main.ts implementation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Types (mirror main.ts)
// ---------------------------------------------------------------------------

type EditorMenuRequest = { hasSelection: boolean; canUndo: boolean; canRedo: boolean }
type EditorMenuAction = 'cut' | 'copy' | 'paste' | 'selectAll' | 'undo' | 'redo' | null

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

// Captured state per test
let capturedItems: MenuItemOptions[] = []
let capturedOnce: { event: string; handler: () => void } | null = null
let capturedPopupArg: unknown = undefined

function makeMenuMock() {
  capturedItems = []
  capturedOnce = null
  capturedPopupArg = undefined

  return {
    append: vi.fn((item: MenuItemOptions) => {
      capturedItems.push(item)
    }),
    once: vi.fn((event: string, handler: () => void) => {
      capturedOnce = { event, handler }
    }),
    popup: vi.fn((arg?: unknown) => {
      capturedPopupArg = arg
    }),
  }
}

let menuInstance = makeMenuMock()

vi.mock('electron', () => {
  return {
    Menu: vi.fn(function (this: Record<string, unknown>) {
      this.append = menuInstance.append
      this.once = menuInstance.once
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
  }
})

// ---------------------------------------------------------------------------
// Handler factory — mirrors the main.ts handler logic exactly
// ---------------------------------------------------------------------------

import { Menu, MenuItem, clipboard, BrowserWindow } from 'electron'

function buildEditorMenu(
  sender: unknown,
  req: EditorMenuRequest,
): Promise<EditorMenuAction> {
  const canPaste = clipboard.availableFormats().some(f => f.startsWith('text/') || f === 'text')
  return new Promise<EditorMenuAction>(resolve => {
    const menu = new Menu()
    menu.append(new MenuItem({ label: 'Cut', accelerator: 'CmdOrCtrl+X', enabled: req.hasSelection, click: () => resolve('cut') }))
    menu.append(new MenuItem({ label: 'Copy', accelerator: 'CmdOrCtrl+C', enabled: req.hasSelection, click: () => resolve('copy') }))
    menu.append(new MenuItem({ label: 'Paste', accelerator: 'CmdOrCtrl+V', enabled: canPaste, click: () => resolve('paste') }))
    menu.append(new MenuItem({ type: 'separator' }))
    menu.append(new MenuItem({ label: 'Select All', accelerator: 'CmdOrCtrl+A', click: () => resolve('selectAll') }))
    menu.append(new MenuItem({ type: 'separator' }))
    menu.append(new MenuItem({ label: 'Undo', accelerator: 'CmdOrCtrl+Z', enabled: req.canUndo, click: () => resolve('undo') }))
    menu.append(new MenuItem({ label: 'Redo', accelerator: 'CmdOrCtrl+Shift+Z', enabled: req.canRedo, click: () => resolve('redo') }))
    menu.once('menu-will-close', () => resolve(null))
    const win = BrowserWindow.fromWebContents(sender as Parameters<typeof BrowserWindow.fromWebContents>[0])
    menu.popup({ window: win ?? undefined })
  })
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function req(overrides: Partial<EditorMenuRequest> = {}): EditorMenuRequest {
  return { hasSelection: false, canUndo: false, canRedo: false, ...overrides }
}

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
  // Re-bind methods on the new menuInstance after clearAllMocks resets vi.fn()s.
  // The Menu constructor delegates to menuInstance, so we re-mock it each run.
  ;(Menu as unknown as ReturnType<typeof vi.fn>).mockImplementation(function (this: Record<string, unknown>) {
    this.append = menuInstance.append
    this.once = menuInstance.once
    this.popup = menuInstance.popup
  })
  ;(MenuItem as unknown as ReturnType<typeof vi.fn>).mockImplementation(function (this: MenuItemOptions, opts: MenuItemOptions) {
    Object.assign(this, opts)
  })
  ;(clipboard.availableFormats as ReturnType<typeof vi.fn>).mockReturnValue([])
})

// ---------------------------------------------------------------------------
// 1. Template order
// ---------------------------------------------------------------------------

describe('editor:show-context-menu — template order', () => {
  it('appends 8 items total (6 labeled + 2 separators)', async () => {
    buildEditorMenu(null, req())
    expect(capturedItems).toHaveLength(8)
  })

  it('first item is Cut', async () => {
    buildEditorMenu(null, req())
    expect(capturedItems[0]).toMatchObject({ label: 'Cut' })
  })

  it('second item is Copy', async () => {
    buildEditorMenu(null, req())
    expect(capturedItems[1]).toMatchObject({ label: 'Copy' })
  })

  it('third item is Paste', async () => {
    buildEditorMenu(null, req())
    expect(capturedItems[2]).toMatchObject({ label: 'Paste' })
  })

  it('fourth item is a separator', async () => {
    buildEditorMenu(null, req())
    expect(capturedItems[3]).toMatchObject({ type: 'separator' })
  })

  it('fifth item is Select All', async () => {
    buildEditorMenu(null, req())
    expect(capturedItems[4]).toMatchObject({ label: 'Select All' })
  })

  it('sixth item is a separator', async () => {
    buildEditorMenu(null, req())
    expect(capturedItems[5]).toMatchObject({ type: 'separator' })
  })

  it('seventh item is Undo', async () => {
    buildEditorMenu(null, req())
    expect(capturedItems[6]).toMatchObject({ label: 'Undo' })
  })

  it('all items are appended in order', async () => {
    buildEditorMenu(null, req())
    const labels = capturedItems.map(i => i.label ?? '(separator)')
    expect(labels).toEqual(['Cut', 'Copy', 'Paste', '(separator)', 'Select All', '(separator)', 'Undo', 'Redo'])
  })
})

// Corrected: handler has 8 appends (Cut, Copy, Paste, sep, SelectAll, sep, Undo, Redo)
describe('editor:show-context-menu — full template (8 items)', () => {
  it('appends 8 items total', () => {
    buildEditorMenu(null, req())
    expect(capturedItems).toHaveLength(8)
  })

  it('eighth item is Redo', () => {
    buildEditorMenu(null, req())
    expect(capturedItems[7]).toMatchObject({ label: 'Redo' })
  })

  it('has exactly 2 separators', () => {
    buildEditorMenu(null, req())
    expect(separatorItems()).toHaveLength(2)
  })

  it('has exactly 6 labeled items', () => {
    buildEditorMenu(null, req())
    expect(labeledItems()).toHaveLength(6)
  })
})

// ---------------------------------------------------------------------------
// 2. enabled flags per request
// ---------------------------------------------------------------------------

describe('editor:show-context-menu — enabled flags', () => {
  it('Cut is disabled when hasSelection is false', () => {
    buildEditorMenu(null, req({ hasSelection: false }))
    expect(itemByLabel('Cut')?.enabled).toBe(false)
  })

  it('Cut is enabled when hasSelection is true', () => {
    buildEditorMenu(null, req({ hasSelection: true }))
    expect(itemByLabel('Cut')?.enabled).toBe(true)
  })

  it('Copy is disabled when hasSelection is false', () => {
    buildEditorMenu(null, req({ hasSelection: false }))
    expect(itemByLabel('Copy')?.enabled).toBe(false)
  })

  it('Copy is enabled when hasSelection is true', () => {
    buildEditorMenu(null, req({ hasSelection: true }))
    expect(itemByLabel('Copy')?.enabled).toBe(true)
  })

  it('Undo is disabled when canUndo is false', () => {
    buildEditorMenu(null, req({ canUndo: false }))
    expect(itemByLabel('Undo')?.enabled).toBe(false)
  })

  it('Undo is enabled when canUndo is true', () => {
    buildEditorMenu(null, req({ canUndo: true }))
    expect(itemByLabel('Undo')?.enabled).toBe(true)
  })

  it('Redo is disabled when canRedo is false', () => {
    buildEditorMenu(null, req({ canRedo: false }))
    expect(itemByLabel('Redo')?.enabled).toBe(false)
  })

  it('Redo is enabled when canRedo is true', () => {
    buildEditorMenu(null, req({ canRedo: true }))
    expect(itemByLabel('Redo')?.enabled).toBe(true)
  })

  it('Select All has no enabled flag (always enabled)', () => {
    buildEditorMenu(null, req())
    // Select All does not receive an `enabled` prop — so it defaults to true in Electron
    const item = itemByLabel('Select All')
    expect(item).toBeDefined()
    expect(item?.enabled).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// 3. canPaste comes from clipboard, not from request
// ---------------------------------------------------------------------------

describe('editor:show-context-menu — canPaste from clipboard', () => {
  it('Paste is disabled when clipboard has no text formats', () => {
    ;(clipboard.availableFormats as ReturnType<typeof vi.fn>).mockReturnValue(['image/png'])
    buildEditorMenu(null, req())
    expect(itemByLabel('Paste')?.enabled).toBe(false)
  })

  it('Paste is enabled when clipboard has text/plain', () => {
    ;(clipboard.availableFormats as ReturnType<typeof vi.fn>).mockReturnValue(['text/plain'])
    buildEditorMenu(null, req())
    expect(itemByLabel('Paste')?.enabled).toBe(true)
  })

  it('Paste is enabled when clipboard has text/html', () => {
    ;(clipboard.availableFormats as ReturnType<typeof vi.fn>).mockReturnValue(['text/html'])
    buildEditorMenu(null, req())
    expect(itemByLabel('Paste')?.enabled).toBe(true)
  })

  it('Paste is enabled when clipboard has bare "text" format', () => {
    ;(clipboard.availableFormats as ReturnType<typeof vi.fn>).mockReturnValue(['text'])
    buildEditorMenu(null, req())
    expect(itemByLabel('Paste')?.enabled).toBe(true)
  })

  it('Paste enabled is independent of hasSelection', () => {
    ;(clipboard.availableFormats as ReturnType<typeof vi.fn>).mockReturnValue(['text/plain'])
    buildEditorMenu(null, req({ hasSelection: false }))
    expect(itemByLabel('Paste')?.enabled).toBe(true)
  })

  it('clipboard.availableFormats is called once per invocation', () => {
    buildEditorMenu(null, req())
    expect(clipboard.availableFormats).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// 4. menu.popup is called with the BrowserWindow (or undefined)
// ---------------------------------------------------------------------------

describe('editor:show-context-menu — menu.popup', () => {
  it('calls menu.popup after building items', () => {
    buildEditorMenu(null, req())
    expect(menuInstance.popup).toHaveBeenCalledTimes(1)
  })

  it('passes { window: null } when BrowserWindow.fromWebContents returns null', () => {
    ;(BrowserWindow.fromWebContents as ReturnType<typeof vi.fn>).mockReturnValue(null)
    buildEditorMenu(null, req())
    expect(capturedPopupArg).toEqual({ window: undefined })
  })

  it('passes { window: win } when BrowserWindow.fromWebContents returns a window', () => {
    const fakeWin = { id: 1 }
    ;(BrowserWindow.fromWebContents as ReturnType<typeof vi.fn>).mockReturnValue(fakeWin)
    buildEditorMenu({} as Parameters<typeof BrowserWindow.fromWebContents>[0], req())
    expect(capturedPopupArg).toEqual({ window: fakeWin })
  })
})

// ---------------------------------------------------------------------------
// 5. Resolves to action when a menu item is clicked
// ---------------------------------------------------------------------------

describe('editor:show-context-menu — resolves to action on click', () => {
  it('resolves to "cut" when Cut item click is triggered', async () => {
    const promise = buildEditorMenu(null, req({ hasSelection: true }))
    const cutItem = itemByLabel('Cut')
    cutItem?.click?.()
    await expect(promise).resolves.toBe('cut')
  })

  it('resolves to "copy" when Copy item click is triggered', async () => {
    const promise = buildEditorMenu(null, req({ hasSelection: true }))
    itemByLabel('Copy')?.click?.()
    await expect(promise).resolves.toBe('copy')
  })

  it('resolves to "paste" when Paste item click is triggered', async () => {
    ;(clipboard.availableFormats as ReturnType<typeof vi.fn>).mockReturnValue(['text/plain'])
    const promise = buildEditorMenu(null, req())
    itemByLabel('Paste')?.click?.()
    await expect(promise).resolves.toBe('paste')
  })

  it('resolves to "selectAll" when Select All click is triggered', async () => {
    const promise = buildEditorMenu(null, req())
    itemByLabel('Select All')?.click?.()
    await expect(promise).resolves.toBe('selectAll')
  })

  it('resolves to "undo" when Undo click is triggered', async () => {
    const promise = buildEditorMenu(null, req({ canUndo: true }))
    itemByLabel('Undo')?.click?.()
    await expect(promise).resolves.toBe('undo')
  })

  it('resolves to "redo" when Redo click is triggered', async () => {
    const promise = buildEditorMenu(null, req({ canRedo: true }))
    itemByLabel('Redo')?.click?.()
    await expect(promise).resolves.toBe('redo')
  })
})

// ---------------------------------------------------------------------------
// 6. Resolves to null when menu is closed without selection
// ---------------------------------------------------------------------------

describe('editor:show-context-menu — resolves to null on menu-will-close', () => {
  it('registers a menu-will-close listener', () => {
    buildEditorMenu(null, req())
    expect(capturedOnce?.event).toBe('menu-will-close')
  })

  it('resolves to null when menu-will-close fires without a click', async () => {
    const promise = buildEditorMenu(null, req())
    capturedOnce?.handler()
    await expect(promise).resolves.toBeNull()
  })

  it('only resolves once — second resolve (from close after click) is ignored', async () => {
    const promise = buildEditorMenu(null, req({ hasSelection: true }))
    itemByLabel('Cut')?.click?.()
    capturedOnce?.handler()
    await expect(promise).resolves.toBe('cut')
  })
})
