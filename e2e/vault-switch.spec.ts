/**
 * E2E regression: rapid vault double-pick race condition (issue #80).
 *
 * Scenario:
 *   1. App boots with vault A (fileA.md seeded).
 *   2. vault:pick is mocked to return vault B; vault:tree returns vault B's
 *      file list with a deliberate delay to keep the response in-flight.
 *   3. User clicks "Switch vault" → handlePickVault calls vault:pick → picks B
 *      → calls setVaultPath(B) (triggers useEffect → in-flight loadTree(B))
 *      → calls loadTree(B) directly → vault:watch(B).
 *   4. IMMEDIATELY: mock is switched to return vault A (fast); user clicks
 *      "Switch vault" again → handlePickVault picks A → starts loading A's tree.
 *   5. The delayed vault B tree response may arrive AFTER vault A's tree,
 *      overwriting the UI with stale vault B files (the race).
 *
 * Expected final state (after fix):
 *   - Tree shows fileA.md only (last selection wins, stale B response dropped).
 *   - Clicking fileA.md opens successfully, no console MARVIN_OUTSIDE_VAULT.
 *
 * TDD red phase: run before the fix → expect ≥1 assertion to fail,
 * showing that the stale vault B tree overwrites vault A's tree.
 *
 * Mock strategy (app.evaluate has no require/fs; only Electron modules):
 *   - vault:pick  → removed + re-registered to return target path (no OS dialog)
 *   - vault:watch → removed + re-registered as no-op (skips allowedVaultPaths check)
 *   - vault:tree  → removed + re-registered to return a pre-built FileNode array;
 *                   the vaultB mock includes a 1 s delay to force the race window
 *
 * Real FS: vault dirs are real temp directories; file reads use the real filesystem.
 * Strings in English.
 */

import { test, expect, _electron as electron } from 'playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FileNode = {
  name: string
  path: string
  isDir: boolean
  children?: FileNode[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createUserDataDir(vaultPath: string): Promise<string> {
  const raw = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-e2e-vaultswitch-'))
  const userDataDir = await fs.realpath(raw)
  await fs.writeFile(
    path.join(userDataDir, 'settings.json'),
    JSON.stringify({ vaultPath }),
    'utf8',
  )
  return userDataDir
}

async function seedVault(label: string, fileName: string, content: string): Promise<string> {
  const raw = await fs.mkdtemp(path.join(os.tmpdir(), `marvin-e2e-vault${label}-`))
  const vaultRoot = await fs.realpath(raw)
  await fs.writeFile(path.join(vaultRoot, fileName), content, 'utf8')
  return vaultRoot
}

function buildFileNodes(vaultRoot: string, fileName: string): FileNode[] {
  return [{ name: fileName, path: path.join(vaultRoot, fileName), isDir: false }]
}

/**
 * Install mocks for vault:pick, vault:watch, and vault:tree.
 *
 * vault:watch is a no-op so the allowedVaultPaths allowlist check is bypassed.
 * vault:tree returns a pre-built FileNode array (no disk read needed).
 *
 * `delayMs` on vault:tree simulates a slow IPC round-trip, creating a window
 * where a subsequent pick's tree response can race with this one.
 */
async function installVaultMocks(
  app: Awaited<ReturnType<typeof electron.launch>>,
  opts: { vaultPath: string; fileNodes: FileNode[]; treeDelayMs?: number },
): Promise<void> {
  await app.evaluate(
    (
      { ipcMain },
      { vaultPath, nodes, delayMs }: { vaultPath: string; nodes: FileNode[]; delayMs: number },
    ) => {
      ipcMain.removeHandler('vault:pick')
      ipcMain.handle('vault:pick', () => vaultPath)

      ipcMain.removeHandler('vault:watch')
      ipcMain.handle('vault:watch', () => undefined)

      ipcMain.removeHandler('vault:tree')
      ipcMain.handle('vault:tree', () =>
        delayMs > 0
          ? new Promise<FileNode[]>((resolve) => setTimeout(() => resolve(nodes), delayMs))
          : nodes,
      )
    },
    { vaultPath: opts.vaultPath, nodes: opts.fileNodes, delayMs: opts.treeDelayMs ?? 0 },
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Vault switch race condition — issue #80', () => {
  let vaultA: string
  let vaultB: string
  let userDataDir: string

  test.beforeEach(async () => {
    vaultA = await seedVault('A', 'fileA.md', 'from A')
    vaultB = await seedVault('B', 'fileB.md', 'from B')
    userDataDir = await createUserDataDir(vaultA)
  })

  test.afterEach(async () => {
    await fs.rm(vaultA, { recursive: true, force: true }).catch(() => {})
    await fs.rm(vaultB, { recursive: true, force: true }).catch(() => {})
    await fs.rm(userDataDir, { recursive: true, force: true }).catch(() => {})
  })

  /**
   * Core race condition test.
   *
   * Pick 1 → vault B (tree delayed 1 s, keeps response in-flight)
   * Pick 2 → vault A (tree fast, responds immediately)
   *
   * Without the fix: vault B's delayed tree response arrives after vault A's
   * response, overwrites the tree with vault B's files, and clicking fileA.md
   * triggers MARVIN_OUTSIDE_VAULT (activeVaultPath is B, path is in A).
   *
   * With the fix: vault B's response is discarded because a newer generation
   * is already active; tree shows only vault A's files; fileA.md opens cleanly.
   */
  test('rapid double-pick: final tree shows last-selected vault, no MARVIN_OUTSIDE_VAULT', async () => {
    const consoleErrors: string[] = []
    const stderrLines: string[] = []

    const app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      env: { ...process.env, NODE_ENV: 'test' },
    })

    app.process().stderr?.on('data', (chunk: Buffer) => {
      stderrLines.push(chunk.toString())
    })

    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
    })

    try {
      // Wait for vault A to boot with fileA.md in the tree
      await expect(
        page.locator('.sidebar .file-tree-row.file', { hasText: /^fileA$/ }),
      ).toBeVisible({ timeout: 15_000 })
      // Settle: vault:watch IPC completes so activeVaultPath = vaultA
      await page.waitForTimeout(500)

      // ── Pick 1: mock → vaultB with 1 s tree delay, click "Switch vault" ──
      await installVaultMocks(app, {
        vaultPath: vaultB,
        fileNodes: buildFileNodes(vaultB, 'fileB.md'),
        treeDelayMs: 1_000,
      })
      await page.locator('button.text-btn', { hasText: 'Switch vault' }).click()

      // Do NOT wait for the tree — switch again immediately to trigger the race
      // ── Pick 2: mock → vaultA with 0 ms delay, click "Switch vault" again ──
      await installVaultMocks(app, {
        vaultPath: vaultA,
        fileNodes: buildFileNodes(vaultA, 'fileA.md'),
        treeDelayMs: 0,
      })
      await page.locator('button.text-btn', { hasText: 'Switch vault' }).click()

      // Wait for vault B's delayed tree (1 s) to arrive and potentially overwrite
      // vault A's fast tree. Give 3 s total for the race to resolve.
      await page.waitForTimeout(3_000)

      // ── Assertion 1: tree shows fileA.md (last selected vault) ───────────
      await expect(
        page.locator('.sidebar .file-tree-row.file', { hasText: /^fileA$/ }),
        'fileA.md must appear in tree — last pick was vault A',
      ).toBeVisible({ timeout: 5_000 })

      // fileB.md must NOT appear — stale vault B tree must be discarded
      await expect(
        page.locator('.sidebar .file-tree-row.file', { hasText: /^fileB$/ }),
        'fileB.md must NOT appear — stale vault B tree response must be discarded',
      ).not.toBeVisible({ timeout: 3_000 })

      // ── Assertion 2: clicking fileA.md opens without error ────────────────
      await page.locator('.sidebar .file-tree-row.file', { hasText: /^fileA$/ }).click()
      await expect(
        page.locator('.note-tab-container'),
        'clicking fileA.md must open the editor without error',
      ).toBeVisible({ timeout: 8_000 })

      // ── Assertion 3: no MARVIN_OUTSIDE_VAULT anywhere ─────────────────────
      const outsideVaultInConsole = consoleErrors.some((e) => e.includes('MARVIN_OUTSIDE_VAULT'))
      expect(
        outsideVaultInConsole,
        'MARVIN_OUTSIDE_VAULT must not appear in renderer console',
      ).toBe(false)

      const outsideVaultInStderr = stderrLines.join('').includes('MARVIN_OUTSIDE_VAULT')
      expect(
        outsideVaultInStderr,
        'MARVIN_OUTSIDE_VAULT must not appear in main process stderr',
      ).toBe(false)
    } finally {
      await app.close()
    }
  })

  /**
   * Baseline: a single vault switch updates the tree correctly.
   * This must pass both before and after the fix.
   */
  test('single vault switch: tree shows only files from new vault after pick', async () => {
    const app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      env: { ...process.env, NODE_ENV: 'test' },
    })

    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    try {
      // Wait for vault A tree
      await expect(
        page.locator('.sidebar .file-tree-row.file', { hasText: /^fileA$/ }),
      ).toBeVisible({ timeout: 15_000 })
      await page.waitForTimeout(500)

      // Install mock → vaultB (no delay), click "Switch vault"
      await installVaultMocks(app, {
        vaultPath: vaultB,
        fileNodes: buildFileNodes(vaultB, 'fileB.md'),
        treeDelayMs: 0,
      })
      await page.locator('button.text-btn', { hasText: 'Switch vault' }).click()

      // fileB.md must appear after switching to vault B
      await expect(
        page.locator('.sidebar .file-tree-row.file', { hasText: /^fileB$/ }),
        'fileB.md must appear after switching to vault B',
      ).toBeVisible({ timeout: 15_000 })

      // fileA.md must NOT appear in vault B
      await expect(
        page.locator('.sidebar .file-tree-row.file', { hasText: /^fileA$/ }),
        'fileA.md must not appear after switching to vault B',
      ).not.toBeVisible({ timeout: 3_000 })
    } finally {
      await app.close()
    }
  })
})
