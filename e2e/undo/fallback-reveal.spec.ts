/**
 * E2E: graceful Cmd+Z fallback + reveal-where-undo-happened (#456).
 *
 * Drives the real Electron app. Covers the two behaviours unit tests can't:
 *  1. With focus OUTSIDE any editor/input (neutral), Cmd+Z falls back to the
 *     active editor's text undo — never a dead key. Verified in BOTH Source
 *     (CodeMirror) and the default Page/preview (ProseMirror/Milkdown) surface;
 *     the Page case is the load-bearing one (a CodeMirror-only fallback would
 *     silently no-op on the surface users see by default).
 *  2. Undoing a file op affecting a file open in a background tab activates
 *     that tab (and remaps its path), so the user sees where the undo landed.
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
  const raw = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-e2e-undo-fallback-vault-'))
  const root = await fs.realpath(raw)
  await fs.mkdir(path.join(root, 'folder-a'))
  await fs.mkdir(path.join(root, 'folder-b'))
  await fs.writeFile(path.join(root, 'note-a.md'), '# Note A\n\nOriginal content.\n', 'utf8')
  await fs.writeFile(path.join(root, 'note-b.md'), '# Note B\n\nOther content.\n', 'utf8')
  await fs.writeFile(path.join(root, 'folder-a', 'doc.md'), '# Doc\n\nDoc content.\n', 'utf8')
  return root
}

async function createUserDataDir(vaultPath: string): Promise<string> {
  const raw = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-e2e-undo-fallback-userdata-'))
  const dir = await fs.realpath(raw)
  await fs.writeFile(
    path.join(dir, 'settings.json'),
    JSON.stringify({ vaultPath, saveMode: 'manual' }),
    'utf8',
  )
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

/** The currently-visible note tab (others stay mounted but hidden, #440). */
function activeEditor(page: Page) {
  return page.locator('.note-tab-container:not([hidden])')
}

function fileRow(page: Page, name: string) {
  return page.locator('.sidebar .file-tree-row.file', { hasText: new RegExp(`^${name}$`) })
}

function dirRow(page: Page, name: string) {
  return page.locator('.sidebar .file-tree-row.dir', { hasText: new RegExp(`^${name}$`) })
}

async function openFile(page: Page, namePart: string): Promise<void> {
  const row = fileRow(page, namePart)
  await expect(row).toBeVisible({ timeout: 15_000 })
  await row.click()
  await expect(activeEditor(page)).toBeVisible({ timeout: 8_000 })
}

async function switchToSourceMode(page: Page): Promise<void> {
  const sourceBtn = activeEditor(page)
    .locator('button.mode-btn', { hasText: /source/i })
    .first()
  await sourceBtn.waitFor({ state: 'visible', timeout: 4_000 }).catch(() => {})
  if (await sourceBtn.isVisible()) await sourceBtn.click()
  await expect(activeEditor(page).locator('.cm-content')).toBeVisible({ timeout: 6_000 })
}

/** Drop keyboard focus to <body> so getActivePanelContext() reports 'neutral'. */
async function blurToNeutral(page: Page): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.tagName ?? null))
    .toBe('BODY')
}

const exists = (p: string) =>
  fs
    .access(p)
    .then(() => true)
    .catch(() => false)

test.describe('Cmd+Z graceful fallback + reveal (#456)', () => {
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

  test('neutral-focus Cmd+Z falls back to the active Source (CodeMirror) editor', async () => {
    const { app, page } = await launchApp(userDataDir)
    try {
      await openFile(page, 'note-a')
      await switchToSourceMode(page)

      const content = activeEditor(page).locator('.cm-content')
      await content.click()
      await page.keyboard.press('End')
      await page.keyboard.type(' TYPED-CM')
      await expect(content).toContainText('TYPED-CM')

      // Move focus OUT of the editor — Cmd+Z must still undo (not a dead key).
      await blurToNeutral(page)
      await page.keyboard.press(`${cmdKey}+z`)
      await expect(content).not.toContainText('TYPED-CM')

      // And redo through the same fallback.
      await blurToNeutral(page)
      await page.keyboard.press(`${cmdKey}+Shift+z`)
      await expect(content).toContainText('TYPED-CM')
    } finally {
      await closeApp(app)
    }
  })

  test('neutral-focus Cmd+Z falls back to the active Page (ProseMirror) editor', async () => {
    const { app, page } = await launchApp(userDataDir)
    try {
      // Default open is Page/preview = the Milkdown/ProseMirror surface.
      await openFile(page, 'note-a')
      const pm = activeEditor(page).locator('.milkdown-host, .ProseMirror').first()
      await expect(pm).toBeVisible({ timeout: 8_000 })

      await pm.click()
      await page.keyboard.type('TYPED-PM')
      await expect(pm).toContainText('TYPED-PM')

      // Focus outside the editor — a CodeMirror-only fallback would no-op here.
      await blurToNeutral(page)
      await page.keyboard.press(`${cmdKey}+z`)
      await expect(pm).not.toContainText('TYPED-PM')

      // Redo through the same fallback (ProseMirror redo must not regress).
      await blurToNeutral(page)
      await page.keyboard.press(`${cmdKey}+Shift+z`)
      await expect(pm).toContainText('TYPED-PM')
    } finally {
      await closeApp(app)
    }
  })

  test('keeps focus on the tree after a file op so Cmd+Z undoes it without re-clicking (#457)', async () => {
    const { app, page } = await launchApp(userDataDir)
    try {
      await expect(dirRow(page, 'folder-a')).toBeVisible({ timeout: 15_000 })
      await dirRow(page, 'folder-a').click()
      await dirRow(page, 'folder-b').click()
      const docRow = fileRow(page, 'doc')
      await expect(docRow).toBeVisible({ timeout: 8_000 })

      // Move doc.md folder-a -> folder-b, then DO NOT click anything.
      await docRow.dragTo(dirRow(page, 'folder-b'))
      await expect
        .poll(() => exists(path.join(vaultRoot, 'folder-b', 'doc.md')), { timeout: 8_000 })
        .toBe(true)

      // Focus must have stayed on the file tree (so the next Cmd+Z routes there).
      await expect
        .poll(() =>
          page.evaluate(
            () => !!document.activeElement?.closest('[data-panel="file-tree"]'),
          ),
        )
        .toBe(true)

      // Cmd+Z with no intervening click undoes the move.
      await page.keyboard.press(`${cmdKey}+z`)
      await expect
        .poll(() => exists(path.join(vaultRoot, 'folder-a', 'doc.md')), { timeout: 8_000 })
        .toBe(true)
      expect(await exists(path.join(vaultRoot, 'folder-b', 'doc.md'))).toBe(false)
    } finally {
      await closeApp(app)
    }
  })

  test('undoing a move of a background-tab file does NOT switch the active tab', async () => {
    const { app, page } = await launchApp(userDataDir)
    try {
      // Open doc.md (under folder-a), then open note-b so doc sits in a
      // background tab and note-b is active.
      await expect(dirRow(page, 'folder-a')).toBeVisible({ timeout: 15_000 })
      await dirRow(page, 'folder-a').click()
      await openFile(page, 'doc')
      await openFile(page, 'note-b')
      await expect(activeEditor(page)).toContainText('Note B')

      // Move doc.md (background tab) from folder-a into folder-b, then undo.
      await dirRow(page, 'folder-b').click()
      const docRow = fileRow(page, 'doc')
      await expect(docRow).toBeVisible({ timeout: 8_000 })
      await docRow.dragTo(dirRow(page, 'folder-b'))
      await expect
        .poll(() => exists(path.join(vaultRoot, 'folder-b', 'doc.md')), { timeout: 8_000 })
        .toBe(true)

      await dirRow(page, 'folder-b').click()
      await page.keyboard.press(`${cmdKey}+z`)

      // The move is reverted on disk...
      await expect
        .poll(() => exists(path.join(vaultRoot, 'folder-a', 'doc.md')), { timeout: 8_000 })
        .toBe(true)
      // ...but the active tab STAYS note-b — the undo must not jump to doc.
      await expect(activeEditor(page)).toContainText('Note B')
      await expect(activeEditor(page)).not.toContainText('Doc content')
    } finally {
      await closeApp(app)
    }
  })
})
