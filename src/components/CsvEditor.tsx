import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Papa from 'papaparse'
import { DataGrid, type Column, type SortColumn } from 'react-data-grid'
import 'react-data-grid/lib/styles.css'
import type { MenuItemSpec } from '../types'
import { Icon } from './Icon'

type Col = { key: string; name: string }
type Row = Record<string, string> & { __id: string }

type Parsed = {
  columns: Col[]
  rows: Row[]
  delimiter: string
  trailingNewline: boolean
}

type Props = {
  filePath: string
  initialContent: string
  onChange: (next: string) => void
}

const FALLBACK_DELIMITER = ','

let uidCounter = 0
const uid = (prefix: string) => `${prefix}${++uidCounter}`

function parseCsv(content: string): Parsed {
  const trailingNewline = content.endsWith('\n')
  const result = Papa.parse<string[]>(content, {
    skipEmptyLines: false,
    delimiter: '', // auto-detect
  })
  const data: string[][] = (result.data ?? []).filter((r) => Array.isArray(r))
  const delimiter = result.meta.delimiter || FALLBACK_DELIMITER
  // papaparse may emit a trailing empty row when input ends with a newline.
  const trimmed =
    trailingNewline && data.length > 0 && data[data.length - 1].every((c) => c === '')
      ? data.slice(0, -1)
      : data
  if (trimmed.length === 0) {
    return { columns: [], rows: [], delimiter, trailingNewline }
  }
  const columnCount = Math.max(...trimmed.map((r) => r.length))
  const headerRow = trimmed[0]
  const columns: Col[] = []
  for (let i = 0; i < columnCount; i++) {
    columns.push({ key: uid('c'), name: headerRow[i] ?? `Column ${i + 1}` })
  }
  const rows: Row[] = trimmed.slice(1).map((arr) => {
    const row: Row = { __id: uid('r') }
    columns.forEach((col, i) => {
      row[col.key] = arr[i] ?? ''
    })
    return row
  })
  return { columns, rows, delimiter, trailingNewline }
}

function serializeCsv(parsed: Parsed): string {
  const { columns, rows, delimiter, trailingNewline } = parsed
  if (columns.length === 0 && rows.length === 0) {
    return trailingNewline ? '\n' : ''
  }
  const headerLine = columns.map((c) => c.name)
  const data = [headerLine, ...rows.map((r) => columns.map((c) => r[c.key] ?? ''))]
  let out = Papa.unparse(data, { delimiter, newline: '\n' })
  if (trailingNewline && !out.endsWith('\n')) out += '\n'
  return out
}

function compareCells(a: string, b: string): number {
  // Numeric-aware compare: "10" sorts after "2" when both parse as numbers.
  const na = Number(a)
  const nb = Number(b)
  if (a !== '' && b !== '' && !Number.isNaN(na) && !Number.isNaN(nb)) {
    return na - nb
  }
  return a.localeCompare(b)
}

export function CsvEditor({ filePath, initialContent, onChange }: Props) {
  const [parsed, setParsed] = useState<Parsed>(() => parseCsv(initialContent))
  const [sortColumns, setSortColumns] = useState<readonly SortColumn[]>([])
  // Track what we last serialized to avoid re-parsing our own edits when the
  // parent re-passes initialContent through the save → state cycle.
  const lastSerializedRef = useRef<string>(initialContent)

  useEffect(() => {
    if (initialContent === lastSerializedRef.current) return
    const next = parseCsv(initialContent)
    setParsed(next)
    setSortColumns([])
    lastSerializedRef.current = initialContent
  }, [filePath, initialContent])

  const commit = useCallback(
    (next: Parsed) => {
      setParsed(next)
      const serialized = serializeCsv(next)
      lastSerializedRef.current = serialized
      onChange(serialized)
    },
    [onChange],
  )

  const removeColumn = useCallback(
    (key: string) => {
      const nextColumns = parsed.columns.filter((c) => c.key !== key)
      const nextRows = parsed.rows.map((r) => {
        const next = { ...r }
        delete next[key]
        return next
      })
      commit({ ...parsed, columns: nextColumns, rows: nextRows })
      setSortColumns((prev) => prev.filter((s) => s.columnKey !== key))
    },
    [commit, parsed],
  )

  const insertColumn = useCallback(
    (anchorKey: string, side: 'before' | 'after') => {
      const idx = parsed.columns.findIndex((c) => c.key === anchorKey)
      if (idx < 0) return
      const insertAt = side === 'before' ? idx : idx + 1
      const newCol: Col = { key: uid('c'), name: `Column ${parsed.columns.length + 1}` }
      const nextColumns = [
        ...parsed.columns.slice(0, insertAt),
        newCol,
        ...parsed.columns.slice(insertAt),
      ]
      const nextRows = parsed.rows.map((r) => ({ ...r, [newCol.key]: '' }))
      commit({ ...parsed, columns: nextColumns, rows: nextRows })
    },
    [commit, parsed],
  )

  const sortByColumn = useCallback(
    (key: string, direction: 'ASC' | 'DESC') => {
      const sign = direction === 'ASC' ? 1 : -1
      const sorted = [...parsed.rows].sort(
        (a, b) => sign * compareCells(a[key] ?? '', b[key] ?? ''),
      )
      commit({ ...parsed, rows: sorted })
      setSortColumns([{ columnKey: key, direction }])
    },
    [commit, parsed],
  )

  const removeRow = useCallback(
    (id: string) => {
      commit({ ...parsed, rows: parsed.rows.filter((r) => r.__id !== id) })
    },
    [commit, parsed],
  )

  const insertRow = useCallback(
    (anchorId: string, side: 'above' | 'below') => {
      const idx = parsed.rows.findIndex((r) => r.__id === anchorId)
      if (idx < 0) return
      const insertAt = side === 'above' ? idx : idx + 1
      const empty: Row = { __id: uid('r') }
      parsed.columns.forEach((c) => {
        empty[c.key] = ''
      })
      const nextRows = [...parsed.rows.slice(0, insertAt), empty, ...parsed.rows.slice(insertAt)]
      commit({ ...parsed, rows: nextRows })
    },
    [commit, parsed],
  )

  const openColumnMenu = useCallback(
    async (key: string) => {
      const items: MenuItemSpec[] = [
        { kind: 'item', id: 'insertLeft', label: '← Insert Left' },
        { kind: 'item', id: 'insertRight', label: '→ Insert Right' },
        { kind: 'separator' },
        { kind: 'item', id: 'sortAsc', label: 'Order Ascending (A–z)' },
        { kind: 'item', id: 'sortDesc', label: 'Order Descending (Z–a)' },
        { kind: 'separator' },
        { kind: 'item', id: 'delete', label: 'Delete Column' },
      ]
      const action = await window.marvin.app.showContextMenu(items)
      if (!action) return
      switch (action) {
        case 'insertLeft':
          insertColumn(key, 'before')
          break
        case 'insertRight':
          insertColumn(key, 'after')
          break
        case 'sortAsc':
          sortByColumn(key, 'ASC')
          break
        case 'sortDesc':
          sortByColumn(key, 'DESC')
          break
        case 'delete':
          removeColumn(key)
          break
      }
    },
    [insertColumn, sortByColumn, removeColumn],
  )

  const openRowMenu = useCallback(
    async (id: string) => {
      const items: MenuItemSpec[] = [
        { kind: 'item', id: 'insertAbove', label: 'Insert Row Above' },
        { kind: 'item', id: 'insertBelow', label: 'Insert Row Below' },
        { kind: 'separator' },
        { kind: 'item', id: 'delete', label: 'Delete Row' },
      ]
      const action = await window.marvin.app.showContextMenu(items)
      if (!action) return
      switch (action) {
        case 'insertAbove':
          insertRow(id, 'above')
          break
        case 'insertBelow':
          insertRow(id, 'below')
          break
        case 'delete':
          removeRow(id)
          break
      }
    },
    [insertRow, removeRow],
  )

  const handleColumnContextMenu = useCallback(
    (e: React.MouseEvent, key: string) => {
      e.preventDefault()
      e.stopPropagation()
      void openColumnMenu(key)
    },
    [openColumnMenu],
  )

  const handleColumnMenuButton = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>, key: string) => {
      e.preventDefault()
      e.stopPropagation()
      void openColumnMenu(key)
    },
    [openColumnMenu],
  )

  const handleRowContextMenu = useCallback(
    (e: React.MouseEvent, id: string) => {
      e.preventDefault()
      e.stopPropagation()
      void openRowMenu(id)
    },
    [openRowMenu],
  )

  const handleRowMenuButton = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>, id: string) => {
      e.preventDefault()
      e.stopPropagation()
      void openRowMenu(id)
    },
    [openRowMenu],
  )

  const columns = useMemo<Column<Row>[]>(() => {
    const gutter: Column<Row> = {
      key: '__rowGutter',
      name: '',
      width: 44,
      minWidth: 44,
      maxWidth: 44,
      frozen: true,
      resizable: false,
      sortable: false,
      cellClass: 'csv-row-gutter',
      headerCellClass: 'csv-row-gutter-header',
      renderHeaderCell: () => null,
      renderCell: ({ rowIdx, row }) => (
        <div
          className="csv-row-gutter-inner"
          onContextMenu={(e) => handleRowContextMenu(e, row.__id)}
        >
          <span className="csv-row-num">{rowIdx + 1}</span>
          <button
            type="button"
            className="csv-row-menu"
            title="Row actions"
            aria-label={`Actions for row ${rowIdx + 1}`}
            onClick={(e) => handleRowMenuButton(e, row.__id)}
          >
            <Icon name="kebab-vertical" />
          </button>
        </div>
      ),
    }
    const dataCols: Column<Row>[] = parsed.columns.map((col) => ({
      key: col.key,
      name: col.name,
      resizable: true,
      sortable: true,
      editable: true,
      renderEditCell: defaultTextEditor,
      renderHeaderCell: ({ column }) => (
        <CsvHeaderCell
          name={column.name as string}
          onMenu={(e) => handleColumnMenuButton(e, col.key)}
          onContextMenu={(e) => handleColumnContextMenu(e, col.key)}
        />
      ),
    }))
    return [gutter, ...dataCols]
  }, [
    parsed.columns,
    handleColumnContextMenu,
    handleColumnMenuButton,
    handleRowContextMenu,
    handleRowMenuButton,
  ])

  const rowKeyGetter = useCallback((r: Row) => r.__id, [])

  const handleRowsChange = useCallback(
    (nextRows: Row[]) => {
      commit({ ...parsed, rows: nextRows })
    },
    [commit, parsed],
  )

  // Sorting persists to the file: reordering the rows IS the edit.
  const handleSortChange = useCallback(
    (next: SortColumn[]) => {
      setSortColumns(next)
      if (next.length === 0) return
      const { columnKey, direction } = next[0]
      const sign = direction === 'ASC' ? 1 : -1
      const sorted = [...parsed.rows].sort(
        (a, b) => sign * compareCells(a[columnKey] ?? '', b[columnKey] ?? ''),
      )
      commit({ ...parsed, rows: sorted })
    },
    [commit, parsed],
  )

  const addRow = useCallback(() => {
    const empty: Row = { __id: uid('r') }
    parsed.columns.forEach((c) => {
      empty[c.key] = ''
    })
    commit({ ...parsed, rows: [...parsed.rows, empty] })
  }, [commit, parsed])

  const addColumn = useCallback(() => {
    const newCol: Col = { key: uid('c'), name: `Column ${parsed.columns.length + 1}` }
    const nextRows = parsed.rows.map((r) => ({ ...r, [newCol.key]: '' }))
    commit({ ...parsed, columns: [...parsed.columns, newCol], rows: nextRows })
  }, [commit, parsed])

  if (parsed.columns.length === 0) {
    return (
      <div className="csv-empty">
        <p>Empty CSV.</p>
        <button type="button" className="csv-btn" onClick={addColumn}>
          Add column
        </button>
      </div>
    )
  }

  return (
    <div className="csv-grid-wrap">
      <DataGrid
        className="rdg-dark csv-grid"
        columns={columns}
        rows={parsed.rows}
        rowKeyGetter={rowKeyGetter}
        onRowsChange={handleRowsChange}
        sortColumns={sortColumns}
        onSortColumnsChange={handleSortChange}
        defaultColumnOptions={{ resizable: true, minWidth: 80 }}
      />
      <div className="csv-grid-footer">
        <button type="button" className="csv-btn" onClick={addRow}>
          + Row
        </button>
        <button type="button" className="csv-btn" onClick={addColumn}>
          + Column
        </button>
        <span className="csv-grid-meta">
          {parsed.rows.length} row{parsed.rows.length === 1 ? '' : 's'} ·{' '}
          {parsed.columns.length} col{parsed.columns.length === 1 ? '' : 's'} · delim{' '}
          <code>{parsed.delimiter === '\t' ? '\\t' : parsed.delimiter}</code>
        </span>
      </div>
    </div>
  )
}

function CsvHeaderCell({
  name,
  onMenu,
  onContextMenu,
}: {
  name: string
  onMenu: (e: React.MouseEvent<HTMLButtonElement>) => void
  onContextMenu: (e: React.MouseEvent) => void
}) {
  return (
    <div className="csv-header-cell" onContextMenu={onContextMenu}>
      <span className="csv-header-name">{name}</span>
      <button
        type="button"
        className="csv-header-menu"
        title="Column actions"
        aria-label={`Actions for column ${name}`}
        onClick={onMenu}
      >
        <Icon name="kebab-vertical" />
      </button>
    </div>
  )
}

function defaultTextEditor(props: {
  row: Row
  column: { key: string }
  onRowChange: (row: Row, commit?: boolean) => void
  onClose: (commitChanges?: boolean) => void
}) {
  const { row, column, onRowChange, onClose } = props
  const value = row[column.key] ?? ''
  return (
    <input
      className="csv-cell-input"
      autoFocus
      value={value}
      onChange={(e) => onRowChange({ ...row, [column.key]: e.target.value })}
      onBlur={() => onClose(true)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onClose(true)
        if (e.key === 'Escape') onClose(false)
      }}
    />
  )
}
