import { describe, it, expect } from 'vitest'
import { spawn } from 'node:child_process'
import { collectProcessTree, signalPids, killProcessTree } from '../proc-group'

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function waitDead(pid: number, timeoutMs = 2000): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (!isAlive(pid)) return true
    await new Promise((r) => setTimeout(r, 25))
  }
  return !isAlive(pid)
}

// Spawn a child that spawns a DETACHED grandchild (its own session/process
// group) — mirroring how real agents' children (MCP servers, app-servers,
// sub-shells) escape the agent's group. Resolves with both pids.
function spawnTreeWithEscapedGrandchild(): Promise<{
  childPid: number
  grandchildPid: number
  cleanup: () => void
}> {
  return new Promise((resolve, reject) => {
    const code =
      "const cp=require('child_process');" +
      "const gc=cp.spawn('sleep',['30'],{detached:true});gc.unref();" +
      "process.stdout.write(String(gc.pid));setInterval(()=>{},1e9);"
    // Child is a group leader (detached) so the contrast test can group-kill it;
    // the grandchild escapes into its own group regardless.
    const child = spawn(process.execPath, ['-e', code], { detached: true })
    child.once('error', reject)
    child.stdout!.once('data', (d: Buffer) => {
      const grandchildPid = parseInt(d.toString().trim(), 10)
      resolve({
        childPid: child.pid!,
        grandchildPid,
        cleanup: () => {
          for (const pid of [child.pid!, grandchildPid]) {
            try { process.kill(pid, 'SIGKILL') } catch { /* ignore */ }
          }
        },
      })
    })
  })
}

describe('collectProcessTree / killProcessTree', () => {
  it('captures a grandchild that lives in its own process group', async () => {
    const t = await spawnTreeWithEscapedGrandchild()
    try {
      const tree = collectProcessTree(t.childPid)
      expect(tree).toContain(t.childPid)
      expect(tree).toContain(t.grandchildPid)
    } finally {
      t.cleanup()
    }
  })

  it('reaps the whole tree, including the escaped grandchild', async () => {
    const t = await spawnTreeWithEscapedGrandchild()
    expect(isAlive(t.grandchildPid)).toBe(true)

    killProcessTree(t.childPid, 'SIGKILL')

    expect(await waitDead(t.childPid)).toBe(true)
    expect(await waitDead(t.grandchildPid)).toBe(true)
  })

  it('a single group kill (-pid) would miss the escaped grandchild — the bug this guards against', async () => {
    const t = await spawnTreeWithEscapedGrandchild()
    try {
      // Kill only the child's process group; the grandchild is in its own group.
      try { process.kill(-t.childPid, 'SIGKILL') } catch { /* ignore */ }
      expect(await waitDead(t.childPid)).toBe(true)
      await new Promise((r) => setTimeout(r, 150))
      expect(isAlive(t.grandchildPid)).toBe(true) // survives a group-only kill
    } finally {
      t.cleanup()
    }
  })

  it('killProcessTree is a no-op for an undefined pid', () => {
    expect(() => killProcessTree(undefined, 'SIGKILL')).not.toThrow()
  })

  it('signalPids ignores pids that are already gone', () => {
    expect(() => signalPids([2 ** 30], 'SIGKILL')).not.toThrow()
  })
})
