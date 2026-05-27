import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { adaptClaudeObj, makeAdapterState } from '../agent/adapter-claude.js'
import type { AgentEvent } from '../agent/protocol.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURES = join(__dirname, '..', 'agent', '__tests__', 'fixtures', 'claude')

function loadFixture(name: string): unknown[] {
  const raw = readFileSync(join(FIXTURES, name), 'utf8')
  return raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l))
}

function runFixture(name: string, sessionId = 'test-session'): AgentEvent[] {
  const state = makeAdapterState(sessionId)
  const objs = loadFixture(name)
  return objs.flatMap((obj) => adaptClaudeObj(obj, state))
}

function eventsOfType<T extends AgentEvent['type']>(
  events: AgentEvent[],
  type: T,
): Extract<AgentEvent, { type: T }>[] {
  return events.filter((e): e is Extract<AgentEvent, { type: T }> => e.type === type)
}

// ---------------------------------------------------------------------------
// Fixture: simple-text.jsonl — real CLI output (--include-partial-messages)
//
// Format: system/init → stream_event(s) [ignored] → assistant envelope → result
// The adapter handles: system → session-init, assistant → message-start + text-delta(s),
// result → turn-result. stream_event and rate_limit_event return [].
// ---------------------------------------------------------------------------

describe('adapter-claude — simple-text fixture (real CLI)', () => {
  it('emits session-init as the first AgentEvent', () => {
    const events = runFixture('simple-text.jsonl')
    expect(events[0].type).toBe('session-init')
  })

  it('session-init has correct cliSessionId from system/init', () => {
    const events = runFixture('simple-text.jsonl')
    const init = eventsOfType(events, 'session-init')[0]
    expect(init).toBeDefined()
    expect(typeof init.cliSessionId).toBe('string')
    expect(init.cliSessionId.length).toBeGreaterThan(0)
  })

  it('session-init model is non-empty string', () => {
    const events = runFixture('simple-text.jsonl')
    const init = eventsOfType(events, 'session-init')[0]
    expect(typeof init.model).toBe('string')
    expect(init.model.length).toBeGreaterThan(0)
  })

  it('session-init carries the caller-supplied sessionId, not the CLI session_id', () => {
    const events = runFixture('simple-text.jsonl', 'my-session-99')
    const init = eventsOfType(events, 'session-init')[0]
    expect(init.sessionId).toBe('my-session-99')
  })

  it('emits message-start from the assistant envelope', () => {
    const events = runFixture('simple-text.jsonl')
    const ms = eventsOfType(events, 'message-start')
    expect(ms.length).toBeGreaterThanOrEqual(1)
    expect(ms[0].role).toBe('assistant')
    expect(typeof ms[0].messageId).toBe('string')
    expect(ms[0].messageId.length).toBeGreaterThan(0)
  })

  it('emits at least one text-delta from the assistant envelope', () => {
    const events = runFixture('simple-text.jsonl')
    const deltas = eventsOfType(events, 'text-delta')
    expect(deltas.length).toBeGreaterThanOrEqual(1)
    const fullText = deltas.map((d) => d.delta).join('')
    expect(fullText.length).toBeGreaterThan(0)
  })

  it('text-delta seq values are monotonically increasing (no duplicates)', () => {
    const events = runFixture('simple-text.jsonl')
    const deltas = eventsOfType(events, 'text-delta')
    const seqs = deltas.map((d) => d.seq)
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]).toBeGreaterThan(seqs[i - 1])
    }
  })

  it('text-delta events share messageId with first message-start', () => {
    const events = runFixture('simple-text.jsonl')
    const ms = eventsOfType(events, 'message-start')[0]
    const deltas = eventsOfType(events, 'text-delta')
    expect(deltas.every((d) => d.messageId === ms.messageId)).toBe(true)
  })

  it('rate_limit_event and system/status produce no AgentEvents', () => {
    const state = makeAdapterState('s')
    const rateLimit = adaptClaudeObj({ type: 'rate_limit_event', rate_limit_info: {} }, state)
    expect(rateLimit).toEqual([])
    const systemStatus = adaptClaudeObj({ type: 'system', subtype: 'status', status: 'requesting' }, state)
    expect(systemStatus).toEqual([])
  })

  it('stream_event unwraps and processes the inner event (no double emission with assistant envelope)', () => {
    const state = makeAdapterState('s')
    // stream_event wrapping a message_start marks the message as streamed
    const msgStartEvents = adaptClaudeObj(
      { type: 'stream_event', event: { type: 'message_start', message: { id: 'msg_se1', role: 'assistant', usage: { input_tokens: 5, output_tokens: 0 } } } },
      state,
    )
    expect(msgStartEvents.map((e) => e.type)).toEqual(['message-start'])
    // Subsequent assistant envelope with same id: content skipped (already streamed), only message-end added
    const assistantEvents = adaptClaudeObj(
      { type: 'assistant', message: { id: 'msg_se1', role: 'assistant', content: [{ type: 'text', text: 'hi' }] } },
      state,
    )
    expect(assistantEvents.map((e) => e.type)).toEqual(['message-end'])
  })

  it('emits exactly one turn-result with positive costUSD from result event', () => {
    const events = runFixture('simple-text.jsonl')
    const results = eventsOfType(events, 'turn-result')
    expect(results).toHaveLength(1)
    expect(results[0].costUSD).toBeGreaterThan(0)
    expect(results[0].durationMs).toBeGreaterThan(0)
  })

  it('turn-result usage has positive inputTokens and outputTokens', () => {
    const events = runFixture('simple-text.jsonl')
    const result = eventsOfType(events, 'turn-result')[0]
    expect(result.usage.inputTokens).toBeGreaterThan(0)
    expect(result.usage.outputTokens).toBeGreaterThan(0)
  })

  it('emits no error or crashed events', () => {
    const events = runFixture('simple-text.jsonl')
    expect(eventsOfType(events, 'error')).toHaveLength(0)
    expect(eventsOfType(events, 'crashed')).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Fixture: tool-use-read.jsonl — real CLI output with Read tool invocation
//
// Sequence: system/init → multiple assistant envelopes (thinking empty, tool_use)
// → user envelope (tool_result) → assistant envelope (text) → result
// ---------------------------------------------------------------------------

describe('adapter-claude — tool-use-read fixture (real CLI)', () => {
  it('emits session-init as the first AgentEvent', () => {
    const events = runFixture('tool-use-read.jsonl')
    expect(events[0].type).toBe('session-init')
  })

  it('emits at least one tool-use event with correct fields', () => {
    const events = runFixture('tool-use-read.jsonl')
    const toolUses = eventsOfType(events, 'tool-use')
    expect(toolUses.length).toBeGreaterThanOrEqual(1)
    const tu = toolUses[0]
    expect(typeof tu.toolUseId).toBe('string')
    expect(tu.toolUseId.length).toBeGreaterThan(0)
    expect(typeof tu.name).toBe('string')
    expect(tu.name.length).toBeGreaterThan(0)
  })

  it('tool-use input is a parsed object (not raw JSON string)', () => {
    const events = runFixture('tool-use-read.jsonl')
    const toolUses = eventsOfType(events, 'tool-use')
    expect(toolUses.length).toBeGreaterThanOrEqual(1)
    expect(typeof toolUses[0].input).toBe('object')
    expect(toolUses[0].input).not.toBeNull()
  })

  it('tool-use tool is Read with file_path input', () => {
    const events = runFixture('tool-use-read.jsonl')
    const readTool = eventsOfType(events, 'tool-use').find((e) => e.name === 'Read')
    expect(readTool).toBeDefined()
    expect((readTool!.input as Record<string, unknown>).file_path).toBeTruthy()
  })

  it('emits at least one tool-result event', () => {
    const events = runFixture('tool-use-read.jsonl')
    const results = eventsOfType(events, 'tool-result')
    expect(results.length).toBeGreaterThanOrEqual(1)
  })

  it('tool-result toolUseId matches the preceding tool-use toolUseId', () => {
    const events = runFixture('tool-use-read.jsonl')
    const toolUseIds = new Set(eventsOfType(events, 'tool-use').map((e) => e.toolUseId))
    const toolResultIds = eventsOfType(events, 'tool-result').map((e) => e.toolUseId)
    for (const resultId of toolResultIds) {
      expect(toolUseIds.has(resultId)).toBe(true)
    }
  })

  it('emits text-delta events in the final assistant turn', () => {
    const events = runFixture('tool-use-read.jsonl')
    const deltas = eventsOfType(events, 'text-delta')
    expect(deltas.length).toBeGreaterThanOrEqual(1)
  })

  it('text-delta seq values are strictly monotonically increasing across all turns', () => {
    const events = runFixture('tool-use-read.jsonl')
    const deltas = eventsOfType(events, 'text-delta')
    for (let i = 1; i < deltas.length; i++) {
      expect(deltas[i].seq).toBeGreaterThan(deltas[i - 1].seq)
    }
  })

  it('emits exactly one turn-result with positive costUSD', () => {
    const events = runFixture('tool-use-read.jsonl')
    const results = eventsOfType(events, 'turn-result')
    expect(results).toHaveLength(1)
    expect(results[0].costUSD).toBeGreaterThan(0)
  })

  it('repeated assistant envelopes with same id do not produce empty text-deltas', () => {
    const events = runFixture('tool-use-read.jsonl')
    const deltas = eventsOfType(events, 'text-delta')
    // All text-delta events must have non-empty delta strings
    expect(deltas.every((d) => d.delta.length > 0)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Fixture: thinking.jsonl — real CLI output for a reasoning prompt
//
// In practice, the model may respond with text only (no thinking blocks) unless
// extended thinking is explicitly enabled. Tests are defensive about this.
// ---------------------------------------------------------------------------

describe('adapter-claude — thinking fixture (real CLI)', () => {
  it('emits session-init as the first AgentEvent', () => {
    const events = runFixture('thinking.jsonl')
    expect(events[0].type).toBe('session-init')
  })

  it('emits at least one text-delta or thinking-delta event', () => {
    const events = runFixture('thinking.jsonl')
    const textDeltas = eventsOfType(events, 'text-delta')
    const thinkingDeltas = eventsOfType(events, 'thinking-delta')
    expect(textDeltas.length + thinkingDeltas.length).toBeGreaterThanOrEqual(1)
  })

  it('all delta seq values are monotonically increasing across text and thinking', () => {
    const events = runFixture('thinking.jsonl')
    const allDeltas = events.filter(
      (e): e is Extract<AgentEvent, { type: 'text-delta' | 'thinking-delta' }> =>
        e.type === 'text-delta' || e.type === 'thinking-delta',
    )
    for (let i = 1; i < allDeltas.length; i++) {
      expect(allDeltas[i].seq).toBeGreaterThan(allDeltas[i - 1].seq)
    }
  })

  it('emits exactly one turn-result with positive costUSD', () => {
    const events = runFixture('thinking.jsonl')
    const results = eventsOfType(events, 'turn-result')
    expect(results).toHaveLength(1)
    expect(results[0].costUSD).toBeGreaterThan(0)
  })

  it('emits no error or crashed events', () => {
    const events = runFixture('thinking.jsonl')
    expect(eventsOfType(events, 'error')).toHaveLength(0)
    expect(eventsOfType(events, 'crashed')).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Unit tests for adaptClaudeObj edge cases
// ---------------------------------------------------------------------------

describe('adaptClaudeObj — edge cases', () => {
  it('returns [] for null input', () => {
    const state = makeAdapterState('s')
    expect(adaptClaudeObj(null, state)).toEqual([])
  })

  it('returns [] for non-object input', () => {
    const state = makeAdapterState('s')
    expect(adaptClaudeObj('string', state)).toEqual([])
    expect(adaptClaudeObj(42, state)).toEqual([])
  })

  it('returns [] for unknown types (stream_event, rate_limit_event, system/status)', () => {
    const state = makeAdapterState('s')
    expect(adaptClaudeObj({ type: 'stream_event', event: {} }, state)).toEqual([])
    expect(adaptClaudeObj({ type: 'rate_limit_event' }, state)).toEqual([])
    expect(adaptClaudeObj({ type: 'system', subtype: 'status' }, state)).toEqual([])
  })

  it('returns [] for assistant envelope with missing or non-array content', () => {
    const state = makeAdapterState('s')
    expect(adaptClaudeObj({ type: 'assistant', message: {} }, state)).toEqual([])
    expect(adaptClaudeObj({ type: 'user', message: {} }, state)).toEqual([])
  })

  it('returns [] for system event with non-init subtype', () => {
    const state = makeAdapterState('s')
    expect(adaptClaudeObj({ type: 'system', subtype: 'other', session_id: 'x', model: 'y', cwd: '/z' }, state)).toEqual([])
  })

  it('assistant envelope (batched, not streamed) emits message-start + content + message-end', () => {
    const state = makeAdapterState('s')
    const events = adaptClaudeObj(
      { type: 'assistant', message: { id: 'msg_x', role: 'assistant', content: [] } },
      state,
    )
    // empty content → message-start + message-end
    expect(events.map((e) => e.type)).toEqual(['message-start', 'message-end'])
  })

  it('assistant envelope with text block emits message-start + text-delta + message-end', () => {
    const state = makeAdapterState('s')
    const events = adaptClaudeObj(
      { type: 'assistant', message: { id: 'msg_y', role: 'assistant', content: [{ type: 'text', text: 'hello' }] } },
      state,
    )
    expect(events.map((e) => e.type)).toEqual(['message-start', 'text-delta', 'message-end'])
    if (events[1].type === 'text-delta') {
      expect(events[1].delta).toBe('hello')
      expect(events[1].seq).toBe(0)
    }
  })

  it('assistant envelope with tool_use block emits message-start + tool-use + message-end', () => {
    const state = makeAdapterState('s')
    const events = adaptClaudeObj(
      {
        type: 'assistant',
        message: {
          id: 'msg_z',
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'toolu_x', name: 'Bash', input: { command: 'ls' } }],
        },
      },
      state,
    )
    expect(events.map((e) => e.type)).toEqual(['message-start', 'tool-use', 'message-end'])
    if (events[1].type === 'tool-use') {
      expect(events[1].toolUseId).toBe('toolu_x')
      expect(events[1].name).toBe('Bash')
      expect(events[1].input).toEqual({ command: 'ls' })
    }
  })

  it('assistant envelope with thinking block emits message-start + thinking-delta + message-end', () => {
    const state = makeAdapterState('s')
    const events = adaptClaudeObj(
      {
        type: 'assistant',
        message: {
          id: 'msg_t',
          role: 'assistant',
          content: [{ type: 'thinking', thinking: 'I think...', signature: 'sig' }],
        },
      },
      state,
    )
    expect(events.map((e) => e.type)).toEqual(['message-start', 'thinking-delta', 'message-end'])
    if (events[1].type === 'thinking-delta') {
      expect(events[1].delta).toBe('I think...')
    }
  })

  it('assistant envelope with empty thinking block emits message-start + message-end (no empty delta)', () => {
    const state = makeAdapterState('s')
    const events = adaptClaudeObj(
      {
        type: 'assistant',
        message: {
          id: 'msg_t2',
          role: 'assistant',
          content: [{ type: 'thinking', thinking: '', signature: 'sig' }],
        },
      },
      state,
    )
    // Empty thinking should not produce a thinking-delta
    expect(events.map((e) => e.type)).toEqual(['message-start', 'message-end'])
  })

  it('user envelope emits tool-result for each tool_result item', () => {
    const state = makeAdapterState('s')
    const events = adaptClaudeObj(
      {
        type: 'user',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'toolu_a', content: 'output here', is_error: false }],
        },
      },
      state,
    )
    expect(events).toHaveLength(1)
    if (events[0].type === 'tool-result') {
      expect(events[0].toolUseId).toBe('toolu_a')
      expect(events[0].isError).toBe(false)
      expect(events[0].output).toBe('output here')
    }
  })

  it('user envelope with is_error true maps isError correctly', () => {
    const state = makeAdapterState('s')
    const events = adaptClaudeObj(
      {
        type: 'user',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'toolu_b', content: 'error msg', is_error: true }],
        },
      },
      state,
    )
    if (events[0].type === 'tool-result') {
      expect(events[0].isError).toBe(true)
    }
  })

  it('user envelope with array content stringifies to string output', () => {
    const state = makeAdapterState('s')
    const events = adaptClaudeObj(
      {
        type: 'user',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'toolu_c', content: [{ type: 'text', text: 'hi' }] }],
        },
      },
      state,
    )
    if (events[0].type === 'tool-result') {
      expect(typeof events[0].output).toBe('string')
    }
  })

  it('classifies authentication_error correctly', () => {
    const state = makeAdapterState('s')
    const events = adaptClaudeObj(
      { type: 'error', error: { type: 'authentication_error', message: 'not logged in' } },
      state,
    )
    expect(events).toHaveLength(1)
    if (events[0].type === 'error') {
      expect(events[0].code).toBe('AGENT_NOT_AUTHENTICATED')
      expect(events[0].recoverable).toBe(false)
    }
  })

  it('classifies rate_limit_error as recoverable', () => {
    const state = makeAdapterState('s')
    const events = adaptClaudeObj(
      { type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } },
      state,
    )
    if (events[0].type === 'error') {
      expect(events[0].code).toBe('AGENT_RATE_LIMITED')
      expect(events[0].recoverable).toBe(true)
    }
  })

  it('classifies network_error as recoverable', () => {
    const state = makeAdapterState('s')
    const events = adaptClaudeObj(
      { type: 'error', error: { type: 'network_error', message: 'connection refused' } },
      state,
    )
    if (events[0].type === 'error') {
      expect(events[0].code).toBe('AGENT_NETWORK')
      expect(events[0].recoverable).toBe(true)
    }
  })

  it('classifies unknown error type as AGENT_INTERNAL, non-recoverable', () => {
    const state = makeAdapterState('s')
    const events = adaptClaudeObj(
      { type: 'error', error: { type: 'some_random_error', message: 'oops' } },
      state,
    )
    if (events[0].type === 'error') {
      expect(events[0].code).toBe('AGENT_INTERNAL')
      expect(events[0].recoverable).toBe(false)
    }
  })

  it('result with non-success subtype returns []', () => {
    const state = makeAdapterState('s')
    expect(adaptClaudeObj({ type: 'result', subtype: 'error' }, state)).toEqual([])
  })

  it('toStopReason maps null to cancelled (via message_delta)', () => {
    const state = makeAdapterState('s')
    const events = adaptClaudeObj(
      { type: 'message_delta', delta: { stop_reason: null, stop_sequence: null } },
      state,
    )
    expect(events).toHaveLength(1)
    if (events[0].type === 'message-end') {
      expect(events[0].stopReason).toBe('cancelled')
    }
  })

  it('message_stop produces no AgentEvent', () => {
    const state = makeAdapterState('s')
    expect(adaptClaudeObj({ type: 'message_stop' }, state)).toEqual([])
  })

  it('content_block_stop for non-tool_use block returns []', () => {
    const state = makeAdapterState('s')
    adaptClaudeObj({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }, state)
    const events = adaptClaudeObj({ type: 'content_block_stop', index: 0 }, state)
    expect(events).toEqual([])
  })

  it('tool_use block with malformed JSON input keeps raw string', () => {
    const state = makeAdapterState('s')
    state.currentMessageId = 'msg_x'
    adaptClaudeObj(
      { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_y', name: 'Bash', input: {} } },
      state,
    )
    adaptClaudeObj(
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{invalid' } },
      state,
    )
    const events = adaptClaudeObj({ type: 'content_block_stop', index: 0 }, state)
    expect(events).toHaveLength(1)
    if (events[0].type === 'tool-use') {
      expect(events[0].input).toBe('{invalid')
    }
  })

  it('makeAdapterState initializes all counters to zero', () => {
    const state = makeAdapterState('init-test')
    expect(state.seq).toBe(0)
    expect(state.inputTokens).toBe(0)
    expect(state.outputTokens).toBe(0)
    expect(state.cacheReadTokens).toBe(0)
    expect(state.cacheWriteTokens).toBe(0)
    expect(state.currentMessageId).toBe('')
    expect(state.cliSessionId).toBe('')
  })
})
