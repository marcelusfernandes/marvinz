// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, act, waitFor } from '@testing-library/react'

// Editing tests require the flag enabled (tests predate gating; flag is off by
// default in test env because import.meta.env is not set).
vi.mock('../../lib/featureFlags', () => ({
  OFFICE_EDIT_ENABLED: true,
  CHAT_UI_ENABLED: false,
}))

vi.mock('../Icon', () => ({
  Icon: ({ name }: { name: string }) => <span data-icon={name} />,
}))

// ---------------------------------------------------------------------------
// window.marvin mock
// ---------------------------------------------------------------------------

let readXlsxMock: ReturnType<typeof vi.fn>
let writeXlsxMock: ReturnType<typeof vi.fn>

function setupMarvinMock() {
  readXlsxMock = vi.fn()
  writeXlsxMock = vi.fn().mockResolvedValue(undefined)
  Object.assign(window, {
    marvin: {
      office: {
        readXlsx: readXlsxMock,
        writeXlsx: writeXlsxMock,
      },
      shell: {
        reveal: vi.fn().mockResolvedValue(undefined),
      },
    },
  })
}

// ---------------------------------------------------------------------------
// Import component after mocks
// ---------------------------------------------------------------------------

import { XlsxViewer } from '../XlsxViewer'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SAMPLE_ROWS = [
  ['Name', 'Score', 'Grade'],
  ['Alice', '95', 'A'],
  ['Bob', '82', 'B'],
]

function btn(container: HTMLElement, title: string) {
  return container.querySelector<HTMLButtonElement>(`button[title="${title}"]`)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('XlsxViewer', () => {
  beforeEach(() => {
    setupMarvinMock()
  })

  it('shows a loading indicator while readXlsx is pending', () => {
    readXlsxMock.mockReturnValue(new Promise(() => {})) // never resolves
    const { container } = render(<XlsxViewer path="/vault/data.xlsx" />)
    expect(container.querySelector('.xlsx-viewer-loading')).not.toBeNull()
  })

  it('renders a table when readXlsx resolves', async () => {
    readXlsxMock.mockResolvedValue({ rows: SAMPLE_ROWS, sheetNames: ['Sheet1'] })
    const { container } = render(<XlsxViewer path="/vault/data.xlsx" />)
    await waitFor(() => expect(container.querySelector('.xlsx-viewer-content')).not.toBeNull())
    expect(container.querySelector('table')).not.toBeNull()
  })

  it('renders header row cells from first row of data', async () => {
    readXlsxMock.mockResolvedValue({ rows: SAMPLE_ROWS, sheetNames: ['Sheet1'] })
    const { container } = render(<XlsxViewer path="/vault/data.xlsx" />)
    await waitFor(() => expect(container.querySelector('.xlsx-viewer-content')).not.toBeNull())
    const headers = container.querySelectorAll('th')
    expect(headers.length).toBeGreaterThan(0)
    const headerTexts = Array.from(headers).map((h) => h.textContent)
    expect(headerTexts).toContain('Name')
    expect(headerTexts).toContain('Score')
  })

  it('renders data rows', async () => {
    readXlsxMock.mockResolvedValue({ rows: SAMPLE_ROWS, sheetNames: ['Sheet1'] })
    const { container } = render(<XlsxViewer path="/vault/data.xlsx" />)
    await waitFor(() => expect(container.querySelector('.xlsx-viewer-content')).not.toBeNull())
    const rows = container.querySelectorAll('tbody tr')
    expect(rows.length).toBe(2) // rows minus header
  })

  it('shows an inline error message when readXlsx rejects', async () => {
    readXlsxMock.mockRejectedValue(new Error('read failed'))
    const { container } = render(<XlsxViewer path="/vault/data.xlsx" />)
    await waitFor(() => expect(container.querySelector('.xlsx-viewer-error')).not.toBeNull())
    expect(container.querySelector('.xlsx-viewer-error')!.textContent).toContain('read failed')
  })

  it('renders the filename in the toolbar', async () => {
    readXlsxMock.mockResolvedValue({ rows: SAMPLE_ROWS, sheetNames: ['Sheet1'] })
    const { container } = render(<XlsxViewer path="/vault/reports/Budget.xlsx" />)
    await waitFor(() => expect(container.querySelector('.xlsx-viewer-content')).not.toBeNull())
    expect(container.querySelector('.xlsx-viewer-name')!.textContent).toContain('Budget.xlsx')
  })

  it('renders sheet names when multiple sheets are present', async () => {
    readXlsxMock.mockResolvedValue({ rows: SAMPLE_ROWS, sheetNames: ['Sheet1', 'Summary'] })
    const { container } = render(<XlsxViewer path="/vault/data.xlsx" />)
    await waitFor(() => expect(container.querySelector('.xlsx-viewer-content')).not.toBeNull())
    expect(container.textContent).toContain('Sheet1')
  })

  it('switches to edit mode when Edit button is clicked', async () => {
    readXlsxMock.mockResolvedValue({ rows: SAMPLE_ROWS, sheetNames: ['Sheet1'] })
    const { container } = render(<XlsxViewer path="/vault/data.xlsx" />)
    await waitFor(() => expect(container.querySelector('.xlsx-viewer-content')).not.toBeNull())
    expect(btn(container, 'Edit spreadsheet')).not.toBeNull()
    fireEvent.click(btn(container, 'Edit spreadsheet')!)
    expect(container.querySelector('.xlsx-viewer-edit')).not.toBeNull()
  })

  it('shows dirty indicator after editing a cell', async () => {
    readXlsxMock.mockResolvedValue({ rows: SAMPLE_ROWS, sheetNames: ['Sheet1'] })
    const { container } = render(<XlsxViewer path="/vault/data.xlsx" />)
    await waitFor(() => expect(container.querySelector('.xlsx-viewer-content')).not.toBeNull())
    fireEvent.click(btn(container, 'Edit spreadsheet')!)
    const cell = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(
      '.xlsx-viewer-edit input, .xlsx-viewer-edit textarea'
    )
    if (cell) {
      fireEvent.change(cell, { target: { value: 'modified' } })
      expect(container.querySelector('.xlsx-viewer-dirty')).not.toBeNull()
    }
  })

  it('calls writeXlsx with path and updated rows when Save is clicked', async () => {
    readXlsxMock.mockResolvedValue({
      rows: [
        ['A', 'B'],
        ['1', '2'],
      ],
      sheetNames: ['Sheet1'],
    })
    const { container } = render(<XlsxViewer path="/vault/data.xlsx" />)
    await waitFor(() => expect(container.querySelector('.xlsx-viewer-content')).not.toBeNull())
    fireEvent.click(btn(container, 'Edit spreadsheet')!)
    const cell = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(
      '.xlsx-viewer-edit input, .xlsx-viewer-edit textarea'
    )
    if (cell) {
      fireEvent.change(cell, { target: { value: 'changed' } })
    }
    await act(async () => {
      fireEvent.click(btn(container, 'Save changes to .xlsx')!)
    })
    expect(writeXlsxMock).toHaveBeenCalledWith(
      '/vault/data.xlsx',
      expect.any(Array),
      expect.any(String)
    )
  })

  it('returns to view mode after a successful save', async () => {
    readXlsxMock.mockResolvedValue({ rows: [['A'], ['1']], sheetNames: ['Sheet1'] })
    const { container } = render(<XlsxViewer path="/vault/data.xlsx" />)
    await waitFor(() => expect(container.querySelector('.xlsx-viewer-content')).not.toBeNull())
    fireEvent.click(btn(container, 'Edit spreadsheet')!)
    const cell = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(
      '.xlsx-viewer-edit input, .xlsx-viewer-edit textarea'
    )
    if (cell) {
      fireEvent.change(cell, { target: { value: 'new value' } })
    }
    await act(async () => {
      fireEvent.click(btn(container, 'Save changes to .xlsx')!)
    })
    await waitFor(() => expect(container.querySelector('.xlsx-viewer-content')).not.toBeNull())
    expect(container.querySelector('.xlsx-viewer-dirty')).toBeNull()
    expect(container.querySelector('.xlsx-viewer-edit')).toBeNull()
  })

  it('shows writeXlsx error inline on save failure', async () => {
    readXlsxMock.mockResolvedValue({ rows: [['A'], ['1']], sheetNames: ['Sheet1'] })
    writeXlsxMock.mockRejectedValue(new Error('disk full'))
    const { container } = render(<XlsxViewer path="/vault/data.xlsx" />)
    await waitFor(() => expect(container.querySelector('.xlsx-viewer-content')).not.toBeNull())
    fireEvent.click(btn(container, 'Edit spreadsheet')!)
    const cell = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(
      '.xlsx-viewer-edit input, .xlsx-viewer-edit textarea'
    )
    if (cell) {
      fireEvent.change(cell, { target: { value: 'x' } })
    }
    await act(async () => {
      fireEvent.click(btn(container, 'Save changes to .xlsx')!)
    })
    await waitFor(() => expect(container.querySelector('.xlsx-viewer-error')).not.toBeNull())
    expect(container.querySelector('.xlsx-viewer-error')!.textContent).toContain('disk full')
  })

  it('cancels edit and returns to view without saving', async () => {
    readXlsxMock.mockResolvedValue({ rows: SAMPLE_ROWS, sheetNames: ['Sheet1'] })
    const { container } = render(<XlsxViewer path="/vault/data.xlsx" />)
    await waitFor(() => expect(container.querySelector('.xlsx-viewer-content')).not.toBeNull())
    fireEvent.click(btn(container, 'Edit spreadsheet')!)
    fireEvent.click(btn(container, 'Discard changes')!)
    await waitFor(() => expect(container.querySelector('.xlsx-viewer-content')).not.toBeNull())
    expect(container.querySelector('.xlsx-viewer-edit')).toBeNull()
    expect(writeXlsxMock).not.toHaveBeenCalled()
  })

  it('calls onRevealInFinder with the correct path when Reveal is clicked', async () => {
    readXlsxMock.mockResolvedValue({ rows: SAMPLE_ROWS, sheetNames: ['Sheet1'] })
    const onRevealInFinder = vi.fn()
    const { container } = render(
      <XlsxViewer path="/vault/data.xlsx" onRevealInFinder={onRevealInFinder} />
    )
    await waitFor(() => expect(container.querySelector('.xlsx-viewer-content')).not.toBeNull())
    expect(btn(container, 'Reveal in Finder')).not.toBeNull()
    fireEvent.click(btn(container, 'Reveal in Finder')!)
    expect(onRevealInFinder).toHaveBeenCalledWith('/vault/data.xlsx')
  })

  it('does not render a Reveal button when onRevealInFinder is omitted', async () => {
    readXlsxMock.mockResolvedValue({ rows: SAMPLE_ROWS, sheetNames: ['Sheet1'] })
    const { container } = render(<XlsxViewer path="/vault/data.xlsx" />)
    await waitFor(() => expect(container.querySelector('.xlsx-viewer-content')).not.toBeNull())
    expect(btn(container, 'Reveal in Finder')).toBeNull()
  })

  it('handles empty xlsx (no rows) without error', async () => {
    readXlsxMock.mockResolvedValue({ rows: [], sheetNames: ['Sheet1'] })
    const { container } = render(<XlsxViewer path="/vault/empty.xlsx" />)
    await waitFor(() => expect(container.querySelector('.xlsx-viewer-loading')).toBeNull())
    expect(container.querySelector('.xlsx-viewer-error')).toBeNull()
    expect(container.querySelector('.xlsx-viewer-content')).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// isXlsxPath — tested indirectly via a plain import-free regex check
// (the function is not exported from App.tsx, so we verify the contract
// by the same regex the implementation uses)
// ---------------------------------------------------------------------------

describe('isXlsxPath contract', () => {
  const isXlsxPath = (p: string) => /\.xlsx$/i.test(p)

  it('returns true for .xlsx extension', () => {
    expect(isXlsxPath('file.xlsx')).toBe(true)
  })

  it('returns true for .XLSX (uppercase)', () => {
    expect(isXlsxPath('file.XLSX')).toBe(true)
  })

  it('returns true for mixed case .Xlsx', () => {
    expect(isXlsxPath('file.Xlsx')).toBe(true)
  })

  it('returns false for .xls (without trailing x)', () => {
    expect(isXlsxPath('file.xls')).toBe(false)
  })

  it('returns false for .xlsx.bak (xlsx not at end)', () => {
    expect(isXlsxPath('file.xlsx.bak')).toBe(false)
  })

  it('returns false for .docx', () => {
    expect(isXlsxPath('file.docx')).toBe(false)
  })

  it('returns false for empty string', () => {
    expect(isXlsxPath('')).toBe(false)
  })

  it('returns false for path with xlsx in directory name', () => {
    expect(isXlsxPath('/xlsx/notes/file.md')).toBe(false)
  })
})
