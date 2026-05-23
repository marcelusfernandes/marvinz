import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { adaptCodexObj, makeCodexAdapterState } from '../agent/adapter-codex.js'
import type { AgentEvent } from '../agent/protocol.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURES = join(__dirname, '..', 'agent', '__tests__', 'fixtures', 'codex')

function loadFixture(name: string): unknown[] {
  const raw = readFileSync(join(FIXTURES, name), 'utf8')
  return raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l))
}

function runFixture(name: string, sessionId = 'test-session'): AgentEvent[] {
  const state = makeCodexAdapterState(sessionId)
  const objs = loadFixture(name)
  return objs.flatMap((obj) => adaptCodexObj(obj, state))
}

function eventsOfType<T extends AgentEvent['type']>(
  events: AgentEvent[],
  type: T,
): Extract<AgentEvent, { type: T }>[] {
  return events.filter((e): e is Extract<AgentEvent, { type: T }> => e.type === type)
}

// ---------------------------------------------------------------------------
// Fixture: simple-text.jsonl — basic text response
// ---------------------------------------------------------------------------

describe('adapter-codex — simple-text fixture', () => {
  it('emits session-init as the first AgentEvent', () => {
    const events = runFixture('simple-text.jsonl')
    expect(events[0].type).toBe('session-init')
  })

  it('session-init has provider: codex', () => {
    const events = runFixture('simple-text.jsonl')
    const init = eventsOfType(events, 'session-init')[0]
    expect(init.provider).toBe('codex')
  })

  it('session-init carries the caller-supplied sessionId, not the CLI thread id', () => {
    const events = runFixture('simple-text.jsonl', 'my-session-99')
    const init = eventsOfType(events, 'session-init')[0]
    expect(init.sessionId).toBe('my-session-99')
  })

  it('session-init cliSessionId is the thread id from thread/started', () => {
    const events = runFixture('simple-text.jsonl')
    const init = eventsOfType(events, 'session-init')[0]
    expect(init.cliSessionId).toBe('thread-abc123')
  })

  it('session-init cwd is the thread cwd', () => {
    const events = runFixture('simple-text.jsonl')
    const init = eventsOfType(events, 'session-init')[0]
    expect(init.cwd).toBe('/Users/test/vault')
  })

  it('session-init startedAt is a positive number', () => {
    const events = runFixture('simple-text.jsonl')
    const init = eventsOfType(events, 'session-init')[0]
    expect(init.startedAt).toBeGreaterThan(0)
  })

  it('emits message-start with role assistant', () => {
    const events = runFixture('simple-text.jsonl')
    const ms = eventsOfType(events, 'message-start')
    expect(ms.length).toBeGreaterThanOrEqual(1)
    expect(ms[0].role).toBe('assistant')
  })

  it('message-start messageId is prefixed with codex-', () => {
    const events = runFixture('simple-text.jsonl')
    const ms = eventsOfType(events, 'message-start')[0]
    expect(ms.messageId).toMatch(/^codex-/)
  })

  it('emits at least one text-delta', () => {
    const events = runFixture('simple-text.jsonl')
    const deltas = eventsOfType(events, 'text-delta')
    expect(deltas.length).toBeGreaterThanOrEqual(1)
  })

  it('text-delta values join to the full response text', () => {
    const events = runFixture('simple-text.jsonl')
    const deltas = eventsOfType(events, 'text-delta')
    const fullText = deltas.map((d) => d.delta).join('')
    expect(fullText).toBe('Hello, world!')
  })

  it('text-delta seq values are monotonically increasing', () => {
    const events = runFixture('simple-text.jsonl')
    const deltas = eventsOfType(events, 'text-delta')
    for (let i = 1; i < deltas.length; i++) {
      expect(deltas[i].seq).toBeGreaterThan(deltas[i - 1].seq)
    }
  })

  it('text-delta events share messageId with message-start', () => {
    const events = runFixture('simple-text.jsonl')
    const ms = eventsOfType(events, 'message-start')[0]
    const deltas = eventsOfType(events, 'text-delta')
    expect(deltas.every((d) => d.messageId === ms.messageId)).toBe(true)
  })

  it('emits message-end with stopReason end_turn', () => {
    const events = runFixture('simple-text.jsonl')
    const ends = eventsOfType(events, 'message-end')
    expect(ends.length).toBeGreaterThanOrEqual(1)
    expect(ends[0].stopReason).toBe('end_turn')
  })

  it('emits exactly one turn-result', () => {
    const events = runFixture('simple-text.jsonl')
    const results = eventsOfType(events, 'turn-result')
    expect(results).toHaveLength(1)
  })

  it('turn-result usage has positive inputTokens and outputTokens', () => {
    const events = runFixture('simple-text.jsonl')
    const result = eventsOfType(events, 'turn-result')[0]
    expect(result.usage.inputTokens).toBeGreaterThan(0)
    expect(result.usage.outputTokens).toBeGreaterThan(0)
  })

  it('turn-result durationMs is positive', () => {
    const events = runFixture('simple-text.jsonl')
    const result = eventsOfType(events, 'turn-result')[0]
    expect(result.durationMs).toBeGreaterThan(0)
  })

  it('emits no error events', () => {
    const events = runFixture('simple-text.jsonl')
    expect(eventsOfType(events, 'error')).toHaveLength(0)
  })

  it('emits no crashed events', () => {
    const events = runFixture('simple-text.jsonl')
    expect(eventsOfType(events, 'crashed')).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Fixture: command-execution.jsonl — Bash tool call
// ---------------------------------------------------------------------------

describe('adapter-codex — command-execution fixture', () => {
  it('emits session-init first', () => {
    const events = runFixture('command-execution.jsonl')
    expect(events[0].type).toBe('session-init')
  })

  it('emits at least one tool-use event with name Bash', () => {
    const events = runFixture('command-execution.jsonl')
    const toolUses = eventsOfType(events, 'tool-use')
    expect(toolUses.length).toBeGreaterThanOrEqual(1)
    const bash = toolUses.find((e) => e.name === 'Bash')
    expect(bash).toBeDefined()
  })

  it('tool-use Bash has command in input', () => {
    const events = runFixture('command-execution.jsonl')
    const bash = eventsOfType(events, 'tool-use').find((e) => e.name === 'Bash')
    expect(bash).toBeDefined()
    expect((bash!.input as Record<string, unknown>).command).toBe('ls -la')
  })

  it('tool-use Bash has cwd in input', () => {
    const events = runFixture('command-execution.jsonl')
    const bash = eventsOfType(events, 'tool-use').find((e) => e.name === 'Bash')
    expect((bash!.input as Record<string, unknown>).cwd).toBe('/Users/test/vault')
  })

  it('emits tool-result for the command execution', () => {
    const events = runFixture('command-execution.jsonl')
    const results = eventsOfType(events, 'tool-result')
    expect(results.length).toBeGreaterThanOrEqual(1)
  })

  it('tool-result toolUseId matches the preceding tool-use toolUseId', () => {
    const events = runFixture('command-execution.jsonl')
    const toolUseIds = new Set(eventsOfType(events, 'tool-use').map((e) => e.toolUseId))
    const toolResultIds = eventsOfType(events, 'tool-result').map((e) => e.toolUseId)
    for (const resultId of toolResultIds) {
      expect(toolUseIds.has(resultId)).toBe(true)
    }
  })

  it('tool-result isError is false for successful command', () => {
    const events = runFixture('command-execution.jsonl')
    const results = eventsOfType(events, 'tool-result')
    expect(results[0].isError).toBe(false)
  })

  it('tool-result output contains aggregated command output', () => {
    const events = runFixture('command-execution.jsonl')
    const results = eventsOfType(events, 'tool-result')
    expect(typeof results[0].output).toBe('string')
    expect(String(results[0].output).length).toBeGreaterThan(0)
  })

  it('tool-result durationMs reflects command execution time', () => {
    const events = runFixture('command-execution.jsonl')
    const results = eventsOfType(events, 'tool-result')
    expect(results[0].durationMs).toBeGreaterThanOrEqual(0)
  })

  it('emits text-delta events in the final assistant turn', () => {
    const events = runFixture('command-execution.jsonl')
    const deltas = eventsOfType(events, 'text-delta')
    expect(deltas.length).toBeGreaterThanOrEqual(1)
  })

  it('emits exactly one turn-result', () => {
    const events = runFixture('command-execution.jsonl')
    expect(eventsOfType(events, 'turn-result')).toHaveLength(1)
  })

  it('commandExecution tool-use is not emitted twice (idempotency)', () => {
    const state = makeCodexAdapterState('s')
    const itemStarted = {
      jsonrpc: '2.0',
      method: 'item/started',
      params: {
        item: { type: 'commandExecution', id: 'exec-idem', command: 'echo hi', cwd: '/tmp', status: 'inProgress', commandActions: [], aggregatedOutput: null, exitCode: null, durationMs: null },
        threadId: 'thread-x',
        turnId: 'turn-x',
        startedAtMs: 1000,
      },
    }
    const events1 = adaptCodexObj(itemStarted, state)
    const events2 = adaptCodexObj(itemStarted, state)
    const toolUses1 = eventsOfType(events1, 'tool-use')
    const toolUses2 = eventsOfType(events2, 'tool-use')
    expect(toolUses1).toHaveLength(1)
    expect(toolUses2).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Fixture: file-change.jsonl — file edit tool call
// ---------------------------------------------------------------------------

describe('adapter-codex — file-change fixture', () => {
  it('emits session-init first', () => {
    const events = runFixture('file-change.jsonl')
    expect(events[0].type).toBe('session-init')
  })

  it('emits tool-use for file change with name Edit or Write', () => {
    const events = runFixture('file-change.jsonl')
    const toolUses = eventsOfType(events, 'tool-use')
    const fileTools = toolUses.filter((e) => e.name === 'Edit' || e.name === 'Write')
    expect(fileTools.length).toBeGreaterThanOrEqual(1)
  })

  it('Edit tool-use has changes in input', () => {
    const events = runFixture('file-change.jsonl')
    const editTool = eventsOfType(events, 'tool-use').find(
      (e) => e.name === 'Edit' || e.name === 'Write',
    )
    expect(editTool).toBeDefined()
    expect((editTool!.input as Record<string, unknown>).changes).toBeDefined()
  })

  it('emits tool-result for file change', () => {
    const events = runFixture('file-change.jsonl')
    const results = eventsOfType(events, 'tool-result')
    expect(results.length).toBeGreaterThanOrEqual(1)
  })

  it('fileChange tool-use is not emitted twice (idempotency)', () => {
    const state = makeCodexAdapterState('s')
    const itemStarted = {
      jsonrpc: '2.0',
      method: 'item/started',
      params: {
        item: {
          type: 'fileChange',
          id: 'fc-idem',
          changes: [{ path: '/tmp/a.md', kind: { type: 'update', move_path: null }, diff: '@@' }],
          status: 'inProgress',
        },
        threadId: 'thread-x',
        turnId: 'turn-x',
        startedAtMs: 1000,
      },
    }
    const events1 = adaptCodexObj(itemStarted, state)
    const events2 = adaptCodexObj(itemStarted, state)
    expect(eventsOfType(events1, 'tool-use')).toHaveLength(1)
    expect(eventsOfType(events2, 'tool-use')).toHaveLength(0)
  })

  it('emits exactly one turn-result', () => {
    const events = runFixture('file-change.jsonl')
    expect(eventsOfType(events, 'turn-result')).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Fixture: reasoning.jsonl — thinking/reasoning delta
// ---------------------------------------------------------------------------

describe('adapter-codex — reasoning fixture', () => {
  it('emits session-init first', () => {
    const events = runFixture('reasoning.jsonl')
    expect(events[0].type).toBe('session-init')
  })

  it('emits at least one thinking-delta', () => {
    const events = runFixture('reasoning.jsonl')
    const thinking = eventsOfType(events, 'thinking-delta')
    expect(thinking.length).toBeGreaterThanOrEqual(1)
  })

  it('thinking-delta values join to the full reasoning text', () => {
    const events = runFixture('reasoning.jsonl')
    const thinking = eventsOfType(events, 'thinking-delta')
    const full = thinking.map((d) => d.delta).join('')
    expect(full).toContain('Let me think')
  })

  it('thinking-delta seq values are monotonically increasing', () => {
    const events = runFixture('reasoning.jsonl')
    const thinking = eventsOfType(events, 'thinking-delta')
    for (let i = 1; i < thinking.length; i++) {
      expect(thinking[i].seq).toBeGreaterThan(thinking[i - 1].seq)
    }
  })

  it('reasoning and text-delta seq values are strictly monotonically increasing across both', () => {
    const events = runFixture('reasoning.jsonl')
    const allDeltas = events.filter(
      (e): e is Extract<AgentEvent, { type: 'text-delta' | 'thinking-delta' }> =>
        e.type === 'text-delta' || e.type === 'thinking-delta',
    )
    for (let i = 1; i < allDeltas.length; i++) {
      expect(allDeltas[i].seq).toBeGreaterThan(allDeltas[i - 1].seq)
    }
  })

  it('emits exactly one turn-result', () => {
    const events = runFixture('reasoning.jsonl')
    expect(eventsOfType(events, 'turn-result')).toHaveLength(1)
  })

  it('emits no error events', () => {
    const events = runFixture('reasoning.jsonl')
    expect(eventsOfType(events, 'error')).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Fixture: error.jsonl — server error notification
// ---------------------------------------------------------------------------

describe('adapter-codex — error fixture', () => {
  it('emits an error event', () => {
    const events = runFixture('error.jsonl')
    const errors = eventsOfType(events, 'error')
    expect(errors.length).toBeGreaterThanOrEqual(1)
  })

  it('error event has AGENT_NOT_AUTHENTICATED code for unauthorized', () => {
    const events = runFixture('error.jsonl')
    const error = eventsOfType(events, 'error')[0]
    expect(error.code).toBe('AGENT_NOT_AUTHENTICATED')
  })

  it('error event is not recoverable for authentication errors', () => {
    const events = runFixture('error.jsonl')
    const error = eventsOfType(events, 'error')[0]
    expect(error.recoverable).toBe(false)
  })

  it('error event carries the message string', () => {
    const events = runFixture('error.jsonl')
    const error = eventsOfType(events, 'error')[0]
    expect(typeof error.message).toBe('string')
    expect(error.message.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// Unit tests for adaptCodexObj edge cases
// ---------------------------------------------------------------------------

describe('adaptCodexObj — edge cases', () => {
  it('returns [] for null input', () => {
    const state = makeCodexAdapterState('s')
    expect(adaptCodexObj(null, state)).toEqual([])
  })

  it('returns [] for non-object input', () => {
    const state = makeCodexAdapterState('s')
    expect(adaptCodexObj('string', state)).toEqual([])
    expect(adaptCodexObj(42, state)).toEqual([])
  })

  it('returns [] for objects without jsonrpc: 2.0', () => {
    const state = makeCodexAdapterState('s')
    expect(adaptCodexObj({ jsonrpc: '1.0', method: 'thread/started', params: {} }, state)).toEqual([])
  })

  it('returns [] for JSON-RPC response (id + result)', () => {
    const state = makeCodexAdapterState('s')
    const result = adaptCodexObj({ jsonrpc: '2.0', id: 1, result: { userAgent: 'codex' } }, state)
    expect(result).toEqual([])
  })

  it('JSON-RPC response marks state as initialized', () => {
    const state = makeCodexAdapterState('s')
    expect(state.initialized).toBe(false)
    adaptCodexObj({ jsonrpc: '2.0', id: 1, result: { userAgent: 'codex' } }, state)
    expect(state.initialized).toBe(true)
  })

  it('returns [] for unknown method', () => {
    const state = makeCodexAdapterState('s')
    expect(adaptCodexObj({ jsonrpc: '2.0', method: 'totally/unknown', params: {} }, state)).toEqual([])
  })

  it('returns [] for notification without method field', () => {
    const state = makeCodexAdapterState('s')
    expect(adaptCodexObj({ jsonrpc: '2.0', params: {} }, state)).toEqual([])
  })

  it('thread/started with missing thread returns []', () => {
    const state = makeCodexAdapterState('s')
    expect(adaptCodexObj({ jsonrpc: '2.0', method: 'thread/started', params: {} }, state)).toEqual([])
  })

  it('thread/started sets cliSessionId on state', () => {
    const state = makeCodexAdapterState('s')
    adaptCodexObj({
      jsonrpc: '2.0',
      method: 'thread/started',
      params: {
        thread: { id: 'tid-x', sessionId: 'sid-x', cwd: '/tmp', modelProvider: 'openai', cliVersion: '1.0' },
      },
    }, state)
    expect(state.cliSessionId).toBe('tid-x')
    expect(state.currentThreadId).toBe('tid-x')
    expect(state.cwd).toBe('/tmp')
  })

  it('item/agentMessage/delta with empty delta returns []', () => {
    const state = makeCodexAdapterState('s')
    const result = adaptCodexObj({
      jsonrpc: '2.0',
      method: 'item/agentMessage/delta',
      params: { threadId: 't', turnId: 'tu', itemId: 'item-x', delta: '' },
    }, state)
    expect(result).toEqual([])
  })

  it('item/reasoning/textDelta with empty delta returns []', () => {
    const state = makeCodexAdapterState('s')
    const result = adaptCodexObj({
      jsonrpc: '2.0',
      method: 'item/reasoning/textDelta',
      params: { threadId: 't', turnId: 'tu', itemId: 'item-x', delta: '', contentIndex: 0 },
    }, state)
    expect(result).toEqual([])
  })

  it('item/completed for unknown item type returns []', () => {
    const state = makeCodexAdapterState('s')
    const result = adaptCodexObj({
      jsonrpc: '2.0',
      method: 'item/completed',
      params: {
        item: { type: 'unknownItemType', id: 'item-y' },
        threadId: 't',
        turnId: 'tu',
        completedAtMs: 1000,
      },
    }, state)
    expect(result).toEqual([])
  })

  it('item/completed for commandExecution with failed status marks isError true', () => {
    const state = makeCodexAdapterState('s')
    const result = adaptCodexObj({
      jsonrpc: '2.0',
      method: 'item/completed',
      params: {
        item: {
          type: 'commandExecution',
          id: 'exec-fail',
          command: 'bad-cmd',
          cwd: '/tmp',
          status: 'failed',
          commandActions: [],
          aggregatedOutput: 'command not found',
          exitCode: 127,
          durationMs: 100,
        },
        threadId: 't',
        turnId: 'tu',
        completedAtMs: 2000,
      },
    }, state)
    const toolResult = eventsOfType(result, 'tool-result')[0]
    expect(toolResult).toBeDefined()
    expect(toolResult.isError).toBe(true)
  })

  it('item/completed for commandExecution with declined status marks isError true', () => {
    const state = makeCodexAdapterState('s')
    const result = adaptCodexObj({
      jsonrpc: '2.0',
      method: 'item/completed',
      params: {
        item: {
          type: 'commandExecution',
          id: 'exec-declined',
          command: 'rm -rf /',
          cwd: '/tmp',
          status: 'declined',
          commandActions: [],
          aggregatedOutput: null,
          exitCode: null,
          durationMs: 0,
        },
        threadId: 't',
        turnId: 'tu',
        completedAtMs: 2000,
      },
    }, state)
    const toolResult = eventsOfType(result, 'tool-result')[0]
    expect(toolResult.isError).toBe(true)
  })

  it('fileChange with add kind maps to Write tool', () => {
    const state = makeCodexAdapterState('s')
    const result = adaptCodexObj({
      jsonrpc: '2.0',
      method: 'item/started',
      params: {
        item: {
          type: 'fileChange',
          id: 'fc-add',
          changes: [{ path: '/tmp/new.md', kind: { type: 'add' }, diff: '' }],
          status: 'inProgress',
        },
        threadId: 't',
        turnId: 'tu',
        startedAtMs: 1000,
      },
    }, state)
    const toolUse = eventsOfType(result, 'tool-use')[0]
    expect(toolUse).toBeDefined()
    expect(toolUse.name).toBe('Write')
  })

  it('fileChange with update kind maps to Edit tool', () => {
    const state = makeCodexAdapterState('s')
    const result = adaptCodexObj({
      jsonrpc: '2.0',
      method: 'item/started',
      params: {
        item: {
          type: 'fileChange',
          id: 'fc-upd',
          changes: [{ path: '/tmp/old.md', kind: { type: 'update', move_path: null }, diff: '@@' }],
          status: 'inProgress',
        },
        threadId: 't',
        turnId: 'tu',
        startedAtMs: 1000,
      },
    }, state)
    const toolUse = eventsOfType(result, 'tool-use')[0]
    expect(toolUse).toBeDefined()
    expect(toolUse.name).toBe('Edit')
  })

  it('classifies usageLimitExceeded as AGENT_RATE_LIMITED (recoverable)', () => {
    const state = makeCodexAdapterState('s')
    const result = adaptCodexObj({
      jsonrpc: '2.0',
      method: 'error',
      params: {
        error: { message: 'usage limit exceeded', codexErrorInfo: 'usageLimitExceeded' },
        willRetry: true,
        threadId: 't',
        turnId: 'tu',
      },
    }, state)
    const error = eventsOfType(result, 'error')[0]
    expect(error.code).toBe('AGENT_RATE_LIMITED')
    expect(error.recoverable).toBe(true)
  })

  it('classifies serverOverloaded as AGENT_RATE_LIMITED (recoverable)', () => {
    const state = makeCodexAdapterState('s')
    const result = adaptCodexObj({
      jsonrpc: '2.0',
      method: 'error',
      params: {
        error: { message: 'server overloaded', codexErrorInfo: 'serverOverloaded' },
        willRetry: true,
        threadId: 't',
        turnId: 'tu',
      },
    }, state)
    const error = eventsOfType(result, 'error')[0]
    expect(error.code).toBe('AGENT_RATE_LIMITED')
    expect(error.recoverable).toBe(true)
  })

  it('classifies httpConnectionFailed as AGENT_NETWORK (recoverable)', () => {
    const state = makeCodexAdapterState('s')
    const result = adaptCodexObj({
      jsonrpc: '2.0',
      method: 'error',
      params: {
        error: { message: 'connection failed', codexErrorInfo: { httpConnectionFailed: { httpStatusCode: null } } },
        willRetry: false,
        threadId: 't',
        turnId: 'tu',
      },
    }, state)
    const error = eventsOfType(result, 'error')[0]
    expect(error.code).toBe('AGENT_NETWORK')
    expect(error.recoverable).toBe(true)
  })

  it('classifies responseStreamConnectionFailed as AGENT_NETWORK', () => {
    const state = makeCodexAdapterState('s')
    const result = adaptCodexObj({
      jsonrpc: '2.0',
      method: 'error',
      params: {
        error: { message: 'stream disconnected', codexErrorInfo: { responseStreamConnectionFailed: { httpStatusCode: 503 } } },
        willRetry: false,
        threadId: 't',
        turnId: 'tu',
      },
    }, state)
    const error = eventsOfType(result, 'error')[0]
    expect(error.code).toBe('AGENT_NETWORK')
  })

  it('classifies other/unknown codexErrorInfo as AGENT_INTERNAL', () => {
    const state = makeCodexAdapterState('s')
    const result = adaptCodexObj({
      jsonrpc: '2.0',
      method: 'error',
      params: {
        error: { message: 'unknown error', codexErrorInfo: 'other' },
        willRetry: false,
        threadId: 't',
        turnId: 'tu',
      },
    }, state)
    const error = eventsOfType(result, 'error')[0]
    expect(error.code).toBe('AGENT_INTERNAL')
    expect(error.recoverable).toBe(false)
  })

  it('thread/tokenUsage/updated accumulates token counts on state', () => {
    const state = makeCodexAdapterState('s')
    adaptCodexObj({
      jsonrpc: '2.0',
      method: 'thread/tokenUsage/updated',
      params: {
        threadId: 't',
        turnId: 'tu',
        tokenUsage: {
          total: { totalTokens: 500, inputTokens: 300, cachedInputTokens: 50, outputTokens: 200, reasoningOutputTokens: 0 },
          last: { totalTokens: 150, inputTokens: 100, cachedInputTokens: 20, outputTokens: 50, reasoningOutputTokens: 0 },
          modelContextWindow: 128000,
        },
      },
    }, state)
    expect(state.inputTokens).toBe(100)
    expect(state.outputTokens).toBe(50)
    expect(state.cacheReadTokens).toBe(20)
  })

  it('turn/completed emits turn-result with durationMs from turn object', () => {
    const state = makeCodexAdapterState('s')
    const result = adaptCodexObj({
      jsonrpc: '2.0',
      method: 'turn/completed',
      params: {
        threadId: 't',
        turn: { id: 'turn-x', items: [], itemsView: 'partial', status: 'completed', error: null, startedAt: 1716000000, completedAt: 1716000005, durationMs: 5000 },
      },
    }, state)
    const turnResult = eventsOfType(result, 'turn-result')[0]
    expect(turnResult).toBeDefined()
    expect(turnResult.durationMs).toBe(5000)
  })

  it('turn/completed with null durationMs uses 0', () => {
    const state = makeCodexAdapterState('s')
    const result = adaptCodexObj({
      jsonrpc: '2.0',
      method: 'turn/completed',
      params: {
        threadId: 't',
        turn: { id: 'turn-x', items: [], itemsView: 'partial', status: 'completed', error: null, startedAt: null, completedAt: null, durationMs: null },
      },
    }, state)
    const turnResult = eventsOfType(result, 'turn-result')[0]
    expect(turnResult.durationMs).toBe(0)
  })

  it('turn/completed costUSD is always 0 (Codex does not expose cost)', () => {
    const state = makeCodexAdapterState('s')
    const result = adaptCodexObj({
      jsonrpc: '2.0',
      method: 'turn/completed',
      params: {
        threadId: 't',
        turn: { id: 'tu', items: [], itemsView: 'partial', status: 'completed', error: null, startedAt: null, completedAt: null, durationMs: 100 },
      },
    }, state)
    const turnResult = eventsOfType(result, 'turn-result')[0]
    expect(turnResult.costUSD).toBe(0)
  })

  it('makeCodexAdapterState initializes all counters to zero', () => {
    const state = makeCodexAdapterState('init-test')
    expect(state.seq).toBe(0)
    expect(state.inputTokens).toBe(0)
    expect(state.outputTokens).toBe(0)
    expect(state.cacheReadTokens).toBe(0)
    expect(state.cliSessionId).toBe('')
    expect(state.currentItemId).toBe('')
    expect(state.initialized).toBe(false)
    expect(state.emittedToolUseIds.size).toBe(0)
    expect(state.itemMessageIds.size).toBe(0)
  })

  it('known no-op notifications return []', () => {
    const state = makeCodexAdapterState('s')
    const noOpMethods = [
      'turn/started',
      'turn/diff/updated',
      'hook/started',
      'hook/completed',
      'item/commandExecution/outputDelta',
      'item/fileChange/outputDelta',
      'warning',
      'model/rerouted',
      'fs/changed',
      'skills/changed',
    ]
    for (const method of noOpMethods) {
      const result = adaptCodexObj({ jsonrpc: '2.0', method, params: {} }, state)
      expect(result).toEqual([])
    }
  })

  it('item/started for agentMessage emits message-start', () => {
    const state = makeCodexAdapterState('s')
    const result = adaptCodexObj({
      jsonrpc: '2.0',
      method: 'item/started',
      params: {
        item: { type: 'agentMessage', id: 'msg-x', text: '', phase: null, memoryCitation: null },
        threadId: 't',
        turnId: 'tu',
        startedAtMs: 1000,
      },
    }, state)
    expect(result.map((e) => e.type)).toEqual(['message-start'])
    if (result[0].type === 'message-start') {
      expect(result[0].role).toBe('assistant')
    }
  })

  it('item/started for reasoning emits message-start', () => {
    const state = makeCodexAdapterState('s')
    const result = adaptCodexObj({
      jsonrpc: '2.0',
      method: 'item/started',
      params: {
        item: { type: 'reasoning', id: 'rsn-x', summary: [], content: [] },
        threadId: 't',
        turnId: 'tu',
        startedAtMs: 1000,
      },
    }, state)
    expect(result.map((e) => e.type)).toEqual(['message-start'])
  })

  it('item/started for unknown item type returns []', () => {
    const state = makeCodexAdapterState('s')
    const result = adaptCodexObj({
      jsonrpc: '2.0',
      method: 'item/started',
      params: {
        item: { type: 'unknownType', id: 'unk-x' },
        threadId: 't',
        turnId: 'tu',
        startedAtMs: 1000,
      },
    }, state)
    expect(result).toEqual([])
  })

  it('item/completed for agentMessage emits message-end', () => {
    const state = makeCodexAdapterState('s')
    const result = adaptCodexObj({
      jsonrpc: '2.0',
      method: 'item/completed',
      params: {
        item: { type: 'agentMessage', id: 'msg-y', text: 'done', phase: null, memoryCitation: null },
        threadId: 't',
        turnId: 'tu',
        completedAtMs: 2000,
      },
    }, state)
    expect(result.map((e) => e.type)).toEqual(['message-end'])
    if (result[0].type === 'message-end') {
      expect(result[0].stopReason).toBe('end_turn')
    }
  })
})
