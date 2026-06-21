/**
 * Tests for the Properties type picker context menu after migration to app:show-context-menu IPC.
 * Issue #174: native context menus for File Tree and Properties.
 *
 * Strategy:
 *  - Render Properties with an empty frontmatter, open the AddPropertyRow.
 *  - Click the type-picker button.
 *  - Assert window.marvin.app.showContextMenu is called with the correct MenuItemSpec[].
 *  - Assert the returned action id (which equals the PropertyType) sets the correct type.
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, act, screen } from '@testing-library/react'

// ---------------------------------------------------------------------------
// Mock Icon so Properties renders without the real icon font
// ---------------------------------------------------------------------------

vi.mock('../Icon', () => ({
  Icon: ({ name }: { name: string }) => <span data-icon={name} />,
}))

// ---------------------------------------------------------------------------
// window.marvin mock
// ---------------------------------------------------------------------------

type MenuItemSpec =
  | { kind: 'item'; id: string; label: string; enabled?: boolean }
  | { kind: 'separator' }

let showContextMenuMock: ReturnType<typeof vi.fn>

function setupMarvinMock() {
  showContextMenuMock = vi.fn()
  Object.defineProperty(globalThis, 'window', {
    value: {
      ...(typeof window !== 'undefined' ? window : {}),
      marvin: {
        app: {
          showContextMenu: showContextMenuMock,
        },
      },
    },
    writable: true,
    configurable: true,
  })
}

// ---------------------------------------------------------------------------
// Import Properties after mocks
// ---------------------------------------------------------------------------

import { Properties } from '../Properties'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderProperties() {
  const onChange = vi.fn()
  render(<Properties data={{}} onChange={onChange} />)
  return onChange
}

async function openAddRow() {
  const addBtn = screen.getByRole('button', { name: /add property/i })
  await act(async () => {
    fireEvent.click(addBtn)
  })
}

async function clickTypePicker() {
  // The type picker button has title="Property type"
  const picker = screen.getByTitle('Property type')
  await act(async () => {
    fireEvent.click(picker)
  })
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
// IPC payload
// ---------------------------------------------------------------------------

describe('Properties type picker — context menu IPC payload', () => {
  it('calls showContextMenu when the type picker button is clicked', async () => {
    showContextMenuMock.mockResolvedValue(null)
    renderProperties()
    await openAddRow()
    await clickTypePicker()
    expect(showContextMenuMock).toHaveBeenCalledTimes(1)
    const [items] = showContextMenuMock.mock.calls[0] as [MenuItemSpec[]]
    expect(Array.isArray(items)).toBe(true)
    expect(items.length).toBeGreaterThan(0)
  })

  it('includes all six property types in the menu', async () => {
    showContextMenuMock.mockResolvedValue(null)
    renderProperties()
    await openAddRow()
    await clickTypePicker()
    const [items] = showContextMenuMock.mock.calls[0] as [MenuItemSpec[]]
    const labels = items
      .filter((i) => i.kind === 'item')
      .map((i) => (i as Extract<MenuItemSpec, { kind: 'item' }>).label)
    expect(labels).toContain('Text')
    expect(labels).toContain('Number')
    expect(labels).toContain('Checkbox')
    expect(labels).toContain('Date')
    expect(labels).toContain('Tags')
    expect(labels).toContain('List')
  })

  it('uses the PropertyType as the item id', async () => {
    showContextMenuMock.mockResolvedValue(null)
    renderProperties()
    await openAddRow()
    await clickTypePicker()
    const [items] = showContextMenuMock.mock.calls[0] as [MenuItemSpec[]]
    const byId = Object.fromEntries(
      items
        .filter((i) => i.kind === 'item')
        .map((i) => [(i as Extract<MenuItemSpec, { kind: 'item' }>).id, true])
    )
    expect(byId['string']).toBe(true)
    expect(byId['number']).toBe(true)
    expect(byId['boolean']).toBe(true)
    expect(byId['date']).toBe(true)
    expect(byId['tags']).toBe(true)
    expect(byId['list']).toBe(true)
  })

  it('current type (string) is disabled in the menu when it is already selected', async () => {
    showContextMenuMock.mockResolvedValue(null)
    renderProperties()
    await openAddRow()
    await clickTypePicker()
    const [items] = showContextMenuMock.mock.calls[0] as [MenuItemSpec[]]
    // Default type is 'string', so 'string' item should have enabled: false
    const stringItem = items.find(
      (i) => i.kind === 'item' && (i as Extract<MenuItemSpec, { kind: 'item' }>).id === 'string'
    ) as Extract<MenuItemSpec, { kind: 'item' }> | undefined
    expect(stringItem?.enabled).toBe(false)
  })

  it('non-current types are enabled in the menu', async () => {
    showContextMenuMock.mockResolvedValue(null)
    renderProperties()
    await openAddRow()
    await clickTypePicker()
    const [items] = showContextMenuMock.mock.calls[0] as [MenuItemSpec[]]
    const numberItem = items.find(
      (i) => i.kind === 'item' && (i as Extract<MenuItemSpec, { kind: 'item' }>).id === 'number'
    ) as Extract<MenuItemSpec, { kind: 'item' }> | undefined
    expect(numberItem?.enabled).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Action dispatch
// ---------------------------------------------------------------------------

describe('Properties type picker — action dispatch', () => {
  it('selecting "number" id updates picker button to show symbol-numeric icon', async () => {
    showContextMenuMock.mockResolvedValue('number')
    renderProperties()
    await openAddRow()
    await clickTypePicker()
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
    const picker = screen.getByTitle('Property type')
    expect(picker.querySelector('[data-icon="symbol-numeric"]')).not.toBeNull()
  })

  it('selecting "tags" id updates picker button to show tag icon', async () => {
    showContextMenuMock.mockResolvedValue('tags')
    renderProperties()
    await openAddRow()
    await clickTypePicker()
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
    const picker = screen.getByTitle('Property type')
    expect(picker.querySelector('[data-icon="tag"]')).not.toBeNull()
  })

  it('selecting "date" id updates picker button to show calendar icon', async () => {
    showContextMenuMock.mockResolvedValue('date')
    renderProperties()
    await openAddRow()
    await clickTypePicker()
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
    const picker = screen.getByTitle('Property type')
    expect(picker.querySelector('[data-icon="calendar"]')).not.toBeNull()
  })

  it('null action keeps the default type (string/Text)', async () => {
    showContextMenuMock.mockResolvedValue(null)
    renderProperties()
    await openAddRow()
    await clickTypePicker()
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
    const picker = screen.getByTitle('Property type')
    expect(picker.querySelector('[data-icon="symbol-string"]')).not.toBeNull()
  })

  it('selecting "boolean" id updates picker button to show symbol-boolean icon', async () => {
    showContextMenuMock.mockResolvedValue('boolean')
    renderProperties()
    await openAddRow()
    await clickTypePicker()
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
    const picker = screen.getByTitle('Property type')
    expect(picker.querySelector('[data-icon="symbol-boolean"]')).not.toBeNull()
  })
})
