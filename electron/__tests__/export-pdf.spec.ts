/**
 * Unit tests for the file:exportPdf pipeline (#464).
 *
 * Exercises the REAL `exportMarkdownToPdf` from electron/export-pdf.ts with
 * electron, fs and marked mocked — not a hand-copied mirror of the handler,
 * which could drift from production without any test noticing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { pathToFileURL } from 'node:url'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockWebContents = {
  printToPDF: vi.fn(),
}

const mockExportWin = {
  loadFile: vi.fn(),
  webContents: mockWebContents,
  destroy: vi.fn(),
}

vi.mock('electron', () => ({
  BrowserWindow: vi.fn(function () {
    return mockExportWin
  }),
  dialog: {
    showSaveDialog: vi.fn(),
  },
  app: {
    getPath: vi.fn(() => '/os-temp'),
  },
}))

vi.mock('node:fs/promises', () => ({
  default: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    unlink: vi.fn(),
  },
}))

vi.mock('marked', () => ({
  marked: vi.fn(() => '<p>content</p>'),
}))

import { BrowserWindow, dialog } from 'electron'
import fs from 'node:fs/promises'
import { marked } from 'marked'
import { exportMarkdownToPdf } from '../export-pdf.js'

type Mock = ReturnType<typeof vi.fn>

// Stand-in for main.ts's assertInVault: resolves to the realpath inside the
// vault, throws MARVIN_OUTSIDE_VAULT outside it. Overridden per test.
const assertInVault = vi.fn(async (p: string) => p)

const exportPdf = (filePath: string) => exportMarkdownToPdf(filePath, { assertInVault })

function chooseSavePath(filePath: string | undefined) {
  ;(dialog.showSaveDialog as Mock).mockResolvedValue(
    filePath ? { canceled: false, filePath } : { canceled: true, filePath: undefined }
  )
}

const writtenHtml = () =>
  (fs.writeFile as Mock).mock.calls.find((c) => String(c[0]).endsWith('.html'))?.[1] as string

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  assertInVault.mockImplementation(async (p: string) => p)
  ;(BrowserWindow as unknown as Mock).mockImplementation(function () {
    return mockExportWin
  })
  mockExportWin.loadFile.mockResolvedValue(undefined)
  mockExportWin.destroy.mockReturnValue(undefined)
  mockWebContents.printToPDF.mockResolvedValue(new Uint8Array([1, 2, 3]))
  ;(fs.readFile as Mock).mockResolvedValue('# Hello')
  ;(fs.writeFile as Mock).mockResolvedValue(undefined)
  ;(fs.unlink as Mock).mockResolvedValue(undefined)
  ;(marked as unknown as Mock).mockReturnValue('<p>content</p>')
})

afterEach(() => {
  delete process.env.MARVIN_INSECURE_EXPORT
})

// ---------------------------------------------------------------------------
// 1. Happy path
// ---------------------------------------------------------------------------

describe('exportMarkdownToPdf — happy path', () => {
  it('writes the PDF to the chosen save path', async () => {
    const pdfBuffer = new Uint8Array([10, 20, 30])
    mockWebContents.printToPDF.mockResolvedValue(pdfBuffer)
    chooseSavePath('/tmp/out.pdf')

    await exportPdf('/vault/note.md')

    const pdfCall = (fs.writeFile as Mock).mock.calls.find((c) => c[0] === '/tmp/out.pdf')
    expect(pdfCall).toBeDefined()
    expect(pdfCall![1]).toEqual(Buffer.from(pdfBuffer))
  })

  it('calls printToPDF with printBackground: true', async () => {
    chooseSavePath('/tmp/out.pdf')
    await exportPdf('/vault/note.md')
    expect(mockWebContents.printToPDF).toHaveBeenCalledWith({ printBackground: true })
  })

  it('proposes a .pdf next to the source as the default save path', async () => {
    chooseSavePath(undefined)
    await exportPdf('/vault/note.md')
    expect(dialog.showSaveDialog).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: '/vault/note.pdf' })
    )
  })
})

// ---------------------------------------------------------------------------
// 2. User cancels save dialog
// ---------------------------------------------------------------------------

describe('exportMarkdownToPdf — user cancels dialog', () => {
  it('does not write a PDF when dialog is canceled', async () => {
    chooseSavePath(undefined)
    await exportPdf('/vault/note.md')
    const pdfCall = (fs.writeFile as Mock).mock.calls.find((c) => c[0] === '/tmp/out.pdf')
    expect(pdfCall).toBeUndefined()
    expect(mockWebContents.printToPDF).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// 3. BrowserWindow + temp file cleanup
// ---------------------------------------------------------------------------

describe('exportMarkdownToPdf — cleanup', () => {
  it('destroys the export window and unlinks the temp HTML after export', async () => {
    chooseSavePath('/tmp/out.pdf')
    await exportPdf('/vault/note.md')
    expect(mockExportWin.destroy).toHaveBeenCalledTimes(1)
    expect(fs.unlink).toHaveBeenCalledTimes(1)
    expect((fs.unlink as Mock).mock.calls[0][0]).toMatch(/\/\._marvinz_export_\d+\.html$/)
  })

  it('destroys the export window and unlinks the temp HTML when user cancels', async () => {
    chooseSavePath(undefined)
    await exportPdf('/vault/note.md')
    expect(mockExportWin.destroy).toHaveBeenCalledTimes(1)
    expect(fs.unlink).toHaveBeenCalledTimes(1)
  })

  it('still destroys the window when printToPDF throws', async () => {
    chooseSavePath('/tmp/out.pdf')
    mockWebContents.printToPDF.mockRejectedValue(new Error('boom'))
    await expect(exportPdf('/vault/note.md')).rejects.toThrow('boom')
    expect(mockExportWin.destroy).toHaveBeenCalledTimes(1)
    expect(fs.unlink).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// 4. Temp HTML location (#464 — arbitrary-write half)
// ---------------------------------------------------------------------------

describe('exportMarkdownToPdf — temp HTML location', () => {
  it('stages the HTML in the OS temp dir, never next to the source', async () => {
    chooseSavePath(undefined)
    await exportPdf('/vault/docs/note.md')
    const [tmpPath] = (fs.unlink as Mock).mock.calls[0]
    expect(tmpPath.startsWith('/os-temp/')).toBe(true)
    expect(tmpPath.startsWith('/vault/')).toBe(false)
    expect(tmpPath).toMatch(/\/\._marvinz_export_\d+\.html$/)
  })
})

describe('exportMarkdownToPdf — relative assets', () => {
  it('anchors relative image paths to the note directory with <base href>', async () => {
    // The HTML no longer lives next to the note, so without a <base> every
    // `![](images/x.png)` would resolve against the OS temp dir.
    assertInVault.mockResolvedValue('/vault/real/docs/note.md')
    chooseSavePath(undefined)
    await exportPdf('/vault/link/docs/note.md')
    const html = writtenHtml()
    expect(html).toContain(`<base href="${pathToFileURL('/vault/real/docs').href}/">`)
    expect(html).not.toContain('/os-temp')
  })
})

// ---------------------------------------------------------------------------
// 5. Vault boundary (#464 — arbitrary-read half)
// ---------------------------------------------------------------------------

describe('exportMarkdownToPdf — vault boundary', () => {
  it('validates the path via assertInVault before reading it', async () => {
    chooseSavePath(undefined)
    await exportPdf('/vault/note.md')
    expect(assertInVault).toHaveBeenCalledWith('/vault/note.md')
    const boundaryOrder = assertInVault.mock.invocationCallOrder[0]
    const readOrder = (fs.readFile as Mock).mock.invocationCallOrder[0]
    expect(boundaryOrder).toBeLessThan(readOrder)
  })

  it('reads the realpath returned by assertInVault, not the raw input', async () => {
    assertInVault.mockResolvedValue('/vault/real/note.md')
    chooseSavePath(undefined)
    await exportPdf('/vault/link/note.md')
    expect(fs.readFile).toHaveBeenCalledWith('/vault/real/note.md', 'utf-8')
  })

  it('rejects with MARVIN_OUTSIDE_VAULT and never reads or writes anything', async () => {
    assertInVault.mockRejectedValue(new Error('MARVIN_OUTSIDE_VAULT'))
    await expect(exportPdf('/etc/passwd')).rejects.toThrow('MARVIN_OUTSIDE_VAULT')
    expect(fs.readFile).not.toHaveBeenCalled()
    expect(fs.writeFile).not.toHaveBeenCalled()
    expect(BrowserWindow).not.toHaveBeenCalled()
  })

  it('skips the boundary check only when MARVIN_INSECURE_EXPORT=1 (rollback escape hatch)', async () => {
    process.env.MARVIN_INSECURE_EXPORT = '1'
    assertInVault.mockRejectedValue(new Error('MARVIN_OUTSIDE_VAULT'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    chooseSavePath(undefined)

    await expect(exportPdf('/outside/note.md')).resolves.toBeUndefined()

    expect(assertInVault).not.toHaveBeenCalled()
    expect(fs.readFile).toHaveBeenCalledWith('/outside/note.md', 'utf-8')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('MARVIN_INSECURE_EXPORT'))
    warn.mockRestore()
  })

  it('does not treat other values of MARVIN_INSECURE_EXPORT as a bypass', async () => {
    process.env.MARVIN_INSECURE_EXPORT = 'true'
    assertInVault.mockRejectedValue(new Error('MARVIN_OUTSIDE_VAULT'))
    await expect(exportPdf('/outside/note.md')).rejects.toThrow('MARVIN_OUTSIDE_VAULT')
  })
})

// ---------------------------------------------------------------------------
// 6. Hardening of the render window
// ---------------------------------------------------------------------------

describe('exportMarkdownToPdf — render window hardening', () => {
  it('injects a Content-Security-Policy that forbids script and network', async () => {
    chooseSavePath(undefined)
    await exportPdf('/vault/note.md')
    const html = writtenHtml()
    expect(html).toContain('http-equiv="Content-Security-Policy"')
    expect(html).toMatch(/default-src 'none'/)
    expect(html).not.toMatch(/script-src/)
    expect(html).not.toMatch(/connect-src/)
  })

  it('creates the export window sandboxed with no node integration', async () => {
    chooseSavePath(undefined)
    await exportPdf('/vault/note.md')
    expect(BrowserWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        show: false,
        webPreferences: expect.objectContaining({
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
        }),
      })
    )
  })
})
