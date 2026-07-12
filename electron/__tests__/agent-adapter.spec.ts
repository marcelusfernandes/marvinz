/**
 * Unit tests for the `adapters: Record<Provider, AgentAdapter>` map (#582).
 *
 * Confirms `adapters.claude`/`adapters.codex` each satisfy AgentAdapter and
 * reproduce exactly what spawnAgent's inline isCodex branches used to do —
 * these are the same behaviors, just resolved through one seam per provider
 * instead of ten separate ternaries. adaptObj wraps adaptClaudeObj/
 * adaptCodexObj unchanged (already covered end-to-end by
 * adapter-claude.spec.ts/adapter-codex.spec.ts's fixture tests), so this file
 * only checks that the wiring delegates correctly, not the NDJSON parsing
 * logic itself.
 */

import { describe, it, expect, vi } from 'vitest'
import type { ChildProcess } from 'node:child_process'
import { adapters } from '../agent/index.js'
import type { AgentRequest } from '../agent/protocol.js'

function startRequest(
  overrides: Partial<Extract<AgentRequest, { type: 'start' }>> = {}
): Extract<AgentRequest, { type: 'start' }> {
  return {
    type: 'start',
    sessionId: 'sess-1',
    provider: 'claude',
    prompt: 'do the thing',
    vaultRoot: '/vault',
    permissionMode: 'default',
    ...overrides,
  }
}

function fakeChildProcess(stdin: { write: ReturnType<typeof vi.fn> } | null) {
  return { stdin } as unknown as ChildProcess
}

describe('adapters map', () => {
  it('has exactly one entry per Provider value', () => {
    expect(Object.keys(adapters).sort()).toEqual(['claude', 'codex'])
  })

  it('resolves the claude adapter for provider "claude" and the codex adapter for "codex"', () => {
    expect(adapters.claude).not.toBe(adapters.codex)
    expect(adapters.claude.usesApprovalSocket).toBe(true)
    expect(adapters.codex.usesApprovalSocket).toBe(false)
  })
})

describe('claudeAdapter', () => {
  it('makeState creates AdapterState with cwd set to req.vaultRoot', () => {
    const state = adapters.claude.makeState('sess-1', startRequest({ vaultRoot: '/my/vault' }))
    expect(state).toMatchObject({ sessionId: 'sess-1', cwd: '/my/vault' })
  })

  it('resolveBinary returns bins.claude', () => {
    expect(adapters.claude.resolveBinary({ claude: '/usr/local/bin/claude' })).toBe(
      '/usr/local/bin/claude'
    )
  })

  it('buildArgs matches buildClaudeArgs output shape (stream-json, permission-mode)', () => {
    const args = adapters.claude.buildArgs(startRequest({ permissionMode: 'acceptEdits' }))
    expect(args).toEqual(
      expect.arrayContaining([
        '--output-format',
        'stream-json',
        '--input-format',
        'stream-json',
        '--permission-mode',
        'acceptEdits',
      ])
    )
  })

  it('handleStdin writes the prompt as a stream-json input event, then closes stdin', () => {
    const write = vi.fn()
    const end = vi.fn()
    const proc = { stdin: { write, end } } as unknown as ChildProcess
    adapters.claude.handleStdin(proc, startRequest({ prompt: 'hello there' }))

    expect(write).toHaveBeenCalledTimes(1)
    const written = JSON.parse((write.mock.calls[0][0] as string).trim())
    expect(written).toEqual({ type: 'user', message: { role: 'user', content: 'hello there' } })
    expect(end).toHaveBeenCalledTimes(1)
  })

  it('handleStdin is a no-op when proc.stdin is null (preserves the original guard)', () => {
    expect(() => adapters.claude.handleStdin(fakeChildProcess(null), startRequest())).not.toThrow()
  })
})

describe('codexAdapter', () => {
  it('makeState creates CodexAdapterState with no cwd field', () => {
    const state = adapters.codex.makeState('sess-1', startRequest({ provider: 'codex' }))
    expect(state).toMatchObject({ sessionId: 'sess-1' })
    expect('cwd' in state).toBe(false)
  })

  it('resolveBinary falls back to "codex" when bins.codex is not provided', () => {
    expect(adapters.codex.resolveBinary({ claude: '/usr/local/bin/claude' })).toBe('codex')
  })

  it('resolveBinary uses bins.codex when provided', () => {
    expect(
      adapters.codex.resolveBinary({ claude: '/usr/local/bin/claude', codex: '/opt/codex' })
    ).toBe('/opt/codex')
  })

  it('buildArgs matches buildCodexArgs output shape exactly (prompt as argv, no stdin)', () => {
    const args = adapters.codex.buildArgs(startRequest({ provider: 'codex', prompt: 'do X' }))
    expect(args).toEqual(['exec', '--json', '--skip-git-repo-check', 'do X'])
  })

  it('handleStdin only closes stdin — never writes (prompt is already in argv)', () => {
    const write = vi.fn()
    const end = vi.fn()
    const proc = { stdin: { write, end } } as unknown as ChildProcess
    adapters.codex.handleStdin(proc, startRequest({ provider: 'codex' }))

    expect(write).not.toHaveBeenCalled()
    expect(end).toHaveBeenCalledTimes(1)
  })

  it('handleStdin is a no-op when proc.stdin is null (preserves the original guard)', () => {
    expect(() => adapters.codex.handleStdin(fakeChildProcess(null), startRequest())).not.toThrow()
  })
})
