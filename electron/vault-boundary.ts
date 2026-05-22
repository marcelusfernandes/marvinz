import fs from 'node:fs/promises'
import path from 'node:path'

function rejectOutside(abs: string, vault: string): void {
  if (abs !== vault && !abs.startsWith(vault + path.sep)) {
    throw new Error('MARVIN_OUTSIDE_VAULT')
  }
}

/**
 * Sync boundary check — no symlink resolution (fast path).
 * Rejects null bytes, path traversal, and absolute paths outside the vault.
 * Throws 'MARVIN_OUTSIDE_VAULT' on any violation.
 */
export function assertInsideVault(vaultPath: string, targetPath: string): void {
  if (targetPath.includes('\0')) throw new Error('MARVIN_OUTSIDE_VAULT')
  const vault = path.resolve(vaultPath)
  const abs = path.resolve(targetPath)
  rejectOutside(abs, vault)
}

/**
 * Async boundary check for a cwd (directory) argument.
 *
 * Unlike assertInsideVaultAsync, skips the parent-dir check — cwd must be the
 * vault root itself or a subdirectory inside it. Resolves symlinks on the
 * directory entry itself to block symlink-escaped cwds.
 *
 * Throws 'MARVIN_OUTSIDE_VAULT' on any violation.
 */
export async function assertCwdInsideVaultAsync(vaultPath: string, cwd: string): Promise<string> {
  if (cwd.includes('\0')) throw new Error('MARVIN_OUTSIDE_VAULT')
  const vault = path.resolve(vaultPath)
  const abs = path.resolve(cwd)
  rejectOutside(abs, vault)
  return checkEntry(abs, vault)
}

/**
 * Async boundary check with full symlink resolution.
 *
 * Checks the parent directory and the target path itself — including dangling
 * symlinks (C3): lstat detects the symlink entry, then realpath is forced;
 * if realpath throws ENOENT it means the target is dangling → rejected.
 *
 * Returns the realpath-resolved safe I/O path so callers have no TOCTOU
 * window between check and use (C2).
 *
 * Throws 'MARVIN_OUTSIDE_VAULT' on any violation.
 */
export async function assertInsideVaultAsync(vaultPath: string, targetPath: string): Promise<string> {
  if (targetPath.includes('\0')) throw new Error('MARVIN_OUTSIDE_VAULT')
  const vault = path.resolve(vaultPath)
  const abs = path.resolve(targetPath)
  rejectOutside(abs, vault)

  // --- Parent directory check ---
  // C3: lstat the parent dir before realpath so symlinked dirs are caught.
  await checkEntry(path.dirname(abs), vault)

  // --- File/target check (C3 exact fix) ---
  const safeAbs = await checkEntry(abs, vault)

  return safeAbs
}

/**
 * lstat-first boundary check for a single path entry.
 *
 * - ENOENT on lstat → entry doesn't exist and is not a symlink → safe for
 *   create/write ops, return the lexical path.
 * - isSymbolicLink() → force realpath; if realpath throws ENOENT the symlink
 *   is dangling → reject (dangling symlinks are never safe).
 * - Regular file/dir → realpath to resolve symlinked ancestors.
 *
 * Returns the resolved absolute path for use in subsequent I/O.
 */
async function checkEntry(target: string, vault: string): Promise<string> {
  let stat: import('node:fs').Stats
  try {
    stat = await fs.lstat(target)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      // Entry does not exist and is not a symlink — OK for create/write ops.
      return target
    }
    throw e
  }

  if (stat.isSymbolicLink()) {
    // C3: entry is a symlink (possibly dangling). Force realpath — ENOENT here
    // means the link target doesn't exist (dangling) → must reject.
    let real: string
    try {
      real = await fs.realpath(target)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error('MARVIN_OUTSIDE_VAULT')
      }
      throw e
    }
    rejectOutside(real, vault)
    return real
  }

  // Regular file or directory — resolve any symlinked ancestors.
  try {
    const real = await fs.realpath(target)
    rejectOutside(real, vault)
    return real
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
    return target
  }
}
