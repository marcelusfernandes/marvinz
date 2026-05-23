// Agent spawn lifecycle, child map, and request router.
// Analogous to ptyProcesses + pty:spawn in electron/main.ts, but for
// `claude --output-format stream-json` piped child processes.

import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { homedir } from 'node:os'
import { NdjsonStream } from './ndjson.js'
import { adaptClaudeObj, makeAdapterState, type AdapterState } from './adapter-claude.js'
import { evaluatePermission, recordDecision, clearSessionRules } from './permissions.js'
import type { AgentEvent, AgentRequest, Provider, PermissionMode } from './protocol.js'

export type AgentChild = {
  sessionId: string
  provider: Provider
  permissionMode: PermissionMode
  vaultRoot: string
  proc: ChildProcess
  adapterState: AdapterState
  startedAt: number
  // pending approval callbacks keyed by toolUseId
  pendingApprovals: Map<string, (decision: AgentEvent) => void>
  // maps toolUseId → toolName so handleApproval can key recordDecision by toolName
  pendingToolNames: Map<string, string>
  // text-delta coalescing ring buffer keyed by messageId
  deltaBuffers: Map<string, string[]>
  flushTimer: ReturnType<typeof setImmediate> | null
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
  child.proc.kill('SIGTERM')
  const dead = await waitForExit(child.proc, SIGTERM_GRACE_MS)
  if (!dead) child.proc.kill('SIGKILL')
}

function buildClaudeArgs(req: Extract<AgentRequest, { type: 'start' }>): string[] {
  const args: string[] = [
    '--output-format', 'stream-json',
    '--input-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
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
    auto: 'bypassPermissions',
  }
  args.push('--permission-mode', permissionFlag[req.permissionMode])

  // Prompt is passed via stdin (stream-json input format) rather than as a CLI arg.
  // The caller writes the initial prompt to proc.stdin after spawn.
  return args
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
  child.flushTimer = setImmediate(() => {
    // setImmediate fires after I/O but we want ~16ms batching; wrap in setTimeout.
    setTimeout(() => flushDeltaBuffers(child, emit), FLUSH_INTERVAL_MS)
  })
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
      clearImmediate(child.flushTimer)
      flushDeltaBuffers(child, emit)
    }
  }

  emit(`agent:event:${child.sessionId}`, event)
}

export async function spawnAgent(
  req: Extract<AgentRequest, { type: 'start' }>,
  claudeBinary: string,
  emit: EventEmitter,
): Promise<void> {
  const existing = agentChildren.get(req.sessionId)
  if (existing) {
    await killAgent(existing)
    agentChildren.delete(req.sessionId)
  }

  const adapterState = makeAdapterState(req.sessionId)
  adapterState.cwd = req.vaultRoot

  const args = buildClaudeArgs(req)

  let proc: ChildProcess
  try {
    proc = spawn(claudeBinary, args, {
      cwd: req.vaultRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, TERM: 'dumb' },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message.includes('ENOENT')) {
      emit(`agent:event:${req.sessionId}`, {
        type: 'error',
        sessionId: req.sessionId,
        code: 'AGENT_NOT_FOUND',
        message: 'claude binary not found',
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
    pendingApprovals: new Map(),
    pendingToolNames: new Map(),
    deltaBuffers: new Map(),
    flushTimer: null,
  }
  agentChildren.set(req.sessionId, child)

  let malformedCount = 0
  let streamEnded = false

  const ndjson = new NdjsonStream(
    (obj) => {
      malformedCount = 0
      const events = adaptClaudeObj(obj, adapterState)
      for (const event of events) {
        if (event.type === 'tool-use') {
          // Evaluate permissions before forwarding to renderer.
          const result = evaluatePermission({
            sessionId: req.sessionId,
            toolUseId: event.toolUseId,
            toolName: event.name,
            input: event.input,
            permissionMode: req.permissionMode,
            vaultRoot: req.vaultRoot,
          })
          if (result.action === 'allow') {
            dispatchEvent(child, event, emit)
          } else if (result.action === 'deny') {
            // Synthesize a denial tool-result so the CLI can continue.
            dispatchEvent(child, event, emit)
            const denial: AgentEvent = {
              type: 'tool-result',
              sessionId: req.sessionId,
              toolUseId: event.toolUseId,
              output: `Denied: ${result.reason}`,
              isError: true,
              durationMs: 0,
            }
            dispatchEvent(child, denial, emit)
          } else {
            // Request user approval — record toolName for handleApproval lookup,
            // then emit tool-use and permission-request.
            child.pendingToolNames.set(event.toolUseId, event.name)
            dispatchEvent(child, event, emit)
            const permReq: AgentEvent = {
              type: 'permission-request',
              sessionId: req.sessionId,
              toolUseId: event.toolUseId,
              toolName: event.name,
              input: event.input,
              risk: 'safe',
              suggestion: 'review',
            }
            dispatchEvent(child, permReq, emit)
          }
        } else {
          dispatchEvent(child, event, emit)
        }
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
        clearImmediate(child.flushTimer)
        flushDeltaBuffers(child, emit)
      }
      emit(`agent:event:${req.sessionId}`, {
        type: 'crashed',
        sessionId: req.sessionId,
        exitCode: null,
        signal: null,
      })
      agentChildren.delete(req.sessionId)
    },
  )

  // Send the initial prompt as a stream-json input event on stdin.
  if (proc.stdin) {
    const inputEvent =
      JSON.stringify({
        type: 'user',
        message: { role: 'user', content: req.prompt },
      }) + '\n'
    proc.stdin.write(inputEvent)
    proc.stdin.end()
  }

  const stderrChunks: Buffer[] = []

  proc.stdout?.on('data', (chunk: Buffer) => ndjson.push(chunk))
  proc.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(chunk))

  proc.on('close', async (code, signal) => {
    ndjson.end()

    if (child.flushTimer !== null) {
      clearImmediate(child.flushTimer)
      flushDeltaBuffers(child, emit)
    }

    if (stderrChunks.length) {
      const stderr = Buffer.concat(stderrChunks).toString('utf8').trim()
      if (stderr) {
        await writeAgentLog(req.sessionId, `[STDERR] ${stderr}`)
      }
    }

    streamEnded = true
    agentChildren.delete(req.sessionId)
    clearSessionRules(req.sessionId)

    if (code !== 0 && code !== null) {
      emit(`agent:event:${req.sessionId}`, {
        type: 'crashed',
        sessionId: req.sessionId,
        exitCode: code,
        signal: signal as NodeJS.Signals | null,
      })
    }
  })

  void streamEnded // used only to satisfy the closure
}

export async function cancelAgent(sessionId: string): Promise<void> {
  const child = agentChildren.get(sessionId)
  if (!child) return
  child.proc.kill('SIGINT')
}

export async function killAgentSession(sessionId: string): Promise<void> {
  const child = agentChildren.get(sessionId)
  if (!child) return
  agentChildren.delete(sessionId)
  clearSessionRules(sessionId)
  await killAgent(child)
}

export function handleApproval(
  sessionId: string,
  toolUseId: string,
  decision: Extract<AgentRequest, { type: 'approval' }>['decision'],
  emit: EventEmitter,
): void {
  const child = agentChildren.get(sessionId)
  if (!child) return

  const toolName = child.pendingToolNames.get(toolUseId)
  child.pendingToolNames.delete(toolUseId)

  if (toolName) {
    if (decision.kind === 'allow' && decision.remember) {
      recordDecision(sessionId, toolName, decision)
    } else if (decision.kind === 'deny') {
      recordDecision(sessionId, toolName, decision)
    }
  }

  // Emit tool-result back to renderer so the UI can update.
  const toolResult: AgentEvent = {
    type: 'tool-result',
    sessionId,
    toolUseId,
    output: decision.kind === 'deny' ? `Denied: ${decision.reason ?? ''}` : null,
    isError: decision.kind === 'deny',
    durationMs: 0,
  }
  emit(`agent:event:${sessionId}`, toolResult)
}

export async function killAllAgents(): Promise<void> {
  const children = [...agentChildren.values()]
  agentChildren.clear()
  await Promise.allSettled(children.map(killAgent))
}
