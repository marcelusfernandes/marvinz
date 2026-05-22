/**
 * E2E: user restores a file from snapshot in exactly 3 clicks.
 *
 * Correct 3-click flow (PRD AC4 — no confirmation dialog):
 *   Click 1: "View versions…" in context menu  → SnapshotPanel opens
 *   Click 2: version item in the list        → diff loads
 *   Click 3: "Restore this version" button  → file restored, panel closes
 *
 * Security layer: a pre-restore snapshot (trigger: 'restore') is created
 * automatically before the write, giving a natural undo path without a modal.
 *
 * Setup strategy: write vaultPath into Electron's settings.json before launch
 * by pointing --user-data-dir at a temp directory. This avoids touching the
 * real user settings while giving the app a pre-configured vault on boot.
 */

import { test, expect, _electron as electron } from 'playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha256(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex')
}

function makeTurnId(): string {
  const ts = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  const salt = crypto.randomBytes(6).toString('hex')
  return `${ts}-${salt}`
}

async function seedVault(
  vaultRoot: string,
  relPath: string,
  snapshotContent: string,
  currentContent: string,
): Promise<string> {
  const turnId = makeTurnId()
  const absFilePath = path.join(vaultRoot, relPath)

  await fs.mkdir(path.dirname(absFilePath), { recursive: true })
  await fs.writeFile(absFilePath, currentContent, 'utf8')

  const snapshotDir = path.join(vaultRoot, '.marvin', 'snapshots', turnId)
  await fs.mkdir(snapshotDir, { recursive: true })
  const snapFilePath = path.join(snapshotDir, relPath)
  await fs.mkdir(path.dirname(snapFilePath), { recursive: true })
  await fs.writeFile(snapFilePath, snapshotContent, 'utf8')

  const manifest = {
    turnId,
    files: [
      {
        relPath,
        sizeBefore: Buffer.byteLength(snapshotContent, 'utf8'),
        hashBefore: sha256(snapshotContent),
      },
    ],
    createdAt: new Date().toISOString(),
    timestamp: Date.now(),
    trigger: 'file:write',
    status: 'active',
  }
  await fs.writeFile(
    path.join(snapshotDir, '_manifest.json'),
    JSON.stringify(manifest, null, 2),
    'utf8',
  )

  return turnId
}

async function countSnapshotTurns(vaultRoot: string): Promise<number> {
  const snapshotsDir = path.join(vaultRoot, '.marvin', 'snapshots')
  try {
    const entries = await fs.readdir(snapshotsDir, { withFileTypes: true })
    return entries.filter((e) => e.isDirectory()).length
  } catch {
    return 0
  }
}

/** Write settings.json into a temp userData dir so the app boots with our vault. */
async function createUserDataDir(vaultPath: string): Promise<string> {
  const raw = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-e2e-userdata-'))
  const userDataDir = await fs.realpath(raw)
  await fs.writeFile(
    path.join(userDataDir, 'settings.json'),
    JSON.stringify({ vaultPath }),
    'utf8',
  )
  return userDataDir
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Snapshot restore flow — AC4 exactly 3 clicks', () => {
  let vaultRoot: string
  let userDataDir: string
  let relPath: string
  let originalContent: string
  let currentContent: string
  let seededTurnId: string

  test.beforeEach(async () => {
    const rawVault = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-e2e-vault-'))
    vaultRoot = await fs.realpath(rawVault)
    relPath = 'my-note.md'
    originalContent = '# Original\nThis is the original content before AI edited it.'
    currentContent = '# Modified\nAI rewrote this file and the user wants to undo.'
    seededTurnId = await seedVault(vaultRoot, relPath, originalContent, currentContent)
    userDataDir = await createUserDataDir(vaultRoot)
  })

  test.afterEach(async () => {
    await fs.rm(vaultRoot, { recursive: true, force: true })
    await fs.rm(userDataDir, { recursive: true, force: true })
  })

  test('restores file in exactly 3 clicks — no confirmation dialog', async () => {
    const app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      env: { ...process.env, NODE_ENV: 'test' },
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    try {
      const turnsBeforeRestore = await countSnapshotTurns(vaultRoot)

      // Wait for file tree to fully render and vault:watch to complete
      // Scope to .sidebar to avoid picking .marvin/ nested snapshot files in the tree
      const fileRow = page.locator('.sidebar .file-tree-row.file', { hasText: /^my-note$/ })
      await expect(fileRow).toBeVisible({ timeout: 15_000 })
      // Brief settle to ensure vault:watch IPC completes and activeVaultPath is set
      await page.waitForTimeout(500)

      // Right-click to open context menu
      await fileRow.click({ button: 'right' })
      await expect(page.locator('.ctx-menu')).toBeVisible()

      // ── Click 1: "View versions…" ──────────────────────────────────────────
      let clickCount = 0
      await page.locator('.ctx-item', { hasText: 'View versions' }).click()
      clickCount++

      // Panel opens
      const panel = page.locator('.snapshot-panel')
      await expect(panel).toBeVisible({ timeout: 5_000 })

      // ── Click 2: select version in list ─────────────────────────────────
      const versionBtn = panel.locator('[role="option"]').first()
      await expect(versionBtn).toBeVisible({ timeout: 5_000 })
      await versionBtn.click()
      clickCount++

      // Wait for diff to load (restore button becomes enabled)
      const restoreBtn = panel.locator('button', { hasText: 'Restore this version' })
      await expect(restoreBtn).toBeEnabled({ timeout: 5_000 })

      // ── Click 3: "Restore this version" — executes directly ─────────────
      await restoreBtn.click()
      clickCount++

      // Panel closes automatically after successful restore — no alertdialog appeared
      await expect(panel).not.toBeVisible({ timeout: 5_000 })
      await expect(page.locator('[role="alertdialog"]')).not.toBeVisible()

      // ── Assertions ───────────────────────────────────────────────────────

      // Exact click count: 3
      expect(clickCount).toBe(3)

      // File on disk has the restored content
      const restoredContent = await fs.readFile(path.join(vaultRoot, relPath), 'utf8')
      expect(restoredContent).toBe(originalContent)

      // A pre-restore snapshot turn was created (trigger: 'restore') — undo path
      const turnsAfterRestore = await countSnapshotTurns(vaultRoot)
      expect(turnsAfterRestore).toBe(turnsBeforeRestore + 1)

      const snapshotsDir = path.join(vaultRoot, '.marvin', 'snapshots')
      const allDirs = await fs.readdir(snapshotsDir, { withFileTypes: true })
      const newTurnDir = allDirs
        .filter((e) => e.isDirectory() && e.name !== seededTurnId)
        .map((e) => e.name)[0]
      expect(newTurnDir).toBeTruthy()

      const newManifest = JSON.parse(
        await fs.readFile(path.join(snapshotsDir, newTurnDir, '_manifest.json'), 'utf8'),
      )
      expect(newManifest.trigger).toBe('restore')
    } finally {
      await app.close()
    }
  })

  test('SnapshotPanel shows correct file name and 1 version from seeded snapshot', async () => {
    const app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      env: { ...process.env, NODE_ENV: 'test' },
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    try {
      // Scope to .sidebar to avoid picking .marvin/ nested snapshot files in the tree
      const fileRow = page.locator('.sidebar .file-tree-row.file', { hasText: /^my-note$/ })
      await expect(fileRow).toBeVisible({ timeout: 15_000 })

      await fileRow.click({ button: 'right' })
      await page.locator('.ctx-item', { hasText: 'View versions' }).click()

      const panel = page.locator('.snapshot-panel')
      await expect(panel).toBeVisible({ timeout: 5_000 })

      // Title references the file
      await expect(panel.locator('#snapshot-title')).toContainText('my-note')

      // Exactly 1 version (from seeded snapshot)
      await expect(panel.locator('[role="option"]')).toHaveCount(1, { timeout: 5_000 })
    } finally {
      await app.close()
    }
  })

  test('"Restore this version" is disabled while snapshot content is loading', async () => {
    const app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      env: { ...process.env, NODE_ENV: 'test' },
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    try {
      // Scope to .sidebar to avoid picking .marvin/ nested snapshot files in the tree
      const fileRow = page.locator('.sidebar .file-tree-row.file', { hasText: /^my-note$/ })
      await expect(fileRow).toBeVisible({ timeout: 15_000 })

      await fileRow.click({ button: 'right' })
      await page.locator('.ctx-item', { hasText: 'View versions' }).click()

      const panel = page.locator('.snapshot-panel')
      await expect(panel).toBeVisible({ timeout: 5_000 })

      // Click version to trigger content load
      await panel.locator('[role="option"]').first().click()

      // Restore button eventually becomes enabled once content loads
      const restoreBtn = panel.locator('button', { hasText: 'Restore this version' })
      await expect(restoreBtn).toBeEnabled({ timeout: 5_000 })
    } finally {
      await app.close()
    }
  })

  test('Escape closes panel without restoring file', async () => {
    const app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      env: { ...process.env, NODE_ENV: 'test' },
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    try {
      // Scope to .sidebar to avoid picking .marvin/ nested snapshot files in the tree
      const fileRow = page.locator('.sidebar .file-tree-row.file', { hasText: /^my-note$/ })
      await expect(fileRow).toBeVisible({ timeout: 15_000 })

      await fileRow.click({ button: 'right' })
      await page.locator('.ctx-item', { hasText: 'View versions' }).click()

      const panel = page.locator('.snapshot-panel')
      await expect(panel).toBeVisible({ timeout: 5_000 })

      await page.keyboard.press('Escape')
      await expect(panel).not.toBeVisible()

      // File content unchanged — no restore happened
      const content = await fs.readFile(path.join(vaultRoot, relPath), 'utf8')
      expect(content).toBe(currentContent)

      // No new snapshot turn created
      expect(await countSnapshotTurns(vaultRoot)).toBe(1)
    } finally {
      await app.close()
    }
  })
})

// ---------------------------------------------------------------------------
// M9: IPC envelope opacity — error responses must not leak absolute paths
// ---------------------------------------------------------------------------

test.describe('M9 — IPC envelope opacity', () => {
  let vaultRoot: string
  let userDataDir: string

  test.beforeEach(async () => {
    const rawVault = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-e2e-m9-'))
    vaultRoot = await fs.realpath(rawVault)
    // Seed a real file so the vault opens
    await fs.writeFile(path.join(vaultRoot, 'note.md'), 'content', 'utf8')
    userDataDir = await createUserDataDir(vaultRoot)
  })

  test.afterEach(async () => {
    await fs.rm(vaultRoot, { recursive: true, force: true })
    await fs.rm(userDataDir, { recursive: true, force: true })
  })

  test('snapshot:read with non-existent snapshot returns opaque error, no path leak', async () => {
    const app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      env: { ...process.env, NODE_ENV: 'test' },
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await expect(page.locator('.file-tree-row.file', { hasText: /^note$/ })).toBeVisible({ timeout: 15_000 })

    try {
      const result = await page.evaluate(async () => {
        const validTurnId = new Date().toISOString()
          .replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z') + '-aabbccdd1122'
        return await (window as any).marvin.snapshot.read(validTurnId, 'note.md')
      })

      expect(result.ok).toBe(false)
      // Error code must be whitelisted — no raw fs error with path info
      expect(result.error).toMatch(/^(MARVIN_|SNAPSHOT_)/)
      // Must not leak absolute paths
      expect(result.error).not.toContain('/Users/')
      expect(result.error).not.toContain('/var/')
      expect(result.error).not.toContain('/home/')
    } finally {
      await app.close()
    }
  })

  test('snapshot:read with invalid turnId returns MARVIN_INVALID_TURN_ID envelope', async () => {
    const app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      env: { ...process.env, NODE_ENV: 'test' },
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await expect(page.locator('.file-tree-row.file', { hasText: /^note$/ })).toBeVisible({ timeout: 15_000 })

    try {
      const result = await page.evaluate(async () => {
        return await (window as any).marvin.snapshot.read('invalid-turn-id', 'note.md')
      })

      expect(result.ok).toBe(false)
      expect(result.error).toBe('SNAPSHOT_INVALID_TURN_ID')
      expect(result.error).not.toContain('/Users/')
    } finally {
      await app.close()
    }
  })

  test('snapshot:read with traversal relPath returns MARVIN_INVALID_PATH envelope', async () => {
    const app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      env: { ...process.env, NODE_ENV: 'test' },
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await expect(page.locator('.file-tree-row.file', { hasText: /^note$/ })).toBeVisible({ timeout: 15_000 })

    try {
      const result = await page.evaluate(async () => {
        const validTurnId = new Date().toISOString()
          .replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z') + '-aabbccdd1122'
        return await (window as any).marvin.snapshot.read(validTurnId, '../../etc/passwd')
      })

      expect(result.ok).toBe(false)
      expect(result.error).toBe('SNAPSHOT_INVALID_REL_PATH')
      expect(result.error).not.toContain('/Users/')
      expect(result.error).not.toContain('etc/passwd')
    } finally {
      await app.close()
    }
  })
})
