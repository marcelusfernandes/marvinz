import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Papa from 'papaparse'
import { DataGrid, type Column } from 'react-data-grid'
import 'react-data-grid/lib/styles.css'

type Row = Record<string, string>

type Parsed = {
  headers: string[]
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
    return { headers: [], rows: [], delimiter, trailingNewline }
  }
  const columnCount = Math.max(...trimmed.map((r) => r.length))
  const headerRow = trimmed[0]
  const headers: string[] = []
  for (let i = 0; i < columnCount; i++) {
    headers.push(headerRow[i] ?? `Column ${i + 1}`)
  }
  const rows: Row[] = trimmed.slice(1).map((arr) => {
    const row: Row = {}
    for (let i = 0; i < columnCount; i++) {
      row[`c${i}`] = arr[i] ?? ''
    }
    return row
  })
  return { headers, rows, delimiter, trailingNewline }
}

function serializeCsv(parsed: Parsed): string {
  const { headers, rows, delimiter, trailingNewline } = parsed
  if (headers.length === 0 && rows.length === 0) {
    return trailingNewline ? '\n' : ''
  }
  const data = [headers, ...rows.map((r) => headers.map((_, i) => r[`c${i}`] ?? ''))]
  let out = Papa.unparse(data, { delimiter, newline: '\n' })
  if (trailingNewline && !out.endsWith('\n')) out += '\n'
  return out
}

export function CsvEditor({ filePath, initialContent, onChange }: Props) {
  const [parsed, setParsed] = useState<Parsed>(() => parseCsv(initialContent))
  // Track what we last serialized to avoid re-parsing our own edits when the
  // parent re-passes initialContent through the save → state cycle.
  const lastSerializedRef = useRef<string>(initialContent)

  useEffect(() => {
    if (initialContent === lastSerializedRef.current) return
    const next = parseCsv(initialContent)
    setParsed(next)
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

  const columns = useMemo<Column<Row>[]>(
    () =>
      parsed.headers.map((name, i) => ({
        key: `c${i}`,
        name: name || `Column ${i + 1}`,
        resizable: true,
        editable: true,
        renderEditCell: defaultTextEditor,
      })),
    [parsed.headers],
  )

  const handleRowsChange = useCallback(
    (nextRows: Row[]) => {
      commit({ ...parsed, rows: nextRows })
    },
    [commit, parsed],
  )

  const addRow = useCallback(() => {
    const empty: Row = {}
    parsed.headers.forEach((_, i) => {
      empty[`c${i}`] = ''
    })
    commit({ ...parsed, rows: [...parsed.rows, empty] })
  }, [commit, parsed])

  const addColumn = useCallback(() => {
    const i = parsed.headers.length
    const nextHeaders = [...parsed.headers, `Column ${i + 1}`]
    const nextRows = parsed.rows.map((r) => ({ ...r, [`c${i}`]: '' }))
    commit({ ...parsed, headers: nextHeaders, rows: nextRows })
  }, [commit, parsed])

  if (parsed.headers.length === 0) {
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
        onRowsChange={handleRowsChange}
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
          {parsed.headers.length} col{parsed.headers.length === 1 ? '' : 's'} · delim{' '}
          <code>{parsed.delimiter === '\t' ? '\\t' : parsed.delimiter}</code>
        </span>
      </div>
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
