// IPC types for main↔renderer agent communication.
// Core discriminated unions are defined in src/shared/agent-protocol.ts (renderer-safe).
// This module re-exports them for the electron/ side and adds Node-side extras.

export type {
  Provider,
  PermissionMode,
  ApprovalDecision,
  AgentRequest,
  TokenUsage,
  ErrorCode,
  AgentEvent,
} from '../../src/shared/agent-protocol.js'

import type { Provider } from '../../src/shared/agent-protocol.js'

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
