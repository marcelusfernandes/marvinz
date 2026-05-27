// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, act, waitFor } from '@testing-library/react'

vi.mock('../Icon', () => ({
  Icon: ({ name }: { name: string }) => <span data-icon={name} />,
}))

// ---------------------------------------------------------------------------
// window.marvin mock
// ---------------------------------------------------------------------------

let readDocxMock: ReturnType<typeof vi.fn>
let writeDocxMock: ReturnType<typeof vi.fn>

function setupMarvinMock() {
  readDocxMock = vi.fn()
  writeDocxMock = vi.fn().mockResolvedValue(undefined)
  Object.assign(window, {
    marvin: {
      office: {
        readDocx: readDocxMock,
        writeDocx: writeDocxMock,
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

import { DocxViewer } from '../DocxViewer'

// ---------------------------------------------------------------------------
// Helpers — buttons share the docx-viewer-action class; select by title.
// ---------------------------------------------------------------------------

function btn(container: HTMLElement, title: string) {
  return container.querySelector<HTMLButtonElement>(`button[title="${title}"]`)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DocxViewer', () => {
  beforeEach(() => {
    setupMarvinMock()
  })

  it('shows a loading indicator while readDocx is pending', () => {
    readDocxMock.mockReturnValue(new Promise(() => {})) // never resolves
    const { container } = render(<DocxViewer path="/vault/doc.docx" />)
    expect(container.querySelector('.docx-viewer-loading')).not.toBeNull()
  })

  it('renders HTML content when readDocx resolves', async () => {
    readDocxMock.mockResolvedValue({ html: '<p>Hello World</p>', messages: [] })
    const { container } = render(<DocxViewer path="/vault/doc.docx" />)
    await waitFor(() =>
      expect(container.querySelector('.docx-viewer-content')).not.toBeNull(),
    )
    expect(container.querySelector('.docx-viewer-content')!.innerHTML).toContain('Hello World')
  })

  it('shows an inline error message when readDocx rejects', async () => {
    readDocxMock.mockRejectedValue(new Error('read failed'))
    const { container } = render(<DocxViewer path="/vault/doc.docx" />)
    await waitFor(() =>
      expect(container.querySelector('.docx-viewer-error')).not.toBeNull(),
    )
    expect(container.querySelector('.docx-viewer-error')!.textContent).toContain('read failed')
  })

  it('renders the filename in the toolbar', async () => {
    readDocxMock.mockResolvedValue({ html: '<p>Hi</p>', messages: [] })
    const { container } = render(<DocxViewer path="/vault/reports/Letter.docx" />)
    await waitFor(() =>
      expect(container.querySelector('.docx-viewer-content')).not.toBeNull(),
    )
    expect(container.querySelector('.docx-viewer-name')!.textContent).toContain('Letter.docx')
  })

  it('switches to a textarea when Edit button is clicked', async () => {
    readDocxMock.mockResolvedValue({ html: '<p>Hello</p>', messages: [] })
    const { container } = render(<DocxViewer path="/vault/doc.docx" />)
    await waitFor(() =>
      expect(container.querySelector('.docx-viewer-content')).not.toBeNull(),
    )
    expect(btn(container, 'Edit document text')).not.toBeNull()
    fireEvent.click(btn(container, 'Edit document text')!)
    expect(container.querySelector('textarea')).not.toBeNull()
    expect(container.querySelector('.docx-viewer-content')).toBeNull()
  })

  it('shows dirty indicator after changing textarea content', async () => {
    readDocxMock.mockResolvedValue({ html: '<p>Hello</p>', messages: [] })
    const { container } = render(<DocxViewer path="/vault/doc.docx" />)
    await waitFor(() =>
      expect(container.querySelector('.docx-viewer-content')).not.toBeNull(),
    )
    fireEvent.click(btn(container, 'Edit document text')!)
    fireEvent.change(container.querySelector('textarea')!, { target: { value: 'modified text' } })
    expect(container.querySelector('.docx-viewer-dirty')).not.toBeNull()
  })

  it('Save button is disabled when textarea text equals original', async () => {
    readDocxMock.mockResolvedValue({ html: '<p>Hello</p>', messages: [] })
    const { container } = render(<DocxViewer path="/vault/doc.docx" />)
    await waitFor(() =>
      expect(container.querySelector('.docx-viewer-content')).not.toBeNull(),
    )
    fireEvent.click(btn(container, 'Edit document text')!)
    expect(btn(container, 'Save changes to .docx')).not.toBeNull()
    expect(btn(container, 'Save changes to .docx')!.disabled).toBe(true)
  })

  it('calls writeDocx with path and textarea text when Save is clicked', async () => {
    readDocxMock.mockResolvedValue({ html: '<p>Hello</p>', messages: [] })
    const { container } = render(<DocxViewer path="/vault/doc.docx" />)
    await waitFor(() =>
      expect(container.querySelector('.docx-viewer-content')).not.toBeNull(),
    )
    fireEvent.click(btn(container, 'Edit document text')!)
    fireEvent.change(container.querySelector('textarea')!, { target: { value: 'new content' } })
    await act(async () => {
      fireEvent.click(btn(container, 'Save changes to .docx')!)
    })
    expect(writeDocxMock).toHaveBeenCalledWith('/vault/doc.docx', 'new content')
  })

  it('returns to view mode and clears dirty flag after successful save', async () => {
    readDocxMock.mockResolvedValue({ html: '<p>Hello</p>', messages: [] })
    const { container } = render(<DocxViewer path="/vault/doc.docx" />)
    await waitFor(() =>
      expect(container.querySelector('.docx-viewer-content')).not.toBeNull(),
    )
    fireEvent.click(btn(container, 'Edit document text')!)
    fireEvent.change(container.querySelector('textarea')!, { target: { value: 'saved text' } })
    await act(async () => {
      fireEvent.click(btn(container, 'Save changes to .docx')!)
    })
    await waitFor(() =>
      expect(container.querySelector('.docx-viewer-content')).not.toBeNull(),
    )
    expect(container.querySelector('.docx-viewer-dirty')).toBeNull()
    expect(container.querySelector('textarea')).toBeNull()
  })

  it('resets textarea to original and returns to view mode when Cancel is clicked', async () => {
    readDocxMock.mockResolvedValue({ html: '<p>Hello</p>', messages: [] })
    const { container } = render(<DocxViewer path="/vault/doc.docx" />)
    await waitFor(() =>
      expect(container.querySelector('.docx-viewer-content')).not.toBeNull(),
    )
    fireEvent.click(btn(container, 'Edit document text')!)
    const original = container.querySelector('textarea')!.value
    fireEvent.change(container.querySelector('textarea')!, { target: { value: 'modified' } })
    fireEvent.click(btn(container, 'Discard changes')!)
    await waitFor(() =>
      expect(container.querySelector('.docx-viewer-content')).not.toBeNull(),
    )
    expect(container.querySelector('textarea')).toBeNull()
    // Re-enter edit — textarea must show the original, not the discarded edit
    fireEvent.click(btn(container, 'Edit document text')!)
    expect(container.querySelector('textarea')!.value).toBe(original)
  })

  it('shows writeDocx error inline on save failure', async () => {
    readDocxMock.mockResolvedValue({ html: '<p>Hello</p>', messages: [] })
    writeDocxMock.mockRejectedValue(new Error('disk full'))
    const { container } = render(<DocxViewer path="/vault/doc.docx" />)
    await waitFor(() =>
      expect(container.querySelector('.docx-viewer-content')).not.toBeNull(),
    )
    fireEvent.click(btn(container, 'Edit document text')!)
    fireEvent.change(container.querySelector('textarea')!, { target: { value: 'new text' } })
    await act(async () => {
      fireEvent.click(btn(container, 'Save changes to .docx')!)
    })
    await waitFor(() =>
      expect(container.querySelector('.docx-viewer-error')).not.toBeNull(),
    )
    expect(container.querySelector('.docx-viewer-error')!.textContent).toContain('disk full')
  })

  it('calls onRevealInFinder with the correct path when Reveal is clicked', async () => {
    readDocxMock.mockResolvedValue({ html: '<p>Hello</p>', messages: [] })
    const onRevealInFinder = vi.fn()
    const { container } = render(
      <DocxViewer path="/vault/doc.docx" onRevealInFinder={onRevealInFinder} />,
    )
    await waitFor(() =>
      expect(container.querySelector('.docx-viewer-content')).not.toBeNull(),
    )
    expect(btn(container, 'Reveal in Finder')).not.toBeNull()
    fireEvent.click(btn(container, 'Reveal in Finder')!)
    expect(onRevealInFinder).toHaveBeenCalledWith('/vault/doc.docx')
  })

  it('does not render a Reveal button when onRevealInFinder is omitted', async () => {
    readDocxMock.mockResolvedValue({ html: '<p>Hello</p>', messages: [] })
    const { container } = render(<DocxViewer path="/vault/doc.docx" />)
    await waitFor(() =>
      expect(container.querySelector('.docx-viewer-content')).not.toBeNull(),
    )
    expect(btn(container, 'Reveal in Finder')).toBeNull()
  })

  it('Reveal button remains visible in edit mode', async () => {
    readDocxMock.mockResolvedValue({ html: '<p>Hello</p>', messages: [] })
    const onRevealInFinder = vi.fn()
    const { container } = render(
      <DocxViewer path="/vault/doc.docx" onRevealInFinder={onRevealInFinder} />,
    )
    await waitFor(() =>
      expect(container.querySelector('.docx-viewer-content')).not.toBeNull(),
    )
    fireEvent.click(btn(container, 'Edit document text')!)
    expect(btn(container, 'Reveal in Finder')).not.toBeNull()
  })

  it('handles empty docx without error', async () => {
    readDocxMock.mockResolvedValue({ html: '', messages: [] })
    const { container } = render(<DocxViewer path="/vault/empty.docx" />)
    await waitFor(() => expect(container.querySelector('.docx-viewer-loading')).toBeNull())
    expect(container.querySelector('.docx-viewer-error')).toBeNull()
    expect(container.querySelector('.docx-viewer-content')).not.toBeNull()
  })

  it('strips script tags from mammoth html before rendering', async () => {
    readDocxMock.mockResolvedValue({
      html: '<p>Safe</p><script>alert(1)</script>',
      messages: [],
    })
    const { container } = render(<DocxViewer path="/vault/doc.docx" />)
    await waitFor(() =>
      expect(container.querySelector('.docx-viewer-content')).not.toBeNull(),
    )
    expect(container.innerHTML).not.toContain('<script>')
    expect(container.querySelector('.docx-viewer-content')!.textContent).toContain('Safe')
  })

  it('preserves inline raster images (data:image/png) from mammoth output', async () => {
    const dataUri = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
    readDocxMock.mockResolvedValue({
      html: `<p>Doc with image</p><img src="${dataUri}" alt="chart">`,
      messages: [],
    })
    const { container } = render(<DocxViewer path="/vault/doc.docx" />)
    await waitFor(() =>
      expect(container.querySelector('.docx-viewer-content')).not.toBeNull(),
    )
    const img = container.querySelector<HTMLImageElement>('img')
    expect(img).not.toBeNull()
    expect(img!.getAttribute('src')).toBe(dataUri)
  })

  it('strips data:image/svg+xml src (can embed scripts)', async () => {
    const svgUri = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxzY3JpcHQ+YWxlcnQoMSk8L3NjcmlwdD48L3N2Zz4='
    readDocxMock.mockResolvedValue({
      html: `<img src="${svgUri}" alt="svg">`,
      messages: [],
    })
    const { container } = render(<DocxViewer path="/vault/doc.docx" />)
    await waitFor(() =>
      expect(container.querySelector('.docx-viewer-content')).not.toBeNull(),
    )
    const img = container.querySelector<HTMLImageElement>('img')
    expect(img?.getAttribute('src')).not.toContain('data:image/svg')
  })
})
