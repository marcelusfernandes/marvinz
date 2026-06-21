/**
 * E2E: Cmd+Z (undo) and cursor/scroll survive a tab round-trip (issue #440).
 *
 * jsdom CANNOT drive real CodeMirror input, undo, or scroll geometry —
 * this spec uses the real Electron app via Playwright _electron.
 *
 * Root cause: <Editor> is keyed by `${activeTab.id}#${activeTab.path}`
 * (App.tsx:2064). On every tab switch the key changes, React unmounts the
 * old Editor and mounts a fresh one from initialContent (disk). The
 * CodeMirror EditorState — undo history, cursor, scroll — is destroyed,
 * and buffered (unsaved) edits are dropped from the UI.
 *
 * What is tested (all RED against current code, GREEN after fix):
 *
 *   A (content/undo): Type text in tab A, switch to B, switch back. Assert
 *     A still shows the typed text. Then Cmd+Z — assert it reverts.
 *     Both halves fail today: (1) remount wipes buffered text; (2) fresh
 *     EditorState has no history so Cmd+Z is a no-op even if text were present.
 *
 *   B (cursor): Move cursor to end of doc in A, capture the line number via
 *     CM's built-in position indicator, switch to B, switch back. Assert the
 *     indicator still shows the same line.
 *     Fails today: remount resets cursor to line 1.
 *
 *   C (scroll): Seed a long doc, scroll to the bottom, switch to B, switch
 *     back. Assert scrollTop > 0.
 *     Fails today: remount resets scrollTop to 0.
 *
 * Setup: temp vault + userData dir, launch via electron.launch, clean up
 * in afterEach. Mirrors dirty-state-close-prompt.spec.ts.
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
  const raw = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-e2e-undo-tabs-data-'))
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

async function openFileInSidebar(page: Page, namePart: string): Promise<void> {
  const fileRow = page.locator('.sidebar .file-tree-row.file', {
    hasText: new RegExp(`^${namePart}$`),
  })
  await expect(fileRow).toBeVisible({ timeout: 15_000 })
  await fileRow.click()
  await expect(page.locator('.note-tab-container:not([hidden])')).toBeVisible({ timeout: 8_000 })
}

async function switchToSourceMode(page: Page): Promise<void> {
  const sourceBtn = page.locator('button.mode-btn', { hasText: /source/i })
  await sourceBtn.waitFor({ state: 'visible', timeout: 4_000 }).catch(() => {})
  if (await sourceBtn.isVisible()) {
    await sourceBtn.click()
  }
  // Scope to the visible container: after the hidden-stack fix more than one
  // .cm-content may be present in the DOM (hidden editors are kept mounted).
  await expect(activeEditor(page).locator('.cm-content')).toBeVisible({ timeout: 6_000 })
}

async function clickTab(page: Page, namePart: string): Promise<void> {
  const tab = page.locator('.tab', { hasText: new RegExp(namePart, 'i') })
  await expect(tab).toBeVisible({ timeout: 8_000 })
  await tab.click()
  await page.waitForTimeout(300)
}

/**
 * Return a locator scoped to the currently-visible note-tab-container.
 *
 * After the hidden-stack fix multiple Editor instances are mounted
 * simultaneously (inactive ones with the HTML `hidden` attribute). Any
 * unscoped `.cm-content` / `.cm-scroller` / `.cm-activeLineGutter` query
 * would match all of them, causing strict-mode violations on `.click()` and
 * returning the wrong element on `.evaluate()`.
 *
 * Scoping to the visible container ensures we always target the active editor.
 */
function activeEditor(page: Page) {
  return page.locator('.note-tab-container:not([hidden])')
}

/** Ensure we're in Source mode (entering it if not already). */
async function ensureSourceMode(page: Page): Promise<void> {
  const modeBtn = page.locator('button.mode-btn', { hasText: /source/i })
  if (await modeBtn.isVisible().catch(() => false)) {
    await modeBtn.click()
    await expect(activeEditor(page).locator('.cm-content')).toBeVisible({ timeout: 6_000 })
  }
}

async function getScrollTop(page: Page): Promise<number> {
  return page.evaluate(() => {
    const container = document.querySelector(
      '.note-tab-container:not([hidden])'
    ) as HTMLElement | null
    const scroller = container?.querySelector('.cm-scroller') as HTMLElement | null
    return scroller?.scrollTop ?? 0
  })
}

// ---------------------------------------------------------------------------
// Suite A: Content preserved + undo history intact after round-trip
// ---------------------------------------------------------------------------

test.describe('editor content + undo — tab round-trip (issue #440)', () => {
  let vaultRoot: string
  let userDataDir: string

  test.beforeEach(async () => {
    const rawVault = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-e2e-undo-vault-'))
    vaultRoot = await fs.realpath(rawVault)
    await seedNote(vaultRoot, 'note-a', '# Note A\n\nOriginal content.\n')
    await seedNote(vaultRoot, 'note-b', '# Note B\n\nSome other content.\n')
    userDataDir = await createUserDataDir(vaultRoot)
  })

  test.afterEach(async () => {
    await fs.rm(vaultRoot, { recursive: true, force: true }).catch(() => {})
    await fs.rm(userDataDir, { recursive: true, force: true }).catch(() => {})
  })

  test('(A) typed content in tab A survives switching to B and back', async () => {
    // RED: remount loads initialContent (disk) — "TYPED" is lost from the editor.
    // GREEN: editor stays mounted — "TYPED" is still visible.
    const app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      env: { ...process.env, NODE_ENV: 'test' },
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    try {
      await openFileInSidebar(page, 'note-a')
      await switchToSourceMode(page)
      // Scope to the active (visible) container — required once the hidden-stack
      // fix lands and multiple .cm-content elements coexist in the DOM.
      await activeEditor(page).locator('.cm-content').click()
      await page.keyboard.press('End')
      await page.keyboard.type(' TYPED')
      await expect(activeEditor(page).locator('.cm-content')).toContainText('TYPED')

      await openFileInSidebar(page, 'note-b')
      await expect(page.locator('.tab.active', { hasText: /note-b/i })).toBeVisible({
        timeout: 5_000,
      })

      await clickTab(page, 'note-a')
      await expect(page.locator('.tab.active', { hasText: /note-a/i })).toBeVisible({
        timeout: 5_000,
      })
      await ensureSourceMode(page)

      // FAILS against current code: editor remounted with disk content,
      // "TYPED" is not present. Received: "# Note AOriginal content."
      // PASSES after fix: editor kept alive, "TYPED" still present.
      await expect(activeEditor(page).locator('.cm-content')).toContainText('TYPED', {
        timeout: 3_000,
      })
    } finally {
      await app.close()
    }
  })

  test('(A2) Cmd+Z reverts last edit after a tab round-trip', async () => {
    // RED: (a) content is lost on remount (see A), AND even if it weren't,
    // the fresh EditorState has no undo history — Cmd+Z is a no-op.
    // This test verifies both: after returning to A, "TYPED" must be present
    // (requires fix A to pass) AND Cmd+Z must remove it (requires fix A2).
    //
    // Against current code: "TYPED" is absent after remount (test A fails
    // first), so the `toContainText` here also fails with the same error —
    // confirming the undo pipeline is broken end-to-end.
    const app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      env: { ...process.env, NODE_ENV: 'test' },
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    try {
      await openFileInSidebar(page, 'note-a')
      await switchToSourceMode(page)
      await activeEditor(page).locator('.cm-content').click()
      await page.keyboard.press('End')
      await page.keyboard.type(' TYPED')
      await expect(activeEditor(page).locator('.cm-content')).toContainText('TYPED')

      await openFileInSidebar(page, 'note-b')
      await expect(page.locator('.tab.active', { hasText: /note-b/i })).toBeVisible({
        timeout: 5_000,
      })

      await clickTab(page, 'note-a')
      await expect(page.locator('.tab.active', { hasText: /note-a/i })).toBeVisible({
        timeout: 5_000,
      })
      await ensureSourceMode(page)

      // Pre-condition: content must still be present (requires fix A).
      // Fails against current code for the same reason as test A.
      await expect(activeEditor(page).locator('.cm-content')).toContainText('TYPED', {
        timeout: 3_000,
      })

      // Now undo. With fix: Cmd+Z reverts " TYPED" → content reverts to original.
      // Without fix: even if the pre-condition above somehow passed, the fresh
      // EditorState has no history — Cmd+Z is a no-op, "TYPED" remains.
      await activeEditor(page).locator('.cm-content').click()
      await page.keyboard.press(`${cmdKey}+z`)

      await expect(activeEditor(page).locator('.cm-content')).not.toContainText('TYPED', {
        timeout: 3_000,
      })
    } finally {
      await app.close()
    }
  })
})

// ---------------------------------------------------------------------------
// Suite B: Cursor line preserved after round-trip
// ---------------------------------------------------------------------------

test.describe('editor cursor — tab round-trip (issue #440)', () => {
  let vaultRoot: string
  let userDataDir: string

  test.beforeEach(async () => {
    const rawVault = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-e2e-cursor-vault-'))
    vaultRoot = await fs.realpath(rawVault)
    // 20-line note — cursor at end should be on line 20.
    const content = Array.from({ length: 20 }, (_, i) => `Line ${i + 1}.`).join('\n') + '\n'
    await seedNote(vaultRoot, 'cursor-a', content)
    await seedNote(vaultRoot, 'cursor-b', '# Cursor B\n\nAnother file.\n')
    userDataDir = await createUserDataDir(vaultRoot)
  })

  test.afterEach(async () => {
    await fs.rm(vaultRoot, { recursive: true, force: true }).catch(() => {})
    await fs.rm(userDataDir, { recursive: true, force: true }).catch(() => {})
  })

  test('(B) cursor line in tab A is preserved after switching to B and back', async () => {
    // RED: remount creates fresh EditorState — cursor resets to line 1.
    // GREEN: same EditorState — cursor stays on the last line (line 20).
    //
    // Strategy: CodeMirror renders the active line's gutter number with
    // class .cm-activeLineGutter. Its text content is the current line
    // number — a reliable, DOM-visible proxy for cursor position.
    const app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      env: { ...process.env, NODE_ENV: 'test' },
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    try {
      await openFileInSidebar(page, 'cursor-a')
      await switchToSourceMode(page)
      await activeEditor(page).locator('.cm-content').click()
      // Move cursor to the last line.
      await page.keyboard.press(`${cmdKey}+End`)
      await page.waitForTimeout(200)

      // Read the active line number from the gutter label.
      // Scoped to the active container so it doesn't match a hidden editor's
      // gutter when the hidden-stack fix puts multiple editors in the DOM.
      const lineGutterBefore = activeEditor(page).locator('.cm-activeLineGutter')
      await expect(lineGutterBefore).toBeVisible({ timeout: 3_000 })
      const lineBefore = parseInt((await lineGutterBefore.textContent()) ?? '0', 10)
      // 20-line doc; cursor at end = line 20.
      expect(lineBefore).toBeGreaterThan(1)

      await openFileInSidebar(page, 'cursor-b')
      await expect(page.locator('.tab.active', { hasText: /cursor-b/i })).toBeVisible({
        timeout: 5_000,
      })

      await clickTab(page, 'cursor-a')
      await expect(page.locator('.tab.active', { hasText: /cursor-a/i })).toBeVisible({
        timeout: 5_000,
      })
      // After fix: already in Source with EditorState intact — no click needed
      // (clicking .cm-content would move the cursor and invalidate the test).
      // Current code: remounted in preview — switch to Source.
      await ensureSourceMode(page)
      await page.waitForTimeout(200)

      const lineGutterAfter = activeEditor(page).locator('.cm-activeLineGutter')
      await expect(lineGutterAfter).toBeVisible({ timeout: 3_000 })
      const lineAfter = parseInt((await lineGutterAfter.textContent()) ?? '0', 10)

      // FAILS against current code: fresh EditorState → active line resets
      // to 1 (where the cursor lands on a new mount). lineAfter !== lineBefore.
      // PASSES after fix: same EditorState → lineAfter === lineBefore (= 20).
      expect(lineAfter).toBe(lineBefore)
    } finally {
      await app.close()
    }
  })
})

// ---------------------------------------------------------------------------
// Suite C: Scroll position preserved after round-trip
// ---------------------------------------------------------------------------

test.describe('editor scroll — tab round-trip (issue #440)', () => {
  let vaultRoot: string
  let userDataDir: string

  test.beforeEach(async () => {
    const rawVault = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-e2e-scroll-vault-'))
    vaultRoot = await fs.realpath(rawVault)
    const longContent =
      Array.from({ length: 80 }, (_, i) => `Line ${i + 1}: content for scroll testing.`).join(
        '\n'
      ) + '\n'
    await seedNote(vaultRoot, 'scroll-a', longContent)
    await seedNote(vaultRoot, 'scroll-b', '# Scroll B\n\nShort file.\n')
    userDataDir = await createUserDataDir(vaultRoot)
  })

  test.afterEach(async () => {
    await fs.rm(vaultRoot, { recursive: true, force: true }).catch(() => {})
    await fs.rm(userDataDir, { recursive: true, force: true }).catch(() => {})
  })

  test('(C) scroll position in tab A is preserved after switching to B and back', async () => {
    // RED: remount resets scrollTop to 0.
    // GREEN: live EditorView scroll position is preserved.
    const app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      env: { ...process.env, NODE_ENV: 'test' },
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    try {
      await openFileInSidebar(page, 'scroll-a')
      await switchToSourceMode(page)
      await activeEditor(page).locator('.cm-content').click()
      await page.keyboard.press(`${cmdKey}+End`)
      await page.waitForTimeout(400)

      // getScrollTop already scopes to the visible container (see helper above).
      const scrollBefore = await getScrollTop(page)
      expect(scrollBefore).toBeGreaterThan(0)

      await openFileInSidebar(page, 'scroll-b')
      await expect(page.locator('.tab.active', { hasText: /scroll-b/i })).toBeVisible({
        timeout: 5_000,
      })

      await clickTab(page, 'scroll-a')
      await expect(page.locator('.tab.active', { hasText: /scroll-a/i })).toBeVisible({
        timeout: 5_000,
      })
      await ensureSourceMode(page)
      await page.waitForTimeout(300)

      const scrollAfter = await getScrollTop(page)

      // FAILS against current code: new EditorView starts at scrollTop 0.
      // PASSES after fix: existing EditorView scroll is preserved.
      expect(scrollAfter).toBeGreaterThan(0)
      expect(Math.abs(scrollAfter - scrollBefore)).toBeLessThanOrEqual(10)
    } finally {
      await app.close()
    }
  })
})
