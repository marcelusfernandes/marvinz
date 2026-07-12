/**
 * E2E: CodeMirror view re-wiring after in-tab navigation remount (issue #605).
 *
 * jsdom CANNOT drive real CodeMirror input, undo, find, or the native
 * context-menu round-trip — this spec uses the real Electron app via
 * Playwright _electron, adapting the pattern from e2e/editor-undo-tab-switch.spec.ts
 * (#440).
 *
 * #440 covers TAB switching, where both tabs stay mounted (hidden-stack) and
 * state must be PRESERVED. This spec covers the opposite case: navigating to a
 * different file IN THE SAME TAB (Cmd+P + Cmd/Ctrl-click a result — the
 * `replaceCurrent` path in App.tsx's handlePalettePick/navigateInActiveTab),
 * which bumps `version` and remounts `<CodeMirror key={version}>` (#559).
 * Content is buffer-first restored (#560) but the fresh EditorState has no
 * undo history — the opposite assertion direction from #440.
 *
 * What is tested:
 *
 *   (A) Undo isolation (the #559 regression guard): type an edit in A BEFORE
 *     navigating away, round-trip A -> B -> A, then Cmd+Z. The edit must NOT
 *     be reverted — the fresh EditorState has no history, so undo-ing the
 *     pre-navigation edit is a no-op. (If `key={version}` regresses and the
 *     view is kept alive instead of remounted, undo history survives and
 *     Cmd+Z WOULD revert it — this is the committed red-signal test.)
 *
 *   (B) Find bar re-wiring: after the same round-trip, open the app's find
 *     bar and confirm it finds/navigates matches against the LIVE remounted
 *     view (not a stale one). Opened via Cmd+F with focus OUTSIDE `.editor`
 *     (clicking the sidebar first) — Cmd+F while focus is inside CodeMirror
 *     competes with the editor's own keymap and was already noted as
 *     harness-limited in #559's PR description; the outside-.editor path
 *     goes through the window-level resolveAppFindShortcut instead and does
 *     not depend on CM keymap precedence under Playwright's synthetic events.
 *     Also does a light cursor/scroll sanity check (not preservation — #559
 *     explicitly resets cursor/scroll on every hard-reset remount, so a
 *     valid state after remount is what's asserted, not equality to before).
 *
 *   (C) Context-menu undo/redo re-wiring: a FRESH edit made AFTER returning
 *     to A (post-remount) must be undo-able/redo-able via the native
 *     context-menu path. Real menus aren't inspectable by Playwright, so the
 *     main-process `app:show-context-menu` handler is replaced with a spy
 *     that resolves the action id directly (same technique as
 *     e2e/editor-context-menu.spec.ts), then Editor.tsx's own
 *     undo(view)/redo(view) dispatch is exercised against whichever view is
 *     actually live.
 *
 *   (D) Disk-accept remount re-wiring: repeats the context-menu-undo check
 *     after a disk-accept ("Reload" in the external-change banner) instead
 *     of in-tab navigation — #559 shares the same `version`-bump hard-reset
 *     signal across both triggers, so a regression in one could easily miss
 *     the other.
 *
 * Setup: temp vault + userData dir per test, launched via electron.launch,
 * cleaned up in afterEach. Mirrors editor-undo-tab-switch.spec.ts.
 */

import { test, expect, _electron as electron } from 'playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

const cmdKey = process.platform === 'darwin' ? 'Meta' : 'Control'

type ElectronApp = Awaited<ReturnType<typeof electron.launch>>
type Page = Awaited<ReturnType<ElectronApp['firstWindow']>>

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function createUserDataDir(vaultPath: string): Promise<string> {
  const raw = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-e2e-remount-data-'))
  const userDataDir = await fs.realpath(raw)
  await fs.writeFile(
    path.join(userDataDir, 'settings.json'),
    JSON.stringify({ vaultPath, saveMode: 'manual' }),
    'utf8'
  )
  return userDataDir
}

async function seedNote(vaultRoot: string, name: string, content: string): Promise<string> {
  const filePath = path.join(vaultRoot, `${name}.md`)
  await fs.writeFile(filePath, content, 'utf8')
  return filePath
}

function activeEditor(page: Page) {
  return page.locator('.note-tab-container:not([hidden])')
}

async function openFileInSidebar(page: Page, namePart: string): Promise<void> {
  const fileRow = page.locator('.sidebar .file-tree-row.file', {
    hasText: new RegExp(`^${namePart}$`),
  })
  await expect(fileRow).toBeVisible({ timeout: 15_000 })
  await fileRow.click()
  await expect(page.locator('.note-tab-container:not([hidden])')).toBeVisible({ timeout: 8_000 })
}

async function switchToRawMode(page: Page): Promise<void> {
  const rawBtn = page.locator('button.mode-btn', { hasText: /raw/i })
  await rawBtn.waitFor({ state: 'visible', timeout: 4_000 }).catch(() => {})
  if (await rawBtn.isVisible()) await rawBtn.click()
  await expect(activeEditor(page).locator('.cm-content')).toBeVisible({ timeout: 6_000 })
}

/**
 * In-tab navigation: opens the command palette, searches for `namePart`, and
 * Cmd/Ctrl-clicks the top result. This is `replaceCurrent=true` in
 * App.tsx's handlePalettePick — it swaps the ACTIVE tab's path instead of
 * opening a new tab, the trigger that bumps `version` and remounts
 * `<CodeMirror>` (#559). A plain (no-modifier) sidebar click, by contrast,
 * opens a separate tab (#440's scenario) and must not be used here.
 */
async function navigateInTab(page: Page, namePart: string): Promise<void> {
  const tabCountBefore = await page.locator('.tab').count()
  await page.keyboard.press(`${cmdKey}+p`)
  const paletteInput = page.locator('.palette-input')
  await expect(paletteInput).toBeVisible({ timeout: 3_000 })
  await paletteInput.fill(namePart)
  const result = page.locator('.palette-row', { hasText: new RegExp(namePart, 'i') }).first()
  await expect(result).toBeVisible({ timeout: 3_000 })
  await result.click({ modifiers: [cmdKey] })
  await expect(page.locator('.tab', { hasText: new RegExp(namePart, 'i') })).toBeVisible({
    timeout: 5_000,
  })
  // Same tab count before/after — confirms this replaced the active tab
  // rather than opening a new one.
  await expect(page.locator('.tab')).toHaveCount(tabCountBefore)
}

/** Force the next app:show-context-menu invoke to resolve `actionId`
 * directly, bypassing the real native menu popup (not inspectable by
 * Playwright) — same technique as e2e/editor-context-menu.spec.ts. */
async function forceContextMenuAction(app: ElectronApp, actionId: string): Promise<void> {
  await app.evaluate(({ ipcMain }, id) => {
    ipcMain.removeHandler('app:show-context-menu')
    ipcMain.handle('app:show-context-menu', () => Promise.resolve(id))
  }, actionId)
}

// ---------------------------------------------------------------------------
// Suite A: undo isolation after in-tab navigation (the #559 regression guard)
// ---------------------------------------------------------------------------

test.describe('editor undo isolation — in-tab navigation remount (issue #605)', () => {
  let vaultRoot: string
  let userDataDir: string

  test.beforeEach(async () => {
    const rawVault = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-e2e-remount-undo-vault-'))
    vaultRoot = await fs.realpath(rawVault)
    await seedNote(vaultRoot, 'note-a', '# Note A\n\nOriginal content.\n')
    await seedNote(vaultRoot, 'note-b', '# Note B\n\nOther content.\n')
    userDataDir = await createUserDataDir(vaultRoot)
  })

  test.afterEach(async () => {
    await fs.rm(vaultRoot, { recursive: true, force: true }).catch(() => {})
    await fs.rm(userDataDir, { recursive: true, force: true }).catch(() => {})
  })

  test('(A) Cmd+Z does not revert a pre-navigation edit after A -> B -> A', async () => {
    const app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      env: { ...process.env, NODE_ENV: 'test' },
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    try {
      await openFileInSidebar(page, 'note-a')
      await switchToRawMode(page)
      await activeEditor(page).locator('.cm-content').click()
      await page.keyboard.press('End')
      await page.keyboard.type(' TYPED_A')
      await expect(activeEditor(page).locator('.cm-content')).toContainText('TYPED_A')

      await navigateInTab(page, 'note-b')
      await navigateInTab(page, 'note-a')
      await switchToRawMode(page)

      // Buffer-first (#560): the edit survives the round-trip.
      await expect(activeEditor(page).locator('.cm-content')).toContainText('TYPED_A', {
        timeout: 3_000,
      })

      // Undo isolation (#559): the remount reset undo history, so Cmd+Z on
      // this pre-navigation edit is a no-op. If it reverted, the view would
      // have survived the navigation instead of remounting.
      await activeEditor(page).locator('.cm-content').click()
      await page.keyboard.press(`${cmdKey}+z`)
      await expect(activeEditor(page).locator('.cm-content')).toContainText('TYPED_A', {
        timeout: 3_000,
      })
    } finally {
      await app.close()
    }
  })
})

// ---------------------------------------------------------------------------
// Suite B: find bar re-wiring after in-tab navigation remount
// ---------------------------------------------------------------------------

test.describe('editor find bar — in-tab navigation remount (issue #605)', () => {
  let vaultRoot: string
  let userDataDir: string

  test.beforeEach(async () => {
    const rawVault = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-e2e-remount-find-vault-'))
    vaultRoot = await fs.realpath(rawVault)
    await seedNote(vaultRoot, 'note-a', '# Note A\n\nFINDME once.\n\nFINDME twice.\n')
    await seedNote(vaultRoot, 'note-b', '# Note B\n\nOther content.\n')
    userDataDir = await createUserDataDir(vaultRoot)
  })

  test.afterEach(async () => {
    await fs.rm(vaultRoot, { recursive: true, force: true }).catch(() => {})
    await fs.rm(userDataDir, { recursive: true, force: true }).catch(() => {})
  })

  test('(B) find bar finds and navigates matches on the remounted view', async () => {
    const app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      env: { ...process.env, NODE_ENV: 'test' },
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    try {
      await openFileInSidebar(page, 'note-a')
      await switchToRawMode(page)
      await navigateInTab(page, 'note-b')
      await navigateInTab(page, 'note-a')
      await switchToRawMode(page)

      // Light cursor/scroll sanity check post-remount: not a preservation
      // assertion (#559 resets both on every hard-reset remount) — just
      // confirms the fresh view renders a real, numeric cursor position.
      const gutter = activeEditor(page).locator('.cm-activeLineGutter')
      await expect(gutter).toBeVisible({ timeout: 3_000 })
      expect(Number.isFinite(parseInt((await gutter.textContent()) ?? '', 10))).toBe(true)

      // Cmd+F with focus OUTSIDE .editor (sidebar) — goes through the
      // window-level resolveAppFindShortcut instead of CM's own keymap.
      await page.locator('.sidebar').click()
      await page.keyboard.press(`${cmdKey}+f`)
      const findPanel = page.locator('[data-testid="cm-search-panel"]')
      await expect(findPanel).toBeVisible({ timeout: 5_000 })

      const searchInput = page.locator('[data-testid="cm-search-input"]')
      await searchInput.fill('FINDME')
      const count = page.locator('[data-testid="cm-search-count"]')
      await expect(count).toHaveText('1 of 2', { timeout: 3_000 })

      await page.locator('[data-testid="cm-search-next"]').click()
      await expect(count).toHaveText('2 of 2', { timeout: 3_000 })

      await page.locator('[data-testid="cm-search-prev"]').click()
      await expect(count).toHaveText('1 of 2', { timeout: 3_000 })
    } finally {
      await app.close()
    }
  })
})

// ---------------------------------------------------------------------------
// Suite C: context-menu undo/redo re-wiring after in-tab navigation remount
// ---------------------------------------------------------------------------

test.describe('editor context-menu undo/redo — in-tab navigation remount (issue #605)', () => {
  let vaultRoot: string
  let userDataDir: string

  test.beforeEach(async () => {
    const rawVault = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-e2e-remount-ctxmenu-vault-'))
    vaultRoot = await fs.realpath(rawVault)
    await seedNote(vaultRoot, 'note-a', '# Note A\n\nOriginal content.\n')
    await seedNote(vaultRoot, 'note-b', '# Note B\n\nOther content.\n')
    userDataDir = await createUserDataDir(vaultRoot)
  })

  test.afterEach(async () => {
    await fs.rm(vaultRoot, { recursive: true, force: true }).catch(() => {})
    await fs.rm(userDataDir, { recursive: true, force: true }).catch(() => {})
  })

  test('(C) context-menu undo/redo act on the remounted view for a post-navigation edit', async () => {
    const app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      env: { ...process.env, NODE_ENV: 'test' },
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    try {
      await openFileInSidebar(page, 'note-a')
      await switchToRawMode(page)
      await navigateInTab(page, 'note-b')
      await navigateInTab(page, 'note-a')
      await switchToRawMode(page)

      // A FRESH edit made after the remount — this is what proves undo/redo
      // are bound to the live re-wired view, not a stale one. (Testing this
      // on the pre-navigation edit would be vacuous: its history was reset,
      // same as suite A.)
      await activeEditor(page).locator('.cm-content').click()
      await page.keyboard.press('End')
      await page.keyboard.type(' TYPED_POST_REMOUNT')
      await expect(activeEditor(page).locator('.cm-content')).toContainText('TYPED_POST_REMOUNT')

      await forceContextMenuAction(app, 'undo')
      await activeEditor(page).locator('.cm-content').click({ button: 'right' })
      await expect(activeEditor(page).locator('.cm-content')).not.toContainText(
        'TYPED_POST_REMOUNT',
        { timeout: 5_000 }
      )

      await forceContextMenuAction(app, 'redo')
      await activeEditor(page).locator('.cm-content').click({ button: 'right' })
      await expect(activeEditor(page).locator('.cm-content')).toContainText('TYPED_POST_REMOUNT', {
        timeout: 5_000,
      })
    } finally {
      await app.close()
    }
  })
})

// ---------------------------------------------------------------------------
// Suite D: context-menu undo re-wiring after a disk-accept remount
// ---------------------------------------------------------------------------

test.describe('editor context-menu undo — disk-accept remount (issue #605)', () => {
  let vaultRoot: string
  let userDataDir: string
  let filePathA: string

  test.beforeEach(async () => {
    const rawVault = await fs.mkdtemp(
      path.join(os.tmpdir(), 'marvin-e2e-remount-diskaccept-vault-')
    )
    vaultRoot = await fs.realpath(rawVault)
    filePathA = await seedNote(vaultRoot, 'note-a', '# Note A\n\nOriginal content.\n')
    userDataDir = await createUserDataDir(vaultRoot)
  })

  test.afterEach(async () => {
    await fs.rm(vaultRoot, { recursive: true, force: true }).catch(() => {})
    await fs.rm(userDataDir, { recursive: true, force: true }).catch(() => {})
  })

  test('(D) context-menu undo acts on the view remounted by a disk-accept', async () => {
    const app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      env: { ...process.env, NODE_ENV: 'test' },
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    try {
      await openFileInSidebar(page, 'note-a')
      await switchToRawMode(page)
      // Dirty the buffer so the external write below surfaces the banner
      // instead of silently reloading.
      await activeEditor(page).locator('.cm-content').click()
      await page.keyboard.press('End')
      await page.keyboard.type(' DIRTY_BUFFER')
      await expect(activeEditor(page).locator('.cm-content')).toContainText('DIRTY_BUFFER')

      // External write while dirty — triggers the conflict banner (mirrors
      // hot-reload-diff.spec.ts's Scenario 1/5 setup).
      await fs.writeFile(filePathA, '# Note A\n\nExternally changed content.\n', 'utf8')
      const banner = page.locator('.external-change-banner')
      await expect(banner).toBeVisible({ timeout: 8_000 })

      // Disk-accept: "Reload" remounts the editor with the on-disk content.
      await banner.getByRole('button', { name: 'Reload' }).click()
      await expect(banner).not.toBeVisible({ timeout: 5_000 })
      await switchToRawMode(page)
      await expect(activeEditor(page).locator('.cm-content')).toContainText(
        'Externally changed content'
      )

      // A fresh post-remount edit, undo-able via the (spied) context menu —
      // proves the disk-accept remount re-wired the view too.
      await activeEditor(page).locator('.cm-content').click()
      await page.keyboard.press('End')
      await page.keyboard.type(' TYPED_AFTER_RELOAD')
      await expect(activeEditor(page).locator('.cm-content')).toContainText('TYPED_AFTER_RELOAD')

      await forceContextMenuAction(app, 'undo')
      await activeEditor(page).locator('.cm-content').click({ button: 'right' })
      await expect(activeEditor(page).locator('.cm-content')).not.toContainText(
        'TYPED_AFTER_RELOAD',
        { timeout: 5_000 }
      )
    } finally {
      await app.close()
    }
  })
})
