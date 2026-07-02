/**
 * Unit tests for the file:exportPdf IPC handler.
 *
 * Strategy: mirror the handler logic as a standalone function, mock all
 * external dependencies (electron, fs, marked), and verify behaviour for
 * the happy path, user-cancel, BrowserWindow cleanup, and temp file cleanup.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import path from 'node:path'

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
  ipcMain: {
    handle: vi.fn(),
  },
  app: {
    getPath: vi.fn(() => '/tmpdir'),
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

import { BrowserWindow, dialog, app } from 'electron'
import fs from 'node:fs/promises'
import { marked } from 'marked'

// Stand-in for main.ts's assertInVault: resolves inside the vault, throws
// outside it. Overridden per-test to simulate a boundary violation.
const assertInVault = vi.fn(async (p: string) => p)

// ---------------------------------------------------------------------------
// Handler factory — mirrors main.ts file:exportPdf logic exactly
// ---------------------------------------------------------------------------

async function exportPdf(filePath: string): Promise<void> {
  const safe = await assertInVault(filePath)
  const content = await fs.readFile(safe, 'utf-8')

  const bodyHtml = await marked(content as string)

  const html = `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data: file: marvin: https:; style-src 'unsafe-inline'; font-src 'self' data:;">
<style>
  body { font-family: system-ui, -apple-system, sans-serif; max-width: 800px; margin: 0 auto; padding: 2rem; line-height: 1.6; color: #1a1a1a; }
  h1, h2, h3, h4, h5, h6 { margin-top: 1.5em; }
  img { max-width: 100%; height: auto; }
  pre { background: #f5f5f5; padding: 1rem; border-radius: 4px; overflow-x: auto; }
  code { font-family: monospace; font-size: 0.9em; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #ddd; padding: 0.5rem; }
  blockquote { border-left: 4px solid #ddd; margin: 0; padding-left: 1rem; color: #555; }
</style>
</head><body>${bodyHtml}</body></html>`

  const tmpPath = path.join(app.getPath('temp'), `._marvinz_export_${Date.now()}.html`)
  await fs.writeFile(tmpPath, html, 'utf-8')

  const exportWin = new BrowserWindow({
    show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
  })

  try {
    await exportWin.loadFile(tmpPath)

    const { canceled, filePath: savePath } = await dialog.showSaveDialog({
      defaultPath: filePath.replace(/\.md$/, '.pdf'),
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    })

    if (!canceled && savePath) {
      const pdfBuffer = await exportWin.webContents.printToPDF({ printBackground: true })
      await fs.writeFile(savePath, Buffer.from(pdfBuffer))
    }
  } finally {
    exportWin.destroy()
    await fs.unlink(tmpPath).catch(() => {})
  }
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  assertInVault.mockImplementation(async (p: string) => p)
  ;(BrowserWindow as unknown as ReturnType<typeof vi.fn>).mockImplementation(function () {
    return mockExportWin
  })
  mockExportWin.loadFile.mockResolvedValue(undefined)
  mockExportWin.destroy.mockReturnValue(undefined)
  mockWebContents.printToPDF.mockResolvedValue(new Uint8Array([1, 2, 3]))
  ;(fs.readFile as ReturnType<typeof vi.fn>).mockResolvedValue('# Hello')
  ;(fs.writeFile as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
  ;(fs.unlink as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
  ;(marked as unknown as ReturnType<typeof vi.fn>).mockReturnValue('<p>content</p>')
})

// ---------------------------------------------------------------------------
// 1. Happy path
// ---------------------------------------------------------------------------

describe('file:exportPdf — happy path', () => {
  it('writes the PDF to the chosen save path', async () => {
    const pdfBuffer = new Uint8Array([10, 20, 30])
    mockWebContents.printToPDF.mockResolvedValue(pdfBuffer)
    ;(dialog.showSaveDialog as ReturnType<typeof vi.fn>).mockResolvedValue({
      canceled: false,
      filePath: '/tmp/out.pdf',
    })

    await exportPdf('/vault/note.md')

    const writeFileCalls = (fs.writeFile as ReturnType<typeof vi.fn>).mock.calls
    const pdfCall = writeFileCalls.find((c) => c[0] === '/tmp/out.pdf')
    expect(pdfCall).toBeDefined()
    expect(pdfCall![1]).toEqual(Buffer.from(pdfBuffer))
  })

  it('calls printToPDF with printBackground: true', async () => {
    ;(dialog.showSaveDialog as ReturnType<typeof vi.fn>).mockResolvedValue({
      canceled: false,
      filePath: '/tmp/out.pdf',
    })

    await exportPdf('/vault/note.md')

    expect(mockWebContents.printToPDF).toHaveBeenCalledWith({ printBackground: true })
  })

  it('reads the source markdown file', async () => {
    ;(dialog.showSaveDialog as ReturnType<typeof vi.fn>).mockResolvedValue({
      canceled: false,
      filePath: '/tmp/out.pdf',
    })

    await exportPdf('/vault/note.md')

    expect(fs.readFile).toHaveBeenCalledWith('/vault/note.md', 'utf-8')
  })
})

// ---------------------------------------------------------------------------
// 2. User cancels save dialog
// ---------------------------------------------------------------------------

describe('file:exportPdf — user cancels dialog', () => {
  it('does not write a PDF when dialog is canceled', async () => {
    ;(dialog.showSaveDialog as ReturnType<typeof vi.fn>).mockResolvedValue({
      canceled: true,
      filePath: undefined,
    })

    await exportPdf('/vault/note.md')

    const writeFileCalls = (fs.writeFile as ReturnType<typeof vi.fn>).mock.calls
    const pdfCall = writeFileCalls.find((c) => c[0] === '/tmp/out.pdf')
    expect(pdfCall).toBeUndefined()
    expect(mockWebContents.printToPDF).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// 3. BrowserWindow cleanup
// ---------------------------------------------------------------------------

describe('file:exportPdf — BrowserWindow cleanup', () => {
  it('destroys the export window after successful export', async () => {
    ;(dialog.showSaveDialog as ReturnType<typeof vi.fn>).mockResolvedValue({
      canceled: false,
      filePath: '/tmp/out.pdf',
    })

    await exportPdf('/vault/note.md')

    expect(mockExportWin.destroy).toHaveBeenCalledTimes(1)
  })

  it('destroys the export window when user cancels', async () => {
    ;(dialog.showSaveDialog as ReturnType<typeof vi.fn>).mockResolvedValue({
      canceled: true,
      filePath: undefined,
    })

    await exportPdf('/vault/note.md')

    expect(mockExportWin.destroy).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// 4. Temp file cleanup
// ---------------------------------------------------------------------------

describe('file:exportPdf — temp file cleanup', () => {
  it('unlinks the temp HTML file after successful export', async () => {
    ;(dialog.showSaveDialog as ReturnType<typeof vi.fn>).mockResolvedValue({
      canceled: false,
      filePath: '/tmp/out.pdf',
    })

    await exportPdf('/vault/note.md')

    expect(fs.unlink).toHaveBeenCalledTimes(1)
    const [unlinkedPath] = (fs.unlink as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(unlinkedPath).toMatch(/\/\._marvinz_export_\d+\.html$/)
  })

  it('unlinks the temp HTML file when user cancels', async () => {
    ;(dialog.showSaveDialog as ReturnType<typeof vi.fn>).mockResolvedValue({
      canceled: true,
      filePath: undefined,
    })

    await exportPdf('/vault/note.md')

    expect(fs.unlink).toHaveBeenCalledTimes(1)
    const [unlinkedPath] = (fs.unlink as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(unlinkedPath).toMatch(/\/\._marvinz_export_\d+\.html$/)
  })

  it('temp file path is in the OS temp dir, not the source directory', async () => {
    ;(dialog.showSaveDialog as ReturnType<typeof vi.fn>).mockResolvedValue({
      canceled: true,
    })

    await exportPdf('/vault/docs/note.md')

    const [unlinkedPath] = (fs.unlink as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(unlinkedPath.startsWith('/tmpdir/')).toBe(true)
    expect(unlinkedPath.startsWith('/vault/docs/')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 5. Vault boundary + hardening (security fix)
// ---------------------------------------------------------------------------

describe('file:exportPdf — vault boundary', () => {
  it('validates the path via assertInVault before reading it', async () => {
    ;(dialog.showSaveDialog as ReturnType<typeof vi.fn>).mockResolvedValue({ canceled: true })

    await exportPdf('/vault/note.md')

    expect(assertInVault).toHaveBeenCalledWith('/vault/note.md')
  })

  it('reads the realpath returned by assertInVault, not the raw input', async () => {
    assertInVault.mockImplementation(async () => '/vault/real/note.md')
    ;(dialog.showSaveDialog as ReturnType<typeof vi.fn>).mockResolvedValue({ canceled: true })

    await exportPdf('/vault/link.md')

    expect(fs.readFile).toHaveBeenCalledWith('/vault/real/note.md', 'utf-8')
  })

  it('never reads the file when the path is outside the vault', async () => {
    assertInVault.mockImplementation(async () => {
      throw new Error('MARVIN_OUTSIDE_VAULT')
    })

    await expect(exportPdf('/etc/passwd')).rejects.toThrow('MARVIN_OUTSIDE_VAULT')
    expect(fs.readFile).not.toHaveBeenCalled()
    expect(BrowserWindow).not.toHaveBeenCalled()
  })
})

describe('file:exportPdf — hardening', () => {
  it('injects a restrictive Content-Security-Policy into the export HTML', async () => {
    ;(dialog.showSaveDialog as ReturnType<typeof vi.fn>).mockResolvedValue({ canceled: true })

    await exportPdf('/vault/note.md')

    const htmlWrite = (fs.writeFile as ReturnType<typeof vi.fn>).mock.calls.find((c) =>
      String(c[0]).endsWith('.html')
    )
    expect(htmlWrite).toBeDefined()
    const html = htmlWrite![1] as string
    expect(html).toContain('Content-Security-Policy')
    expect(html).toContain("default-src 'none'")
  })

  it('creates the export window sandboxed', async () => {
    ;(dialog.showSaveDialog as ReturnType<typeof vi.fn>).mockResolvedValue({ canceled: true })

    await exportPdf('/vault/note.md')

    expect(BrowserWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        webPreferences: expect.objectContaining({ sandbox: true }),
      })
    )
  })
})
