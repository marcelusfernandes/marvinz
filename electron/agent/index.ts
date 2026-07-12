// Agent spawn lifecycle, child map, and request router.
// Supports Claude (--output-format stream-json NDJSON) and
// Codex (codex exec --json, one-shot per turn) providers.

import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { homedir } from 'node:os'
import { NdjsonStream } from './ndjson.js'
import { adaptClaudeObj, makeAdapterState, type AdapterState } from './adapter-claude.js'
import { adaptCodexObj, makeCodexAdapterState, type CodexAdapterState } from './adapter-codex.js'
import { clearSessionRules, resolveApproval, cancelPendingApprovals } from './permissions.js'
import { createApprovalServer, type ApprovalServer, type PreEditState } from './approval-socket.js'
import { diffTouchedFiles } from './turn-content-gate.js'
import { collectProcessTree, signalPids } from '../proc-group.js'
import { newTurnId } from '../snapshot.js'
import type { AgentEvent, AgentRequest, Provider, PermissionMode } from './protocol.js'
import type { AgentAdapter, AgentBinaries } from './adapter.js'

export type { AgentBinaries } from './adapter.js'

export type AgentChild = {
  sessionId: string
  provider: Provider
  permissionMode: PermissionMode
  vaultRoot: string
  proc: ChildProcess
  adapterState: AdapterState | CodexAdapterState
  startedAt: number
  // Unix domain socket server for the --permission-prompt-tool hook bridge.
  approvalServer: ApprovalServer | null
  // toolUseIds currently awaiting approval (for cancellation on kill/cancel)
  pendingApprovalIds: Set<string>
  // maps toolUseId → toolName; owned by approval-socket.ts connection handlers
  pendingToolNames: Map<string, string>
  // text-delta coalescing ring buffer keyed by messageId
  deltaBuffers: Map<string, string[]>
  flushTimer: ReturnType<typeof setTimeout> | null
  // Mutable ref to the current agent turn ID, shared with approval-socket for snapshot tagging.
  agentTurnId: { current: string }
  // Files touched (by approved file-edit tool calls) in the current turn, for turn-snapshot-summary.
  touchedFiles: Set<string>
  // Snapshot result promises keyed by toolUseId — populated by approval-socket, consumed by dispatchEvent.
  snapshotResults: Map<string, Promise<{ saved: boolean; turnId: string }>>
  // Pre-edit content state per touched file, for the post-turn content-change gate (#537).
  preEditStates: Map<string, PreEditState>
}

// Emitter callback: main.ts passes win.webContents.send bound to the window.
export type EventEmitter = (channel: string, payload: AgentEvent) => void

const SIGTERM_GRACE_MS = 3_000
const FLUSH_INTERVAL_MS = 16

const agentChildren = new Map<string, AgentChild>()

function logsDir(): string {
  return path.join(homedir(), '.marvin', 'logs')
}

async function writeAgentLog(sessionId: string, line: string): Promise<void> {
  try {
    const dir = logsDir()
    await fs.mkdir(dir, { recursive: true })
    const logPath = path.join(dir, `agent-${sessionId}.log`)
    await fs.appendFile(logPath, line + '\n', 'utf8')
  } catch {
    // log write failure must not crash the process
  }
}

function waitForExit(proc: ChildProcess, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs)
    proc.once('exit', () => {
      clearTimeout(timer)
      resolve(true)
    })
  })
}

async function killAgent(child: AgentChild): Promise<void> {
  // Capture the whole subtree up front (CLI + grandchildren — MCP servers,
  // app-servers, sub-shells, which may live in their own process groups), then
  // SIGTERM it, wait for the CLI to exit, and SIGKILL-sweep the captured set so
  // nothing that ignored SIGTERM is left orphaned.
  const tree = child.proc.pid != null ? collectProcessTree(child.proc.pid) : []
  signalPids(tree, 'SIGTERM')
  await waitForExit(child.proc, SIGTERM_GRACE_MS)
  signalPids(tree, 'SIGKILL')
}

// Resolve the hook bridge script path.
// Dev/unpackaged: dist-electron/pretooluse-bridge.cjs (copied by vite.config.ts).
// Packaged (ASAR): bridge must be in asarUnpack in electron-builder config so it
//   lands at app.asar.unpacked/electron/agent/hooks/pretooluse-bridge.cjs and can
//   be executed directly by Node (scripts inside asar are not executable).
//   TODO: add `asarUnpack: ["electron/agent/hooks/pretooluse-bridge.cjs"]` to
//   electron-builder config when packaging is wired.
function resolveBridgePath(): string | null {
  const candidates = [
    // Dev + unpackaged prod: vite copies bridge alongside main.cjs
    path.join(__dirname, 'pretooluse-bridge.cjs'),
    // Packaged — script must be in asarUnpack so it is executable
    path.join(
      process.resourcesPath ?? '',
      'app.asar.unpacked',
      'electron',
      'agent',
      'hooks',
      'pretooluse-bridge.cjs'
    ),
  ]
  return candidates.find(existsSync) ?? null
}

// Build the --settings JSON value for hook injection.
// Returns null if the bridge script is not present (graceful degradation).
function buildHookSettings(bridgePath: string): string {
  const settings = {
    hooks: {
      PreToolUse: [
        {
          matcher: '*',
          hooks: [
            {
              type: 'command',
              command: bridgePath,
              // 310s = 300s approval timeout + 10s margin for socket round-trip.
              timeout: 310,
            },
          ],
        },
      ],
    },
  }
  return JSON.stringify(settings)
}

function buildClaudeArgs(req: Extract<AgentRequest, { type: 'start' }>): string[] {
  const args: string[] = [
    '--output-format',
    'stream-json',
    '--input-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--include-hook-events',
  ]

  if (req.resumeFromSessionId) {
    args.push('--resume', req.resumeFromSessionId)
  }

  if (req.model) {
    args.push('--model', req.model)
  }

  const permissionFlag: Record<PermissionMode, string> = {
    default: 'default',
    acceptEdits: 'acceptEdits',
    plan: 'plan',
    auto: 'default',
  }
  args.push('--permission-mode', permissionFlag[req.permissionMode])

  // Inject PreToolUse hook via --settings if the bridge script is present.
  const bridgePath = resolveBridgePath()
  if (bridgePath) {
    args.push('--settings', buildHookSettings(bridgePath))
  }

  // Prompt is passed via stdin (stream-json input format) rather than as a CLI arg.
  // The caller writes the initial prompt to proc.stdin after spawn.
  return args
}

function buildCodexArgs(req: Extract<AgentRequest, { type: 'start' }>): string[] {
  // codex exec is non-interactive, one-shot per turn.
  // Prompt is passed as a positional argument; no stdin writes needed.
  // --skip-git-repo-check allows running in vault dirs that aren't git repos
  // (Marvin vaults are notes directories, not necessarily git-tracked).
  return ['exec', '--json', '--skip-git-repo-check', req.prompt]
}

function flushDeltaBuffers(child: AgentChild, emit: EventEmitter): void {
  child.flushTimer = null
  for (const [messageId, deltas] of child.deltaBuffers) {
    if (!deltas.length) continue
    const coalesced = deltas.join('')
    child.deltaBuffers.delete(messageId)
    const seq = child.adapterState.seq++
    const event: AgentEvent = {
      type: 'text-delta',
      sessionId: child.sessionId,
      messageId,
      delta: coalesced,
      seq,
    }
    emit(`agent:event:${child.sessionId}`, event)
  }
}

function scheduleFlush(child: AgentChild, emit: EventEmitter): void {
  if (child.flushTimer !== null) return
  child.flushTimer = setTimeout(() => flushDeltaBuffers(child, emit), FLUSH_INTERVAL_MS)
}

function dispatchEvent(child: AgentChild, event: AgentEvent, emit: EventEmitter): void {
  // Coalesce text-delta events; forward everything else immediately.
  if (event.type === 'text-delta') {
    let buf = child.deltaBuffers.get(event.messageId)
    if (!buf) {
      buf = []
      child.deltaBuffers.set(event.messageId, buf)
    }
    buf.push(event.delta)
    scheduleFlush(child, emit)
    return
  }

  // Flush any pending text-deltas before ordering-sensitive events.
  if (
    event.type === 'tool-use' ||
    event.type === 'message-end' ||
    event.type === 'turn-result' ||
    event.type === 'permission-request' ||
    event.type === 'error' ||
    event.type === 'crashed'
  ) {
    if (child.flushTimer !== null) {
      clearTimeout(child.flushTimer)
      flushDeltaBuffers(child, emit)
    }
  }

  // For file-edit tool-use events, augment with snapshotSaved + snapshotTurnId.
  // The snapshot promise is set by approval-socket before the hook responds, so it should
  // be settled by the time the NDJSON tool-use event arrives. Await it and defer the emit.
  if (event.type === 'tool-use') {
    const snapPromise = child.snapshotResults.get(event.toolUseId)
    if (snapPromise) {
      child.snapshotResults.delete(event.toolUseId)
      void snapPromise.then((snap) => {
        emit(`agent:event:${child.sessionId}`, {
          ...event,
          snapshotSaved: snap.saved,
          snapshotTurnId: snap.turnId,
        })
      })
      return
    }
  }

  emit(`agent:event:${child.sessionId}`, event)

  // After turn-result: snapshot touchedFiles/preEditStates and reset them
  // synchronously so this turn's diff can't race the next turn's edits, then
  // diff the just-finished turn's touched files against their pre-edit state
  // and emit turn-snapshot-summary only for the files that really changed on
  // disk (#537). The disk reads are async, so this happens without delaying
  // turn-result or any other event above.
  // Note: touchedFiles is populated synchronously (on approval), so this
  // reset cleanly separates turn N from turn N+1 for it. preEditStates is
  // filled by a fire-and-forget promise in approval-socket.ts that can in
  // principle still be resolving when this reset runs, so in rare races a
  // turn-N baseline could land in turn N+1's map (or first-write-wins could
  // reflect promise-resolution order rather than edit order) — no worse than
  // today's behavior, and not hardened here.
  if (event.type === 'turn-result' && child.touchedFiles.size > 0) {
    const turnId = child.agentTurnId.current
    const turnFiles = [...child.touchedFiles]
    const turnPreEditStates = new Map(child.preEditStates)
    const vaultRoot = child.vaultRoot

    child.touchedFiles.clear()
    child.preEditStates.clear()
    child.agentTurnId.current = newTurnId()

    void diffTouchedFiles(vaultRoot, turnFiles, turnPreEditStates).then((fileNames) => {
      if (fileNames.length === 0) return
      emit(`agent:event:${child.sessionId}`, {
        type: 'turn-snapshot-summary',
        sessionId: child.sessionId,
        turnId,
        fileCount: fileNames.length,
        fileNames,
      })
    })
  }
}

// Concrete per-provider adapters — wrap the existing buildClaudeArgs/
// buildCodexArgs and adaptClaudeObj/adaptCodexObj unchanged; the interface
// just groups them with the other per-provider concerns spawnAgent used to
// branch on inline (#582). Live here rather than in adapter.ts to avoid a
// circular import (they call the arg-builders defined above).
const claudeAdapter: AgentAdapter = {
  makeState(sessionId, req) {
    const state = makeAdapterState(sessionId)
    state.cwd = req.vaultRoot
    return state
  },
  resolveBinary(bins) {
    return bins.claude
  },
  buildArgs(req) {
    return buildClaudeArgs(req)
  },
  usesApprovalSocket: true,
  handleStdin(proc, req) {
    // Prompt is sent as a stream-json input event on stdin.
    if (!proc.stdin) return
    const inputEvent =
      JSON.stringify({
        type: 'user',
        message: { role: 'user', content: req.prompt },
      }) + '\n'
    proc.stdin.write(inputEvent)
    proc.stdin.end()
  },
  adaptObj(obj, state) {
    return adaptClaudeObj(obj, state as AdapterState)
  },
}

const codexAdapter: AgentAdapter = {
  makeState(sessionId) {
    return makeCodexAdapterState(sessionId)
  },
  resolveBinary(bins) {
    return bins.codex ?? 'codex'
  },
  buildArgs(req) {
    return buildCodexArgs(req)
  },
  usesApprovalSocket: false,
  handleStdin(proc) {
    // Prompt is passed as argv to `codex exec --json` — no stdin writes needed.
    if (!proc.stdin) return
    proc.stdin.end()
  },
  adaptObj(obj, state) {
    return adaptCodexObj(obj, state as CodexAdapterState)
  },
}

// Record (not a plain object) so adding a Provider union member without a
// matching entry here fails the TypeScript build — the compiler-enforced
// checklist the AC asks for.
export const adapters: Record<Provider, AgentAdapter> = {
  claude: claudeAdapter,
  codex: codexAdapter,
}

export async function spawnAgent(
  req: Extract<AgentRequest, { type: 'start' }>,
  binaries: AgentBinaries | string,
  emit: EventEmitter
): Promise<void> {
  // Accept legacy string form (claudeBinary) for backward compatibility.
  const bins: AgentBinaries = typeof binaries === 'string' ? { claude: binaries } : binaries

  const existing = agentChildren.get(req.sessionId)
  if (existing) {
    await killAgent(existing)
    agentChildren.delete(req.sessionId)
  }

  const adapter = adapters[req.provider]
  const adapterState = adapter.makeState(req.sessionId, req)

  const binary = adapter.resolveBinary(bins)
  const args = adapter.buildArgs(req)

  // Create approval socket server before spawning so the env var is ready.
  // Codex does not use the hook bridge — skip for Codex sessions.
  const pendingApprovalIds = new Set<string>()
  const pendingToolNames = new Map<string, string>()
  const agentTurnId = { current: newTurnId() }
  const touchedFiles = new Set<string>()
  const snapshotResults = new Map<string, Promise<{ saved: boolean; turnId: string }>>()
  const preEditStates = new Map<string, PreEditState>()

  let approvalServer: ApprovalServer | null = null
  if (adapter.usesApprovalSocket) {
    approvalServer = await createApprovalServer(
      req.sessionId,
      { sessionId: req.sessionId, permissionMode: req.permissionMode, vaultRoot: req.vaultRoot },
      pendingApprovalIds,
      pendingToolNames,
      emit,
      agentTurnId,
      touchedFiles,
      snapshotResults,
      preEditStates
    )
  }

  let proc: ChildProcess
  try {
    proc = spawn(binary, args, {
      cwd: req.vaultRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        TERM: 'dumb',
        ...(approvalServer ? { MARVIN_APPROVAL_SOCKET: approvalServer.socketPath } : {}),
      },
    })
  } catch (err) {
    await approvalServer?.close()
    const message = err instanceof Error ? err.message : String(err)
    if (message.includes('ENOENT')) {
      emit(`agent:event:${req.sessionId}`, {
        type: 'error',
        sessionId: req.sessionId,
        code: 'AGENT_NOT_FOUND',
        message: `${req.provider} binary not found`,
        recoverable: false,
      })
      return
    }
    throw err
  }

  const child: AgentChild = {
    sessionId: req.sessionId,
    provider: req.provider,
    permissionMode: req.permissionMode,
    vaultRoot: req.vaultRoot,
    proc,
    adapterState,
    startedAt: Date.now(),
    approvalServer,
    pendingApprovalIds,
    pendingToolNames,
    deltaBuffers: new Map(),
    flushTimer: null,
    agentTurnId,
    touchedFiles,
    snapshotResults,
    preEditStates,
  }
  agentChildren.set(req.sessionId, child)

  let malformedCount = 0

  const ndjson = new NdjsonStream(
    (obj) => {
      malformedCount = 0

      const events = adapter.adaptObj(obj, adapterState)
      for (const event of events) {
        // tool-use events are forwarded as-is; the approval socket server is the
        // real gate. The hook bridge blocks the CLI until a decision is sent back.
        dispatchEvent(child, event, emit)
      }
    },
    async (line, err) => {
      malformedCount++
      await writeAgentLog(req.sessionId, `[MALFORMED] ${err.message}: ${line.slice(0, 200)}`)
      if (malformedCount < 3) {
        emit(`agent:event:${req.sessionId}`, {
          type: 'error',
          sessionId: req.sessionId,
          code: 'AGENT_INVALID_STREAM',
          message: `Malformed stream line: ${err.message}`,
          recoverable: true,
        })
      }
    },
    async (err) => {
      await writeAgentLog(req.sessionId, `[FATAL] ${err.message}`)
      if (child.flushTimer !== null) {
        clearTimeout(child.flushTimer)
        flushDeltaBuffers(child, emit)
      }
      emit(`agent:event:${req.sessionId}`, {
        type: 'crashed',
        sessionId: req.sessionId,
        exitCode: null,
        signal: null,
      })
      agentChildren.delete(req.sessionId)
    }
  )

  // Hand stdin off to the provider adapter — Codex passes the prompt as argv
  // and just closes stdin; Claude writes the stream-json prompt event first.
  adapter.handleStdin(proc, req)

  const stderrChunks: Buffer[] = []

  proc.stdout?.on('data', (chunk: Buffer) => ndjson.push(chunk))
  proc.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(chunk))

  proc.on('close', async (code, signal) => {
    ndjson.end()

    if (child.flushTimer !== null) {
      clearTimeout(child.flushTimer)
      flushDeltaBuffers(child, emit)
    }

    if (stderrChunks.length) {
      const stderr = Buffer.concat(stderrChunks).toString('utf8').trim()
      if (stderr) {
        await writeAgentLog(req.sessionId, `[STDERR] ${stderr}`)
      }
    }

    cancelPendingApprovals([...child.pendingApprovalIds])
    agentChildren.delete(req.sessionId)
    clearSessionRules(req.sessionId)
    void child.approvalServer?.close()

    if (code !== 0 && code !== null) {
      emit(`agent:event:${req.sessionId}`, {
        type: 'crashed',
        sessionId: req.sessionId,
        exitCode: code,
        signal: signal as NodeJS.Signals | null,
      })
    }
  })
}

export async function cancelAgent(sessionId: string): Promise<void> {
  const child = agentChildren.get(sessionId)
  if (!child) return
  cancelPendingApprovals([...child.pendingApprovalIds])
  const tree = child.proc.pid != null ? collectProcessTree(child.proc.pid) : []
  signalPids(tree, 'SIGINT')
  await waitForExit(child.proc, SIGTERM_GRACE_MS)
  signalPids(tree, 'SIGKILL')
}

export async function killAgentSession(sessionId: string): Promise<void> {
  const child = agentChildren.get(sessionId)
  if (!child) return
  agentChildren.delete(sessionId)
  clearSessionRules(sessionId)
  cancelPendingApprovals([...child.pendingApprovalIds])
  await Promise.all([killAgent(child), child.approvalServer?.close()])
}

export function handleApproval(
  _sessionId: string,
  toolUseId: string,
  decision: Extract<AgentRequest, { type: 'approval' }>['decision']
): void {
  // Resolves the pending approval in approval-socket.ts so the hook connection
  // can respond to the CLI. No-op if already timed out or unknown toolUseId.
  resolveApproval(toolUseId, decision)
}

export async function killAllAgents(): Promise<void> {
  const children = [...agentChildren.values()]
  agentChildren.clear()
  await Promise.allSettled(children.map(killAgent))
}
