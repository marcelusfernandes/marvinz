import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  evaluatePermission,
  recordDecision,
  clearSessionRules,
  getSessionRules,
  classifyToolRisk,
  awaitApproval,
  resolveApproval,
  cancelPendingApprovals,
  APPROVAL_TIMEOUT_MS,
  type PermissionContext,
} from '../permissions'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ctx(overrides: Partial<PermissionContext> = {}): PermissionContext {
  return {
    sessionId: 's1',
    toolUseId: 'tu1',
    toolName: 'Bash',
    input: { command: 'ls' },
    permissionMode: 'default',
    vaultRoot: '/vault',
    ...overrides,
  }
}

beforeEach(() => {
  clearSessionRules('s1')
  clearSessionRules('s2')
})

// ---------------------------------------------------------------------------
// APPROVAL_TIMEOUT_MS
// ---------------------------------------------------------------------------

describe('APPROVAL_TIMEOUT_MS', () => {
  it('is 300000 (5 minutes)', () => {
    expect(APPROVAL_TIMEOUT_MS).toBe(300_000)
  })
})

// ---------------------------------------------------------------------------
// classifyToolRisk
// ---------------------------------------------------------------------------

describe('classifyToolRisk', () => {
  it('classifies Read as safe', () => {
    expect(classifyToolRisk('Read')).toBe('safe')
  })

  it('classifies Glob as safe', () => {
    expect(classifyToolRisk('Glob')).toBe('safe')
  })

  it('classifies Grep as safe', () => {
    expect(classifyToolRisk('Grep')).toBe('safe')
  })

  it('classifies LS as safe', () => {
    expect(classifyToolRisk('LS')).toBe('safe')
  })

  it('classifies WebFetch as network', () => {
    expect(classifyToolRisk('WebFetch')).toBe('network')
  })

  it('classifies WebSearch as network', () => {
    expect(classifyToolRisk('WebSearch')).toBe('network')
  })

  it('classifies Bash as destructive', () => {
    expect(classifyToolRisk('Bash')).toBe('destructive')
  })

  it('classifies Write as destructive', () => {
    expect(classifyToolRisk('Write')).toBe('destructive')
  })

  it('classifies Edit as destructive', () => {
    expect(classifyToolRisk('Edit')).toBe('destructive')
  })

  it('classifies unknown tools as destructive (conservative default)', () => {
    expect(classifyToolRisk('mcp__custom_tool')).toBe('destructive')
    expect(classifyToolRisk('UnknownTool')).toBe('destructive')
  })
})

// ---------------------------------------------------------------------------
// evaluatePermission — mode: auto
// ---------------------------------------------------------------------------

describe('evaluatePermission — mode: auto', () => {
  it('returns allow for Bash', () => {
    expect(evaluatePermission(ctx({ permissionMode: 'auto' }))).toEqual({ action: 'allow' })
  })

  it('returns allow for Write', () => {
    expect(evaluatePermission(ctx({ permissionMode: 'auto', toolName: 'Write' }))).toEqual({
      action: 'allow',
    })
  })

  it('returns allow for Edit', () => {
    expect(evaluatePermission(ctx({ permissionMode: 'auto', toolName: 'Edit' }))).toEqual({
      action: 'allow',
    })
  })

  it('returns allow for any tool including unknown', () => {
    expect(evaluatePermission(ctx({ permissionMode: 'auto', toolName: 'mcp__foo' }))).toEqual({
      action: 'allow',
    })
  })
})

// ---------------------------------------------------------------------------
// evaluatePermission — mode: acceptEdits (H2: file-edit family only)
// ---------------------------------------------------------------------------

describe('evaluatePermission — mode: acceptEdits', () => {
  it('returns allow for Write tool (edit family)', () => {
    expect(evaluatePermission(ctx({ permissionMode: 'acceptEdits', toolName: 'Write' }))).toEqual({
      action: 'allow',
    })
  })

  it('returns allow for Edit tool (edit family)', () => {
    expect(evaluatePermission(ctx({ permissionMode: 'acceptEdits', toolName: 'Edit' }))).toEqual({
      action: 'allow',
    })
  })

  it('returns allow for NotebookEdit (edit family)', () => {
    expect(
      evaluatePermission(ctx({ permissionMode: 'acceptEdits', toolName: 'NotebookEdit' }))
    ).toEqual({ action: 'allow' })
  })

  it('returns allow for MultiEdit (edit family)', () => {
    expect(
      evaluatePermission(ctx({ permissionMode: 'acceptEdits', toolName: 'MultiEdit' }))
    ).toEqual({ action: 'allow' })
  })

  it('returns request for Bash tool (not in edit family)', () => {
    expect(evaluatePermission(ctx({ permissionMode: 'acceptEdits', toolName: 'Bash' }))).toEqual({
      action: 'request',
    })
  })

  it('returns request for WebFetch tool (not in edit family)', () => {
    expect(
      evaluatePermission(ctx({ permissionMode: 'acceptEdits', toolName: 'WebFetch' }))
    ).toEqual({ action: 'request' })
  })

  it('returns request for unknown MCP tool', () => {
    expect(
      evaluatePermission(ctx({ permissionMode: 'acceptEdits', toolName: 'mcp__custom' }))
    ).toEqual({ action: 'request' })
  })
})

// ---------------------------------------------------------------------------
// evaluatePermission — mode: plan (H1: write tools denied; read-only allowed)
// ---------------------------------------------------------------------------

describe('evaluatePermission — mode: plan', () => {
  it('denies Bash tool (write family)', () => {
    expect(evaluatePermission(ctx({ permissionMode: 'plan', toolName: 'Bash' })).action).toBe(
      'deny'
    )
  })

  it('deny reason mentions plan mode', () => {
    const result = evaluatePermission(ctx({ permissionMode: 'plan', toolName: 'Bash' }))
    if (result.action === 'deny') expect(result.reason.toLowerCase()).toContain('plan')
  })

  it('denies Write tool with a reason', () => {
    const result = evaluatePermission(ctx({ permissionMode: 'plan', toolName: 'Write' }))
    expect(result.action).toBe('deny')
    if (result.action === 'deny') expect(result.reason).toBeTruthy()
  })

  it('denies Edit tool', () => {
    expect(evaluatePermission(ctx({ permissionMode: 'plan', toolName: 'Edit' })).action).toBe(
      'deny'
    )
  })

  it('allows Read tool (plan mode only denies write tools)', () => {
    expect(evaluatePermission(ctx({ permissionMode: 'plan', toolName: 'Read' }))).toEqual({
      action: 'allow',
    })
  })

  it('allows Glob tool', () => {
    expect(evaluatePermission(ctx({ permissionMode: 'plan', toolName: 'Glob' }))).toEqual({
      action: 'allow',
    })
  })

  it('allows WebFetch tool (network, not write)', () => {
    expect(evaluatePermission(ctx({ permissionMode: 'plan', toolName: 'WebFetch' }))).toEqual({
      action: 'allow',
    })
  })
})

// ---------------------------------------------------------------------------
// evaluatePermission — vault boundary check (H3)
// ---------------------------------------------------------------------------

describe('evaluatePermission — vault boundary', () => {
  it('denies Write targeting a path outside the vault', () => {
    const result = evaluatePermission(
      ctx({
        toolName: 'Write',
        input: { file_path: '/etc/passwd', content: 'evil' },
        vaultRoot: '/vault',
      })
    )
    expect(result.action).toBe('deny')
    if (result.action === 'deny') expect(result.reason).toContain('VAULT_FORBIDDEN')
  })

  it('allows Write targeting a path inside the vault (auto mode)', () => {
    const result = evaluatePermission(
      ctx({
        permissionMode: 'auto',
        toolName: 'Write',
        input: { file_path: '/vault/note.md', content: 'hello' },
        vaultRoot: '/vault',
      })
    )
    expect(result.action).toBe('allow')
  })

  it('denies traversal attack (../../ path outside vault)', () => {
    const result = evaluatePermission(
      ctx({
        toolName: 'Edit',
        input: { file_path: '/vault/../../etc/shadow' },
        vaultRoot: '/vault',
      })
    )
    expect(result.action).toBe('deny')
  })

  it('vault check fires before mode logic — auto mode still denied on boundary violation', () => {
    const result = evaluatePermission(
      ctx({
        permissionMode: 'auto',
        toolName: 'Write',
        input: { file_path: '/outside/file.md', content: 'x' },
        vaultRoot: '/vault',
      })
    )
    expect(result.action).toBe('deny')
  })

  it('does not apply vault check when input has no path key', () => {
    // Bash with command key only — vault check skipped → default mode → request
    const result = evaluatePermission(
      ctx({
        permissionMode: 'default',
        toolName: 'Bash',
        input: { command: 'ls' },
      })
    )
    expect(result.action).toBe('request')
  })

  it('resolves relative paths against vaultRoot (inside vault → allow in auto)', () => {
    const result = evaluatePermission(
      ctx({
        permissionMode: 'auto',
        toolName: 'Write',
        input: { file_path: 'note.md' },
        vaultRoot: '/vault',
      })
    )
    expect(result.action).toBe('allow')
  })
})

// ---------------------------------------------------------------------------
// evaluatePermission — mode: default, no remembered rules
// ---------------------------------------------------------------------------

describe('evaluatePermission — mode: default, no rules', () => {
  it('returns request when no remembered rule exists', () => {
    expect(evaluatePermission(ctx())).toEqual({ action: 'request' })
  })

  it('returns request for unknown tool', () => {
    expect(evaluatePermission(ctx({ toolName: 'NewTool' }))).toEqual({ action: 'request' })
  })
})

// ---------------------------------------------------------------------------
// evaluatePermission — mode: default, remembered rules
// ---------------------------------------------------------------------------

describe('evaluatePermission — mode: default, remembered allow', () => {
  beforeEach(() => {
    recordDecision('s1', 'Bash', { kind: 'allow' })
  })

  it('returns allow when tool has a remembered allow rule', () => {
    expect(evaluatePermission(ctx())).toEqual({ action: 'allow' })
  })

  it('does not affect other tools in same session', () => {
    expect(evaluatePermission(ctx({ toolName: 'Write' }))).toEqual({ action: 'request' })
  })

  it('does not affect same tool in different session', () => {
    expect(evaluatePermission(ctx({ sessionId: 's2' }))).toEqual({ action: 'request' })
  })
})

describe('evaluatePermission — mode: default, remembered deny', () => {
  beforeEach(() => {
    recordDecision('s1', 'Bash', { kind: 'deny', reason: 'Too risky' })
  })

  it('returns deny when tool has a remembered deny rule', () => {
    expect(evaluatePermission(ctx()).action).toBe('deny')
  })

  it('deny includes a reason', () => {
    const result = evaluatePermission(ctx())
    if (result.action === 'deny') expect(result.reason).toBeTruthy()
  })

  it('does not affect other tools', () => {
    expect(evaluatePermission(ctx({ toolName: 'Read' }))).toEqual({ action: 'request' })
  })
})

// ---------------------------------------------------------------------------
// recordDecision + getSessionRules
// ---------------------------------------------------------------------------

describe('recordDecision', () => {
  it('allow is retrievable via getSessionRules', () => {
    recordDecision('s1', 'Bash', { kind: 'allow', remember: 'session' })
    expect(getSessionRules('s1').get('Bash')?.kind).toBe('allow')
  })

  it('deny is retrievable', () => {
    recordDecision('s1', 'Write', { kind: 'deny' })
    expect(getSessionRules('s1').get('Write')?.kind).toBe('deny')
  })

  it('overwriting a decision updates the map', () => {
    recordDecision('s1', 'Bash', { kind: 'deny' })
    recordDecision('s1', 'Bash', { kind: 'allow' })
    expect(getSessionRules('s1').get('Bash')?.kind).toBe('allow')
  })

  it('does not affect other sessions', () => {
    recordDecision('s1', 'Bash', { kind: 'allow' })
    expect(getSessionRules('s2').get('Bash')).toBeUndefined()
  })
})

describe('clearSessionRules', () => {
  it('removes all rules for a session', () => {
    recordDecision('s1', 'Bash', { kind: 'allow' })
    recordDecision('s1', 'Write', { kind: 'deny' })
    clearSessionRules('s1')
    expect(getSessionRules('s1').size).toBe(0)
    expect(evaluatePermission(ctx())).toEqual({ action: 'request' })
  })

  it('does not affect other sessions', () => {
    recordDecision('s1', 'Bash', { kind: 'allow' })
    recordDecision('s2', 'Bash', { kind: 'allow' })
    clearSessionRules('s1')
    expect(evaluatePermission(ctx({ sessionId: 's2' }))).toEqual({ action: 'allow' })
  })

  it('is safe to call on unknown session', () => {
    expect(() => clearSessionRules('unknown-session')).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// awaitApproval + resolveApproval
// ---------------------------------------------------------------------------

describe('awaitApproval + resolveApproval', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolveApproval resolves the pending promise with allow', async () => {
    const promise = awaitApproval('tu-resolve')
    expect(resolveApproval('tu-resolve', { kind: 'allow' })).toBe(true)
    await expect(promise).resolves.toEqual({ kind: 'allow' })
  })

  it('resolveApproval resolves with deny decision', async () => {
    const promise = awaitApproval('tu-deny')
    resolveApproval('tu-deny', { kind: 'deny', reason: 'User said no' })
    await expect(promise).resolves.toEqual({ kind: 'deny', reason: 'User said no' })
  })

  it('resolveApproval returns false for unknown toolUseId', () => {
    expect(resolveApproval('tu-ghost', { kind: 'allow' })).toBe(false)
  })

  it('resolveApproval returns true only once — second call returns false', async () => {
    const promise = awaitApproval('tu-once')
    expect(resolveApproval('tu-once', { kind: 'allow' })).toBe(true)
    expect(resolveApproval('tu-once', { kind: 'deny' })).toBe(false)
    await promise
  })

  it('awaitApproval rejects with AGENT_PERMISSION_TIMEOUT after timer fires', async () => {
    vi.useFakeTimers()
    const promise = awaitApproval('tu-timeout')
    vi.advanceTimersByTime(APPROVAL_TIMEOUT_MS)
    await expect(promise).rejects.toThrow('AGENT_PERMISSION_TIMEOUT')
  })

  it('resolveApproval after timeout returns false (entry already removed)', async () => {
    vi.useFakeTimers()
    const promise = awaitApproval('tu-late')
    vi.advanceTimersByTime(APPROVAL_TIMEOUT_MS)
    await promise.catch(() => {})
    expect(resolveApproval('tu-late', { kind: 'allow' })).toBe(false)
    vi.useRealTimers()
  })

  it('multiple concurrent awaitApproval calls are isolated', async () => {
    const p1 = awaitApproval('tu-multi-1')
    const p2 = awaitApproval('tu-multi-2')
    resolveApproval('tu-multi-2', { kind: 'deny' })
    resolveApproval('tu-multi-1', { kind: 'allow' })
    const [d1, d2] = await Promise.all([p1, p2])
    expect(d1.kind).toBe('allow')
    expect(d2.kind).toBe('deny')
  })
})

// ---------------------------------------------------------------------------
// cancelPendingApprovals
// ---------------------------------------------------------------------------

describe('cancelPendingApprovals', () => {
  it('resolves pending approvals with a deny decision', async () => {
    const p1 = awaitApproval('tu-cancel-1')
    const p2 = awaitApproval('tu-cancel-2')
    cancelPendingApprovals(['tu-cancel-1', 'tu-cancel-2'])
    const [d1, d2] = await Promise.all([p1, p2])
    expect(d1.kind).toBe('deny')
    expect(d2.kind).toBe('deny')
  })

  it('deny reason mentions session ended', async () => {
    const p = awaitApproval('tu-cancel-reason')
    cancelPendingApprovals(['tu-cancel-reason'])
    const decision = await p
    if (decision.kind === 'deny') expect(decision.reason).toMatch(/session/i)
  })

  it('is a no-op for unknown toolUseIds', () => {
    expect(() => cancelPendingApprovals(['tu-ghost-cancel'])).not.toThrow()
  })

  it('does not cancel toolUseIds not in the list', async () => {
    const pKeep = awaitApproval('tu-keep')
    const pCancel = awaitApproval('tu-cancel-only')
    cancelPendingApprovals(['tu-cancel-only'])
    await pCancel // already resolved
    // tu-keep must still be pending — resolve it now
    expect(resolveApproval('tu-keep', { kind: 'allow' })).toBe(true)
    await expect(pKeep).resolves.toEqual({ kind: 'allow' })
  })
})
