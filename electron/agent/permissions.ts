// PreToolUse hook handler — Sprint 3.
// evaluatePermission() is a fast synchronous check; awaitApproval() is the
// async path that suspends until the renderer sends back a decision (or times out).

import path from 'node:path'
import type { ApprovalDecision, PermissionMode } from './protocol.js'
import { assertInsideVault } from '../vault-boundary.js'

export type PermissionContext = {
  sessionId: string
  toolUseId: string
  toolName: string
  input: unknown
  permissionMode: PermissionMode
  vaultRoot: string
}

export type PermissionResult =
  | { action: 'allow' }
  | { action: 'deny'; reason: string }
  | { action: 'request' }

export const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes

// Tools that write or mutate files/system state.
const WRITE_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit', 'Bash'])

// Tools that are allowed in acceptEdits mode (file-edit family only).
const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit'])

// Per-session remembered decisions (in-memory only; cleared when session ends).
const _sessionRules = new Map<string, Map<string, ApprovalDecision>>()

// Pending approval Promises keyed by toolUseId.
type PendingApproval = {
  resolve: (decision: ApprovalDecision) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}
const _pendingApprovals = new Map<string, PendingApproval>()

export function getSessionRules(sessionId: string): ReadonlyMap<string, ApprovalDecision> {
  return _sessionRules.get(sessionId) ?? new Map()
}

export function clearSessionRules(sessionId: string): void {
  _sessionRules.delete(sessionId)
}

// M2: classify tool risk for the permission-request hint.
// Conservative: unknown tools default to 'destructive'.
export function classifyToolRisk(toolName: string): 'safe' | 'destructive' | 'network' {
  if (new Set(['Read', 'Glob', 'Grep', 'LS']).has(toolName)) return 'safe'
  if (new Set(['WebFetch', 'WebSearch']).has(toolName)) return 'network'
  return 'destructive'
}

// H3: extract a file path from a tool's input object, if present.
// Covers the known path-bearing field names used by the Claude tool family.
function extractFilePath(input: unknown): string | null {
  if (!input || typeof input !== 'object') return null
  const obj = input as Record<string, unknown>
  for (const key of ['file_path', 'notebook_path', 'path']) {
    const val = obj[key]
    if (typeof val === 'string' && val) return val
  }
  return null
}

// H3: check that a path-bearing tool targets a path inside the vault.
// Returns a deny result on violation, null if the check passes or doesn't apply.
function checkVaultBoundary(ctx: PermissionContext): PermissionResult | null {
  const filePath = extractFilePath(ctx.input)
  if (!filePath) return null
  // Resolve relative paths against vaultRoot so relative tool paths work correctly.
  const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(ctx.vaultRoot, filePath)
  try {
    assertInsideVault(ctx.vaultRoot, resolved)
  } catch {
    return { action: 'deny', reason: 'AGENT_VAULT_FORBIDDEN' }
  }
  return null
}

// Evaluate whether a tool call should be auto-allowed, auto-denied, or sent to
// the renderer for user approval. Returns synchronously — no I/O.
export function evaluatePermission(ctx: PermissionContext): PermissionResult {
  // H3: vault boundary check applies across all modes — deny before mode logic.
  const boundaryViolation = checkVaultBoundary(ctx)
  if (boundaryViolation) return boundaryViolation

  if (ctx.permissionMode === 'auto') {
    return { action: 'allow' }
  }

  // H2: acceptEdits auto-allows the file-edit family only; everything else requests.
  if (ctx.permissionMode === 'acceptEdits') {
    return EDIT_TOOLS.has(ctx.toolName) ? { action: 'allow' } : { action: 'request' }
  }

  // H1: plan mode denies write tools; allows read-only and network tools.
  if (ctx.permissionMode === 'plan') {
    return WRITE_TOOLS.has(ctx.toolName)
      ? { action: 'deny', reason: 'Plan mode: file writes are not permitted' }
      : { action: 'allow' }
  }

  // Default mode: check session-scoped remembered decisions.
  const rules = _sessionRules.get(ctx.sessionId)
  const remembered = rules?.get(ctx.toolName)
  if (remembered?.kind === 'allow') return { action: 'allow' }
  if (remembered?.kind === 'deny')
    return { action: 'deny', reason: remembered.reason ?? 'Denied by remembered rule' }

  // No remembered rule — ask the renderer.
  return { action: 'request' }
}

// Await user approval from the renderer. Returns a Promise that resolves with
// the decision, or rejects with Error('AGENT_PERMISSION_TIMEOUT') after 5 minutes.
// Caller must emit a permission-request event to the renderer before calling this.
export function awaitApproval(toolUseId: string): Promise<ApprovalDecision> {
  return new Promise<ApprovalDecision>((resolve, reject) => {
    const timer = setTimeout(() => {
      _pendingApprovals.delete(toolUseId)
      reject(new Error('AGENT_PERMISSION_TIMEOUT'))
    }, APPROVAL_TIMEOUT_MS)

    _pendingApprovals.set(toolUseId, { resolve, reject, timer })
  })
}

// Called by the IPC approval handler when the renderer sends a decision.
// Returns true if a pending approval was found and resolved, false otherwise.
export function resolveApproval(toolUseId: string, decision: ApprovalDecision): boolean {
  const pending = _pendingApprovals.get(toolUseId)
  if (!pending) return false
  clearTimeout(pending.timer)
  _pendingApprovals.delete(toolUseId)
  pending.resolve(decision)
  return true
}

// Cancel pending approvals for a set of toolUseIds (e.g., on agent kill/cancel).
export function cancelPendingApprovals(toolUseIds: string[]): void {
  for (const toolUseId of toolUseIds) {
    const pending = _pendingApprovals.get(toolUseId)
    if (!pending) continue
    clearTimeout(pending.timer)
    _pendingApprovals.delete(toolUseId)
    pending.resolve({ kind: 'deny', reason: 'Agent session ended' })
  }
}

// Record a user decision for the current session.
export function recordDecision(
  sessionId: string,
  toolName: string,
  decision: ApprovalDecision
): void {
  let rules = _sessionRules.get(sessionId)
  if (!rules) {
    rules = new Map()
    _sessionRules.set(sessionId, rules)
  }
  rules.set(toolName, decision)
}
