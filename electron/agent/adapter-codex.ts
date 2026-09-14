// Adapter: codex exec --json events → AgentEvent[].
// `codex exec --json` emits one JSON object per line on stdout.
// Event types use dot notation (e.g. "thread.started", "item.completed").
// Text is NOT streamed — the full agent message arrives in a single
// item.completed event. We emit it as one text-delta (whole text in delta).
// Pure function — no I/O, easy to unit-test with recorded fixtures.

import type { AgentEvent, TokenUsage } from './protocol.js'

// ---------------------------------------------------------------------------
// Raw shapes emitted by `codex exec --json`.
// We only type the fields we actually read.
// ---------------------------------------------------------------------------

type CodexExecEvent = {
  type: string
  [key: string]: unknown
}

type ThreadStartedEvent = CodexExecEvent & {
  type: 'thread.started'
  thread_id: string
}

type ItemStartedEvent = CodexExecEvent & {
  type: 'item.started'
  item: {
    id: string
    type: string
    command?: string
    status?: string
    aggregated_output?: string
    exit_code?: number | null
    [key: string]: unknown
  }
}

type ItemCompletedEvent = CodexExecEvent & {
  type: 'item.completed'
  item: {
    id: string
    type: string
    // agent_message fields
    text?: string
    // command_execution fields
    command?: string
    aggregated_output?: string
    exit_code?: number | null
    status?: string
    [key: string]: unknown
  }
}

type TurnCompletedEvent = CodexExecEvent & {
  type: 'turn.completed'
  usage: {
    input_tokens: number
    cached_input_tokens: number
    output_tokens: number
    reasoning_output_tokens?: number
  }
}

// ---------------------------------------------------------------------------
// Mutable adapter state — threaded across streaming calls per session.
// ---------------------------------------------------------------------------

export type CodexAdapterState = {
  sessionId: string
  // thread_id from thread.started event
  cliSessionId: string
  // current synthetic messageId for the active turn
  currentMessageId: string
  // counter for synthetic messageId generation
  messageCounter: number
  // delta sequence counter
  seq: number
  // cumulative token usage, populated from turn.completed
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  // set of item ids for which tool-use was emitted (idempotency guard)
  emittedToolUseIds: Set<string>
  // set of item ids for which text-delta was emitted (idempotency guard)
  emittedTextIds: Set<string>
  // a turn.started has been seen and no turn.completed/turn.failed yet (#652)
  turnOpen: boolean
  // at least one agent_message was emitted in the open turn (#652)
  turnHasText: boolean
  startedAt: number
}

export function makeCodexAdapterState(sessionId: string): CodexAdapterState {
  return {
    sessionId,
    cliSessionId: '',
    currentMessageId: '',
    messageCounter: 0,
    seq: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    emittedToolUseIds: new Set(),
    emittedTextIds: new Set(),
    turnOpen: false,
    turnHasText: false,
    startedAt: Date.now(),
  }
}

/** message-end for the open turn, or nothing when no turn was started. */
function closeTurn(state: CodexAdapterState): AgentEvent[] {
  if (!state.turnOpen) return []
  state.turnOpen = false
  return [
    {
      type: 'message-end',
      sessionId: state.sessionId,
      messageId: state.currentMessageId,
      stopReason: 'end_turn',
    },
  ]
}

function nextMessageId(state: CodexAdapterState): string {
  return `codex-msg-${++state.messageCounter}`
}

// ---------------------------------------------------------------------------
// Main adapter function.
// Translates one parsed JSON line into zero or more AgentEvents.
// state is mutated in-place to track streaming context.
// ---------------------------------------------------------------------------

export function adaptCodexObj(obj: unknown, state: CodexAdapterState): AgentEvent[] {
  if (!obj || typeof obj !== 'object') return []

  const raw = obj as CodexExecEvent
  if (typeof raw.type !== 'string') return []

  switch (raw.type) {
    case 'thread.started': {
      const ev = raw as ThreadStartedEvent
      if (!ev.thread_id) return []

      state.cliSessionId = ev.thread_id

      const event: AgentEvent = {
        type: 'session-init',
        sessionId: state.sessionId,
        provider: 'codex',
        cliSessionId: ev.thread_id,
        model: '',
        cwd: '',
        startedAt: state.startedAt,
      }
      return [event]
    }

    case 'turn.started': {
      // Generate a fresh messageId for this turn's agent reply.
      state.currentMessageId = nextMessageId(state)
      state.turnOpen = true
      state.turnHasText = false
      const event: AgentEvent = {
        type: 'message-start',
        sessionId: state.sessionId,
        messageId: state.currentMessageId,
        role: 'assistant',
      }
      return [event]
    }

    case 'item.started': {
      const ev = raw as ItemStartedEvent
      const item = ev.item
      if (!item) return []

      // Emit tool-use for command_execution items when they start.
      if (item.type === 'command_execution') {
        if (state.emittedToolUseIds.has(item.id)) return []
        state.emittedToolUseIds.add(item.id)

        const event: AgentEvent = {
          type: 'tool-use',
          sessionId: state.sessionId,
          toolUseId: item.id,
          name: 'Bash',
          input: { command: item.command ?? '' },
          messageId: state.currentMessageId,
        }
        return [event]
      }

      return []
    }

    case 'item.completed': {
      const ev = raw as ItemCompletedEvent
      const item = ev.item
      if (!item) return []

      if (item.type === 'agent_message') {
        // Guard against double-emission if item.completed fires more than once.
        if (state.emittedTextIds.has(item.id)) return []
        state.emittedTextIds.add(item.id)

        // A turn can carry several agent_messages (an intermediate sentence,
        // then a tool call, then the answer). Each is a delta on the same
        // message; the message only ends at turn.completed — ending it here
        // let the UI go idle mid-turn and a new send kill the live child (#652).
        const text = (item.text ?? '').trimEnd()
        if (text.length === 0) return []
        const delta = state.turnHasText ? `\n\n${text}` : text
        state.turnHasText = true
        const event: AgentEvent = {
          type: 'text-delta',
          sessionId: state.sessionId,
          messageId: state.currentMessageId,
          delta,
          seq: state.seq++,
        }
        return [event]
      }

      if (item.type === 'command_execution') {
        const isError = item.status === 'failed' || (item.exit_code !== 0 && item.exit_code != null)
        const event: AgentEvent = {
          type: 'tool-result',
          sessionId: state.sessionId,
          toolUseId: item.id,
          output: item.aggregated_output ?? '',
          isError,
          durationMs: 0,
        }
        return [event]
      }

      return []
    }

    case 'turn.completed': {
      const ev = raw as TurnCompletedEvent
      const closing = closeTurn(state)
      const usage = ev.usage
      if (!usage) return closing

      state.inputTokens = usage.input_tokens ?? 0
      state.outputTokens = usage.output_tokens ?? 0
      state.cacheReadTokens = usage.cached_input_tokens ?? 0

      const tokenUsage: TokenUsage = {
        inputTokens: state.inputTokens,
        outputTokens: state.outputTokens,
        cacheReadTokens: state.cacheReadTokens || undefined,
      }

      const event: AgentEvent = {
        type: 'turn-result',
        sessionId: state.sessionId,
        usage: tokenUsage,
        // codex exec --json does not expose per-turn cost.
        costUSD: 0,
        durationMs: 0,
      }
      return [...closing, event]
    }

    case 'turn.failed': {
      // Without this the message never ends and the chat hangs in streaming.
      const rawUnknown = raw as unknown as { error?: { message?: unknown } }
      const message =
        typeof rawUnknown.error?.message === 'string'
          ? rawUnknown.error.message
          : 'Codex turn failed'
      const error: AgentEvent = {
        type: 'error',
        sessionId: state.sessionId,
        code: 'AGENT_INTERNAL',
        message,
        recoverable: false,
      }
      return [...closeTurn(state), error]
    }

    // turn.started is handled above; these are informational only.
    case 'error': {
      const rawUnknown = raw as unknown as Record<string, unknown>
      const message =
        typeof rawUnknown.message === 'string' ? rawUnknown.message : 'Unknown codex error'
      const event: AgentEvent = {
        type: 'error',
        sessionId: state.sessionId,
        code: 'AGENT_INTERNAL',
        message,
        recoverable: false,
      }
      return [event]
    }

    default:
      return []
  }
}
