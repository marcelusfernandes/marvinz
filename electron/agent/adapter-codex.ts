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
  // command_execution items started but not yet completed (#652)
  openToolIds: Set<string>
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
    openToolIds: new Set(),
    startedAt: Date.now(),
  }
}

/**
 * A command still running when its turn ends abnormally never gets an
 * item.completed; fail its block explicitly or it stays "running" forever.
 */
function abandonOpenTools(state: CodexAdapterState, reason: string): AgentEvent[] {
  const events: AgentEvent[] = Array.from(state.openToolIds).map((toolUseId) => ({
    type: 'tool-result',
    sessionId: state.sessionId,
    toolUseId,
    output: reason,
    isError: true,
    durationMs: 0,
  }))
  state.openToolIds.clear()
  return events
}

/**
 * Unrecoverable failure: fail open commands, close the message as cancelled,
 * then surface the error. Shared by turn.failed and the generic error event.
 */
function failTurn(state: CodexAdapterState, message: string): AgentEvent[] {
  const error: AgentEvent = {
    type: 'error',
    sessionId: state.sessionId,
    code: 'AGENT_INTERNAL',
    message,
    recoverable: false,
  }
  return [...abandonOpenTools(state, message), ...closeTurn(state, 'cancelled'), error]
}

/** message-end for the open turn, or nothing when no turn was started. */
function closeTurn(
  state: CodexAdapterState,
  stopReason: 'end_turn' | 'cancelled' = 'end_turn'
): AgentEvent[] {
  if (!state.turnOpen) return []
  state.turnOpen = false
  return [
    {
      type: 'message-end',
      sessionId: state.sessionId,
      messageId: state.currentMessageId,
      stopReason,
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
      // A second turn.started without a turn.completed/turn.failed in between
      // would orphan the previous message (renderer stuck streaming) and any
      // command still running in it; fail those and close it.
      const closing = [
        ...abandonOpenTools(state, 'Turn restarted before the command completed'),
        ...closeTurn(state),
      ]
      // Generate a fresh messageId for this turn's agent reply.
      state.currentMessageId = nextMessageId(state)
      state.turnOpen = true
      const event: AgentEvent = {
        type: 'message-start',
        sessionId: state.sessionId,
        messageId: state.currentMessageId,
        role: 'assistant',
      }
      return [...closing, event]
    }

    case 'item.started': {
      const ev = raw as ItemStartedEvent
      const item = ev.item
      if (!item) return []

      // Emit tool-use for command_execution items when they start.
      if (item.type === 'command_execution') {
        if (state.emittedToolUseIds.has(item.id)) return []
        state.emittedToolUseIds.add(item.id)
        state.openToolIds.add(item.id)

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
        // The store opens a new text block after each tool call, so the deltas
        // need no separator. codex-cli appends one trailing newline; drop it.
        const text = (item.text ?? '').replace(/\n$/, '')
        if (text.length === 0) return []
        const event: AgentEvent = {
          type: 'text-delta',
          sessionId: state.sessionId,
          messageId: state.currentMessageId,
          delta: text,
          seq: state.seq++,
        }
        return [event]
      }

      if (item.type === 'command_execution') {
        state.openToolIds.delete(item.id)
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
      return failTurn(state, message)
    }

    // Failure paths: both end the open turn and surface an unrecoverable error.
    case 'error': {
      const rawUnknown = raw as unknown as Record<string, unknown>
      const message =
        typeof rawUnknown.message === 'string' ? rawUnknown.message : 'Unknown codex error'
      return failTurn(state, message)
    }

    default:
      return []
  }
}
