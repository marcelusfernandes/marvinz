/**
 * sendAgentInput — the main-process half of multi-turn chat (C1-1 / C1-2).
 *
 * Same harness as spawn-agent-codex-path.spec.ts: mock node:child_process's
 * spawn so the live child is test-controlled, then drive the real
 * spawnAgent + sendAgentInput.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcess } from 'node:child_process'
import type { AgentEvent, AgentRequest, Provider } from '../protocol.js'

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return { ...actual, spawn: vi.fn() }
})

import { spawn } from 'node:child_process'
import { sendAgentInput, spawnAgent } from '../index.js'

class FakeChildProcess extends EventEmitter {
  stdout = new PassThrough()
  stderr = new PassThrough()
  stdin = { write: vi.fn(), end: vi.fn(), on: vi.fn(), destroyed: false, writable: true }
  pid = 4242
}

function startRequest(
  sessionId: string,
  vaultRoot: string,
  provider: Provider = 'claude'
): Extract<AgentRequest, { type: 'start' }> {
  return {
    type: 'start',
    sessionId,
    provider,
    prompt: 'first turn',
    vaultRoot,
    permissionMode: 'auto',
  }
}

describe('sendAgentInput', () => {
  let vaultRoot: string
  let fakeChild: FakeChildProcess
  let counter = 0
  const emit = vi.fn<(channel: string, payload: AgentEvent) => void>()
  const bins = { claude: 'claude-fake', codex: 'codex-fake' }

  beforeEach(async () => {
    vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'marvinz-send-input-'))
    fakeChild = new FakeChildProcess()
    vi.mocked(spawn).mockReturnValue(fakeChild as unknown as ChildProcess)
  })

  afterEach(async () => {
    fakeChild.emit('close', 0, null)
    await new Promise((resolve) => setTimeout(resolve, 20))
    await fs.rm(vaultRoot, { recursive: true, force: true })
    vi.clearAllMocks()
  })

  it('writes a follow-up user turn as a stream-json line to the live Claude child', async () => {
    const sessionId = `send-${++counter}`
    await spawnAgent(startRequest(sessionId, vaultRoot), bins, emit)
    // The initial prompt went through handleStdin and left stdin open.
    expect(fakeChild.stdin.write).toHaveBeenCalledTimes(1)
    expect(fakeChild.stdin.end).not.toHaveBeenCalled()

    expect(sendAgentInput(sessionId, 'second turn')).toBe(true)

    expect(fakeChild.stdin.write).toHaveBeenCalledTimes(2)
    const line = fakeChild.stdin.write.mock.calls[1][0] as string
    expect(line.endsWith('\n')).toBe(true)
    expect(JSON.parse(line)).toEqual({
      type: 'user',
      message: { role: 'user', content: 'second turn' },
    })
  })

  it('returns false for an unknown session so the renderer falls back to a fresh start', () => {
    expect(sendAgentInput('never-spawned', 'hello')).toBe(false)
  })

  it('returns false for a Codex child (one-shot exec, no persistent stdin)', async () => {
    const sessionId = `send-codex-${++counter}`
    await spawnAgent(startRequest(sessionId, vaultRoot, 'codex'), bins, emit)
    fakeChild.stdin.write.mockClear()

    expect(sendAgentInput(sessionId, 'second turn')).toBe(false)
    expect(fakeChild.stdin.write).not.toHaveBeenCalled()
  })

  it('returns false once the pipe is destroyed or no longer writable', async () => {
    const sessionId = `send-dead-${++counter}`
    await spawnAgent(startRequest(sessionId, vaultRoot), bins, emit)
    fakeChild.stdin.write.mockClear()

    fakeChild.stdin.destroyed = true
    expect(sendAgentInput(sessionId, 'x')).toBe(false)
    fakeChild.stdin.destroyed = false
    fakeChild.stdin.writable = false
    expect(sendAgentInput(sessionId, 'x')).toBe(false)
    expect(fakeChild.stdin.write).not.toHaveBeenCalled()
  })

  it('returns false instead of throwing when the write itself fails', async () => {
    const sessionId = `send-throw-${++counter}`
    await spawnAgent(startRequest(sessionId, vaultRoot), bins, emit)
    fakeChild.stdin.write.mockImplementation(() => {
      throw new Error('EPIPE')
    })

    expect(sendAgentInput(sessionId, 'x')).toBe(false)
  })

  it('reports a signal-killed child (exit code null) as crashed so the chat never hangs', async () => {
    const sessionId = `send-signal-${++counter}`
    await spawnAgent(startRequest(sessionId, vaultRoot), bins, emit)
    emit.mockClear()

    fakeChild.emit('close', null, 'SIGKILL')
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(emit).toHaveBeenCalledWith(
      expect.stringContaining(sessionId),
      expect.objectContaining({ type: 'crashed', sessionId, exitCode: null, signal: 'SIGKILL' })
    )
  })

  it('attaches an error listener to stdin so an async EPIPE cannot crash the main process', async () => {
    const sessionId = `send-epipe-${++counter}`
    await spawnAgent(startRequest(sessionId, vaultRoot), bins, emit)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const onError = fakeChild.stdin.on.mock.calls.find(([event]) => event === 'error')?.[1] as
      | ((err: Error) => void)
      | undefined
    expect(onError).toBeDefined()
    expect(() => onError?.(new Error('EPIPE'))).not.toThrow()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(sessionId))
    warn.mockRestore()
  })
})
