/**
 * fileOpsHistory — in-memory FIFO undo stack for file-panel operations (U3, #149).
 *
 * Holds up to 20 entries. Each entry records enough information to reverse
 * the operation:
 *   rename / move  → call window.marvin.path.rename(to, from)
 *   trash          → call window.marvin.snapshot.restoreOne(snapshotId)
 *
 * undoLast(toast) pops the most recent entry and executes the reverse IPC.
 * On failure the entry is re-pushed and the toast callback receives an error
 * message. On success the toast callback receives a confirmation message.
 *
 * Stack resets on app restart (in-memory only — no persistence).
 */

import { create } from 'zustand'
import { marvin } from './marvinApi'

export type FileOp =
  | { kind: 'rename'; from: string; to: string }
  | { kind: 'move'; from: string; to: string }
  | { kind: 'trash'; path: string; snapshotId: string }

/**
 * Outcome of an undo, used by App to reveal where the change landed (#456).
 *  - revealedPath: the file's restored location — App activates its open tab.
 *  - remap: rename/move move the file on disk but cannot touch React tab state,
 *    so App must call renameInTabs(remap.from, remap.to) (post-rename path →
 *    restored path) before activating, or the tab would point at a stale path.
 */
export type UndoResult = {
  ok: boolean
  revealedPath?: string
  remap?: { from: string; to: string }
}

export type FileOpsHistoryState = {
  history: FileOp[]
  /** Append op. Evicts oldest entry when cap of 20 is reached. */
  push: (op: FileOp) => void
  /**
   * Pop the most recent entry and execute the reverse IPC.
   * Calls toast(message) on success or failure, and resolves an UndoResult so
   * the caller can reveal the affected file. No-op (ok:false) on empty stack.
   */
  undoLast: (toast: (msg: string) => void) => Promise<UndoResult>
  /** Clear all entries (called on vault change / app reset). */
  reset: () => void
}

/** Max entries retained in the undo stack. */
const MAX_HISTORY = 20

/** Last path segment, for human-readable toast messages. */
function basename(p: string): string {
  const seg = p.split('/').filter(Boolean).pop()
  return seg ?? p
}

export const useFileOpsHistory = create<FileOpsHistoryState>((set, get) => ({
  history: [],

  push: (op) =>
    set((s) => ({
      // Append newest at the end, keep only the most recent MAX_HISTORY.
      history: [...s.history, op].slice(-MAX_HISTORY),
    })),

  undoLast: async (toast) => {
    const { history } = get()
    if (history.length === 0) return { ok: false }

    const op = history[history.length - 1]
    // Optimistically pop so the UI reflects the in-flight undo immediately.
    set((s) => ({ history: s.history.slice(0, -1) }))

    try {
      if (op.kind === 'trash') {
        // restoreOne resolves an { ok } envelope — it does NOT throw on
        // failure. Check it explicitly: otherwise a failed restore would
        // falsely report success and discard the only recovery handle
        // (snapshotId) while the file is still only in the OS Trash.
        const res = await marvin.snapshot.restoreOne(op.snapshotId)
        if (!res.ok) throw new Error(res.error)
        toast(`Restored ${basename(op.path)}`)
        // The restored file lives at op.path; no tab remap (the path is unchanged).
        return { ok: true, revealedPath: op.path }
      } else {
        // rename and move are both reversed by renaming `to` back to `from`.
        await window.marvin.path.rename(op.to, op.from)
        toast(`Undid ${op.kind}: ${basename(op.from)}`)
        // Reveal the restored origin; remap open tabs still recording `to`.
        return { ok: true, revealedPath: op.from, remap: { from: op.to, to: op.from } }
      }
    } catch {
      // Reverse failed (target missing, conflict, snapshot gone): restore the
      // entry so the user can retry or inspect, and explain the failure.
      set((s) => ({ history: [...s.history, op] }))
      const name = op.kind === 'trash' ? basename(op.path) : basename(op.from)
      toast(`Cannot undo: ${name} no longer exists`)
      return { ok: false }
    }
  },

  reset: () => set({ history: [] }),
}))
