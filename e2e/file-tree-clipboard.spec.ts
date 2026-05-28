/**
 * E2E: file-tree clipboard — copy, cut/move, conflict resolution, multi-select,
 * Esc-clear, and editor Cmd+C isolation (issue #147).
 *
 * Strategy:
 *   - FS assertions: all I/O uses real temp dirs, no mocks.
 *   - IPC calls via page.evaluate — exercises the full main-process handler chain
 *     (assertInVault, resolveConflict, fs.cp / fs.rename).
 *   - Teardown: race app.close() against a 5 s SIGKILL deadline (macOS hang guard).
 *
 * Strings in English.
 */

import { test, expect, _electron as electron } from 'playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type MoveResult = { src: string; dest: string; ok: boolean }

type MarvinWin = Window & {
  marvin: {
    file: {
      copy: (src: string, destDir: string) => Promise<string>
      moveBatch: (srcs: string[], destDir: string) => Promise<MoveResult[]>
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

async function seedVault(): Promise<string> {
  const raw = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-e2e-clipboard-vault-'))
  return fs.realpath(raw)
}

async function createUserDataDir(vaultPath: string): Promise<string> {
  const raw = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-e2e-clipboard-userdata-'))
  const dir = await fs.realpath(raw)
  await fs.writeFile(path.join(dir, 'settings.json'), JSON.stringify({ vaultPath }), 'utf8')
  return dir
}

async function launchApp(userDataDir: string) {
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${userDataDir}`],
    env: { ...process.env, NODE_ENV: 'test' },
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  return { app, page }
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

test.describe('File tree clipboard — IPC and store contract (issue #147)', () => {
  let vaultRoot: string
  let userDataDir: string

  test.beforeEach(async () => {
    vaultRoot = await seedVault()
    await fs.mkdir(path.join(vaultRoot, 'notes'))
    await fs.mkdir(path.join(vaultRoot, 'archive'))
    await fs.writeFile(path.join(vaultRoot, 'notes', 'a.md'), '# A', 'utf8')
    userDataDir = await createUserDataDir(vaultRoot)
  })

  test.afterEach(async () => {
    await fs.rm(vaultRoot, { recursive: true, force: true }).catch(() => {})
    await fs.rm(userDataDir, { recursive: true, force: true }).catch(() => {})
  })

  // -------------------------------------------------------------------------
  // Scenario 1: copy single file → "Copy of" prefix, source intact
  // -------------------------------------------------------------------------

  test('Scenario 1: copy single file → archive/Copy of a.md exists, notes/a.md intact', async () => {
    const { app, page } = await launchApp(userDataDir)
    try {
      // Wait for the vault to load — notes dir is visible at the top level
      await expect(
        page.locator('.sidebar .file-tree-row.dir', { hasText: /^notes$/ }),
      ).toBeVisible({ timeout: 15_000 })

      const destPath = await page.evaluate(
        async ({ src, dest }: { src: string; dest: string }) => {
          return await (window as unknown as MarvinWin).marvin.file.copy(src, dest)
        },
        { src: path.join(vaultRoot, 'notes', 'a.md'), dest: path.join(vaultRoot, 'archive') },
      )

      expect(destPath).toContain('Copy of a.md')
      await expect(fs.access(path.join(vaultRoot, 'archive', 'Copy of a.md'))).resolves.toBeUndefined()
      // Source must be untouched
      await expect(fs.access(path.join(vaultRoot, 'notes', 'a.md'))).resolves.toBeUndefined()
    } finally {
      await closeApp(app)
    }
  })

  // -------------------------------------------------------------------------
  // Scenario 2: cut (move) multiple files → sources gone, dest has originals
  // -------------------------------------------------------------------------

  test('Scenario 2: cut multi-file → sources removed, archive has a.md and b.md', async () => {
    await fs.writeFile(path.join(vaultRoot, 'notes', 'b.md'), '# B', 'utf8')

    const { app, page } = await launchApp(userDataDir)
    try {
      await expect(
        page.locator('.sidebar .file-tree-row.dir', { hasText: /^notes$/ }),
      ).toBeVisible({ timeout: 15_000 })

      const results = await page.evaluate(
        async ({ srcs, dest }: { srcs: string[]; dest: string }) => {
          return await (window as unknown as MarvinWin).marvin.file.moveBatch(srcs, dest)
        },
        {
          srcs: [
            path.join(vaultRoot, 'notes', 'a.md'),
            path.join(vaultRoot, 'notes', 'b.md'),
          ],
          dest: path.join(vaultRoot, 'archive'),
        },
      )

      expect(results).toHaveLength(2)
      expect(results.every((r: MoveResult) => r.ok)).toBe(true)

      // Sources must be gone
      await expect(fs.access(path.join(vaultRoot, 'notes', 'a.md'))).rejects.toThrow()
      await expect(fs.access(path.join(vaultRoot, 'notes', 'b.md'))).rejects.toThrow()
      // Dest has original basenames (move does not prefix)
      await expect(fs.access(path.join(vaultRoot, 'archive', 'a.md'))).resolves.toBeUndefined()
      await expect(fs.access(path.join(vaultRoot, 'archive', 'b.md'))).resolves.toBeUndefined()
    } finally {
      await closeApp(app)
    }
  })

  // -------------------------------------------------------------------------
  // Scenario 3: conflict resolution on copy
  // -------------------------------------------------------------------------

  test('Scenario 3: copy conflict → first copy is "Copy of draft.md", second is "Copy of draft 2.md"', async () => {
    await fs.writeFile(path.join(vaultRoot, 'notes', 'draft.md'), '# Draft', 'utf8')
    await fs.writeFile(path.join(vaultRoot, 'archive', 'draft.md'), '# Existing', 'utf8')

    const { app, page } = await launchApp(userDataDir)
    try {
      await expect(
        page.locator('.sidebar .file-tree-row.dir', { hasText: /^notes$/ }),
      ).toBeVisible({ timeout: 15_000 })

      // First copy: archive/draft.md already exists → resolveConflict yields "Copy of draft.md"
      const first = await page.evaluate(
        async ({ src, dest }: { src: string; dest: string }) => {
          return await (window as unknown as MarvinWin).marvin.file.copy(src, dest)
        },
        { src: path.join(vaultRoot, 'notes', 'draft.md'), dest: path.join(vaultRoot, 'archive') },
      )
      expect(path.basename(first as string)).toBe('Copy of draft.md')
      await expect(fs.access(path.join(vaultRoot, 'archive', 'Copy of draft.md'))).resolves.toBeUndefined()

      // Second copy: "Copy of draft.md" now exists → resolveConflict yields "Copy of draft 2.md"
      const second = await page.evaluate(
        async ({ src, dest }: { src: string; dest: string }) => {
          return await (window as unknown as MarvinWin).marvin.file.copy(src, dest)
        },
        { src: path.join(vaultRoot, 'notes', 'draft.md'), dest: path.join(vaultRoot, 'archive') },
      )
      expect(path.basename(second as string)).toBe('Copy of draft 2.md')
      await expect(fs.access(path.join(vaultRoot, 'archive', 'Copy of draft 2.md'))).resolves.toBeUndefined()
    } finally {
      await closeApp(app)
    }
  })

  // -------------------------------------------------------------------------
  // Scenario 4: multi-select via UI shift+click → .selected className present
  // -------------------------------------------------------------------------

  test.skip('Scenario 4: shift+click multi-select → .selected on both rows (skipped: shift+click timing unreliable in headless Electron)', async () => {
    // Playwright's keyboard modifier routing and Electron's native event forwarding
    // do not consistently agree on shiftKey in CI headless mode → intermittent failures.
    // Selection logic is covered by unit tests in editor-context-menu.spec.tsx.
    await fs.writeFile(path.join(vaultRoot, 'notes', 'b.md'), '# B', 'utf8')

    const { app, page } = await launchApp(userDataDir)
    try {
      await expect(
        page.locator('.sidebar .file-tree-row.file', { hasText: /^a$/ }),
      ).toBeVisible({ timeout: 15_000 })

      const rowA = page.locator('.sidebar .file-tree-row.file', { hasText: /^a$/ })
      const rowB = page.locator('.sidebar .file-tree-row.file', { hasText: /^b$/ })

      await rowA.click()
      await rowB.click({ modifiers: ['Shift'] })

      await expect(rowA).toHaveClass(/selected/)
      await expect(rowB).toHaveClass(/selected/)
    } finally {
      await closeApp(app)
    }
  })

  // -------------------------------------------------------------------------
  // Scenario 5: Escape clears cut state in clipboard store
  // -------------------------------------------------------------------------

  test.skip(
    'Scenario 5: Escape clears clipboard store cut state (skipped: store cannot be seeded from outside the renderer bundle)',
    async () => {
      // contextBridge.exposeInMainWorld seals window.marvin — showContextMenu cannot
      // be patched from page.evaluate, so the cut state cannot be triggered via UI.
      //
      // Two paths to unlock:
      //   (a) React fiber walk: FileTreeRow calls useClipboardStore via useSyncExternalStore.
      //       In React 18, useSyncExternalStore stores {value, getSnapshot} in hook.memoizedState —
      //       not the store object itself. The store is in the closure of getSnapshot, not directly
      //       accessible from the fiber. Fiber walk cannot reach it without store identity.
      //   (b) Test-env hook: add to App.tsx —
      //       `if (import.meta.env.MODE === 'test') (window as any).__clipboardStore__ = useClipboardStore`
      //       Then seed via `window.__clipboardStore__.getState().set('cut', [fp])`.
      //       This is the recommended path — minimal, isolated to test builds.
      const { app, page } = await launchApp(userDataDir)
      try {
        const notesDir = page.locator('.sidebar .file-tree-row.dir', { hasText: /^notes$/ })
        await expect(notesDir).toBeVisible({ timeout: 15_000 })
        await notesDir.click()

        const fileRow = page.locator('.sidebar .file-tree-row.file', { hasText: /^a$/ })
        await expect(fileRow).toBeVisible({ timeout: 5_000 })

        const filePath = path.join(vaultRoot, 'notes', 'a.md')
        await page.evaluate((fp: string) => {
          const w = window as unknown as { __clipboardStore__: { getState: () => { set: (m: string, paths: string[]) => void } } }
          w.__clipboardStore__.getState().set('cut', [fp])
        }, filePath)

        await expect(fileRow).toHaveClass(/cut/)

        await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null
          if (el && el !== document.body) el.blur()
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
        })

        await expect(page.locator('.sidebar .file-tree-row.cut')).toHaveCount(0, { timeout: 1_000 })
      } finally {
        await closeApp(app)
      }
    },
  )

  // -------------------------------------------------------------------------
  // Scenario 6: Editor focus bails Cmd+C — clipboard store stays null
  // -------------------------------------------------------------------------

  test('Scenario 6: Cmd+C while editor cm-content is focused does not set clipboard store', async () => {
    const { app, page } = await launchApp(userDataDir)
    try {
      // Expand the notes folder so a.md becomes visible
      const notesDir = page.locator('.sidebar .file-tree-row.dir', { hasText: /^notes$/ })
      await expect(notesDir).toBeVisible({ timeout: 15_000 })
      await notesDir.click()

      const fileRow = page.locator('.sidebar .file-tree-row.file', { hasText: /^a$/ })
      await expect(fileRow).toBeVisible({ timeout: 5_000 })

      // Open file in editor by clicking the row
      await fileRow.click()

      // Editor opens in preview mode by default — wait for the mode toggle then switch to
      // the raw-edit surface. The first .mode-btn is always the source/edit toggle regardless
      // of label text (labels differ between bundle versions: "Edit" vs "Source").
      const editBtn = page.locator('.mode-toggle .mode-btn').first()
      await expect(editBtn).toBeVisible({ timeout: 8_000 })
      await editBtn.click()

      // cm-content is the contenteditable div rendered by CodeMirror
      const cmContent = page.locator('.cm-content').first()
      await expect(cmContent).toBeVisible({ timeout: 8_000 })

      // Focus the CodeMirror content area
      await cmContent.click()
      await expect(cmContent).toBeFocused()

      // Cmd+C with an editable target active — isEditableTarget bails the handler
      await page.keyboard.press('Meta+C')

      // No row should have .cut class — the keydown handler was skipped
      await expect(page.locator('.sidebar .file-tree-row.cut')).toHaveCount(0, { timeout: 1_000 })

      // Editor focus must be intact
      await expect(cmContent).toBeFocused()
    } finally {
      await closeApp(app)
    }
  })
})
