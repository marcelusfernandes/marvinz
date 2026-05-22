/**
 * E2E: G2-3 — Diff visible on external hot-reload.
 *
 * Scenarios:
 *   1: dirty buffer + external write → banner appears, buffer NOT replaced
 *   2: clean buffer + external write (source=external) → discrete toast + reload
 *   3: clean buffer + agent change → silent reload, no external toast
 *   4: click "View diff" in banner → ExternalChangeDiffModal opens
 *   5: "Reload" creates buffer-save snapshot, then replaces buffer
 *   6: "Keep my version" dismisses banner, preserves buffer, no disk write
 *
 * How dirty state is triggered:
 *   Open the file (sets lastDiskContentRef + bufferContentRef to initial content),
 *   then type into the CodeMirror editor (updates bufferContentRef via handleBufferChange),
 *   then write to disk — watcher fires file:changed, isDirty=true → banner.
 *
 * Real FS: no FS mocks. All I/O uses temp directories.
 * Strings in English.
 */

import { test, expect, _electron as electron } from 'playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

async function countSnapshotTurns(vaultRoot: string): Promise<number> {
  const snapshotsDir = path.join(vaultRoot, '.marvin', 'snapshots')
  try {
    const entries = await fs.readdir(snapshotsDir, { withFileTypes: true })
    return entries.filter((e) => e.isDirectory()).length
  } catch {
    return 0
  }
}

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
    return JSON.parse(
      await fs.readFile(path.join(snapshotsDir, dirs[0], '_manifest.json'), 'utf8'),
    )
  } catch {
    return null
  }
}

/**
 * Click a file row in the sidebar, switch to Edit mode, and wait for
 * CodeMirror to mount.
 *
 * The editor starts in Preview (Milkdown) mode. Switching to Edit mode
 * mounts the CodeMirror instance and enables the `onBufferChange` callback
 * that populates `bufferContentRef` on keystrokes — required for dirty detection.
 */
async function openFileInEditor(page: import('playwright').Page, noteLabel: string): Promise<void> {
  const fileRow = page.locator('.sidebar .file-tree-row.file', {
    hasText: new RegExp(`^${noteLabel}$`),
  })
  await expect(fileRow).toBeVisible({ timeout: 15_000 })
  await fileRow.click()

  // Wait for the editor container to appear (note-tab-container)
  await expect(page.locator('.note-tab-container')).toBeVisible({ timeout: 8_000 })

  // Switch to Edit (raw CodeMirror) mode — the Edit button has text "Edit"
  const editBtn = page.locator('.mode-btn', { hasText: 'Edit' }).first()
  await expect(editBtn).toBeVisible({ timeout: 5_000 })
  await editBtn.click()

  // Wait for CodeMirror to mount
  await expect(page.locator('.cm-editor')).toBeVisible({ timeout: 5_000 })

  // Allow lastDiskContentRef + bufferContentRef to be populated by file:read
  await page.waitForTimeout(400)
}

/**
 * Type a single space at end of editor content to diverge bufferContentRef
 * from lastDiskContentRef, triggering isDirty=true on next file:changed.
 * Must be called after openFileInEditor (which switches to Edit mode).
 */
async function makeBufferDirty(page: import('playwright').Page): Promise<void> {
  const editor = page.locator('.cm-editor')
  await editor.click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type(' ')
  // Allow React state to propagate bufferContentRef update
  await page.waitForTimeout(200)
}

/**
 * Open a file without switching to Edit mode — leaves buffer clean (no typing).
 * The preview-mode Milkdown editor does not call onBufferChange, so
 * bufferContentRef stays equal to lastDiskContentRef → isDirty=false.
 */
async function openFileClean(page: import('playwright').Page, noteLabel: string): Promise<void> {
  const fileRow = page.locator('.sidebar .file-tree-row.file', {
    hasText: new RegExp(`^${noteLabel}$`),
  })
  await expect(fileRow).toBeVisible({ timeout: 15_000 })
  await fileRow.click()
  await expect(page.locator('.note-tab-container')).toBeVisible({ timeout: 8_000 })
  // Stay in Preview mode — lastDiskContentRef is set but bufferContentRef stays at initial
  await page.waitForTimeout(400)
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
    userDataDir = await createUserDataDir(vaultRoot)
  })

  test.afterEach(async () => {
    await fs.rm(vaultRoot, { recursive: true, force: true }).catch(() => {})
    await fs.rm(userDataDir, { recursive: true, force: true }).catch(() => {})
  })

  // -------------------------------------------------------------------------
  // Scenario 1: dirty buffer + external write → banner, buffer preserved
  // -------------------------------------------------------------------------

  test('Scenario 1: dirty buffer + external change → banner shown, buffer preserved', async () => {
    const relPath = 'editing.md'
    const initialContent = '# Original\n\nSome text.'
    const externalContent = '# Overwritten by external process\n\nNew content from disk.'
    const absPath = await seedVaultWithNote(vaultRoot, relPath, initialContent)

    const app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      env: { ...process.env, NODE_ENV: 'test' },
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    try {
      await openFileInEditor(page, 'editing')
      await makeBufferDirty(page)
      await fs.writeFile(absPath, externalContent, 'utf8')

      const banner = page.locator('.external-change-banner')
      await expect(banner).toBeVisible({ timeout: 10_000 })
      await expect(banner).toHaveAttribute('role', 'alert')

      // All three action buttons present
      await expect(banner.getByRole('button', { name: 'View diff' })).toBeVisible()
      await expect(banner.getByRole('button', { name: 'Reload' })).toBeVisible()
      await expect(banner.getByRole('button', { name: 'Keep my version' })).toBeVisible()

      // Banner still present — buffer was not silently replaced
      await expect(banner).toBeVisible()
    } finally {
      await app.close()
    }
  })

  // -------------------------------------------------------------------------
  // Scenario 2: clean buffer + external write (source=external) → toast + reload
  // -------------------------------------------------------------------------

  test('Scenario 2: clean buffer + external change (source=external) → toast, no banner', async () => {
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
      // Open in Preview mode — buffer stays clean (no onBufferChange fired)
      await openFileClean(page, 'clean-note')
      await fs.writeFile(absPath, externalContent, 'utf8')

      // SnapshotToast (agentLabel="External change") must appear
      const toast = page.locator('.snapshot-toast')
      await expect(toast).toBeVisible({ timeout: 10_000 })
      await expect(toast).toContainText('External change')
      await expect(toast).toContainText('updated')

      // Blocking banner must NOT appear for clean buffer
      await expect(page.locator('.external-change-banner')).not.toBeVisible()
    } finally {
      await app.close()
    }
  })

  // -------------------------------------------------------------------------
  // Scenario 3: clean buffer + agent change → silent reload, no external toast
  //
  // App.tsx: `if (source === 'external') setExternalToast(...)` — agent source
  // does NOT fire the external toast (turn-completed covers the agent case).
  // -------------------------------------------------------------------------

  test('Scenario 3: clean buffer + agent change → silent reload, no external toast', async () => {
    const relPath = 'agent-note.md'
    const initialContent = '# For Claude\n\nOriginal.'
    const agentContent = '# For Claude\n\nClaude rewrote this.'
    const absPath = await seedVaultWithNote(vaultRoot, relPath, initialContent)

    const app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      env: { ...process.env, NODE_ENV: 'test' },
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    try {
      // Open in Preview mode — buffer clean
      await openFileClean(page, 'agent-note')

      // Stamp lastPtyWriteAt so the next file:changed is source='agent'.
      // pty:write updates lastPtyWriteAt even for a non-existent PTY id.
      await page.evaluate(async () => {
        await (window as unknown as {
          marvin: { pty: { write: (id: string, d: string) => Promise<void> } }
        }).marvin.pty.write('__test_stamp__', '').catch(() => {})
      })

      await fs.writeFile(absPath, agentContent, 'utf8')
      await page.waitForTimeout(3_000)

      // No external toast (only fires for source='external')
      await expect(page.locator('.snapshot-toast:has-text("External change")')).not.toBeVisible()
      // No banner (clean buffer)
      await expect(page.locator('.external-change-banner')).not.toBeVisible()
    } finally {
      await app.close()
    }
  })

  // -------------------------------------------------------------------------
  // Scenario 4: "View diff" → ExternalChangeDiffModal with DiffViewer
  // -------------------------------------------------------------------------

  test('Scenario 4: View diff opens ExternalChangeDiffModal with correct labels', async () => {
    const relPath = 'diff-note.md'
    const initialContent = '# My version\n\nThese are my local edits.'
    const diskContent = '# External version\n\nThis was written externally.'
    const absPath = await seedVaultWithNote(vaultRoot, relPath, initialContent)

    const app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      env: { ...process.env, NODE_ENV: 'test' },
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    try {
      await openFileInEditor(page, 'diff-note')
      await makeBufferDirty(page)
      await fs.writeFile(absPath, diskContent, 'utf8')

      const banner = page.locator('.external-change-banner')
      await expect(banner).toBeVisible({ timeout: 10_000 })

      await banner.getByRole('button', { name: 'View diff' }).click()

      const modal = page.locator('.external-change-diff-modal')
      await expect(modal).toBeVisible({ timeout: 5_000 })
      await expect(modal).toHaveAttribute('role', 'dialog')

      // DiffViewer is present inside the modal
      await expect(modal.locator('.diff-viewer')).toBeVisible()

      // Modal title references the filename
      await expect(modal.locator('#external-change-diff-title')).toContainText('diff-note')

      // DiffViewer column labels: beforeLabel="On disk", afterLabel="My buffer"
      await expect(modal).toContainText('On disk')
      await expect(modal).toContainText('My buffer')

      // Escape closes the modal
      await page.keyboard.press('Escape')
      await expect(modal).not.toBeVisible({ timeout: 3_000 })
    } finally {
      await app.close()
    }
  })

  // -------------------------------------------------------------------------
  // Scenario 5: "Reload" snapshots buffer (trigger=buffer-save) then reloads
  // -------------------------------------------------------------------------

  test('Scenario 5: Reload creates buffer-save snapshot then dismisses banner', async () => {
    const relPath = 'reload-note.md'
    const initialContent = '# My unsaved version\n\nI was still editing!'
    const diskContent = '# Disk version\n\nExternal change.'
    const absPath = await seedVaultWithNote(vaultRoot, relPath, initialContent)

    const app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      env: { ...process.env, NODE_ENV: 'test' },
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    try {
      await openFileInEditor(page, 'reload-note')
      await makeBufferDirty(page)

      const turnsBefore = await countSnapshotTurns(vaultRoot)
      await fs.writeFile(absPath, diskContent, 'utf8')

      const banner = page.locator('.external-change-banner')
      await expect(banner).toBeVisible({ timeout: 10_000 })

      await banner.getByRole('button', { name: 'Reload' }).click()

      // Banner dismisses after reload
      await expect(banner).not.toBeVisible({ timeout: 8_000 })

      // A buffer-save snapshot was created before the reload
      await page.waitForTimeout(1_000)
      const turnsAfter = await countSnapshotTurns(vaultRoot)
      expect(turnsAfter).toBeGreaterThan(turnsBefore)

      const manifest = await getMostRecentManifest(vaultRoot)
      expect(manifest?.trigger).toBe('buffer-save')

      // Snapshot file exists at <vault>/.marvin/snapshots/<turnId>/<relPath>
      const snapshotsDir = path.join(vaultRoot, '.marvin', 'snapshots')
      const allDirs = await fs.readdir(snapshotsDir, { withFileTypes: true })
      const bufferSaveTurnId = (
        await Promise.all(
          allDirs
            .filter((e) => e.isDirectory())
            .map(async (d) => {
              try {
                const m = JSON.parse(
                  await fs.readFile(path.join(snapshotsDir, d.name, '_manifest.json'), 'utf8'),
                )
                return m.trigger === 'buffer-save' ? d.name : null
              } catch { return null }
            }),
        )
      ).find(Boolean)

      expect(bufferSaveTurnId).toBeTruthy()
      const snapFilePath = path.join(snapshotsDir, bufferSaveTurnId!, relPath)
      await expect(fs.access(snapFilePath)).resolves.toBeUndefined()
    } finally {
      await app.close()
    }
  })

  // -------------------------------------------------------------------------
  // Scenario 6: "Keep my version" dismisses banner, preserves buffer, no disk write
  // -------------------------------------------------------------------------

  test('Scenario 6: Keep my version dismisses banner and does not write to disk', async () => {
    const relPath = 'keep-note.md'
    const initialContent = '# My version\n\nI want to keep this.'
    const diskContent = '# Disk version\n\nI do not want this.'
    const absPath = await seedVaultWithNote(vaultRoot, relPath, initialContent)

    const app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      env: { ...process.env, NODE_ENV: 'test' },
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    try {
      await openFileInEditor(page, 'keep-note')
      await makeBufferDirty(page)
      await fs.writeFile(absPath, diskContent, 'utf8')

      const banner = page.locator('.external-change-banner')
      await expect(banner).toBeVisible({ timeout: 10_000 })

      await banner.getByRole('button', { name: 'Keep my version' }).click()

      // Banner dismisses
      await expect(banner).not.toBeVisible({ timeout: 5_000 })

      // Disk file must NOT have been overwritten by "Keep my version"
      // (overwrite only happens on the next explicit save by the user)
      const diskAfter = await fs.readFile(absPath, 'utf8')
      expect(diskAfter).toBe(diskContent)
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

  test('saveBuffer creates snapshot with trigger buffer-save in .marvin/snapshots/', async () => {
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
        return await (window as unknown as {
          marvin: { snapshot: { saveBuffer: (r: string, c: string) => Promise<unknown> } }
        }).marvin.snapshot.saveBuffer('note.md', '# My unsaved buffer content')
      })

      const envelope = result as { ok: boolean; data?: { turnId: string; saved: boolean }; error?: string }
      expect(envelope.ok).toBe(true)
      expect(envelope.data?.turnId).toMatch(/^\d{8}T\d{6}Z-[0-9a-f]+$/i)
      expect(envelope.data?.saved).toBe(true)

      await page.waitForTimeout(300)
      expect(await countSnapshotTurns(vaultRoot)).toBe(turnsBefore + 1)

      const manifest = await getMostRecentManifest(vaultRoot)
      expect(manifest?.trigger).toBe('buffer-save')
      expect((manifest?.files as Array<{ relPath: string }>)?.[0]?.relPath).toBe('note.md')

      const snapPath = path.join(vaultRoot, '.marvin', 'snapshots', envelope.data!.turnId, 'note.md')
      expect(await fs.readFile(snapPath, 'utf8')).toBe('# My unsaved buffer content')
    } finally {
      await app.close()
    }
  })

  test('saveBuffer rejects path traversal relPaths — SNAPSHOT_INVALID_REL_PATH', async () => {
    const app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      env: { ...process.env, NODE_ENV: 'test' },
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await expect(page.locator('.file-tree-row.file', { hasText: /^note$/ })).toBeVisible({ timeout: 15_000 })

    try {
      const vectors = [
        '../escape.md',
        '../../etc/passwd',
        '/etc/passwd',
        'foo/../../evil.md',
        '.marvin/snapshots/evil',
      ]
      for (const relPath of vectors) {
        const result = await page.evaluate(async (rp: string) => {
          return await (window as unknown as {
            marvin: { snapshot: { saveBuffer: (r: string, c: string) => Promise<unknown> } }
          }).marvin.snapshot.saveBuffer(rp, 'bad content')
        }, relPath)
        const envelope = result as { ok: boolean; error?: string }
        expect(envelope.ok, `Expected rejection for: ${relPath}`).toBe(false)
        expect(envelope.error, `Expected SNAPSHOT_INVALID_REL_PATH for: ${relPath}`).toBe('SNAPSHOT_INVALID_REL_PATH')
      }
    } finally {
      await app.close()
    }
  })

  test('saveBuffer rejects null byte in relPath — SNAPSHOT_INVALID_REL_PATH', async () => {
    const app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      env: { ...process.env, NODE_ENV: 'test' },
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await expect(page.locator('.file-tree-row.file', { hasText: /^note$/ })).toBeVisible({ timeout: 15_000 })

    try {
      const result = await page.evaluate(async () => {
        return await (window as unknown as {
          marvin: { snapshot: { saveBuffer: (r: string, c: string) => Promise<unknown> } }
        }).marvin.snapshot.saveBuffer('foo\0bar.md', 'bad content')
      })
      const envelope = result as { ok: boolean; error?: string }
      expect(envelope.ok).toBe(false)
      expect(envelope.error).toBe('SNAPSHOT_INVALID_REL_PATH')
    } finally {
      await app.close()
    }
  })
})
