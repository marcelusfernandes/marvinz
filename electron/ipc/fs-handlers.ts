// file:*/office:*/path:* IPC handlers — vault-relative fs reads/writes, Office
// (docx/xlsx) conversion, rename/move/trash, and the link-rewrite cascade
// those trigger. Extracted from main.ts (#574; file:writeBinary/file:move-batch
// and the link-rewrite cluster added in #613 — both were out of scope for
// #574 but depend only on assertInVault/wrapFsError/notifyTree, already
// threaded here). Shared state main.ts still owns (activeVaultPath, the
// file-content cache, notifyTree) flows in via `FsHandlersCtx` rather than a
// circular import of main.js. assertInVault/wrapFsError also stay
// main.ts-owned (assertInVault closes over activeVaultPath; folder:create in
// vault-handlers.ts and shell:reveal in shell-menu-handlers.ts also call
// them) and are threaded the same way.
import { ipcMain, BrowserWindow, dialog, shell } from 'electron'
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { assertRenameTargetAvailable } from '../fs-rename-guard.js'
import { resolveConflict } from '../conflictResolver.js'
import { writeSnapshot, newTurnId, type SnapshotTrigger } from '../snapshot.js'
import { isNoisy } from '../noisyPaths.js'
import type { MoveResult } from '../../src/types.js'

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
  notifyTree: () => void
  setFileCacheEntry: (key: string, value: string) => void
}

const FILE_SIZE_LIMIT = 5 * 1024 * 1024 // 5 MB — guard against pathologically large files
const BINARY_PROBE_BYTES = 8192 // any null byte in the first 8 KB → treat as binary

// eslint-disable-next-line no-useless-escape -- \[ inside [] avoids parser ambiguity
const XLSX_SHEET_NAME_RE = /[\[\]:*?/\\]/

// Serializes rewriteLinksAfterMoveBatch across concurrent path:rename/
// file:move-batch calls: two overlapping full-vault walks could otherwise
// race on the same file's read-then-conditionally-write, and whichever write
// lands second would silently clobber the other's rewrite. Chaining every
// call onto this queue guarantees at most one rewrite pass runs at a time,
// in call order (#566).
//
// The queue chain itself must never reject — swallowing the error there (not
// on `run`) keeps a failed rewrite from poisoning every rewrite queued after
// it, while each caller's own `run` promise still rejects independently, so
// callers that await/.catch() it keep seeing their own errors.
let linkRewriteQueue: Promise<void> = Promise.resolve()

// Read by main.ts's teardownChildren() so a graceful quit waits for any
// in-flight fire-and-forget rewrite (#566) — same purpose as the exported
// killAllPty/killAllAgents used for their own teardown coordination. Must be
// a getter (not a snapshot taken at import time): linkRewriteQueue is
// reassigned on every enqueueLinkRewrite call, so this always reads the
// current chain's tail.
export function getLinkRewriteQueue(): Promise<void> {
  return linkRewriteQueue
}

function enqueueLinkRewrite(
  vaultRoot: string,
  moves: { src: string; dest: string }[]
): Promise<void> {
  const run = linkRewriteQueue.then(() => rewriteLinksAfterMoveBatch(vaultRoot, moves))
  linkRewriteQueue = run.catch(() => {})
  return run
}

async function rewriteLinksAfterMoveBatch(
  vaultRoot: string,
  moves: { src: string; dest: string }[]
): Promise<void> {
  const files = await listAllMarkdown(vaultRoot)
  const cascadeTurnId = newTurnId()
  await Promise.all(
    files.map(async (file) => {
      try {
        const original = await fs.readFile(file, 'utf8')
        let content = original
        for (const { src, dest } of moves) {
          content = rewriteOneFile(file, vaultRoot, src, dest, content)
          content = rewriteWikilinksOneFile(vaultRoot, src, dest, content)
        }
        if (content !== original) {
          const relPath = path.relative(vaultRoot, file)
          await writeSnapshot(vaultRoot, cascadeTurnId, relPath, original, 'cascade')
          await fs.writeFile(file, content, 'utf8')
        }
      } catch (err) {
        // Tolerate files that vanished mid-walk; surface anything else.
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          console.error('[rewriteLinksAfterMoveBatch] skipping file', file, err)
        }
      }
    })
  )
}

async function listAllMarkdown(root: string, current = root): Promise<string[]> {
  const out: string[] = []
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fs.readdir(current, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    if (isNoisy(entry.name, entry.isDirectory())) continue
    const full = path.join(current, entry.name)
    if (entry.isDirectory()) {
      out.push(...(await listAllMarkdown(root, full)))
    } else if (entry.isFile() && /\.(md|markdown)$/i.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

// Markdown link patterns we touch:
//   [text](href)         standard link
//   ![alt](href)         image
//   [text](href "title") with title (preserved)
//   [[Name]] / [[Name|Display]] / [[folder/Name]] / [[Name#section]] — wikilinks
const MD_LINK_RE = /(!?)\[((?:\\.|[^\]\\])*)\]\(\s*([^\s)]+)(\s+"[^"]*")?\s*\)/g
const WIKILINK_RE = /\[\[([^[\]\n|]+)(?:\|([^[\]\n]+))?\]\]/g

function rewriteOneFile(
  fileAbsPath: string,
  vaultRoot: string,
  oldPath: string,
  newPath: string,
  content: string
): string {
  // If THIS file IS the moved one (or lives inside a moved folder), its absolute
  // location changed — but its outgoing links were authored relative to its OLD
  // location. So compute "what did href point to before?" using oldDir; then
  // rewrite the link relative to the file's NEW directory.
  // remappedPath maps OLD → NEW; for the inverse (NEW current path → OLD origin)
  // we swap the args.
  const fileOldLocation = remappedPath(fileAbsPath, newPath, oldPath)
  const oldFileDir = path.dirname(fileOldLocation ?? fileAbsPath)
  const newFileDir = path.dirname(fileAbsPath)

  return content.replace(MD_LINK_RE, (match, bang, label, href, title) => {
    if (!href) return match
    if (/^(https?|mailto|data):/i.test(href) || href.startsWith('#')) return match

    const suffixIdx = href.search(/[?#]/)
    const purePath = suffixIdx >= 0 ? href.slice(0, suffixIdx) : href
    const suffix = suffixIdx >= 0 ? href.slice(suffixIdx) : ''
    if (!purePath) return match

    const decoded = safeDecode(purePath)
    // `/`-prefix → vault-root-relative; else → file-relative.
    const isVaultRootRel = decoded.startsWith('/')
    const oldAbsTarget = isVaultRootRel
      ? path.join(vaultRoot, decoded)
      : path.resolve(oldFileDir, decoded)

    // Where does this absolute path live AFTER the rename?
    const newAbsTarget = remappedPath(oldAbsTarget, oldPath, newPath) ?? oldAbsTarget

    // If this file didn't move AND the target didn't move, nothing to do.
    if (!fileOldLocation && newAbsTarget === oldAbsTarget) return match

    // Preserve the form: vault-root-relative stays vault-root-relative.
    const newRel = isVaultRootRel
      ? '/' + path.relative(vaultRoot, newAbsTarget)
      : path.relative(newFileDir, newAbsTarget) || '.'
    const newHref = encodePath(newRel) + suffix
    if (newHref === purePath + suffix) return match

    return `${bang}[${label}](${newHref}${title ?? ''})`
  })
}

function safeDecode(s: string): string {
  try {
    return decodeURI(s)
  } catch {
    return s
  }
}

function encodePath(s: string): string {
  // Encode spaces and a few other chars markdown-safely; preserve / and .
  return s
    .split('/')
    .map((seg) => encodeURIComponent(seg).replace(/%2F/g, '/'))
    .join('/')
}

// If `target` equals `oldPath` or lives inside `oldPath` (treated as a directory),
// returns the equivalent location after rename. Otherwise returns null.
function remappedPath(target: string, oldPath: string, newPath: string): string | null {
  if (target === oldPath) return newPath
  if (target.startsWith(`${oldPath}/`)) return newPath + target.slice(oldPath.length)
  return null
}

function stripMdExt(s: string): string {
  return s.replace(/\.(md|markdown)$/i, '')
}

/**
 * Rewrite `[[wikilinks]]` so they keep resolving after a rename or move.
 *
 * - `[[Foo]]` / `[[Foo|Bar]]` / `[[Foo#sec]]` — rewritten only when a
 *   markdown file is renamed (folder renames don't change basenames).
 * - `[[folder/Foo]]` — rewritten when the resolved path either matches
 *   the renamed file or lives inside a renamed folder.
 */
function rewriteWikilinksOneFile(
  vaultRoot: string,
  oldPath: string,
  newPath: string,
  content: string
): string {
  const oldIsMd = /\.(md|markdown)$/i.test(oldPath)
  const oldBase = oldIsMd ? stripMdExt(path.basename(oldPath)) : ''
  const newBase = oldIsMd ? stripMdExt(path.basename(newPath)) : ''

  return content.replace(WIKILINK_RE, (match, rawName, rawDisplay) => {
    const name = String(rawName)
    const hashIdx = name.indexOf('#')
    const target = hashIdx >= 0 ? name.slice(0, hashIdx) : name
    const fragment = hashIdx >= 0 ? name.slice(hashIdx) : ''
    const displaySuffix = rawDisplay ? `|${rawDisplay}` : ''

    if (target.includes('/')) {
      const withExt = /\.(md|markdown)$/i.test(target) ? target : `${target}.md`
      const abs = path.join(vaultRoot, withExt)
      const remapped = remappedPath(abs, oldPath, newPath)
      if (!remapped) return match
      const newRel = path.relative(vaultRoot, remapped)
      return `[[${stripMdExt(newRel)}${fragment}${displaySuffix}]]`
    }

    if (!oldIsMd) return match
    if (stripMdExt(target) !== oldBase) return match
    return `[[${newBase}${fragment}${displaySuffix}]]`
  })
}

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
        enqueueLinkRewrite(vaultRoot, [{ src: safeOld, dest: safeNew }]).catch((err) => {
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

  ipcMain.handle(
    'file:writeBinary',
    async (
      _e,
      payload: { vaultPath: string; relPath: string; base64Bytes: string; maxBytes?: number }
    ) => {
      try {
        const { vaultPath, relPath, base64Bytes, maxBytes } = payload
        const absolute = path.join(vaultPath, relPath)
        const safe = await ctx.assertInVault(absolute)
        const limit = maxBytes ?? 25 * 1024 * 1024
        // Cheap raw-length gate BEFORE decoding: base64 packs 3 bytes per 4 chars, so a
        // string longer than (limit * 4 / 3) + 4 always decodes past the cap. Rejecting
        // here avoids allocating a huge Buffer in main-process RAM for a hostile renderer.
        if (base64Bytes.length > Math.floor((limit * 4) / 3) + 4) {
          throw new Error('MARVIN_TOO_LARGE: payload')
        }
        // Exact check on decoded length catches adversarial padding under the raw gate.
        const decoded = Buffer.from(base64Bytes, 'base64')
        if (decoded.length > limit) throw new Error(`MARVIN_TOO_LARGE: ${decoded.length}`)
        await fs.mkdir(path.dirname(safe), { recursive: true })
        await fs.writeFile(safe, decoded)
        return path.relative(vaultPath, safe)
      } catch (e) {
        ctx.wrapFsError(e)
      }
    }
  )

  ipcMain.handle(
    'file:move-batch',
    async (_e, srcs: string[], destDir: string): Promise<MoveResult[]> => {
      const safeDir = await ctx.assertInVault(destDir)
      const results: MoveResult[] = []
      const moved: { src: string; dest: string }[] = []
      for (const src of srcs) {
        try {
          const safeSrc = await ctx.assertInVault(src)
          const destPath = await resolveConflict(safeDir, path.basename(safeSrc), 'move')
          await fs.mkdir(path.dirname(destPath), { recursive: true })
          try {
            await fs.rename(safeSrc, destPath)
          } catch (err) {
            // EXDEV: src and dest on different filesystems (e.g., USB vault → internal disk).
            if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err
            await fs.cp(safeSrc, destPath, { recursive: true })
            await fs.rm(safeSrc, { recursive: true, force: true })
          }
          moved.push({ src: safeSrc, dest: destPath })
          results.push({ src, dest: destPath, ok: true })
        } catch (err) {
          results.push({ src, dest: '', ok: false, error: (err as Error).message })
        }
      }
      // Single vault walk for all successful moves — avoids O(N×M) listAllMarkdown calls.
      // Serialized via enqueueLinkRewrite so this can't race path:rename's own
      // fire-and-forget rewrite over the same files (#566).
      const vaultRoot = ctx.getActiveVaultPath()
      if (vaultRoot && moved.length > 0) {
        try {
          await enqueueLinkRewrite(vaultRoot, moved)
        } catch (err) {
          console.error('[rewriteLinksAfterMove] move-batch failed', err)
        }
      }
      ctx.notifyTree()
      return results
    }
  )
}
