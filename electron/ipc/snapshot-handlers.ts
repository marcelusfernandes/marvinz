// snapshot:* IPC handlers — turn/undo history listing, reading, restoring,
// and user-driven capture/restore. Extracted from main.ts (#577); shared
// state main.ts still owns (activeVaultPath, activeTurnId, the file-content
// cache, notifyTree) flows in via `SnapshotHandlersCtx` rather than a
// circular import of main.js. `assertInVault` also stays main.ts-owned
// (closes over activeVaultPath; file:writeBinary, folder:create,
// file:move-batch, and shell:reveal are out of scope for this move and also
// call it) and is threaded the same way.
import { ipcMain } from 'electron'
import path from 'node:path'
import {
  writeSnapshot,
  newTurnId,
  listTurns,
  listForFile,
  readSnapshot,
  restoreSnapshot,
  captureUserSnapshot,
  restoreUserSnapshot,
  type UserSnapshotTrigger,
} from '../snapshot.js'
import { IPC_CHANNELS } from '../../src/shared/ipc-channels.js'

export type SnapshotHandlersCtx = {
  getActiveVaultPath: () => string | null
  assertInVault: (filePath: string) => Promise<string>
  getActiveTurnId: () => string | null
  setActiveTurnId: (id: string | null) => void
  deleteFileCacheEntry: (key: string) => void
  notifyTree: () => void
}

// PRD format: <ISO-8601-compact>Z-<12-char-hex-salt>  e.g. 20250521T120345Z-abc123def456
const TURN_ID_RE = /^\d{8}T\d{6}Z-[0-9a-f]{12}$/i

function validateTurnId(turnId: unknown): string {
  if (typeof turnId !== 'string' || !TURN_ID_RE.test(turnId)) {
    throw new Error('SNAPSHOT_INVALID_TURN_ID')
  }
  return turnId
}

const MARVIN_DIR_PREFIX = '.marvin'

function validateRelPath(relPath: unknown): string {
  if (typeof relPath !== 'string' || !relPath) throw new Error('SNAPSHOT_INVALID_REL_PATH')
  if (relPath.includes('\0')) throw new Error('SNAPSHOT_INVALID_REL_PATH') // L4: null byte
  const normalized = path.normalize(relPath)
  if (normalized.startsWith('..') || path.isAbsolute(normalized)) {
    throw new Error('SNAPSHOT_INVALID_REL_PATH')
  }
  // L5: block access to .marvin/ internals via IPC
  if (normalized === MARVIN_DIR_PREFIX || normalized.startsWith(MARVIN_DIR_PREFIX + path.sep)) {
    throw new Error('SNAPSHOT_INVALID_REL_PATH')
  }
  return normalized
}

type SnapshotEnvelope<T> = { ok: true; data: T } | { ok: false; error: string }

function ok<T>(data: T): SnapshotEnvelope<T> {
  return { ok: true, data }
}

// M9: never leak absolute host paths or fs error details to the renderer.
// Whitelist our own error codes; map fs errors to SNAPSHOT_FS_<CODE>;
// everything else becomes SNAPSHOT_INTERNAL_ERROR.
const KNOWN_CODE_RE = /^(MARVIN|SNAPSHOT)_[A-Z_]+$/
function err(e: unknown): SnapshotEnvelope<never> {
  const message = e instanceof Error ? e.message : ''
  if (KNOWN_CODE_RE.test(message)) return { ok: false, error: message }
  const fsCode = (e as NodeJS.ErrnoException)?.code
  return { ok: false, error: fsCode ? `SNAPSHOT_FS_${fsCode}` : 'SNAPSHOT_INTERNAL_ERROR' }
}

const BUFFER_SAVE_MAX_BYTES = 50 * 1024 * 1024 // 50 MB hard cap

// U2: user-driven snapshot capture/restore (no AI turn required)
// Validate snapshotId is a UUID v4 to prevent path traversal via the id parameter
const SNAPSHOT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function registerSnapshotHandlers(ctx: SnapshotHandlersCtx): void {
  function requireVault(): string {
    const vault = ctx.getActiveVaultPath()
    if (!vault) throw new Error('SNAPSHOT_NO_VAULT')
    return vault
  }

  ipcMain.handle(IPC_CHANNELS.snapshot.listTurns, async () => {
    try {
      const vault = requireVault()
      const turns = await listTurns(vault)
      return ok(turns)
    } catch (e) {
      return err(e)
    }
  })

  ipcMain.handle(IPC_CHANNELS.snapshot.listForFile, async (_e, relPath: unknown) => {
    try {
      const vault = requireVault()
      const rel = validateRelPath(relPath)
      const turns = await listForFile(vault, rel)
      return ok(turns)
    } catch (e) {
      return err(e)
    }
  })

  ipcMain.handle(IPC_CHANNELS.snapshot.read, async (_e, turnId: unknown, relPath: unknown) => {
    try {
      const vault = requireVault()
      const tid = validateTurnId(turnId)
      const rel = validateRelPath(relPath)
      const content = await readSnapshot(vault, tid, rel)
      return ok(content)
    } catch (e) {
      return err(e)
    }
  })

  ipcMain.handle(IPC_CHANNELS.snapshot.restore, async (_e, turnId: unknown, relPath: unknown) => {
    try {
      const vault = requireVault()
      const tid = validateTurnId(turnId)
      const rel = validateRelPath(relPath)
      const preTurnId = await restoreSnapshot(vault, tid, rel)
      // Invalidate cache so the next file:read picks up the restored content
      const absPath = path.join(vault, rel)
      ctx.deleteFileCacheEntry(absPath)
      ctx.notifyTree()
      return ok({ preTurnId })
    } catch (e) {
      return err(e)
    }
  })

  ipcMain.handle(
    IPC_CHANNELS.snapshot.saveBuffer,
    async (_e, relPath: unknown, content: unknown) => {
      try {
        if (typeof content !== 'string') throw new Error('SNAPSHOT_INVALID_CONTENT')
        if (Buffer.byteLength(content, 'utf8') > BUFFER_SAVE_MAX_BYTES)
          throw new Error('SNAPSHOT_BUFFER_TOO_LARGE')
        const vault = requireVault()
        const rel = validateRelPath(relPath)
        let turnId = ctx.getActiveTurnId()
        if (!turnId) {
          turnId = newTurnId()
          ctx.setActiveTurnId(turnId)
        }
        const saved = await writeSnapshot(vault, turnId, rel, content, 'buffer-save')
        return ok({ turnId, saved })
      } catch (e) {
        return err(e)
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.snapshot.saveExternalChange,
    async (_e, relPath: unknown, content: unknown) => {
      try {
        const vault = requireVault()
        const rel = validateRelPath(relPath)
        if (typeof content !== 'string') throw new Error('SNAPSHOT_INVALID_CONTENT')
        if (Buffer.byteLength(content, 'utf8') > BUFFER_SAVE_MAX_BYTES) {
          throw new Error('SNAPSHOT_BUFFER_TOO_LARGE')
        }
        let turnId = ctx.getActiveTurnId()
        if (!turnId) {
          turnId = newTurnId()
          ctx.setActiveTurnId(turnId)
        }
        const saved = await writeSnapshot(vault, turnId, rel, content, 'external-rejected')
        return ok({ turnId, saved })
      } catch (e) {
        return err(e)
      }
    }
  )

  ipcMain.handle(IPC_CHANNELS.snapshot.capture, async (_e, payload: unknown) => {
    try {
      if (!payload || typeof payload !== 'object') throw new Error('SNAPSHOT_INVALID_PAYLOAD')
      const { paths, trigger } = payload as Record<string, unknown>

      if (!Array.isArray(paths) || paths.length === 0) throw new Error('SNAPSHOT_INVALID_PATHS')
      if (paths.some((p) => typeof p !== 'string')) throw new Error('SNAPSHOT_INVALID_PATHS')

      if (typeof trigger !== 'string') throw new Error('MARVIN_INVALID_TRIGGER')

      const vault = requireVault()

      // assertInVault: realpath-resolves + TOCTOU-safe boundary check — same as path:trash.
      // Renderer sends absolute paths; we derive vault-relative paths from the safe result.
      const relPaths: string[] = await Promise.all(
        (paths as string[]).map(async (rawPath) => {
          const safe = await ctx.assertInVault(rawPath)
          return path.relative(vault, safe)
        })
      )

      const snapshotId = await captureUserSnapshot(vault, relPaths, trigger as UserSnapshotTrigger)
      return ok({ snapshotId })
    } catch (e) {
      return err(e)
    }
  })

  ipcMain.handle(IPC_CHANNELS.snapshot.restoreOne, async (_e, payload: unknown) => {
    try {
      if (!payload || typeof payload !== 'object') throw new Error('SNAPSHOT_INVALID_PAYLOAD')
      const { snapshotId } = payload as Record<string, unknown>

      if (typeof snapshotId !== 'string' || !SNAPSHOT_ID_RE.test(snapshotId)) {
        throw new Error('SNAPSHOT_INVALID_ID')
      }

      const vault = requireVault()
      const restoredPaths = await restoreUserSnapshot(vault, snapshotId)

      // Invalidate cache for each restored path — mirrors snapshot:restore behaviour
      for (const relPath of restoredPaths) {
        ctx.deleteFileCacheEntry(path.join(vault, relPath))
      }
      ctx.notifyTree()
      return ok({})
    } catch (e) {
      return err(e)
    }
  })
}
