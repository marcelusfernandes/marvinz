import path from 'node:path'
import { existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'

/**
 * Whether two paths differ only in case. Uses path.resolve so both relative
 * and already-absolute inputs compare consistently.
 */
export function isCaseOnlyPath(oldPath: string, newPath: string): boolean {
  const a = path.resolve(oldPath)
  const b = path.resolve(newPath)
  return a !== b && a.toLowerCase() === b.toLowerCase()
}

/** Whether two stat results identify the same inode on the same device. */
export function isSameFile(
  a: { ino: number; dev: number },
  b: { ino: number; dev: number }
): boolean {
  return a.ino === b.ino && a.dev === b.dev
}

/**
 * Throws MARVIN_FS_EEXIST if newPath is occupied by a file distinct from
 * oldPath. On case-insensitive filesystems (default APFS/NTFS), renaming
 * "notes.md" to "Notes.md" makes existsSync(newPath) true because it resolves
 * to the same inode as oldPath — that's not a collision, so string identity
 * alone (isCaseOnlyPath) isn't a safe discriminator: it can't tell a same-file
 * case rename apart from two distinct files that happen to share a lowercase
 * path (possible on case-sensitive volumes). Confirming inode+device identity
 * (isSameFile) before allowing the case-only path through avoids clobbering a
 * genuinely different file in that scenario.
 */
export async function assertRenameTargetAvailable(oldPath: string, newPath: string): Promise<void> {
  if (!existsSync(newPath)) return
  const caseOnly = isCaseOnlyPath(oldPath, newPath)
  const sameFile = caseOnly && isSameFile(await stat(oldPath), await stat(newPath))
  if (!sameFile) throw new Error('MARVIN_FS_EEXIST')
}
