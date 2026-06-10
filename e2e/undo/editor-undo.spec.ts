/**
 * E2E: editor undo via Cmd+Z (U5 / issue #151, milestone Undo V1).
 *
 * Drives the real Electron app: type in a CodeMirror editor, undo with Cmd+Z,
 * redo with Cmd+Shift+Z, and confirm the per-file history is cleared when
 * switching files (V1 behaviour — a fresh EditorState per active file; note
 * that #440 keeps editors mounted across tab switches, but switching to a NEW
 * file still starts a clean document/history here because each file opens its
 * own editor instance).
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
  const raw = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-e2e-undo-editor-vault-'))
  const root = await fs.realpath(raw)
  await fs.writeFile(path.join(root, 'note-a.md'), '# Note A\n\nOriginal content.\n', 'utf8')
  await fs.writeFile(path.join(root, 'note-b.md'), '# Note B\n\nOther content.\n', 'utf8')
  return root
}

async function createUserDataDir(vaultPath: string): Promise<string> {
  const raw = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-e2e-undo-editor-userdata-'))
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

/** Scope to the currently-visible note tab (others are kept mounted but hidden). */
function activeEditor(page: Page) {
  return page.locator('.note-tab-container:not([hidden])')
}

async function openFileInSidebar(page: Page, namePart: string): Promise<void> {
  const fileRow = page.locator('.sidebar .file-tree-row.file', {
    hasText: new RegExp(`^${namePart}$`),
  })
  await expect(fileRow).toBeVisible({ timeout: 15_000 })
  await fileRow.click()
  // The file may open in preview (Milkdown) — assert the tab container is
  // present; switchToSourceMode() then surfaces the CodeMirror .cm-content.
  await expect(activeEditor(page)).toBeVisible({ timeout: 8_000 })
}

/** Click the Source-mode button if present so we edit raw markdown text. */
async function switchToSourceMode(page: Page): Promise<void> {
  // Scope to the visible tab: after #440 multiple note-tab-containers (and
  // their mode buttons) coexist in the DOM, so an unscoped locator is ambiguous.
  const sourceBtn = activeEditor(page)
    .locator('button.mode-btn', { hasText: /source/i })
    .first()
  await sourceBtn.waitFor({ state: 'visible', timeout: 4_000 }).catch(() => {})
  if (await sourceBtn.isVisible()) await sourceBtn.click()
  await expect(activeEditor(page).locator('.cm-content')).toBeVisible({ timeout: 6_000 })
}

test.describe('editor undo via Cmd+Z (#151)', () => {
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

  test('typing then Cmd+Z reverts, Cmd+Shift+Z re-applies', async () => {
    const { app, page } = await launchApp(userDataDir)
    try {
      await openFileInSidebar(page, 'note-a')
      await switchToSourceMode(page)

      const content = activeEditor(page).locator('.cm-content')
      await content.click()
      await page.keyboard.press('End')
      await page.keyboard.type(' TYPED')
      await expect(content).toContainText('TYPED')

      // Undo
      await page.keyboard.press(`${cmdKey}+z`)
      await expect(content).not.toContainText('TYPED')

      // Redo
      await page.keyboard.press(`${cmdKey}+Shift+z`)
      await expect(content).toContainText('TYPED')
    } finally {
      await closeApp(app)
    }
  })

  test('each file has its own undo history (undo in B reverts B, not A)', async () => {
    const { app, page } = await launchApp(userDataDir)
    try {
      await openFileInSidebar(page, 'note-a')
      await switchToSourceMode(page)
      const contentA = activeEditor(page).locator('.cm-content')
      await contentA.click()
      await page.keyboard.press('End')
      await page.keyboard.type(' TYPED-A')
      await expect(contentA).toContainText('TYPED-A')

      // Open and edit a different file.
      await openFileInSidebar(page, 'note-b')
      await switchToSourceMode(page)
      const contentB = activeEditor(page).locator('.cm-content')
      await expect(contentB).toContainText('Note B')
      await contentB.click()
      await page.keyboard.press('End')
      await page.keyboard.type(' TYPED-B')
      await expect(contentB).toContainText('TYPED-B')

      // Cmd+Z with note-b focused reverts note-b's OWN edit — proving each file
      // carries an independent undo history (note-a's TYPED-A is untouched).
      await page.keyboard.press(`${cmdKey}+z`)
      await expect(contentB).not.toContainText('TYPED-B')
      await expect(contentB).toContainText('Note B')
    } finally {
      await closeApp(app)
    }
  })
})
