/**
 * E2E: dirty-state close prompt and auto-flush on tab close (issue #410).
 *
 * Two save modes are exercised:
 *
 *   Manual mode (saveMode: 'manual'):
 *     Editing a note then closing the tab triggers the native "unsaved
 *     changes" message box. Native dialogs cannot be driven through the DOM,
 *     so we stub dialog.showMessageBox in the main process to return the
 *     button the test wants, then assert the disk/tab outcome:
 *       - Save (0)     → buffer flushed to disk, tab closes.
 *       - Don't Save (1) → buffer dropped, disk unchanged, tab closes.
 *       - Cancel (2)   → tab stays open, no disk change.
 *
 *   Auto mode (saveMode: 'auto'):
 *     No prompt. The buffer is flushed to disk before the tab exits.
 *
 *   Non-active tab (manual mode):
 *     Edit tab A, switch to tab B, close A from background → prompt fires for
 *     A. Save persists A's buffer to disk.
 *
 * Setup: write settings.json into a temp userData dir (same pattern as other
 * e2e specs). saveMode in settings.json is reconciled into localStorage via
 * seedFromMain on bootstrap.
 */

import { test, expect, _electron as electron } from 'playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

type LaunchedApp = Awaited<ReturnType<typeof electron.launch>>

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createUserDataDir(vaultPath: string, saveMode: 'auto' | 'manual'): Promise<string> {
  const raw = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-e2e-dirty-'))
  const userDataDir = await fs.realpath(raw)
  await fs.writeFile(
    path.join(userDataDir, 'settings.json'),
    JSON.stringify({ vaultPath, saveMode }),
    'utf8',
  )
  return userDataDir
}

async function seedNote(vaultRoot: string, name: string, content: string): Promise<string> {
  const filePath = path.join(vaultRoot, `${name}.md`)
  await fs.writeFile(filePath, content, 'utf8')
  return filePath
}

// Stub the native unsaved-changes message box in the main process so the test
// can pick the button. Save=0, Don't Save=1, Cancel=2 (see main.ts handler).
async function stubUnsavedDialog(app: LaunchedApp, choice: 'save' | 'discard' | 'cancel'): Promise<void> {
  const response = choice === 'save' ? 0 : choice === 'discard' ? 1 : 2
  await app.evaluate(({ dialog }, r) => {
    Object.assign(dialog, {
      showMessageBox: () => Promise.resolve({ response: r, checkboxChecked: false }),
    })
  }, response)
}

// Open a note by clicking its file-tree row, switch to Source mode (md files
// open in preview), then type text into CodeMirror.
async function openNoteAndType(
  page: Awaited<ReturnType<LaunchedApp['firstWindow']>>,
  noteName: string,
  text: string,
): Promise<void> {
  const fileRow = page.locator('.sidebar .file-tree-row.file', { hasText: new RegExp(`^${noteName}$`) })
  await expect(fileRow).toBeVisible({ timeout: 15_000 })
  await fileRow.click()

  await expect(page.locator('.note-tab-container')).toBeVisible({ timeout: 8_000 })

  // .md files open in preview (LiveMarkdown). Switch to Source mode so
  // keyboard input reaches the CodeMirror surface.
  const sourceBtn = page.locator('button.mode-btn', { hasText: /source/i })
  if (await sourceBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await sourceBtn.click()
  }

  await page.locator('.cm-content').click()
  await page.keyboard.type(text)
}

// ---------------------------------------------------------------------------
// Manual mode — active tab: Save / Discard / Cancel
// ---------------------------------------------------------------------------

test.describe('dirty-state close prompt — manual save mode', () => {
  let vaultRoot: string
  let userDataDir: string
  let notePath: string
  const originalContent = '# My Note\n\nOriginal content.'

  test.beforeEach(async () => {
    const rawVault = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-e2e-vault-'))
    vaultRoot = await fs.realpath(rawVault)
    notePath = await seedNote(vaultRoot, 'my-note', originalContent)
    userDataDir = await createUserDataDir(vaultRoot, 'manual')
  })

  test.afterEach(async () => {
    await fs.rm(vaultRoot, { recursive: true, force: true })
    await fs.rm(userDataDir, { recursive: true, force: true })
  })

  test('Save: buffer persists to disk and tab closes', async () => {
    const app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      env: { ...process.env, NODE_ENV: 'test' },
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    try {
      await openNoteAndType(page, 'my-note', ' edited')
      await stubUnsavedDialog(app, 'save')

      await page.locator('.tab.active .tab-close').click()

      await expect(page.locator('.tab.active')).not.toBeVisible({ timeout: 5_000 })

      const saved = await fs.readFile(notePath, 'utf8')
      expect(saved).toContain('edited')
    } finally {
      await app.close()
    }
  })

  test('Discard: buffer dropped, disk unchanged, tab closes', async () => {
    const app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      env: { ...process.env, NODE_ENV: 'test' },
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    try {
      await openNoteAndType(page, 'my-note', ' discard-me')
      await stubUnsavedDialog(app, 'discard')

      await page.locator('.tab.active .tab-close').click()

      await expect(page.locator('.tab.active')).not.toBeVisible({ timeout: 5_000 })

      const onDisk = await fs.readFile(notePath, 'utf8')
      expect(onDisk).toBe(originalContent)
    } finally {
      await app.close()
    }
  })

  test('Cancel: tab stays open, no disk change', async () => {
    const app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      env: { ...process.env, NODE_ENV: 'test' },
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    try {
      await openNoteAndType(page, 'my-note', ' cancel-me')
      await stubUnsavedDialog(app, 'cancel')

      await page.locator('.tab.active .tab-close').click()

      // Tab must stay (cancel is a no-op)
      await expect(page.locator('.tab.active')).toBeVisible({ timeout: 5_000 })

      const onDisk = await fs.readFile(notePath, 'utf8')
      expect(onDisk).toBe(originalContent)
    } finally {
      await app.close()
    }
  })
})

// ---------------------------------------------------------------------------
// Manual mode — non-active tab: edit A, switch to B, close A from background
// ---------------------------------------------------------------------------

test.describe('dirty-state close prompt — non-active tab, manual save mode', () => {
  let vaultRoot: string
  let userDataDir: string
  let noteAPath: string
  const originalA = '# Note A\n\nContent A.'
  const originalB = '# Note B\n\nContent B.'

  test.beforeEach(async () => {
    const rawVault = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-e2e-vault-'))
    vaultRoot = await fs.realpath(rawVault)
    noteAPath = await seedNote(vaultRoot, 'note-a', originalA)
    await seedNote(vaultRoot, 'note-b', originalB)
    userDataDir = await createUserDataDir(vaultRoot, 'manual')
  })

  test.afterEach(async () => {
    await fs.rm(vaultRoot, { recursive: true, force: true })
    await fs.rm(userDataDir, { recursive: true, force: true })
  })

  test('closing a dirty background tab prompts for it; Save persists buffer', async () => {
    const app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      env: { ...process.env, NODE_ENV: 'test' },
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    try {
      // Edit note A
      await openNoteAndType(page, 'note-a', ' from-A')

      // Switch to note B — note A becomes a dirty background tab
      const fileBRow = page.locator('.sidebar .file-tree-row.file', { hasText: /^note-b$/ })
      await expect(fileBRow).toBeVisible({ timeout: 10_000 })
      await fileBRow.click()
      await expect(page.locator('.note-tab-container')).toBeVisible({ timeout: 8_000 })

      await stubUnsavedDialog(app, 'save')

      // Close note A from the background. .tab-close has display:none on
      // non-active tabs (shown only on .tab.active or :hover), so Playwright's
      // force:true is not enough — we dispatch the click event directly via
      // evaluate to bypass the CSS display:none guard.
      const tabA = page.locator('.tab', { hasText: /note-a/ })
      await expect(tabA).toBeVisible({ timeout: 5_000 })
      await page.evaluate((noteName) => {
        const tab = Array.from(document.querySelectorAll('.tab')).find((el) =>
          el.textContent?.includes(noteName),
        )
        const btn = tab?.querySelector('.tab-close') as HTMLElement | null
        btn?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      }, 'note-a')

      // Tab A closes after the prompt resolves to Save
      await expect(tabA).not.toBeVisible({ timeout: 5_000 })

      // Disk has A's edited content
      const saved = await fs.readFile(noteAPath, 'utf8')
      expect(saved).toContain('from-A')
    } finally {
      await app.close()
    }
  })
})

// ---------------------------------------------------------------------------
// Auto mode — flush to disk on close, no prompt
// ---------------------------------------------------------------------------

test.describe('dirty-state auto-flush — auto save mode', () => {
  let vaultRoot: string
  let userDataDir: string
  let notePath: string
  const originalContent = '# Auto Note\n\nOriginal.'

  test.beforeEach(async () => {
    const rawVault = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-e2e-vault-'))
    vaultRoot = await fs.realpath(rawVault)
    notePath = await seedNote(vaultRoot, 'auto-note', originalContent)
    userDataDir = await createUserDataDir(vaultRoot, 'auto')
  })

  test.afterEach(async () => {
    await fs.rm(vaultRoot, { recursive: true, force: true })
    await fs.rm(userDataDir, { recursive: true, force: true })
  })

  test('edited content is flushed to disk before tab exits, no prompt shown', async () => {
    const app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      env: { ...process.env, NODE_ENV: 'test' },
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    try {
      await openNoteAndType(page, 'auto-note', ' auto-flushed')

      // Fail loudly if a prompt is ever raised in auto mode.
      await app.evaluate(({ dialog }) => {
        Object.assign(dialog, {
          showMessageBox: () => Promise.reject(new Error('auto mode must not prompt')),
        })
      })

      await page.locator('.tab.active .tab-close').click()

      await expect(page.locator('.tab.active')).not.toBeVisible({ timeout: 5_000 })

      const onDisk = await fs.readFile(notePath, 'utf8')
      expect(onDisk).toContain('auto-flushed')
    } finally {
      await app.close()
    }
  })
})
