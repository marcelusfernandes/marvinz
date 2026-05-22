import fs from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { assertCwdInsideVaultAsync } from './vault-boundary.js'

export type PtySpawnOpts = {
  id: string
  shell: string
  cwd: string
  cols: number
  rows: number
  args?: string[]
}

const GENERIC_SHELLS = new Set([
  '/bin/sh', '/bin/bash', '/bin/zsh',
  '/usr/bin/sh', '/usr/bin/bash', '/usr/bin/zsh',
  '/usr/local/bin/bash', '/usr/local/bin/zsh',
  '/opt/homebrew/bin/bash', '/opt/homebrew/bin/zsh',
])

// Agent binaries registered at runtime via registerDynamicShell (called after agent:detect)
const dynamicShells = new Set<string>()

export function registerDynamicShell(shell: string): void {
  try {
    dynamicShells.add(realpathSync(shell))
  } catch {
    // shell path doesn't exist or no perms — runtime check will reject spawn anyway
  }
}

export async function assertPtySpawnAllowed(
  vaultPath: string,
  opts: PtySpawnOpts,
): Promise<{ shell: string; cwd: string }> {
  // HIGH-2: resolve symlinks on the shell path before allowlist check to close
  // the symlink-swap vector (/usr/local/bin/zsh → /tmp/malicious)
  let resolvedShell: string
  try {
    resolvedShell = await fs.realpath(opts.shell)
  } catch {
    throw new Error('MARVIN_SHELL_NOT_ALLOWED')
  }

  if (!GENERIC_SHELLS.has(resolvedShell) && !dynamicShells.has(resolvedShell)) {
    throw new Error('MARVIN_SHELL_NOT_ALLOWED')
  }

  // HIGH-1: generic shells accept zero args — any arg is a potential inline exec vector.
  // Agent shells (in dynamicShells) have known CLI semantics and may receive args.
  if (GENERIC_SHELLS.has(resolvedShell) && (opts.args?.length ?? 0) > 0) {
    throw new Error('MARVIN_SHELL_ARGS_FORBIDDEN')
  }

  const safeCwd = await assertCwdInsideVaultAsync(vaultPath, opts.cwd)
  return { shell: resolvedShell, cwd: safeCwd }
}
