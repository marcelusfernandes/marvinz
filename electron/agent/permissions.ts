// PreToolUse hook handler — scaffold for Sprint 3.
// In v1, all permission decisions pass through here; full wiring (persisted rules,
// per-session allow-always, vault boundary enforcement) lands in Sprint 3.

import type { ApprovalDecision, PermissionMode } from './protocol.js'

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

// Sprint 3 will populate per-session and persisted rule caches here.
const _sessionRules = new Map<string, Map<string, ApprovalDecision>>()

export function getSessionRules(sessionId: string): ReadonlyMap<string, ApprovalDecision> {
  return _sessionRules.get(sessionId) ?? new Map()
}

export function clearSessionRules(sessionId: string): void {
  _sessionRules.delete(sessionId)
}

// Evaluate whether a tool call should be auto-allowed, auto-denied, or sent to
// the renderer for user approval. Returns synchronously — no I/O.
export function evaluatePermission(ctx: PermissionContext): PermissionResult {
  if (ctx.permissionMode === 'auto' || ctx.permissionMode === 'acceptEdits') {
    return { action: 'allow' }
  }

  if (ctx.permissionMode === 'plan') {
    return { action: 'deny', reason: 'Plan mode: file writes are not permitted' }
  }

  // Default mode: check session-scoped remembered decisions.
  const rules = _sessionRules.get(ctx.sessionId)
  const remembered = rules?.get(ctx.toolName)
  if (remembered?.kind === 'allow') return { action: 'allow' }
  if (remembered?.kind === 'deny') return { action: 'deny', reason: remembered.reason ?? 'Denied by remembered rule' }

  // No remembered rule — ask the renderer.
  return { action: 'request' }
}

// Record a user decision for the current session (optionally persisted in Sprint 3).
export function recordDecision(
  sessionId: string,
  toolName: string,
  decision: ApprovalDecision,
): void {
  if (decision.kind === 'modify') return // modify decisions are one-shot, not persisted

  let rules = _sessionRules.get(sessionId)
  if (!rules) {
    rules = new Map()
    _sessionRules.set(sessionId, rules)
  }
  rules.set(toolName, decision)
}
