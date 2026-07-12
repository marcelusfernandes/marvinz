/**
 * Wiring test for electron/ipc/agent.ts's composition into electron/main.ts
 * (#580).
 *
 * The existing agent/PTY test net (electron/agent/__tests__/*, e2e/chat-*)
 * covers electron/agent/index.ts's orchestration logic and, via Playwright,
 * a live app's agent:request flow end-to-end — but neither drives
 * ipcMain.handle('agent:detect'|'claude:detect'|'agent:request') directly
 * inside the regular vitest run (confirmed by grep before writing this
 * file). Severing main.ts's registerAgentHandlers(...) call left the entire
 * 170-file repo suite green, the same false-green class QA rejected in #571
 * and that #575/#577's wiring specs closed for the browser/snapshot slices.
 * This file is that spec for the agent slice — added proactively per the
 * #575 lesson, not after a QA bounce.
 *
 * Same technique as #536/#568/#575/#577: mock 'electron'/'chokidar', side-
 * effect-import electron/main.ts to capture the REAL ipcMain.handle
 * callbacks, and drive vault:pick/vault:watch to set up a real
 * activeVaultPath/allowedVaultPaths (same bootstrap as the snapshot/browser
 * wiring specs) so every ctx-touching path (getShellEnv, getAllowedVaultPaths)
 * resolves against real main.ts state, not a fake ctx.
 *
 * The 'start' round-trip reuses the MOCK_CLAUDE_BIN/NODE_ENV=test injection
 * seam main.ts already has for e2e/chat-tool-approval.spec.ts, pointed at
 * the same electron/agent/__tests__/fixtures/mock-claude.sh + a real
 * fixture — vitest sets NODE_ENV=test by default, so the seam is live here
 * without extra setup.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import type { AgentEvent } from '../agent/protocol.js'

vi.mock('electron', () => ({
  app: { getPath: vi.fn(), on: vi.fn(), whenReady: vi.fn(() => ({ then: vi.fn() })) },
  BrowserWindow: vi.fn(),
  Menu: { buildFromTemplate: vi.fn(), setApplicationMenu: vi.fn() },
  MenuItem: vi.fn(),
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  protocol: { registerSchemesAsPrivileged: vi.fn(), handle: vi.fn() },
  dialog: { showOpenDialog: vi.fn() },
  shell: { trashItem: vi.fn(), openExternal: vi.fn() },
  clipboard: {},
  WebContentsView: vi.fn(),
}))

vi.mock('chokidar', () => {
  function makeWatcher() {
    const watcher = {
      on: vi.fn((_event: string, _cb: (p: string) => void) => watcher),
      close: vi.fn(),
    }
    return watcher
  }
  return { default: { watch: vi.fn(() => makeWatcher()) } }
})

import { app, dialog, ipcMain } from 'electron'
import '../main.js' // side-effect import — registers the real ipcMain.handle callbacks

type IpcHandler = (event: unknown, ...args: unknown[]) => unknown
type AgentResponse = { ok: true } | { ok: false; error: string }

function getHandler(channel: string): IpcHandler {
  const calls = vi.mocked(ipcMain.handle).mock.calls
  const found = calls.find(([ch]) => ch === channel)
  if (!found) throw new Error(`ipcMain.handle was never called for channel "${channel}"`)
  return found[1] as IpcHandler
}

const AGENT_CHANNELS = ['agent:detect', 'claude:detect', 'agent:request'] as const

const vaultPick = getHandler('vault:pick')
const vaultWatch = getHandler('vault:watch')
const agentDetect = getHandler('agent:detect')
const agentRequest = getHandler('agent:request')

const FIXTURES = path.join(__dirname, '..', 'agent', '__tests__', 'fixtures')
const MOCK_CLI = path.join(FIXTURES, 'mock-claude.sh')
const SIMPLE_TEXT_FIXTURE = path.join(FIXTURES, 'claude', 'simple-text.jsonl')

function fakeEvent(sink: AgentEvent[]) {
  return {
    sender: {
      isDestroyed: () => false,
      send: (_channel: string, payload: AgentEvent) => {
        sink.push(payload)
      },
    },
  }
}

let vaultDir: string
let userDataDir: string

async function setup(): Promise<void> {
  vaultDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-agent-wiring-')))
  userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-agent-wiring-userdata-'))

  vi.mocked(app.getPath).mockReturnValue(userDataDir)
  vi.mocked(dialog.showOpenDialog).mockResolvedValue({
    canceled: false,
    filePaths: [vaultDir],
  } as Electron.OpenDialogReturnValue)

  await vaultPick(undefined)
  await vaultWatch(undefined, vaultDir)
}

async function teardown(): Promise<void> {
  await vaultWatch(undefined, null)
  delete process.env.MOCK_CLAUDE_BIN
  delete process.env.MOCK_FIXTURE
  await fs.rm(vaultDir, { recursive: true, force: true })
  await fs.rm(userDataDir, { recursive: true, force: true })
}

describe('electron/ipc/agent.ts wiring into main.ts (#580)', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('registers ipcMain.handle for every agent:*/claude:detect channel', () => {
    // Exactly the assertion that would have caught the gap proved by
    // experiment: stubbing out registerAgentHandlers() in main.ts left the
    // whole repo suite green.
    for (const channel of AGENT_CHANNELS) {
      expect(() => getHandler(channel)).not.toThrow()
    }
  })

  it('agent:detect rejects a name outside the hardcoded allowlist via the real guard', async () => {
    await expect(agentDetect(undefined, 'not-a-real-agent')).rejects.toThrow(
      /MARVIN_AGENT_NOT_ALLOWED/
    )
  })

  it('agent:request start rejects a vaultRoot outside the real allowlist', async () => {
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-agent-wiring-outside-'))
    try {
      const result = (await agentRequest(fakeEvent([]), {
        type: 'start',
        sessionId: 'sess-outside',
        provider: 'claude',
        prompt: 'hi',
        vaultRoot: outsideDir,
        permissionMode: 'default',
      })) as AgentResponse
      // Only observable if ctx.getAllowedVaultPaths resolves against the real
      // main.ts allowedVaultPaths Set (populated by the setup()'s vault:pick),
      // not a disconnected/empty fake ctx.
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toMatch(/^MARVIN_/)
    } finally {
      await fs.rm(outsideDir, { recursive: true, force: true })
    }
  })

  it('agent:request cancel/kill no-op safely for an unknown sessionId through the real ctx', async () => {
    await expect(
      agentRequest(fakeEvent([]), { type: 'cancel', sessionId: 'no-such-session' })
    ).resolves.toEqual({ ok: true })
    await expect(
      agentRequest(fakeEvent([]), { type: 'kill', sessionId: 'no-such-session' })
    ).resolves.toEqual({ ok: true })
  })

  it('agent:request start spawns the real mock CLI against the real allowlisted vault and streams events back to the real sender', async () => {
    process.env.MOCK_CLAUDE_BIN = MOCK_CLI
    process.env.MOCK_FIXTURE = SIMPLE_TEXT_FIXTURE

    const events: AgentEvent[] = []
    const result = (await agentRequest(fakeEvent(events), {
      type: 'start',
      sessionId: 'sess-real',
      provider: 'claude',
      prompt: 'hi',
      vaultRoot: vaultDir,
      permissionMode: 'default',
    })) as AgentResponse
    expect(result.ok).toBe(true)

    // Real spawnAgent (electron/agent/index.ts) runs the mock CLI as a real
    // child process and streams its NDJSON output back through the real
    // senderSend closure built in electron/ipc/agent.ts — only reachable if
    // ctx.getShellEnv/registerDynamicShell wiring didn't block the spawn.
    await vi.waitFor(
      () => {
        expect(events.some((e) => e.type === 'turn-result')).toBe(true)
      },
      { timeout: 5000 }
    )
  }, 10000)
})
