/**
 * Characterization tests for spawnAgent's Codex path (#582).
 *
 * turn-snapshot-summary.spec.ts is the only existing spec that drives
 * spawnAgent end-to-end, and it only exercises provider: 'claude' — the
 * Codex path through spawnAgent (binary/arg resolution, no approval socket,
 * stdin.end() with no write, real NDJSON translation via adaptCodexObj) had
 * zero integration-level coverage before this issue (confirmed by grep). The
 * #582 refactor moved these branches behind the `adapters` map without
 * changing behavior — these tests pin the CURRENT (pre-existing) behavior
 * through the real spawnAgent + adapters.codex, not an idealized one.
 *
 * Same technique as turn-snapshot-summary.spec.ts: mock node:child_process's
 * spawn to return a fake child process so the NDJSON stdout stream and
 * stdin calls are test-controlled.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcess } from 'node:child_process'
import type { AgentEvent, AgentRequest } from '../protocol.js'

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return { ...actual, spawn: vi.fn() }
})

import { spawn } from 'node:child_process'
import { spawnAgent } from '../index.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CODEX_FIXTURE = path.join(__dirname, 'fixtures', 'codex', 'simple-text.jsonl')

class FakeChildProcess extends EventEmitter {
  stdout = new PassThrough()
  stderr = new PassThrough()
  stdin = { write: vi.fn(), end: vi.fn() }
  pid = 4242
}

function makeEmit() {
  return vi.fn<(channel: string, payload: AgentEvent) => void>()
}

function startRequest(
  sessionId: string,
  vaultRoot: string
): Extract<AgentRequest, { type: 'start' }> {
  return {
    type: 'start',
    sessionId,
    provider: 'codex',
    prompt: 'do the thing',
    vaultRoot,
    permissionMode: 'auto',
  }
}

describe('spawnAgent — codex path (#582)', () => {
  let vaultRoot: string
  let fakeChild: FakeChildProcess
  let sessionCounter = 0

  beforeEach(async () => {
    vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'marvinz-582-codex-'))
    fakeChild = new FakeChildProcess()
    vi.mocked(spawn).mockReturnValue(fakeChild as unknown as ChildProcess)
  })

  afterEach(async () => {
    fakeChild.emit('close', 0, null)
    await new Promise((resolve) => setTimeout(resolve, 20))
    await fs.rm(vaultRoot, { recursive: true, force: true })
    vi.clearAllMocks()
  })

  it('resolves the codex binary (falling back to "codex" when bins.codex is absent) and builds codex exec args', async () => {
    const sessionId = `codex-binary-${++sessionCounter}`
    const emit = makeEmit()

    await spawnAgent(startRequest(sessionId, vaultRoot), { claude: 'claude-fake' }, emit)

    expect(spawn).toHaveBeenCalledWith(
      'codex',
      ['exec', '--json', '--skip-git-repo-check', 'do the thing'],
      expect.any(Object)
    )
  })

  it('uses the provided codex binary when bins.codex is set', async () => {
    const sessionId = `codex-binary-explicit-${++sessionCounter}`
    const emit = makeEmit()

    await spawnAgent(
      startRequest(sessionId, vaultRoot),
      { claude: 'claude-fake', codex: '/opt/codex-cli' },
      emit
    )

    expect(spawn).toHaveBeenCalledWith('/opt/codex-cli', expect.any(Array), expect.any(Object))
  })

  it('does not create an approval socket for a codex session (no MARVIN_APPROVAL_SOCKET env var)', async () => {
    const sessionId = `codex-no-approval-${++sessionCounter}`
    const emit = makeEmit()

    await spawnAgent(startRequest(sessionId, vaultRoot), { claude: 'claude-fake' }, emit)

    const spawnEnv = vi.mocked(spawn).mock.calls[0][2]?.env as Record<string, string>
    expect(spawnEnv.MARVIN_APPROVAL_SOCKET).toBeUndefined()
  })

  it('closes stdin without writing to it (prompt is passed as argv, not stdin)', async () => {
    const sessionId = `codex-stdin-${++sessionCounter}`
    const emit = makeEmit()

    await spawnAgent(startRequest(sessionId, vaultRoot), { claude: 'claude-fake' }, emit)

    expect(fakeChild.stdin.write).not.toHaveBeenCalled()
    expect(fakeChild.stdin.end).toHaveBeenCalledTimes(1)
  })

  it('parses real codex NDJSON output via adaptCodexObj and dispatches the resulting AgentEvents', async () => {
    const sessionId = `codex-ndjson-${++sessionCounter}`
    const emit = makeEmit()

    await spawnAgent(startRequest(sessionId, vaultRoot), { claude: 'claude-fake' }, emit)

    const fixtureLines = readFileSync(CODEX_FIXTURE, 'utf8')
    fakeChild.stdout.write(Buffer.from(fixtureLines))

    await vi.waitFor(() => {
      expect(emit.mock.calls.some((c) => (c[1] as AgentEvent).type === 'turn-result')).toBe(true)
    })

    const sessionInit = emit.mock.calls.find((c) => (c[1] as AgentEvent).type === 'session-init')
    expect(sessionInit).toBeDefined()
    expect((sessionInit![1] as Extract<AgentEvent, { type: 'session-init' }>).provider).toBe(
      'codex'
    )
  })
})
