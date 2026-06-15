/**
 * E2E: file-tree undo via Cmd+Z (U5 / issue #151, milestone Undo V1).
 *
 * Validates the U3+U4 integration end-to-end: a file-panel operation is
 * recorded in the undo stack, and pressing Cmd+Z while the file tree is
 * focused reverses it against the real filesystem (routing → undoLast → IPC).
 *
 * Op coverage note: of the three file-panel ops, only **move** has a
 * UI-driveable trigger in Playwright — rename and trash are initiated from a
 * native OS context menu (window.marvin.app.showContextMenu), which Playwright
 * cannot drive. The per-kind reverse logic (rename/move/trash) is covered by
 * the U3 store unit tests (fileOpsHistory.spec.ts), and the Cmd+Z routing by
 * the U4 unit tests (panelContext.spec.ts); this spec proves the full
 * UI→IPC→FS path for the move case.
 *
 * Strings in English.
 */

import { test, expect, _electron as electron, type Page } from 'playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

type ElectronApp = Awaited<ReturnType<typeof electron.launch>>

const cmdKey = process.platform === 'darwin' ? 'Meta' : 'Control'

async function closeApp(app: ElectronApp): Promise<void> {
  let killTimer: ReturnType<typeof setTimeout> | undefined
  await Promise.race([
    app.close().catch(() => {}),
    new Promise<void>((resolve) => {
      killTimer = setTimeout(() => {
        try {
          app.process().kill()
        } catch {
          /* already dead */
        }
        resolve()
      }, 5_000)
    }),
  ])
  if (killTimer !== undefined) clearTimeout(killTimer)
}

async function seedVault(): Promise<string> {
  const raw = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-e2e-undo-tree-vault-'))
  const root = await fs.realpath(raw)
  await fs.mkdir(path.join(root, 'folder-a'))
  await fs.mkdir(path.join(root, 'folder-b'))
  await fs.writeFile(path.join(root, 'folder-a', 'doc.md'), '# Doc\n', 'utf8')
  return root
}

async function createUserDataDir(vaultPath: string): Promise<string> {
  const raw = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-e2e-undo-tree-userdata-'))
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

async function exists(p: string): Promise<boolean> {
  return fs
    .access(p)
    .then(() => true)
    .catch(() => false)
}

function dirRow(page: Page, name: string) {
  return page.locator('.sidebar .file-tree-row.dir', { hasText: new RegExp(`^${name}$`) })
}

test.describe('file-tree undo via Cmd+Z (#151)', () => {
  let vaultRoot: string
  let userDataDir: string

  test.beforeEach(async () => {
    vaultRoot = await seedVault()
    userDataDir = await createUserDataDir(vaultRoot)
  })

  test.afterEach(async () => {
    await fs.rm(vaultRoot, { recursive: true, force: true }).catch(() => {})
    await fs.rm(userDataDir, { recursive: true, force: true }).catch(() => {})
  })

  test('move (drag) then Cmd+Z restores the file to its original folder', async () => {
    const { app, page } = await launchApp(userDataDir)
    try {
      // Expand both folders so doc.md and the drop target are visible.
      await expect(dirRow(page, 'folder-a')).toBeVisible({ timeout: 15_000 })
      await dirRow(page, 'folder-a').click()
      await dirRow(page, 'folder-b').click()

      const docRow = page.locator('.sidebar .file-tree-row.file', { hasText: /^doc$/ })
      await expect(docRow).toBeVisible({ timeout: 8_000 })

      // Drag doc.md from folder-a onto folder-b.
      await docRow.dragTo(dirRow(page, 'folder-b'))

      // The move landed on disk: doc.md is now under folder-b, gone from folder-a.
      await expect
        .poll(() => exists(path.join(vaultRoot, 'folder-b', 'doc.md')), { timeout: 8_000 })
        .toBe(true)
      expect(await exists(path.join(vaultRoot, 'folder-a', 'doc.md'))).toBe(false)

      // Focus the file tree (click a folder row — focuses a tree button without
      // opening an editor), then Cmd+Z to undo the move.
      await dirRow(page, 'folder-b').click()
      await page.keyboard.press(`${cmdKey}+z`)

      // The undo restored the file to folder-a on disk.
      await expect
        .poll(() => exists(path.join(vaultRoot, 'folder-a', 'doc.md')), { timeout: 8_000 })
        .toBe(true)
      expect(await exists(path.join(vaultRoot, 'folder-b', 'doc.md'))).toBe(false)
    } finally {
      await closeApp(app)
    }
  })
})
