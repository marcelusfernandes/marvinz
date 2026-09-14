import { app, BrowserWindow, dialog } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * Markdown → PDF export behind the `file:exportPdf` IPC handler (#464).
 *
 * Kept as a plain function so the unit test drives the real code path with
 * electron/fs mocked, instead of mirroring the handler body in the spec.
 *
 * Security shape:
 *  - the source path goes through `assertInVault` (realpath-resolved) before
 *    any read — a compromised renderer must not turn this into an arbitrary
 *    file read;
 *  - the intermediate HTML is staged in the OS temp dir, never next to the
 *    source, so the handler also cannot be used as an arbitrary write;
 *  - the rendered markdown is untrusted (`marked` does not sanitise), so the
 *    hidden window is sandboxed and carries a CSP with no script/connect
 *    sources: `<script>` and `<img onerror=fetch()>` exfiltration are inert
 *    while local and remote images still render for the PDF.
 */

export type ExportPdfDeps = {
  assertInVault: (filePath: string) => Promise<string>
}

const INSECURE_EXPORT_ENV = 'MARVIN_INSECURE_EXPORT'

const CSP =
  "default-src 'none'; img-src 'self' data: file: marvin: https:; style-src 'unsafe-inline'; font-src 'self' data:;"

/**
 * `baseDir` is the note's real directory: the staged HTML lives in the OS temp
 * dir, so relative image paths (`![](images/x.png)`) need an explicit <base>
 * to keep resolving against the note, as they did when the HTML sat beside it.
 */
function renderHtml(bodyHtml: string, baseDir: string): string {
  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<base href="${pathToFileURL(baseDir).href}/">
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
}

/**
 * Resolve the path to read. The env escape hatch exists for one release as
 * rollback safety (#464 AC); it is loud on purpose.
 */
async function resolveSourcePath(filePath: string, deps: ExportPdfDeps): Promise<string> {
  if (process.env[INSECURE_EXPORT_ENV] === '1') {
    console.warn(
      `[export-pdf] ${INSECURE_EXPORT_ENV}=1: skipping vault boundary check for ${filePath}`
    )
    return filePath
  }
  return deps.assertInVault(filePath)
}

export async function exportMarkdownToPdf(filePath: string, deps: ExportPdfDeps): Promise<void> {
  const safe = await resolveSourcePath(filePath, deps)
  const content = await fs.readFile(safe, 'utf-8')

  const { marked } = await import('marked')
  const html = renderHtml(await marked(content), path.dirname(safe))

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
