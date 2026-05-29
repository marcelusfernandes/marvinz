import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: vi.fn(), on: vi.fn(), whenReady: vi.fn(() => ({ then: vi.fn() })) },
  BrowserWindow: vi.fn(),
  Menu: { buildFromTemplate: vi.fn(), setApplicationMenu: vi.fn() },
  MenuItem: vi.fn(),
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  protocol: { registerSchemesAsPrivileged: vi.fn(), handle: vi.fn() },
  dialog: {},
  shell: {},
  clipboard: {},
  WebContentsView: vi.fn(),
}))

import { buildMenuTemplate } from '../main.js'

// Flatten a top-level submenu by label
function submenu(
  template: Electron.MenuItemConstructorOptions[],
  label: string,
): Electron.MenuItemConstructorOptions[] {
  const entry = template.find((m) => m.label === label)
  return (entry?.submenu as Electron.MenuItemConstructorOptions[]) ?? []
}

// Invoke every ENABLED click in a freshly-built submenu — mirrors Electron,
// which never fires click handlers for disabled items.
function collectActions(menuLabel: string, hasNoteTab = true): string[] {
  const fired: string[] = []
  const t = buildMenuTemplate((a) => fired.push(a), hasNoteTab)
  const sub = submenu(t, menuLabel)
  for (const item of sub) {
    if (item.enabled === false) continue
    item.click?.(
      {} as Electron.MenuItem,
      {} as Electron.BrowserWindow,
      {} as Electron.KeyboardEvent,
    )
  }
  return fired
}

// ---------------------------------------------------------------------------
// 1. Top-level structure
// ---------------------------------------------------------------------------

describe('buildMenuTemplate — top-level menus', () => {
  it('returns 5 top-level menus', () => {
    const t = buildMenuTemplate(() => {})
    expect(t).toHaveLength(5)
  })

  it('has labels Marvinz / File / Edit / View / Window in order', () => {
    const t = buildMenuTemplate(() => {})
    expect(t.map((m) => m.label)).toEqual(['Marvinz', 'File', 'Edit', 'View', 'Window'])
  })
})

// ---------------------------------------------------------------------------
// 2. Edit menu — pure roles (CRITICAL: must not be missing or copy/paste breaks)
// ---------------------------------------------------------------------------

describe('buildMenuTemplate — Edit roles', () => {
  it('contains undo role', () => {
    const items = submenu(buildMenuTemplate(() => {}), 'Edit')
    expect(items.some((i) => i.role === 'undo')).toBe(true)
  })

  it('contains redo role', () => {
    const items = submenu(buildMenuTemplate(() => {}), 'Edit')
    expect(items.some((i) => i.role === 'redo')).toBe(true)
  })

  it('contains cut role', () => {
    const items = submenu(buildMenuTemplate(() => {}), 'Edit')
    expect(items.some((i) => i.role === 'cut')).toBe(true)
  })

  it('contains copy role', () => {
    const items = submenu(buildMenuTemplate(() => {}), 'Edit')
    expect(items.some((i) => i.role === 'copy')).toBe(true)
  })

  it('contains paste role', () => {
    const items = submenu(buildMenuTemplate(() => {}), 'Edit')
    expect(items.some((i) => i.role === 'paste')).toBe(true)
  })

  it('contains selectAll role', () => {
    const items = submenu(buildMenuTemplate(() => {}), 'Edit')
    expect(items.some((i) => i.role === 'selectAll')).toBe(true)
  })

  it('has no click handlers (roles only — no bridge)', () => {
    const items = submenu(buildMenuTemplate(() => {}), 'Edit')
    const withClick = items.filter((i) => typeof i.click === 'function')
    expect(withClick).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 3. File menu — emits exactly the 7 expected actions
// ---------------------------------------------------------------------------

describe('buildMenuTemplate — File menu actions', () => {
  const EXPECTED_FILE_ACTIONS = [
    'new-note',
    'open-vault',
    'export-pdf',
    'reveal',
    'save',
    'new-agent-terminal',
    'command-palette',
  ]

  it('emits all 7 File actions when a note tab is active (all enabled)', () => {
    const fired = collectActions('File', true)
    expect(fired.sort()).toEqual(EXPECTED_FILE_ACTIONS.sort())
  })

  it('does not fire Export PDF / Reveal in Finder when no note tab is active', () => {
    const fired = collectActions('File', false)
    expect(fired).not.toContain('export-pdf')
    expect(fired).not.toContain('reveal')
    // The note-independent actions still fire.
    expect(fired).toContain('new-note')
    expect(fired).toContain('open-vault')
  })

  it('emits new-note on New Note click', () => {
    const fired: string[] = []
    const t = buildMenuTemplate((a) => fired.push(a))
    const item = submenu(t, 'File').find((i) => i.label === 'New Note')
    item?.click?.({} as Electron.MenuItem, {} as Electron.BrowserWindow, {} as Electron.KeyboardEvent)
    expect(fired).toContain('new-note')
  })

  it('emits save on Save click', () => {
    const fired: string[] = []
    const t = buildMenuTemplate((a) => fired.push(a))
    const item = submenu(t, 'File').find((i) => i.label === 'Save')
    item?.click?.({} as Electron.MenuItem, {} as Electron.BrowserWindow, {} as Electron.KeyboardEvent)
    expect(fired).toContain('save')
  })

  it('emits new-agent-terminal on New Agent Terminal click', () => {
    const fired: string[] = []
    const t = buildMenuTemplate((a) => fired.push(a))
    const item = submenu(t, 'File').find((i) => i.label === 'New Agent Terminal')
    item?.click?.({} as Electron.MenuItem, {} as Electron.BrowserWindow, {} as Electron.KeyboardEvent)
    expect(fired).toContain('new-agent-terminal')
  })

  it('emits command-palette on Command Palette click', () => {
    const fired: string[] = []
    const t = buildMenuTemplate((a) => fired.push(a))
    const item = submenu(t, 'File').find((i) => i.label === 'Command Palette')
    item?.click?.({} as Electron.MenuItem, {} as Electron.BrowserWindow, {} as Electron.KeyboardEvent)
    expect(fired).toContain('command-palette')
  })

  it('enables Export PDF and Reveal in Finder only when a note tab is active', () => {
    const withNote = submenu(buildMenuTemplate(() => {}, true), 'File')
    const noNote = submenu(buildMenuTemplate(() => {}, false), 'File')
    const find = (items: Electron.MenuItemConstructorOptions[], label: string) =>
      items.find((i) => i.label === label)
    expect(find(withNote, 'Export PDF')?.enabled).toBe(true)
    expect(find(withNote, 'Reveal in Finder')?.enabled).toBe(true)
    expect(find(noNote, 'Export PDF')?.enabled).toBe(false)
    expect(find(noNote, 'Reveal in Finder')?.enabled).toBe(false)
  })

  it('keeps note-independent items enabled regardless of note context', () => {
    const noNote = submenu(buildMenuTemplate(() => {}, false), 'File')
    const newNote = noNote.find((i) => i.label === 'New Note')
    // New Note / Open Folder don't depend on an active note — must stay enabled.
    expect(newNote?.enabled).not.toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 4. Marvinz menu — settings action + pure roles
// ---------------------------------------------------------------------------

describe('buildMenuTemplate — Marvinz menu', () => {
  it('emits settings on Settings… click', () => {
    const fired: string[] = []
    const t = buildMenuTemplate((a) => fired.push(a))
    const item = submenu(t, 'Marvinz').find((i) => i.label === 'Settings…')
    item?.click?.({} as Electron.MenuItem, {} as Electron.BrowserWindow, {} as Electron.KeyboardEvent)
    expect(fired).toEqual(['settings'])
  })

  it('contains about role', () => {
    const items = submenu(buildMenuTemplate(() => {}), 'Marvinz')
    expect(items.some((i) => i.role === 'about')).toBe(true)
  })

  it('contains hide role', () => {
    const items = submenu(buildMenuTemplate(() => {}), 'Marvinz')
    expect(items.some((i) => i.role === 'hide')).toBe(true)
  })

  it('contains quit role', () => {
    const items = submenu(buildMenuTemplate(() => {}), 'Marvinz')
    expect(items.some((i) => i.role === 'quit')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 5. View menu — find action + pure roles
// ---------------------------------------------------------------------------

describe('buildMenuTemplate — View menu', () => {
  it('emits find on Find click', () => {
    const fired: string[] = []
    const t = buildMenuTemplate((a) => fired.push(a))
    const item = submenu(t, 'View').find((i) => i.label === 'Find')
    item?.click?.({} as Electron.MenuItem, {} as Electron.BrowserWindow, {} as Electron.KeyboardEvent)
    expect(fired).toEqual(['find'])
  })

  it('contains reload role', () => {
    const items = submenu(buildMenuTemplate(() => {}), 'View')
    expect(items.some((i) => i.role === 'reload')).toBe(true)
  })

  it('contains toggleDevTools role', () => {
    const items = submenu(buildMenuTemplate(() => {}), 'View')
    expect(items.some((i) => i.role === 'toggleDevTools')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 6. Window menu — pure roles only
// ---------------------------------------------------------------------------

describe('buildMenuTemplate — Window menu', () => {
  it('contains minimize role', () => {
    const items = submenu(buildMenuTemplate(() => {}), 'Window')
    expect(items.some((i) => i.role === 'minimize')).toBe(true)
  })

  it('contains zoom role', () => {
    const items = submenu(buildMenuTemplate(() => {}), 'Window')
    expect(items.some((i) => i.role === 'zoom')).toBe(true)
  })

  it('contains close role', () => {
    const items = submenu(buildMenuTemplate(() => {}), 'Window')
    expect(items.some((i) => i.role === 'close')).toBe(true)
  })

  it('has no click handlers (roles only)', () => {
    const items = submenu(buildMenuTemplate(() => {}), 'Window')
    expect(items.filter((i) => typeof i.click === 'function')).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 7. Accelerators match renderer keydown shortcuts
// ---------------------------------------------------------------------------

describe('buildMenuTemplate — accelerators', () => {
  it('New Note has accelerator Cmd+N', () => {
    const item = submenu(buildMenuTemplate(() => {}), 'File').find((i) => i.label === 'New Note')
    expect(item?.accelerator).toBe('Cmd+N')
  })

  it('Save has accelerator Cmd+S', () => {
    const item = submenu(buildMenuTemplate(() => {}), 'File').find((i) => i.label === 'Save')
    expect(item?.accelerator).toBe('Cmd+S')
  })

  it('New Agent Terminal has accelerator Cmd+Shift+T', () => {
    const item = submenu(buildMenuTemplate(() => {}), 'File').find((i) => i.label === 'New Agent Terminal')
    expect(item?.accelerator).toBe('Cmd+Shift+T')
  })

  it('Command Palette has accelerator Cmd+P', () => {
    const item = submenu(buildMenuTemplate(() => {}), 'File').find((i) => i.label === 'Command Palette')
    expect(item?.accelerator).toBe('Cmd+P')
  })

  it('Settings has accelerator Cmd+,', () => {
    const item = submenu(buildMenuTemplate(() => {}), 'Marvinz').find((i) => i.label === 'Settings…')
    expect(item?.accelerator).toBe('Cmd+,')
  })

  it('Find has accelerator Cmd+F', () => {
    const item = submenu(buildMenuTemplate(() => {}), 'View').find((i) => i.label === 'Find')
    expect(item?.accelerator).toBe('Cmd+F')
  })
})

// ---------------------------------------------------------------------------
// 8. send callback is called with correct action string (isolation check)
// ---------------------------------------------------------------------------

describe('buildMenuTemplate — send callback isolation', () => {
  it('calls send with the action string, not a different string', () => {
    const received: string[] = []
    const t = buildMenuTemplate((a) => received.push(a))
    const item = submenu(t, 'File').find((i) => i.label === 'Export PDF')
    item?.click?.({} as Electron.MenuItem, {} as Electron.BrowserWindow, {} as Electron.KeyboardEvent)
    expect(received).toEqual(['export-pdf'])
  })

  it('each click fires send exactly once', () => {
    let count = 0
    const t = buildMenuTemplate(() => count++)
    const item = submenu(t, 'File').find((i) => i.label === 'Reveal in Finder')
    item?.click?.({} as Electron.MenuItem, {} as Electron.BrowserWindow, {} as Electron.KeyboardEvent)
    expect(count).toBe(1)
  })
})
