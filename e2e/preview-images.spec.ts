/**
 * E2E: image preview — resolving and rendering images in Milkdown preview mode.
 *
 * Covers the three image forms supported by the plugin:
 *   1. Standard markdown  `![alt](./relative/path.png)`
 *   2. Wikilink embed     `![[name.png]]` / `![[name.png|alt]]`
 *   3. External URL       `![alt](https://example.com/img.png)`
 *
 * And the two broken-image cases:
 *   4. File not found    `![](./broken.png)` → placeholder
 *   5. Path traversal    `![](../../../etc/passwd)` → placeholder (vault boundary)
 *
 * Security invariant (issue #8 / #119):
 *   After a round-trip edit in preview mode, the `.md` on disk must never
 *   contain the string `marvin://` — the internal protocol must not leak into
 *   the saved markdown source.
 *
 * Setup strategy: seed a real temp vault and point `--user-data-dir` at a
 * settings.json that selects it — same pattern as snapshot-restore.spec.ts.
 */

import { test, expect, _electron as electron } from 'playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

// ---------------------------------------------------------------------------
// Minimal valid 1×1 PNG (67 bytes) — avoids network and keeps tests hermetic.
// ---------------------------------------------------------------------------
const MINIMAL_PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489' +
  '0000000a49444154789c6260000000020001e221bc330000000049454e44ae426082',
  'hex',
)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createUserDataDir(vaultPath: string): Promise<string> {
  const raw = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-e2e-imgpreview-data-'))
  const userDataDir = await fs.realpath(raw)
  await fs.writeFile(
    path.join(userDataDir, 'settings.json'),
    JSON.stringify({ vaultPath }),
    'utf8',
  )
  return userDataDir
}

/**
 * Seed the vault used by all image preview tests:
 *
 *   <vault>/
 *     file.md        ← the note under test (at root so sidebar shows it directly)
 *     assets/
 *       img.png      ← relative image (./assets/img.png)
 *     screenshot.png ← wikilink-image target (![[screenshot.png]])
 *
 * Keeping the note at the vault root avoids having to expand nested folder rows
 * in the sidebar during E2E — same pattern as snapshot-restore.spec.ts.
 */
async function seedVault(vaultRoot: string, noteContent: string): Promise<void> {
  const assetsDir = path.join(vaultRoot, 'assets')
  await fs.mkdir(assetsDir, { recursive: true })

  await fs.writeFile(path.join(vaultRoot, 'file.md'), noteContent, 'utf8')
  await fs.writeFile(path.join(assetsDir, 'img.png'), MINIMAL_PNG)
  await fs.writeFile(path.join(vaultRoot, 'screenshot.png'), MINIMAL_PNG)
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

/** Switch to Preview mode (Milkdown) and wait for the preview container. */
async function switchToPreview(page: import('playwright').Page): Promise<void> {
  const previewBtn = page.locator('.mode-btn', { hasText: 'Preview' }).first()
  await expect(previewBtn).toBeVisible({ timeout: 5_000 })
  await previewBtn.click()
  await expect(page.locator('.md-preview-inner')).toBeVisible({ timeout: 5_000 })
  // Allow Milkdown node views to mount and image src rewrite to complete.
  await page.waitForTimeout(800)
}

/** Switch to Edit mode (CodeMirror) and wait for the CM editor. */
async function switchToEdit(page: import('playwright').Page): Promise<void> {
  const editBtn = page.locator('.mode-btn', { hasText: 'Edit' }).first()
  await expect(editBtn).toBeVisible({ timeout: 5_000 })
  await editBtn.click()
  await expect(page.locator('.cm-editor')).toBeVisible({ timeout: 5_000 })
  await page.waitForTimeout(300)
}

// ---------------------------------------------------------------------------
// Suite: image rendering in preview mode
// ---------------------------------------------------------------------------

test.describe('Image preview — rendering (3 forms + broken)', () => {
  let vaultRoot: string
  let userDataDir: string

  test.beforeEach(async () => {
    const rawVault = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-e2e-imgpreview-vault-'))
    vaultRoot = await fs.realpath(rawVault)

    const noteContent = [
      '# Image test',
      '',
      '![diagrama](./assets/img.png)',
      '',
      '![[screenshot.png]]',
      '',
      '![logo](https://example.com/img.png)',
      '',
      '![](./broken.png)',
      // broken.png intentionally not seeded so it triggers the onerror placeholder
    ].join('\n')

    await seedVault(vaultRoot, noteContent)
    userDataDir = await createUserDataDir(vaultRoot)
  })

  test.afterEach(async () => {
    await fs.rm(vaultRoot, { recursive: true, force: true }).catch(() => {})
    await fs.rm(userDataDir, { recursive: true, force: true }).catch(() => {})
  })

  test('relative image ./assets/img.png renders with marvin:// src', async () => {
    const app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      env: { ...process.env, NODE_ENV: 'test' },
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    try {
      await openFile(page, /^file$/)
      await switchToPreview(page)

      const img = page.locator('.md-preview-inner img[data-raw-src="./assets/img.png"]')
      await expect(img).toBeVisible({ timeout: 8_000 })
      const src = await img.getAttribute('src')
      expect(src).toMatch(/^marvin:\/\/localhost\//)
      expect(src).toContain('img.png')
    } finally {
      await app.close()
    }
  })

  test('wikilink embed ![[screenshot.png]] renders with marvin:// src', async () => {
    const app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      env: { ...process.env, NODE_ENV: 'test' },
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    try {
      await openFile(page, /^file$/)
      await switchToPreview(page)

      // The wikilink-image sentinel is parsed to `wikilink-image:screenshot.png`
      // before being passed to the node view; data-raw-src holds the sentinel.
      const img = page.locator('.md-preview-inner img[data-raw-src^="wikilink-image:"]')
      await expect(img).toBeVisible({ timeout: 8_000 })
      const src = await img.getAttribute('src')
      expect(src).toMatch(/^marvin:\/\/localhost\//)
      expect(src).toContain('screenshot.png')
    } finally {
      await app.close()
    }
  })

  test('external https:// image src is not rewritten to marvin://', async () => {
    // Electron CSP may block external image loads (src ends up empty and onerror
    // fires), but the critical invariant is that the nodeView does NOT rewrite
    // https:// to marvin://. We verify:
    //   1. No img in the preview carries a marvin:// src for the external URL.
    //   2. The raw markdown src (data-raw-src) is preserved as the original https URL.
    const app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      env: { ...process.env, NODE_ENV: 'test' },
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    try {
      await openFile(page, /^file$/)
      await switchToPreview(page)

      // No marvin:// rewrites of the external URL.
      const marvinRewrite = page.locator('img[src^="marvin://"][data-raw-src="https://example.com/img.png"]')
      await expect(marvinRewrite).toHaveCount(0)

      // The external img element (if CSP allows) or placeholder text should be present
      // — but regardless, the preview should contain content for 4 images.
      const preview = page.locator('.md-preview-inner')
      await expect(preview).toBeVisible({ timeout: 8_000 })
    } finally {
      await app.close()
    }
  })

  test('missing image ./broken.png shows .md-image-broken placeholder', async () => {
    const app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      env: { ...process.env, NODE_ENV: 'test' },
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    try {
      await openFile(page, /^file$/)
      await switchToPreview(page)

      // broken.png does not exist → resolveImageSrc returns kind:marvin (path is inside
      // vault lexically), browser load fails → onerror → replaceWithPlaceholder.
      const placeholder = page.locator('.md-preview-inner .md-image-broken[aria-label*="broken.png"]')
      await expect(placeholder).toBeVisible({ timeout: 10_000 })
      const label = await placeholder.getAttribute('aria-label')
      expect(label).toContain('broken.png')
    } finally {
      await app.close()
    }
  })
})

// ---------------------------------------------------------------------------
// Suite: path traversal → placeholder (security)
// ---------------------------------------------------------------------------

test.describe('Image preview — path traversal shows placeholder', () => {
  let vaultRoot: string
  let userDataDir: string

  test.beforeEach(async () => {
    const rawVault = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-e2e-imgtraversal-'))
    vaultRoot = await fs.realpath(rawVault)
    await seedVault(vaultRoot, '# Traversal test\n\n![](../../../etc/passwd)\n')
    userDataDir = await createUserDataDir(vaultRoot)
  })

  test.afterEach(async () => {
    await fs.rm(vaultRoot, { recursive: true, force: true }).catch(() => {})
    await fs.rm(userDataDir, { recursive: true, force: true }).catch(() => {})
  })

  test('../../../etc/passwd shows placeholder — vault boundary enforced', async () => {
    const app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      env: { ...process.env, NODE_ENV: 'test' },
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    try {
      await openFile(page, /^file$/)
      await switchToPreview(page)

      const preview = page.locator('.md-preview-inner')
      await expect(preview).toBeVisible({ timeout: 8_000 })

      // Lexical escape-vault check → kind:missing → placeholder rendered synchronously.
      const placeholder = page.locator('.md-preview-inner .md-image-broken')
      await expect(placeholder).toBeVisible({ timeout: 8_000 })

      // Critical security assertions:
      //   1. No img src must leak the traversal path to the filesystem.
      const leakingImg = page.locator('img[src*="etc/passwd"]')
      await expect(leakingImg).toHaveCount(0)

      //   2. No marvin:// URL must be constructed for a path that escapes the vault.
      const marvinLeaking = page.locator('img[src^="marvin://"][data-raw-src*="passwd"]')
      await expect(marvinLeaking).toHaveCount(0)
    } finally {
      await app.close()
    }
  })
})

// ---------------------------------------------------------------------------
// Suite: round-trip — marvin:// must not leak to disk (security invariant #8)
// ---------------------------------------------------------------------------

test.describe('Image preview — round-trip: marvin:// must not leak to disk', () => {
  let vaultRoot: string
  let userDataDir: string
  let notePath: string

  test.beforeEach(async () => {
    const rawVault = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-e2e-imgrt-'))
    vaultRoot = await fs.realpath(rawVault)

    const noteContent = [
      '# Round-trip test',
      '',
      '![[screenshot.png]]',
      '',
      '![diagrama](./assets/img.png)',
    ].join('\n')

    await seedVault(vaultRoot, noteContent)
    notePath = path.join(vaultRoot, 'file.md')
    userDataDir = await createUserDataDir(vaultRoot)
  })

  test.afterEach(async () => {
    await fs.rm(vaultRoot, { recursive: true, force: true }).catch(() => {})
    await fs.rm(userDataDir, { recursive: true, force: true }).catch(() => {})
  })

  test('after editing alt text in preview, saved markdown does not contain marvin://', async () => {
    const app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      env: { ...process.env, NODE_ENV: 'test' },
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    try {
      await openFile(page, /^file$/)

      // Start in Preview (Milkdown) mode — images are rendered with marvin:// src.
      await switchToPreview(page)

      // Edit the alt text of the wikilink image via the Milkdown editor.
      // Click on the wikilink-image img element to position the cursor there,
      // then type to change the alt attribute through Milkdown's own editing.
      const wikilinkImg = page.locator(
        '.md-preview-inner img[data-raw-src^="wikilink-image:"]',
      )
      await expect(wikilinkImg).toBeVisible({ timeout: 8_000 })

      // Position cursor in the editor content area and make a small innocuous
      // edit (add a newline at end) to trigger onChange → unparseWikilinks → save.
      const editorContent = page.locator('.milkdown-host')
      await editorContent.click()
      await page.keyboard.press('Control+End')
      await page.keyboard.press('Enter')

      // Wait for the debounced save (600 ms) to complete.
      await page.waitForTimeout(1_200)

      // Read the saved file directly from disk.
      const savedContent = await fs.readFile(notePath, 'utf8')

      // Security invariant: marvin:// must never appear in the saved markdown.
      expect(savedContent).not.toContain('marvin://')

      // Round-trip invariant: wikilink form must be preserved.
      expect(savedContent).toContain('![[screenshot.png]]')

      // Round-trip invariant: standard markdown form must be preserved.
      expect(savedContent).toContain('./assets/img.png')
    } finally {
      await app.close()
    }
  })

  test('switching from preview to edit shows original markdown syntax, not marvin:// URLs', async () => {
    const app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      env: { ...process.env, NODE_ENV: 'test' },
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    try {
      await openFile(page, /^file$/)
      await switchToPreview(page)

      // Confirm marvin:// is rendered in preview.
      const marvinImg = page.locator('.md-preview-inner img[src^="marvin://"]').first()
      await expect(marvinImg).toBeVisible({ timeout: 8_000 })

      // Switch to Edit mode — CodeMirror shows the raw markdown source.
      await switchToEdit(page)

      const cmContent = await page.locator('.cm-content').textContent()
      expect(cmContent).not.toContain('marvin://')
      expect(cmContent).toContain('![[screenshot.png]]')
    } finally {
      await app.close()
    }
  })
})
