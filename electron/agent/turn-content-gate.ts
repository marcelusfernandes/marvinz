// Post-turn content-change gate (#537): decides which of a turn's touched
// files actually changed on disk, so `turn-snapshot-summary` reflects real
// edits instead of merely-attempted ones.

import fs from 'node:fs/promises'
import crypto from 'node:crypto'
import path from 'node:path'
import type { PreEditState } from './approval-socket.js'

function sha256(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex')
}

/**
 * Compare each touched file's current on-disk content against its pre-edit
 * state and return only the vault-relative paths that actually changed.
 *
 * A file counts as changed when: its content hash differs from the pre-edit
 * hash, it was created with non-empty content (it did not exist before), or
 * it was deleted (existed before, missing now). A file with no recorded
 * pre-edit state (should not normally happen for a touched file) is treated
 * like "did not exist before" — conservative, since a false positive only
 * costs an extra toast while a false negative would hide a real edit.
 * Files that error on read for a reason other than "missing" are also
 * conservatively treated as changed, for the same reason.
 */
export async function diffTouchedFiles(
  vaultRoot: string,
  touchedFiles: Iterable<string>,
  preEditStates: ReadonlyMap<string, PreEditState>
): Promise<string[]> {
  const relPaths = [...touchedFiles]

  const results = await Promise.all(
    relPaths.map(async (relPath) => {
      const preEdit = preEditStates.get(relPath)
      const absPath = path.resolve(vaultRoot, relPath)

      let current: string | null
      try {
        current = await fs.readFile(absPath, 'utf8')
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          current = null // deleted
        } else {
          return relPath // unreadable — conservatively treat as changed
        }
      }

      if (!preEdit || !preEdit.existed) {
        // Did not exist before: changed only if it now exists with content.
        return current !== null && current !== '' ? relPath : null
      }

      if (current === null) return relPath // existed before, gone now

      return sha256(current) !== preEdit.hash ? relPath : null
    })
  )

  return results.filter((relPath): relPath is string => relPath !== null)
}
