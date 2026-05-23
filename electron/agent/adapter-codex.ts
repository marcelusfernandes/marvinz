// Adapter: codex app-server JSON-RPC 2.0 notifications → AgentEvent[].
// The codex app-server emits JSON-RPC 2.0 messages over stdio (one per line).
// This adapter translates them into the unified internal AgentEvent protocol.
// Pure function — no I/O, easy to unit-test with recorded fixtures.
//
// Protocol reference: codex-rs/app-server/README.md and generated TypeScript
// bindings from `codex app-server generate-ts`.

import type { AgentEvent, TokenUsage } from './protocol.js'

// ---------------------------------------------------------------------------
// Raw shapes emitted by `codex app-server --listen stdio://`.
// JSON-RPC 2.0: each line is either a response (has `id` + `result`) or a
// notification (has `method` + `params`, no `id`).
// We only type the fields we actually read; everything else is unknown.
// ---------------------------------------------------------------------------

type CodexJsonRpcResponse = {
  jsonrpc: '2.0'
  id: number | string
  result: unknown
}

type CodexJsonRpcNotification = {
  jsonrpc: '2.0'
  method: string
  params: unknown
}

type CodexJsonRpcMsg = CodexJsonRpcResponse | CodexJsonRpcNotification

// Thread shape (subset of fields we use)
type CodexThread = {
  id: string
  sessionId: string
  modelProvider?: string
  cwd: string
  cliVersion?: string
}

// ThreadItem shapes (subset)
type CodexCommandExecutionItem = {
  type: 'commandExecution'
  id: string
  command: string
  cwd: string
  status: 'inProgress' | 'completed' | 'failed' | 'declined'
  aggregatedOutput: string | null
  exitCode: number | null
  durationMs: number | null
}

type CodexFileChangeItem = {
  type: 'fileChange'
  id: string
  changes: Array<{ path: string; kind: { type: string }; diff: string }>
  status: string
}

// Notification param shapes (subset)
type ThreadStartedParams = { thread: CodexThread }
type AgentMessageDeltaParams = { threadId: string; turnId: string; itemId: string; delta: string }
type ReasoningTextDeltaParams = { threadId: string; turnId: string; itemId: string; delta: string; contentIndex: number }
type ItemStartedParams = { item: { type: string; id: string; [key: string]: unknown }; threadId: string; turnId: string; startedAtMs: number }
type ItemCompletedParams = { item: { type: string; id: string; [key: string]: unknown }; threadId: string; turnId: string; completedAtMs: number }
type TurnCompletedParams = { threadId: string; turn: { id: string; status: string; startedAt: number | null; completedAt: number | null; durationMs: number | null } }
type TokenUsageUpdatedParams = {
  threadId: string
  turnId: string
  tokenUsage: {
    last: {
      inputTokens: number
      cachedInputTokens: number
      outputTokens: number
    }
  }
}
type ErrorNotificationParams = {
  error: { message: string; codexErrorInfo: unknown }
  willRetry: boolean
  threadId: string
  turnId: string
}

// ---------------------------------------------------------------------------
// Mutable state threaded through the adapter across streaming calls.
// ---------------------------------------------------------------------------

export type CodexAdapterState = {
  sessionId: string
  // threadId from thread/started notification
  cliSessionId: string
  model: string
  cwd: string
  startedAt: number
  // current active threadId for routing
  currentThreadId: string
  // current active itemId being streamed (agentMessage or reasoning)
  currentItemId: string
  // current active messageId (maps itemId → synthetic messageId for AgentEvent)
  itemMessageIds: Map<string, string>
  // delta sequence counter (resets per session)
  seq: number
  // cumulative token usage for turn-result (from tokenUsage/updated)
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  // set of itemIds for commandExecution items that have been emitted as tool-use
  // to avoid double-emission if item/completed fires again
  emittedToolUseIds: Set<string>
  // tracks the initialize response (first JSON-RPC response with result)
  initialized: boolean
}

export function makeCodexAdapterState(sessionId: string): CodexAdapterState {
  return {
    sessionId,
    cliSessionId: '',
    model: '',
    cwd: '',
    startedAt: Date.now(),
    currentThreadId: '',
    currentItemId: '',
    itemMessageIds: new Map(),
    seq: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    emittedToolUseIds: new Set(),
    initialized: false,
  }
}

// Classify a codexErrorInfo value to our ErrorCode.
function classifyCodexError(
  codexErrorInfo: unknown,
): 'AGENT_NOT_AUTHENTICATED' | 'AGENT_RATE_LIMITED' | 'AGENT_NETWORK' | 'AGENT_INTERNAL' {
  if (codexErrorInfo === 'unauthorized') return 'AGENT_NOT_AUTHENTICATED'
  if (codexErrorInfo === 'usageLimitExceeded') return 'AGENT_RATE_LIMITED'
  if (codexErrorInfo === 'serverOverloaded') return 'AGENT_RATE_LIMITED'
  if (
    typeof codexErrorInfo === 'object' &&
    codexErrorInfo !== null &&
    ('httpConnectionFailed' in codexErrorInfo || 'responseStreamConnectionFailed' in codexErrorInfo)
  ) {
    return 'AGENT_NETWORK'
  }
  return 'AGENT_INTERNAL'
}

// Generate a synthetic messageId for a given itemId.
// We prefix with 'codex-' to distinguish from Claude message IDs.
function syntheticMessageId(itemId: string): string {
  return `codex-${itemId}`
}

// ---------------------------------------------------------------------------
// Main adapter function.
// Translate one parsed JSON-RPC line into zero or more AgentEvents.
// state is mutated in-place to track streaming context.
// ---------------------------------------------------------------------------

export function adaptCodexObj(obj: unknown, state: CodexAdapterState): AgentEvent[] {
  if (!obj || typeof obj !== 'object') return []

  const raw = obj as CodexJsonRpcMsg

  if (raw.jsonrpc !== '2.0') return []

  // JSON-RPC response (has `id` field): only the initialize response matters here.
  if ('id' in raw && 'result' in raw) {
    if (!state.initialized) {
      // The initialize response confirms the handshake; no AgentEvent emitted.
      state.initialized = true
    }
    return []
  }

  // JSON-RPC notification (has `method` field, no `id`).
  if (!('method' in raw)) return []

  const method = (raw as { method: string }).method
  const params = (raw as { params: unknown }).params

  switch (method) {
    case 'thread/started': {
      const p = params as ThreadStartedParams
      const thread = p?.thread
      if (!thread) return []

      state.cliSessionId = thread.id ?? state.cliSessionId
      state.currentThreadId = thread.id ?? state.currentThreadId
      state.cwd = thread.cwd ?? state.cwd
      // Codex doesn't embed model name in thread/started; use modelProvider as fallback.
      if (!state.model && thread.modelProvider) {
        state.model = thread.modelProvider
      }

      const event: AgentEvent = {
        type: 'session-init',
        sessionId: state.sessionId,
        provider: 'codex',
        cliSessionId: state.cliSessionId,
        model: state.model,
        cwd: state.cwd,
        startedAt: state.startedAt,
      }
      return [event]
    }

    case 'item/started': {
      const p = params as ItemStartedParams
      const item = p?.item
      if (!item) return []

      const messageId = syntheticMessageId(item.id)
      state.itemMessageIds.set(item.id, messageId)
      state.currentItemId = item.id

      // Emit message-start for agent message and reasoning items.
      if (item.type === 'agentMessage' || item.type === 'reasoning') {
        const event: AgentEvent = {
          type: 'message-start',
          sessionId: state.sessionId,
          messageId,
          role: 'assistant',
        }
        return [event]
      }

      // Emit tool-use for commandExecution items when they start.
      if (item.type === 'commandExecution') {
        const exec = item as unknown as CodexCommandExecutionItem
        if (state.emittedToolUseIds.has(exec.id)) return []
        state.emittedToolUseIds.add(exec.id)

        const event: AgentEvent = {
          type: 'tool-use',
          sessionId: state.sessionId,
          toolUseId: exec.id,
          name: 'Bash',
          input: { command: exec.command, cwd: exec.cwd },
          messageId,
        }
        return [event]
      }

      // Emit tool-use for fileChange items when they start.
      if (item.type === 'fileChange') {
        const fc = item as unknown as CodexFileChangeItem
        if (state.emittedToolUseIds.has(fc.id)) return []
        state.emittedToolUseIds.add(fc.id)

        const firstChange = fc.changes?.[0]
        const toolName = firstChange?.kind?.type === 'add' ? 'Write' : 'Edit'
        const event: AgentEvent = {
          type: 'tool-use',
          sessionId: state.sessionId,
          toolUseId: fc.id,
          name: toolName,
          input: { changes: fc.changes },
          messageId,
        }
        return [event]
      }

      return []
    }

    case 'item/agentMessage/delta': {
      const p = params as AgentMessageDeltaParams
      if (!p?.delta) return []

      const messageId = state.itemMessageIds.get(p.itemId) ?? syntheticMessageId(p.itemId)

      const event: AgentEvent = {
        type: 'text-delta',
        sessionId: state.sessionId,
        messageId,
        delta: p.delta,
        seq: state.seq++,
      }
      return [event]
    }

    case 'item/reasoning/textDelta': {
      const p = params as ReasoningTextDeltaParams
      if (!p?.delta) return []

      const messageId = state.itemMessageIds.get(p.itemId) ?? syntheticMessageId(p.itemId)

      const event: AgentEvent = {
        type: 'thinking-delta',
        sessionId: state.sessionId,
        messageId,
        delta: p.delta,
        seq: state.seq++,
      }
      return [event]
    }

    case 'item/completed': {
      const p = params as ItemCompletedParams
      const item = p?.item
      if (!item) return []

      const messageId = state.itemMessageIds.get(item.id) ?? syntheticMessageId(item.id)

      if (item.type === 'agentMessage' || item.type === 'reasoning') {
        const event: AgentEvent = {
          type: 'message-end',
          sessionId: state.sessionId,
          messageId,
          stopReason: 'end_turn',
        }
        return [event]
      }

      if (item.type === 'commandExecution') {
        const exec = item as unknown as CodexCommandExecutionItem
        const isError = exec.status === 'failed' || exec.status === 'declined'
        const event: AgentEvent = {
          type: 'tool-result',
          sessionId: state.sessionId,
          toolUseId: exec.id,
          output: exec.aggregatedOutput ?? '',
          isError,
          durationMs: exec.durationMs ?? 0,
        }
        return [event]
      }

      if (item.type === 'fileChange') {
        const fc = item as unknown as CodexFileChangeItem
        const isError = fc.status === 'failed'
        const event: AgentEvent = {
          type: 'tool-result',
          sessionId: state.sessionId,
          toolUseId: fc.id,
          output: fc.status,
          isError,
          durationMs: 0,
        }
        return [event]
      }

      return []
    }

    case 'thread/tokenUsage/updated': {
      const p = params as TokenUsageUpdatedParams
      const last = p?.tokenUsage?.last
      if (!last) return []

      // Accumulate token usage; turn-result will read these.
      state.inputTokens = last.inputTokens ?? 0
      state.outputTokens = last.outputTokens ?? 0
      state.cacheReadTokens = last.cachedInputTokens ?? 0
      return []
    }

    case 'turn/completed': {
      const p = params as TurnCompletedParams
      const turn = p?.turn
      if (!turn) return []

      const usage: TokenUsage = {
        inputTokens: state.inputTokens,
        outputTokens: state.outputTokens,
        cacheReadTokens: state.cacheReadTokens || undefined,
      }

      const durationMs = turn.durationMs ?? 0

      const event: AgentEvent = {
        type: 'turn-result',
        sessionId: state.sessionId,
        usage,
        // Codex does not expose per-turn cost via app-server protocol.
        costUSD: 0,
        durationMs,
      }
      return [event]
    }

    case 'error': {
      const p = params as ErrorNotificationParams
      if (!p?.error) return []

      const code = classifyCodexError(p.error.codexErrorInfo)
      const event: AgentEvent = {
        type: 'error',
        sessionId: state.sessionId,
        code,
        message: p.error.message,
        recoverable: code === 'AGENT_RATE_LIMITED' || code === 'AGENT_NETWORK',
      }
      return [event]
    }

    // Notifications that produce no AgentEvent (informational only).
    case 'turn/started':
    case 'turn/diff/updated':
    case 'turn/plan/updated':
    case 'thread/status/changed':
    case 'thread/name/updated':
    case 'thread/settings/updated':
    case 'thread/archived':
    case 'thread/unarchived':
    case 'thread/closed':
    case 'thread/compacted':
    case 'hook/started':
    case 'hook/completed':
    case 'item/plan/delta':
    case 'item/commandExecution/outputDelta':
    case 'item/commandExecution/terminalInteraction':
    case 'item/fileChange/outputDelta':
    case 'item/fileChange/patchUpdated':
    case 'item/autoApprovalReview/started':
    case 'item/autoApprovalReview/completed':
    case 'item/reasoning/summaryTextDelta':
    case 'item/reasoning/summaryPartAdded':
    case 'rawResponseItem/completed':
    case 'process/outputDelta':
    case 'process/exited':
    case 'command/exec/outputDelta':
    case 'serverRequest/resolved':
    case 'item/mcpToolCall/progress':
    case 'mcpServer/oauthLogin/completed':
    case 'mcpServer/startupStatus/updated':
    case 'account/updated':
    case 'account/rateLimits/updated':
    case 'app/list/updated':
    case 'remoteControl/status/changed':
    case 'fs/changed':
    case 'model/rerouted':
    case 'model/verification':
    case 'warning':
    case 'guardianWarning':
    case 'deprecationNotice':
    case 'configWarning':
    case 'skills/changed':
    case 'thread/goal/updated':
    case 'thread/goal/cleared':
      return []

    default:
      // Unknown notification — log-worthy but not fatal.
      return []
  }
}
