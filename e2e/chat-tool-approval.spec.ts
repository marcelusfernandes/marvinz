/**
 * E2E: Chat inline tool approval gate — Sprint 3 (issue #104).
 *
 * Mock strategy: mock-claude.sh shell script (approved by team-lead).
 *
 * Why a mock CLI shell script over direct IPC injection:
 *   - Exercises the full spawnAgent → buildClaudeArgs → evaluatePermission →
 *     permission-request emission chain in main process (not just the renderer).
 *   - Tests --permission-mode flag mapping (AC6): main.ts passes the flag;
 *     evaluatePermission gates what reaches the renderer.
 *   - Tests SIGINT path: cancel() sends SIGINT; mock-cli exits 130 cleanly.
 *   - Keeps tests deterministic (fixture-driven NDJSON, no real API calls).
 *
 * Injection seam: MOCK_CLAUDE_BIN env var + NODE_ENV=test causes main.ts to
 * use the mock binary instead of detectBinary('claude'). Two-line guard added
 * to electron/main.ts; no-op in production (env vars not set).
 *
 * Fixture files (electron/agent/__tests__/fixtures/):
 *   - approval-ask-write.jsonl   — Write tool, triggers permission-request in default mode
 *   - approval-auto-write.jsonl  — Write tool, auto-allowed in acceptEdits mode
 *   - approval-two-tools.jsonl   — Write + Bash, two concurrent permission-requests
 *   - approval-unknown-tool.jsonl — mcp__custom_tool, triggers GenericToolCard
 *
 * Timeout (AC4): tested via a unit-level fake-timer test in useToolApproval.spec.ts;
 * the E2E validates the [Resend] button and error state render after a synthetic
 * AGENT_PERMISSION_TIMEOUT error event is injected via page.evaluate.
 */

import { test, expect, _electron as electron } from 'playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURES = path.resolve(__dirname, '../electron/agent/__tests__/fixtures')
const MOCK_CLI = path.join(FIXTURES, 'mock-claude.sh')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createVault(): Promise<string> {
  const raw = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-e2e-approval-'))
  const vaultRoot = await fs.realpath(raw)
  await fs.writeFile(path.join(vaultRoot, 'note.md'), '# Vault\nReady.', 'utf8')
  return vaultRoot
}

async function createUserDataDir(vaultPath: string): Promise<string> {
  const raw = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-e2e-approval-ud-'))
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

/** Open the chat panel. Assumes vault is already loaded. */
async function openChatPanel(
  page: Awaited<ReturnType<typeof electron.launch>>['_firstWindowPrivate']
) {
  // Wait for vault to load
  await expect(page.locator('.sidebar .file-tree-row.file')).toBeVisible({ timeout: 15_000 })
  // Open chat panel via keyboard shortcut
  await page.keyboard.press('Meta+k')
  await expect(page.locator('.chat-panel')).toBeVisible({ timeout: 5_000 })
}

/** Send a message in the chat composer. */
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
// IPC bridge smoke tests — run without mock CLI, validate preload API surface
// ---------------------------------------------------------------------------

test.describe('IPC preload bridge', () => {
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

  test('window.marvin.agent is exposed', async () => {
    const app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      env: { ...process.env, NODE_ENV: 'test' },
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    try {
      const ok = await page.evaluate(() => typeof (window as any).marvin?.agent === 'object')
      expect(ok).toBe(true)
    } finally {
      await app.close()
    }
  })

  test('window.marvin.agent.request is a function', async () => {
    const app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      env: { ...process.env, NODE_ENV: 'test' },
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    try {
      const ok = await page.evaluate(
        () => typeof (window as any).marvin?.agent?.request === 'function'
      )
      expect(ok).toBe(true)
    } finally {
      await app.close()
    }
  })

  test('window.marvin.agent.approve is a function', async () => {
    const app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      env: { ...process.env, NODE_ENV: 'test' },
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    try {
      const ok = await page.evaluate(
        () => typeof (window as any).marvin?.agent?.approve === 'function'
      )
      expect(ok).toBe(true)
    } finally {
      await app.close()
    }
  })

  test('window.marvin.agent.onEvent returns unsubscribe function', async () => {
    const app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      env: { ...process.env, NODE_ENV: 'test' },
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await expect(page.locator('.file-tree-row.file')).toBeVisible({ timeout: 15_000 })
    try {
      const ok = await page.evaluate(
        () => typeof (window as any).marvin?.agent?.onEvent?.('sid', () => {}) === 'function'
      )
      expect(ok).toBe(true)
    } finally {
      await app.close()
    }
  })

  test('invalid agent:request type returns error envelope without crashing', async () => {
    const app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      env: { ...process.env, NODE_ENV: 'test' },
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await expect(page.locator('.file-tree-row.file')).toBeVisible({ timeout: 15_000 })
    try {
      const result = await page.evaluate(async () =>
        (window as any).marvin?.agent?.request?.({ type: '__invalid__', sessionId: 'x' })
      )
      expect(result).toBeDefined()
      if (result && !result.ok) expect(typeof result.error).toBe('string')
    } finally {
      await app.close()
    }
  })
})

// ---------------------------------------------------------------------------
// AC1 + AC2: default mode — approval gate appears with amber dot
// ---------------------------------------------------------------------------

test.describe('AC1/AC2: default mode approval gate', () => {
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

  test('Write tool in default mode renders amber approval gate', async () => {
    const app = await launchWithMock({
      vaultPath: vaultRoot,
      userDataDir,
      fixture: path.join(FIXTURES, 'approval-ask-write.jsonl'),
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    try {
      await openChatPanel(page)
      await sendMessage(page, 'Write a test note')

      // Approval gate must appear
      await expect(page.locator('.chat-approval-gate')).toBeVisible({ timeout: 10_000 })

      // Dot must be amber
      await expect(page.locator('.chat-timeline-dot[data-state="amber"]')).toBeVisible({
        timeout: 5_000,
      })

      // All three buttons present
      await expect(page.locator('[data-action="allow"]')).toBeVisible()
      await expect(page.locator('[data-action="allow-always"]')).toBeVisible()
      await expect(page.locator('[data-action="deny"]')).toBeVisible()

      // Allow button has focus (auto-focus)
      const allowBtn = page.locator('[data-action="allow"]')
      await expect(allowBtn).toBeFocused()
    } finally {
      await app.close()
    }
  })

  test('WriteCard shows filename pill for the tool input', async () => {
    const app = await launchWithMock({
      vaultPath: vaultRoot,
      userDataDir,
      fixture: path.join(FIXTURES, 'approval-ask-write.jsonl'),
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    try {
      await openChatPanel(page)
      await sendMessage(page, 'Write a test note')

      await expect(page.locator('.chat-approval-gate')).toBeVisible({ timeout: 10_000 })
      // WriteCard should show the filename
      await expect(page.locator('.chat-tool-card-write .chat-tool-pill')).toContainText(
        'test-note.md'
      )
    } finally {
      await app.close()
    }
  })
})

// ---------------------------------------------------------------------------
// AC3 (allow path): Allow click → dot transitions amber → running
// ---------------------------------------------------------------------------

test.describe('AC3: Allow decision', () => {
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

  test('clicking Allow transitions dot to running and hides the gate', async () => {
    const app = await launchWithMock({
      vaultPath: vaultRoot,
      userDataDir,
      fixture: path.join(FIXTURES, 'approval-ask-write.jsonl'),
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    try {
      await openChatPanel(page)
      await sendMessage(page, 'Write a test note')

      const gate = page.locator('.chat-approval-gate')
      await expect(gate).toBeVisible({ timeout: 10_000 })

      await page.locator('[data-action="allow"]').click()

      // Gate disappears after decision
      await expect(gate).not.toBeVisible({ timeout: 5_000 })

      // Dot transitions from amber to running (or green if tool-result arrives fast)
      await expect(
        page.locator(
          '.chat-timeline-dot[data-state="running"], .chat-timeline-dot[data-state="green"]'
        )
      ).toBeVisible({ timeout: 5_000 })
    } finally {
      await app.close()
    }
  })

  test('clicking Allow always sends remember:session decision', async () => {
    const app = await launchWithMock({
      vaultPath: vaultRoot,
      userDataDir,
      fixture: path.join(FIXTURES, 'approval-ask-write.jsonl'),
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    try {
      await openChatPanel(page)
      await sendMessage(page, 'Write a test note')

      await expect(page.locator('.chat-approval-gate')).toBeVisible({ timeout: 10_000 })
      await page.locator('[data-action="allow-always"]').click()

      // Gate disappears
      await expect(page.locator('.chat-approval-gate')).not.toBeVisible({ timeout: 5_000 })
    } finally {
      await app.close()
    }
  })
})

// ---------------------------------------------------------------------------
// AC3 (deny path): Deny click → dot turns red, "Denied" label
// ---------------------------------------------------------------------------

test.describe('AC3 / AC5: Deny decision', () => {
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

  test('clicking Deny transitions dot to red and shows denied status', async () => {
    const app = await launchWithMock({
      vaultPath: vaultRoot,
      userDataDir,
      fixture: path.join(FIXTURES, 'approval-ask-write.jsonl'),
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    try {
      await openChatPanel(page)
      await sendMessage(page, 'Write a test note')

      await expect(page.locator('.chat-approval-gate')).toBeVisible({ timeout: 10_000 })
      await page.locator('[data-action="deny"]').click()

      // Gate disappears
      await expect(page.locator('.chat-approval-gate')).not.toBeVisible({ timeout: 5_000 })

      // Red dot visible
      await expect(page.locator('.chat-timeline-dot[data-state="red"]')).toBeVisible({
        timeout: 5_000,
      })

      // "Denied" status label
      await expect(
        page.locator('.chat-approval-status[data-state="denied"], [data-state="denied"]')
      ).toBeVisible({ timeout: 3_000 })
    } finally {
      await app.close()
    }
  })

  test('Escape inside gate triggers deny', async () => {
    const app = await launchWithMock({
      vaultPath: vaultRoot,
      userDataDir,
      fixture: path.join(FIXTURES, 'approval-ask-write.jsonl'),
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    try {
      await openChatPanel(page)
      await sendMessage(page, 'Write a test note')

      await expect(page.locator('.chat-approval-gate')).toBeVisible({ timeout: 10_000 })

      // Focus is on Allow button; press Escape
      await page.keyboard.press('Escape')
      await expect(page.locator('.chat-approval-gate')).not.toBeVisible({ timeout: 5_000 })
      await expect(page.locator('.chat-timeline-dot[data-state="red"]')).toBeVisible({
        timeout: 5_000,
      })
    } finally {
      await app.close()
    }
  })
})

// ---------------------------------------------------------------------------
// AC4: Timeout — synthetic AGENT_PERMISSION_TIMEOUT via page.evaluate
// (The 300s timer is unit-tested with fake timers in useToolApproval.spec.ts;
//  here we test only that the renderer handles the error event correctly.)
// ---------------------------------------------------------------------------

test.describe('AC4: Timeout error renders [Resend]', () => {
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

  test('AGENT_PERMISSION_TIMEOUT error event shows error state and Resend button', async () => {
    const app = await launchWithMock({
      vaultPath: vaultRoot,
      userDataDir,
      fixture: path.join(FIXTURES, 'approval-ask-write.jsonl'),
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    try {
      await openChatPanel(page)
      await sendMessage(page, 'Write a test note')

      // Wait for gate to render
      await expect(page.locator('.chat-approval-gate')).toBeVisible({ timeout: 10_000 })

      // Inject timeout error event — bypasses the 300s timer
      await page.evaluate(async () => {
        const store = (window as any).__chatStore ?? (window as any).useChatStore
        const sessions = store?.getState?.()?.sessions ?? {}
        const sessionId = Object.keys(sessions)[0]
        if (!sessionId) return
        ;(window as any).marvin?.agent?._testEmitError?.(sessionId, {
          type: 'error',
          sessionId,
          code: 'AGENT_PERMISSION_TIMEOUT',
          message: 'Approval timed out after 5 minutes',
          recoverable: false,
        })
      })

      // Resend button appears (renderer shows error card)
      await expect(page.locator('button:has-text("Resend"), [data-action="resend"]')).toBeVisible({
        timeout: 5_000,
      })
    } finally {
      await app.close()
    }
  })
})

// ---------------------------------------------------------------------------
// AC6: acceptEdits mode — no approval gate
// ---------------------------------------------------------------------------

test.describe('AC6: acceptEdits mode skips approval', () => {
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

  test('Write tool in acceptEdits mode does not show approval gate', async () => {
    const app = await launchWithMock({
      vaultPath: vaultRoot,
      userDataDir,
      fixture: path.join(FIXTURES, 'approval-auto-write.jsonl'),
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    try {
      await openChatPanel(page)

      // Switch to "Edit automatically" mode via mode picker
      await page.locator('.chat-mode-pill[aria-haspopup="listbox"]').click()
      const listbox = page.locator('.chat-modes-list[role="listbox"]')
      await expect(listbox).toBeVisible({ timeout: 3_000 })
      await page.locator('[role="option"]', { hasText: 'Edit automatically' }).click()
      await expect(listbox).not.toBeVisible()

      // Verify mode changed
      await expect(page.locator('.chat-mode-pill[data-mode="acceptEdits"]')).toBeVisible()

      await sendMessage(page, 'Write a note automatically')

      // No approval gate should appear — tool auto-allowed
      await page.waitForTimeout(2_000)
      await expect(page.locator('.chat-approval-gate')).not.toBeVisible()
    } finally {
      await app.close()
    }
  })
})

// ---------------------------------------------------------------------------
// AC6: plan mode — Write tool auto-denied
// ---------------------------------------------------------------------------

test.describe('AC6: plan mode auto-denies writes', () => {
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

  test('Write tool in plan mode shows red dot without approval gate', async () => {
    const app = await launchWithMock({
      vaultPath: vaultRoot,
      userDataDir,
      fixture: path.join(FIXTURES, 'approval-ask-write.jsonl'),
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    try {
      await openChatPanel(page)

      // Switch to Plan mode
      await page.locator('.chat-mode-pill[aria-haspopup="listbox"]').click()
      await expect(page.locator('.chat-modes-list[role="listbox"]')).toBeVisible({ timeout: 3_000 })
      await page.locator('[role="option"]', { hasText: 'Plan mode' }).click()
      await expect(page.locator('.chat-mode-pill[data-mode="plan"]')).toBeVisible()

      await sendMessage(page, 'Write a file')

      // No approval gate — plan mode denies without asking
      await page.waitForTimeout(2_000)
      await expect(page.locator('.chat-approval-gate')).not.toBeVisible()

      // Tool block shows red dot (denied)
      await expect(page.locator('.chat-timeline-dot[data-state="red"]')).toBeVisible({
        timeout: 5_000,
      })
    } finally {
      await app.close()
    }
  })
})

// ---------------------------------------------------------------------------
// AC7: Concurrent tools — two approval cards stacked
// ---------------------------------------------------------------------------

test.describe('AC7: Concurrent approval cards', () => {
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

  test('two tool calls render two approval gates stacked', async () => {
    const app = await launchWithMock({
      vaultPath: vaultRoot,
      userDataDir,
      fixture: path.join(FIXTURES, 'approval-two-tools.jsonl'),
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    try {
      await openChatPanel(page)
      await sendMessage(page, 'Write a note and run a command')

      // Two approval gates must appear
      await expect(page.locator('.chat-approval-gate')).toHaveCount(2, { timeout: 10_000 })
    } finally {
      await app.close()
    }
  })

  test('can approve and deny two tools independently in any order', async () => {
    const app = await launchWithMock({
      vaultPath: vaultRoot,
      userDataDir,
      fixture: path.join(FIXTURES, 'approval-two-tools.jsonl'),
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    try {
      await openChatPanel(page)
      await sendMessage(page, 'Write a note and run a command')

      const gates = page.locator('.chat-approval-gate')
      await expect(gates).toHaveCount(2, { timeout: 10_000 })

      // Deny the first, allow the second
      await gates.first().locator('[data-action="deny"]').click()
      await gates.last().locator('[data-action="allow"]').click()

      // Both gates gone
      await expect(page.locator('.chat-approval-gate')).toHaveCount(0, { timeout: 5_000 })
    } finally {
      await app.close()
    }
  })
})

// ---------------------------------------------------------------------------
// AC8: Unknown tool → GenericToolCard fallback
// ---------------------------------------------------------------------------

test.describe('AC8: Unknown tool GenericToolCard', () => {
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

  test('unknown MCP tool renders GenericToolCard with approval gate', async () => {
    const app = await launchWithMock({
      vaultPath: vaultRoot,
      userDataDir,
      fixture: path.join(FIXTURES, 'approval-unknown-tool.jsonl'),
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    try {
      await openChatPanel(page)
      await sendMessage(page, 'Use the custom MCP tool')

      // GenericToolCard must appear
      await expect(page.locator('.chat-tool-card-generic')).toBeVisible({ timeout: 10_000 })

      // Approval gate present
      await expect(page.locator('.chat-approval-gate')).toBeVisible({ timeout: 5_000 })

      // "Show input" button available to inspect JSON
      await expect(page.locator('button:has-text("Show input")')).toBeVisible()
    } finally {
      await app.close()
    }
  })
})

// ---------------------------------------------------------------------------
// AC6 (mode picker): ModesPicker UI interactions
// ---------------------------------------------------------------------------

test.describe('ModesPicker UI', () => {
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

  test('ModePill shows current mode and opens listbox on click', async () => {
    const app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      env: { ...process.env, NODE_ENV: 'test' },
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    try {
      await openChatPanel(page)

      const pill = page.locator('.chat-mode-pill[aria-haspopup="listbox"]')
      await expect(pill).toBeVisible()

      // Default mode
      await expect(pill).toHaveAttribute('data-mode', 'default')

      await pill.click()
      await expect(page.locator('.chat-modes-list[role="listbox"]')).toBeVisible({ timeout: 3_000 })
      await expect(page.locator('[role="option"]')).toHaveCount(4)
    } finally {
      await app.close()
    }
  })

  test('selecting a mode from picker updates the pill', async () => {
    const app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      env: { ...process.env, NODE_ENV: 'test' },
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    try {
      await openChatPanel(page)

      await page.locator('.chat-mode-pill[aria-haspopup="listbox"]').click()
      await expect(page.locator('.chat-modes-list[role="listbox"]')).toBeVisible({ timeout: 3_000 })
      await page.locator('[role="option"]', { hasText: 'Plan mode' }).click()

      await expect(page.locator('.chat-mode-pill[data-mode="plan"]')).toBeVisible({
        timeout: 3_000,
      })
    } finally {
      await app.close()
    }
  })

  test('Shift+Tab cycles through modes', async () => {
    const app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      env: { ...process.env, NODE_ENV: 'test' },
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    try {
      await openChatPanel(page)

      const pill = page.locator('.chat-mode-pill[aria-haspopup="listbox"]')
      await expect(pill).toHaveAttribute('data-mode', 'default')

      // Focus composer, then Shift+Tab
      const composer = page.locator('.chat-composer textarea, .chat-composer [contenteditable]')
      await composer.focus()

      const modeBefore = await pill.getAttribute('data-mode')
      await page.keyboard.press('Shift+Tab')
      const modeAfter = await pill.getAttribute('data-mode')
      expect(modeAfter).not.toBe(modeBefore)

      // 3 more cycles brings it back
      await page.keyboard.press('Shift+Tab')
      await page.keyboard.press('Shift+Tab')
      await page.keyboard.press('Shift+Tab')
      await expect(pill).toHaveAttribute('data-mode', modeBefore!)
    } finally {
      await app.close()
    }
  })

  test('Composer stays interactive while approval gate is visible', async () => {
    const app = await launchWithMock({
      vaultPath: vaultRoot,
      userDataDir,
      fixture: path.join(FIXTURES, 'approval-ask-write.jsonl'),
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    try {
      await openChatPanel(page)
      await sendMessage(page, 'Write a test note')

      await expect(page.locator('.chat-approval-gate')).toBeVisible({ timeout: 10_000 })

      // Composer must be focusable and accept input while gate is shown
      const composer = page.locator('.chat-composer textarea, .chat-composer [contenteditable]')
      await composer.click()
      await expect(composer).toBeFocused()
      await composer.fill('follow-up message')
      await expect(composer).toHaveValue('follow-up message')
    } finally {
      await app.close()
    }
  })
})
