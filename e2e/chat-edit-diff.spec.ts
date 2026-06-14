// DRAFT — Sprint 4 (issue #105). Do not commit until tasks #2, #3, #4 complete.
//
// E2E tests for Edit tool diff rendering and snapshot integration.
//
// Mock strategy: same MOCK_CLAUDE_BIN seam as Sprint 3 (chat-tool-approval.spec.ts).
// New fixtures used:
//   - approval-edit-with-diff.jsonl     — Edit tool, snapshotSaved=true → EditCard with Saved badge → expand DiffCard
//   - approval-edit-snapshot-fail.jsonl — Edit tool, snapshot fails → snapshotSaved=false → no Saved badge, tool still allowed
//   - rewind-from-user-bubble.jsonl     — completed turn → click Rewind → SnapshotPanel opens with initialTurnId
//
// Snapshot trigger timing (AC): createSnapshot fires at tool_use arrival,
// BEFORE the Allow click — even a denied edit has a snapshot of prior state.

import { test, expect, _electron as electron } from 'playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURES = path.resolve(__dirname, '../electron/agent/__tests__/fixtures')
const MOCK_CLI = path.join(FIXTURES, 'mock-claude.sh')

// ---------------------------------------------------------------------------
// Helpers (mirrors chat-tool-approval.spec.ts)
// ---------------------------------------------------------------------------

async function createVault(): Promise<string> {
  const raw = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-e2e-edit-'))
  const vaultRoot = await fs.realpath(raw)
  await fs.writeFile(path.join(vaultRoot, 'note.md'), '# Vault\nReady.', 'utf8')
  return vaultRoot
}

async function createUserDataDir(vaultPath: string): Promise<string> {
  const raw = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-e2e-edit-ud-'))
  const dir = await fs.realpath(raw)
  await fs.writeFile(path.join(dir, 'settings.json'), JSON.stringify({ vaultPath }), 'utf8')
  return dir
}

type LaunchOpts = {
  vaultPath: string
  userDataDir: string
  fixture: string
  delayMs?: number
}

async function launchWithMock({
  vaultPath: _vaultPath,
  userDataDir,
  fixture,
  delayMs = 0,
}: LaunchOpts) {
  return electron.launch({
    args: ['.', `--user-data-dir=${userDataDir}`],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      MOCK_CLAUDE_BIN: MOCK_CLI,
      MOCK_FIXTURE: fixture,
      MOCK_DELAY_MS: String(delayMs),
    },
  })
}

async function openChatPanel(
  page: Awaited<ReturnType<typeof electron.launch>>['_firstWindowPrivate']
) {
  await expect(page.locator('.sidebar .file-tree-row.file')).toBeVisible({ timeout: 15_000 })
  await page.keyboard.press('Meta+k')
  await expect(page.locator('.chat-panel')).toBeVisible({ timeout: 5_000 })
}

async function sendMessage(
  page: Awaited<ReturnType<typeof electron.launch>>['_firstWindowPrivate'],
  text: string
) {
  const composer = page.locator('.chat-composer textarea, .chat-composer [contenteditable]')
  await expect(composer).toBeVisible({ timeout: 3_000 })
  await composer.fill(text)
  await composer.press('Enter')
}

// ---------------------------------------------------------------------------
// AC: EditCard renders compact by default with Saved badge (snapshotSaved=true)
// ---------------------------------------------------------------------------

test.describe('EditCard — approval gate with snapshot', () => {
  let vaultRoot: string
  let userDataDir: string

  test.beforeEach(async () => {
    vaultRoot = await createVault()
    userDataDir = await createUserDataDir(vaultRoot)
  })

  test.afterEach(async () => {
    await fs.rm(vaultRoot, { recursive: true, force: true })
    await fs.rm(userDataDir, { recursive: true, force: true })
  })

  test('Edit tool renders EditCard with approval gate', async () => {
    const app = await launchWithMock({
      vaultPath: vaultRoot,
      userDataDir,
      fixture: path.join(FIXTURES, 'approval-edit-with-diff.jsonl'),
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    try {
      await openChatPanel(page)
      await sendMessage(page, 'Edit the note')

      await expect(page.locator('.chat-tool-card-edit')).toBeVisible({ timeout: 10_000 })
      await expect(page.locator('.chat-approval-gate')).toBeVisible({ timeout: 5_000 })

      // Filename pill shows basename
      await expect(page.locator('.chat-tool-card-edit .chat-tool-pill')).toContainText('note.md')
    } finally {
      await app.close()
    }
  })

  test('Saved badge visible on EditCard when snapshotSaved=true', async () => {
    const app = await launchWithMock({
      vaultPath: vaultRoot,
      userDataDir,
      fixture: path.join(FIXTURES, 'approval-edit-with-diff.jsonl'),
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    try {
      await openChatPanel(page)
      await sendMessage(page, 'Edit the note')

      await expect(page.locator('.chat-approval-gate')).toBeVisible({ timeout: 10_000 })

      // Saved badge must be present — snapshot fired before approval prompt
      await expect(page.locator('[data-badge="saved"]')).toBeVisible({ timeout: 5_000 })
    } finally {
      await app.close()
    }
  })

  test('DiffCard is NOT visible before user expands it', async () => {
    const app = await launchWithMock({
      vaultPath: vaultRoot,
      userDataDir,
      fixture: path.join(FIXTURES, 'approval-edit-with-diff.jsonl'),
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    try {
      await openChatPanel(page)
      await sendMessage(page, 'Edit the note')

      await expect(page.locator('.chat-tool-card-edit')).toBeVisible({ timeout: 10_000 })
      // No inline diff by default (AC)
      await expect(page.locator('.chat-diff-card')).not.toBeVisible()
    } finally {
      await app.close()
    }
  })

  test('clicking EditCard expands DiffCard', async () => {
    const app = await launchWithMock({
      vaultPath: vaultRoot,
      userDataDir,
      fixture: path.join(FIXTURES, 'approval-edit-with-diff.jsonl'),
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    try {
      await openChatPanel(page)
      await sendMessage(page, 'Edit the note')

      await expect(page.locator('.chat-tool-card-edit')).toBeVisible({ timeout: 10_000 })
      await page.locator('.chat-tool-card-edit').click()

      await expect(page.locator('.chat-diff-card')).toBeVisible({ timeout: 5_000 })
    } finally {
      await app.close()
    }
  })

  test('snapshot fires before Allow click — Saved badge present before approving', async () => {
    const app = await launchWithMock({
      vaultPath: vaultRoot,
      userDataDir,
      fixture: path.join(FIXTURES, 'approval-edit-with-diff.jsonl'),
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    try {
      await openChatPanel(page)
      await sendMessage(page, 'Edit the note')

      // Gate visible = permission-request arrived (snapshot already attempted at this point)
      await expect(page.locator('.chat-approval-gate')).toBeVisible({ timeout: 10_000 })

      // Badge present BEFORE any Allow click
      await expect(page.locator('[data-badge="saved"]')).toBeVisible()

      // Now allow
      await page.locator('[data-action="allow"]').click()
      await expect(page.locator('.chat-approval-gate')).not.toBeVisible({ timeout: 5_000 })
    } finally {
      await app.close()
    }
  })
})

// ---------------------------------------------------------------------------
// AC: snapshot failure is fail-soft — tool still allowed, no Saved badge
// ---------------------------------------------------------------------------

test.describe('EditCard — snapshot failure is fail-soft', () => {
  let vaultRoot: string
  let userDataDir: string

  test.beforeEach(async () => {
    vaultRoot = await createVault()
    userDataDir = await createUserDataDir(vaultRoot)
  })

  test.afterEach(async () => {
    await fs.rm(vaultRoot, { recursive: true, force: true })
    await fs.rm(userDataDir, { recursive: true, force: true })
  })

  test('no Saved badge when snapshotSaved=false (snapshot failure)', async () => {
    // approval-edit-snapshot-fail.jsonl is the same Edit stream but the main
    // process mock will fail the snapshot (mocked via MOCK_SNAPSHOT_FAIL=1 env var
    // if the implementation respects it, or the test injects the event directly).
    const app = await launchWithMock({
      vaultPath: vaultRoot,
      userDataDir,
      fixture: path.join(FIXTURES, 'approval-edit-snapshot-fail.jsonl'),
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    try {
      await openChatPanel(page)

      // Inject a permission-request event with snapshotSaved=false directly
      // via the test bridge to simulate a snapshot failure scenario.
      await page.waitForLoadState('domcontentloaded')
      await expect(page.locator('.file-tree-row.file')).toBeVisible({ timeout: 15_000 })

      const sessionId = await page.evaluate(async (): Promise<string | null> => {
        const store = (window as any).__chatStore ?? (window as any).useChatStore
        if (!store) return null
        const sessions = store.getState?.()?.sessions ?? {}
        return Object.keys(sessions)[0] ?? null
      })

      if (sessionId) {
        await page.evaluate((sid: string) => {
          ;(window as any).marvin?.agent?._testEmitError?.(sid, {
            type: 'permission-request',
            sessionId: sid,
            toolUseId: 'tu-snap-fail-inject',
            toolName: 'Edit',
            input: { file_path: '/vault/note.md', old_string: 'a', new_string: 'b' },
            risk: 'destructive',
            suggestion: 'review',
            snapshotSaved: false,
          })
        }, sessionId)

        await expect(page.locator('.chat-approval-gate')).toBeVisible({ timeout: 5_000 })
        await expect(page.locator('[data-badge="saved"]')).not.toBeVisible()

        // Tool execution path still available (gate shows Allow button)
        await expect(page.locator('[data-action="allow"]')).toBeVisible()
      }
    } finally {
      await app.close()
    }
  })
})

// ---------------------------------------------------------------------------
// AC: Rewind click on UserBubble opens SnapshotPanel with initialTurnId
// ---------------------------------------------------------------------------

test.describe('Rewind — opens SnapshotPanel pre-selected to turn', () => {
  let vaultRoot: string
  let userDataDir: string

  test.beforeEach(async () => {
    vaultRoot = await createVault()
    userDataDir = await createUserDataDir(vaultRoot)
  })

  test.afterEach(async () => {
    await fs.rm(vaultRoot, { recursive: true, force: true })
    await fs.rm(userDataDir, { recursive: true, force: true })
  })

  test('Rewind button is visible on user bubble after turn completes', async () => {
    const app = await launchWithMock({
      vaultPath: vaultRoot,
      userDataDir,
      fixture: path.join(FIXTURES, 'rewind-from-user-bubble.jsonl'),
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    try {
      await openChatPanel(page)
      await sendMessage(page, 'Read the note')

      // Wait for turn to complete (turn-result event arrives)
      await expect(
        page.locator(
          '.chat-bubble-user [aria-label*="Rewind"], .chat-bubble-user [data-action="rewind"]'
        )
      ).toBeVisible({ timeout: 10_000 })
    } finally {
      await app.close()
    }
  })

  test('clicking Rewind opens SnapshotPanel', async () => {
    const app = await launchWithMock({
      vaultPath: vaultRoot,
      userDataDir,
      fixture: path.join(FIXTURES, 'rewind-from-user-bubble.jsonl'),
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    try {
      await openChatPanel(page)
      await sendMessage(page, 'Read the note')

      const rewindBtn = page.locator(
        '.chat-bubble-user [aria-label*="Rewind"], .chat-bubble-user [data-action="rewind"]'
      )
      await expect(rewindBtn).toBeVisible({ timeout: 10_000 })
      await rewindBtn.click()

      // SnapshotPanel should open
      await expect(
        page.locator(
          '.snapshot-panel, [data-panel="snapshot"], [role="dialog"][aria-label*="snapshot" i]'
        )
      ).toBeVisible({ timeout: 5_000 })
    } finally {
      await app.close()
    }
  })
})
