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
  type: T
): Extract<AgentEvent, { type: T }>[] {
  return events.filter((e): e is Extract<AgentEvent, { type: T }> => e.type === type)
}

// ---------------------------------------------------------------------------
// Fixture: simple-text.jsonl — basic text response (codex exec --json format)
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

  it('session-init carries the caller-supplied sessionId', () => {
    const events = runFixture('simple-text.jsonl', 'my-session-99')
    const init = eventsOfType(events, 'session-init')[0]
    expect(init.sessionId).toBe('my-session-99')
  })

  it('session-init cliSessionId is the thread_id from thread.started', () => {
    const events = runFixture('simple-text.jsonl')
    const init = eventsOfType(events, 'session-init')[0]
    expect(init.cliSessionId).toBe('019e52fc-3c86-7d33-9563-c6f23dfcac79')
  })

  it('session-init startedAt is a positive number', () => {
    const events = runFixture('simple-text.jsonl')
    const init = eventsOfType(events, 'session-init')[0]
    expect(init.startedAt).toBeGreaterThan(0)
  })

  it('emits message-start with role assistant after turn.started', () => {
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

  it('emits exactly one text-delta with the full response text', () => {
    const events = runFixture('simple-text.jsonl')
    const deltas = eventsOfType(events, 'text-delta')
    expect(deltas).toHaveLength(1)
    expect(deltas[0].delta).toBe('Hello, world!')
  })

  it('text-delta messageId matches message-start messageId', () => {
    const events = runFixture('simple-text.jsonl')
    const ms = eventsOfType(events, 'message-start')[0]
    const delta = eventsOfType(events, 'text-delta')[0]
    expect(delta.messageId).toBe(ms.messageId)
  })

  it('text-delta seq is 0 (first and only delta)', () => {
    const events = runFixture('simple-text.jsonl')
    const delta = eventsOfType(events, 'text-delta')[0]
    expect(delta.seq).toBe(0)
  })

  it('emits message-end with stopReason end_turn', () => {
    const events = runFixture('simple-text.jsonl')
    const ends = eventsOfType(events, 'message-end')
    expect(ends).toHaveLength(1)
    expect(ends[0].stopReason).toBe('end_turn')
  })

  it('message-end messageId matches message-start messageId', () => {
    const events = runFixture('simple-text.jsonl')
    const ms = eventsOfType(events, 'message-start')[0]
    const end = eventsOfType(events, 'message-end')[0]
    expect(end.messageId).toBe(ms.messageId)
  })

  it('emits exactly one turn-result', () => {
    const events = runFixture('simple-text.jsonl')
    expect(eventsOfType(events, 'turn-result')).toHaveLength(1)
  })

  it('turn-result usage has positive inputTokens and outputTokens', () => {
    const events = runFixture('simple-text.jsonl')
    const result = eventsOfType(events, 'turn-result')[0]
    expect(result.usage.inputTokens).toBeGreaterThan(0)
    expect(result.usage.outputTokens).toBeGreaterThan(0)
  })

  it('turn-result cacheReadTokens reflects cached_input_tokens', () => {
    const events = runFixture('simple-text.jsonl')
    const result = eventsOfType(events, 'turn-result')[0]
    // The fixture has cached_input_tokens: 7040
    expect(result.usage.cacheReadTokens).toBe(7040)
  })

  it('turn-result costUSD is always 0 (codex does not expose cost)', () => {
    const events = runFixture('simple-text.jsonl')
    const result = eventsOfType(events, 'turn-result')[0]
    expect(result.costUSD).toBe(0)
  })

  it('turn-result durationMs is 0 (codex exec does not report duration)', () => {
    const events = runFixture('simple-text.jsonl')
    const result = eventsOfType(events, 'turn-result')[0]
    expect(result.durationMs).toBe(0)
  })

  it('emits no error events', () => {
    const events = runFixture('simple-text.jsonl')
    expect(eventsOfType(events, 'error')).toHaveLength(0)
  })

  it('emits no crashed events', () => {
    const events = runFixture('simple-text.jsonl')
    expect(eventsOfType(events, 'crashed')).toHaveLength(0)
  })

  it('event order is: session-init, message-start, text-delta, message-end, turn-result', () => {
    const events = runFixture('simple-text.jsonl')
    const types = events.map((e) => e.type)
    expect(types).toEqual([
      'session-init',
      'message-start',
      'text-delta',
      'message-end',
      'turn-result',
    ])
  })
})

// ---------------------------------------------------------------------------
// Fixture: tool-use.jsonl — command_execution tool call
// ---------------------------------------------------------------------------

describe('adapter-codex — tool-use fixture', () => {
  it('emits session-init first', () => {
    const events = runFixture('tool-use.jsonl')
    expect(events[0].type).toBe('session-init')
  })

  it('emits tool-use with name Bash for command_execution', () => {
    const events = runFixture('tool-use.jsonl')
    const toolUses = eventsOfType(events, 'tool-use')
    expect(toolUses.length).toBeGreaterThanOrEqual(1)
    const bash = toolUses.find((e) => e.name === 'Bash')
    expect(bash).toBeDefined()
  })

  it('tool-use Bash has command in input', () => {
    const events = runFixture('tool-use.jsonl')
    const bash = eventsOfType(events, 'tool-use').find((e) => e.name === 'Bash')
    expect((bash!.input as Record<string, unknown>).command).toContain('echo hello world')
  })

  it('emits tool-result for the command execution', () => {
    const events = runFixture('tool-use.jsonl')
    const results = eventsOfType(events, 'tool-result')
    expect(results.length).toBeGreaterThanOrEqual(1)
  })

  it('tool-result toolUseId matches preceding tool-use toolUseId', () => {
    const events = runFixture('tool-use.jsonl')
    const toolUseIds = new Set(eventsOfType(events, 'tool-use').map((e) => e.toolUseId))
    for (const result of eventsOfType(events, 'tool-result')) {
      expect(toolUseIds.has(result.toolUseId)).toBe(true)
    }
  })

  it('tool-result isError is false for exit_code 0', () => {
    const events = runFixture('tool-use.jsonl')
    const results = eventsOfType(events, 'tool-result')
    expect(results[0].isError).toBe(false)
  })

  it('tool-result output contains the command output', () => {
    const events = runFixture('tool-use.jsonl')
    const results = eventsOfType(events, 'tool-result')
    expect(String(results[0].output)).toContain('hello world')
  })

  it('emits text-delta for the agent reply after the tool', () => {
    const events = runFixture('tool-use.jsonl')
    const deltas = eventsOfType(events, 'text-delta')
    expect(deltas.length).toBeGreaterThanOrEqual(1)
  })

  it('emits exactly one turn-result', () => {
    const events = runFixture('tool-use.jsonl')
    expect(eventsOfType(events, 'turn-result')).toHaveLength(1)
  })

  it('turn-result costUSD is 0', () => {
    const events = runFixture('tool-use.jsonl')
    const result = eventsOfType(events, 'turn-result')[0]
    expect(result.costUSD).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Unit tests for adaptCodexObj — edge cases and direct calls
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

  it('returns [] for object without a type field', () => {
    const state = makeCodexAdapterState('s')
    expect(adaptCodexObj({ foo: 'bar' }, state)).toEqual([])
  })

  it('returns [] for unknown event type', () => {
    const state = makeCodexAdapterState('s')
    expect(adaptCodexObj({ type: 'totally.unknown' }, state)).toEqual([])
  })

  it('thread.started with missing thread_id returns []', () => {
    const state = makeCodexAdapterState('s')
    expect(adaptCodexObj({ type: 'thread.started' }, state)).toEqual([])
  })

  it('thread.started sets cliSessionId on state', () => {
    const state = makeCodexAdapterState('s')
    adaptCodexObj({ type: 'thread.started', thread_id: 'tid-abc' }, state)
    expect(state.cliSessionId).toBe('tid-abc')
  })

  it('thread.started emits session-init with the correct cliSessionId', () => {
    const state = makeCodexAdapterState('s')
    const result = adaptCodexObj({ type: 'thread.started', thread_id: 'uuid-xyz' }, state)
    const init = eventsOfType(result, 'session-init')[0]
    expect(init).toBeDefined()
    expect(init.cliSessionId).toBe('uuid-xyz')
    expect(init.provider).toBe('codex')
  })

  it('turn.started emits message-start with role assistant', () => {
    const state = makeCodexAdapterState('s')
    const result = adaptCodexObj({ type: 'turn.started' }, state)
    const ms = eventsOfType(result, 'message-start')[0]
    expect(ms).toBeDefined()
    expect(ms.role).toBe('assistant')
  })

  it('turn.started messageId is prefixed with codex-', () => {
    const state = makeCodexAdapterState('s')
    const result = adaptCodexObj({ type: 'turn.started' }, state)
    const ms = eventsOfType(result, 'message-start')[0]
    expect(ms.messageId).toMatch(/^codex-/)
  })

  it('item.started for command_execution emits tool-use with name Bash', () => {
    const state = makeCodexAdapterState('s')
    const result = adaptCodexObj(
      {
        type: 'item.started',
        item: {
          id: 'item_0',
          type: 'command_execution',
          command: 'ls -la',
          status: 'in_progress',
          aggregated_output: '',
          exit_code: null,
        },
      },
      state
    )
    const toolUse = eventsOfType(result, 'tool-use')[0]
    expect(toolUse).toBeDefined()
    expect(toolUse.name).toBe('Bash')
    expect((toolUse.input as Record<string, unknown>).command).toBe('ls -la')
  })

  it('item.started for command_execution is idempotent (no double tool-use)', () => {
    const state = makeCodexAdapterState('s')
    const itemStarted = {
      type: 'item.started',
      item: {
        id: 'item_idem',
        type: 'command_execution',
        command: 'echo hi',
        status: 'in_progress',
        aggregated_output: '',
        exit_code: null,
      },
    }
    const events1 = adaptCodexObj(itemStarted, state)
    const events2 = adaptCodexObj(itemStarted, state)
    expect(eventsOfType(events1, 'tool-use')).toHaveLength(1)
    expect(eventsOfType(events2, 'tool-use')).toHaveLength(0)
  })

  it('item.started for unknown item type returns []', () => {
    const state = makeCodexAdapterState('s')
    const result = adaptCodexObj(
      {
        type: 'item.started',
        item: { id: 'item_x', type: 'unknown_type' },
      },
      state
    )
    expect(result).toEqual([])
  })

  it('item.completed for agent_message emits text-delta and message-end', () => {
    const state = makeCodexAdapterState('s')
    // Set up currentMessageId via turn.started
    adaptCodexObj({ type: 'turn.started' }, state)
    const result = adaptCodexObj(
      {
        type: 'item.completed',
        item: { id: 'item_0', type: 'agent_message', text: 'hello there' },
      },
      state
    )
    const types = result.map((e) => e.type)
    expect(types).toEqual(['text-delta', 'message-end'])
    if (result[0].type === 'text-delta') {
      expect(result[0].delta).toBe('hello there')
    }
  })

  it('item.completed for agent_message with empty text emits only message-end', () => {
    const state = makeCodexAdapterState('s')
    adaptCodexObj({ type: 'turn.started' }, state)
    const result = adaptCodexObj(
      {
        type: 'item.completed',
        item: { id: 'item_empty', type: 'agent_message', text: '' },
      },
      state
    )
    expect(result.map((e) => e.type)).toEqual(['message-end'])
  })

  it('item.completed for agent_message is idempotent (no double text-delta)', () => {
    const state = makeCodexAdapterState('s')
    adaptCodexObj({ type: 'turn.started' }, state)
    const completed = {
      type: 'item.completed',
      item: { id: 'item_idem', type: 'agent_message', text: 'hi' },
    }
    const events1 = adaptCodexObj(completed, state)
    const events2 = adaptCodexObj(completed, state)
    expect(eventsOfType(events1, 'text-delta')).toHaveLength(1)
    expect(eventsOfType(events2, 'text-delta')).toHaveLength(0)
  })

  it('item.completed for command_execution with exit_code 0 emits tool-result with isError false', () => {
    const state = makeCodexAdapterState('s')
    const result = adaptCodexObj(
      {
        type: 'item.completed',
        item: {
          id: 'item_0',
          type: 'command_execution',
          command: 'echo hi',
          aggregated_output: 'hi\n',
          exit_code: 0,
          status: 'completed',
        },
      },
      state
    )
    const toolResult = eventsOfType(result, 'tool-result')[0]
    expect(toolResult).toBeDefined()
    expect(toolResult.isError).toBe(false)
    expect(toolResult.output).toContain('hi')
  })

  it('item.completed for command_execution with non-zero exit_code emits tool-result with isError true', () => {
    const state = makeCodexAdapterState('s')
    const result = adaptCodexObj(
      {
        type: 'item.completed',
        item: {
          id: 'item_1',
          type: 'command_execution',
          command: 'bad-cmd',
          aggregated_output: 'not found',
          exit_code: 127,
          status: 'failed',
        },
      },
      state
    )
    const toolResult = eventsOfType(result, 'tool-result')[0]
    expect(toolResult).toBeDefined()
    expect(toolResult.isError).toBe(true)
  })

  it('item.completed for command_execution with failed status emits tool-result with isError true', () => {
    const state = makeCodexAdapterState('s')
    const result = adaptCodexObj(
      {
        type: 'item.completed',
        item: {
          id: 'item_2',
          type: 'command_execution',
          command: 'bad',
          aggregated_output: null,
          exit_code: null,
          status: 'failed',
        },
      },
      state
    )
    const toolResult = eventsOfType(result, 'tool-result')[0]
    expect(toolResult.isError).toBe(true)
  })

  it('item.completed for unknown item type returns []', () => {
    const state = makeCodexAdapterState('s')
    const result = adaptCodexObj(
      {
        type: 'item.completed',
        item: { id: 'item_x', type: 'mystery_type' },
      },
      state
    )
    expect(result).toEqual([])
  })

  it('item.completed with missing item returns []', () => {
    const state = makeCodexAdapterState('s')
    const result = adaptCodexObj({ type: 'item.completed' }, state)
    expect(result).toEqual([])
  })

  it('turn.completed emits turn-result with usage from the event', () => {
    const state = makeCodexAdapterState('s')
    const result = adaptCodexObj(
      {
        type: 'turn.completed',
        usage: {
          input_tokens: 100,
          cached_input_tokens: 20,
          output_tokens: 50,
          reasoning_output_tokens: 5,
        },
      },
      state
    )
    const turnResult = eventsOfType(result, 'turn-result')[0]
    expect(turnResult).toBeDefined()
    expect(turnResult.usage.inputTokens).toBe(100)
    expect(turnResult.usage.outputTokens).toBe(50)
    expect(turnResult.usage.cacheReadTokens).toBe(20)
  })

  it('turn.completed costUSD is always 0', () => {
    const state = makeCodexAdapterState('s')
    const result = adaptCodexObj(
      {
        type: 'turn.completed',
        usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 5 },
      },
      state
    )
    const turnResult = eventsOfType(result, 'turn-result')[0]
    expect(turnResult.costUSD).toBe(0)
  })

  it('turn.completed durationMs is 0 (codex exec does not report it)', () => {
    const state = makeCodexAdapterState('s')
    const result = adaptCodexObj(
      {
        type: 'turn.completed',
        usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 5 },
      },
      state
    )
    const turnResult = eventsOfType(result, 'turn-result')[0]
    expect(turnResult.durationMs).toBe(0)
  })

  it('turn.completed with missing usage returns []', () => {
    const state = makeCodexAdapterState('s')
    const result = adaptCodexObj({ type: 'turn.completed' }, state)
    expect(result).toEqual([])
  })

  it('turn.completed with zero cached tokens omits cacheReadTokens from usage', () => {
    const state = makeCodexAdapterState('s')
    const result = adaptCodexObj(
      {
        type: 'turn.completed',
        usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 5 },
      },
      state
    )
    const turnResult = eventsOfType(result, 'turn-result')[0]
    // cacheReadTokens should be undefined when 0
    expect(turnResult.usage.cacheReadTokens).toBeUndefined()
  })

  it('error event emits error with AGENT_INTERNAL code', () => {
    const state = makeCodexAdapterState('s')
    const result = adaptCodexObj({ type: 'error', message: 'something went wrong' }, state)
    const error = eventsOfType(result, 'error')[0]
    expect(error).toBeDefined()
    expect(error.code).toBe('AGENT_INTERNAL')
    expect(error.message).toBe('something went wrong')
    expect(error.recoverable).toBe(false)
  })

  it('error event with no message uses fallback string', () => {
    const state = makeCodexAdapterState('s')
    const result = adaptCodexObj({ type: 'error' }, state)
    const error = eventsOfType(result, 'error')[0]
    expect(typeof error.message).toBe('string')
    expect(error.message.length).toBeGreaterThan(0)
  })

  it('makeCodexAdapterState initializes all counters to zero', () => {
    const state = makeCodexAdapterState('init-test')
    expect(state.seq).toBe(0)
    expect(state.inputTokens).toBe(0)
    expect(state.outputTokens).toBe(0)
    expect(state.cacheReadTokens).toBe(0)
    expect(state.cliSessionId).toBe('')
    expect(state.currentMessageId).toBe('')
    expect(state.messageCounter).toBe(0)
    expect(state.emittedToolUseIds.size).toBe(0)
    expect(state.emittedTextIds.size).toBe(0)
  })

  it('seq counter increments with each text-delta emitted', () => {
    const state = makeCodexAdapterState('s')
    adaptCodexObj({ type: 'turn.started' }, state)
    adaptCodexObj(
      {
        type: 'item.completed',
        item: { id: 'item_a', type: 'agent_message', text: 'first' },
      },
      state
    )
    // Reset for second turn
    adaptCodexObj({ type: 'turn.started' }, state)
    adaptCodexObj(
      {
        type: 'item.completed',
        item: { id: 'item_b', type: 'agent_message', text: 'second' },
      },
      state
    )
    expect(state.seq).toBe(2)
  })

  it('multiple turn.started calls each generate a unique messageId', () => {
    const state = makeCodexAdapterState('s')
    const r1 = adaptCodexObj({ type: 'turn.started' }, state)
    const r2 = adaptCodexObj({ type: 'turn.started' }, state)
    const ms1 = eventsOfType(r1, 'message-start')[0]
    const ms2 = eventsOfType(r2, 'message-start')[0]
    expect(ms1.messageId).not.toBe(ms2.messageId)
  })
})
