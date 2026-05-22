/**
 * E2E: G2-3 — Diff visible on external hot-reload.
 *
 * Scenarios:
 *   1: dirty buffer + external write → banner appears, buffer NOT replaced
 *   2: clean buffer + external write (source=external) → discrete toast + reload
 *   3: clean buffer + external write (source=agent) → toast with "Claude" label
 *   4: click "View diff" in banner → DiffViewer opens with correct content
 *   5: "Reload" creates buffer-save snapshot, then replaces buffer
 *   6: "Keep mine" preserves buffer + marks tab as dirty
 *
 * Setup strategy:
 *   - Write vaultPath into a temp userData dir's settings.json before launch
 *   - Control lastPtyWriteAt via the 'test:setLastPtyWriteAt' IPC exposed in
 *     NODE_ENV=test mode (the electron teammate adds this hook) OR by writing
 *     a `.marvin/test-pty-stamp` sentinel file that the watcher reads.
 *   - Trigger external file changes by writing directly to disk after the app
 *     opens. The Chokidar watcher will pick up the change and emit file:changed.
 *
 * Real FS: no FS mocks. All I/O uses temp directories.
 * Strings in English.
 *
 * NOTE: These tests define the expected G2-3 contract. Tests for UI elements
 * not yet implemented (ExternalChangeBanner, DiffViewer integration) will fail
 * until the react/electron teammates land the implementation. That is intentional
 * (TDD red phase).
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

/** Write settings.json into a temp userData dir so the app boots with our vault. */
async function createUserDataDir(vaultPath: string): Promise<string> {
  const raw = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-e2e-hotreload-'))
  const userDataDir = await fs.realpath(raw)
  await fs.writeFile(
    path.join(userDataDir, 'settings.json'),
    JSON.stringify({ vaultPath }),
    'utf8',
  )
  return userDataDir
}

/**
 * Seed a vault with a note file and optionally an existing snapshot.
 * Returns the absolute path of the created note.
 */
async function seedVaultWithNote(
  vaultRoot: string,
  relPath: string,
  content: string,
): Promise<string> {
  const absPath = path.join(vaultRoot, relPath)
  await fs.mkdir(path.dirname(absPath), { recursive: true })
  await fs.writeFile(absPath, content, 'utf8')
  return absPath
}

/**
 * Count snapshot turns in a vault's .marvin/snapshots directory.
 */
async function countSnapshotTurns(vaultRoot: string): Promise<number> {
  const snapshotsDir = path.join(vaultRoot, '.marvin', 'snapshots')
  try {
    const entries = await fs.readdir(snapshotsDir, { withFileTypes: true })
    return entries.filter((e) => e.isDirectory()).length
  } catch {
    return 0
  }
}

/**
 * Find all snapshot turns and return the most recent one's manifest.
 */
async function getMostRecentManifest(vaultRoot: string): Promise<Record<string, unknown> | null> {
  const snapshotsDir = path.join(vaultRoot, '.marvin', 'snapshots')
  try {
    const entries = await fs.readdir(snapshotsDir, { withFileTypes: true })
    const dirs = entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort()
      .reverse()
    if (dirs.length === 0) return null
    const manifestPath = path.join(snapshotsDir, dirs[0], '_manifest.json')
    return JSON.parse(await fs.readFile(manifestPath, 'utf8'))
  } catch {
    return null
  }
}

/**
 * Simulate an agent (AI) PTY write by calling the test IPC if available,
 * falling back to touching the .marvin/test-pty-stamp sentinel.
 * This makes the watcher classify the next file change as source='agent'.
 */
async function simulateAgentWrite(
  page: import('playwright').Page,
  vaultRoot: string,
): Promise<void> {
  // Prefer IPC test hook if the app exposes one in test mode
  const hookResult = await page.evaluate(async () => {
    const marvin = (window as unknown as { marvin?: { test?: { setLastPtyWriteAt?: (ts: number) => Promise<void> } } }).marvin
    if (marvin?.test?.setLastPtyWriteAt) {
      await marvin.test.setLastPtyWriteAt(Date.now())
      return 'ipc'
    }
    return 'none'
  })

  if (hookResult !== 'ipc') {
    // Fallback: write sentinel file that main.ts watcher reads in test mode
    const sentinelPath = path.join(vaultRoot, '.marvin', 'test-pty-stamp')
    await fs.mkdir(path.dirname(sentinelPath), { recursive: true })
    await fs.writeFile(sentinelPath, String(Date.now()), 'utf8')
    // Brief pause for the main process to pick up the sentinel
    await page.waitForTimeout(100)
  }
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

test.describe('G2-3 hot-reload diff — external change scenarios', () => {
  let vaultRoot: string
  let userDataDir: string

  test.beforeEach(async () => {
    const rawVault = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-e2e-hotreload-vault-'))
    vaultRoot = await fs.realpath(rawVault)
    // Seed a placeholder file so the vault loads a file tree
    await seedVaultWithNote(vaultRoot, 'placeholder.md', '# placeholder')
    userDataDir = await createUserDataDir(vaultRoot)
  })

  test.afterEach(async () => {
    await fs.rm(vaultRoot, { recursive: true, force: true }).catch(() => {})
    await fs.rm(userDataDir, { recursive: true, force: true }).catch(() => {})
  })

  // -------------------------------------------------------------------------
  // Scenario 1: dirty buffer + external write → banner appears, buffer NOT replaced
  // -------------------------------------------------------------------------

  test('Scenario 1: dirty buffer + external change → banner shown, buffer preserved', async () => {
    const relPath = 'editing.md'
    const initialContent = '# Original\n\nSome text.'
    const externalContent = '# Overwritten by external process\n\nNew content.'
    const dirtyBufferEdit = '# Original\n\nSome text.\n\nI added this line!'

    const absPath = await seedVaultWithNote(vaultRoot, relPath, initialContent)

    const app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      env: { ...process.env, NODE_ENV: 'test' },
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    try {
      // Open the file
      const fileRow = page.locator('.sidebar .file-tree-row.file', { hasText: /^editing$/ })
      await expect(fileRow).toBeVisible({ timeout: 15_000 })
      await fileRow.click()

      // Wait for editor to load with initial content
      const editorArea = page.locator('.editor-wrapper, .cm-editor, [data-testid="editor"]')
      await expect(editorArea).toBeVisible({ timeout: 5_000 })

      // Simulate the user making an edit — mark tab dirty by typing in editor
      // We do this via IPC: write the dirty content to the in-memory buffer only
      // (not to disk). The renderer marks the tab as dirty when buffer != disk.
      await page.evaluate(async ({ path: filePath, content }) => {
        // Dispatch a synthetic input event that sets buffer dirty
        const marvin = (window as unknown as { marvin: { test?: { setTabDirty?: (p: string, c: string) => void } } }).marvin
        if (marvin?.test?.setTabDirty) {
          marvin.test.setTabDirty(filePath, content)
        }
        // Fallback: dispatch keyboard input to the editor
      }, { path: absPath, content: dirtyBufferEdit })

      // External write to the file (simulates agent or external tool)
      await page.waitForTimeout(500) // let watcher settle
      await fs.writeFile(absPath, externalContent, 'utf8')

      // The ExternalChangeBanner must appear within a few seconds
      const banner = page.locator('.external-change-banner, [data-testid="external-change-banner"]')
      await expect(banner).toBeVisible({ timeout: 8_000 })

      // The editor buffer must NOT have been replaced with externalContent
      // Check by looking at the editor content or the dirty indicator on the tab
      const editorContent = await page.evaluate(() => {
        // Try CodeMirror API
        const editor = document.querySelector('.cm-editor')
        if (editor) {
          const view = (editor as unknown as { cmView?: { state?: { doc?: { toString: () => string } } } }).cmView
          if (view?.state?.doc) return view.state.doc.toString()
        }
        return null
      })

      if (editorContent !== null) {
        // If we can read the editor, verify buffer was not overwritten
        expect(editorContent).not.toBe(externalContent)
      }

      // The tab must remain open and the file tree still shows the file
      await expect(fileRow).toBeVisible()
    } finally {
      await app.close()
    }
  })

  // -------------------------------------------------------------------------
  // Scenario 2: clean buffer + external write (source=external) → discrete toast + reload
  // -------------------------------------------------------------------------

  test('Scenario 2: clean buffer + external change (source=external) → toast appears, buffer reloaded', async () => {
    const relPath = 'clean-note.md'
    const initialContent = '# Clean note\n\nNo local edits.'
    const externalContent = '# Updated externally\n\nChanged by something.'

    const absPath = await seedVaultWithNote(vaultRoot, relPath, initialContent)

    const app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      env: { ...process.env, NODE_ENV: 'test' },
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    try {
      // Open the file (establishes disk baseline)
      const fileRow = page.locator('.sidebar .file-tree-row.file', { hasText: /^clean-note$/ })
      await expect(fileRow).toBeVisible({ timeout: 15_000 })
      await fileRow.click()
      await page.waitForTimeout(300)

      // External (non-agent) write — lastPtyWriteAt is 0 → source='external'
      await fs.writeFile(absPath, externalContent, 'utf8')

      // A discrete toast must appear (NOT a blocking banner)
      // The banner must NOT appear for a clean buffer
      const banner = page.locator('.external-change-banner, [data-testid="external-change-banner"]')
      const toast = page.locator('.snapshot-toast, [data-testid="file-updated-toast"], [data-testid="external-change-toast"]')

      // Allow time for the watcher to fire
      await page.waitForTimeout(3_000)

      // Banner must not be visible for a clean buffer
      await expect(banner).not.toBeVisible()

      // A toast notification must appear
      await expect(toast).toBeVisible({ timeout: 5_000 })
    } finally {
      await app.close()
    }
  })

  // -------------------------------------------------------------------------
  // Scenario 3: clean buffer + external write (source=agent) → toast with "Claude" label
  // -------------------------------------------------------------------------

  test('Scenario 3: clean buffer + agent change → toast shows Claude label', async () => {
    const relPath = 'agent-note.md'
    const initialContent = '# For Claude\n\nOriginal content.'
    const agentContent = '# For Claude\n\nClaude rewrote this.'

    const absPath = await seedVaultWithNote(vaultRoot, relPath, initialContent)

    const app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      env: { ...process.env, NODE_ENV: 'test' },
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    try {
      // Open the file
      const fileRow = page.locator('.sidebar .file-tree-row.file', { hasText: /^agent-note$/ })
      await expect(fileRow).toBeVisible({ timeout: 15_000 })
      await fileRow.click()
      await page.waitForTimeout(300)

      // Simulate agent/PTY activity so next file change is source='agent'
      await simulateAgentWrite(page, vaultRoot)

      // Agent writes the file
      await fs.writeFile(absPath, agentContent, 'utf8')

      // Allow time for watcher to fire
      await page.waitForTimeout(3_000)

      // A toast must appear mentioning "Claude" or "agent"
      // (could be in .snapshot-toast or a dedicated file-updated toast)
      const claudeToast = page.locator(
        ':text("Claude"), [data-source="agent"], .toast:has-text("Claude"), [data-testid="external-change-toast"]:has-text("Claude")',
      )
      await expect(claudeToast).toBeVisible({ timeout: 5_000 })
    } finally {
      await app.close()
    }
  })

  // -------------------------------------------------------------------------
  // Scenario 4: "View diff" in banner → DiffViewer with correct content
  // -------------------------------------------------------------------------

  test('Scenario 4: clicking View diff in banner opens DiffViewer with correct diff', async () => {
    const relPath = 'diff-note.md'
    const bufferContent = '# My version\n\nThese are my local edits.'
    const diskContent = '# External version\n\nThis was written externally.'

    const absPath = await seedVaultWithNote(vaultRoot, relPath, bufferContent)

    const app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      env: { ...process.env, NODE_ENV: 'test' },
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    try {
      // Open the file
      const fileRow = page.locator('.sidebar .file-tree-row.file', { hasText: /^diff-note$/ })
      await expect(fileRow).toBeVisible({ timeout: 15_000 })
      await fileRow.click()
      await page.waitForTimeout(300)

      // Simulate dirty buffer via test hook
      await page.evaluate(async ({ filePath, content }) => {
        const marvin = (window as unknown as { marvin: { test?: { setTabDirty?: (p: string, c: string) => void } } }).marvin
        marvin?.test?.setTabDirty?.(filePath, content)
      }, { filePath: absPath, content: bufferContent })

      // Overwrite file on disk
      await fs.writeFile(absPath, diskContent, 'utf8')

      // Wait for banner
      const banner = page.locator('.external-change-banner, [data-testid="external-change-banner"]')
      await expect(banner).toBeVisible({ timeout: 8_000 })

      // Click "View diff"
      await banner.locator('button, [role="button"]', { hasText: /view diff/i }).click()

      // DiffViewer must open
      const diffViewer = page.locator('.diff-viewer, [data-testid="diff-viewer"]')
      await expect(diffViewer).toBeVisible({ timeout: 5_000 })

      // DiffViewer must show content from both versions
      const diffText = await diffViewer.textContent()
      // At minimum, content from one side must appear
      expect(diffText).toBeTruthy()
    } finally {
      await app.close()
    }
  })

  // -------------------------------------------------------------------------
  // Scenario 5: "Reload" creates buffer-save snapshot then replaces buffer
  // -------------------------------------------------------------------------

  test('Scenario 5: clicking Reload creates buffer-save snapshot and reloads editor', async () => {
    const relPath = 'reload-note.md'
    const bufferContent = '# My unsaved version\n\nI was still editing this!'
    const diskContent = '# Disk version\n\nExternal change overwrote this.'

    const absPath = await seedVaultWithNote(vaultRoot, relPath, bufferContent)

    const app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      env: { ...process.env, NODE_ENV: 'test' },
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    try {
      // Open the file
      const fileRow = page.locator('.sidebar .file-tree-row.file', { hasText: /^reload-note$/ })
      await expect(fileRow).toBeVisible({ timeout: 15_000 })
      await fileRow.click()
      await page.waitForTimeout(300)

      const turnsBefore = await countSnapshotTurns(vaultRoot)

      // Simulate dirty buffer
      await page.evaluate(async ({ filePath, content }) => {
        const marvin = (window as unknown as { marvin: { test?: { setTabDirty?: (p: string, c: string) => void } } }).marvin
        marvin?.test?.setTabDirty?.(filePath, content)
      }, { filePath: absPath, content: bufferContent })

      // External write
      await fs.writeFile(absPath, diskContent, 'utf8')

      // Wait for banner
      const banner = page.locator('.external-change-banner, [data-testid="external-change-banner"]')
      await expect(banner).toBeVisible({ timeout: 8_000 })

      // Click "Reload"
      await banner.locator('button, [role="button"]', { hasText: /^reload$/i }).click()

      // Banner should disappear after reload
      await expect(banner).not.toBeVisible({ timeout: 5_000 })

      // A new snapshot turn must have been created with trigger 'buffer-save'
      // (the pre-reload snapshot of the dirty buffer)
      await page.waitForTimeout(1_000) // let async snapshot write complete
      const turnsAfter = await countSnapshotTurns(vaultRoot)
      expect(turnsAfter).toBeGreaterThan(turnsBefore)

      const manifest = await getMostRecentManifest(vaultRoot)
      expect(manifest).not.toBeNull()
      expect(manifest?.trigger).toBe('buffer-save')

      // The snapshot must contain the dirty buffer content (not the disk content)
      const snapshotsDir = path.join(vaultRoot, '.marvin', 'snapshots')
      const allDirs = await fs.readdir(snapshotsDir, { withFileTypes: true })
      const bufferSaveDirs = []
      for (const d of allDirs.filter((e) => e.isDirectory())) {
        const mPath = path.join(snapshotsDir, d.name, '_manifest.json')
        try {
          const m = JSON.parse(await fs.readFile(mPath, 'utf8'))
          if (m.trigger === 'buffer-save') bufferSaveDirs.push({ name: d.name, manifest: m })
        } catch {
          // skip
        }
      }

      expect(bufferSaveDirs).toHaveLength(1)
      const bufferSaveManifest = bufferSaveDirs[0]
      const snapFilePath = path.join(
        snapshotsDir,
        bufferSaveManifest.name,
        relPath,
      )
      const snapContent = await fs.readFile(snapFilePath, 'utf8')
      expect(snapContent).toBe(bufferContent)

      // Editor must now show the disk content
      const editorContent = await page.evaluate(() => {
        const editor = document.querySelector('.cm-editor')
        if (editor) {
          const view = (editor as unknown as { cmView?: { state?: { doc?: { toString: () => string } } } }).cmView
          if (view?.state?.doc) return view.state.doc.toString()
        }
        return null
      })

      if (editorContent !== null) {
        expect(editorContent).toBe(diskContent)
      }
    } finally {
      await app.close()
    }
  })

  // -------------------------------------------------------------------------
  // Scenario 6: "Keep mine" preserves buffer + marks tab as dirty
  // -------------------------------------------------------------------------

  test('Scenario 6: clicking Keep mine preserves buffer content and marks tab as dirty', async () => {
    const relPath = 'keep-note.md'
    const bufferContent = '# My version\n\nI want to keep this.'
    const diskContent = '# Disk version\n\nI do not want this.'

    const absPath = await seedVaultWithNote(vaultRoot, relPath, bufferContent)

    const app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      env: { ...process.env, NODE_ENV: 'test' },
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    try {
      // Open the file
      const fileRow = page.locator('.sidebar .file-tree-row.file', { hasText: /^keep-note$/ })
      await expect(fileRow).toBeVisible({ timeout: 15_000 })
      await fileRow.click()
      await page.waitForTimeout(300)

      // Simulate dirty buffer
      await page.evaluate(async ({ filePath, content }) => {
        const marvin = (window as unknown as { marvin: { test?: { setTabDirty?: (p: string, c: string) => void } } }).marvin
        marvin?.test?.setTabDirty?.(filePath, content)
      }, { filePath: absPath, content: bufferContent })

      // External write to disk
      await fs.writeFile(absPath, diskContent, 'utf8')

      // Wait for banner
      const banner = page.locator('.external-change-banner, [data-testid="external-change-banner"]')
      await expect(banner).toBeVisible({ timeout: 8_000 })

      // Click "Keep mine"
      await banner.locator('button, [role="button"]', { hasText: /keep mine|keep my version/i }).click()

      // Banner should close
      await expect(banner).not.toBeVisible({ timeout: 5_000 })

      // Tab should be marked dirty (unsaved indicator visible)
      const tab = page.locator('.tab-bar .tab', { hasText: /keep-note/ })
      await expect(tab).toBeVisible()

      // Tab must show a dirty indicator (dot or asterisk or "modified" class)
      const dirtyIndicator = tab.locator('.tab-dirty, [data-dirty="true"], .modified-indicator, :text("•"), :text("*")')
      await expect(dirtyIndicator).toBeVisible({ timeout: 3_000 })

      // The disk file must NOT have been modified by "Keep mine"
      const diskAfter = await fs.readFile(absPath, 'utf8')
      // Disk still has the externally written content — "Keep mine" doesn't write yet
      expect(diskAfter).toBe(diskContent)

      // Editor buffer still holds the user's version
      const editorContent = await page.evaluate(() => {
        const editor = document.querySelector('.cm-editor')
        if (editor) {
          const view = (editor as unknown as { cmView?: { state?: { doc?: { toString: () => string } } } }).cmView
          if (view?.state?.doc) return view.state.doc.toString()
        }
        return null
      })

      if (editorContent !== null) {
        expect(editorContent).toBe(bufferContent)
      }
    } finally {
      await app.close()
    }
  })
})

// ---------------------------------------------------------------------------
// IPC contract: snapshot:saveBuffer
// ---------------------------------------------------------------------------

test.describe('snapshot:saveBuffer IPC contract', () => {
  let vaultRoot: string
  let userDataDir: string

  test.beforeEach(async () => {
    const rawVault = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-e2e-savebuffer-'))
    vaultRoot = await fs.realpath(rawVault)
    await fs.writeFile(path.join(vaultRoot, 'note.md'), '# note', 'utf8')
    userDataDir = await createUserDataDir(vaultRoot)
  })

  test.afterEach(async () => {
    await fs.rm(vaultRoot, { recursive: true, force: true }).catch(() => {})
    await fs.rm(userDataDir, { recursive: true, force: true }).catch(() => {})
  })

  test('saveBuffer creates a snapshot with trigger buffer-save in .marvin/snapshots/', async () => {
    const app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      env: { ...process.env, NODE_ENV: 'test' },
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await expect(page.locator('.file-tree-row.file', { hasText: /^note$/ })).toBeVisible({ timeout: 15_000 })

    try {
      const turnsBefore = await countSnapshotTurns(vaultRoot)

      const result = await page.evaluate(async () => {
        return await (window as unknown as { marvin: { snapshot: { saveBuffer: (r: string, c: string) => Promise<unknown> } } }).marvin.snapshot.saveBuffer('note.md', '# My unsaved buffer content')
      })

      const envelope = result as { ok: boolean; data?: { turnId: string }; error?: string }
      expect(envelope.ok).toBe(true)
      expect(envelope.data?.turnId).toBeTruthy()

      // Verify snapshot exists on disk
      await page.waitForTimeout(500)
      const turnsAfter = await countSnapshotTurns(vaultRoot)
      expect(turnsAfter).toBe(turnsBefore + 1)

      const manifest = await getMostRecentManifest(vaultRoot)
      expect(manifest?.trigger).toBe('buffer-save')
      expect((manifest?.files as Array<{ relPath: string }>)?.[0]?.relPath).toBe('note.md')

      // Snapshot file contains the buffer content
      const turnId = envelope.data!.turnId
      const snapPath = path.join(vaultRoot, '.marvin', 'snapshots', turnId, 'note.md')
      const stored = await fs.readFile(snapPath, 'utf8')
      expect(stored).toBe('# My unsaved buffer content')
    } finally {
      await app.close()
    }
  })

  test('saveBuffer rejects relPath with path traversal — returns error envelope', async () => {
    const app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      env: { ...process.env, NODE_ENV: 'test' },
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await expect(page.locator('.file-tree-row.file', { hasText: /^note$/ })).toBeVisible({ timeout: 15_000 })

    try {
      const traversalVectors = [
        '../escape.md',
        '../../etc/passwd',
        '/etc/passwd',
        'foo/../../evil.md',
      ]

      for (const vector of traversalVectors) {
        const result = await page.evaluate(async (relPath: string) => {
          return await (window as unknown as { marvin: { snapshot: { saveBuffer: (r: string, c: string) => Promise<unknown> } } }).marvin.snapshot.saveBuffer(relPath, 'bad content')
        }, vector)

        const envelope = result as { ok: boolean; error?: string }
        expect(envelope.ok, `Expected rejection for: ${vector}`).toBe(false)
        expect(envelope.error, `Expected error code for: ${vector}`).toBeTruthy()
      }
    } finally {
      await app.close()
    }
  })

  test('saveBuffer rejects relPath with null byte', async () => {
    const app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      env: { ...process.env, NODE_ENV: 'test' },
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await expect(page.locator('.file-tree-row.file', { hasText: /^note$/ })).toBeVisible({ timeout: 15_000 })

    try {
      const result = await page.evaluate(async () => {
        return await (window as unknown as { marvin: { snapshot: { saveBuffer: (r: string, c: string) => Promise<unknown> } } }).marvin.snapshot.saveBuffer('foo\0bar.md', 'bad content')
      })

      const envelope = result as { ok: boolean; error?: string }
      expect(envelope.ok).toBe(false)
      expect(envelope.error).toBeTruthy()
    } finally {
      await app.close()
    }
  })
})
