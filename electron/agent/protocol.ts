// Shared discriminated union types for IPC between main and renderer.
// Renderer → Main via agent:request (invoke).
// Main → Renderer via agent:event:<sessionId> (push/broadcast).

export type Provider = 'claude' | 'codex'

export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'auto'

export type ApprovalDecision =
  | { kind: 'allow'; remember?: 'session' | 'always' }
  | { kind: 'deny'; reason?: string }

export type AgentRequest =
  | {
      type: 'start'
      sessionId: string
      provider: Provider
      prompt: string
      vaultRoot: string
      resumeFromSessionId?: string
      model?: string
      permissionMode: PermissionMode
    }
  | { type: 'cancel'; sessionId: string }
  | { type: 'kill'; sessionId: string }
  | {
      type: 'approval'
      sessionId: string
      toolUseId: string
      decision: ApprovalDecision
    }
  | { type: 'input'; sessionId: string; content: string }
  | { type: 'list-sessions'; vaultRoot: string }
  | { type: 'load-session'; sessionId: string }

export type TokenUsage = {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}

export type ErrorCode =
  | 'AGENT_NOT_FOUND'
  | 'AGENT_NOT_AUTHENTICATED'
  | 'AGENT_RATE_LIMITED'
  | 'AGENT_NETWORK'
  | 'AGENT_INVALID_STREAM'
  | 'AGENT_VAULT_FORBIDDEN'
  | 'AGENT_PERMISSION_TIMEOUT'
  | 'AGENT_INTERNAL'

export type AgentEvent =
  | {
      type: 'session-init'
      sessionId: string
      provider: Provider
      cliSessionId: string
      model: string
      cwd: string
      startedAt: number
    }
  | {
      type: 'message-start'
      sessionId: string
      messageId: string
      role: 'assistant' | 'user'
    }
  | {
      type: 'text-delta'
      sessionId: string
      messageId: string
      delta: string
      seq: number
    }
  | {
      type: 'thinking-delta'
      sessionId: string
      messageId: string
      delta: string
      seq: number
    }
  | {
      type: 'tool-use'
      sessionId: string
      toolUseId: string
      name: string
      input: unknown
      messageId: string
    }
  | {
      type: 'tool-result'
      sessionId: string
      toolUseId: string
      output: unknown
      isError: boolean
      durationMs: number
    }
  | {
      type: 'permission-request'
      sessionId: string
      toolUseId: string
      toolName: string
      input: unknown
      risk: 'safe' | 'destructive' | 'network'
      suggestion: 'allow' | 'review'
      timeoutMs?: number
    }
  | {
      type: 'message-end'
      sessionId: string
      messageId: string
      stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'cancelled'
    }
  | {
      type: 'turn-result'
      sessionId: string
      usage: TokenUsage
      costUSD: number
      durationMs: number
    }
  | {
      type: 'error'
      sessionId: string
      code: ErrorCode
      message: string
      recoverable: boolean
    }
  | {
      type: 'crashed'
      sessionId: string
      exitCode: number | null
      signal: NodeJS.Signals | null
    }

export type AuthState = { loggedIn: true; since: number } | { loggedIn: false }

export type SessionMeta = {
  id: string
  cliSessionId?: string
  provider: Provider
  title: string
  createdAt: number
  updatedAt: number
  totalCostUSD: number
  totalTokens: number
  turns: number
}
