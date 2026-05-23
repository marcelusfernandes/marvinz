// Adapter: claude --output-format stream-json NDJSON objects → AgentEvent[].
// The claude CLI emits Anthropic Messages API streaming events as NDJSON lines.
// This adapter translates them into the unified internal AgentEvent protocol.
// Pure function — no I/O, easy to unit-test with recorded fixtures.

import type { AgentEvent, TokenUsage } from './protocol.js'

// Raw shapes emitted by `claude --output-format stream-json`.
// We only type the fields we actually read; everything else is unknown.

type ClaudeSystemInit = {
  type: 'system'
  subtype: 'init'
  session_id: string
  model: string
  cwd: string
  tools?: unknown[]
}

type ClaudeMessageStart = {
  type: 'message_start'
  message: {
    id: string
    role: 'assistant' | 'user'
    model?: string
    usage?: {
      input_tokens: number
      output_tokens: number
      cache_read_input_tokens?: number
      cache_creation_input_tokens?: number
    }
  }
}

type ClaudeContentBlockStart = {
  type: 'content_block_start'
  index: number
  content_block:
    | { type: 'text'; text: string }
    | { type: 'thinking'; thinking: string }
    | { type: 'tool_use'; id: string; name: string; input: unknown }
}

type ClaudeContentBlockDelta = {
  type: 'content_block_delta'
  index: number
  delta:
    | { type: 'text_delta'; text: string }
    | { type: 'thinking_delta'; thinking: string }
    | { type: 'input_json_delta'; partial_json: string }
}

type ClaudeMessageDelta = {
  type: 'message_delta'
  delta: {
    stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | null
    stop_sequence: string | null
  }
  usage?: { output_tokens: number }
}

type ClaudeMessageStop = {
  type: 'message_stop'
}

type ClaudeResultEvent = {
  type: 'result'
  subtype: 'success'
  session_id?: string
  total_cost_usd?: number
  duration_ms?: number
  usage?: {
    input_tokens: number
    output_tokens: number
    cache_read_input_tokens?: number
    cache_creation_input_tokens?: number
  }
}

type ClaudeToolResult = {
  type: 'tool_result'
  tool_use_id: string
  content: unknown
  is_error?: boolean
}

type ClaudeErrorEvent = {
  type: 'error'
  error: {
    type: string
    message: string
  }
}

// Real CLI envelope types (--output-format stream-json --verbose, v2.1+).
// The CLI emits complete messages as `assistant`/`user` envelopes rather than
// the incremental streaming events (message_start, content_block_delta, etc.)
// that the Anthropic SDK would emit. Both formats are handled below.

type ClaudeContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string; signature?: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }

type ClaudeToolResultContent =
  | string
  | Array<{ type: string; text?: string; [key: string]: unknown }>

type ClaudeAssistantEnvelope = {
  type: 'assistant'
  message: {
    id: string
    model?: string
    role: 'assistant'
    content: ClaudeContentBlock[]
    usage?: {
      input_tokens: number
      output_tokens: number
      cache_read_input_tokens?: number
      cache_creation_input_tokens?: number
    }
  }
  session_id?: string
}

type ClaudeUserEnvelope = {
  type: 'user'
  message: {
    role: 'user'
    content: Array<{
      type: 'tool_result'
      tool_use_id: string
      content: ClaudeToolResultContent
      is_error?: boolean
    }>
  }
  session_id?: string
}

type ClaudeStreamObj =
  | ClaudeSystemInit
  | ClaudeAssistantEnvelope
  | ClaudeUserEnvelope
  | ClaudeMessageStart
  | ClaudeContentBlockStart
  | ClaudeContentBlockDelta
  | ClaudeMessageDelta
  | ClaudeMessageStop
  | ClaudeResultEvent
  | ClaudeToolResult
  | ClaudeErrorEvent
  | { type: string; [key: string]: unknown }

// Mutable context threaded through the adapter across streaming calls.
export type AdapterState = {
  sessionId: string
  cliSessionId: string
  model: string
  cwd: string
  startedAt: number
  currentMessageId: string
  // per-block tracking
  blockTypes: Map<number, 'text' | 'thinking' | 'tool_use'>
  toolUseIds: Map<number, string>
  toolNames: Map<number, string>
  toolInputBuffers: Map<number, string>
  // delta sequence counter (resets per session)
  seq: number
  // cumulative token usage for turn-result
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  // tracks messages already emitted via stream_event incremental streaming;
  // assistant envelope handler skips content emission for these to avoid doubling
  streamedMessageIds: Set<string>
}

export function makeAdapterState(sessionId: string): AdapterState {
  return {
    sessionId,
    cliSessionId: '',
    model: '',
    cwd: '',
    startedAt: Date.now(),
    currentMessageId: '',
    blockTypes: new Map(),
    toolUseIds: new Map(),
    toolNames: new Map(),
    toolInputBuffers: new Map(),
    seq: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    streamedMessageIds: new Set(),
  }
}

function toStopReason(
  raw: string | null | undefined,
): 'end_turn' | 'tool_use' | 'max_tokens' | 'cancelled' {
  if (raw === 'end_turn' || raw === 'tool_use' || raw === 'max_tokens') return raw
  return 'cancelled'
}

// Classify a claude error type string to our ErrorCode.
function classifyClaudeError(
  errorType: string,
): 'AGENT_NOT_AUTHENTICATED' | 'AGENT_RATE_LIMITED' | 'AGENT_NETWORK' | 'AGENT_INTERNAL' {
  if (errorType === 'authentication_error' || errorType === 'unauthenticated') {
    return 'AGENT_NOT_AUTHENTICATED'
  }
  if (errorType === 'rate_limit_error' || errorType === 'usage_limit_reached') {
    return 'AGENT_RATE_LIMITED'
  }
  if (errorType === 'request_failed' || errorType === 'network_error') {
    return 'AGENT_NETWORK'
  }
  return 'AGENT_INTERNAL'
}

// Translate one parsed NDJSON object into zero or more AgentEvents.
// state is mutated in-place to track streaming context.
export function adaptClaudeObj(obj: unknown, state: AdapterState): AgentEvent[] {
  if (!obj || typeof obj !== 'object') return []
  const raw = obj as ClaudeStreamObj

  switch (raw.type) {
    case 'system': {
      const sys = raw as ClaudeSystemInit
      if (sys.subtype !== 'init') return []
      state.cliSessionId = sys.session_id ?? state.cliSessionId
      state.model = sys.model ?? state.model
      state.cwd = sys.cwd ?? state.cwd
      const event: AgentEvent = {
        type: 'session-init',
        sessionId: state.sessionId,
        provider: 'claude',
        cliSessionId: state.cliSessionId,
        model: state.model,
        cwd: state.cwd,
        startedAt: state.startedAt,
      }
      return [event]
    }

    // --include-partial-messages: the CLI wraps incremental Anthropic streaming
    // events in a stream_event envelope. Unwrap and recurse so the inner event
    // hits its own handler (message_start, content_block_delta, etc.).
    case 'stream_event': {
      const wrapper = raw as { type: 'stream_event'; event: unknown }
      return adaptClaudeObj(wrapper.event, state)
    }

    // Real CLI envelope: complete assistant message with content blocks.
    // When --include-partial-messages is active this fires as a final snapshot
    // AFTER the incremental stream_event wrappers, so content is already emitted.
    // When streaming is inactive (batched mode) this is the only source of content.
    case 'assistant': {
      const env = raw as ClaudeAssistantEnvelope
      const msg = env.message
      if (!msg || !Array.isArray(msg.content)) return []
      if (msg.model) state.model = msg.model
      if (env.session_id) state.cliSessionId = env.session_id
      if (msg.usage) {
        state.inputTokens += msg.usage.input_tokens ?? 0
        state.outputTokens += msg.usage.output_tokens ?? 0
        state.cacheReadTokens += msg.usage.cache_read_input_tokens ?? 0
        state.cacheWriteTokens += msg.usage.cache_creation_input_tokens ?? 0
      }

      const alreadyStreamed = state.streamedMessageIds.has(msg.id)
      state.currentMessageId = msg.id

      const events: AgentEvent[] = []

      if (!alreadyStreamed) {
        // Batched mode: emit message-start + all content blocks as single events.
        events.push({
          type: 'message-start',
          sessionId: state.sessionId,
          messageId: msg.id,
          role: 'assistant',
        })
        for (const block of msg.content) {
          if (block.type === 'text' && block.text) {
            events.push({
              type: 'text-delta',
              sessionId: state.sessionId,
              messageId: msg.id,
              delta: block.text,
              seq: state.seq++,
            })
          } else if (block.type === 'thinking' && block.thinking) {
            events.push({
              type: 'thinking-delta',
              sessionId: state.sessionId,
              messageId: msg.id,
              delta: block.thinking,
              seq: state.seq++,
            })
          } else if (block.type === 'tool_use') {
            events.push({
              type: 'tool-use',
              sessionId: state.sessionId,
              toolUseId: block.id,
              name: block.name,
              input: block.input,
              messageId: msg.id,
            })
          }
        }
      }

      // Always emit message-end: in streaming mode this closes the message;
      // in batched mode it follows the content events above.
      events.push({
        type: 'message-end',
        sessionId: state.sessionId,
        messageId: msg.id,
        stopReason: 'end_turn',
      })

      return events
    }

    // Real CLI envelope: tool results from the user turn.
    case 'user': {
      const env = raw as ClaudeUserEnvelope
      if (!env.message || !Array.isArray(env.message.content)) return []
      if (env.session_id) state.cliSessionId = env.session_id
      const events: AgentEvent[] = []
      for (const item of env.message.content) {
        if (item.type !== 'tool_result') continue
        const output = typeof item.content === 'string'
          ? item.content
          : JSON.stringify(item.content)
        events.push({
          type: 'tool-result',
          sessionId: state.sessionId,
          toolUseId: item.tool_use_id,
          output,
          isError: item.is_error === true,
          durationMs: 0,
        })
      }
      return events
    }

    case 'message_start': {
      const ms = raw as ClaudeMessageStart
      state.currentMessageId = ms.message.id
      // Mark this message as incrementally streamed so the assistant envelope
      // handler knows to skip re-emitting the content blocks.
      state.streamedMessageIds.add(ms.message.id)
      if (ms.message.model) state.model = ms.message.model
      if (ms.message.usage) {
        state.inputTokens += ms.message.usage.input_tokens ?? 0
        state.outputTokens += ms.message.usage.output_tokens ?? 0
        state.cacheReadTokens += ms.message.usage.cache_read_input_tokens ?? 0
        state.cacheWriteTokens += ms.message.usage.cache_creation_input_tokens ?? 0
      }
      const event: AgentEvent = {
        type: 'message-start',
        sessionId: state.sessionId,
        messageId: state.currentMessageId,
        role: ms.message.role,
      }
      return [event]
    }

    case 'content_block_start': {
      const cbs = raw as ClaudeContentBlockStart
      const block = cbs.content_block
      state.blockTypes.set(cbs.index, block.type)

      if (block.type === 'tool_use') {
        state.toolUseIds.set(cbs.index, block.id)
        state.toolNames.set(cbs.index, block.name)
        state.toolInputBuffers.set(cbs.index, '')
      }
      return []
    }

    case 'content_block_delta': {
      const cbd = raw as ClaudeContentBlockDelta
      const delta = cbd.delta
      const blockType = state.blockTypes.get(cbd.index)

      if (delta.type === 'text_delta' && blockType === 'text') {
        const event: AgentEvent = {
          type: 'text-delta',
          sessionId: state.sessionId,
          messageId: state.currentMessageId,
          delta: delta.text,
          seq: state.seq++,
        }
        return [event]
      }

      if (delta.type === 'thinking_delta' && blockType === 'thinking') {
        const event: AgentEvent = {
          type: 'thinking-delta',
          sessionId: state.sessionId,
          messageId: state.currentMessageId,
          delta: delta.thinking,
          seq: state.seq++,
        }
        return [event]
      }

      if (delta.type === 'input_json_delta' && blockType === 'tool_use') {
        const current = state.toolInputBuffers.get(cbd.index) ?? ''
        state.toolInputBuffers.set(cbd.index, current + delta.partial_json)
      }

      return []
    }

    case 'content_block_stop': {
      // Finalize tool_use block: emit tool-use event with fully assembled input.
      const stop = raw as { type: 'content_block_stop'; index: number }
      const blockType = state.blockTypes.get(stop.index)
      if (blockType !== 'tool_use') return []

      const toolUseId = state.toolUseIds.get(stop.index)
      const name = state.toolNames.get(stop.index)
      const inputBuf = state.toolInputBuffers.get(stop.index) ?? ''

      if (!toolUseId || !name) return []

      let parsedInput: unknown = inputBuf
      try {
        parsedInput = inputBuf ? JSON.parse(inputBuf) : {}
      } catch {
        // keep raw string if JSON is malformed
      }

      state.toolUseIds.delete(stop.index)
      state.toolNames.delete(stop.index)
      state.toolInputBuffers.delete(stop.index)
      state.blockTypes.delete(stop.index)

      const event: AgentEvent = {
        type: 'tool-use',
        sessionId: state.sessionId,
        toolUseId,
        name,
        input: parsedInput,
        messageId: state.currentMessageId,
      }
      return [event]
    }

    case 'message_delta': {
      const md = raw as ClaudeMessageDelta
      if (md.usage) {
        state.outputTokens += md.usage.output_tokens ?? 0
      }
      const event: AgentEvent = {
        type: 'message-end',
        sessionId: state.sessionId,
        messageId: state.currentMessageId,
        stopReason: toStopReason(md.delta.stop_reason),
      }
      return [event]
    }

    case 'message_stop':
      // message_stop follows message_delta; we already emitted message-end there.
      return []

    case 'tool_result': {
      const tr = raw as ClaudeToolResult
      const event: AgentEvent = {
        type: 'tool-result',
        sessionId: state.sessionId,
        toolUseId: tr.tool_use_id,
        output: tr.content,
        isError: tr.is_error === true,
        durationMs: 0, // CLI does not provide per-tool timing; caller may backfill
      }
      return [event]
    }

    case 'result': {
      const res = raw as ClaudeResultEvent
      if (res.subtype !== 'success') return []

      if (res.session_id) state.cliSessionId = res.session_id

      const usage = res.usage
      const inputTokens = (usage?.input_tokens ?? 0) || state.inputTokens
      const outputTokens = (usage?.output_tokens ?? 0) || state.outputTokens
      const cacheReadTokens =
        (usage?.cache_read_input_tokens ?? 0) || state.cacheReadTokens
      const cacheWriteTokens =
        (usage?.cache_creation_input_tokens ?? 0) || state.cacheWriteTokens

      const tokenUsage: TokenUsage = {
        inputTokens,
        outputTokens,
        cacheReadTokens: cacheReadTokens || undefined,
        cacheWriteTokens: cacheWriteTokens || undefined,
      }

      const event: AgentEvent = {
        type: 'turn-result',
        sessionId: state.sessionId,
        usage: tokenUsage,
        costUSD: res.total_cost_usd ?? 0,
        durationMs: res.duration_ms ?? 0,
      }
      return [event]
    }

    case 'error': {
      const err = raw as ClaudeErrorEvent
      const code = classifyClaudeError(err.error.type)
      const event: AgentEvent = {
        type: 'error',
        sessionId: state.sessionId,
        code,
        message: err.error.message,
        recoverable: code === 'AGENT_RATE_LIMITED' || code === 'AGENT_NETWORK',
      }
      return [event]
    }

    default:
      return []
  }
}


