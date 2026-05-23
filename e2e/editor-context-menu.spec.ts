/**
 * E2E test for the editor:show-context-menu IPC contract.
 * Issue #154: native context menu in editors.
 *
 * Scope: assert the IPC wire only.
 * Native menus are not inspectable by Playwright — this test verifies that
 * right-clicking in the CodeMirror editor dispatches `editor:show-context-menu`
 * to the main process with a payload matching the expected shape:
 *   { hasSelection: boolean, canUndo: boolean, canRedo: boolean }
 *
 * Manual QA of menu chrome (items, keyboard shortcuts, keyboard navigation)
 * is documented in the PR description and is out of scope here.
 *
 * Mock strategy:
 *   - Remove the real `editor:show-context-menu` handler and replace it with
 *     one that records the received payload and resolves `null` (no action).
 *   - Open a note in edit mode (CodeMirror).
 *   - Right-click the .cm-content surface.
 *   - Read back the recorded payload via app.evaluate.
 */

import { test, expect, _electron as electron } from 'playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createUserDataDir(vaultPath: string): Promise<string> {
  const raw = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-e2e-ctxmenu-data-'))
  const userDataDir = await fs.realpath(raw)
  await fs.writeFile(
    path.join(userDataDir, 'settings.json'),
    JSON.stringify({ vaultPath }),
    'utf8',
  )
  return userDataDir
}

async function seedVault(vaultRoot: string): Promise<void> {
  await fs.writeFile(
    path.join(vaultRoot, 'note.md'),
    '# Context menu test\n\nSome content here.\n',
    'utf8',
  )
}

/** Install a spy that replaces the real editor:show-context-menu handler. */
async function installContextMenuSpy(
  app: Awaited<ReturnType<typeof electron.launch>>,
): Promise<void> {
  await app.evaluate(({ ipcMain }) => {
    // Remove the live handler so we can intercept without opening a real native menu.
    ipcMain.removeHandler('editor:show-context-menu')
    // Replace with a spy that records the last received request and resolves null.
    ;(globalThis as Record<string, unknown>).__ctxMenuSpy = null
    ipcMain.handle('editor:show-context-menu', (_e, req: unknown) => {
      ;(globalThis as Record<string, unknown>).__ctxMenuSpy = req
      return null
    })
  })
}

/** Read back the last payload captured by the spy. */
async function readSpyPayload(
  app: Awaited<ReturnType<typeof electron.launch>>,
): Promise<unknown> {
  return app.evaluate(() => (globalThis as Record<string, unknown>).__ctxMenuSpy)
}

/** Click a file in the sidebar and wait for the editor to appear. */
async function openFile(
  page: import('playwright').Page,
  labelRe: RegExp,
): Promise<void> {
  const fileRow = page.locator('.sidebar .file-tree-row.file', { hasText: labelRe })
  await expect(fileRow).toBeVisible({ timeout: 15_000 })
  await fileRow.click()
  await expect(page.locator('.note-tab-container')).toBeVisible({ timeout: 8_000 })
}

/** Switch to Edit mode and wait for the CodeMirror editor. */
async function switchToEdit(page: import('playwright').Page): Promise<void> {
  const editBtn = page.locator('.mode-btn', { hasText: 'Edit' }).first()
  await expect(editBtn).toBeVisible({ timeout: 5_000 })
  await editBtn.click()
  await expect(page.locator('.cm-editor')).toBeVisible({ timeout: 5_000 })
  await page.waitForTimeout(300)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('editor:show-context-menu — IPC wire contract', () => {
  let vaultRoot: string
  let userDataDir: string

  test.beforeEach(async () => {
    const rawVault = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-e2e-ctxmenu-vault-'))
    vaultRoot = await fs.realpath(rawVault)
    await seedVault(vaultRoot)
    userDataDir = await createUserDataDir(vaultRoot)
  })

  test.afterEach(async () => {
    await fs.rm(vaultRoot, { recursive: true, force: true }).catch(() => {})
    await fs.rm(userDataDir, { recursive: true, force: true }).catch(() => {})
  })

  test('right-click in CodeMirror editor invokes IPC with correct payload shape', async () => {
    const app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      env: { ...process.env, NODE_ENV: 'test' },
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    try {
      await installContextMenuSpy(app)

      await openFile(page, /^note\.md$/)
      await switchToEdit(page)

      // Right-click the CodeMirror content surface (the editable area).
      const cmContent = page.locator('.cm-content').first()
      await expect(cmContent).toBeVisible({ timeout: 5_000 })
      await cmContent.click({ button: 'right' })

      // Allow time for the async IPC invoke round-trip.
      await page.waitForTimeout(500)

      const payload = await readSpyPayload(app)

      // Assert payload shape: all three boolean fields must be present.
      expect(payload).not.toBeNull()
      expect(typeof (payload as Record<string, unknown>).hasSelection).toBe('boolean')
      expect(typeof (payload as Record<string, unknown>).canUndo).toBe('boolean')
      expect(typeof (payload as Record<string, unknown>).canRedo).toBe('boolean')
    } finally {
      await app.close()
    }
  })

  test('right-click in CodeMirror sends hasSelection=false for fresh empty note', async () => {
    const app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      env: { ...process.env, NODE_ENV: 'test' },
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    try {
      await installContextMenuSpy(app)

      await openFile(page, /^note\.md$/)
      await switchToEdit(page)

      const cmContent = page.locator('.cm-content').first()
      await expect(cmContent).toBeVisible({ timeout: 5_000 })
      // Click to place cursor (no selection), then right-click.
      await cmContent.click()
      await cmContent.click({ button: 'right' })
      await page.waitForTimeout(500)

      const payload = await readSpyPayload(app) as Record<string, unknown> | null
      expect(payload).not.toBeNull()
      expect(payload!.hasSelection).toBe(false)
    } finally {
      await app.close()
    }
  })

  test('right-click in CodeMirror sends hasSelection=true after Ctrl+A', async () => {
    const app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      env: { ...process.env, NODE_ENV: 'test' },
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    try {
      await installContextMenuSpy(app)

      await openFile(page, /^note\.md$/)
      await switchToEdit(page)

      const cmContent = page.locator('.cm-content').first()
      await expect(cmContent).toBeVisible({ timeout: 5_000 })
      // Click to focus, select all, then right-click.
      await cmContent.click()
      await page.keyboard.press('Control+A')
      await cmContent.click({ button: 'right' })
      await page.waitForTimeout(500)

      const payload = await readSpyPayload(app) as Record<string, unknown> | null
      expect(payload).not.toBeNull()
      expect(payload!.hasSelection).toBe(true)
    } finally {
      await app.close()
    }
  })
})
