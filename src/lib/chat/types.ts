// Renderer-side chat domain types. Mirrors electron/agent/protocol.ts for
// IPC event shapes (kept in sync manually — same convention as preload.ts).

export type SessionId = string
export type MessageId = string
export type ToolCallId = string

export type Provider = 'claude' | 'codex'
export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'auto'

export type ToolStatus =
  | 'pending_approval'
  | 'running'
  | 'ok'
  | 'error'
  | 'denied'
  | 'cancelled'

export type AssistantBlock =
  | { kind: 'thinking'; id: string; text: string }
  | { kind: 'text'; id: string; text: string }
  | {
      kind: 'tool_use'
      id: ToolCallId
      tool: string
      input: unknown
      status: ToolStatus
      result?: unknown
      errorMessage?: string
      durationMs?: number
      /** Wall-clock ms when the approval window expires (status=pending_approval only). */
      approvalDeadlineAt?: number
      /** Pre-edit snapshot outcome for Edit/Write tools (A4 snapshot integration). */
      snapshotSaved?: boolean
      /** Snapshot turn id — pass to `snapshot.read(turnId, relPath)` for the
       *  pre-edit content. Present alongside `snapshotSaved` for SNAPSHOT_TOOLS. */
      snapshotTurnId?: string
    }

export type Mention = { path: string; line?: number; range?: [number, number] }

export type TokenUsage = {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}

export type UserMessage = {
  id: MessageId
  role: 'user'
  text: string
  createdAt: number
  /** Agent turn id assigned by main after the first turn-snapshot-summary
   * arrives for this turn. Used by the Rewind button to open SnapshotPanel
   * pre-selected to the snapshot taken at the start of this user turn. */
  turnId?: string
}

export type AssistantMessage = {
  id: MessageId
  role: 'assistant'
  blocks: AssistantBlock[]
  createdAt: number
  done: boolean
}

export type SystemMessage = {
  id: MessageId
  role: 'system'
  text: string
  createdAt: number
}

export type Message = UserMessage | AssistantMessage | SystemMessage

export type TurnState =
  | 'idle'
  | 'streaming'
  | 'awaiting_approval'
  | 'error'

export type Session = {
  id: SessionId
  agentId: Provider
  vaultPath: string
  /** Per-message storage so per-message selectors don't see siblings change. */
  messages: Record<MessageId, Message>
  ordering: MessageId[]
  pendingApprovals: ToolCallId[]
  turnState: TurnState
  tokenUsage: TokenUsage
  composer: { draft: string; mentions: Mention[] }
  /** Currently-selected permission mode for the next turn (PRD AC6). */
  permissionMode: PermissionMode
  cliSessionId?: string
}

// Subset of AgentEvent shapes the renderer cares about. Mirrors
// electron/agent/protocol.ts AgentEvent — kept in sync manually.
export type ChatStreamEvent =
  | {
      type: 'session-init'
      sessionId: SessionId
      provider: Provider
      cliSessionId: string
      model: string
      cwd: string
      startedAt: number
    }
  | {
      type: 'message-start'
      sessionId: SessionId
      messageId: MessageId
      role: 'assistant' | 'user'
    }
  | {
      type: 'text-delta'
      sessionId: SessionId
      messageId: MessageId
      delta: string
      seq: number
    }
  | {
      type: 'thinking-delta'
      sessionId: SessionId
      messageId: MessageId
      delta: string
      seq: number
    }
  | {
      type: 'tool-use'
      sessionId: SessionId
      toolUseId: ToolCallId
      name: string
      input: unknown
      messageId: MessageId
      /** Pre-edit snapshot outcome — present only for SNAPSHOT_TOOLS (A4). */
      snapshotSaved?: boolean
      /** Snapshot turn id — present only for SNAPSHOT_TOOLS (A4). */
      snapshotTurnId?: string
    }
  | {
      type: 'tool-result'
      sessionId: SessionId
      toolUseId: ToolCallId
      output: unknown
      isError: boolean
      durationMs: number
    }
  | {
      type: 'permission-request'
      sessionId: SessionId
      toolUseId: ToolCallId
      toolName: string
      input: unknown
      risk: 'safe' | 'destructive' | 'network'
      suggestion: 'allow' | 'review'
      /** ms until main times out the approval; renderer drives countdown UI. */
      timeoutMs?: number
      /** Pre-edit snapshot outcome — present only for Edit/Write tools (A4). */
      snapshotSaved?: boolean
      /** Snapshot turn id — present only for Edit/Write tools (A4). */
      snapshotTurnId?: string
    }
  | {
      type: 'snapshot-warning'
      sessionId: SessionId
      toolUseId: ToolCallId
      filePath: string
      reason: string
    }
  | {
      type: 'turn-snapshot-summary'
      sessionId: SessionId
      turnId: string
      fileCount: number
      fileNames: string[]
    }
  | {
      type: 'message-end'
      sessionId: SessionId
      messageId: MessageId
      stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'cancelled'
    }
  | {
      type: 'turn-result'
      sessionId: SessionId
      usage: TokenUsage
      costUSD: number
      durationMs: number
    }
  | {
      type: 'error'
      sessionId: SessionId
      code: string
      message: string
      recoverable: boolean
    }
  | {
      type: 'crashed'
      sessionId: SessionId
      exitCode: number | null
      signal: string | null
    }
