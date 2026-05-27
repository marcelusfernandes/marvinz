import { useCallback, useEffect, useMemo, useState } from 'react'
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
  return rows.map((r) =>
    r.length < maxCols ? [...r, ...Array(maxCols - r.length).fill('')] : r,
  )
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
  const [editMode, setEditMode] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setReadError(null)
    setSaveError(null)
    setEditMode(false)
    window.marvin.office
      .readXlsx(path)
      .then((res) => {
        if (cancelled) return
        const normalized = padRows(res.rows.map((r) => r.map(String)))
        setOriginalRows(normalized)
        setRows(normalized)
        setSheetNames(res.sheetNames)
        setActiveSheet(res.sheetNames[0] ?? '')
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setReadError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [path])

  const dirty = useMemo(
    () => JSON.stringify(rows) !== JSON.stringify(originalRows),
    [rows, originalRows],
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

  const headerRow = rows[0] ?? []
  const dataRows = rows.slice(1)

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
                onClick={handleSave}
                disabled={saving || !dirty}
              >
                Save
              </button>
              <button
                type="button"
                title="Discard changes"
                onClick={discardChanges}
                disabled={saving}
              >
                Discard
              </button>
            </>
          ) : (
            <>
              <button type="button" title="Edit spreadsheet" onClick={enterEditMode}>
                <Icon name="edit" size={14} />
                Edit
              </button>
              {onRevealInFinder && (
                <button
                  type="button"
                  title="Reveal in Finder"
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
          {sheetNames.map((name) => (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={name === activeSheet}
              className={
                'xlsx-viewer-sheet' + (name === activeSheet ? ' xlsx-viewer-sheet-active' : '')
              }
              onClick={() => setActiveSheet(name)}
              title={name}
            >
              {name}
            </button>
          ))}
        </div>
      )}

      <div className="xlsx-viewer-banner" role="note">
        <Icon name="warning" size={14} />
        <span>Saving will flatten to plain values — formulas and formatting will be lost</span>
      </div>

      {saveError && (
        <div className="xlsx-viewer-error" role="alert">
          {saveError}
        </div>
      )}

      <div className={`xlsx-viewer-content${editMode ? ' xlsx-viewer-edit' : ''}`}>
        <table className="xlsx-viewer-grid">
          <thead>
            <tr>
              {headerRow.map((cell, ci) =>
                editMode ? (
                  <th key={ci}>
                    <input
                      value={cell}
                      onChange={(e) => handleCellChange(0, ci, e.target.value)}
                    />
                  </th>
                ) : (
                  <th key={ci}>{cell}</th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {dataRows.map((row, ri) => (
              <tr key={ri}>
                {row.map((cell, ci) =>
                  editMode ? (
                    <td key={ci}>
                      <input
                        value={cell}
                        onChange={(e) => handleCellChange(ri + 1, ci, e.target.value)}
                      />
                    </td>
                  ) : (
                    <td key={ci}>{cell}</td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
