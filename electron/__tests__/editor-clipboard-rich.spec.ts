import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock electron clipboard — mirrors the real module shape used by the handlers
// ---------------------------------------------------------------------------

const mockClipboard = {
  write: vi.fn(),
  readHTML: vi.fn(),
  readText: vi.fn(),
}

vi.mock('electron', () => ({
  clipboard: mockClipboard,
}))

// Mirror of editor:clipboard-write-rich handler
function clipboardWriteRich(payload: { html: string; text: string }): void {
  mockClipboard.write({ html: payload.html, text: payload.text })
}

// Mirror of editor:clipboard-read-rich handler
function clipboardReadRich(): { html: string; text: string } {
  return { html: mockClipboard.readHTML(), text: mockClipboard.readText() }
}

// ---------------------------------------------------------------------------
// editor:clipboard-write-rich
// ---------------------------------------------------------------------------

describe('editor:clipboard-write-rich', () => {
  beforeEach(() => vi.clearAllMocks())

  it('delegates both html and text flavors to clipboard.write', () => {
    clipboardWriteRich({ html: '<b>hello</b>', text: 'hello' })
    expect(mockClipboard.write).toHaveBeenCalledOnce()
    expect(mockClipboard.write).toHaveBeenCalledWith({ html: '<b>hello</b>', text: 'hello' })
  })

  it('passes through empty html and text without modification', () => {
    clipboardWriteRich({ html: '', text: '' })
    expect(mockClipboard.write).toHaveBeenCalledWith({ html: '', text: '' })
  })
})

// ---------------------------------------------------------------------------
// editor:clipboard-read-rich
// ---------------------------------------------------------------------------

describe('editor:clipboard-read-rich', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns both html and text from clipboard', () => {
    mockClipboard.readHTML.mockReturnValue('<p>world</p>')
    mockClipboard.readText.mockReturnValue('world')

    const result = clipboardReadRich()

    expect(result).toEqual({ html: '<p>world</p>', text: 'world' })
    expect(mockClipboard.readHTML).toHaveBeenCalledOnce()
    expect(mockClipboard.readText).toHaveBeenCalledOnce()
  })

  it('returns empty strings when clipboard is empty', () => {
    mockClipboard.readHTML.mockReturnValue('')
    mockClipboard.readText.mockReturnValue('')

    const result = clipboardReadRich()

    expect(result).toEqual({ html: '', text: '' })
  })
})
