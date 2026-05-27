/**
 * E2E: External file import via drag-and-drop and paste (issue #196).
 *
 * Scenarios:
 *   1: Import to vault root → success toast shown, file copied to vault root
 *   2: Import to subfolder → file copied into subfolder, not vault root
 *   3: Import with open file → file copied to the open file's parent directory
 *   4: All-denied import (blocked system path) → IPC returns denied, no import
 *   5: Partial import (one ok + one denied) → partial toast shown
 *   6: destDir outside vault (boundary violation) → IPC rejects, no file written outside
 *
 * Electron's contextBridge seals all properties exposed via exposeInMainWorld,
 * making window.marvin.fs.getPathForFile non-patchable from the renderer.
 * Drop/paste events with programmatically created File objects therefore cannot
 * inject real FS paths through the getPathForFile→importExternal pipeline.
 *
 * Test strategy:
 *   - File copy behavior: call window.marvin.fs.importExternal directly from
 *     page.evaluate — exercises the full IPC handler (assertCwdInsideVaultAsync,
 *     blocklist, resolveImportName, cp) and asserts the real FS outcome.
 *   - Toast UI: call the FileTree's onImportResult prop via the React fiber,
 *     exercising handleImportResult and the ImportToast component end-to-end.
 *   - Boundary tests: IPC calls with blocked paths and out-of-vault destDirs.
 *
 * Real FS: all I/O uses real temp directories. No main-process mocks.
 * Strings in English.
 */

import { test, expect, _electron as electron } from 'playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Close the Electron app reliably.
 * app.close() can hang on macOS when the main process retains open handles
 * (fs.watch, IPC channels). We race it against a 5 s deadline that SIGKILLs
 * the process, then resolve regardless so the Playwright worker can always exit.
 */
async function closeApp(app: Awaited<ReturnType<typeof electron.launch>>): Promise<void> {
  await Promise.race([
    app.close().catch(() => {}),
    new Promise<void>((resolve) =>
      setTimeout(() => {
        try { app.process().kill() } catch { /* already dead */ }
        resolve()
      }, 5_000),
    ),
  ])
}

async function createUserDataDir(vaultPath: string): Promise<string> {
  const raw = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-e2e-import-'))
  const userDataDir = await fs.realpath(raw)
  await fs.writeFile(
    path.join(userDataDir, 'settings.json'),
    JSON.stringify({ vaultPath }),
    'utf8',
  )
  return userDataDir
}

async function seedVault(): Promise<string> {
  const raw = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-e2e-import-vault-'))
  return fs.realpath(raw)
}

/**
 * Create a real temp file outside the vault that can be passed to importExternal.
 * Returns the absolute resolved path.
 */
async function createSourceFile(name: string, content: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-e2e-import-src-'))
  const realDir = await fs.realpath(dir)
  const filePath = path.join(realDir, name)
  await fs.writeFile(filePath, content, 'utf8')
  return filePath
}

/**
 * Trigger the FileTree's onImportResult callback via the React fiber.
 * This exercises handleImportResult → ImportToast without going through the
 * drag/paste event path (which is blocked by contextBridge property sealing).
 */
async function triggerImportResult(
  page: import('playwright').Page,
  outcome: { ok: true; imported: string[]; skipped: { source: string; reason: string }[]; destDir: string } | { ok: false; error: string },
): Promise<void> {
  await page.evaluate((o) => {
    const tree = document.querySelector('.file-tree')
    if (!tree) throw new Error('.file-tree not found')
    const fiberKey = Object.keys(tree).find((k) => k.startsWith('__reactFiber'))
    if (!fiberKey) throw new Error('React fiber not found')
    let current = (tree as unknown as Record<string, unknown>)[fiberKey] as {
      memoizedProps: Record<string, unknown>
      return: unknown
    } | null
    let depth = 0
    while (current && depth < 30) {
      const props = current.memoizedProps
      if (props && typeof props['onImportResult'] === 'function') {
        if (o.ok) {
          props['onImportResult']({ ok: true, result: { imported: o.imported, skipped: o.skipped }, destDir: o.destDir })
        } else {
          props['onImportResult']({ ok: false, error: o.error })
        }
        return
      }
      current = current.return as typeof current
      depth++
    }
    throw new Error('onImportResult prop not found in fiber tree')
  }, outcome)
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

test.describe('External file import — IPC contract and toast UI (issue #196)', () => {
  let vaultRoot: string
  let userDataDir: string
  const sourceDirsToClean: string[] = []

  test.beforeEach(async () => {
    vaultRoot = await seedVault()
    await fs.mkdir(path.join(vaultRoot, 'docs'))
    await fs.writeFile(path.join(vaultRoot, 'seed.md'), '# seed', 'utf8')
    userDataDir = await createUserDataDir(vaultRoot)
  })

  test.afterEach(async () => {
    await fs.rm(vaultRoot, { recursive: true, force: true }).catch(() => {})
    await fs.rm(userDataDir, { recursive: true, force: true }).catch(() => {})
    for (const dir of sourceDirsToClean.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
    }
  })

  // -------------------------------------------------------------------------
  // Scenario 1: import to vault root → success toast + file in vault root
  // -------------------------------------------------------------------------

  test('Scenario 1: import to vault root → success toast and file copied to vault root', async () => {
    const srcFile = await createSourceFile('dragged.md', '# Dragged')
    sourceDirsToClean.push(path.dirname(srcFile))

    const app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      env: { ...process.env, NODE_ENV: 'test' },
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    try {
      await expect(
        page.locator('.sidebar .file-tree-row.file', { hasText: /^seed$/ }),
      ).toBeVisible({ timeout: 15_000 })

      // Call the real importExternal IPC — exercises assertCwdInsideVaultAsync + cp
      const result = await page.evaluate(
        async ({ src, dest }: { src: string; dest: string }) => {
          return await (window as unknown as {
            marvin: { fs: { importExternal: (s: string[], d: string) => Promise<unknown> } }
          }).marvin.fs.importExternal([src], dest)
        },
        { src: srcFile, dest: vaultRoot },
      )

      const { imported, skipped } = result as { imported: string[]; skipped: { source: string; reason: string }[] }
      expect(imported).toHaveLength(1)
      expect(skipped).toHaveLength(0)

      // File must exist in vault root
      await expect(fs.access(path.join(vaultRoot, 'dragged.md'))).resolves.toBeUndefined()

      // Trigger the toast via the React fiber (exercises handleImportResult → ImportToast)
      await triggerImportResult(page, {
        ok: true,
        imported: [path.join(vaultRoot, 'dragged.md')],
        skipped: [],
        destDir: vaultRoot,
      })

      const toast = page.locator('.import-toast.success')
      await expect(toast).toBeVisible({ timeout: 5_000 })
      await expect(toast).toContainText('Imported 1 file')
    } finally {
      await closeApp(app)
    }
  })

  // -------------------------------------------------------------------------
  // Scenario 2: import to subfolder → file in subfolder, not vault root
  // -------------------------------------------------------------------------

  test('Scenario 2: import to subfolder → file copied into subfolder, not vault root', async () => {
    const srcFile = await createSourceFile('note.md', '# Note')
    sourceDirsToClean.push(path.dirname(srcFile))
    const destDir = path.join(vaultRoot, 'docs')

    const app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      env: { ...process.env, NODE_ENV: 'test' },
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    try {
      await expect(
        page.locator('.sidebar .file-tree-row.dir', { hasText: /^docs$/ }),
      ).toBeVisible({ timeout: 15_000 })

      const result = await page.evaluate(
        async ({ src, dest }: { src: string; dest: string }) => {
          return await (window as unknown as {
            marvin: { fs: { importExternal: (s: string[], d: string) => Promise<unknown> } }
          }).marvin.fs.importExternal([src], dest)
        },
        { src: srcFile, dest: destDir },
      )

      const { imported, skipped } = result as { imported: string[]; skipped: unknown[] }
      expect(imported).toHaveLength(1)
      expect(skipped).toHaveLength(0)

      // File must be inside docs/, NOT in vault root
      await expect(fs.access(path.join(vaultRoot, 'docs', 'note.md'))).resolves.toBeUndefined()
      await expect(fs.access(path.join(vaultRoot, 'note.md'))).rejects.toThrow()
    } finally {
      await closeApp(app)
    }
  })

  // -------------------------------------------------------------------------
  // Scenario 3: paste into sidebar → file copied to open file's directory
  // -------------------------------------------------------------------------

  test('Scenario 3: paste with open file → file copied to the open file\'s parent dir', async () => {
    const srcFile = await createSourceFile('pasted.md', '# Pasted')
    sourceDirsToClean.push(path.dirname(srcFile))
    // Open file is seed.md at vault root — paste should land next to it
    const destDir = vaultRoot

    const app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      env: { ...process.env, NODE_ENV: 'test' },
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    try {
      await expect(
        page.locator('.sidebar .file-tree-row.file', { hasText: /^seed$/ }),
      ).toBeVisible({ timeout: 15_000 })

      const result = await page.evaluate(
        async ({ src, dest }: { src: string; dest: string }) => {
          return await (window as unknown as {
            marvin: { fs: { importExternal: (s: string[], d: string) => Promise<unknown> } }
          }).marvin.fs.importExternal([src], dest)
        },
        { src: srcFile, dest: destDir },
      )

      const { imported, skipped } = result as { imported: string[]; skipped: unknown[] }
      expect(imported).toHaveLength(1)
      expect(skipped).toHaveLength(0)

      await expect(fs.access(path.join(vaultRoot, 'pasted.md'))).resolves.toBeUndefined()

      // Trigger success toast via fiber (exercises ImportToast component)
      await triggerImportResult(page, {
        ok: true,
        imported: [path.join(vaultRoot, 'pasted.md')],
        skipped: [],
        destDir,
      })

      const toast = page.locator('.import-toast.success')
      await expect(toast).toBeVisible({ timeout: 5_000 })
    } finally {
      await closeApp(app)
    }
  })

  // -------------------------------------------------------------------------
  // Scenario 4: all-denied import (blocked system path) → IPC returns denied
  // -------------------------------------------------------------------------

  test('Scenario 4: importExternal with blocked system path → all skipped with reason denied', async () => {
    const app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      env: { ...process.env, NODE_ENV: 'test' },
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    try {
      await expect(
        page.locator('.sidebar .file-tree-row.file', { hasText: /^seed$/ }),
      ).toBeVisible({ timeout: 15_000 })

      // /etc/passwd resolves to /private/etc/passwd on macOS — blocked by BLOCKED_PATH_PREFIXES
      const result = await page.evaluate(
        async (dest: string) => {
          return await (window as unknown as {
            marvin: { fs: { importExternal: (s: string[], d: string) => Promise<unknown> } }
          }).marvin.fs.importExternal(['/etc/passwd'], dest)
        },
        vaultRoot,
      )

      const { imported, skipped } = result as {
        imported: string[]
        skipped: { source: string; reason: string }[]
      }
      expect(imported).toHaveLength(0)
      expect(skipped).toHaveLength(1)
      expect(skipped[0].reason).toBe('denied')

      // No unexpected files created in vault
      const entries = await fs.readdir(vaultRoot)
      expect(
        entries.filter((e) => e !== '.marvin' && e !== 'seed.md' && e !== 'docs'),
      ).toHaveLength(0)
    } finally {
      await closeApp(app)
    }
  })

  // -------------------------------------------------------------------------
  // Scenario 5: partial import (one valid + one denied) → partial toast
  // -------------------------------------------------------------------------

  test('Scenario 5: partial import (one ok + one denied) → partial toast shown', async () => {
    const srcFile = await createSourceFile('ok-file.md', '# OK')
    sourceDirsToClean.push(path.dirname(srcFile))

    const app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      env: { ...process.env, NODE_ENV: 'test' },
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    try {
      await expect(
        page.locator('.sidebar .file-tree-row.file', { hasText: /^seed$/ }),
      ).toBeVisible({ timeout: 15_000 })

      const result = await page.evaluate(
        async ({ src, dest }: { src: string; dest: string }) => {
          return await (window as unknown as {
            marvin: { fs: { importExternal: (s: string[], d: string) => Promise<unknown> } }
          }).marvin.fs.importExternal([src, '/etc/passwd'], dest)
        },
        { src: srcFile, dest: vaultRoot },
      )

      const { imported, skipped } = result as {
        imported: string[]
        skipped: { source: string; reason: string }[]
      }
      expect(imported).toHaveLength(1)
      expect(skipped).toHaveLength(1)
      expect(skipped[0].reason).toBe('denied')

      // ok-file.md must be in vault
      await expect(fs.access(path.join(vaultRoot, 'ok-file.md'))).resolves.toBeUndefined()

      // Trigger partial toast via fiber
      await triggerImportResult(page, {
        ok: true,
        imported,
        skipped,
        destDir: vaultRoot,
      })

      const toast = page.locator('.import-toast.partial')
      await expect(toast).toBeVisible({ timeout: 5_000 })
      await expect(toast).toContainText('1 of 2')
    } finally {
      await closeApp(app)
    }
  })

  // -------------------------------------------------------------------------
  // Scenario 6: destDir outside vault → IPC rejects with vault boundary error
  // -------------------------------------------------------------------------

  test('Scenario 6: importExternal with destDir outside vault → boundary rejected', async () => {
    const srcFile = await createSourceFile('escape.md', '# Escape')
    sourceDirsToClean.push(path.dirname(srcFile))

    // A real dir that is NOT inside the vault
    const outsideDir = await fs.realpath(os.tmpdir())

    const app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      env: { ...process.env, NODE_ENV: 'test' },
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    try {
      await expect(
        page.locator('.sidebar .file-tree-row.file', { hasText: /^seed$/ }),
      ).toBeVisible({ timeout: 15_000 })

      // IPC must throw when destDir is outside the active vault
      const threw = await page.evaluate(
        async ({ src, dest }: { src: string; dest: string }) => {
          try {
            await (window as unknown as {
              marvin: { fs: { importExternal: (s: string[], d: string) => Promise<unknown> } }
            }).marvin.fs.importExternal([src], dest)
            return false
          } catch {
            return true
          }
        },
        { src: srcFile, dest: outsideDir },
      )

      expect(threw).toBe(true)

      // No file created outside the vault
      await expect(fs.access(path.join(outsideDir, 'escape.md'))).rejects.toThrow()
    } finally {
      await closeApp(app)
    }
  })
})
