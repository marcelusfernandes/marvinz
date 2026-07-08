// Regression tests for issue #537 — `turn-snapshot-summary` must gate on real
// post-turn content changes, not merely "an edit tool was attempted".
//
// Two seams are exercised:
//   - approval-socket.ts: touchedFiles tracking (Test B) — driven directly via
//     createApprovalServer, same harness as approval-socket.spec.ts.
//   - index.ts: dispatchEvent's turn-result -> turn-snapshot-summary emission
//     (Tests A, C, D) — reached via spawnAgent with a mocked child_process.spawn
//     so the NDJSON stdout stream is test-controlled, backed by a real temp-dir
//     vault so the real snapshotBeforeEdit/writeSnapshot machinery runs unmocked
//     (the fix under test must compare against a genuine on-disk pre-edit hash).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import net from 'node:net'
import os from 'node:os'
import fs from 'node:fs/promises'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcess } from 'node:child_process'
import { createApprovalServer, approvalSocketPath } from '../approval-socket'
import { clearSessionRules, resolveApproval } from '../permissions'
import { newTurnId } from '../../snapshot'
import type { AgentEvent, AgentRequest } from '../protocol'

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return { ...actual, spawn: vi.fn() }
})

import { spawn } from 'node:child_process'
import { spawnAgent } from '../index'

// ---------------------------------------------------------------------------
// Fake child process — just enough surface for spawnAgent's NDJSON + lifecycle
// wiring (stdout/stderr streams, stdin stub, pid, close/exit events).
// ---------------------------------------------------------------------------

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
    provider: 'claude',
    prompt: 'do the thing',
    vaultRoot,
    permissionMode: 'auto',
  }
}

/** Send one hook message over the approval socket for `sessionId`; resolves with the parsed response. */
async function sendHookMessage(
  sessionId: string,
  message: Record<string, unknown>
): Promise<{ decision: string; reason?: string }> {
  const socketPath = approvalSocketPath(sessionId)
  return new Promise((resolve, reject) => {
    const sock = net.createConnection(socketPath)
    let buf = ''
    sock.setEncoding('utf8')
    sock.on('connect', () => sock.write(JSON.stringify(message) + '\n'))
    sock.on('data', (chunk: string) => {
      buf += chunk
      const nl = buf.indexOf('\n')
      if (nl >= 0) {
        resolve(JSON.parse(buf.slice(0, nl).trim()) as { decision: string; reason?: string })
        sock.destroy()
      }
    })
    sock.on('error', reject)
  })
}

/** Poll the vault's snapshot manifests until one records a pre-edit hash for `relPath`. */
async function waitForPreEditSnapshot(vaultRoot: string, relPath: string): Promise<void> {
  await vi.waitFor(
    async () => {
      const root = path.join(vaultRoot, '.marvin', 'snapshots')
      const turns = await fs.readdir(root).catch(() => [] as string[])
      for (const turnId of turns) {
        const raw = await fs
          .readFile(path.join(root, turnId, '_manifest.json'), 'utf8')
          .catch(() => null)
        if (!raw) continue
        const manifest = JSON.parse(raw) as { files: { relPath: string }[] }
        if (manifest.files.some((f) => f.relPath === relPath)) return
      }
      throw new Error(`no pre-edit snapshot yet for ${relPath}`)
    },
    { timeout: 3000, interval: 20 }
  )
}

function resultLine(): Buffer {
  return Buffer.from(
    JSON.stringify({
      type: 'result',
      subtype: 'success',
      session_id: 'cli-session',
      total_cost_usd: 0.01,
      duration_ms: 10,
      usage: { input_tokens: 1, output_tokens: 1 },
    }) + '\n'
  )
}

function isTurnResult(e: AgentEvent): boolean {
  return e.type === 'turn-result'
}

function summaryEvents(
  emit: ReturnType<typeof makeEmit>
): Extract<AgentEvent, { type: 'turn-snapshot-summary' }>[] {
  return emit.mock.calls
    .map((c) => c[1])
    .filter(
      (e): e is Extract<AgentEvent, { type: 'turn-snapshot-summary' }> =>
        e.type === 'turn-snapshot-summary'
    )
}

/** Wait until turn-result has been emitted, then give any async content-gate check a moment to settle. */
async function waitForTurnResultThenSettle(emit: ReturnType<typeof makeEmit>): Promise<void> {
  await vi.waitFor(
    () => {
      expect(emit.mock.calls.some((c) => isTurnResult(c[1]))).toBe(true)
    },
    { timeout: 3000, interval: 20 }
  )
  // The content-comparison gate touches the filesystem, so it may resolve on a
  // later microtask/tick than the synchronous turn-result emit. Small real-time
  // settle window (no fake timers in this suite) before asserting on summaryEvents.
  await new Promise((resolve) => setTimeout(resolve, 200))
}

// ---------------------------------------------------------------------------
// Test B — denied edit must never enter touchedFiles (approval-socket.ts seam)
// ---------------------------------------------------------------------------

describe('approval-socket — touchedFiles gate on denied edits (#537)', () => {
  const SESSION = 'touched-deny-session'

  beforeEach(() => clearSessionRules(SESSION))

  it('does not leave the file in touchedFiles once the user denies the edit', async () => {
    const touchedFiles = new Set<string>()
    const emit = makeEmit()
    const handle = await createApprovalServer(
      SESSION,
      { sessionId: SESSION, permissionMode: 'default', vaultRoot: '/vault' },
      new Set(),
      new Map(),
      emit,
      { current: newTurnId() },
      touchedFiles
    )

    try {
      const pending = sendHookMessage(SESSION, {
        toolUseId: 'tu-denied',
        toolName: 'Write',
        input: { file_path: '/vault/note.md', content: 'x' },
      })

      // Wait for the permission-request emit — by this point (renderer hasn't
      // decided yet) touchedFiles has already been populated synchronously by
      // today's implementation.
      await vi.waitFor(() => expect(emit).toHaveBeenCalled(), { timeout: 2000 })
      resolveApproval('tu-denied', { kind: 'deny', reason: 'no' })
      const resp = await pending
      expect(resp.decision).toBe('deny')

      // AC: denied tool calls never enter touchedFiles.
      expect(touchedFiles.has('note.md')).toBe(false)
    } finally {
      await handle.close()
    }
  })
})

// ---------------------------------------------------------------------------
// Tests A, C, D — index.ts turn-result -> turn-snapshot-summary content gate
// ---------------------------------------------------------------------------

describe('spawnAgent — turn-snapshot-summary content gate (#537)', () => {
  let vaultRoot: string
  let fakeChild: FakeChildProcess
  let sessionCounter = 0

  beforeEach(async () => {
    vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'marvinz-537-'))
    fakeChild = new FakeChildProcess()
    vi.mocked(spawn).mockReturnValue(fakeChild as unknown as ChildProcess)
  })

  afterEach(async () => {
    // Trigger index.ts's real 'close' handler so agentChildren/approvalServer
    // are torn down (and the session's socket file removed) between tests.
    fakeChild.emit('close', 0, null)
    await new Promise((resolve) => setTimeout(resolve, 20))
    await fs.rm(vaultRoot, { recursive: true, force: true })
    vi.clearAllMocks()
  })

  it('[C] real content change: summary contains exactly the changed file (regression canary)', async () => {
    const sessionId = `turn-summary-c-${++sessionCounter}`
    const relPath = 'note.md'
    const absPath = path.join(vaultRoot, relPath)
    await fs.writeFile(absPath, 'original content', 'utf8')

    const emit = makeEmit()
    await spawnAgent(startRequest(sessionId, vaultRoot), { claude: 'claude-fake' }, emit)

    const resp = await sendHookMessage(sessionId, {
      toolUseId: 'tu-real-edit',
      toolName: 'Write',
      input: { file_path: absPath, content: 'changed content' },
    })
    expect(resp.decision).toBe('allow')

    await waitForPreEditSnapshot(vaultRoot, relPath)
    // Simulate the tool actually changing the file's content.
    await fs.writeFile(absPath, 'changed content', 'utf8')

    fakeChild.stdout.write(resultLine())
    await waitForTurnResultThenSettle(emit)

    const summaries = summaryEvents(emit)
    expect(summaries).toHaveLength(1)
    expect(summaries[0].fileNames).toEqual([relPath])
  })

  it('[D] no-op edit only: turn-snapshot-summary is not emitted at all', async () => {
    const sessionId = `turn-summary-d-${++sessionCounter}`
    const relPath = 'unchanged.md'
    const absPath = path.join(vaultRoot, relPath)
    await fs.writeFile(absPath, 'same content', 'utf8')

    const emit = makeEmit()
    await spawnAgent(startRequest(sessionId, vaultRoot), { claude: 'claude-fake' }, emit)

    const resp = await sendHookMessage(sessionId, {
      toolUseId: 'tu-noop-edit',
      toolName: 'Write',
      input: { file_path: absPath, content: 'same content' },
    })
    expect(resp.decision).toBe('allow')

    await waitForPreEditSnapshot(vaultRoot, relPath)
    // No-op Write: file content on disk is identical to the captured hashBefore
    // (we don't rewrite it — the "edit" produced no real change).

    fakeChild.stdout.write(resultLine())
    await waitForTurnResultThenSettle(emit)

    expect(summaryEvents(emit)).toHaveLength(0)
  })

  it('[A] mixed no-op + real edit: summary excludes the no-op file', async () => {
    const sessionId = `turn-summary-a-${++sessionCounter}`
    const noopRelPath = 'unchanged.md'
    const realRelPath = 'changed.md'
    const noopAbsPath = path.join(vaultRoot, noopRelPath)
    const realAbsPath = path.join(vaultRoot, realRelPath)
    await fs.writeFile(noopAbsPath, 'same content', 'utf8')
    await fs.writeFile(realAbsPath, 'original content', 'utf8')

    const emit = makeEmit()
    await spawnAgent(startRequest(sessionId, vaultRoot), { claude: 'claude-fake' }, emit)

    const respNoop = await sendHookMessage(sessionId, {
      toolUseId: 'tu-mixed-noop',
      toolName: 'Write',
      input: { file_path: noopAbsPath, content: 'same content' },
    })
    expect(respNoop.decision).toBe('allow')
    await waitForPreEditSnapshot(vaultRoot, noopRelPath)

    const respReal = await sendHookMessage(sessionId, {
      toolUseId: 'tu-mixed-real',
      toolName: 'Write',
      input: { file_path: realAbsPath, content: 'edited content' },
    })
    expect(respReal.decision).toBe('allow')
    await waitForPreEditSnapshot(vaultRoot, realRelPath)

    // Only the second file actually changes on disk.
    await fs.writeFile(realAbsPath, 'edited content', 'utf8')

    fakeChild.stdout.write(resultLine())
    await waitForTurnResultThenSettle(emit)

    const summaries = summaryEvents(emit)
    expect(summaries).toHaveLength(1)
    expect(summaries[0].fileNames).toEqual([realRelPath])
  })
})
