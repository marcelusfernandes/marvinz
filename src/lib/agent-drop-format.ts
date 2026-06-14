// Format a list of absolute vault paths into the string an agent input
// expects. Used by drop targets in AgentTerminal (Codex CLI) and ChatPanel
// (Claude Code) so each agent's path-quoting convention lives in one place.
//
// Codex      → "@<rel>" per path, space-separated
// claude-code →  "<rel>"  per path, space-separated
//
// Paths inside the workspace become relative to workspaceRoot; paths
// outside are kept absolute (better than infinite "../" climbs). Paths
// with whitespace are wrapped in double-quotes — quotes go INSIDE the @
// for Codex so `@"my file.md"` is a single argument.

export type AgentKind = 'codex' | 'claude-code'

function toRelative(absolute: string, workspaceRoot: string): string {
  if (!workspaceRoot) return absolute
  const rootWithSep = workspaceRoot.endsWith('/') ? workspaceRoot : workspaceRoot + '/'
  if (absolute === workspaceRoot) return '.'
  if (absolute.startsWith(rootWithSep)) {
    return absolute.slice(rootWithSep.length)
  }
  return absolute
}

function quoteIfNeeded(value: string): string {
  return /\s/.test(value) ? `"${value}"` : value
}

export function formatPathsForAgent(
  paths: string[],
  agent: AgentKind,
  workspaceRoot: string
): string {
  if (paths.length === 0) return ''
  const prefix = agent === 'codex' ? '@' : ''
  return paths
    .map((p) => {
      const rel = toRelative(p, workspaceRoot)
      const quoted = quoteIfNeeded(rel)
      return prefix + quoted
    })
    .join(' ')
}
