// Tests for the PreToolUse hook bridge script + integration flow.
//
// Architecture:
//   claude CLI → calls pretooluse-bridge.cjs (--permission-prompt-tool) per tool use
//   Bridge reads tool info from stdin (JSON from claude CLI)
//   Bridge connects to MARVIN_APPROVAL_SOCKET → sends { toolUseId, toolName, input }
//   Socket server (approval-socket.ts) calls evaluatePermission + awaitApproval
//   Socket server responds { decision: 'allow'|'deny', reason? }
//   Bridge exits 0 (allow, with hookSpecificOutput JSON on stdout) or 2 (deny)
//
// Bridge stdin shape (from claude CLI --permission-prompt-tool convention):
//   { tool_use_id, tool_name, tool_input, session_id, cwd, permission_mode }
//
// Bridge stdout on allow:
//   { hookSpecificOutput: { permissionDecision: 'allow', permissionDecisionReason: string } }
//
// Fail-closed: socket unreachable / missing / malformed → exit 2.

import { describe, it, expect, vi, afterEach } from 'vitest'
import { spawn } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { createApprovalServer } from '../approval-socket'
import { resolveApproval, clearSessionRules } from '../permissions'
import type { AgentEvent } from '../protocol'
import { IPC_CHANNELS } from '../../../src/shared/ipc-channels'

// ---------------------------------------------------------------------------
// Bridge script path
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BRIDGE_SCRIPT =
  process.env.MARVIN_HOOK_SCRIPT ?? path.resolve(__dirname, '../hooks/pretooluse-bridge.cjs')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SESSION = 'hook-test-session'
const VAULT = '/tmp/hook-test-vault'

function makeEmit() {
  return vi.fn<(channel: string, payload: AgentEvent) => void>()
}

/** Spawn the bridge, pipe hook stdin JSON, collect exit code + output. */
function spawnBridge(
  socketPath: string,
  toolUseId: string,
  toolName: string,
  input: Record<string, unknown> = {}
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn('node', [BRIDGE_SCRIPT], {
      env: { ...process.env, MARVIN_APPROVAL_SOCKET: socketPath },
    })
    let stdout = ''
    let stderr = ''
    proc.stdout?.on('data', (c: Buffer) => {
      stdout += c.toString()
    })
    proc.stderr?.on('data', (c: Buffer) => {
      stderr += c.toString()
    })
    proc.on('close', (code) => resolve({ exitCode: code, stdout, stderr }))

    // Write the claude CLI hook stdin format and close
    const hookStdin = JSON.stringify({
      tool_use_id: toolUseId,
      tool_name: toolName,
      tool_input: input,
      session_id: SESSION,
      cwd: VAULT,
      permission_mode: 'default',
    })
    proc.stdin?.write(hookStdin)
    proc.stdin?.end()
  })
}

afterEach(() => {
  clearSessionRules(SESSION)
  vi.useRealTimers()
})

// ---------------------------------------------------------------------------
// Bridge script — unit tests
// ---------------------------------------------------------------------------

describe('bridge script — unit', () => {
  it('exits 0 (allow) when socket server responds allow', async () => {
    const emit = makeEmit()
    const server = await createApprovalServer(
      SESSION,
      { sessionId: SESSION, permissionMode: 'auto', vaultRoot: VAULT },
      new Set(),
      new Map(),
      emit
    )
    try {
      const { exitCode } = await spawnBridge(server.socketPath, 'tu-bridge-allow', 'Read', {
        file_path: `${VAULT}/file.md`,
      })
      expect(exitCode).toBe(0)
    } finally {
      await server.close()
    }
  })

  it('stdout on allow contains hookSpecificOutput with permissionDecision and permissionDecisionReason', async () => {
    const emit = makeEmit()
    const server = await createApprovalServer(
      SESSION,
      { sessionId: SESSION, permissionMode: 'auto', vaultRoot: VAULT },
      new Set(),
      new Map(),
      emit
    )
    try {
      const { exitCode, stdout } = await spawnBridge(
        server.socketPath,
        'tu-bridge-output',
        'Read',
        { file_path: `${VAULT}/file.md` }
      )
      expect(exitCode).toBe(0)
      const parsed = JSON.parse(stdout.trim()) as {
        hookSpecificOutput: {
          hookEventName: string
          permissionDecision: string
          permissionDecisionReason: string
        }
      }
      expect(parsed.hookSpecificOutput.hookEventName).toBe('PreToolUse')
      expect(parsed.hookSpecificOutput.permissionDecision).toBe('allow')
      expect(typeof parsed.hookSpecificOutput.permissionDecisionReason).toBe('string')
    } finally {
      await server.close()
    }
  })

  it('exits 2 (deny) when socket server responds deny (plan mode Write)', async () => {
    const emit = makeEmit()
    const server = await createApprovalServer(
      SESSION,
      { sessionId: SESSION, permissionMode: 'plan', vaultRoot: VAULT },
      new Set(),
      new Map(),
      emit
    )
    try {
      const { exitCode } = await spawnBridge(server.socketPath, 'tu-bridge-deny', 'Write', {
        file_path: `${VAULT}/a.md`,
        content: 'x',
      })
      expect(exitCode).toBe(2)
    } finally {
      await server.close()
    }
  })

  it('exits 2 (fail-closed) when socket file does not exist', async () => {
    const fakePath = path.join(os.tmpdir(), 'marvin-approval-nonexistent.sock')
    const { exitCode } = await spawnBridge(fakePath, 'tu-bridge-nosock', 'Bash', {})
    expect(exitCode).toBe(2)
  })

  it('exits 2 when MARVIN_APPROVAL_SOCKET is not set', async () => {
    const proc = spawn('node', [BRIDGE_SCRIPT], {
      env: { ...process.env, MARVIN_APPROVAL_SOCKET: '' },
    })
    let exitCode: number | null = null
    await new Promise<void>((res) => {
      proc.on('close', (code) => {
        exitCode = code
        res()
      })
      proc.stdin?.write(
        JSON.stringify({
          tool_use_id: 'tu-no-socket',
          tool_name: 'Bash',
          tool_input: {},
        })
      )
      proc.stdin?.end()
    })
    expect(exitCode).toBe(2)
  })

  it('exits 2 on malformed stdin JSON', async () => {
    const emit = makeEmit()
    const server = await createApprovalServer(
      SESSION,
      { sessionId: SESSION, permissionMode: 'auto', vaultRoot: VAULT },
      new Set(),
      new Map(),
      emit
    )
    try {
      const proc = spawn('node', [BRIDGE_SCRIPT], {
        env: { ...process.env, MARVIN_APPROVAL_SOCKET: server.socketPath },
      })
      let exitCode: number | null = null
      await new Promise<void>((res) => {
        proc.on('close', (code) => {
          exitCode = code
          res()
        })
        proc.stdin?.write('not-valid-json\n')
        proc.stdin?.end()
      })
      expect(exitCode).toBe(2)
    } finally {
      await server.close()
    }
  })

  it('exits 2 when stdin is missing tool_use_id', async () => {
    const emit = makeEmit()
    const server = await createApprovalServer(
      SESSION,
      { sessionId: SESSION, permissionMode: 'auto', vaultRoot: VAULT },
      new Set(),
      new Map(),
      emit
    )
    try {
      const proc = spawn('node', [BRIDGE_SCRIPT], {
        env: { ...process.env, MARVIN_APPROVAL_SOCKET: server.socketPath },
      })
      let exitCode: number | null = null
      await new Promise<void>((res) => {
        proc.on('close', (code) => {
          exitCode = code
          res()
        })
        proc.stdin?.write(JSON.stringify({ tool_name: 'Bash', tool_input: {} }))
        proc.stdin?.end()
      })
      expect(exitCode).toBe(2)
    } finally {
      await server.close()
    }
  })
})

// ---------------------------------------------------------------------------
// Bridge script + socket — renderer decision round-trip
// ---------------------------------------------------------------------------

describe('bridge script — renderer decision round-trip', () => {
  it('relays allow decision from renderer: bridge exits 0 with hookSpecificOutput', async () => {
    const emit = makeEmit()
    const server = await createApprovalServer(
      SESSION,
      { sessionId: SESSION, permissionMode: 'default', vaultRoot: VAULT },
      new Set(),
      new Map(),
      emit
    )
    try {
      const bridgePromise = spawnBridge(server.socketPath, 'tu-bridge-renderer', 'Bash', {
        command: 'ls',
      })
      await vi.waitFor(() => expect(emit).toHaveBeenCalled(), { timeout: 3000 })
      resolveApproval('tu-bridge-renderer', { kind: 'allow' })
      const { exitCode, stdout } = await bridgePromise
      expect(exitCode).toBe(0)
      const parsed = JSON.parse(stdout.trim()) as {
        hookSpecificOutput: {
          hookEventName: string
          permissionDecision: string
          permissionDecisionReason: string
        }
      }
      expect(parsed.hookSpecificOutput.hookEventName).toBe('PreToolUse')
      expect(parsed.hookSpecificOutput.permissionDecision).toBe('allow')
    } finally {
      await server.close()
    }
  })

  it('relays deny decision from renderer: bridge exits 2', async () => {
    const emit = makeEmit()
    const server = await createApprovalServer(
      SESSION,
      { sessionId: SESSION, permissionMode: 'default', vaultRoot: VAULT },
      new Set(),
      new Map(),
      emit
    )
    try {
      const bridgePromise = spawnBridge(server.socketPath, 'tu-bridge-deny-renderer', 'Bash', {
        command: 'rm -rf /tmp',
      })
      await vi.waitFor(() => expect(emit).toHaveBeenCalled(), { timeout: 3000 })
      resolveApproval('tu-bridge-deny-renderer', { kind: 'deny', reason: 'User denied' })
      const { exitCode } = await bridgePromise
      expect(exitCode).toBe(2)
    } finally {
      await server.close()
    }
  })
})

// ---------------------------------------------------------------------------
// Integration — full round-trip with permission-request emission
// ---------------------------------------------------------------------------

describe('integration — bridge + socket + permission-request', () => {
  it('emits permission-request to renderer with correct toolUseId and toolName', async () => {
    const emit = makeEmit()
    const server = await createApprovalServer(
      SESSION,
      { sessionId: SESSION, permissionMode: 'default', vaultRoot: VAULT },
      new Set(),
      new Map(),
      emit
    )
    try {
      const bridgePromise = spawnBridge(server.socketPath, 'tu-integration-1', 'Bash', {
        command: 'echo hi',
      })
      await vi.waitFor(
        () =>
          expect(emit).toHaveBeenCalledWith(
            IPC_CHANNELS.agent.event(SESSION),
            expect.objectContaining({
              type: 'permission-request',
              sessionId: SESSION,
              toolUseId: 'tu-integration-1',
              toolName: 'Bash',
            })
          ),
        { timeout: 3000 }
      )
      resolveApproval('tu-integration-1', { kind: 'allow' })
      const { exitCode } = await bridgePromise
      expect(exitCode).toBe(0)
    } finally {
      await server.close()
    }
  })

  it('full deny round-trip: bridge exits 2, permission-request was emitted', async () => {
    const emit = makeEmit()
    const server = await createApprovalServer(
      SESSION,
      { sessionId: SESSION, permissionMode: 'default', vaultRoot: VAULT },
      new Set(),
      new Map(),
      emit
    )
    try {
      const bridgePromise = spawnBridge(server.socketPath, 'tu-integration-deny', 'Bash', {
        command: 'echo denied',
      })
      await vi.waitFor(() => expect(emit).toHaveBeenCalled(), { timeout: 3000 })
      resolveApproval('tu-integration-deny', { kind: 'deny' })
      const { exitCode } = await bridgePromise
      expect(exitCode).toBe(2)
      expect(emit).toHaveBeenCalledWith(
        IPC_CHANNELS.agent.event(SESSION),
        expect.objectContaining({ type: 'permission-request' })
      )
    } finally {
      await server.close()
    }
  })

  it('allow-always: second call to same tool auto-allows without emitting permission-request', async () => {
    const emit = makeEmit()
    const server = await createApprovalServer(
      SESSION,
      { sessionId: SESSION, permissionMode: 'default', vaultRoot: VAULT },
      new Set(),
      new Map(),
      emit
    )
    try {
      // First call — renderer approves with remember:session
      const bridge1 = spawnBridge(server.socketPath, 'tu-remember-1', 'Bash', {})
      await vi.waitFor(() => expect(emit).toHaveBeenCalled(), { timeout: 3000 })
      resolveApproval('tu-remember-1', { kind: 'allow', remember: 'session' })
      await bridge1

      // Second call — same tool, same session: auto-allow, no permission-request
      emit.mockClear()
      const bridge2 = spawnBridge(server.socketPath, 'tu-remember-2', 'Bash', {})
      const { exitCode } = await bridge2
      expect(exitCode).toBe(0)
      expect(emit).not.toHaveBeenCalled()
    } finally {
      await server.close()
    }
  })

  it('concurrent bridge calls are handled independently', async () => {
    const emit = makeEmit()
    const server = await createApprovalServer(
      SESSION,
      { sessionId: SESSION, permissionMode: 'default', vaultRoot: VAULT },
      new Set(),
      new Map(),
      emit
    )
    try {
      const b1 = spawnBridge(server.socketPath, 'tu-conc-1', 'Bash', {})
      const b2 = spawnBridge(server.socketPath, 'tu-conc-2', 'Bash', {})

      await vi.waitFor(() => expect(emit).toHaveBeenCalledTimes(2), { timeout: 3000 })

      resolveApproval('tu-conc-2', { kind: 'deny' })
      resolveApproval('tu-conc-1', { kind: 'allow' })

      const [r1, r2] = await Promise.all([b1, b2])
      expect(r1.exitCode).toBe(0)
      expect(r2.exitCode).toBe(2)
    } finally {
      await server.close()
    }
  })
})
