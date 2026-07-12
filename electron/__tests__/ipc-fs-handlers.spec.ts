/**
 * Characterization tests for electron/ipc/fs-handlers.ts (#574; file:writeBinary
 * and file:move-batch added in #613 — both were out of scope for #574,
 * deferred because they also called main.ts-owned assertInVault/wrapFsError,
 * which are still threaded here the same way).
 *
 * Coverage per moved handler (13 total):
 *   - file:read, file:write, path:rename — real-handler integration coverage
 *     via main.ts's side-effect import in other specs
 *     (file-write-noop-snapshot.spec.ts, path-rename-*.spec.ts,
 *     vault-switch-state-reset.spec.ts, watcher-snapshot-content-guard.spec.ts).
 *     Those keep running unmodified post-move and prove the ctx wiring in
 *     main.ts is correct (breaking the register() call there fails them with
 *     "ipcMain.handle was never called for channel ...").
 *   - office:readXlsx, office:writeXlsx — NOT re-tested here; already
 *     exercised by office-xlsx.spec.ts's logic-replication tests, and the
 *     move doesn't touch their internals, only where they're registered from.
 *   - office:readDocx, office:writeDocx, file:copy, file:exportPdf,
 *     file:create, path:trash, file:writeBinary, file:move-batch — had ZERO
 *     real-handler coverage before their respective moves (office:readDocx/
 *     writeDocx only had "replicate the logic" unit tests elsewhere; the
 *     rest had none at all). Covered in this file, tested directly against
 *     registerFsHandlers(ctx) + a fake ctx, same pattern as
 *     ipc-pty-handlers.spec.ts (#570).
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { registerFsHandlers, type FsHandlersCtx } from '../ipc/fs-handlers.js'
import { ipcMain, BrowserWindow, dialog, shell } from 'electron'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { fakeExportWin } = vi.hoisted(() => {
  const fakeExportWin = {
    loadFile: vi.fn(async () => {}),
    webContents: { printToPDF: vi.fn(async () => Buffer.from('%PDF-fake')) },
    destroy: vi.fn(),
  }
  return { fakeExportWin }
})

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  BrowserWindow: vi.fn(function () {
    return fakeExportWin
  }),
  dialog: { showSaveDialog: vi.fn(async () => ({ canceled: true, filePath: undefined })) },
  shell: { trashItem: vi.fn(async () => {}) },
}))

vi.mock('mammoth', () => ({
  convertToHtml: vi.fn(async () => ({ value: '<p>hi</p>', messages: [] })),
}))

vi.mock('docx', () => ({
  Document: class {
    opts: unknown
    constructor(opts: unknown) {
      this.opts = opts
    }
  },
  Paragraph: class {
    opts: unknown
    constructor(opts: unknown) {
      this.opts = opts
    }
  },
  TextRun: class {
    text: unknown
    constructor(text: unknown) {
      this.text = text
    }
  },
  Packer: { toBuffer: vi.fn(async () => Buffer.from('fake-docx-bytes')) },
}))

vi.mock('marked', () => ({
  marked: vi.fn(async (content: string) => `<p>${content}</p>`),
}))

let vault: string

function makeCtx(overrides: Partial<FsHandlersCtx> = {}): FsHandlersCtx {
  return {
    getActiveVaultPath: () => vault,
    assertInVault: vi.fn(async (filePath: string) => filePath),
    wrapFsError: vi.fn((e: unknown) => {
      throw e
    }) as FsHandlersCtx['wrapFsError'],
    snapshotBeforeMutation: vi.fn(async () => {}),
    notifyTree: vi.fn(),
    setFileCacheEntry: vi.fn(),
    ...overrides,
  }
}

function getHandler(channel: string): (...args: unknown[]) => unknown {
  const calls = (ipcMain.handle as Mock).mock.calls
  const call = calls.find((c: unknown[]) => c[0] === channel)
  if (!call) throw new Error(`handler not registered: ${channel}`)
  return call[1] as (...args: unknown[]) => unknown
}

beforeEach(async () => {
  const raw = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-fs-ipc-'))
  vault = await fs.realpath(raw)
  ;(ipcMain.handle as Mock).mockClear()
  fakeExportWin.loadFile.mockClear()
  fakeExportWin.destroy.mockClear()
  ;(dialog.showSaveDialog as Mock).mockClear()
  ;(BrowserWindow as unknown as Mock).mockClear()
  ;(shell.trashItem as Mock).mockClear()
})

afterEach(async () => {
  await fs.rm(vault, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// office:readDocx / office:writeDocx — zero prior real-handler coverage
// ---------------------------------------------------------------------------

describe('office:readDocx', () => {
  it('reads through assertInVault and returns mammoth html', async () => {
    const filePath = path.join(vault, 'doc.docx')
    await fs.writeFile(filePath, Buffer.from('fake-docx-content'))
    const ctx = makeCtx()
    registerFsHandlers(ctx)

    const result = await getHandler('office:readDocx')(null, filePath)

    expect(ctx.assertInVault).toHaveBeenCalledWith(filePath)
    expect(result).toEqual({ html: '<p>hi</p>', messages: [] })
  })
})

describe('office:writeDocx', () => {
  it('writes through assertInVault using the packed docx buffer', async () => {
    const filePath = path.join(vault, 'out.docx')
    const ctx = makeCtx()
    registerFsHandlers(ctx)

    await getHandler('office:writeDocx')(null, filePath, 'Hello\n\nWorld')

    expect(ctx.assertInVault).toHaveBeenCalledWith(filePath)
    const written = await fs.readFile(filePath, 'utf8')
    expect(written).toBe('fake-docx-bytes')
  })
})

// ---------------------------------------------------------------------------
// file:copy — no prior real-handler coverage
// ---------------------------------------------------------------------------

describe('file:copy', () => {
  it('copies the source into the destination dir and notifies the tree', async () => {
    const srcPath = path.join(vault, 'note.md')
    await fs.writeFile(srcPath, '# Note', 'utf8')
    const destDir = path.join(vault, 'dest')
    await fs.mkdir(destDir)
    const ctx = makeCtx()
    registerFsHandlers(ctx)

    const result = await getHandler('file:copy')(null, srcPath, destDir)

    expect(ctx.assertInVault).toHaveBeenCalledWith(srcPath)
    expect(ctx.assertInVault).toHaveBeenCalledWith(destDir)
    expect(result).toBe(path.join(destDir, 'Copy of note.md'))
    expect(await fs.readFile(result as string, 'utf8')).toBe('# Note')
    expect(ctx.notifyTree).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// file:exportPdf — the one handler WITHOUT assertInVault (pre-existing gap,
// out of scope for #574; pinned here the same way #570 pinned pty:kill's
// preserved .kill()).
// ---------------------------------------------------------------------------

describe('file:exportPdf', () => {
  it('does NOT call assertInVault — pre-existing gap preserved, not fixed', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-fs-ipc-outside-'))
    const filePath = path.join(dir, 'outside-vault.md')
    await fs.writeFile(filePath, '# Outside the vault', 'utf8')
    // A vault-boundary check would throw on a path outside `vault` — if this
    // handler ever gains an assertInVault call, this mock throws and the
    // test fails, proving the check ran.
    const ctx = makeCtx({
      assertInVault: vi.fn(async () => {
        throw new Error('MARVIN_OUTSIDE_VAULT')
      }),
    })
    registerFsHandlers(ctx)

    await expect(getHandler('file:exportPdf')(null, filePath)).resolves.toBeUndefined()

    expect(ctx.assertInVault).not.toHaveBeenCalled()
    expect(dialog.showSaveDialog).toHaveBeenCalledTimes(1)
    expect(fakeExportWin.destroy).toHaveBeenCalledTimes(1)

    await fs.rm(dir, { recursive: true, force: true })
  })
})

// ---------------------------------------------------------------------------
// file:create — no prior real-handler coverage
// ---------------------------------------------------------------------------

describe('file:create', () => {
  it('creates a new .md file through assertInVault and notifies the tree', async () => {
    const ctx = makeCtx()
    registerFsHandlers(ctx)

    const result = await getHandler('file:create')(null, vault, 'new-note')

    expect(ctx.assertInVault).toHaveBeenCalledWith(path.join(vault, 'new-note.md'))
    expect(result).toBe(path.join(vault, 'new-note.md'))
    expect(await fs.readFile(result as string, 'utf8')).toBe('')
    expect(ctx.notifyTree).toHaveBeenCalledTimes(1)
  })

  it('throws MARVIN_FS_EEXIST when the file already exists', async () => {
    const existing = path.join(vault, 'already-there.md')
    await fs.writeFile(existing, '# existing', 'utf8')
    const ctx = makeCtx()
    registerFsHandlers(ctx)

    await expect(getHandler('file:create')(null, vault, 'already-there')).rejects.toThrow(
      'MARVIN_FS_EEXIST'
    )
  })
})

// ---------------------------------------------------------------------------
// path:trash — no prior real-handler coverage
// ---------------------------------------------------------------------------

describe('path:trash', () => {
  it('trashes the file through assertInVault and notifies the tree', async () => {
    const target = path.join(vault, 'to-trash.md')
    await fs.writeFile(target, '# gone soon', 'utf8')
    const ctx = makeCtx()
    registerFsHandlers(ctx)

    await getHandler('path:trash')(null, target)

    expect(ctx.assertInVault).toHaveBeenCalledWith(target)
    expect(shell.trashItem).toHaveBeenCalledWith(target)
    expect(ctx.notifyTree).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// file:writeBinary — no prior real-handler coverage (#613; out of scope for #574)
// ---------------------------------------------------------------------------

describe('file:writeBinary', () => {
  it('writes decoded base64 bytes through assertInVault and returns the vault-relative path', async () => {
    const ctx = makeCtx()
    registerFsHandlers(ctx)
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]) // arbitrary binary content

    const result = await getHandler('file:writeBinary')(null, {
      vaultPath: vault,
      relPath: 'image.png',
      base64Bytes: bytes.toString('base64'),
    })

    expect(ctx.assertInVault).toHaveBeenCalledWith(path.join(vault, 'image.png'))
    expect(result).toBe('image.png')
    expect(await fs.readFile(path.join(vault, 'image.png'))).toEqual(bytes)
  })

  it('rejects a payload whose decoded size exceeds maxBytes with MARVIN_TOO_LARGE', async () => {
    const ctx = makeCtx()
    registerFsHandlers(ctx)
    const bytes = Buffer.from('this decodes to more than the tiny cap below')

    await expect(
      getHandler('file:writeBinary')(null, {
        vaultPath: vault,
        relPath: 'oversized.bin',
        base64Bytes: bytes.toString('base64'),
        maxBytes: 4,
      })
    ).rejects.toThrow(/MARVIN_TOO_LARGE/)
  })
})

// ---------------------------------------------------------------------------
// file:move-batch — no prior real-handler coverage (#613; out of scope for #574)
// ---------------------------------------------------------------------------

describe('file:move-batch', () => {
  it('moves each source into destDir, rewrites referencing links, and notifies the tree', async () => {
    const srcPath = path.join(vault, 'note.md')
    await fs.writeFile(srcPath, '# Note', 'utf8')
    const referencingPath = path.join(vault, 'referencing.md')
    await fs.writeFile(referencingPath, 'See [note](note.md) for details.', 'utf8')
    const destDir = path.join(vault, 'dest')
    await fs.mkdir(destDir)
    const ctx = makeCtx()
    registerFsHandlers(ctx)

    const results = await getHandler('file:move-batch')(null, [srcPath], destDir)

    const destPath = path.join(destDir, 'note.md')
    expect(results).toEqual([{ src: srcPath, dest: destPath, ok: true }])
    expect(await fs.readFile(destPath, 'utf8')).toBe('# Note')
    // Link-rewrite is awaited inline here (unlike path:rename's fire-and-forget),
    // so by the time the handler resolves the referencing file is already rewritten.
    expect(await fs.readFile(referencingPath, 'utf8')).toBe('See [note](dest/note.md) for details.')
    expect(ctx.notifyTree).toHaveBeenCalledTimes(1)
  })

  it('reports per-item ok:false without aborting the batch when one source fails assertInVault', async () => {
    const goodSrc = path.join(vault, 'good.md')
    await fs.writeFile(goodSrc, '# good', 'utf8')
    const badSrc = path.join('/outside', 'bad.md')
    const destDir = path.join(vault, 'dest')
    await fs.mkdir(destDir)
    const ctx = makeCtx({
      assertInVault: vi.fn(async (filePath: string) => {
        if (filePath === badSrc) throw new Error('MARVIN_OUTSIDE_VAULT')
        return filePath
      }),
    })
    registerFsHandlers(ctx)

    const results = await getHandler('file:move-batch')(null, [goodSrc, badSrc], destDir)

    expect(results).toEqual([
      { src: goodSrc, dest: path.join(destDir, 'good.md'), ok: true },
      { src: badSrc, dest: '', ok: false, error: 'MARVIN_OUTSIDE_VAULT' },
    ])
  })

  it('falls back to copy+remove when rename fails with EXDEV (cross-filesystem move)', async () => {
    const srcPath = path.join(vault, 'cross-fs.md')
    await fs.writeFile(srcPath, '# cross fs', 'utf8')
    const destDir = path.join(vault, 'dest')
    await fs.mkdir(destDir)
    const ctx = makeCtx()
    registerFsHandlers(ctx)

    const renameSpy = vi
      .spyOn(fs, 'rename')
      .mockRejectedValueOnce(
        Object.assign(new Error('EXDEV: cross-device link not permitted'), { code: 'EXDEV' })
      )

    const results = await getHandler('file:move-batch')(null, [srcPath], destDir)

    const destPath = path.join(destDir, 'cross-fs.md')
    expect(results).toEqual([{ src: srcPath, dest: destPath, ok: true }])
    expect(await fs.readFile(destPath, 'utf8')).toBe('# cross fs')
    await expect(fs.access(srcPath)).rejects.toThrow() // removed from source after cp
    renameSpy.mockRestore()
  })
})
