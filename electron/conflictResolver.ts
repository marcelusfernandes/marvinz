import { existsSync } from 'node:fs'
import path from 'node:path'

// copy: always prefixes "Copy of " (signals it is a duplicate).
// move: preserves basename when no conflict; suffixes numerically on collision (a.md → a 2.md).
// Throws MARVIN_COPY_CONFLICT_LIMIT after 100 attempts. Single-op callers let it throw;
// batch callers catch per-item so one bad item doesn't kill the batch.
export async function resolveConflict(
  destDir: string,
  baseName: string,
  mode: 'copy' | 'move'
): Promise<string> {
  const ext = path.extname(baseName)
  const stem = ext ? baseName.slice(0, -ext.length) : baseName
  if (mode === 'move') {
    const direct = path.join(destDir, baseName)
    if (!existsSync(direct)) return direct
    for (let n = 2; n <= 100; n++) {
      const c = path.join(destDir, `${stem} ${n}${ext}`)
      if (!existsSync(c)) return c
    }
  } else {
    for (let n = 1; n <= 100; n++) {
      const c = path.join(destDir, n === 1 ? `Copy of ${stem}${ext}` : `Copy of ${stem} ${n}${ext}`)
      if (!existsSync(c)) return c
    }
  }
  throw new Error('MARVIN_COPY_CONFLICT_LIMIT')
}
