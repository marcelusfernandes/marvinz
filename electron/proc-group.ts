import { execFileSync } from 'node:child_process'

// Direct children of `pid`. Empty when there are none (pgrep exits non-zero) or
// pgrep is unavailable (e.g. Windows) — callers then just signal `pid` itself.
function childPids(pid: number): number[] {
  try {
    return execFileSync('pgrep', ['-P', String(pid)], { encoding: 'utf8' })
      .split('\n')
      .map((s) => parseInt(s, 10))
      .filter((n) => Number.isInteger(n) && n > 0)
  } catch {
    return []
  }
}

// Every pid in the subtree rooted at `pid` (including `pid`), parents before
// children. Walks parent→child links (pgrep -P), so it captures grandchildren
// that escaped into their own session/process group via setsid — e.g. MCP
// servers, a CLI's app-server, sub-shells. A single group kill (`-pid`) only
// reaches the leader's own group and misses those.
export function collectProcessTree(pid: number): number[] {
  const out: number[] = [pid]
  for (const child of childPids(pid)) out.push(...collectProcessTree(child))
  return out
}

// Best-effort signal to a previously-captured set of pids, deepest first so a
// child is signalled before the parent that owns it can exit. Ignores pids that
// are already gone. Capturing the set up front (rather than re-walking) means
// reparenting during a SIGTERM grace window doesn't lose track of descendants.
export function signalPids(pids: readonly number[], signal: NodeJS.Signals): void {
  for (let i = pids.length - 1; i >= 0; i--) {
    try {
      process.kill(pids[i], signal)
    } catch {
      // Already exited.
    }
  }
}

// Convenience one-shot: capture the subtree and signal it immediately.
export function killProcessTree(pid: number | undefined, signal: NodeJS.Signals): void {
  if (pid == null) return
  signalPids(collectProcessTree(pid), signal)
}
