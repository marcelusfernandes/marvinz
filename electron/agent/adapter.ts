// AgentAdapter — the seam that groups everything a provider must define:
// state creation, binary/arg resolution, approval-socket usage, stdin
// handling, and NDJSON→AgentEvent translation. spawnAgent (index.ts) resolves
// one adapter per call via an `adapters: Record<Provider, AgentAdapter>` map
// instead of branching on `req.provider === 'codex'` at each of these points
// individually. Adding a third provider means adding one adapter object and
// one `adapters` entry — the Record type makes a missing entry a compile
// error, not a silent runtime gap (#582).
//
// Interface-only module: the concrete claudeAdapter/codexAdapter objects and
// the `adapters` map live in index.ts alongside buildClaudeArgs/
// buildCodexArgs (which they wrap unchanged) to avoid a circular import
// between this file and index.ts.
import type { ChildProcess } from 'node:child_process'
import type { AgentEvent, AgentRequest } from './protocol.js'
import type { AdapterState } from './adapter-claude.js'
import type { CodexAdapterState } from './adapter-codex.js'

export type AgentBinaries = {
  claude: string
  codex?: string
}

type StartRequest = Extract<AgentRequest, { type: 'start' }>

export type AgentAdapter = {
  // Creates this provider's mutable streaming-translation state. Folds in the
  // Claude-only `cwd` assignment (adapter-claude.ts's AdapterState has a cwd
  // field; Codex's state has no equivalent).
  makeState(sessionId: string, req: StartRequest): AdapterState | CodexAdapterState
  // Resolves the binary path to spawn for this provider from the caller-
  // supplied binaries map.
  resolveBinary(bins: AgentBinaries): string
  // Builds the CLI argv for this provider's invocation.
  buildArgs(req: StartRequest): string[]
  // Whether this provider uses the PreToolUse hook bridge over a Unix socket
  // (Claude) — Codex has no equivalent approval mechanism.
  usesApprovalSocket: boolean
  // Whatever this provider needs to do with the spawned process's stdin
  // right after spawn — Codex passes the prompt as argv and closes stdin
  // immediately; Claude writes the initial prompt as a stream-json input
  // event, then closes stdin.
  handleStdin(proc: ChildProcess, req: StartRequest): void
  // Translates one parsed NDJSON object into zero or more AgentEvents.
  adaptObj(obj: unknown, state: AdapterState | CodexAdapterState): AgentEvent[]
}
