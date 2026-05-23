// Tests for the approval socket server (approval-socket.ts).
// Strategy: spin up a real net.Server via createApprovalServer, connect via
// net.Socket, send hook messages as newline-terminated JSON, and assert the
// response + side-effects (evaluatePermission call path, emit call, resolveApproval).
//
// These are pure Node tests — no Electron, no renderer, no IPC.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import net from 'node:net'
import { createApprovalServer, approvalSocketPath } from '../approval-socket'
import {
  clearSessionRules,
  recordDecision,
  resolveApproval,
} from '../permissions'
import type { AgentEvent } from '../protocol'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SESSION = 'sock-test-session'
const VAULT = '/vault'

function makeEmit() {
  return vi.fn<(channel: string, payload: AgentEvent) => void>()
}

type ServerHandle = Awaited<ReturnType<typeof createApprovalServer>>

async function spawnServer(
  permissionMode: 'default' | 'acceptEdits' | 'plan' | 'auto' = 'default',
  emit = makeEmit(),
): Promise<{ handle: ServerHandle; emit: ReturnType<typeof makeEmit> }> {
  const pendingApprovalIds = new Set<string>()
  const pendingToolNames = new Map<string, string>()
  const handle = await createApprovalServer(
    SESSION,
    { sessionId: SESSION, permissionMode, vaultRoot: VAULT },
    pendingApprovalIds,
    pendingToolNames,
    emit,
  )
  return { handle, emit }
}

/** Open a socket to the server, write a message, collect the response. */
async function roundtrip(
  socketPath: string,
  message: Record<string, unknown>,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection(socketPath)
    let buf = ''
    sock.setEncoding('utf8')
    sock.on('connect', () => {
      sock.write(JSON.stringify(message) + '\n')
    })
    sock.on('data', (chunk: string) => {
      buf += chunk
      const nl = buf.indexOf('\n')
      if (nl >= 0) {
        resolve(buf.slice(0, nl).trim())
        sock.destroy()
      }
    })
    sock.on('error', reject)
    sock.on('close', () => {
      if (buf) resolve(buf.trim())
    })
  })
}

function parseResponse(raw: string): { decision: string; reason?: string } {
  return JSON.parse(raw) as { decision: string; reason?: string }
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let handle: ServerHandle
let emit: ReturnType<typeof makeEmit>

beforeEach(() => {
  clearSessionRules(SESSION)
})

afterEach(async () => {
  if (handle) {
    await handle.close()
    handle = undefined as unknown as ServerHandle
  }
  vi.useRealTimers()
})

// ---------------------------------------------------------------------------
// approvalSocketPath
// ---------------------------------------------------------------------------

describe('approvalSocketPath', () => {
  it('returns a path in the OS temp dir', () => {
    const p = approvalSocketPath('test-session')
    expect(p).toMatch(/marvin-approval-test-session\.sock$/)
  })

  it('different sessions produce different paths', () => {
    expect(approvalSocketPath('a')).not.toBe(approvalSocketPath('b'))
  })
})

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

describe('createApprovalServer — lifecycle', () => {
  it('creates a listening server at the socket path', async () => {
    ;({ handle, emit } = await spawnServer())
    // Connect succeeds
    const sock = net.createConnection(handle.socketPath)
    await new Promise<void>((res, rej) => {
      sock.on('connect', () => { sock.destroy(); res() })
      sock.on('error', rej)
    })
  })

  it('close() removes the socket file', async () => {
    ;({ handle, emit } = await spawnServer())
    const p = handle.socketPath
    await handle.close()
    handle = undefined as unknown as ServerHandle
    // Connecting after close should fail
    await expect(
      new Promise<void>((_, rej) => {
        const s = net.createConnection(p)
        s.on('error', (e) => { rej(e) })
      }),
    ).rejects.toThrow()
  })
})

// ---------------------------------------------------------------------------
// auto mode — all tools allowed
// ---------------------------------------------------------------------------

describe('handleConnection — mode: auto', () => {
  it('responds allow for Write tool', async () => {
    ;({ handle, emit } = await spawnServer('auto'))
    const raw = await roundtrip(handle.socketPath, {
      toolUseId: 'tu-auto-1',
      toolName: 'Write',
      input: { file_path: '/vault/note.md', content: 'hello' },
    })
    expect(parseResponse(raw).decision).toBe('allow')
  })

  it('responds allow for Bash tool', async () => {
    ;({ handle, emit } = await spawnServer('auto'))
    const raw = await roundtrip(handle.socketPath, {
      toolUseId: 'tu-auto-2',
      toolName: 'Bash',
      input: { command: 'ls' },
    })
    expect(parseResponse(raw).decision).toBe('allow')
  })

  it('does not emit permission-request in auto mode', async () => {
    ;({ handle, emit } = await spawnServer('auto'))
    await roundtrip(handle.socketPath, {
      toolUseId: 'tu-auto-3',
      toolName: 'Write',
      input: {},
    })
    expect(emit).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// acceptEdits mode — edit family allowed, others request
// ---------------------------------------------------------------------------

describe('handleConnection — mode: acceptEdits', () => {
  it('responds allow for Write (edit family)', async () => {
    ;({ handle, emit } = await spawnServer('acceptEdits'))
    const raw = await roundtrip(handle.socketPath, {
      toolUseId: 'tu-ae-1',
      toolName: 'Write',
      input: { file_path: '/vault/a.md', content: 'x' },
    })
    expect(parseResponse(raw).decision).toBe('allow')
  })

  it('emits permission-request for Bash (not in edit family)', async () => {
    ;({ handle, emit } = await spawnServer('acceptEdits'))
    const pending = roundtrip(handle.socketPath, {
      toolUseId: 'tu-ae-bash',
      toolName: 'Bash',
      input: { command: 'ls' },
    })
    // Resolve from test side before the roundtrip times out
    await vi.waitFor(() => expect(emit).toHaveBeenCalled(), { timeout: 2000 })
    resolveApproval('tu-ae-bash', { kind: 'allow' })
    const raw = await pending
    expect(parseResponse(raw).decision).toBe('allow')
    expect(emit).toHaveBeenCalledWith(
      `agent:event:${SESSION}`,
      expect.objectContaining({ type: 'permission-request', toolUseId: 'tu-ae-bash' }),
    )
  })
})

// ---------------------------------------------------------------------------
// plan mode — write tools denied
// ---------------------------------------------------------------------------

describe('handleConnection — mode: plan', () => {
  it('responds deny for Write tool', async () => {
    ;({ handle, emit } = await spawnServer('plan'))
    const raw = await roundtrip(handle.socketPath, {
      toolUseId: 'tu-plan-1',
      toolName: 'Write',
      input: { file_path: '/vault/a.md', content: 'x' },
    })
    const resp = parseResponse(raw)
    expect(resp.decision).toBe('deny')
    expect(resp.reason).toBeTruthy()
  })

  it('responds allow for Read tool in plan mode', async () => {
    ;({ handle, emit } = await spawnServer('plan'))
    const raw = await roundtrip(handle.socketPath, {
      toolUseId: 'tu-plan-read',
      toolName: 'Read',
      input: { file_path: '/vault/note.md' },
    })
    expect(parseResponse(raw).decision).toBe('allow')
  })

  it('does not emit permission-request for denied tools', async () => {
    ;({ handle, emit } = await spawnServer('plan'))
    await roundtrip(handle.socketPath, {
      toolUseId: 'tu-plan-noemit',
      toolName: 'Bash',
      input: {},
    })
    expect(emit).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// default mode — emits permission-request, awaits renderer decision
// ---------------------------------------------------------------------------

describe('handleConnection — mode: default, action: request', () => {
  it('emits permission-request event to renderer', async () => {
    ;({ handle, emit } = await spawnServer('default'))
    const pending = roundtrip(handle.socketPath, {
      toolUseId: 'tu-req-1',
      toolName: 'Bash',
      input: { command: 'rm -rf /tmp/test' },
    })
    await vi.waitFor(() => expect(emit).toHaveBeenCalled(), { timeout: 2000 })
    resolveApproval('tu-req-1', { kind: 'allow' })
    await pending
    expect(emit).toHaveBeenCalledWith(
      `agent:event:${SESSION}`,
      expect.objectContaining({
        type: 'permission-request',
        sessionId: SESSION,
        toolUseId: 'tu-req-1',
        toolName: 'Bash',
      }),
    )
  })

  it('permission-request includes risk and suggestion fields', async () => {
    ;({ handle, emit } = await spawnServer('default'))
    const pending = roundtrip(handle.socketPath, {
      toolUseId: 'tu-risk',
      toolName: 'Bash',
      input: { command: 'ls' },
    })
    await vi.waitFor(() => expect(emit).toHaveBeenCalled(), { timeout: 2000 })
    resolveApproval('tu-risk', { kind: 'allow' })
    await pending
    const event = emit.mock.calls[0][1] as Record<string, unknown>
    expect(event.risk).toBeDefined()
    expect(event.suggestion).toBeDefined()
  })

  it('responds allow when renderer resolves with allow', async () => {
    ;({ handle, emit } = await spawnServer('default'))
    const pending = roundtrip(handle.socketPath, {
      toolUseId: 'tu-allow',
      toolName: 'Bash',
      input: {},
    })
    await vi.waitFor(() => expect(emit).toHaveBeenCalled(), { timeout: 2000 })
    resolveApproval('tu-allow', { kind: 'allow' })
    const raw = await pending
    expect(parseResponse(raw).decision).toBe('allow')
  })

  it('responds deny when renderer resolves with deny', async () => {
    ;({ handle, emit } = await spawnServer('default'))
    const pending = roundtrip(handle.socketPath, {
      toolUseId: 'tu-deny-resp',
      toolName: 'Bash',
      input: {},
    })
    await vi.waitFor(() => expect(emit).toHaveBeenCalled(), { timeout: 2000 })
    resolveApproval('tu-deny-resp', { kind: 'deny', reason: 'No thanks' })
    const raw = await pending
    const resp = parseResponse(raw)
    expect(resp.decision).toBe('deny')
    expect(resp.reason).toBeTruthy()
  })

  it('emits AGENT_PERMISSION_TIMEOUT error and sends deny on timeout', async () => {
    vi.useFakeTimers()
    ;({ handle, emit } = await spawnServer('default'))
    const pending = roundtrip(handle.socketPath, {
      toolUseId: 'tu-timeout-sock',
      toolName: 'Bash',
      input: {},
    })
    await vi.waitFor(() => expect(emit).toHaveBeenCalledTimes(1), { timeout: 2000 })
    vi.advanceTimersByTime(300_000)
    const raw = await pending
    expect(parseResponse(raw).decision).toBe('deny')
    // Second emit: the AGENT_PERMISSION_TIMEOUT error event
    await vi.waitFor(() => expect(emit).toHaveBeenCalledTimes(2), { timeout: 2000 })
    const errorEvent = emit.mock.calls[1][1] as Record<string, unknown>
    expect(errorEvent.type).toBe('error')
    expect(errorEvent.code).toBe('AGENT_PERMISSION_TIMEOUT')
  })
})

// ---------------------------------------------------------------------------
// default mode — remembered rules bypass the prompt
// ---------------------------------------------------------------------------

describe('handleConnection — mode: default, remembered allow', () => {
  it('auto-allows without emitting permission-request when rule is remembered', async () => {
    recordDecision(SESSION, 'Bash', { kind: 'allow' })
    ;({ handle, emit } = await spawnServer('default'))
    const raw = await roundtrip(handle.socketPath, {
      toolUseId: 'tu-remembered',
      toolName: 'Bash',
      input: {},
    })
    expect(parseResponse(raw).decision).toBe('allow')
    expect(emit).not.toHaveBeenCalled()
  })

  it('auto-denies without emitting when deny rule is remembered', async () => {
    recordDecision(SESSION, 'Bash', { kind: 'deny', reason: 'Blocked' })
    ;({ handle, emit } = await spawnServer('default'))
    const raw = await roundtrip(handle.socketPath, {
      toolUseId: 'tu-remembered-deny',
      toolName: 'Bash',
      input: {},
    })
    expect(parseResponse(raw).decision).toBe('deny')
    expect(emit).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Malformed hook message
// ---------------------------------------------------------------------------

describe('handleConnection — malformed message', () => {
  it('responds deny with AGENT_INVALID_HOOK_MESSAGE for non-JSON input', async () => {
    ;({ handle, emit } = await spawnServer('default'))
    const raw = await roundtrip(handle.socketPath, { notValid: true } as Record<string, unknown>)
    // Message lacks required toolUseId/toolName — parses as null → deny
    const resp = parseResponse(raw)
    expect(resp.decision).toBe('deny')
    expect(resp.reason).toContain('INVALID_HOOK_MESSAGE')
  })
})

// ---------------------------------------------------------------------------
// Vault boundary via socket
// ---------------------------------------------------------------------------

describe('handleConnection — vault boundary via socket', () => {
  it('denies tool targeting path outside vault (auto mode, boundary fires first)', async () => {
    ;({ handle, emit } = await spawnServer('auto'))
    const raw = await roundtrip(handle.socketPath, {
      toolUseId: 'tu-vb',
      toolName: 'Write',
      input: { file_path: '/etc/passwd', content: 'x' },
    })
    expect(parseResponse(raw).decision).toBe('deny')
    expect(emit).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Integration: concurrent connections
// ---------------------------------------------------------------------------

describe('handleConnection — concurrent connections', () => {
  it('handles two simultaneous tool requests independently', async () => {
    ;({ handle, emit } = await spawnServer('default'))

    const p1 = roundtrip(handle.socketPath, { toolUseId: 'tu-conc-1', toolName: 'Bash', input: {} })
    const p2 = roundtrip(handle.socketPath, { toolUseId: 'tu-conc-2', toolName: 'Bash', input: {} })

    // Wait for both permission-requests to be emitted
    await vi.waitFor(() => expect(emit).toHaveBeenCalledTimes(2), { timeout: 2000 })

    // Resolve in reverse order
    resolveApproval('tu-conc-2', { kind: 'deny' })
    resolveApproval('tu-conc-1', { kind: 'allow' })

    const [raw1, raw2] = await Promise.all([p1, p2])
    expect(parseResponse(raw1).decision).toBe('allow')
    expect(parseResponse(raw2).decision).toBe('deny')
  })
})
