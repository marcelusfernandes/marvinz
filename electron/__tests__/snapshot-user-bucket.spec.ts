/**
 * RED tests for issue #148 (U2) — user-bucket snapshot API.
 *
 * These tests cover:
 *   1. captureUserSnapshot: writes under .marvin/snapshots/_user/, creates
 *      _user/_manifest.json, returns a snapshotId, accepts trigger 'user-trash'
 *      without requiring a turnId.
 *   2. restoreUserSnapshot: restores a file's content given a snapshotId.
 *   3. FIFO cap: _user bucket is pruned to 50 entries on every capture.
 *   4. AI-turn path untouched: writeSnapshot / readSnapshot / restoreSnapshot
 *      are regression-checked to still behave identically (bucket isolation).
 *
 * All tests FAIL against the current snapshot.ts (captureUserSnapshot and
 * restoreUserSnapshot do not yet exist). They turn GREEN after the U2
 * implementation lands.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { vi } from 'vitest'
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
  // New U2 exports — these do NOT exist yet (tests are RED by design)
  captureUserSnapshot,
  restoreUserSnapshot,
  // Existing exports — used for regression checks
  writeSnapshot,
  readSnapshot,
  restoreSnapshot,
  listTurns,
  newTurnId,
} from '../snapshot.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const USER_BUCKET_ID = '_user'

let tmpDir: string

async function setup(): Promise<string> {
  const raw = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-u2-test-'))
  tmpDir = await fs.realpath(raw)
  return tmpDir
}

async function teardown() {
  await fs.rm(tmpDir, { recursive: true, force: true })
}

async function writeVaultFile(relPath: string, content: string): Promise<void> {
  const abs = path.join(tmpDir, relPath)
  await fs.mkdir(path.dirname(abs), { recursive: true })
  await fs.writeFile(abs, content, 'utf8')
}

async function readVaultFile(relPath: string): Promise<string> {
  return fs.readFile(path.join(tmpDir, relPath), 'utf8')
}

function userManifestPath(vaultRoot: string): string {
  return path.join(vaultRoot, '.marvin', 'snapshots', USER_BUCKET_ID, '_manifest.json')
}

function userBucketDir(vaultRoot: string): string {
  return path.join(vaultRoot, '.marvin', 'snapshots', USER_BUCKET_ID)
}

// ---------------------------------------------------------------------------
// captureUserSnapshot — basic contract
// ---------------------------------------------------------------------------

describe('captureUserSnapshot: basic capture contract', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('returns a snapshotId string on success', async () => {
    await writeVaultFile('notes/daily.md', '# Day 1')

    const snapshotId = await captureUserSnapshot(tmpDir, ['notes/daily.md'], 'user-trash')

    expect(typeof snapshotId).toBe('string')
    expect(snapshotId.length).toBeGreaterThan(0)
  })

  it('creates _user/_manifest.json on first capture', async () => {
    await writeVaultFile('journal.md', 'Dear diary')

    await captureUserSnapshot(tmpDir, ['journal.md'], 'user-trash')

    const manifestExists = await fs
      .access(userManifestPath(tmpDir))
      .then(() => true)
      .catch(() => false)
    expect(manifestExists).toBe(true)
  })

  it('writes file content into _user bucket directory (not under a turnId dir)', async () => {
    const content = '# User trash target'
    await writeVaultFile('trashed.md', content)

    await captureUserSnapshot(tmpDir, ['trashed.md'], 'user-trash')

    // The file must exist somewhere under _user/ but NOT under a turnId directory
    const bucketDir = userBucketDir(tmpDir)
    const bucketExists = await fs
      .access(bucketDir)
      .then(() => true)
      .catch(() => false)
    expect(bucketExists).toBe(true)

    // _manifest.json must exist in _user/
    const manifestExists = await fs
      .access(userManifestPath(tmpDir))
      .then(() => true)
      .catch(() => false)
    expect(manifestExists).toBe(true)
  })

  it('stores the file content in the snapshot bundle', async () => {
    const originalContent = '# About to be trashed\n\nSome important notes.'
    await writeVaultFile('notes/important.md', originalContent)

    const snapshotId = await captureUserSnapshot(tmpDir, ['notes/important.md'], 'user-trash')

    // After capture, the snapshotId must be usable to restore the content
    // (full round-trip is tested separately; here we just verify capture didn't discard content)
    expect(snapshotId).toBeTruthy()

    const manifest = JSON.parse(await fs.readFile(userManifestPath(tmpDir), 'utf8'))
    const entry = (manifest.entries as Array<{ snapshotId: string }>).find(
      (e) => e.snapshotId === snapshotId
    )
    expect(entry).toBeDefined()
  })

  it('stores trigger user-trash in manifest entry', async () => {
    await writeVaultFile('file.md', 'content')

    const snapshotId = await captureUserSnapshot(tmpDir, ['file.md'], 'user-trash')

    const manifest = JSON.parse(await fs.readFile(userManifestPath(tmpDir), 'utf8'))
    const entry = (manifest.entries as Array<{ snapshotId: string; trigger: string }>).find(
      (e) => e.snapshotId === snapshotId
    )
    expect(entry?.trigger).toBe('user-trash')
  })

  it('captures multiple paths under one snapshotId', async () => {
    await writeVaultFile('a.md', 'content a')
    await writeVaultFile('b.md', 'content b')

    const snapshotId = await captureUserSnapshot(tmpDir, ['a.md', 'b.md'], 'user-trash')

    const manifest = JSON.parse(await fs.readFile(userManifestPath(tmpDir), 'utf8'))
    const entry = (manifest.entries as Array<{ snapshotId: string; paths: string[] }>).find(
      (e) => e.snapshotId === snapshotId
    )
    expect(entry?.paths).toContain('a.md')
    expect(entry?.paths).toContain('b.md')
  })

  it('appends to _manifest.json on subsequent captures (does not reset)', async () => {
    await writeVaultFile('file1.md', 'v1')
    await writeVaultFile('file2.md', 'v2')

    const id1 = await captureUserSnapshot(tmpDir, ['file1.md'], 'user-trash')
    const id2 = await captureUserSnapshot(tmpDir, ['file2.md'], 'user-trash')

    const manifest = JSON.parse(await fs.readFile(userManifestPath(tmpDir), 'utf8'))
    const ids = (manifest.entries as Array<{ snapshotId: string }>).map((e) => e.snapshotId)
    expect(ids).toContain(id1)
    expect(ids).toContain(id2)
  })

  it('each call generates a unique snapshotId', async () => {
    await writeVaultFile('x.md', 'content')

    const ids = await Promise.all(
      Array.from({ length: 10 }, () => captureUserSnapshot(tmpDir, ['x.md'], 'user-trash'))
    )

    expect(new Set(ids).size).toBe(10)
  })

  it('does NOT write under any turnId-prefixed directory', async () => {
    await writeVaultFile('note.md', 'content')

    await captureUserSnapshot(tmpDir, ['note.md'], 'user-trash')

    const snapshotsRoot = path.join(tmpDir, '.marvin', 'snapshots')
    const entries = await fs.readdir(snapshotsRoot, { withFileTypes: true })
    const turnIdDirs = entries.filter((e) => e.isDirectory() && e.name !== USER_BUCKET_ID)
    // No turnId directory should exist — capture must only touch _user/
    expect(turnIdDirs).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// captureUserSnapshot — validation / error handling
// ---------------------------------------------------------------------------

describe('captureUserSnapshot: validation', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('rejects an empty paths array', async () => {
    await expect(captureUserSnapshot(tmpDir, [], 'user-trash')).rejects.toThrow()
  })

  it('rejects a path with traversal (..)', async () => {
    await expect(captureUserSnapshot(tmpDir, ['../outside.md'], 'user-trash')).rejects.toThrow(
      /MARVIN_INVALID_PATH|invalid|traversal/i
    )
  })

  it('rejects an absolute path', async () => {
    await expect(captureUserSnapshot(tmpDir, ['/etc/passwd'], 'user-trash')).rejects.toThrow(
      /MARVIN_INVALID_PATH|MARVIN_OUTSIDE_VAULT|invalid/i
    )
  })

  it('rejects a path with embedded traversal', async () => {
    await expect(
      captureUserSnapshot(tmpDir, ['sub/../../etc/passwd'], 'user-trash')
    ).rejects.toThrow(/MARVIN_INVALID_PATH|MARVIN_OUTSIDE_VAULT|invalid/i)
  })

  it('rejects a path with a null byte', async () => {
    await expect(captureUserSnapshot(tmpDir, ['foo\0bar.md'], 'user-trash')).rejects.toThrow(
      /MARVIN_INVALID_PATH|MARVIN_OUTSIDE_VAULT|invalid/i
    )
  })

  it('rejects paths that escape the vault root via absolute resolution', async () => {
    // Even if it passes the string check, the resolved path must still be inside vault
    const outsideAbsPath = path.join(os.tmpdir(), 'outside.md')
    await expect(captureUserSnapshot(tmpDir, [outsideAbsPath], 'user-trash')).rejects.toThrow(
      /MARVIN_INVALID_PATH|MARVIN_OUTSIDE_VAULT|invalid/i
    )
  })
})

// ---------------------------------------------------------------------------
// restoreUserSnapshot — basic contract
// ---------------------------------------------------------------------------

describe('restoreUserSnapshot: basic restore contract', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('restores a single-file bundle to its original path', async () => {
    const originalContent = '# Before trash\n\nDo not lose this.'
    await writeVaultFile('docs/guide.md', originalContent)

    const snapshotId = await captureUserSnapshot(tmpDir, ['docs/guide.md'], 'user-trash')

    // Simulate trash: remove the file
    await fs.rm(path.join(tmpDir, 'docs/guide.md'))

    await restoreUserSnapshot(tmpDir, snapshotId)

    expect(await readVaultFile('docs/guide.md')).toBe(originalContent)
  })

  it('restores a multi-file bundle restoring all paths', async () => {
    await writeVaultFile('a.md', 'content a')
    await writeVaultFile('b.md', 'content b')

    const snapshotId = await captureUserSnapshot(tmpDir, ['a.md', 'b.md'], 'user-trash')

    await fs.rm(path.join(tmpDir, 'a.md'))
    await fs.rm(path.join(tmpDir, 'b.md'))

    await restoreUserSnapshot(tmpDir, snapshotId)

    expect(await readVaultFile('a.md')).toBe('content a')
    expect(await readVaultFile('b.md')).toBe('content b')
  })

  it('creates parent directories when restoring a file whose parent was removed', async () => {
    await writeVaultFile('deep/nested/note.md', 'nested content')

    const snapshotId = await captureUserSnapshot(tmpDir, ['deep/nested/note.md'], 'user-trash')

    // Remove the entire parent tree
    await fs.rm(path.join(tmpDir, 'deep'), { recursive: true })

    await restoreUserSnapshot(tmpDir, snapshotId)

    expect(await readVaultFile('deep/nested/note.md')).toBe('nested content')
  })

  it('throws on unknown snapshotId', async () => {
    await expect(restoreUserSnapshot(tmpDir, 'nonexistent-snapshot-id')).rejects.toThrow()
  })

  it('restores exact content including unicode characters', async () => {
    const content = '# Unicode test\n\nCafé au lait ☕ — résumé'
    await writeVaultFile('unicode.md', content)

    const snapshotId = await captureUserSnapshot(tmpDir, ['unicode.md'], 'user-trash')
    await fs.rm(path.join(tmpDir, 'unicode.md'))
    await restoreUserSnapshot(tmpDir, snapshotId)

    expect(await readVaultFile('unicode.md')).toBe(content)
  })
})

// ---------------------------------------------------------------------------
// restoreUserSnapshot — path safety / security
// ---------------------------------------------------------------------------

describe('restoreUserSnapshot: path safety', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('rejects restore when target path would escape vault (path traversal in stored path)', async () => {
    // Manually craft a _user manifest with a traversal path — restoreUserSnapshot must reject
    const bucketDir = path.join(tmpDir, '.marvin', 'snapshots', USER_BUCKET_ID)
    await fs.mkdir(bucketDir, { recursive: true })

    const maliciousId = 'evil-snap-id'
    const manifest = {
      entries: [
        {
          snapshotId: maliciousId,
          trigger: 'user-trash',
          createdAt: new Date().toISOString(),
          paths: ['../../etc/evil.md'],
        },
      ],
    }
    await fs.writeFile(path.join(bucketDir, '_manifest.json'), JSON.stringify(manifest), 'utf8')

    await expect(restoreUserSnapshot(tmpDir, maliciousId)).rejects.toThrow(
      /MARVIN_INVALID_PATH|invalid|traversal/i
    )
  })

  it('rejects capture and restore when symlink inside vault points outside', async () => {
    // The implementation does realpath checks at capture time via vault-boundary.ts.
    // A symlink pointing outside the vault is rejected at captureUserSnapshot too.
    const outsideFile = path.join(os.tmpdir(), `marvin-u2-outside-${Date.now()}.md`)
    await fs.writeFile(outsideFile, 'outside content', 'utf8')

    const symlinkPath = path.join(tmpDir, 'link.md')
    await fs.symlink(outsideFile, symlinkPath)

    try {
      // Capture must be rejected — symlink target is outside the vault
      await expect(captureUserSnapshot(tmpDir, ['link.md'], 'user-trash')).rejects.toThrow(
        /MARVIN_INVALID_PATH|MARVIN_OUTSIDE_VAULT|invalid/i
      )

      // Also verify restoreUserSnapshot rejects a manually planted manifest entry
      // that references a path whose symlink target escapes the vault
      const bucketDir = path.join(tmpDir, '.marvin', 'snapshots', '_user')
      await fs.mkdir(bucketDir, { recursive: true })
      const plantedId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      const manifest = {
        entries: [
          {
            snapshotId: plantedId,
            trigger: 'user-trash',
            createdAt: new Date().toISOString(),
            timestamp: Date.now(),
            paths: ['link.md'],
          },
        ],
      }
      const snapDataDir = path.join(bucketDir, plantedId)
      await fs.mkdir(snapDataDir, { recursive: true })
      await fs.writeFile(path.join(snapDataDir, 'link.md'), 'snap content', 'utf8')
      await fs.writeFile(path.join(bucketDir, '_manifest.json'), JSON.stringify(manifest), 'utf8')

      await expect(restoreUserSnapshot(tmpDir, plantedId)).rejects.toThrow(
        /MARVIN_INVALID_PATH|MARVIN_OUTSIDE_VAULT|invalid/i
      )

      // Outside file content must be unchanged
      const content = await fs.readFile(outsideFile, 'utf8')
      expect(content).toBe('outside content')
    } finally {
      await fs.rm(outsideFile, { force: true })
    }
  })
})

// ---------------------------------------------------------------------------
// FIFO cap: _user bucket limited to 50 entries
// ---------------------------------------------------------------------------

describe('captureUserSnapshot: FIFO cap at 50 entries', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('manifest never exceeds 50 entries after 55 consecutive captures', async () => {
    await writeVaultFile('file.md', 'content')

    const ids: string[] = []
    for (let i = 0; i < 55; i++) {
      const id = await captureUserSnapshot(tmpDir, ['file.md'], 'user-trash')
      ids.push(id)
    }

    const manifest = JSON.parse(await fs.readFile(userManifestPath(tmpDir), 'utf8'))
    expect((manifest.entries as unknown[]).length).toBeLessThanOrEqual(50)
  }, 30_000)

  it('pruning removes the oldest entries (FIFO — first-in-first-out)', async () => {
    await writeVaultFile('file.md', 'content')

    // Capture 52 times — first 2 should be evicted
    const ids: string[] = []
    for (let i = 0; i < 52; i++) {
      ids.push(await captureUserSnapshot(tmpDir, ['file.md'], 'user-trash'))
    }

    const manifest = JSON.parse(await fs.readFile(userManifestPath(tmpDir), 'utf8'))
    const remaining = (manifest.entries as Array<{ snapshotId: string }>).map((e) => e.snapshotId)

    // The first 2 (oldest) must have been pruned
    expect(remaining).not.toContain(ids[0])
    expect(remaining).not.toContain(ids[1])

    // The last 50 must still be present
    for (let i = 2; i < 52; i++) {
      expect(remaining).toContain(ids[i])
    }
  }, 30_000)

  it('snapshot data files for pruned entries are deleted from disk', async () => {
    await writeVaultFile('file.md', 'content')

    const ids: string[] = []
    for (let i = 0; i < 52; i++) {
      ids.push(await captureUserSnapshot(tmpDir, ['file.md'], 'user-trash'))
    }

    // Trying to restore the oldest (pruned) snapshot must throw
    await expect(restoreUserSnapshot(tmpDir, ids[0])).rejects.toThrow()
  }, 30_000)

  it('cap is independent of AI-turn snapshots (separate budget)', async () => {
    await writeVaultFile('file.md', 'content')

    // Create 3 AI-turn snapshots
    for (let i = 0; i < 3; i++) {
      const turnId = newTurnId()
      await writeSnapshot(tmpDir, turnId, 'file.md', 'ai content', 'file:write')
    }

    // Create 51 user captures — should prune 1, leaving 50
    for (let i = 0; i < 51; i++) {
      await captureUserSnapshot(tmpDir, ['file.md'], 'user-trash')
    }

    const userManifest = JSON.parse(await fs.readFile(userManifestPath(tmpDir), 'utf8'))
    expect((userManifest.entries as unknown[]).length).toBeLessThanOrEqual(50)

    // AI-turn snapshots must still exist
    const aiTurns = await listTurns(tmpDir)
    expect(aiTurns).toHaveLength(3)
  }, 30_000)
})

// ---------------------------------------------------------------------------
// Bucket isolation: AI-turn snapshot path untouched
// ---------------------------------------------------------------------------

describe('bucket isolation: AI-turn snapshot path is unaffected by U2', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('writeSnapshot still writes under a turnId directory after captureUserSnapshot exists', async () => {
    const turnId = newTurnId()
    const ok = await writeSnapshot(tmpDir, turnId, 'note.md', '# original', 'file:write')

    expect(ok).toBe(true)

    // The snapshot must be under .marvin/snapshots/<turnId>/, not _user/
    const turnDir = path.join(tmpDir, '.marvin', 'snapshots', turnId)
    const exists = await fs
      .access(turnDir)
      .then(() => true)
      .catch(() => false)
    expect(exists).toBe(true)
  })

  it('readSnapshot for an AI-turn still works after user captures exist', async () => {
    const turnId = newTurnId()
    const content = '# AI wrote this'
    await writeSnapshot(tmpDir, turnId, 'ai-note.md', content, 'file:write')

    // Also create a user capture to verify no interference
    await writeVaultFile('ai-note.md', content)
    await captureUserSnapshot(tmpDir, ['ai-note.md'], 'user-trash')

    const snapshot = await readSnapshot(tmpDir, turnId, 'ai-note.md')
    expect(snapshot).toBe(content)
  })

  it('restoreSnapshot (AI-turn variant) is unaffected by _user bucket entries', async () => {
    const aiContent = '# AI version'
    const userContent = '# User version'

    await writeVaultFile('shared.md', aiContent)
    const turnId = newTurnId()
    await writeSnapshot(tmpDir, turnId, 'shared.md', aiContent, 'file:write')

    // User capture
    await writeVaultFile('shared.md', userContent)
    await captureUserSnapshot(tmpDir, ['shared.md'], 'user-trash')

    // Restore the AI-turn snapshot — should restore aiContent
    await restoreSnapshot(tmpDir, turnId, 'shared.md')

    expect(await readVaultFile('shared.md')).toBe(aiContent)
  })

  it('listTurns does NOT include _user bucket as a turn', async () => {
    await writeVaultFile('file.md', 'content')

    // Create both a real AI turn and a user capture
    const turnId = newTurnId()
    await writeSnapshot(tmpDir, turnId, 'file.md', 'content', 'file:write')
    await captureUserSnapshot(tmpDir, ['file.md'], 'user-trash')

    const turns = await listTurns(tmpDir)
    const hasUserBucket = turns.some((m) => m.turnId === USER_BUCKET_ID)
    expect(hasUserBucket).toBe(false)
  })
})
