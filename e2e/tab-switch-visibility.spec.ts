/**
 * E2E regression: only the active note-tab editor is visible.
 *
 * #440 renders editors as a mounted-but-hidden stack (`hidden={!isActive}` on
 * `.note-tab-container`). A `.note-tab-container { display: flex }` rule once
 * overrode the `hidden` attribute's `display:none`, so inactive editors
 * rendered stacked and switching tabs showed no visible change. This spec
 * asserts the inactive container is actually hidden — it fails against that
 * regression and passes once `.note-tab-container[hidden] { display: none }`
 * is in place.
 *
 * Strings in English.
 */

import { test, expect, _electron as electron, type Page } from 'playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

type ElectronApp = Awaited<ReturnType<typeof electron.launch>>

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
  const raw = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-e2e-tabvis-vault-'))
  const root = await fs.realpath(raw)
  await fs.writeFile(path.join(root, 'note-a.md'), '# Note A\n\nAlpha content.\n', 'utf8')
  await fs.writeFile(path.join(root, 'note-b.md'), '# Note B\n\nBravo content.\n', 'utf8')
  return root
}

async function createUserDataDir(vaultPath: string): Promise<string> {
  const raw = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-e2e-tabvis-userdata-'))
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

async function openFileInSidebar(page: Page, namePart: string): Promise<void> {
  const fileRow = page.locator('.sidebar .file-tree-row.file', {
    hasText: new RegExp(`^${namePart}$`),
  })
  await expect(fileRow).toBeVisible({ timeout: 15_000 })
  await fileRow.click()
  await expect(page.locator('.note-tab-container:not([hidden])')).toBeVisible({ timeout: 8_000 })
}

test.describe('tab switching shows only the active editor (#440 regression)', () => {
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

  test('with two files open, the inactive editor is hidden (not stacked)', async () => {
    const { app, page } = await launchApp(userDataDir)
    try {
      await openFileInSidebar(page, 'note-a')
      await openFileInSidebar(page, 'note-b')

      // Both editor containers are mounted in the DOM…
      await expect(page.locator('.note-tab-container')).toHaveCount(2)

      // …but exactly one is visible (the active tab), and the [hidden] one is
      // genuinely not rendered on screen (display:none). Pre-fix it was
      // display:flex and stacked → visible → this would fail.
      await expect(page.locator('.note-tab-container[hidden]')).toHaveCount(1)
      await expect(page.locator('.note-tab-container[hidden]')).toBeHidden()
      await expect(page.locator('.note-tab-container:visible')).toHaveCount(1)

      // The visible content is note-b's (the active tab), not note-a stacked in.
      await expect(page.locator('.note-tab-container:not([hidden])')).toContainText('Note B')
      await expect(page.locator('.note-tab-container:not([hidden])')).not.toContainText('Note A')
    } finally {
      await closeApp(app)
    }
  })
})
