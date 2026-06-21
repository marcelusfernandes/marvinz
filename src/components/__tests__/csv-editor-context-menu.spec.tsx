/**
 * Tests for the CsvEditor native context menu (issue #182).
 *
 * Strategy:
 *  - Mock react-data-grid's DataGrid to render row gutters and column headers
 *    directly, calling each column's renderCell / renderHeaderCell so the DOM
 *    elements that carry the context-menu / click handlers are reachable.
 *  - Right-click a row gutter or column header and assert
 *    window.marvin.app.showContextMenu is called with the expected MenuItemSpec[]
 *    in order.
 *  - Mock the IPC response to each action id and assert the correct handler
 *    is invoked (onChange receives the updated CSV, row/column count changes).
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, act } from '@testing-library/react'
import type { Column } from 'react-data-grid'

// ---------------------------------------------------------------------------
// Mock Icon so CsvEditor renders without the real icon font
// ---------------------------------------------------------------------------

vi.mock('../Icon', () => ({
  Icon: () => null,
}))

// ---------------------------------------------------------------------------
// Mock react-data-grid — render gutters + headers directly so handlers work
// ---------------------------------------------------------------------------

type RowData = Record<string, string> & { __id: string }

vi.mock('react-data-grid', () => ({
  DataGrid: ({
    columns,
    rows,
  }: {
    columns: Column<RowData>[]
    rows: RowData[]
    [key: string]: unknown
  }) => (
    <div data-testid="data-grid">
      <div data-testid="headers">
        {columns.map((col) =>
          col.renderHeaderCell ? (
            <div key={col.key} data-testid={`header-${col.key}`}>
              {col.renderHeaderCell({ column: col } as never)}
            </div>
          ) : null
        )}
      </div>
      <div data-testid="rows">
        {rows.map((row, rowIdx) => (
          <div key={row.__id} data-testid={`row-${row.__id}`}>
            {columns.map((col) =>
              col.renderCell ? (
                <div key={col.key} data-testid={`cell-${col.key}-${row.__id}`}>
                  {col.renderCell({ row, rowIdx, column: col } as never)}
                </div>
              ) : null
            )}
          </div>
        ))}
      </div>
    </div>
  ),
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
// Import component after mocks
// ---------------------------------------------------------------------------

import { CsvEditor } from '../CsvEditor'

// ---------------------------------------------------------------------------
// Test CSV content
// ---------------------------------------------------------------------------

const CSV_TWO_ROWS = 'name,age\nAlice,30\nBob,25\n'

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

function renderCsv(content = CSV_TWO_ROWS) {
  const onChange = vi.fn()
  const utils = render(
    <CsvEditor filePath="/vault/data.csv" initialContent={content} onChange={onChange} />
  )
  return { ...utils, onChange }
}

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

function getRowGutter(container: HTMLElement, rowIndex = 0): HTMLElement {
  const gutters = container.querySelectorAll('.csv-row-gutter-inner')
  if (!gutters[rowIndex]) throw new Error(`No row gutter at index ${rowIndex}`)
  return gutters[rowIndex] as HTMLElement
}

function getRowKebab(container: HTMLElement, rowIndex = 0): HTMLElement {
  const buttons = container.querySelectorAll('.csv-row-menu')
  if (!buttons[rowIndex]) throw new Error(`No row kebab at index ${rowIndex}`)
  return buttons[rowIndex] as HTMLElement
}

function getColumnHeader(container: HTMLElement, colIndex = 0): HTMLElement {
  // colIndex 0 = first data column (gutter header renders null, so it is skipped)
  const headers = container.querySelectorAll('.csv-header-cell')
  if (!headers[colIndex]) throw new Error(`No column header at index ${colIndex}`)
  return headers[colIndex] as HTMLElement
}

function getColumnKebab(container: HTMLElement, colIndex = 0): HTMLElement {
  const buttons = container.querySelectorAll('.csv-header-menu')
  if (!buttons[colIndex]) throw new Error(`No column kebab at index ${colIndex}`)
  return buttons[colIndex] as HTMLElement
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

// ===========================================================================
// ROW CONTEXT MENU — IPC payload
// ===========================================================================

describe('CsvEditor row — context menu IPC payload (right-click)', () => {
  it('calls showContextMenu once when right-clicking the row gutter', async () => {
    const { container } = renderCsv()
    await act(async () => {
      fireEvent.contextMenu(getRowGutter(container))
      await new Promise((r) => setTimeout(r, 10))
    })
    expect(showContextMenuMock).toHaveBeenCalledTimes(1)
  })

  it('sends items array as first argument', async () => {
    const { container } = renderCsv()
    await act(async () => {
      fireEvent.contextMenu(getRowGutter(container))
      await new Promise((r) => setTimeout(r, 10))
    })
    const [items] = showContextMenuMock.mock.calls[0] as [MenuItemSpec[]]
    expect(Array.isArray(items)).toBe(true)
  })

  it('first item is Insert Row Above with id "insertAbove"', async () => {
    const { container } = renderCsv()
    await act(async () => {
      fireEvent.contextMenu(getRowGutter(container))
      await new Promise((r) => setTimeout(r, 10))
    })
    const [items] = showContextMenuMock.mock.calls[0] as [MenuItemSpec[]]
    const first = items[0] as Extract<MenuItemSpec, { kind: 'item' }>
    expect(first.kind).toBe('item')
    expect(first.id).toBe('insertAbove')
  })

  it('second item is Insert Row Below with id "insertBelow"', async () => {
    const { container } = renderCsv()
    await act(async () => {
      fireEvent.contextMenu(getRowGutter(container))
      await new Promise((r) => setTimeout(r, 10))
    })
    const [items] = showContextMenuMock.mock.calls[0] as [MenuItemSpec[]]
    const second = items[1] as Extract<MenuItemSpec, { kind: 'item' }>
    expect(second.kind).toBe('item')
    expect(second.id).toBe('insertBelow')
  })

  it('third item is a separator', async () => {
    const { container } = renderCsv()
    await act(async () => {
      fireEvent.contextMenu(getRowGutter(container))
      await new Promise((r) => setTimeout(r, 10))
    })
    const [items] = showContextMenuMock.mock.calls[0] as [MenuItemSpec[]]
    expect(items[2].kind).toBe('separator')
  })

  it('fourth item is Delete Row with id "delete"', async () => {
    const { container } = renderCsv()
    await act(async () => {
      fireEvent.contextMenu(getRowGutter(container))
      await new Promise((r) => setTimeout(r, 10))
    })
    const [items] = showContextMenuMock.mock.calls[0] as [MenuItemSpec[]]
    const fourth = items[3] as Extract<MenuItemSpec, { kind: 'item' }>
    expect(fourth.kind).toBe('item')
    expect(fourth.id).toBe('delete')
  })

  it('menu has exactly 4 items', async () => {
    const { container } = renderCsv()
    await act(async () => {
      fireEvent.contextMenu(getRowGutter(container))
      await new Promise((r) => setTimeout(r, 10))
    })
    const [items] = showContextMenuMock.mock.calls[0] as [MenuItemSpec[]]
    expect(items).toHaveLength(4)
  })
})

// ===========================================================================
// ROW CONTEXT MENU — kebab button also triggers IPC
// ===========================================================================

describe('CsvEditor row — kebab button triggers same IPC', () => {
  it('calls showContextMenu once when clicking the row kebab button', async () => {
    const { container } = renderCsv()
    await act(async () => {
      fireEvent.click(getRowKebab(container))
      await new Promise((r) => setTimeout(r, 10))
    })
    expect(showContextMenuMock).toHaveBeenCalledTimes(1)
  })

  it('sends the same 4-item row menu when using the kebab button', async () => {
    const { container } = renderCsv()
    await act(async () => {
      fireEvent.click(getRowKebab(container))
      await new Promise((r) => setTimeout(r, 10))
    })
    const [items] = showContextMenuMock.mock.calls[0] as [MenuItemSpec[]]
    expect(items).toHaveLength(4)
    expect((items[0] as Extract<MenuItemSpec, { kind: 'item' }>).id).toBe('insertAbove')
    expect((items[3] as Extract<MenuItemSpec, { kind: 'item' }>).id).toBe('delete')
  })
})

// ===========================================================================
// ROW CONTEXT MENU — action dispatch
// ===========================================================================

describe('CsvEditor row — action dispatch: insertAbove', () => {
  it('inserts a row above and calls onChange with one extra row', async () => {
    const { container, onChange } = renderCsv()
    showContextMenuMock.mockResolvedValue('insertAbove')
    await act(async () => {
      fireEvent.contextMenu(getRowGutter(container, 0))
      await new Promise((r) => setTimeout(r, 30))
    })
    expect(onChange).toHaveBeenCalled()
    const csv: string = onChange.mock.calls[onChange.mock.calls.length - 1][0]
    const dataRows = csv.trim().split('\n').slice(1)
    expect(dataRows).toHaveLength(3)
  })
})

describe('CsvEditor row — action dispatch: insertBelow', () => {
  it('inserts a row below and calls onChange with one extra row', async () => {
    const { container, onChange } = renderCsv()
    showContextMenuMock.mockResolvedValue('insertBelow')
    await act(async () => {
      fireEvent.contextMenu(getRowGutter(container, 0))
      await new Promise((r) => setTimeout(r, 30))
    })
    expect(onChange).toHaveBeenCalled()
    const csv: string = onChange.mock.calls[onChange.mock.calls.length - 1][0]
    const dataRows = csv.trim().split('\n').slice(1)
    expect(dataRows).toHaveLength(3)
  })
})

describe('CsvEditor row — action dispatch: delete', () => {
  it('removes the row and calls onChange with one fewer row', async () => {
    const { container, onChange } = renderCsv()
    showContextMenuMock.mockResolvedValue('delete')
    await act(async () => {
      fireEvent.contextMenu(getRowGutter(container, 0))
      await new Promise((r) => setTimeout(r, 30))
    })
    expect(onChange).toHaveBeenCalled()
    const csv: string = onChange.mock.calls[onChange.mock.calls.length - 1][0]
    const dataRows = csv.trim().split('\n').slice(1)
    expect(dataRows).toHaveLength(1)
  })
})

describe('CsvEditor row — null action', () => {
  it('does not call onChange when showContextMenu resolves null', async () => {
    const { container, onChange } = renderCsv()
    showContextMenuMock.mockResolvedValue(null)
    await act(async () => {
      fireEvent.contextMenu(getRowGutter(container, 0))
      await new Promise((r) => setTimeout(r, 30))
    })
    expect(onChange).not.toHaveBeenCalled()
  })
})

// ===========================================================================
// COLUMN CONTEXT MENU — IPC payload
// ===========================================================================

describe('CsvEditor column — context menu IPC payload (right-click)', () => {
  it('calls showContextMenu once when right-clicking a column header', async () => {
    const { container } = renderCsv()
    await act(async () => {
      fireEvent.contextMenu(getColumnHeader(container))
      await new Promise((r) => setTimeout(r, 10))
    })
    expect(showContextMenuMock).toHaveBeenCalledTimes(1)
  })

  it('sends items array as first argument', async () => {
    const { container } = renderCsv()
    await act(async () => {
      fireEvent.contextMenu(getColumnHeader(container))
      await new Promise((r) => setTimeout(r, 10))
    })
    const [items] = showContextMenuMock.mock.calls[0] as [MenuItemSpec[]]
    expect(Array.isArray(items)).toBe(true)
  })

  it('first item is Insert Left with id "insertLeft"', async () => {
    const { container } = renderCsv()
    await act(async () => {
      fireEvent.contextMenu(getColumnHeader(container))
      await new Promise((r) => setTimeout(r, 10))
    })
    const [items] = showContextMenuMock.mock.calls[0] as [MenuItemSpec[]]
    const first = items[0] as Extract<MenuItemSpec, { kind: 'item' }>
    expect(first.kind).toBe('item')
    expect(first.id).toBe('insertLeft')
  })

  it('second item is Insert Right with id "insertRight"', async () => {
    const { container } = renderCsv()
    await act(async () => {
      fireEvent.contextMenu(getColumnHeader(container))
      await new Promise((r) => setTimeout(r, 10))
    })
    const [items] = showContextMenuMock.mock.calls[0] as [MenuItemSpec[]]
    const second = items[1] as Extract<MenuItemSpec, { kind: 'item' }>
    expect(second.kind).toBe('item')
    expect(second.id).toBe('insertRight')
  })

  it('third item is a separator', async () => {
    const { container } = renderCsv()
    await act(async () => {
      fireEvent.contextMenu(getColumnHeader(container))
      await new Promise((r) => setTimeout(r, 10))
    })
    const [items] = showContextMenuMock.mock.calls[0] as [MenuItemSpec[]]
    expect(items[2].kind).toBe('separator')
  })

  it('fourth item is Sort Ascending with id "sortAsc"', async () => {
    const { container } = renderCsv()
    await act(async () => {
      fireEvent.contextMenu(getColumnHeader(container))
      await new Promise((r) => setTimeout(r, 10))
    })
    const [items] = showContextMenuMock.mock.calls[0] as [MenuItemSpec[]]
    const fourth = items[3] as Extract<MenuItemSpec, { kind: 'item' }>
    expect(fourth.kind).toBe('item')
    expect(fourth.id).toBe('sortAsc')
  })

  it('fifth item is Sort Descending with id "sortDesc"', async () => {
    const { container } = renderCsv()
    await act(async () => {
      fireEvent.contextMenu(getColumnHeader(container))
      await new Promise((r) => setTimeout(r, 10))
    })
    const [items] = showContextMenuMock.mock.calls[0] as [MenuItemSpec[]]
    const fifth = items[4] as Extract<MenuItemSpec, { kind: 'item' }>
    expect(fifth.kind).toBe('item')
    expect(fifth.id).toBe('sortDesc')
  })

  it('sixth item is a separator', async () => {
    const { container } = renderCsv()
    await act(async () => {
      fireEvent.contextMenu(getColumnHeader(container))
      await new Promise((r) => setTimeout(r, 10))
    })
    const [items] = showContextMenuMock.mock.calls[0] as [MenuItemSpec[]]
    expect(items[5].kind).toBe('separator')
  })

  it('seventh item is Delete Column with id "delete"', async () => {
    const { container } = renderCsv()
    await act(async () => {
      fireEvent.contextMenu(getColumnHeader(container))
      await new Promise((r) => setTimeout(r, 10))
    })
    const [items] = showContextMenuMock.mock.calls[0] as [MenuItemSpec[]]
    const seventh = items[6] as Extract<MenuItemSpec, { kind: 'item' }>
    expect(seventh.kind).toBe('item')
    expect(seventh.id).toBe('delete')
  })

  it('menu has exactly 7 items', async () => {
    const { container } = renderCsv()
    await act(async () => {
      fireEvent.contextMenu(getColumnHeader(container))
      await new Promise((r) => setTimeout(r, 10))
    })
    const [items] = showContextMenuMock.mock.calls[0] as [MenuItemSpec[]]
    expect(items).toHaveLength(7)
  })
})

// ===========================================================================
// COLUMN CONTEXT MENU — kebab button also triggers IPC
// ===========================================================================

describe('CsvEditor column — kebab button triggers same IPC', () => {
  it('calls showContextMenu once when clicking the column kebab button', async () => {
    const { container } = renderCsv()
    await act(async () => {
      fireEvent.click(getColumnKebab(container))
      await new Promise((r) => setTimeout(r, 10))
    })
    expect(showContextMenuMock).toHaveBeenCalledTimes(1)
  })

  it('sends the same 7-item column menu when using the kebab button', async () => {
    const { container } = renderCsv()
    await act(async () => {
      fireEvent.click(getColumnKebab(container))
      await new Promise((r) => setTimeout(r, 10))
    })
    const [items] = showContextMenuMock.mock.calls[0] as [MenuItemSpec[]]
    expect(items).toHaveLength(7)
    expect((items[0] as Extract<MenuItemSpec, { kind: 'item' }>).id).toBe('insertLeft')
    expect((items[6] as Extract<MenuItemSpec, { kind: 'item' }>).id).toBe('delete')
  })
})

// ===========================================================================
// COLUMN CONTEXT MENU — action dispatch
// ===========================================================================

describe('CsvEditor column — action dispatch: insertLeft', () => {
  it('inserts a column to the left and calls onChange with one extra column', async () => {
    const { container, onChange } = renderCsv()
    showContextMenuMock.mockResolvedValue('insertLeft')
    await act(async () => {
      fireEvent.contextMenu(getColumnHeader(container, 0))
      await new Promise((r) => setTimeout(r, 30))
    })
    expect(onChange).toHaveBeenCalled()
    const csv: string = onChange.mock.calls[onChange.mock.calls.length - 1][0]
    const headerCols = csv.split('\n')[0].split(',')
    expect(headerCols).toHaveLength(3)
  })
})

describe('CsvEditor column — action dispatch: insertRight', () => {
  it('inserts a column to the right and calls onChange with one extra column', async () => {
    const { container, onChange } = renderCsv()
    showContextMenuMock.mockResolvedValue('insertRight')
    await act(async () => {
      fireEvent.contextMenu(getColumnHeader(container, 0))
      await new Promise((r) => setTimeout(r, 30))
    })
    expect(onChange).toHaveBeenCalled()
    const csv: string = onChange.mock.calls[onChange.mock.calls.length - 1][0]
    const headerCols = csv.split('\n')[0].split(',')
    expect(headerCols).toHaveLength(3)
  })
})

describe('CsvEditor column — action dispatch: sortAsc', () => {
  it('sorts rows ascending by the column and calls onChange', async () => {
    const { container, onChange } = renderCsv('name,age\nBob,25\nAlice,30\n')
    showContextMenuMock.mockResolvedValue('sortAsc')
    await act(async () => {
      fireEvent.contextMenu(getColumnHeader(container, 0))
      await new Promise((r) => setTimeout(r, 30))
    })
    expect(onChange).toHaveBeenCalled()
    const csv: string = onChange.mock.calls[onChange.mock.calls.length - 1][0]
    const rows = csv.trim().split('\n').slice(1)
    expect(rows[0]).toMatch(/^Alice/)
    expect(rows[1]).toMatch(/^Bob/)
  })
})

describe('CsvEditor column — action dispatch: sortDesc', () => {
  it('sorts rows descending by the column and calls onChange', async () => {
    const { container, onChange } = renderCsv('name,age\nAlice,30\nBob,25\n')
    showContextMenuMock.mockResolvedValue('sortDesc')
    await act(async () => {
      fireEvent.contextMenu(getColumnHeader(container, 0))
      await new Promise((r) => setTimeout(r, 30))
    })
    expect(onChange).toHaveBeenCalled()
    const csv: string = onChange.mock.calls[onChange.mock.calls.length - 1][0]
    const rows = csv.trim().split('\n').slice(1)
    expect(rows[0]).toMatch(/^Bob/)
    expect(rows[1]).toMatch(/^Alice/)
  })
})

describe('CsvEditor column — action dispatch: delete', () => {
  it('removes the column and calls onChange with one fewer column', async () => {
    const { container, onChange } = renderCsv()
    showContextMenuMock.mockResolvedValue('delete')
    await act(async () => {
      fireEvent.contextMenu(getColumnHeader(container, 0))
      await new Promise((r) => setTimeout(r, 30))
    })
    expect(onChange).toHaveBeenCalled()
    const csv: string = onChange.mock.calls[onChange.mock.calls.length - 1][0]
    const headerCols = csv.split('\n')[0].split(',')
    expect(headerCols).toHaveLength(1)
  })
})

describe('CsvEditor column — null action', () => {
  it('does not call onChange when showContextMenu resolves null', async () => {
    const { container, onChange } = renderCsv()
    showContextMenuMock.mockResolvedValue(null)
    await act(async () => {
      fireEvent.contextMenu(getColumnHeader(container, 0))
      await new Promise((r) => setTimeout(r, 30))
    })
    expect(onChange).not.toHaveBeenCalled()
  })
})
