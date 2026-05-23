// Unix domain socket server for the --permission-prompt-tool hook bridge.
// The hook script connects here for each tool call, sends tool info as JSON,
// and waits for an allow/deny response before the CLI proceeds.
//
// Protocol (both directions: newline-terminated JSON):
//   Hook → Main: { toolUseId: string, toolName: string, input: unknown }
//   Main → Hook: { decision: 'allow' | 'deny', reason?: string }

import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import {
  evaluatePermission,
  classifyToolRisk,
  awaitApproval,
  recordDecision,
  APPROVAL_TIMEOUT_MS,
  type PermissionContext,
} from './permissions.js'
import { writeSnapshot } from '../snapshot.js'
import type { AgentEvent, ApprovalDecision } from './protocol.js'

export type SocketEmitter = (channel: string, payload: AgentEvent) => void

export function approvalSocketPath(sessionId: string): string {
  return path.join(os.tmpdir(), `marvin-approval-${sessionId}.sock`)
}

type HookMessage = {
  toolUseId: string
  toolName: string
  input: unknown
}

type HookResponse = {
  decision: 'allow' | 'deny'
  reason?: string
}

function parseHookMessage(raw: string): HookMessage | null {
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>
    if (
      typeof obj.toolUseId === 'string' && obj.toolUseId &&
      typeof obj.toolName === 'string' && obj.toolName
    ) {
      return { toolUseId: obj.toolUseId, toolName: obj.toolName, input: obj.input }
    }
  } catch {
    // malformed — ignore
  }
  return null
}

// Tools that edit files and warrant a pre-edit snapshot.
const SNAPSHOT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit'])

/** Returns true if the named tool should trigger a pre-edit snapshot. */
export function shouldTriggerSnapshot(toolName: string): boolean {
  return SNAPSHOT_TOOLS.has(toolName)
}

function extractFilePath(input: unknown): string | null {
  if (!input || typeof input !== 'object') return null
  const obj = input as Record<string, unknown>
  for (const key of ['file_path', 'notebook_path', 'path']) {
    const val = obj[key]
    if (typeof val === 'string' && val) return val
  }
  return null
}

// Take a pre-edit snapshot of the file before it is modified.
// Returns true if snapshot was saved, false on failure or skip.
// Non-blocking: logs on failure but never throws.
async function snapshotBeforeEdit(
  vaultRoot: string,
  turnId: string,
  _toolUseId: string,
  toolName: string,
  input: unknown,
  sessionId: string,
  _emit: SocketEmitter,
): Promise<boolean> {
  const rawPath = extractFilePath(input)
  if (!rawPath) return false

  const absPath = path.isAbsolute(rawPath) ? rawPath : path.resolve(vaultRoot, rawPath)
  const relPath = path.relative(vaultRoot, absPath)

  // Guard: only snapshot files inside the vault.
  if (relPath.startsWith('..') || path.isAbsolute(relPath)) return false

  // Read the current file content; use empty string for new files (Write creates them).
  let content: string
  try {
    content = await fs.readFile(absPath, 'utf8')
  } catch {
    content = ''
  }

  try {
    const saved = await writeSnapshot(vaultRoot, turnId, relPath, content, 'file:write', sessionId)
    if (saved === false) {
      // Binary/oversized — still report failure but don't emit yet; caller emits warning after permission-request.
      return false
    }
    return true
  } catch (err) {
    console.error('[snapshot] pre-edit snapshot failed', { toolName, relPath, turnId, err })
    return false
  }
}

// Handle a single hook connection: read one JSON message, evaluate, respond.
async function handleConnection(
  socket: net.Socket,
  ctx: Omit<PermissionContext, 'toolUseId' | 'toolName' | 'input'>,
  pendingApprovalIds: Set<string>,
  pendingToolNames: Map<string, string>,
  emit: SocketEmitter,
  sessionId: string,
  agentTurnId: { current: string },
  touchedFiles: Set<string>,
  snapshotResults: Map<string, Promise<{ saved: boolean; turnId: string }>>,
): Promise<void> {
  let buf = ''

  await new Promise<void>((resolve) => {
    socket.setEncoding('utf8')

    socket.on('data', (chunk: string) => {
      buf += chunk
      const nl = buf.indexOf('\n')
      if (nl < 0) return
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)

      const msg = parseHookMessage(line)
      if (!msg) {
        socket.write(JSON.stringify({ decision: 'deny', reason: 'AGENT_INVALID_HOOK_MESSAGE' }) + '\n')
        socket.end()
        resolve()
        return
      }

      const isFileEditTool = SNAPSHOT_TOOLS.has(msg.toolName)
      const snapshotTurnId = agentTurnId.current

      // Snapshot BEFORE permission evaluation so even denied edits have a prior-state record.
      const snapshotPromise: Promise<boolean> = isFileEditTool
        ? snapshotBeforeEdit(
            ctx.vaultRoot,
            snapshotTurnId,
            msg.toolUseId,
            msg.toolName,
            msg.input,
            sessionId,
            emit,
          )
        : Promise.resolve(false)

      // Store the snapshot promise so dispatchEvent can augment the tool-use event.
      if (isFileEditTool) {
        snapshotResults.set(
          msg.toolUseId,
          snapshotPromise.then((saved) => ({ saved, turnId: snapshotTurnId })),
        )
      }

      // Track touched file for turn-snapshot-summary (fire-and-forget; resolved later).
      if (isFileEditTool) {
        const rawPath = extractFilePath(msg.input)
        if (rawPath) {
          const absPath = path.isAbsolute(rawPath) ? rawPath : path.resolve(ctx.vaultRoot, rawPath)
          const relPath = path.relative(ctx.vaultRoot, absPath)
          if (!relPath.startsWith('..') && !path.isAbsolute(relPath)) {
            touchedFiles.add(relPath)
          }
        }
      }

      const fullCtx: PermissionContext = { ...ctx, ...msg }
      const result = evaluatePermission(fullCtx)

      if (result.action === 'allow') {
        const resp: HookResponse = { decision: 'allow' }
        socket.write(JSON.stringify(resp) + '\n')
        socket.end()
        resolve()
        return
      }

      if (result.action === 'deny') {
        const resp: HookResponse = { decision: 'deny', reason: result.reason }
        socket.write(JSON.stringify(resp) + '\n')
        socket.end()
        resolve()
        return
      }

      // action === 'request': wait for snapshot result, then emit permission-request with snapshotSaved.
      pendingApprovalIds.add(msg.toolUseId)
      pendingToolNames.set(msg.toolUseId, msg.toolName)

      const risk = classifyToolRisk(msg.toolName)

      // snapshotBeforeEdit always resolves (never rejects — errors are caught internally).
      snapshotPromise.then((snapshotSaved) => {
        const permReq: AgentEvent = {
          type: 'permission-request',
          sessionId,
          toolUseId: msg.toolUseId,
          toolName: msg.toolName,
          input: msg.input,
          risk,
          suggestion: risk === 'safe' ? 'allow' : 'review',
          timeoutMs: APPROVAL_TIMEOUT_MS,
          ...(isFileEditTool ? { snapshotSaved } : {}),
        }
        emit(`agent:event:${sessionId}`, permReq)

        // Emit snapshot-warning AFTER permission-request so event ordering is predictable.
        if (isFileEditTool && !snapshotSaved) {
          const rawPath = extractFilePath(msg.input)
          emit(`agent:event:${sessionId}`, {
            type: 'snapshot-warning',
            sessionId,
            toolUseId: msg.toolUseId,
            filePath: rawPath ? path.relative(ctx.vaultRoot, path.isAbsolute(rawPath) ? rawPath : path.resolve(ctx.vaultRoot, rawPath)) : '',
            reason: 'Snapshot failed or skipped',
          })
        }
      }).catch(() => {
        // snapshotBeforeEdit shouldn't reject, but guard defensively.
        const permReq: AgentEvent = {
          type: 'permission-request',
          sessionId,
          toolUseId: msg.toolUseId,
          toolName: msg.toolName,
          input: msg.input,
          risk,
          suggestion: risk === 'safe' ? 'allow' : 'review',
          timeoutMs: APPROVAL_TIMEOUT_MS,
          ...(isFileEditTool ? { snapshotSaved: false } : {}),
        }
        emit(`agent:event:${sessionId}`, permReq)
      })

      // Await the renderer decision (resolveApproval resolves this promise).
      awaitApproval(msg.toolUseId).then(
        (decision: ApprovalDecision) => {
          pendingApprovalIds.delete(msg.toolUseId)
          const toolName = pendingToolNames.get(msg.toolUseId)
          pendingToolNames.delete(msg.toolUseId)

          if (toolName) recordDecision(sessionId, toolName, decision)

          const resp: HookResponse = decision.kind === 'deny'
            ? { decision: 'deny', reason: 'User denied execution' }
            : { decision: 'allow' }
          socket.write(JSON.stringify(resp) + '\n')
          socket.end()
          resolve()
        },
        (err: Error) => {
          pendingApprovalIds.delete(msg.toolUseId)
          pendingToolNames.delete(msg.toolUseId)

          // Timeout: deny and let the hook bridge handle SIGINT from the timeout error event.
          const resp: HookResponse = { decision: 'deny', reason: err.message }
          socket.write(JSON.stringify(resp) + '\n')
          socket.end()

          emit(`agent:event:${sessionId}`, {
            type: 'error',
            sessionId,
            code: 'AGENT_PERMISSION_TIMEOUT',
            message: 'Approval timed out after 5 minutes',
            recoverable: false,
          })
          resolve()
        },
      )
    })

    socket.on('error', () => resolve())
    socket.on('close', () => resolve())
  })
}

export type ApprovalServer = {
  server: net.Server
  socketPath: string
  close: () => Promise<void>
}

export async function createApprovalServer(
  sessionId: string,
  ctx: Omit<PermissionContext, 'toolUseId' | 'toolName' | 'input'>,
  pendingApprovalIds: Set<string>,
  pendingToolNames: Map<string, string>,
  emit: SocketEmitter,
  agentTurnId: { current: string } = { current: '' },
  touchedFiles: Set<string> = new Set(),
  snapshotResults: Map<string, Promise<{ saved: boolean; turnId: string }>> = new Map(),
): Promise<ApprovalServer> {
  const socketPath = approvalSocketPath(sessionId)

  // Remove stale socket from a previous crash, if any.
  try { await fs.unlink(socketPath) } catch { /* not present — fine */ }

  const server = net.createServer((socket) => {
    void handleConnection(socket, ctx, pendingApprovalIds, pendingToolNames, emit, sessionId, agentTurnId, touchedFiles, snapshotResults)
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(socketPath, resolve)
  })

  // Restrict socket to owner-only so only the spawned agent process (same uid)
  // can connect. Must be set after listen() creates the file.
  await fs.chmod(socketPath, 0o600)

  const close = async (): Promise<void> => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    try { await fs.unlink(socketPath) } catch { /* already gone */ }
  }

  return { server, socketPath, close }
}
