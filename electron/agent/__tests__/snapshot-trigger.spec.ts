// Sprint 4 (issue #105) — snapshot trigger tests for approval-socket.ts.
// Verifies:
//   - shouldTriggerSnapshot helper classifies tools correctly
//   - snapshotSaved=true on permission-request when snapshot succeeds
//   - snapshotSaved=false when writeSnapshot throws (fail-soft, no propagation)
//   - tool execution proceeds even when snapshot fails
//   - snapshot fires BEFORE user approval decision
//   - Bash / non-edit tools never set snapshotSaved
//   - snapshot-warning emitted after failed snapshot

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import net from 'node:net'
import { createApprovalServer, shouldTriggerSnapshot } from '../approval-socket'
import { clearSessionRules, resolveApproval } from '../permissions'
import type { AgentEvent } from '../protocol'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SESSION = 'snap-trigger-test'
const VAULT = '/vault'

function makeEmit() {
  return vi.fn<(channel: string, payload: AgentEvent) => void>()
}

async function roundtrip(socketPath: string, message: Record<string, unknown>): Promise<string> {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection(socketPath)
    let buf = ''
    sock.setEncoding('utf8')
    sock.on('connect', () => {
      sock.write(JSON.stringify(message) + '\n')
    })
    sock.on('data', (chunk: string) => {
      buf += chunk
      if (buf.includes('\n')) {
        resolve(buf.slice(0, buf.indexOf('\n')).trim())
        sock.destroy()
      }
    })
    sock.on('error', reject)
    sock.on('close', () => {
      if (buf) resolve(buf.trim())
    })
  })
}

// ---------------------------------------------------------------------------
// shouldTriggerSnapshot — pure helper
// ---------------------------------------------------------------------------

describe('shouldTriggerSnapshot', () => {
  it('returns true for Edit', () => {
    expect(shouldTriggerSnapshot('Edit')).toBe(true)
  })

  it('returns true for Write', () => {
    expect(shouldTriggerSnapshot('Write')).toBe(true)
  })

  it('returns true for NotebookEdit', () => {
    expect(shouldTriggerSnapshot('NotebookEdit')).toBe(true)
  })

  it('returns true for MultiEdit', () => {
    expect(shouldTriggerSnapshot('MultiEdit')).toBe(true)
  })

  it('returns false for Bash', () => {
    expect(shouldTriggerSnapshot('Bash')).toBe(false)
  })

  it('returns false for Read', () => {
    expect(shouldTriggerSnapshot('Read')).toBe(false)
  })

  it('returns false for WebFetch', () => {
    expect(shouldTriggerSnapshot('WebFetch')).toBe(false)
  })

  it('returns false for unknown/MCP tools', () => {
    expect(shouldTriggerSnapshot('mcp__custom')).toBe(false)
    expect(shouldTriggerSnapshot('UnknownTool')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Integration: snapshotSaved field on permission-request events
// ---------------------------------------------------------------------------

describe('approval-socket — snapshotSaved on permission-request', () => {
  let handle: Awaited<ReturnType<typeof createApprovalServer>>
  let emit: ReturnType<typeof makeEmit>

  beforeEach(() => {
    clearSessionRules(SESSION)
    emit = makeEmit()
    vi.restoreAllMocks()
  })

  afterEach(async () => {
    if (handle) {
      await handle.close()
      handle = undefined as unknown as typeof handle
    }
  })

  it('emits permission-request with snapshotSaved=true when Edit snapshot succeeds', async () => {
    const snapModule = await import('../../snapshot')
    vi.spyOn(snapModule, 'writeSnapshot').mockResolvedValue(true as never)

    handle = await createApprovalServer(
      SESSION,
      { sessionId: SESSION, permissionMode: 'default', vaultRoot: VAULT },
      new Set(),
      new Map(),
      emit
    )

    const pending = roundtrip(handle.socketPath, {
      toolUseId: 'tu-snap-ok',
      toolName: 'Edit',
      input: { file_path: '/vault/note.md', old_string: 'a', new_string: 'b' },
    })

    await vi.waitFor(() => expect(emit).toHaveBeenCalled(), { timeout: 2000 })
    resolveApproval('tu-snap-ok', { kind: 'allow' })
    await pending

    const event = emit.mock.calls[0][1] as Record<string, unknown>
    expect(event.type).toBe('permission-request')
    expect(event.snapshotSaved).toBe(true)
  })

  it('emits permission-request with snapshotSaved=true for Write tool', async () => {
    const snapModule = await import('../../snapshot')
    vi.spyOn(snapModule, 'writeSnapshot').mockResolvedValue(true as never)

    handle = await createApprovalServer(
      SESSION,
      { sessionId: SESSION, permissionMode: 'default', vaultRoot: VAULT },
      new Set(),
      new Map(),
      emit
    )

    const pending = roundtrip(handle.socketPath, {
      toolUseId: 'tu-write-snap-ok',
      toolName: 'Write',
      input: { file_path: '/vault/note.md', content: 'new content' },
    })

    await vi.waitFor(() => expect(emit).toHaveBeenCalled(), { timeout: 2000 })
    resolveApproval('tu-write-snap-ok', { kind: 'allow' })
    await pending

    const event = emit.mock.calls[0][1] as Record<string, unknown>
    expect(event.type).toBe('permission-request')
    expect(event.snapshotSaved).toBe(true)
  })

  it('emits permission-request with snapshotSaved=false when writeSnapshot throws', async () => {
    const snapModule = await import('../../snapshot')
    vi.spyOn(snapModule, 'writeSnapshot').mockRejectedValue(new Error('disk full'))

    handle = await createApprovalServer(
      SESSION,
      { sessionId: SESSION, permissionMode: 'default', vaultRoot: VAULT },
      new Set(),
      new Map(),
      emit
    )

    const pending = roundtrip(handle.socketPath, {
      toolUseId: 'tu-snap-fail',
      toolName: 'Edit',
      input: { file_path: '/vault/note.md', old_string: 'a', new_string: 'b' },
    })

    await vi.waitFor(() => expect(emit).toHaveBeenCalled(), { timeout: 2000 })
    resolveApproval('tu-snap-fail', { kind: 'allow' })
    await pending

    const event = emit.mock.calls[0][1] as Record<string, unknown>
    expect(event.type).toBe('permission-request')
    expect(event.snapshotSaved).toBe(false)
  })

  it('snapshot failure does NOT block tool execution — socket responds allow', async () => {
    const snapModule = await import('../../snapshot')
    vi.spyOn(snapModule, 'writeSnapshot').mockRejectedValue(new Error('disk full'))

    handle = await createApprovalServer(
      SESSION,
      { sessionId: SESSION, permissionMode: 'default', vaultRoot: VAULT },
      new Set(),
      new Map(),
      emit
    )

    const pending = roundtrip(handle.socketPath, {
      toolUseId: 'tu-snap-failsoft',
      toolName: 'Edit',
      input: { file_path: '/vault/note.md', old_string: 'a', new_string: 'b' },
    })

    await vi.waitFor(() => expect(emit).toHaveBeenCalled(), { timeout: 2000 })
    resolveApproval('tu-snap-failsoft', { kind: 'allow' })
    const raw = await pending
    expect(JSON.parse(raw).decision).toBe('allow')
  })

  it('snapshot failure emits snapshot-warning event after permission-request', async () => {
    const snapModule = await import('../../snapshot')
    vi.spyOn(snapModule, 'writeSnapshot').mockRejectedValue(new Error('disk full'))

    handle = await createApprovalServer(
      SESSION,
      { sessionId: SESSION, permissionMode: 'default', vaultRoot: VAULT },
      new Set(),
      new Map(),
      emit
    )

    const pending = roundtrip(handle.socketPath, {
      toolUseId: 'tu-snap-warn',
      toolName: 'Edit',
      input: { file_path: '/vault/note.md', old_string: 'a', new_string: 'b' },
    })

    await vi.waitFor(() => expect(emit).toHaveBeenCalledTimes(2), { timeout: 2000 })
    resolveApproval('tu-snap-warn', { kind: 'allow' })
    await pending

    const firstEvent = emit.mock.calls[0][1] as Record<string, unknown>
    const secondEvent = emit.mock.calls[1][1] as Record<string, unknown>
    expect(firstEvent.type).toBe('permission-request')
    expect(secondEvent.type).toBe('snapshot-warning')
  })

  it('does NOT set snapshotSaved for Bash tool (no snapshot attempted)', async () => {
    handle = await createApprovalServer(
      SESSION,
      { sessionId: SESSION, permissionMode: 'default', vaultRoot: VAULT },
      new Set(),
      new Map(),
      emit
    )

    const pending = roundtrip(handle.socketPath, {
      toolUseId: 'tu-bash-no-snap',
      toolName: 'Bash',
      input: { command: 'ls' },
    })

    await vi.waitFor(() => expect(emit).toHaveBeenCalled(), { timeout: 2000 })
    resolveApproval('tu-bash-no-snap', { kind: 'allow' })
    await pending

    const event = emit.mock.calls[0][1] as Record<string, unknown>
    expect(event.type).toBe('permission-request')
    expect(event.snapshotSaved).toBeFalsy()
  })

  it('snapshot fires BEFORE user approval — writeSnapshot called before resolveApproval', async () => {
    const snapModule = await import('../../snapshot')
    const writeSnapshotSpy = vi.spyOn(snapModule, 'writeSnapshot').mockResolvedValue(true as never)

    handle = await createApprovalServer(
      SESSION,
      { sessionId: SESSION, permissionMode: 'default', vaultRoot: VAULT },
      new Set(),
      new Map(),
      emit
    )

    const pending = roundtrip(handle.socketPath, {
      toolUseId: 'tu-snap-timing',
      toolName: 'Edit',
      input: { file_path: '/vault/note.md', old_string: 'a', new_string: 'b' },
    })

    // Wait for emit (happens after snapshot resolves, before user resolves)
    await vi.waitFor(() => expect(emit).toHaveBeenCalled(), { timeout: 2000 })

    // snapshot must already have been attempted before any user decision
    expect(writeSnapshotSpy).toHaveBeenCalled()

    resolveApproval('tu-snap-timing', { kind: 'allow' })
    await pending
  })

  it('snapshotSaved field is absent from permission-request for Bash (no spread)', async () => {
    handle = await createApprovalServer(
      SESSION,
      { sessionId: SESSION, permissionMode: 'default', vaultRoot: VAULT },
      new Set(),
      new Map(),
      emit
    )

    const pending = roundtrip(handle.socketPath, {
      toolUseId: 'tu-bash-field',
      toolName: 'Bash',
      input: { command: 'echo hi' },
    })

    await vi.waitFor(() => expect(emit).toHaveBeenCalled(), { timeout: 2000 })
    resolveApproval('tu-bash-field', { kind: 'allow' })
    await pending

    const event = emit.mock.calls[0][1] as Record<string, unknown>
    expect(Object.prototype.hasOwnProperty.call(event, 'snapshotSaved')).toBe(false)
  })
})
