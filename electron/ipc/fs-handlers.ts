// file:*/office:*/path:* IPC handlers — vault-relative fs reads/writes, Office
// (docx/xlsx) conversion, and rename/trash. Extracted from main.ts (#574);
// shared state main.ts still owns (activeVaultPath, the file-content cache,
// the link-rewrite queue, notifyTree) flows in via `FsHandlersCtx` rather
// than a circular import of main.js. assertInVault/wrapFsError also stay
// main.ts-owned (assertInVault closes over activeVaultPath; file:writeBinary,
// folder:create, file:move-batch, shell:reveal, and a snapshot handler all
// call them and are out of scope for this move) and are threaded the same way.
import { ipcMain, BrowserWindow, dialog, shell } from 'electron'
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { assertRenameTargetAvailable } from '../fs-rename-guard.js'
import { resolveConflict } from '../conflictResolver.js'
import type { SnapshotTrigger } from '../snapshot.js'

export type FsHandlersCtx = {
  getActiveVaultPath: () => string | null
  assertInVault: (filePath: string) => Promise<string>
  wrapFsError: (e: unknown) => never
  snapshotBeforeMutation: (
    absPath: string,
    source: SnapshotTrigger,
    precondition: () => boolean,
    readBefore: () => Promise<string | null>
  ) => Promise<void>
  enqueueLinkRewrite: (vaultRoot: string, moves: { src: string; dest: string }[]) => Promise<void>
  notifyTree: () => void
  setFileCacheEntry: (key: string, value: string) => void
}

const FILE_SIZE_LIMIT = 5 * 1024 * 1024 // 5 MB — guard against pathologically large files
const BINARY_PROBE_BYTES = 8192 // any null byte in the first 8 KB → treat as binary

// eslint-disable-next-line no-useless-escape -- \[ inside [] avoids parser ambiguity
const XLSX_SHEET_NAME_RE = /[\[\]:*?/\\]/

export function registerFsHandlers(ctx: FsHandlersCtx): void {
  ipcMain.handle('file:read', async (_e, filePath: string) => {
    try {
      const safe = await ctx.assertInVault(filePath)
      const stats = await fs.stat(safe)
      if (stats.isDirectory()) throw new Error('MARVIN_IS_DIRECTORY')
      if (stats.size > FILE_SIZE_LIMIT) {
        throw new Error(`MARVIN_TOO_LARGE: ${stats.size}`)
      }
      // Sniff the head for null bytes — the standard binary heuristic. Most
      // text formats (utf-8) don't contain literal NUL; most binary files do.
      if (stats.size > 0) {
        const fd = await fs.open(safe, 'r')
        try {
          const probeLen = Math.min(BINARY_PROBE_BYTES, stats.size)
          const probe = Buffer.alloc(probeLen)
          await fd.read(probe, 0, probeLen, 0)
          if (probe.includes(0)) {
            throw new Error('MARVIN_BINARY')
          }
        } finally {
          await fd.close()
        }
      }
      const content = await fs.readFile(safe, 'utf8')
      ctx.setFileCacheEntry(safe, content)
      return content
    } catch (e) {
      ctx.wrapFsError(e)
    }
  })

  ipcMain.handle('file:write', async (_e, filePath: string, content: string) => {
    try {
      const safe = await ctx.assertInVault(filePath)
      // Set by the readBefore resolver below when the write is a no-op (content
      // identical to disk) — a Promise<void> helper can't itself distinguish
      // "no AI turn active" (write must proceed) from "no-op during an AI turn"
      // (write must be skipped), so the resolver signals it via this flag.
      let isNoop = false
      await ctx.snapshotBeforeMutation(
        safe,
        'file:write',
        () => existsSync(safe),
        async () => {
          const before = await fs.readFile(safe, 'utf8')
          // No-op write (content identical to disk): skip both the snapshot
          // and the redundant disk write — nothing actually changed, so
          // snapshotting it would create an empty-seeming turn that still
          // fires the "Claude modified" toast (#535). Skipping the write itself
          // isn't just an optimization: an identical-content fs.writeFile still
          // bumps mtime, which would trigger chokidar's `change` event and let
          // the same spurious toast resurface via snapshotExternalChange (that
          // path has no content-equality guard until #536).
          if (before === content) {
            isNoop = true
            return null
          }
          return before
        }
      )
      if (isNoop) return
      await fs.writeFile(safe, content, 'utf8')
    } catch (e) {
      ctx.wrapFsError(e)
    }
  })

  ipcMain.handle('office:readDocx', async (_e, filePath: string) => {
    const mammoth = await import('mammoth')
    const safe = await ctx.assertInVault(filePath)
    const stats = await fs.stat(safe)
    if (stats.size > 25 * 1024 * 1024) throw new Error(`MARVIN_TOO_LARGE: ${stats.size}`)
    const buf = await fs.readFile(safe)
    const result = await mammoth.convertToHtml({ buffer: buf })
    return { html: result.value, messages: result.messages }
  })

  ipcMain.handle('office:writeDocx', async (_e, filePath: string, plainText: string) => {
    if (plainText.length > 10 * 1024 * 1024) throw new Error('MARVIN_TOO_LARGE')
    const { Document, Paragraph, TextRun, Packer } = await import('docx')
    const safe = await ctx.assertInVault(filePath)
    const paragraphs = plainText
      .split(/\n\n+/)
      .map((text) => new Paragraph({ children: [new TextRun(text)] }))
    const doc = new Document({ sections: [{ children: paragraphs }] })
    const buf = await Packer.toBuffer(doc)
    await fs.writeFile(safe, buf)
  })

  ipcMain.handle('office:readXlsx', async (_e, filePath: string, sheetName?: string) => {
    const XLSX = await import('xlsx')
    const safe = await ctx.assertInVault(filePath)
    const stats = await fs.stat(safe)
    if (stats.size > 25 * 1024 * 1024) throw new Error(`MARVIN_TOO_LARGE: ${stats.size}`)
    const buf = await fs.readFile(safe)
    // cellFormula/cellHTML disabled to reduce parser attack surface (SheetJS CVEs)
    const wb = XLSX.read(buf, { type: 'buffer', cellFormula: false, cellHTML: false })
    const sheetNames = wb.SheetNames
    const targetSheet = sheetName && sheetNames.includes(sheetName) ? sheetName : sheetNames[0]
    const sheet = wb.Sheets[targetSheet]
    const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 })
    const rows = raw.map((r) => (r as unknown[]).map((c) => (c == null ? '' : String(c))))
    return { rows, sheetNames }
  })

  ipcMain.handle(
    'office:writeXlsx',
    async (_e, filePath: string, rows: unknown, sheetName: unknown) => {
      if (
        !Array.isArray(rows) ||
        !rows.every(
          (r) =>
            Array.isArray(r) &&
            r.every((c) => typeof c === 'string' || typeof c === 'number' || c == null)
        )
      ) {
        throw new Error('MARVIN_INVALID_ROWS')
      }
      if (
        typeof sheetName !== 'string' ||
        sheetName.length === 0 ||
        sheetName.length > 31 ||
        XLSX_SHEET_NAME_RE.test(sheetName)
      ) {
        throw new Error('MARVIN_INVALID_SHEET_NAME')
      }
      let totalCells = 0
      for (const r of rows as unknown[][]) {
        totalCells += r.length
        if (totalCells > 1_000_000) throw new Error('MARVIN_TOO_LARGE')
      }
      const XLSX = await import('xlsx')
      const safe = await ctx.assertInVault(filePath)
      const ws = XLSX.utils.aoa_to_sheet(rows as string[][])
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, sheetName)
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
      await fs.writeFile(safe, buf)
    }
  )

  ipcMain.handle('file:create', async (_e, parentDir: string, name: string) => {
    try {
      const safeName = name.endsWith('.md') ? name : `${name}.md`
      const full = path.join(parentDir, safeName)
      const safe = await ctx.assertInVault(full)
      // Pre-check stays: fs.writeFile would silently overwrite an existing file.
      if (existsSync(safe)) throw new Error('MARVIN_FS_EEXIST')
      await fs.mkdir(path.dirname(safe), { recursive: true })
      await fs.writeFile(safe, '', 'utf8')
      ctx.notifyTree()
      return safe
    } catch (e) {
      ctx.wrapFsError(e)
    }
  })

  ipcMain.handle('file:copy', async (_e, srcPath: string, destDir: string): Promise<string> => {
    const safeSrc = await ctx.assertInVault(srcPath)
    const safeDir = await ctx.assertInVault(destDir)
    const destPath = await resolveConflict(safeDir, path.basename(safeSrc), 'copy')
    await fs.cp(safeSrc, destPath, { recursive: true, errorOnExist: false })
    ctx.notifyTree()
    return destPath
  })

  ipcMain.handle('path:rename', async (_e, oldPath: string, newPath: string) => {
    try {
      const safeOld = await ctx.assertInVault(oldPath)
      const safeNew = await ctx.assertInVault(newPath)
      await assertRenameTargetAvailable(safeOld, safeNew)

      // Snapshot the source file before moving if AI turn is active.
      // Trigger is 'file:write', not a distinct 'path:rename' value — a
      // pre-existing mislabel (#569), preserved deliberately here since fixing
      // it changes on-disk manifest data and is a separate, deliberate decision
      // out of scope for this refactor.
      await ctx.snapshotBeforeMutation(
        safeOld,
        'file:write',
        () => existsSync(safeOld),
        () => fs.readFile(safeOld, 'utf8')
      )

      await fs.mkdir(path.dirname(safeNew), { recursive: true })
      await fs.rename(safeOld, safeNew)
      ctx.notifyTree()
      const vaultRoot = ctx.getActiveVaultPath()
      if (vaultRoot) {
        // Fire-and-forget: the full-vault link-rewrite walk is O(vault size),
        // so it must not hold up this handler's response — rename latency
        // would otherwise scale with vault size instead of the renamed file
        // (#566). Still serialized via enqueueLinkRewrite, so it can't race a
        // concurrent file:move-batch/path:rename rewrite over the same files.
        // Accepted trade-off: if the app crashes or is force-quit while this is
        // in flight, some referencing files may be rewritten and others not,
        // with no record beyond the console.error below — the same best-effort
        // characteristic rewriteLinksAfterMoveBatch already has via file:move-batch's
        // internal Promise.all. A graceful quit still waits for it (teardownChildren).
        ctx.enqueueLinkRewrite(vaultRoot, [{ src: safeOld, dest: safeNew }]).catch((err) => {
          console.error('[rewriteLinksAfterMove] failed', err)
        })
      }
      return safeNew
    } catch (e) {
      ctx.wrapFsError(e)
    }
  })

  ipcMain.handle('path:trash', async (_e, target: string) => {
    try {
      const safe = await ctx.assertInVault(target)
      await shell.trashItem(safe)
      ctx.notifyTree()
    } catch (e) {
      ctx.wrapFsError(e)
    }
  })

  ipcMain.handle('file:exportPdf', async (_e, filePath: string) => {
    try {
      // No assertInVault here — pre-existing gap (out of scope for this pure
      // move, tracked separately if ever fixed; see the issue's "Out of scope").
      const content = await fs.readFile(filePath, 'utf-8')
      const dir = path.dirname(filePath)

      const { marked } = await import('marked')
      const bodyHtml = await marked(content)

      const html = `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
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

      const tmpPath = path.join(dir, `._marvinz_export_${Date.now()}.html`)
      await fs.writeFile(tmpPath, html, 'utf-8')

      const exportWin = new BrowserWindow({
        show: false,
        webPreferences: { nodeIntegration: false, contextIsolation: true },
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
    } catch (e) {
      ctx.wrapFsError(e)
    }
  })
}
