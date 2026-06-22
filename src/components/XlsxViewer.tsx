import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { OFFICE_EDIT_ENABLED } from '../lib/featureFlags'
import { Icon } from './Icon'

type Props = {
  path: string
  onRevealInFinder?: (path: string) => void
}

function basename(p: string): string {
  return p.split('/').pop() ?? p
}

function padRows(rows: string[][]): string[][] {
  let maxCols = 0
  for (const r of rows) if (r.length > maxCols) maxCols = r.length
  return rows.map((r) => (r.length < maxCols ? [...r, ...Array(maxCols - r.length).fill('')] : r))
}

function columnLabel(idx: number): string {
  let n = idx
  let out = ''
  while (n >= 0) {
    out = String.fromCharCode((n % 26) + 65) + out
    n = Math.floor(n / 26) - 1
  }
  return out
}

export function XlsxViewer({ path, onRevealInFinder }: Props) {
  const [originalRows, setOriginalRows] = useState<string[][]>([])
  const [rows, setRows] = useState<string[][]>([])
  const [sheetNames, setSheetNames] = useState<string[]>([])
  const [activeSheet, setActiveSheet] = useState('')
  const [loading, setLoading] = useState(true)
  const [readError, setReadError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [editModeRequested, setEditMode] = useState(false)
  const loadTokenRef = useRef(0)

  const loadSheet = useCallback(
    (sheetName?: string) => {
      const token = ++loadTokenRef.current
      setLoading(true)
      setReadError(null)
      setSaveError(null)
      window.marvin.office
        .readXlsx(path, sheetName)
        .then((res) => {
          if (loadTokenRef.current !== token) return
          const normalized = padRows(res.rows)
          setOriginalRows(normalized)
          setRows(normalized)
          setSheetNames(res.sheetNames)
          setActiveSheet(sheetName ?? res.sheetNames[0] ?? '')
        })
        .catch((err: unknown) => {
          if (loadTokenRef.current !== token) return
          setReadError(err instanceof Error ? err.message : String(err))
        })
        .finally(() => {
          if (loadTokenRef.current === token) setLoading(false)
        })
    },
    [path]
  )

  useEffect(() => {
    setEditMode(false)
    loadSheet()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path])

  // Editing is gated behind a build flag (#429). When off, the viewer is
  // read-only: the grid + sheet navigation render, but edit/save are hidden.
  const editMode = OFFICE_EDIT_ENABLED && editModeRequested

  const dirty = useMemo(
    () => JSON.stringify(rows) !== JSON.stringify(originalRows),
    [rows, originalRows]
  )

  const handleSheetClick = useCallback(
    (name: string) => {
      if (name === activeSheet || dirty) return
      loadSheet(name)
    },
    [activeSheet, dirty, loadSheet]
  )

  const enterEditMode = useCallback(() => {
    setSaveError(null)
    setEditMode(true)
  }, [])

  const discardChanges = useCallback(() => {
    setRows(originalRows)
    setEditMode(false)
    setSaveError(null)
  }, [originalRows])

  const handleSave = useCallback(async () => {
    if (!dirty || saving) return
    setSaving(true)
    setSaveError(null)
    try {
      await window.marvin.office.writeXlsx(path, rows, activeSheet || 'Sheet1')
      setOriginalRows(rows)
      setEditMode(false)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }, [path, rows, activeSheet, dirty, saving])

  const handleCellChange = useCallback((rowIdx: number, colIdx: number, value: string) => {
    setRows((prev) => {
      const next = prev.map((r) => [...r])
      if (next[rowIdx]) next[rowIdx][colIdx] = value
      return next
    })
  }, [])

  const cols = rows[0]?.length ?? 0
  const headerRow = rows[0] ?? []
  const dataRows = rows.slice(1)

  if (loading) {
    return (
      <div className="xlsx-viewer">
        <div className="xlsx-viewer-toolbar">
          <span className="xlsx-viewer-name">{basename(path)}</span>
        </div>
        <div className="xlsx-viewer-loading">Loading spreadsheet…</div>
      </div>
    )
  }

  if (readError) {
    return (
      <div className="xlsx-viewer">
        <div className="xlsx-viewer-toolbar">
          <span className="xlsx-viewer-name">{basename(path)}</span>
        </div>
        <div className="xlsx-viewer-error" role="alert">
          Could not read file: {readError}
        </div>
      </div>
    )
  }

  const contentCls = `xlsx-viewer-grid-host xlsx-viewer-content${editMode ? ' xlsx-viewer-edit' : ''}`

  return (
    <div className="xlsx-viewer">
      <div className="xlsx-viewer-toolbar">
        <span className="xlsx-viewer-name">
          {basename(path)}
          {dirty && (
            <span className="xlsx-viewer-dirty" aria-label="Unsaved changes">
              {' '}
              *
            </span>
          )}
        </span>
        <div className="xlsx-viewer-actions">
          {editMode ? (
            <>
              <button
                type="button"
                title="Save changes to .xlsx"
                className="xlsx-viewer-action xlsx-viewer-action-primary"
                onClick={handleSave}
                disabled={saving || !dirty}
              >
                Save
              </button>
              <button
                type="button"
                title="Discard changes"
                className="xlsx-viewer-action"
                onClick={discardChanges}
                disabled={saving}
              >
                Discard
              </button>
            </>
          ) : (
            <>
              {OFFICE_EDIT_ENABLED && (
                <button
                  type="button"
                  title="Edit spreadsheet"
                  className="xlsx-viewer-action"
                  onClick={enterEditMode}
                >
                  <Icon name="edit" size={14} />
                  Edit
                </button>
              )}
              {onRevealInFinder && (
                <button
                  type="button"
                  title="Reveal in Finder"
                  className="xlsx-viewer-action"
                  onClick={() => onRevealInFinder(path)}
                >
                  Reveal in Finder
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {sheetNames.length > 0 && (
        <div className="xlsx-viewer-sheets" role="tablist">
          {sheetNames.map((name) => {
            const isActive = name === activeSheet
            const blocked = !isActive && dirty
            return (
              <button
                key={name}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-disabled={blocked}
                className={'xlsx-viewer-sheet' + (isActive ? ' xlsx-viewer-sheet-active' : '')}
                onClick={() => handleSheetClick(name)}
                title={blocked ? 'Save or discard changes before switching sheets' : name}
              >
                {name}
              </button>
            )
          })}
        </div>
      )}

      {OFFICE_EDIT_ENABLED && (
        <div className="xlsx-viewer-banner" role="note">
          <Icon name="warning" size={14} />
          <span>Saving will flatten to plain values — formulas and formatting will be lost</span>
        </div>
      )}

      {saveError && (
        <div className="xlsx-viewer-error" role="alert">
          {saveError}
        </div>
      )}

      <div className={contentCls}>
        <table className="xlsx-viewer-grid">
          <thead>
            {/* Column letter header row */}
            <tr>
              <th className="xlsx-viewer-corner" aria-hidden="true" />
              {Array.from({ length: cols }).map((_, c) => (
                <th key={c} className="xlsx-viewer-colhead" scope="col">
                  {columnLabel(c)}
                </th>
              ))}
            </tr>
            {/* First data row as header */}
            <tr>
              <th className="xlsx-viewer-rowhead" scope="row" aria-hidden="true">
                1
              </th>
              {headerRow.map((cell, ci) =>
                editMode ? (
                  <th key={ci} className="xlsx-viewer-cell xlsx-viewer-cell-header">
                    <input
                      className="xlsx-viewer-cell-input"
                      value={cell}
                      onChange={(e) => handleCellChange(0, ci, e.target.value)}
                    />
                  </th>
                ) : (
                  <th key={ci} className="xlsx-viewer-cell xlsx-viewer-cell-header" scope="col">
                    {cell}
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody>
            {dataRows.map((row, ri) => (
              <tr key={ri}>
                <th className="xlsx-viewer-rowhead" scope="row" aria-hidden="true">
                  {ri + 2}
                </th>
                {row.map((cell, ci) =>
                  editMode ? (
                    <td key={ci} className="xlsx-viewer-cell xlsx-viewer-cell-editing">
                      <input
                        className="xlsx-viewer-cell-input"
                        value={cell}
                        onChange={(e) => handleCellChange(ri + 1, ci, e.target.value)}
                      />
                    </td>
                  ) : (
                    <td key={ci} className="xlsx-viewer-cell">
                      <span className="xlsx-viewer-cell-value">{cell}</span>
                    </td>
                  )
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
