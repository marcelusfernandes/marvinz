import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

// Mock electron before importing snapshot.ts — shell.trashItem is Electron-only
vi.mock('electron', () => ({
  shell: {
    trashItem: vi.fn().mockResolvedValue(undefined),
  },
}))

import {
  writeSnapshot,
  listTurns,
  listForFile,
  readSnapshot,
  restoreSnapshot,
  gc,
  newTurnId,
  ensureVaultGitignore,
  completeTurn,
} from '../snapshot.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string

async function setup(): Promise<string> {
  // Resolve realpath to handle macOS /var -> /private/var symlink (affects restoreSnapshot H2 check)
  const raw = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-snapshot-test-'))
  tmpDir = await fs.realpath(raw)
  return tmpDir
}

async function teardown() {
  await fs.rm(tmpDir, { recursive: true, force: true })
}

async function writeFile(vaultRoot: string, relPath: string, content: string): Promise<void> {
  const abs = path.join(vaultRoot, relPath)
  await fs.mkdir(path.dirname(abs), { recursive: true })
  await fs.writeFile(abs, content, 'utf8')
}

async function readFile(vaultRoot: string, relPath: string): Promise<string> {
  return fs.readFile(path.join(vaultRoot, relPath), 'utf8')
}

function snapshotDir(vaultRoot: string, turnId: string): string {
  return path.join(vaultRoot, '.marvin', 'snapshots', turnId)
}

async function snapshotExists(
  vaultRoot: string,
  turnId: string,
  relPath: string
): Promise<boolean> {
  try {
    await fs.access(path.join(snapshotDir(vaultRoot, turnId), relPath))
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('writeSnapshot', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('creates snapshot file and manifest for existing file', async () => {
    const turnId = newTurnId()
    const relPath = 'notes/daily.md'
    const contentBefore = '# Day 1\nOriginal content'

    const ok = await writeSnapshot(tmpDir, turnId, relPath, contentBefore, 'file:write')

    expect(ok).toBe(true)
    expect(await snapshotExists(tmpDir, turnId, relPath)).toBe(true)

    const savedContent = await readSnapshot(tmpDir, turnId, relPath)
    expect(savedContent).toBe(contentBefore)

    const [manifest] = await listTurns(tmpDir)
    expect(manifest.turnId).toBe(turnId)
    expect(manifest.trigger).toBe('file:write')
    expect(manifest.files).toHaveLength(1)
    expect(manifest.files[0].relPath).toBe(relPath)
  })

  it('appends to existing manifest when same turn writes multiple files', async () => {
    const turnId = newTurnId()

    await writeSnapshot(tmpDir, turnId, 'a.md', 'content a', 'file:write')
    await writeSnapshot(tmpDir, turnId, 'b.md', 'content b', 'file:write')

    const [manifest] = await listTurns(tmpDir)
    expect(manifest.files).toHaveLength(2)
    expect(manifest.files.map((f) => f.relPath)).toContain('a.md')
    expect(manifest.files.map((f) => f.relPath)).toContain('b.md')
  })

  it('stores correct hash and size in manifest entry', async () => {
    const turnId = newTurnId()
    const content = 'Hello World'
    await writeSnapshot(tmpDir, turnId, 'test.md', content, 'file:write')

    const [manifest] = await listTurns(tmpDir)
    const entry = manifest.files[0]
    expect(entry.sizeBefore).toBe(Buffer.byteLength(content, 'utf8'))
    expect(entry.hashBefore).toMatch(/^[0-9a-f]{64}$/)
  })

  it('returns false and does not throw on invalid relPath (path traversal attempt)', async () => {
    const turnId = newTurnId()
    // snapshotFilePath throws on '..'-prefixed relPath; writeSnapshot catches and returns false
    const ok = await writeSnapshot(tmpDir, turnId, '../../etc/passwd', 'bad', 'file:write')
    expect(ok).toBe(false)
  })

  it('creates nested directories for relPath with subdirectory', async () => {
    const turnId = newTurnId()
    const ok = await writeSnapshot(tmpDir, turnId, 'deep/nested/file.md', 'content', 'watcher')
    expect(ok).toBe(true)
    expect(await snapshotExists(tmpDir, turnId, 'deep/nested/file.md')).toBe(true)
  })
})

describe('listTurns', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('returns empty array when .marvin/snapshots does not exist', async () => {
    const turns = await listTurns(tmpDir)
    expect(turns).toEqual([])
  })

  it('returns turns sorted newest-first', async () => {
    const id1 = newTurnId()
    const id2 = newTurnId()

    await writeSnapshot(tmpDir, id1, 'a.md', 'old', 'file:write')
    // Ensure id2 has a later timestamp by manipulating the manifest
    await new Promise((r) => setTimeout(r, 5))
    await writeSnapshot(tmpDir, id2, 'b.md', 'new', 'file:write')

    const turns = await listTurns(tmpDir)
    expect(turns).toHaveLength(2)
    expect(turns[0].turnId).toBe(id2)
    expect(turns[1].turnId).toBe(id1)
  })

  it('skips directories with missing or corrupt manifests', async () => {
    const goodId = newTurnId()
    await writeSnapshot(tmpDir, goodId, 'a.md', 'content', 'file:write')

    // Create a corrupt turn directory
    const corruptDir = path.join(tmpDir, '.marvin', 'snapshots', 'corrupt-turn')
    await fs.mkdir(corruptDir, { recursive: true })
    await fs.writeFile(path.join(corruptDir, '_manifest.json'), 'not-json', 'utf8')

    const turns = await listTurns(tmpDir)
    expect(turns).toHaveLength(1)
    expect(turns[0].turnId).toBe(goodId)
  })
})

describe('listForFile', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('returns only turns that contain the specified relPath', async () => {
    const t1 = newTurnId()
    const t2 = newTurnId()
    const t3 = newTurnId()

    await writeSnapshot(tmpDir, t1, 'notes/foo.md', 'v1 foo', 'file:write')
    await writeSnapshot(tmpDir, t2, 'notes/bar.md', 'v1 bar', 'file:write')
    await writeSnapshot(tmpDir, t3, 'notes/foo.md', 'v2 foo', 'file:write')

    const fooTurns = await listForFile(tmpDir, 'notes/foo.md')
    expect(fooTurns).toHaveLength(2)
    expect(fooTurns.every((m) => m.files.some((f) => f.relPath === 'notes/foo.md'))).toBe(true)
  })

  it('returns empty array when file has no snapshots', async () => {
    const turns = await listForFile(tmpDir, 'nonexistent.md')
    expect(turns).toEqual([])
  })
})

describe('readSnapshot', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('returns exact content that was snapshotted', async () => {
    const turnId = newTurnId()
    const content = '# My Note\n\nSome content with unicode: 🎯'
    await writeSnapshot(tmpDir, turnId, 'note.md', content, 'file:write')

    const result = await readSnapshot(tmpDir, turnId, 'note.md')
    expect(result).toBe(content)
  })

  it('throws when snapshot does not exist', async () => {
    // Use a validly-formatted turnId that simply has no snapshot on disk
    const missingTurnId = newTurnId()
    await expect(readSnapshot(tmpDir, missingTurnId, 'file.md')).rejects.toThrow()
  })

  it('rejects path traversal in relPath', async () => {
    const turnId = newTurnId()
    await expect(readSnapshot(tmpDir, turnId, '../../etc/passwd')).rejects.toThrow(
      'MARVIN_INVALID_PATH'
    )
  })

  it('rejects path traversal in normalized relPath', async () => {
    const turnId = newTurnId()
    await writeSnapshot(tmpDir, turnId, 'safe.md', 'content', 'file:write')
    await expect(readSnapshot(tmpDir, turnId, '../../../etc/passwd')).rejects.toThrow(
      'MARVIN_INVALID_PATH'
    )
  })
})

describe('restoreSnapshot', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('restores file content from snapshot', async () => {
    const originalContent = '# Original\nThis is the original.'
    const modifiedContent = '# Modified\nThis was changed by AI.'

    await writeFile(tmpDir, 'note.md', originalContent)
    const turnId = newTurnId()
    await writeSnapshot(tmpDir, turnId, 'note.md', originalContent, 'file:write')

    // Simulate AI modifying the file
    await writeFile(tmpDir, 'note.md', modifiedContent)
    expect(await readFile(tmpDir, 'note.md')).toBe(modifiedContent)

    await restoreSnapshot(tmpDir, turnId, 'note.md')

    expect(await readFile(tmpDir, 'note.md')).toBe(originalContent)
  })

  it('creates a pre-restore snapshot of current content (undo-redo)', async () => {
    const v1 = 'Version 1'
    const v2 = 'Version 2'

    await writeFile(tmpDir, 'note.md', v1)
    const turn1 = newTurnId()
    await writeSnapshot(tmpDir, turn1, 'note.md', v1, 'file:write')

    await writeFile(tmpDir, 'note.md', v2)

    const preTurnId = await restoreSnapshot(tmpDir, turn1, 'note.md')

    // File is now back to v1
    expect(await readFile(tmpDir, 'note.md')).toBe(v1)

    // A new snapshot of v2 was created before the restore
    const preRestoreContent = await readSnapshot(tmpDir, preTurnId, 'note.md')
    expect(preRestoreContent).toBe(v2)
  })

  it('pre-restore snapshot has trigger "restore"', async () => {
    const content = 'some content'
    await writeFile(tmpDir, 'note.md', content)
    const turnId = newTurnId()
    await writeSnapshot(tmpDir, turnId, 'note.md', content, 'file:write')

    const preTurnId = await restoreSnapshot(tmpDir, turnId, 'note.md')

    const allTurns = await listTurns(tmpDir)
    const preTurn = allTurns.find((m) => m.turnId === preTurnId)
    expect(preTurn?.trigger).toBe('restore')
  })

  it('skips pre-restore snapshot when file does not exist on disk', async () => {
    // Restore a snapshot where the target file no longer exists
    const turnId = newTurnId()
    const content = 'Recovered content'
    await writeSnapshot(tmpDir, turnId, 'deleted.md', content, 'file:write')

    const preTurnId = await restoreSnapshot(tmpDir, turnId, 'deleted.md')

    // File should now exist with snapshot content
    expect(await readFile(tmpDir, 'deleted.md')).toBe(content)

    // No pre-restore snapshot should be created for the pre-turn because file didn't exist
    const preTurnSnapshots = await listForFile(tmpDir, 'deleted.md')
    const preTurn = preTurnSnapshots.find((m) => m.turnId === preTurnId)
    // preTurnId turn should not contain 'deleted.md' since file didn't exist
    expect(preTurn).toBeUndefined()
  })

  it('throws when snapshot to restore does not exist', async () => {
    const missingTurnId = newTurnId()
    await expect(restoreSnapshot(tmpDir, missingTurnId, 'note.md')).rejects.toThrow()
  })
})

describe('gc', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('removes turns exceeding maxTurns (oldest first)', async () => {
    const { shell } = await import('electron')
    const trashSpy = vi.mocked(shell.trashItem)
    trashSpy.mockClear()

    // Create 5 turns
    const ids: string[] = []
    for (let i = 0; i < 5; i++) {
      await new Promise((r) => setTimeout(r, 2))
      const id = newTurnId()
      ids.push(id)
      await writeSnapshot(tmpDir, id, `file${i}.md`, `content ${i}`, 'file:write')
    }

    await gc(tmpDir, { maxTurns: 3, maxAgeDays: 7, maxBytes: 200 * 1024 * 1024 })

    expect(trashSpy).toHaveBeenCalledTimes(2)
    // The 2 oldest should have been trashed
    const trashedPaths = trashSpy.mock.calls.map((c) => c[0] as string)
    expect(trashedPaths.some((p) => p.includes(ids[0]))).toBe(true)
    expect(trashedPaths.some((p) => p.includes(ids[1]))).toBe(true)
  })

  it('removes turns older than maxAgeDays', async () => {
    const { shell } = await import('electron')
    const trashSpy = vi.mocked(shell.trashItem)
    trashSpy.mockClear()

    const oldTurnId = newTurnId()
    await writeSnapshot(tmpDir, oldTurnId, 'old.md', 'old content', 'file:write')

    // Manually backdate the manifest to 8 days ago
    const manifestFile = path.join(tmpDir, '.marvin', 'snapshots', oldTurnId, '_manifest.json')
    const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'))
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)
    manifest.createdAt = eightDaysAgo.toISOString()
    await fs.writeFile(manifestFile, JSON.stringify(manifest, null, 2), 'utf8')

    const recentTurnId = newTurnId()
    await writeSnapshot(tmpDir, recentTurnId, 'recent.md', 'recent content', 'file:write')

    await gc(tmpDir, { maxTurns: 50, maxAgeDays: 7, maxBytes: 200 * 1024 * 1024 })

    expect(trashSpy).toHaveBeenCalledTimes(1)
    const trashedPath = trashSpy.mock.calls[0][0] as string
    expect(trashedPath).toContain(oldTurnId)
  })

  it('removes turns when total size exceeds maxBytes', async () => {
    const { shell } = await import('electron')
    const trashSpy = vi.mocked(shell.trashItem)
    trashSpy.mockClear()

    // Create 3 turns with known content
    const ids: string[] = []
    for (let i = 0; i < 3; i++) {
      await new Promise((r) => setTimeout(r, 2))
      const id = newTurnId()
      ids.push(id)
      // 100 bytes each
      await writeSnapshot(tmpDir, id, `f${i}.md`, 'x'.repeat(100), 'file:write')
    }

    // maxBytes = 150 → should evict 1 (oldest)
    await gc(tmpDir, { maxTurns: 50, maxAgeDays: 7, maxBytes: 150 })

    // At least one trashItem call for the oldest turn
    expect(trashSpy.mock.calls.length).toBeGreaterThanOrEqual(1)
    const trashedPaths = trashSpy.mock.calls.map((c) => c[0] as string)
    expect(trashedPaths.some((p) => p.includes(ids[0]))).toBe(true)
  })

  it('does nothing when no turns exist', async () => {
    const { shell } = await import('electron')
    const trashSpy = vi.mocked(shell.trashItem)
    trashSpy.mockClear()

    await gc(tmpDir, { maxTurns: 50, maxAgeDays: 7, maxBytes: 200 * 1024 * 1024 })

    expect(trashSpy).not.toHaveBeenCalled()
  })

  it('does not trash turns within retention limits', async () => {
    const { shell } = await import('electron')
    const trashSpy = vi.mocked(shell.trashItem)
    trashSpy.mockClear()

    for (let i = 0; i < 3; i++) {
      await writeSnapshot(tmpDir, newTurnId(), `f${i}.md`, 'content', 'file:write')
    }

    await gc(tmpDir, { maxTurns: 50, maxAgeDays: 7, maxBytes: 200 * 1024 * 1024 })

    expect(trashSpy).not.toHaveBeenCalled()
  })
})

describe('path traversal security', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('writeSnapshot rejects relPath with leading ".."', async () => {
    const ok = await writeSnapshot(tmpDir, newTurnId(), '../outside/file.md', 'bad', 'file:write')
    expect(ok).toBe(false)
  })

  it('writeSnapshot rejects relPath with embedded traversal', async () => {
    const ok = await writeSnapshot(tmpDir, newTurnId(), 'a/../../outside.md', 'bad', 'file:write')
    expect(ok).toBe(false)
  })

  it('readSnapshot throws on traversal relPath', async () => {
    await expect(readSnapshot(tmpDir, newTurnId(), '../../etc/passwd')).rejects.toThrow(
      'MARVIN_INVALID_PATH'
    )
  })

  it('restoreSnapshot throws when snapshot relPath contains traversal', async () => {
    // relPath traversal is caught by snapshotFilePath inside readSnapshot
    const turnId = newTurnId()
    await expect(restoreSnapshot(tmpDir, turnId, '../../secret')).rejects.toThrow()
  })
})

describe('edge cases', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('snapshot of new file (writeSnapshot) still succeeds — caller decides whether to invoke', async () => {
    // The snapshot module itself does not check if the source file exists.
    // The caller (main.ts file:write hook) is responsible for not calling writeSnapshot
    // when the file did not exist before. We verify the module works correctly when called.
    const turnId = newTurnId()
    const ok = await writeSnapshot(tmpDir, turnId, 'brand-new.md', 'initial content', 'file:write')
    expect(ok).toBe(true)
  })

  it('writeSnapshot is best-effort: returns false on I/O failure without throwing', async () => {
    // Point vaultRoot at a non-writable path
    const ok = await writeSnapshot(
      '/nonexistent/vault',
      newTurnId(),
      'file.md',
      'content',
      'file:write'
    )
    expect(ok).toBe(false)
  })

  it('newTurnId generates unique UUIDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => newTurnId()))
    expect(ids.size).toBe(100)
  })

  it('writeSnapshot stores agentId in manifest when provided', async () => {
    const turnId = newTurnId()
    await writeSnapshot(tmpDir, turnId, 'note.md', 'content', 'file:write', 'claude-3-opus')

    const [manifest] = await listTurns(tmpDir)
    expect(manifest.agentId).toBe('claude-3-opus')
  })

  it('watcher trigger is stored correctly in manifest', async () => {
    const turnId = newTurnId()
    await writeSnapshot(tmpDir, turnId, 'watched.md', 'content', 'watcher')

    const [manifest] = await listTurns(tmpDir)
    expect(manifest.trigger).toBe('watcher')
  })

  it('listTurns returns empty array for vault with empty snapshots dir', async () => {
    await fs.mkdir(path.join(tmpDir, '.marvin', 'snapshots'), { recursive: true })
    const turns = await listTurns(tmpDir)
    expect(turns).toEqual([])
  })
})

describe('ensureVaultGitignore', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('adds .marvin/ to .gitignore when entry is missing', async () => {
    const gitignorePath = path.join(tmpDir, '.gitignore')
    await fs.writeFile(gitignorePath, 'node_modules\ndist\n', 'utf8')

    await ensureVaultGitignore(tmpDir)

    const updated = await fs.readFile(gitignorePath, 'utf8')
    expect(updated).toContain('.marvin/')
  })

  it('does not duplicate entry when .marvin/ already present', async () => {
    const gitignorePath = path.join(tmpDir, '.gitignore')
    await fs.writeFile(gitignorePath, 'node_modules\n.marvin/\ndist\n', 'utf8')

    await ensureVaultGitignore(tmpDir)

    const updated = await fs.readFile(gitignorePath, 'utf8')
    const occurrences = (updated.match(/\.marvin\//g) ?? []).length
    expect(occurrences).toBe(1)
  })

  it('no-ops silently when no .gitignore exists', async () => {
    await expect(ensureVaultGitignore(tmpDir)).resolves.toBeUndefined()
  })

  it('appends correctly when .gitignore does not end with newline', async () => {
    const gitignorePath = path.join(tmpDir, '.gitignore')
    await fs.writeFile(gitignorePath, 'node_modules', 'utf8')

    await ensureVaultGitignore(tmpDir)

    const updated = await fs.readFile(gitignorePath, 'utf8')
    expect(updated).toContain('\n.marvin/\n')
  })
})

describe('gc error handling', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('continues GC when trashItem fails for one turn', async () => {
    const { shell } = await import('electron')
    const trashSpy = vi.mocked(shell.trashItem)
    trashSpy.mockClear()
    trashSpy.mockRejectedValueOnce(new Error('trash failed'))

    // Create 2 turns, policy retains 0 → both should be trashed
    const id1 = newTurnId()
    await new Promise((r) => setTimeout(r, 2))
    const id2 = newTurnId()
    await writeSnapshot(tmpDir, id1, 'a.md', 'content a', 'file:write')
    await writeSnapshot(tmpDir, id2, 'b.md', 'content b', 'file:write')

    await expect(gc(tmpDir, { maxTurns: 0, maxAgeDays: 0, maxBytes: 0 })).resolves.toBeUndefined()

    // Despite one failure, both were attempted
    expect(trashSpy).toHaveBeenCalledTimes(2)
  })
})

// ===========================================================================
// SECURITY REGRESSION TESTS
// Added after security audit found CRITICAL/HIGH issues.
// These tests verify the hardened validation introduced in the security fix.
// ===========================================================================

describe('security: expanded relPath validation', () => {
  beforeEach(setup)
  afterEach(teardown)

  // C1 — embedded traversal that naive startsWith('..') misses
  it('writeSnapshot rejects relPath with embedded traversal (foo/../../etc/passwd)', async () => {
    const ok = await writeSnapshot(tmpDir, newTurnId(), 'foo/../../etc/passwd', 'bad', 'file:write')
    expect(ok).toBe(false)
    // Must not have written outside vault
    const outsidePath = path.resolve(tmpDir, 'foo/../../etc/passwd')
    await expect(fs.access(outsidePath)).rejects.toThrow()
  })

  // C2 — absolute path bypass
  it('writeSnapshot rejects absolute relPath (/etc/passwd)', async () => {
    const ok = await writeSnapshot(tmpDir, newTurnId(), '/etc/passwd', 'bad', 'file:write')
    expect(ok).toBe(false)
  })

  // C3 — null byte injection
  it('writeSnapshot rejects relPath containing null byte', async () => {
    const ok = await writeSnapshot(tmpDir, newTurnId(), 'foo\0bar.md', 'bad', 'file:write')
    expect(ok).toBe(false)
  })

  it('readSnapshot throws on embedded traversal relPath', async () => {
    await expect(readSnapshot(tmpDir, newTurnId(), 'sub/../../etc/passwd')).rejects.toThrow()
  })

  it('readSnapshot throws on absolute relPath', async () => {
    await expect(readSnapshot(tmpDir, newTurnId(), '/etc/passwd')).rejects.toThrow()
  })

  it('readSnapshot throws on null-byte relPath', async () => {
    await expect(readSnapshot(tmpDir, newTurnId(), 'foo\0bar.md')).rejects.toThrow()
  })

  it('restoreSnapshot throws on embedded traversal relPath', async () => {
    const turnId = newTurnId()
    await writeSnapshot(tmpDir, turnId, 'safe.md', 'content', 'file:write')
    await expect(restoreSnapshot(tmpDir, turnId, 'sub/../../etc/passwd')).rejects.toThrow()
  })

  it('restoreSnapshot throws on absolute relPath', async () => {
    const turnId = newTurnId()
    await writeSnapshot(tmpDir, turnId, 'safe.md', 'content', 'file:write')
    await expect(restoreSnapshot(tmpDir, turnId, '/etc/passwd')).rejects.toThrow()
  })

  it('restoreSnapshot throws on null-byte relPath', async () => {
    const turnId = newTurnId()
    await writeSnapshot(tmpDir, turnId, 'safe.md', 'content', 'file:write')
    await expect(restoreSnapshot(tmpDir, turnId, 'foo\0bar.md')).rejects.toThrow()
  })
})

describe('security: turnId validation', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('readSnapshot throws MARVIN_INVALID_TURN_ID on traversal turnId', async () => {
    // Seed a valid snapshot so only turnId is the problem
    const goodId = newTurnId()
    await writeSnapshot(tmpDir, goodId, 'a.md', 'content', 'file:write')

    await expect(readSnapshot(tmpDir, '../../../tmp/evil', 'a.md')).rejects.toThrow(
      /MARVIN_INVALID_TURN_ID|Invalid turnId|invalid/i
    )
  })

  it('readSnapshot throws on turnId with null byte', async () => {
    await expect(readSnapshot(tmpDir, 'valid\0evil', 'a.md')).rejects.toThrow()
  })

  it('readSnapshot accepts a valid turnId (ISO-compact format)', async () => {
    const turnId = newTurnId() // format: 20250521T193522Z-<hex> — valid
    await writeSnapshot(tmpDir, turnId, 'a.md', 'hello', 'file:write')
    const content = await readSnapshot(tmpDir, turnId, 'a.md')
    expect(content).toBe('hello')
  })

  it('restoreSnapshot throws MARVIN_INVALID_TURN_ID on traversal turnId', async () => {
    await expect(restoreSnapshot(tmpDir, '../../../tmp/evil', 'a.md')).rejects.toThrow(
      /MARVIN_INVALID_TURN_ID|Invalid turnId|invalid/i
    )
  })

  it('gc skips snapshot dirs whose names do not match the expected turnId format', async () => {
    const { shell } = await import('electron')
    const trashSpy = vi.mocked(shell.trashItem)
    trashSpy.mockClear()

    // Create a legitimate turn
    const goodId = newTurnId()
    await writeSnapshot(tmpDir, goodId, 'a.md', 'content', 'file:write')

    // path.join normalizes traversal — use path.resolve directly to create the escaped dir
    const escapedDir = path.resolve(path.join(tmpDir, '.marvin', 'snapshots'), '..', 'escape')
    await fs.mkdir(escapedDir, { recursive: true })

    // GC should only trash the good turn if it's expired — not touch 'escape'
    await gc(tmpDir, { maxTurns: 0, maxAgeDays: 0, maxBytes: 0 })

    // escape/ must NOT have been passed to trashItem
    const trashedPaths = trashSpy.mock.calls.map((c) => c[0] as string)
    const escapeTrashed = trashedPaths.some((p) => p.includes('escape') && !p.includes('snapshots'))
    expect(escapeTrashed).toBe(false)

    // Cleanup
    await fs.rm(escapedDir, { recursive: true, force: true })
  })
})

describe('security: symlink escape', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('restoreSnapshot rejects when target is a symlink escaping the vault', async () => {
    // Create a file outside the vault to be the symlink target
    const outsideFile = path.join(os.tmpdir(), `marvin-outside-${Date.now()}.md`)
    await fs.writeFile(outsideFile, 'outside content', 'utf8')

    // Create symlink inside vault pointing outside
    const symlinkPath = path.join(tmpDir, 'link.md')
    await fs.symlink(outsideFile, symlinkPath)

    // Seed a snapshot for link.md
    const turnId = newTurnId()
    await writeSnapshot(tmpDir, turnId, 'link.md', 'snapshot content', 'file:write')

    try {
      // restoreSnapshot should reject the restore because realpath of link.md escapes vault
      await expect(restoreSnapshot(tmpDir, turnId, 'link.md')).rejects.toThrow(
        /MARVIN_INVALID_PATH|outside vault|symlink|invalid/i
      )

      // outside file must not have been modified
      const outsideContent = await fs.readFile(outsideFile, 'utf8')
      expect(outsideContent).toBe('outside content')
    } finally {
      await fs.rm(outsideFile, { force: true })
    }
  })
})

describe('security: manifest schema validation', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('listTurns treats manifest with invalid files field as corrupted (no throw)', async () => {
    const badTurnId = 'bad-schema-turn'
    const badDir = path.join(tmpDir, '.marvin', 'snapshots', badTurnId)
    await fs.mkdir(badDir, { recursive: true })
    await fs.writeFile(
      path.join(badDir, '_manifest.json'),
      JSON.stringify({
        turnId: badTurnId,
        files: 'not-an-array',
        createdAt: new Date().toISOString(),
      }),
      'utf8'
    )

    // Should not throw — corrupt manifests are skipped
    await expect(listTurns(tmpDir)).resolves.not.toThrow()

    const turns = await listTurns(tmpDir)
    // The corrupt turn should not appear in the list
    const corrupt = turns.find((m) => m.turnId === badTurnId)
    expect(corrupt).toBeUndefined()
  })

  it('listTurns treats manifest missing required fields as corrupted', async () => {
    const badTurnId = 'missing-fields-turn'
    const badDir = path.join(tmpDir, '.marvin', 'snapshots', badTurnId)
    await fs.mkdir(badDir, { recursive: true })
    await fs.writeFile(
      path.join(badDir, '_manifest.json'),
      JSON.stringify({ someRandomField: true }),
      'utf8'
    )

    const turns = await listTurns(tmpDir)
    const corrupt = turns.find((m) => m.turnId === badTurnId)
    expect(corrupt).toBeUndefined()
  })

  it('listTurns treats manifest with non-string createdAt as corrupted', async () => {
    const badTurnId = 'bad-date-turn'
    const badDir = path.join(tmpDir, '.marvin', 'snapshots', badTurnId)
    await fs.mkdir(badDir, { recursive: true })
    await fs.writeFile(
      path.join(badDir, '_manifest.json'),
      JSON.stringify({ turnId: badTurnId, files: [], createdAt: 12345, trigger: 'file:write' }),
      'utf8'
    )

    const turns = await listTurns(tmpDir)
    const corrupt = turns.find((m) => m.turnId === badTurnId)
    expect(corrupt).toBeUndefined()
  })
})

describe('security: additional branch coverage for new validation code', () => {
  beforeEach(setup)
  afterEach(teardown)

  // Line 312: destPath boundary check — absolute relPath that path.resolve produces
  // (different from traversal: covers the branch where resolved abs is not under vault)
  it('restoreSnapshot throws MARVIN_INVALID_PATH on absolute relPath', async () => {
    const turnId = newTurnId()
    await writeSnapshot(tmpDir, turnId, 'safe.md', 'content', 'file:write')
    await expect(restoreSnapshot(tmpDir, turnId, '/etc/hosts')).rejects.toThrow(
      'MARVIN_INVALID_PATH'
    )
  })

  // Lines 321-324: symlink parent dir resolves outside vault (H2 directory check)
  it('restoreSnapshot throws MARVIN_INVALID_PATH when parent dir is a symlink escaping vault', async () => {
    // Create a directory outside the vault
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-outside-dir-'))
    const realOutsideDir = await fs.realpath(outsideDir)

    // Create a symlinked subdir inside the vault pointing to outsideDir
    const symlinkSubdir = path.join(tmpDir, 'evil-dir')
    await fs.symlink(realOutsideDir, symlinkSubdir)

    // Seed a snapshot for a file that would restore into evil-dir/
    const turnId = newTurnId()
    // We manually place the snapshot file without going through writeSnapshot validation
    const snapDir = path.join(tmpDir, '.marvin', 'snapshots', turnId)
    await fs.mkdir(snapDir, { recursive: true })
    await fs.writeFile(path.join(snapDir, 'target.md'), 'snap content', 'utf8')
    const manifest = {
      turnId,
      files: [{ relPath: 'evil-dir/target.md', sizeBefore: 12, hashBefore: 'abc' }],
      createdAt: new Date().toISOString(),
      timestamp: Date.now(),
      trigger: 'file:write',
      status: 'active',
    }
    await fs.writeFile(path.join(snapDir, '_manifest.json'), JSON.stringify(manifest), 'utf8')

    try {
      await expect(restoreSnapshot(tmpDir, turnId, 'evil-dir/target.md')).rejects.toThrow(
        'MARVIN_INVALID_PATH'
      )
      // Outside dir must not have been written to
      const outsideFiles = await fs.readdir(realOutsideDir)
      expect(outsideFiles).toHaveLength(0)
    } finally {
      await fs.rm(outsideDir, { recursive: true, force: true })
    }
  })

  // Lines 400-401: H1 GC guard — refuse to trash path outside snapshots root
  it('gc H1 guard: does not trash a path that resolves outside snapshots root', async () => {
    const { shell } = await import('electron')
    const trashSpy = vi.mocked(shell.trashItem)
    trashSpy.mockClear()

    // Create a legitimate expired turn so GC has work to do
    const expiredId = newTurnId()
    await writeSnapshot(tmpDir, expiredId, 'a.md', 'content', 'file:write')

    // Manually backdate so it expires by age
    const manifestFile = path.join(tmpDir, '.marvin', 'snapshots', expiredId, '_manifest.json')
    const m = JSON.parse(await fs.readFile(manifestFile, 'utf8'))
    m.createdAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString()
    await fs.writeFile(manifestFile, JSON.stringify(m), 'utf8')

    // Tamper: directly add an id to expiredIds that resolves OUTSIDE snapshots root
    // We do this by adding a directory that turnDir would resolve outside (not possible via
    // path.join/resolve since those normalize — so we verify gc's internal guard by checking
    // that only the legitimate turn is passed to trashItem, not any outside path)
    await gc(tmpDir, { maxTurns: 50, maxAgeDays: 7, maxBytes: 200 * 1024 * 1024 })

    // Only the expired turn should be trashed, not any path outside snapshots root
    const trashedPaths = trashSpy.mock.calls.map((c) => c[0] as string)
    const snapshotsRoot = path.resolve(path.join(tmpDir, '.marvin', 'snapshots'))
    const allInsideRoot = trashedPaths.every((p) => p.startsWith(snapshotsRoot + path.sep))
    expect(allInsideRoot).toBe(true)
    expect(trashSpy).toHaveBeenCalledTimes(1)
  })

  // validateManifest: covers null/non-object input branch
  it('listTurns skips manifest directory where JSON is null/primitive', async () => {
    const badId = newTurnId()
    const badDir = path.join(tmpDir, '.marvin', 'snapshots', badId)
    await fs.mkdir(badDir, { recursive: true })
    await fs.writeFile(path.join(badDir, '_manifest.json'), 'null', 'utf8')

    const turns = await listTurns(tmpDir)
    expect(turns.find((m) => m.turnId === badId)).toBeUndefined()
  })

  // validateManifest: invalid trigger value
  it('listTurns skips manifest with unknown trigger value', async () => {
    const badId = newTurnId()
    const badDir = path.join(tmpDir, '.marvin', 'snapshots', badId)
    await fs.mkdir(badDir, { recursive: true })
    await fs.writeFile(
      path.join(badDir, '_manifest.json'),
      JSON.stringify({
        turnId: badId,
        files: [],
        createdAt: new Date().toISOString(),
        timestamp: Date.now(),
        trigger: 'unknown-trigger',
        status: 'active',
      }),
      'utf8'
    )
    const turns = await listTurns(tmpDir)
    expect(turns.find((m) => m.turnId === badId)).toBeUndefined()
  })

  // validateManifest: invalid status value
  it('listTurns skips manifest with unknown status value', async () => {
    const badId = newTurnId()
    const badDir = path.join(tmpDir, '.marvin', 'snapshots', badId)
    await fs.mkdir(badDir, { recursive: true })
    await fs.writeFile(
      path.join(badDir, '_manifest.json'),
      JSON.stringify({
        turnId: badId,
        files: [],
        createdAt: new Date().toISOString(),
        timestamp: Date.now(),
        trigger: 'file:write',
        status: 'invalid-status',
      }),
      'utf8'
    )
    const turns = await listTurns(tmpDir)
    expect(turns.find((m) => m.turnId === badId)).toBeUndefined()
  })

  // validateManifest: missing timestamp (number)
  it('listTurns skips manifest missing numeric timestamp', async () => {
    const badId = newTurnId()
    const badDir = path.join(tmpDir, '.marvin', 'snapshots', badId)
    await fs.mkdir(badDir, { recursive: true })
    await fs.writeFile(
      path.join(badDir, '_manifest.json'),
      JSON.stringify({
        turnId: badId,
        files: [],
        createdAt: new Date().toISOString(),
        trigger: 'file:write',
        status: 'active',
        // timestamp missing
      }),
      'utf8'
    )
    const turns = await listTurns(tmpDir)
    expect(turns.find((m) => m.turnId === badId)).toBeUndefined()
  })
})

describe('completeTurn', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('marks an active turn manifest as completed', async () => {
    const turnId = newTurnId()
    await writeSnapshot(tmpDir, turnId, 'a.md', 'content', 'file:write')

    const [before] = await listTurns(tmpDir)
    expect(before.status).toBe('active')

    await completeTurn(tmpDir, turnId)

    const [after] = await listTurns(tmpDir)
    expect(after.status).toBe('completed')
  })

  it('is idempotent when called on an already-completed turn', async () => {
    const turnId = newTurnId()
    await writeSnapshot(tmpDir, turnId, 'a.md', 'content', 'file:write')
    await completeTurn(tmpDir, turnId)
    await expect(completeTurn(tmpDir, turnId)).resolves.toBeUndefined()

    const [manifest] = await listTurns(tmpDir)
    expect(manifest.status).toBe('completed')
  })

  it('no-ops silently when turnId has no manifest on disk', async () => {
    const turnId = newTurnId()
    await expect(completeTurn(tmpDir, turnId)).resolves.toBeUndefined()
  })

  it('does not throw on invalid turnId (best-effort)', async () => {
    await expect(completeTurn(tmpDir, 'invalid-turn-id')).resolves.toBeUndefined()
  })
})

describe('security: H4 — validation at every public API boundary', () => {
  beforeEach(setup)
  afterEach(teardown)

  // writeSnapshot: invalid turnId → returns false (best-effort; assertTurnId is caught internally)
  it('writeSnapshot returns false on invalid turnId (best-effort boundary)', async () => {
    const ok = await writeSnapshot(tmpDir, 'invalid-id', 'file.md', 'content', 'file:write')
    expect(ok).toBe(false)
  })

  it('writeSnapshot returns false on traversal relPath (best-effort boundary)', async () => {
    const ok = await writeSnapshot(tmpDir, newTurnId(), '../escape.md', 'content', 'file:write')
    expect(ok).toBe(false)
  })

  it('writeSnapshot returns false on absolute relPath (best-effort boundary)', async () => {
    const ok = await writeSnapshot(tmpDir, newTurnId(), '/abs/path.md', 'content', 'file:write')
    expect(ok).toBe(false)
  })

  // listForFile: assertRelPath throws directly (not caught)
  it('listForFile throws MARVIN_INVALID_PATH on traversal relPath', async () => {
    await expect(listForFile(tmpDir, '../escape')).rejects.toThrow('MARVIN_INVALID_PATH')
  })

  it('listForFile throws MARVIN_INVALID_PATH on absolute relPath', async () => {
    await expect(listForFile(tmpDir, '/abs/path')).rejects.toThrow('MARVIN_INVALID_PATH')
  })

  it('listForFile throws MARVIN_INVALID_PATH on null-byte relPath', async () => {
    await expect(listForFile(tmpDir, 'foo\0bar')).rejects.toThrow('MARVIN_INVALID_PATH')
  })

  // readSnapshot: assertTurnId + assertRelPath both enforced
  it('readSnapshot throws MARVIN_INVALID_TURN_ID on empty turnId', async () => {
    await expect(readSnapshot(tmpDir, '', 'file.md')).rejects.toThrow('MARVIN_INVALID_TURN_ID')
  })

  it('readSnapshot throws MARVIN_INVALID_TURN_ID on UUID v4 format (not ISO-compact)', async () => {
    const uuidV4 = crypto.randomUUID()
    await expect(readSnapshot(tmpDir, uuidV4, 'file.md')).rejects.toThrow('MARVIN_INVALID_TURN_ID')
  })

  it('readSnapshot throws MARVIN_INVALID_PATH on traversal relPath', async () => {
    await expect(readSnapshot(tmpDir, newTurnId(), '../escape')).rejects.toThrow(
      'MARVIN_INVALID_PATH'
    )
  })

  // restoreSnapshot: all three assertions enforced
  it('restoreSnapshot throws MARVIN_INVALID_TURN_ID on invalid turnId', async () => {
    await expect(restoreSnapshot(tmpDir, 'invalid-id', 'file.md')).rejects.toThrow(
      'MARVIN_INVALID_TURN_ID'
    )
  })

  it('restoreSnapshot throws MARVIN_INVALID_PATH on traversal relPath', async () => {
    await expect(restoreSnapshot(tmpDir, newTurnId(), '../escape.md')).rejects.toThrow(
      'MARVIN_INVALID_PATH'
    )
  })
})

describe('security: H2 — file-level symlink in restoreSnapshot', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('restoreSnapshot rejects file-level symlink escaping vault (new H2 file realpath check)', async () => {
    const outsideFile = path.join(os.tmpdir(), `marvin-h2-file-${Date.now()}.md`)
    await fs.writeFile(outsideFile, 'sensitive content', 'utf8')
    const realOutside = await fs.realpath(outsideFile)

    // Symlink inside vault points to outside file
    const symlinkInVault = path.join(tmpDir, 'leak.md')
    await fs.symlink(realOutside, symlinkInVault)

    // Seed snapshot for the symlink path
    const turnId = newTurnId()
    const snapDir = path.join(tmpDir, '.marvin', 'snapshots', turnId)
    await fs.mkdir(snapDir, { recursive: true })
    await fs.writeFile(path.join(snapDir, 'leak.md'), 'restore content', 'utf8')
    const manifest = {
      turnId,
      files: [{ relPath: 'leak.md', sizeBefore: 14, hashBefore: 'abc' }],
      createdAt: new Date().toISOString(),
      timestamp: Date.now(),
      trigger: 'file:write',
      status: 'active',
    }
    await fs.writeFile(path.join(snapDir, '_manifest.json'), JSON.stringify(manifest), 'utf8')

    try {
      await expect(restoreSnapshot(tmpDir, turnId, 'leak.md')).rejects.toThrow(
        'MARVIN_INVALID_PATH'
      )

      // Outside file must be untouched
      const content = await fs.readFile(realOutside, 'utf8')
      expect(content).toBe('sensitive content')
    } finally {
      await fs.rm(outsideFile, { force: true })
    }
  })

  it('restoreSnapshot succeeds for non-existent target (ENOENT is safe — no symlink to check)', async () => {
    const turnId = newTurnId()
    await writeSnapshot(tmpDir, turnId, 'new-file.md', 'initial content', 'file:write')
    // File does not exist in vault yet — restore should create it
    const preTurnId = await restoreSnapshot(tmpDir, turnId, 'new-file.md')
    expect(preTurnId).toBeTruthy()
    const restored = await fs.readFile(path.join(tmpDir, 'new-file.md'), 'utf8')
    expect(restored).toBe('initial content')
  })
})

// ---------------------------------------------------------------------------
// Task #15: watcher cache-less snapshot + rename hook regressions
// ---------------------------------------------------------------------------

describe('watcher cache-less snapshot (task #15)', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('writeSnapshot with disk-read content (simulating cache miss) creates a valid snapshot', async () => {
    // Simulate: Claude created and modified a file via PTY — user never opened it,
    // so fileContentCache is empty. snapshotExternalChange reads from disk and calls
    // writeSnapshot with that content. We test writeSnapshot directly with disk content.
    const filePath = path.join(tmpDir, 'claude-created.md')
    const originalContent = '# Claude wrote this\n\nNo user ever opened it.'
    await fs.writeFile(filePath, originalContent, 'utf8')

    // Simulate what snapshotExternalChange does on cache miss: read from disk
    const diskContent = await fs.readFile(filePath, 'utf8')
    const turnId = newTurnId()
    const ok = await writeSnapshot(tmpDir, turnId, 'claude-created.md', diskContent, 'watcher')

    expect(ok).toBe(true)
    const snap = await readSnapshot(tmpDir, turnId, 'claude-created.md')
    expect(snap).toBe(originalContent)
  })

  it('writeSnapshot on cache miss returns false for binary content (skip, no snapshot)', async () => {
    // Binary file — snapshotExternalChange should skip (writeSnapshot returns false)
    const binaryContent = 'header\x00binary\x00data'
    const turnId = newTurnId()
    const ok = await writeSnapshot(tmpDir, turnId, 'image.png', binaryContent, 'watcher')
    expect(ok).toBe(false)
  })

  it('subsequent watcher change after cache miss snapshots the pre-change content', async () => {
    const filePath = path.join(tmpDir, 'evolving.md')
    await fs.writeFile(filePath, 'version 1', 'utf8')

    // First change: cache miss → read from disk, snapshot v1
    const v1 = await fs.readFile(filePath, 'utf8')
    const turn1 = newTurnId()
    await writeSnapshot(tmpDir, turn1, 'evolving.md', v1, 'watcher')

    // Simulate cache being updated (as snapshotExternalChange does after snapshot)
    await fs.writeFile(filePath, 'version 2', 'utf8')

    // Second change: cache has v2 as "before", snapshot it under a new turn
    const turn2 = newTurnId()
    const cachedBefore = await fs.readFile(filePath, 'utf8')
    await writeSnapshot(tmpDir, turn2, 'evolving.md', cachedBefore, 'watcher')

    const snap1 = await readSnapshot(tmpDir, turn1, 'evolving.md')
    const snap2 = await readSnapshot(tmpDir, turn2, 'evolving.md')
    expect(snap1).toBe('version 1')
    expect(snap2).toBe('version 2')
  })
})

describe('rename hook snapshot (task #15)', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('snapshot is created for source file before rename when AI is active', async () => {
    // Simulate what path:rename handler does when AI active:
    // read file content, call writeSnapshot with trigger 'file:write', then rename
    const oldPath = path.join(tmpDir, 'original.md')
    const originalContent = '# Original content before rename'
    await fs.writeFile(oldPath, originalContent, 'utf8')

    const turnId = newTurnId()
    const relPath = 'original.md'
    const content = await fs.readFile(oldPath, 'utf8')
    const ok = await writeSnapshot(tmpDir, turnId, relPath, content, 'file:write')

    expect(ok).toBe(true)

    // Simulate the rename itself
    const newPath = path.join(tmpDir, 'renamed.md')
    await fs.rename(oldPath, newPath)

    // Snapshot of original content must be accessible even after rename
    const snap = await readSnapshot(tmpDir, turnId, relPath)
    expect(snap).toBe(originalContent)
  })

  it('no snapshot created for rename when AI is not active (simulated by not calling writeSnapshot)', async () => {
    // When AI not active, path:rename skips snapshot — verify listForFile returns empty
    const filePath = path.join(tmpDir, 'user-rename.md')
    await fs.writeFile(filePath, 'user content', 'utf8')
    await fs.rename(filePath, path.join(tmpDir, 'user-renamed.md'))

    const versions = await listForFile(tmpDir, 'user-rename.md')
    expect(versions).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Task #18: pty:data stamp + cascade trigger regressions
// ---------------------------------------------------------------------------

describe('cascade trigger (task #18)', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('writeSnapshot accepts trigger cascade and stores it in manifest', async () => {
    const turnId = newTurnId()
    const ok = await writeSnapshot(tmpDir, turnId, 'linked.md', '# has a link', 'cascade')
    expect(ok).toBe(true)

    const turns = await listTurns(tmpDir)
    const manifest = turns.find((m) => m.turnId === turnId)
    expect(manifest).toBeDefined()
    expect(manifest!.trigger).toBe('cascade')
  })

  it('validateManifest accepts cascade trigger — manifest is not treated as corrupted', async () => {
    const turnId = newTurnId()
    await writeSnapshot(tmpDir, turnId, 'a.md', 'content', 'cascade')

    // listTurns uses readManifest → validateManifest internally
    const turns = await listTurns(tmpDir)
    const manifest = turns.find((m) => m.turnId === turnId)
    expect(manifest).toBeDefined()
    expect(manifest!.trigger).toBe('cascade')
  })

  it('cascade snapshot simulating rewriteLinksAfterMove: files affected by rename are snapshotted', async () => {
    // Create two files: A links to B
    await fs.writeFile(path.join(tmpDir, 'a.md'), '[link](b.md)', 'utf8')
    await fs.writeFile(path.join(tmpDir, 'b.md'), '# B', 'utf8')

    // Simulate what rewriteLinksAfterMove does: snapshot a.md with trigger 'cascade'
    // before rewriting its link (regardless of AI turn state)
    const cascadeTurnId = newTurnId()
    const originalA = await fs.readFile(path.join(tmpDir, 'a.md'), 'utf8')
    const ok = await writeSnapshot(tmpDir, cascadeTurnId, 'a.md', originalA, 'cascade')
    expect(ok).toBe(true)

    // Simulate the rewrite
    await fs.writeFile(path.join(tmpDir, 'a.md'), '[link](b-renamed.md)', 'utf8')

    // Snapshot must contain the pre-rewrite content
    const snap = await readSnapshot(tmpDir, cascadeTurnId, 'a.md')
    expect(snap).toBe('[link](b.md)')

    // And must appear in listForFile for a.md
    const versions = await listForFile(tmpDir, 'a.md')
    expect(versions.some((m) => m.turnId === cascadeTurnId)).toBe(true)
    expect(versions.find((m) => m.turnId === cascadeTurnId)!.trigger).toBe('cascade')
  })

  it('cascade snapshot is created even when AI turn is not active (always-snapshot semantic)', async () => {
    // Cascade snapshots bypass the AI-active check — they are unconditional.
    // Test that writeSnapshot('cascade') succeeds with no PTY involvement.
    await fs.writeFile(path.join(tmpDir, 'side-effect.md'), 'original', 'utf8')
    const turnId = newTurnId()
    const ok = await writeSnapshot(tmpDir, turnId, 'side-effect.md', 'original', 'cascade')
    expect(ok).toBe(true)
    const snap = await readSnapshot(tmpDir, turnId, 'side-effect.md')
    expect(snap).toBe('original')
  })
})

// ---------------------------------------------------------------------------
// FU-6 (#72): external-rejected trigger — validateManifest and writeSnapshot
// ---------------------------------------------------------------------------

/**
 * RED tests for issue #72.
 *
 * The 'external-rejected' trigger was added to SnapshotTrigger and is already
 * present in snapshot.ts validateManifest (line 109). These tests verify:
 *   1. validateManifest accepts 'external-rejected' (not treated as corrupted).
 *   2. writeSnapshot stores 'external-rejected' trigger correctly in manifest.
 *   3. writeSnapshot rejects traversal/null-byte relPath with 'external-rejected' trigger.
 *
 * The IPC handler snapshot:saveExternalChange in main.ts uses writeSnapshot with
 * this trigger. Tests here verify the underlying snapshot.ts layer is correct
 * before the IPC layer is wired in App.tsx handleKeepMine.
 */

describe('FU-6 (#72): external-rejected trigger', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('writeSnapshot accepts external-rejected trigger and stores it in manifest', async () => {
    const turnId = newTurnId()
    const externalContent = '# Written by Vim externally'
    const ok = await writeSnapshot(
      tmpDir,
      turnId,
      'rejected.md',
      externalContent,
      'external-rejected'
    )
    expect(ok).toBe(true)

    const turns = await listTurns(tmpDir)
    const manifest = turns.find((m) => m.turnId === turnId)
    expect(manifest).toBeDefined()
    expect(manifest!.trigger).toBe('external-rejected')
    expect(manifest!.files[0].relPath).toBe('rejected.md')
  })

  it('validateManifest accepts external-rejected trigger — not treated as corrupted', async () => {
    const turnId = newTurnId()
    await writeSnapshot(tmpDir, turnId, 'note.md', 'content', 'external-rejected')

    // listTurns uses validateManifest internally — if it rejects the trigger the turn disappears
    const turns = await listTurns(tmpDir)
    const manifest = turns.find((m) => m.turnId === turnId)
    expect(manifest).toBeDefined()
    expect(manifest!.trigger).toBe('external-rejected')
  })

  it('external-rejected snapshot stores the correct diskContent', async () => {
    const turnId = newTurnId()
    const diskContent = '# Content written by external editor'
    await writeSnapshot(tmpDir, turnId, 'external.md', diskContent, 'external-rejected')

    const snap = await readSnapshot(tmpDir, turnId, 'external.md')
    expect(snap).toBe(diskContent)
  })

  it('writeSnapshot with external-rejected returns false for relPath traversal', async () => {
    const ok = await writeSnapshot(tmpDir, newTurnId(), '../escape.md', 'bad', 'external-rejected')
    expect(ok).toBe(false)
  })

  it('writeSnapshot with external-rejected returns false for null-byte in relPath', async () => {
    const ok = await writeSnapshot(tmpDir, newTurnId(), 'foo\0bar.md', 'bad', 'external-rejected')
    expect(ok).toBe(false)
  })

  it('writeSnapshot with external-rejected returns false for absolute relPath', async () => {
    const ok = await writeSnapshot(tmpDir, newTurnId(), '/etc/passwd', 'bad', 'external-rejected')
    expect(ok).toBe(false)
  })

  it('listForFile returns external-rejected turns for the given file', async () => {
    const turnId = newTurnId()
    await writeSnapshot(tmpDir, turnId, 'notes/tracked.md', 'external version', 'external-rejected')

    const versions = await listForFile(tmpDir, 'notes/tracked.md')
    expect(versions).toHaveLength(1)
    expect(versions[0].trigger).toBe('external-rejected')
    expect(versions[0].turnId).toBe(turnId)
  })

  it('external-rejected snapshot is independent from buffer-save snapshot in same turn', async () => {
    // Both triggers can coexist in different turns — verify they are separate
    const t1 = newTurnId()
    const t2 = newTurnId()

    await writeSnapshot(tmpDir, t1, 'file.md', 'buffer content', 'buffer-save')
    await writeSnapshot(tmpDir, t2, 'file.md', 'disk content from external', 'external-rejected')

    const versions = await listForFile(tmpDir, 'file.md')
    expect(versions).toHaveLength(2)

    const bufferSaveTurn = versions.find((m) => m.trigger === 'buffer-save')
    const externalRejectedTurn = versions.find((m) => m.trigger === 'external-rejected')
    expect(bufferSaveTurn).toBeDefined()
    expect(externalRejectedTurn).toBeDefined()

    expect(await readSnapshot(tmpDir, t1, 'file.md')).toBe('buffer content')
    expect(await readSnapshot(tmpDir, t2, 'file.md')).toBe('disk content from external')
  })
})
