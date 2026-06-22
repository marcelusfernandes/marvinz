import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { shell } from 'electron'
import { assertInsideVaultAsync } from './vault-boundary.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SnapshotTrigger =
  | 'file:write'
  | 'watcher'
  | 'restore'
  | 'cascade'
  | 'buffer-save'
  | 'external-rejected'

export type UserSnapshotTrigger = 'user-trash' | 'user-rename' | 'user-move' | 'user-overwrite'

export type ManifestEntry = {
  relPath: string
  sizeBefore: number
  hashBefore: string
}

export type SnapshotStatus = 'active' | 'completed'

export type SnapshotManifest = {
  turnId: string
  files: ManifestEntry[]
  createdAt: string
  timestamp: number
  trigger: SnapshotTrigger
  status: SnapshotStatus
  agentId?: string
}

export type UserManifestEntry = {
  snapshotId: string
  paths: string[]
  trigger: UserSnapshotTrigger
  createdAt: string
  timestamp: number
}

export type UserManifest = {
  entries: UserManifestEntry[]
}

export type GCPolicy = {
  maxTurns: number
  maxAgeDays: number
  maxBytes: number
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MARVIN_DIR = '.marvin'
const SNAPSHOTS_DIR = 'snapshots'
const MANIFEST_NAME = '_manifest.json'

// Reserved bucket id for user-driven snapshots (no AI turn required)
const USER_BUCKET_ID = '_user'
const USER_FIFO_CAP = 50

const DEFAULT_GC_POLICY: GCPolicy = {
  maxTurns: 50,
  maxAgeDays: 7,
  maxBytes: 200 * 1024 * 1024, // 200 MB
}

// ---------------------------------------------------------------------------
// Validation helpers (H4: applied at every public API boundary)
// ---------------------------------------------------------------------------

const TURN_ID_RE = /^\d{8}T\d{6}Z-[a-f0-9]{8,}$/i

function assertTurnId(id: string): void {
  if (!TURN_ID_RE.test(id)) throw new Error('MARVIN_INVALID_TURN_ID')
}

function assertRelPath(relPath: string): void {
  if (!relPath || typeof relPath !== 'string') throw new Error('MARVIN_INVALID_PATH')
  if (relPath.includes('\0')) throw new Error('MARVIN_INVALID_PATH') // L4: null byte
  const normalized = path.normalize(relPath)
  if (normalized.startsWith('..') || path.isAbsolute(normalized)) {
    throw new Error('MARVIN_INVALID_PATH')
  }
}

const USER_TRIGGERS = new Set<UserSnapshotTrigger>([
  'user-trash',
  'user-rename',
  'user-move',
  'user-overwrite',
])

function assertUserTrigger(trigger: unknown): UserSnapshotTrigger {
  if (typeof trigger !== 'string' || !USER_TRIGGERS.has(trigger as UserSnapshotTrigger)) {
    throw new Error('MARVIN_INVALID_TRIGGER')
  }
  return trigger as UserSnapshotTrigger
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function snapshotsRoot(vaultRoot: string): string {
  return path.join(vaultRoot, MARVIN_DIR, SNAPSHOTS_DIR)
}

function turnDir(vaultRoot: string, turnId: string): string {
  return path.join(snapshotsRoot(vaultRoot), turnId)
}

function manifestPath(vaultRoot: string, turnId: string): string {
  return path.join(turnDir(vaultRoot, turnId), MANIFEST_NAME)
}

// C1: path traversal prevention using resolved-path boundary check
function snapshotFilePath(vaultRoot: string, turnId: string, relPath: string): string {
  const root = path.resolve(turnDir(vaultRoot, turnId))
  const abs = path.resolve(root, relPath)
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new Error('MARVIN_INVALID_PATH')
  }
  return abs
}

function sha256(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex')
}

// H3: manifest schema validation — treat corrupted/missing fields as null
function validateManifest(obj: unknown): SnapshotManifest | null {
  if (!obj || typeof obj !== 'object') return null
  const m = obj as Record<string, unknown>
  if (
    typeof m.turnId !== 'string' ||
    typeof m.createdAt !== 'string' ||
    typeof m.timestamp !== 'number' ||
    !Array.isArray(m.files) ||
    (m.trigger !== 'file:write' &&
      m.trigger !== 'watcher' &&
      m.trigger !== 'restore' &&
      m.trigger !== 'cascade' &&
      m.trigger !== 'buffer-save' &&
      m.trigger !== 'external-rejected') ||
    (m.status !== 'active' && m.status !== 'completed')
  ) {
    return null
  }
  return m as unknown as SnapshotManifest
}

async function readManifest(vaultRoot: string, turnId: string): Promise<SnapshotManifest | null> {
  const p = manifestPath(vaultRoot, turnId)
  try {
    const raw = await fs.readFile(p, 'utf8')
    return validateManifest(JSON.parse(raw))
  } catch {
    return null
  }
}

async function writeManifest(vaultRoot: string, manifest: SnapshotManifest): Promise<void> {
  const p = manifestPath(vaultRoot, manifest.turnId)
  await fs.mkdir(path.dirname(p), { recursive: true })
  await fs.writeFile(p, JSON.stringify(manifest, null, 2), 'utf8')
}

async function dirSizeBytes(dir: string): Promise<number> {
  let total = 0
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return 0
  }
  await Promise.all(
    entries.map(async (entry) => {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        total += await dirSizeBytes(full)
      } else {
        try {
          const stat = await fs.stat(full)
          total += stat.size
        } catch {
          // file may have been removed concurrently
        }
      }
    })
  )
  return total
}

// Binary detection: sniff first 8 KB for null bytes (AC9)
const BINARY_PROBE_BYTES = 8192
const TEXT_SIZE_WARN_BYTES = 10 * 1024 * 1024 // 10 MB

function isBinaryContent(content: string): boolean {
  const probe = content.slice(0, BINARY_PROBE_BYTES)
  return probe.includes('\x00')
}

// ---------------------------------------------------------------------------
// User-bucket internal helpers (_user, no turnId required)
// ---------------------------------------------------------------------------

function userBucketDir(vaultRoot: string): string {
  return path.join(snapshotsRoot(vaultRoot), USER_BUCKET_ID)
}

function userManifestPath(vaultRoot: string): string {
  return path.join(userBucketDir(vaultRoot), MANIFEST_NAME)
}

// C1: same boundary check as snapshotFilePath, scoped to the user bucket
function userSnapshotFilePath(vaultRoot: string, snapshotId: string, relPath: string): string {
  const root = path.resolve(userBucketDir(vaultRoot), snapshotId)
  const abs = path.resolve(root, relPath)
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new Error('MARVIN_INVALID_PATH')
  }
  return abs
}

async function readUserManifest(vaultRoot: string): Promise<UserManifest> {
  try {
    const raw = await fs.readFile(userManifestPath(vaultRoot), 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as UserManifest).entries)) {
      return parsed as UserManifest
    }
  } catch {
    // file missing or corrupt — return empty manifest
  }
  return { entries: [] }
}

async function writeUserManifest(vaultRoot: string, manifest: UserManifest): Promise<void> {
  const p = userManifestPath(vaultRoot)
  await fs.mkdir(path.dirname(p), { recursive: true })
  await fs.writeFile(p, JSON.stringify(manifest, null, 2), 'utf8')
}

// Prune _user bucket to at most USER_FIFO_CAP entries (oldest first).
// Also removes orphaned snapshot directories for pruned entries.
async function pruneUserBucket(vaultRoot: string, manifest: UserManifest): Promise<UserManifest> {
  if (manifest.entries.length <= USER_FIFO_CAP) return manifest
  const toRemove = manifest.entries.slice(0, manifest.entries.length - USER_FIFO_CAP)
  const kept = manifest.entries.slice(manifest.entries.length - USER_FIFO_CAP)
  // Best-effort cleanup of pruned snapshot directories
  await Promise.all(
    toRemove.map(async (entry) => {
      const dir = path.join(userBucketDir(vaultRoot), entry.snapshotId)
      try {
        await fs.rm(dir, { recursive: true, force: true })
      } catch {
        // ignore — not critical if cleanup fails
      }
    })
  )
  return { entries: kept }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Record a snapshot of `contentBefore` for the given file within a turn.
 * If the turn manifest already exists, the new file entry is appended.
 * Skips binary files (AC9). Best-effort: never throws — returns false on failure.
 */
export async function writeSnapshot(
  vaultRoot: string,
  turnId: string,
  relPath: string,
  contentBefore: string,
  trigger: SnapshotTrigger,
  agentId?: string
): Promise<boolean> {
  try {
    assertTurnId(turnId) // H4
    assertRelPath(relPath) // H4

    if (isBinaryContent(contentBefore)) {
      return false
    }

    const byteSize = Buffer.byteLength(contentBefore, 'utf8')
    if (byteSize > TEXT_SIZE_WARN_BYTES) {
      console.warn('[snapshot] large text file snapshotted', { relPath, byteSize })
    }

    const destPath = snapshotFilePath(vaultRoot, turnId, relPath)
    await fs.mkdir(path.dirname(destPath), { recursive: true })
    await fs.writeFile(destPath, contentBefore, 'utf8')

    const existing = await readManifest(vaultRoot, turnId)
    const newEntry: ManifestEntry = {
      relPath,
      sizeBefore: byteSize,
      hashBefore: sha256(contentBefore),
    }

    const now = Date.now()
    const manifest: SnapshotManifest = existing
      ? { ...existing, files: [...existing.files, newEntry] }
      : {
          turnId,
          files: [newEntry],
          createdAt: new Date(now).toISOString(),
          timestamp: now,
          trigger,
          status: 'active',
          ...(agentId ? { agentId } : {}),
        }

    await writeManifest(vaultRoot, manifest)
    return true
  } catch (err) {
    console.error('[snapshot] writeSnapshot failed', { turnId, relPath, err })
    return false
  }
}

/**
 * Mark a turn's manifest as completed. Called when the turn-end timer fires.
 * Best-effort — does not throw.
 */
export async function completeTurn(vaultRoot: string, turnId: string): Promise<void> {
  try {
    assertTurnId(turnId) // C2 — turnId comes from internal state but validate defensively
    const existing = await readManifest(vaultRoot, turnId)
    if (!existing || existing.status === 'completed') return
    await writeManifest(vaultRoot, { ...existing, status: 'completed' })
  } catch (err) {
    console.error('[snapshot] completeTurn failed', { turnId, err })
  }
}

/**
 * List all turn manifests, sorted newest-first.
 * The _user bucket directory is excluded — it is not a turn.
 */
export async function listTurns(vaultRoot: string): Promise<SnapshotManifest[]> {
  const root = snapshotsRoot(vaultRoot)
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fs.readdir(root, { withFileTypes: true })
  } catch {
    return []
  }

  const manifests = await Promise.all(
    entries
      .filter((e) => e.isDirectory() && e.name !== MANIFEST_NAME && e.name !== USER_BUCKET_ID)
      .map((e) => readManifest(vaultRoot, e.name))
  )

  return manifests
    .filter((m): m is SnapshotManifest => m !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/**
 * List all turns that contain a snapshot for `relPath`, newest-first.
 */
export async function listForFile(vaultRoot: string, relPath: string): Promise<SnapshotManifest[]> {
  assertRelPath(relPath) // H4
  const all = await listTurns(vaultRoot)
  return all.filter((m) => m.files.some((f) => f.relPath === relPath))
}

/**
 * Read the snapshotted content for a specific file within a turn.
 */
export async function readSnapshot(
  vaultRoot: string,
  turnId: string,
  relPath: string
): Promise<string> {
  assertTurnId(turnId) // C2, H4
  assertRelPath(relPath) // H4
  const p = snapshotFilePath(vaultRoot, turnId, relPath) // C1
  return fs.readFile(p, 'utf8')
}

/**
 * Restore a file from a snapshot.
 * Before overwriting, snapshots the current content so the action is undoable.
 * Returns the new turn-id created for the pre-restore snapshot.
 */
export async function restoreSnapshot(
  vaultRoot: string,
  turnId: string,
  relPath: string
): Promise<string> {
  assertTurnId(turnId) // C2, H4
  assertRelPath(relPath) // H4

  // C1 + H2: resolve destination and verify it stays inside the vault.
  // Use realpath on both the parent dir and the file itself (if it exists)
  // so a symlink like notes/leak → ~/.ssh/id_rsa is caught before any write.
  const vaultResolved = path.resolve(vaultRoot)
  const destPath = path.resolve(vaultResolved, relPath)
  if (!destPath.startsWith(vaultResolved + path.sep) && destPath !== vaultResolved) {
    throw new Error('MARVIN_INVALID_PATH')
  }

  const parentDir = path.dirname(destPath)

  // H2: realpath on parent dir to catch symlinked directories
  try {
    const realParent = await fs.realpath(parentDir)
    if (!realParent.startsWith(vaultResolved + path.sep) && realParent !== vaultResolved) {
      throw new Error('MARVIN_INVALID_PATH')
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    // Parent doesn't exist yet — will be created safely since destPath passed boundary check
  }

  // H2: realpath on the destination file itself if it exists — catches file-level symlinks
  // (e.g. notes/leak.md → ~/.ssh/id_rsa created by the AI via PTY)
  try {
    const realDest = await fs.realpath(destPath)
    if (!realDest.startsWith(vaultResolved + path.sep) && realDest !== vaultResolved) {
      throw new Error('MARVIN_INVALID_PATH')
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    // File doesn't exist yet — first restore, no symlink to check
  }

  // Snapshot current state before restoring (allows "undo restore")
  const preTurnId = newTurnId()
  if (existsSync(destPath)) {
    const currentContent = await fs.readFile(destPath, 'utf8')
    await writeSnapshot(vaultRoot, preTurnId, relPath, currentContent, 'restore')
  }

  const snapshotContent = await readSnapshot(vaultRoot, turnId, relPath)
  await fs.mkdir(parentDir, { recursive: true })
  await fs.writeFile(destPath, snapshotContent, 'utf8')

  return preTurnId
}

/**
 * Garbage-collect old snapshots according to policy.
 * Expired turns are moved to the OS trash (recoverable).
 */
export async function gc(vaultRoot: string, policy: GCPolicy = DEFAULT_GC_POLICY): Promise<void> {
  const turns = await listTurns(vaultRoot)
  if (turns.length === 0) return

  const now = Date.now()
  const maxAgeMs = policy.maxAgeDays * 24 * 60 * 60 * 1000
  const root = snapshotsRoot(vaultRoot)

  // Turns are sorted newest-first; keep the first maxTurns, expire the rest
  const toExpireByCount = turns.slice(policy.maxTurns)

  // Also expire turns older than maxAgeDays
  const toExpireByAge = turns
    .slice(0, policy.maxTurns)
    .filter((m) => now - new Date(m.createdAt).getTime() > maxAgeMs)

  const expiredIds = new Set([
    ...toExpireByCount.map((m) => m.turnId),
    ...toExpireByAge.map((m) => m.turnId),
  ])

  // If still over size cap, expire oldest remaining turns until under cap
  const remaining = turns.filter((m) => !expiredIds.has(m.turnId))
  let totalBytes = await dirSizeBytes(root)
  for (const m of [...remaining].reverse()) {
    if (totalBytes <= policy.maxBytes) break
    const dir = turnDir(vaultRoot, m.turnId)
    try {
      const size = await dirSizeBytes(dir)
      totalBytes -= size
    } catch {
      // ignore
    }
    expiredIds.add(m.turnId)
  }

  const safeSnapshotsRoot = path.resolve(snapshotsRoot(vaultRoot))
  await Promise.all(
    [...expiredIds].map(async (id) => {
      const dir = path.resolve(turnDir(vaultRoot, id))
      // H1: defense-in-depth — never trash anything outside the snapshots root
      if (!dir.startsWith(safeSnapshotsRoot + path.sep)) {
        console.error('[snapshot] gc refusing to trash path outside snapshots root', { id, dir })
        return
      }
      try {
        await shell.trashItem(dir)
      } catch (err) {
        console.error('[snapshot] gc trashItem failed', { id, err })
      }
    })
  )
}

/**
 * Generate a new turn ID in PRD format: `<ISO-8601>Z-<12-char-hex-salt>`.
 * Format is timestamp-prefixed so IDs are naturally sortable.
 */
export function newTurnId(): string {
  const ts = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z')
  const salt = crypto.randomBytes(6).toString('hex')
  return `${ts}-${salt}`
}

const GITIGNORE_ENTRY = '.marvin/'

/**
 * Ensure `.marvin/` is listed in the vault's `.gitignore` (if one exists).
 * Idempotent — never adds a duplicate entry. Silently no-ops if no .gitignore.
 * Call this once when a vault is opened.
 */
export async function ensureVaultGitignore(vaultRoot: string): Promise<void> {
  const gitignorePath = path.join(vaultRoot, '.gitignore')
  let existing: string
  try {
    existing = await fs.readFile(gitignorePath, 'utf8')
  } catch {
    // No .gitignore in vault root — nothing to do
    return
  }

  // Check for an exact-line match to avoid duplicates
  const lines = existing.split('\n')
  if (lines.some((l) => l.trim() === GITIGNORE_ENTRY)) return

  const updated = existing.endsWith('\n')
    ? `${existing}${GITIGNORE_ENTRY}\n`
    : `${existing}\n${GITIGNORE_ENTRY}\n`

  await fs.writeFile(gitignorePath, updated, 'utf8')
}

// ---------------------------------------------------------------------------
// User-bucket public API (U2: capture without AI turn)
// ---------------------------------------------------------------------------

/**
 * Capture the current on-disk content of each path into the `_user` snapshot
 * bucket, independent of any AI turn. All paths are grouped under one snapshotId.
 *
 * Security: each source path is validated with assertInsideVaultAsync (lstat-first
 * symlink check + realpath boundary — C3/H2). The returned safeAbs is used for
 * fs.readFile so there is no TOCTOU window between check and read.
 *
 * Unlike writeSnapshot this is NOT best-effort: it throws on any failure so
 * callers (e.g. U3 trash handler) know whether a recoverable copy exists before
 * proceeding with a destructive operation.
 *
 * @returns snapshotId (uuid v4) identifying this capture bundle.
 */
export async function captureUserSnapshot(
  vaultRoot: string,
  paths: string[],
  trigger: UserSnapshotTrigger
): Promise<string> {
  if (!Array.isArray(paths) || paths.length === 0) throw new Error('MARVIN_INVALID_PATH')
  assertUserTrigger(trigger)

  // H4: string-level validation before any async I/O
  paths.forEach(assertRelPath)

  const vaultResolved = path.resolve(vaultRoot)
  const snapshotId = crypto.randomUUID()

  // Per-path: assertInsideVaultAsync (lstat + realpath) eliminates TOCTOU and
  // symlink-escape on the SOURCE. safeAbs is the canonical path fed to fs.readFile.
  const validatedPaths: string[] = []
  await Promise.all(
    paths.map(async (p) => {
      const absCandidate = path.resolve(vaultResolved, p)
      const safeAbs = await assertInsideVaultAsync(vaultRoot, absCandidate)
      const relPath = path.relative(vaultResolved, safeAbs)
      validatedPaths.push(relPath)

      const content = await fs.readFile(safeAbs, 'utf8')

      const byteSize = Buffer.byteLength(content, 'utf8')
      if (byteSize > TEXT_SIZE_WARN_BYTES) {
        console.warn('[snapshot] captureUserSnapshot: large text file captured', {
          relPath,
          byteSize,
        })
      }

      const destPath = userSnapshotFilePath(vaultRoot, snapshotId, relPath) // C1
      await fs.mkdir(path.dirname(destPath), { recursive: true })
      await fs.writeFile(destPath, content, 'utf8')
    })
  )

  const now = Date.now()
  const newEntry: UserManifestEntry = {
    snapshotId,
    paths: validatedPaths,
    trigger,
    createdAt: new Date(now).toISOString(),
    timestamp: now,
  }

  const existing = await readUserManifest(vaultRoot)
  const updated = await pruneUserBucket(vaultRoot, {
    entries: [...existing.entries, newEntry],
  })
  await writeUserManifest(vaultRoot, updated)

  return snapshotId
}

/**
 * Restore a single snapshot bundle captured by `captureUserSnapshot`.
 * Looks up the entry by `snapshotId` in the `_user` manifest, then writes each
 * snapshotted file back to its original path inside the vault.
 *
 * Applies the same H2 symlink-escape checks as `restoreSnapshot` to every
 * destination path. Throws on: unknown snapshotId, path validation failures,
 * or any fs error.
 *
 * Returns the vault-relative paths that were restored so callers can invalidate
 * their file-content caches.
 */
export async function restoreUserSnapshot(
  vaultRoot: string,
  snapshotId: string
): Promise<string[]> {
  const manifest = await readUserManifest(vaultRoot)
  const entry = manifest.entries.find((e) => e.snapshotId === snapshotId)
  if (!entry) throw new Error('MARVIN_UNKNOWN_SNAPSHOT')

  const vaultResolved = path.resolve(vaultRoot)

  // Restore each path in the bundle, applying H2/C1 checks to every destination
  await Promise.all(
    entry.paths.map(async (relPath) => {
      assertRelPath(relPath) // H4: re-validate paths stored in manifest

      // C1 + H2: resolve destination and verify it stays inside the vault
      const destPath = path.resolve(vaultResolved, relPath)
      if (!destPath.startsWith(vaultResolved + path.sep) && destPath !== vaultResolved) {
        throw new Error('MARVIN_INVALID_PATH')
      }

      const parentDir = path.dirname(destPath)

      // H2: realpath on parent dir to catch symlinked directories
      try {
        const realParent = await fs.realpath(parentDir)
        if (!realParent.startsWith(vaultResolved + path.sep) && realParent !== vaultResolved) {
          throw new Error('MARVIN_INVALID_PATH')
        }
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
      }

      // H2: realpath on the destination file itself if it exists — catches file-level symlinks
      try {
        const realDest = await fs.realpath(destPath)
        if (!realDest.startsWith(vaultResolved + path.sep) && realDest !== vaultResolved) {
          throw new Error('MARVIN_INVALID_PATH')
        }
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
      }

      const srcPath = userSnapshotFilePath(vaultRoot, snapshotId, relPath) // C1
      const content = await fs.readFile(srcPath, 'utf8')
      await fs.mkdir(parentDir, { recursive: true })
      await fs.writeFile(destPath, content, 'utf8')
    })
  )

  return entry.paths
}
