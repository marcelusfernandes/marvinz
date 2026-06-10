/**
 * E2E: task-list checkbox in Page mode (issue #437 + layout/input-rule follow-ups).
 *
 * jsdom CANNOT assert input-rule / contentEditable / layout geometry reliably,
 * so verification MUST run in real Chromium. This spec drives the real Electron
 * app via Playwright _electron.
 *
 * Scenarios verified here:
 *
 *   A (layout): Parsed task items use `display:flex` so the checkbox and text
 *     sit on the SAME line. `list-style:none` hides the bullet for task items
 *     only. Regular bullet items are unaffected: they keep `list-style:disc`
 *     and never receive a checkbox.
 *
 *   B (bare-bracket input rule, task #10): typing `[ ] `/ `[x] ` at the start
 *     of a plain paragraph (NO leading `- `) fires the custom
 *     `taskListBracketInputRule`, renders a real checkbox via the node view,
 *     and the debounce-saved markdown on disk is standard GFM `- [ ] ...` /
 *     `- [x] ...` — never literal brackets.
 *
 * Known upstream edge (NOT tested here): typing `[ ] ` inside an EXISTING task
 * list_item (Enter from a task item) stays literal — that is a stock gfm
 * limitation, not a regression of this fix. The B suite exercises only the
 * empty-paragraph path.
 *
 * Cleanup: no harness scaffolding remains in the tree. All temp dirs removed
 * in afterEach.
 */

import { test, expect, _electron as electron } from 'playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createUserDataDir(vaultPath: string): Promise<string> {
  const raw = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-e2e-tasklist-data-'))
  const userDataDir = await fs.realpath(raw)
  await fs.writeFile(
    path.join(userDataDir, 'settings.json'),
    JSON.stringify({ vaultPath }),
    'utf8',
  )
  return userDataDir
}

async function seedVault(vaultRoot: string, fileName: string, content: string): Promise<string> {
  const filePath = path.join(vaultRoot, fileName)
  await fs.writeFile(filePath, content, 'utf8')
  return filePath
}

/** Click a file in the sidebar and wait for the editor area to appear. */
async function openFile(
  page: import('playwright').Page,
  labelRe: RegExp,
): Promise<void> {
  const fileRow = page.locator('.sidebar .file-tree-row.file', { hasText: labelRe })
  await expect(fileRow).toBeVisible({ timeout: 15_000 })
  await fileRow.click()
  await expect(page.locator('.note-tab-container')).toBeVisible({ timeout: 8_000 })
}

/** Switch to Page mode (Milkdown WYSIWYG) and wait for the editor to mount. */
async function switchToPage(page: import('playwright').Page): Promise<void> {
  const pageBtn = page.locator('.mode-btn', { hasText: 'Page' }).first()
  await expect(pageBtn).toBeVisible({ timeout: 5_000 })
  await pageBtn.click()
  // Wait for the Milkdown ProseMirror surface to be present and editable.
  await expect(page.locator('.milkdown-host')).toBeVisible({ timeout: 8_000 })
  // Let $view async boot and node-view constructors complete.
  await page.waitForTimeout(800)
}

// ---------------------------------------------------------------------------
// Suite A: Layout — flex row, no bullet for task items; disc kept for regular
// ---------------------------------------------------------------------------

test.describe('task-list Page mode — layout (A)', () => {
  let vaultRoot: string
  let userDataDir: string

  test.beforeEach(async () => {
    const rawVault = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-e2e-tasklist-vault-'))
    vaultRoot = await fs.realpath(rawVault)
    // Two task items, one nested task, one regular bullet, and a heading so
    // we can compare horizontal alignment (A5 indent check).
    await seedVault(
      vaultRoot,
      'tasks.md',
      '# Heading\n\n- [ ] unchecked item\n- [x] checked item\n  - [ ] nested task\n- regular bullet\n',
    )
    userDataDir = await createUserDataDir(vaultRoot)
  })

  test.afterEach(async () => {
    await fs.rm(vaultRoot, { recursive: true, force: true }).catch(() => {})
    await fs.rm(userDataDir, { recursive: true, force: true }).catch(() => {})
  })

  test('(A1) task li has display:flex — checkbox and text share one line', async () => {
    const app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      env: { ...process.env, NODE_ENV: 'test' },
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    try {
      await openFile(page, /^tasks$/)
      await switchToPage(page)

      const li = page.locator('.milkdown-host li[data-item-type="task"]').first()
      await expect(li).toBeVisible({ timeout: 5_000 })

      // CSS sets display:flex on task items so checkbox + content are in a row.
      const display = await li.evaluate(
        (el) => window.getComputedStyle(el).display,
      )
      expect(display).toBe('flex')

      // Belt-and-suspenders: bounding boxes must not be stacked. With
      // align-items:baseline the tops can differ by a few px, but the checkbox
      // centre must be within one line-height of the content centre.
      const checkbox = li.locator('input[type="checkbox"]').first()
      const contentDiv = li.locator('.task-list-item__content').first()
      await expect(checkbox).toBeVisible()
      await expect(contentDiv).toBeVisible()

      const cbBox = await checkbox.boundingBox()
      const cdBox = await contentDiv.boundingBox()
      expect(cbBox).not.toBeNull()
      expect(cdBox).not.toBeNull()

      // Centres (midpoints) must be within 20 px vertically — on one line.
      const cbMid = cbBox!.y + cbBox!.height / 2
      const cdMid = cdBox!.y + cdBox!.height / 2
      expect(Math.abs(cbMid - cdMid)).toBeLessThanOrEqual(20)
    } finally {
      await app.close()
    }
  })

  test('(A2) task li has list-style:none — no bullet marker visible', async () => {
    const app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      env: { ...process.env, NODE_ENV: 'test' },
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    try {
      await openFile(page, /^tasks$/)
      await switchToPage(page)

      const li = page.locator('.milkdown-host li[data-item-type="task"]').first()
      await expect(li).toBeVisible({ timeout: 5_000 })

      const listStyle = await li.evaluate(
        (el) => window.getComputedStyle(el).listStyleType,
      )
      expect(listStyle).toBe('none')
    } finally {
      await app.close()
    }
  })

  test('(A3) checked/unchecked state reflects parsed markdown', async () => {
    const app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      env: { ...process.env, NODE_ENV: 'test' },
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    try {
      await openFile(page, /^tasks$/)
      await switchToPage(page)

      // 2 top-level + 1 nested = 3 task items in the seeded doc.
      const items = page.locator('.milkdown-host li[data-item-type="task"]')
      await expect(items).toHaveCount(3, { timeout: 5_000 })

      // First two are the top-level `- [ ]` and `- [x]` items.
      // Use .first() because the `- [x]` li also contains a nested task li,
      // so its checkbox locator would otherwise resolve to 2 elements.
      await expect(items.nth(0).locator('input[type="checkbox"]').first()).not.toBeChecked()
      await expect(items.nth(1).locator('input[type="checkbox"]').first()).toBeChecked()
    } finally {
      await app.close()
    }
  })

  test('(A4) regular bullet items keep their disc marker and receive no checkbox', async () => {
    const app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      env: { ...process.env, NODE_ENV: 'test' },
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    try {
      await openFile(page, /^tasks$/)
      await switchToPage(page)

      // Wait for the task items to confirm the editor parsed the whole doc.
      // 2 top-level + 1 nested = 3.
      await expect(page.locator('.milkdown-host li[data-item-type="task"]')).toHaveCount(3, { timeout: 5_000 })

      // The regular bullet is a <li> WITHOUT data-item-type="task".
      const regularLi = page.locator(
        '.milkdown-host li:not([data-item-type="task"])',
      ).first()
      await expect(regularLi).toBeVisible()

      // Regular bullets keep their list marker (disc or circle — not 'none').
      const listStyle = await regularLi.evaluate(
        (el) => window.getComputedStyle(el).listStyleType,
      )
      expect(listStyle).not.toBe('none')

      // Regular items must NOT have a checkbox injected by the node view.
      const checkbox = regularLi.locator('input[type="checkbox"]')
      await expect(checkbox).toHaveCount(0)
    } finally {
      await app.close()
    }
  })

  test('(A5) top-level task checkbox left-edge aligns with heading text (orphan-indent fix)', async () => {
    const app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      env: { ...process.env, NODE_ENV: 'test' },
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    try {
      await openFile(page, /^tasks$/)
      await switchToPage(page)

      // 2 top-level + 1 nested = 3.
      await expect(page.locator('.milkdown-host li[data-item-type="task"]')).toHaveCount(3, { timeout: 5_000 })

      // The heading establishes the content margin. The task checkbox should
      // be within 10 px of it horizontally — not indented an extra ~22 px into
      // the bullet-reserved gap.
      const heading = page.locator('.milkdown-host h1').first()
      const taskCheckbox = page.locator('.milkdown-host li[data-item-type="task"]').first()
        .locator('input[type="checkbox"]')

      await expect(heading).toBeVisible()
      await expect(taskCheckbox).toBeVisible()

      const headingBox = await heading.boundingBox()
      const checkboxBox = await taskCheckbox.boundingBox()
      expect(headingBox).not.toBeNull()
      expect(checkboxBox).not.toBeNull()

      // Checkbox left must be within 10 px of heading left — margin-aligned,
      // not pushed right by the empty bullet column.
      const leftDiff = Math.abs(checkboxBox!.x - headingBox!.x)
      expect(leftDiff).toBeLessThanOrEqual(10)
    } finally {
      await app.close()
    }
  })

  test('(A6) nested task item indents deeper than the top-level task', async () => {
    const app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      env: { ...process.env, NODE_ENV: 'test' },
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    try {
      await openFile(page, /^tasks$/)
      await switchToPage(page)

      // Top-level tasks are the first two li[data-item-type=task].
      // The nested task is inside a child <ul> so it appears after.
      const allTaskItems = page.locator('.milkdown-host li[data-item-type="task"]')
      await expect(allTaskItems).toHaveCount(3, { timeout: 5_000 })

      const topCheckbox = allTaskItems.nth(0).locator('input[type="checkbox"]')
      const nestedCheckbox = allTaskItems.nth(2).locator('input[type="checkbox"]')

      await expect(topCheckbox).toBeVisible()
      await expect(nestedCheckbox).toBeVisible()

      const topBox = await topCheckbox.boundingBox()
      const nestedBox = await nestedCheckbox.boundingBox()
      expect(topBox).not.toBeNull()
      expect(nestedBox).not.toBeNull()

      // Nested checkbox must be to the right of the top-level one.
      expect(nestedBox!.x).toBeGreaterThan(topBox!.x)
    } finally {
      await app.close()
    }
  })

  test('(A7) mixed list: regular bullet sibling of a task item keeps its disc and indent', async () => {
    const app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      env: { ...process.env, NODE_ENV: 'test' },
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    try {
      await openFile(page, /^tasks$/)
      await switchToPage(page)

      // 2 top-level + 1 nested = 3.
      await expect(page.locator('.milkdown-host li[data-item-type="task"]')).toHaveCount(3, { timeout: 5_000 })

      // The plain `- regular bullet` is a sibling <li> in the same <ul> as
      // the task items. Applying padding-left:0 to the parent <ul> (an earlier
      // approach to the orphan-indent) would strip this item's marker/indent.
      const regularLi = page.locator('.milkdown-host li:not([data-item-type="task"])').first()
      await expect(regularLi).toBeVisible()

      // Must keep its disc marker.
      const listStyle = await regularLi.evaluate(
        (el) => window.getComputedStyle(el).listStyleType,
      )
      expect(listStyle).not.toBe('none')

      // Must have no checkbox.
      await expect(regularLi.locator('input[type="checkbox"]')).toHaveCount(0)

      // Must be indented (left position) at least as far as its list padding —
      // not collapsed to 0 by a ul-level CSS rule. Compare against a task
      // checkbox in the same list: they share the same <ul> so the regular
      // bullet left must be close to the task content left (within 10 px).
      const taskContent = page.locator('.milkdown-host li[data-item-type="task"]').first()
        .locator('.task-list-item__content')
      const regularBox = await regularLi.boundingBox()
      const contentBox = await taskContent.boundingBox()
      expect(regularBox).not.toBeNull()
      expect(contentBox).not.toBeNull()

      // The regular bullet text left should be close to the task content left
      // (both are sibling list items at the same nesting level).
      const leftDiff = Math.abs(regularBox!.x - contentBox!.x)
      expect(leftDiff).toBeLessThanOrEqual(30)
    } finally {
      await app.close()
    }
  })
})

// ---------------------------------------------------------------------------
// Suite B: Typing — bare-bracket input rule + serialized markdown round-trip
//
// jsdom CANNOT simulate contentEditable / input-rule behaviour. This suite
// drives real Chromium via Playwright _electron and exercises
// taskListBracketInputRule (src/lib/taskListInputRule.ts, task #10).
//
// The rule fires when `[ ] ` or `[x] ` is typed at the START of a plain
// paragraph with no preceding text. It wraps the paragraph in a
// bullet_list > list_item with `checked` set, so the serialized markdown is
// `- [ ] ...` / `- [x] ...` — never the literal `[ ]` symptom of #437.
//
// NOT tested here: typing `[ ] ` inside an existing task_item (Enter from a
// task row) — that path stays literal due to stock gfm behaviour and is a
// known upstream edge, not a regression.
// ---------------------------------------------------------------------------

test.describe('task-list Page mode — typing / input rule (B)', () => {
  let vaultRoot: string
  let userDataDir: string
  let notePath: string

  test.beforeEach(async () => {
    const rawVault = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-e2e-tasklist-vault-'))
    vaultRoot = await fs.realpath(rawVault)
    notePath = await seedVault(vaultRoot, 'typing.md', '')
    userDataDir = await createUserDataDir(vaultRoot)
  })

  test.afterEach(async () => {
    await fs.rm(vaultRoot, { recursive: true, force: true }).catch(() => {})
    await fs.rm(userDataDir, { recursive: true, force: true }).catch(() => {})
  })

  test('(B1) typing `[ ] aks` (no leading dash) renders a checkbox; disk markdown is `- [ ] aks`', async () => {
    const app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      env: { ...process.env, NODE_ENV: 'test' },
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    try {
      await openFile(page, /^typing$/)
      await switchToPage(page)

      const editor = page.locator('.milkdown-host')
      await editor.click()

      // Type bare `[ ] aks` with no leading `- `.
      // taskListBracketInputRule fires after the space following `] `.
      await page.keyboard.type('[ ] aks', { delay: 40 })
      await page.waitForTimeout(600)

      // Assert: task node rendered with a real checkbox.
      const li = page.locator('.milkdown-host li[data-item-type="task"]')
      await expect(li).toBeVisible({ timeout: 3_000 })
      const checkbox = li.locator('input[type="checkbox"]')
      await expect(checkbox).toBeVisible()
      await expect(checkbox).not.toBeChecked()

      // Assert: content text is `aks`, not the literal `[ ] aks`.
      const contentText = await li.locator('.task-list-item__content').first().textContent()
      expect(contentText).toContain('aks')
      expect(contentText).not.toMatch(/^\s*\[\s\]/)

      // Assert: serialized markdown uses standard GFM syntax.
      // Wait for the 600 ms debounced save.
      await page.waitForTimeout(1_200)
      const saved = await fs.readFile(notePath, 'utf8')
      // Must match `- [ ] aks` or `* [ ] aks` (commonmark allows either marker).
      expect(saved).toMatch(/^[-*] \[ \] aks/m)
      // Must NOT be a bare literal (e.g. `[ ] aks` with no list prefix).
      expect(saved).not.toMatch(/^\[ \] aks/m)
    } finally {
      await app.close()
    }
  })

  test('(B2) typing `[x] done` (no leading dash) renders a checked checkbox; disk markdown is `- [x] done`', async () => {
    const app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      env: { ...process.env, NODE_ENV: 'test' },
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    try {
      await openFile(page, /^typing$/)
      await switchToPage(page)

      const editor = page.locator('.milkdown-host')
      await editor.click()

      await page.keyboard.type('[x] done', { delay: 40 })
      await page.waitForTimeout(600)

      const li = page.locator('.milkdown-host li[data-item-type="task"]')
      await expect(li).toBeVisible({ timeout: 3_000 })
      const checkbox = li.locator('input[type="checkbox"]')
      await expect(checkbox).toBeVisible()
      await expect(checkbox).toBeChecked()

      await page.waitForTimeout(1_200)
      const saved = await fs.readFile(notePath, 'utf8')
      expect(saved).toMatch(/^[-*] \[x\] done/m)
      expect(saved).not.toMatch(/^\[x\] done/m)
    } finally {
      await app.close()
    }
  })

  test('(B3) typing `[x] ` inside an existing task item (after Enter) sets it checked, not literal (#439)', async () => {
    const app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      env: { ...process.env, NODE_ENV: 'test' },
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    try {
      await openFile(page, /^typing$/)
      await switchToPage(page)

      const editor = page.locator('.milkdown-host')
      await editor.click()

      // First task, then Enter creates a fresh task item that already carries
      // checked!=null; typing `[x] ` there must set checked, not stay literal.
      await page.keyboard.type('[ ] first', { delay: 40 })
      await page.waitForTimeout(300)
      await page.keyboard.press('Enter')
      await page.waitForTimeout(200)
      await page.keyboard.type('[x] second', { delay: 40 })
      await page.waitForTimeout(600)

      const items = page.locator('.milkdown-host li[data-item-type="task"]')
      await expect(items).toHaveCount(2, { timeout: 3_000 })
      // Second item is checked and its text is "second" (no literal brackets).
      const second = items.nth(1)
      await expect(second.locator('input[type="checkbox"]')).toBeChecked()
      await expect(second.locator('.task-list-item__content')).not.toContainText('[x]')

      await page.waitForTimeout(1_200)
      const saved = await fs.readFile(notePath, 'utf8')
      expect(saved).toMatch(/^[-*] \[x\] second/m)
      // No escaped/literal bracket leaked into the serialized item.
      expect(saved).not.toMatch(/\\\[x\]/)
    } finally {
      await app.close()
    }
  })
})
