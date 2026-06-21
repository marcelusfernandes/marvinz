/**
 * Task #4 — Integration, path-safety/security, and AI-turn regression tests for U2.
 *
 * Three suites:
 *   A. Integration: capture → restoreUserSnapshot round-trip exercising real disk I/O
 *      and the manifest life cycle end-to-end.
 *   B. Path-safety / security: captureUserSnapshot and restoreUserSnapshot reject
 *      paths that escape the vault (traversal, absolute, null byte, symlinks).
 *   C. AI-turn regression: writeSnapshot / readSnapshot / restoreSnapshot still
 *      behave identically after the _user bucket was introduced; listTurns does
 *      not surface _user; gc does not touch _user.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

vi.mock('electron', () => ({
  shell: { trashItem: vi.fn().mockResolvedValue(undefined) },
}))

import {
  captureUserSnapshot,
  restoreUserSnapshot,
  writeSnapshot,
  readSnapshot,
  restoreSnapshot,
  listTurns,
  gc,
  newTurnId,
} from '../snapshot.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const USER_BUCKET_ID = '_user'

let tmpDir: string

async function setup(): Promise<string> {
  const raw = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-u2-int-'))
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

// ---------------------------------------------------------------------------
// A. Integration: capture → restoreUserSnapshot round-trip
// ---------------------------------------------------------------------------

describe('integration: capture → restoreUserSnapshot round-trip', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('round-trip: single file captured before trash, then restored to exact content', async () => {
    const original = '# Meeting notes\n\nImportant decisions recorded here.'
    await writeVaultFile('meetings/2025-01.md', original)

    // Simulate U3 caller: capture before trash
    const snapshotId = await captureUserSnapshot(tmpDir, ['meetings/2025-01.md'], 'user-trash')
    expect(typeof snapshotId).toBe('string')

    // Simulate trash
    await fs.rm(path.join(tmpDir, 'meetings/2025-01.md'))

    // Simulate U3 undo: restore
    await restoreUserSnapshot(tmpDir, snapshotId)

    expect(await readVaultFile('meetings/2025-01.md')).toBe(original)
  })

  it('round-trip: multi-file bundle captured and restored atomically', async () => {
    await writeVaultFile('a.md', 'file A contents')
    await writeVaultFile('b.md', 'file B contents')

    const snapshotId = await captureUserSnapshot(tmpDir, ['a.md', 'b.md'], 'user-trash')

    await fs.rm(path.join(tmpDir, 'a.md'))
    await fs.rm(path.join(tmpDir, 'b.md'))

    await restoreUserSnapshot(tmpDir, snapshotId)

    expect(await readVaultFile('a.md')).toBe('file A contents')
    expect(await readVaultFile('b.md')).toBe('file B contents')
  })

  it('round-trip: content is exactly preserved including whitespace and encoding', async () => {
    const content = '---\ntitle: "Test: résumé"\n---\n\nCafé ☕ — line 2\n\n  indented\n'
    await writeVaultFile('unicode.md', content)

    const snapshotId = await captureUserSnapshot(tmpDir, ['unicode.md'], 'user-trash')
    await fs.rm(path.join(tmpDir, 'unicode.md'))
    await restoreUserSnapshot(tmpDir, snapshotId)

    expect(await readVaultFile('unicode.md')).toBe(content)
  })

  it('round-trip: multiple independent captures each produce distinct snapshotIds', async () => {
    await writeVaultFile('doc.md', 'version 1')
    const id1 = await captureUserSnapshot(tmpDir, ['doc.md'], 'user-trash')

    await writeVaultFile('doc.md', 'version 2')
    const id2 = await captureUserSnapshot(tmpDir, ['doc.md'], 'user-trash')

    expect(id1).not.toBe(id2)

    // Each snapshotId restores its own version
    await fs.rm(path.join(tmpDir, 'doc.md'))
    await restoreUserSnapshot(tmpDir, id1)
    expect(await readVaultFile('doc.md')).toBe('version 1')

    await restoreUserSnapshot(tmpDir, id2)
    expect(await readVaultFile('doc.md')).toBe('version 2')
  })

  it('round-trip: restoring re-creates parent directories removed alongside the file', async () => {
    await writeVaultFile('projects/alpha/notes.md', 'alpha project notes')

    const snapshotId = await captureUserSnapshot(tmpDir, ['projects/alpha/notes.md'], 'user-trash')

    // Simulate trash of the whole folder
    await fs.rm(path.join(tmpDir, 'projects'), { recursive: true })

    await restoreUserSnapshot(tmpDir, snapshotId)

    expect(await readVaultFile('projects/alpha/notes.md')).toBe('alpha project notes')
  })

  it('round-trip: manifest entry is present after capture and snapshotId is resolvable', async () => {
    await writeVaultFile('note.md', 'persist me')

    const snapshotId = await captureUserSnapshot(tmpDir, ['note.md'], 'user-trash')

    const manifest = JSON.parse(await fs.readFile(userManifestPath(tmpDir), 'utf8'))
    const entry = manifest.entries.find((e: { snapshotId: string }) => e.snapshotId === snapshotId)

    expect(entry).toBeDefined()
    expect(entry.trigger).toBe('user-trash')
    expect(entry.paths).toContain('note.md')
    expect(entry.createdAt).toBeTruthy()
    expect(typeof entry.timestamp).toBe('number')
  })

  it('round-trip: snapshot data persists on disk after the original file is removed', async () => {
    await writeVaultFile('ephemeral.md', 'do not lose me')

    const snapshotId = await captureUserSnapshot(tmpDir, ['ephemeral.md'], 'user-trash')
    await fs.rm(path.join(tmpDir, 'ephemeral.md'))

    // Snapshot data file must still be readable
    const snapDir = path.join(tmpDir, '.marvin', 'snapshots', USER_BUCKET_ID, snapshotId)
    const snapFile = path.join(snapDir, 'ephemeral.md')
    const snapContent = await fs.readFile(snapFile, 'utf8')
    expect(snapContent).toBe('do not lose me')
  })

  it('round-trip: second restore of the same snapshotId is idempotent', async () => {
    const content = 'idempotent content'
    await writeVaultFile('idem.md', content)

    const snapshotId = await captureUserSnapshot(tmpDir, ['idem.md'], 'user-trash')
    await fs.rm(path.join(tmpDir, 'idem.md'))

    await restoreUserSnapshot(tmpDir, snapshotId)
    await restoreUserSnapshot(tmpDir, snapshotId)

    expect(await readVaultFile('idem.md')).toBe(content)
  })
})

// ---------------------------------------------------------------------------
// B. Path-safety / security
// ---------------------------------------------------------------------------

describe('path-safety: captureUserSnapshot rejects paths outside vault', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('rejects traversal path ("../outside.md")', async () => {
    await expect(captureUserSnapshot(tmpDir, ['../outside.md'], 'user-trash')).rejects.toThrow(
      /MARVIN_INVALID_PATH|MARVIN_OUTSIDE_VAULT|invalid/i
    )
  })

  it('rejects absolute path ("/etc/passwd")', async () => {
    await expect(captureUserSnapshot(tmpDir, ['/etc/passwd'], 'user-trash')).rejects.toThrow(
      /MARVIN_INVALID_PATH|MARVIN_OUTSIDE_VAULT|invalid/i
    )
  })

  it('rejects embedded traversal ("sub/../../etc/passwd")', async () => {
    await expect(
      captureUserSnapshot(tmpDir, ['sub/../../etc/passwd'], 'user-trash')
    ).rejects.toThrow(/MARVIN_INVALID_PATH|MARVIN_OUTSIDE_VAULT|invalid/i)
  })

  it('rejects path with null byte', async () => {
    await expect(captureUserSnapshot(tmpDir, ['foo\0bar.md'], 'user-trash')).rejects.toThrow(
      /MARVIN_INVALID_PATH|MARVIN_OUTSIDE_VAULT|invalid/i
    )
  })

  it('rejects empty string path', async () => {
    await expect(captureUserSnapshot(tmpDir, [''], 'user-trash')).rejects.toThrow()
  })

  it('rejects empty paths array', async () => {
    await expect(captureUserSnapshot(tmpDir, [], 'user-trash')).rejects.toThrow()
  })

  it('does not write any file outside vault on traversal attempt', async () => {
    const outsidePath = path.resolve(tmpDir, '../outside.md')
    await captureUserSnapshot(tmpDir, ['../outside.md'], 'user-trash').catch(() => {
      /* expected */
    })
    const exists = await fs
      .access(outsidePath)
      .then(() => true)
      .catch(() => false)
    expect(exists).toBe(false)
  })

  it('rejects invalid trigger value', async () => {
    await writeVaultFile('note.md', 'content')
    await expect(
      // @ts-expect-error intentionally invalid trigger for test
      captureUserSnapshot(tmpDir, ['note.md'], 'invalid-trigger')
    ).rejects.toThrow(/MARVIN_INVALID_TRIGGER|invalid/i)
  })
})

describe('path-safety: restoreUserSnapshot rejects paths outside vault', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('throws MARVIN_UNKNOWN_SNAPSHOT for a nonexistent snapshotId', async () => {
    await expect(restoreUserSnapshot(tmpDir, 'totally-nonexistent-id')).rejects.toThrow(
      /MARVIN_UNKNOWN_SNAPSHOT|unknown|not found/i
    )
  })

  it('rejects restore when manifest entry carries a traversal path', async () => {
    // Manually write a poisoned _user manifest
    const bucketDir = path.join(tmpDir, '.marvin', 'snapshots', USER_BUCKET_ID)
    await fs.mkdir(bucketDir, { recursive: true })
    const maliciousId = '11111111-1111-4111-8111-111111111111'
    const manifest = {
      entries: [
        {
          snapshotId: maliciousId,
          trigger: 'user-trash',
          createdAt: new Date().toISOString(),
          timestamp: Date.now(),
          paths: ['../../etc/evil.md'],
        },
      ],
    }
    await fs.writeFile(userManifestPath(tmpDir), JSON.stringify(manifest), 'utf8')

    await expect(restoreUserSnapshot(tmpDir, maliciousId)).rejects.toThrow(
      /MARVIN_INVALID_PATH|MARVIN_OUTSIDE_VAULT|invalid/i
    )
  })

  it('rejects restore when manifest entry carries an absolute path', async () => {
    const bucketDir = path.join(tmpDir, '.marvin', 'snapshots', USER_BUCKET_ID)
    await fs.mkdir(bucketDir, { recursive: true })
    const maliciousId = '22222222-2222-4222-8222-222222222222'
    const manifest = {
      entries: [
        {
          snapshotId: maliciousId,
          trigger: 'user-trash',
          createdAt: new Date().toISOString(),
          timestamp: Date.now(),
          paths: ['/etc/passwd'],
        },
      ],
    }
    await fs.writeFile(userManifestPath(tmpDir), JSON.stringify(manifest), 'utf8')

    await expect(restoreUserSnapshot(tmpDir, maliciousId)).rejects.toThrow(
      /MARVIN_INVALID_PATH|MARVIN_OUTSIDE_VAULT|invalid/i
    )
  })

  it('rejects capture when symlink inside vault points outside', async () => {
    // The implementation performs realpath checks at capture time via vault-boundary.ts.
    // captureUserSnapshot must reject a path whose symlink target is outside the vault.
    const outsideFile = path.join(os.tmpdir(), `marvin-u2-int-outside-${Date.now()}.md`)
    await fs.writeFile(outsideFile, 'sensitive', 'utf8')
    const realOutside = await fs.realpath(outsideFile)

    const symlinkInVault = path.join(tmpDir, 'link.md')
    await fs.symlink(realOutside, symlinkInVault)

    try {
      // Capture must be rejected — symlink target escapes vault
      await expect(captureUserSnapshot(tmpDir, ['link.md'], 'user-trash')).rejects.toThrow(
        /MARVIN_INVALID_PATH|MARVIN_OUTSIDE_VAULT|invalid/i
      )

      // The outside file must be untouched
      expect(await fs.readFile(realOutside, 'utf8')).toBe('sensitive')
    } finally {
      await fs.rm(outsideFile, { force: true })
    }
  })

  it('rejects restore when parent directory is a symlink escaping the vault', async () => {
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-u2-int-outdir-'))
    const realOutsideDir = await fs.realpath(outsideDir)

    // Symlink a subdirectory inside vault to outside dir
    const symlinkDir = path.join(tmpDir, 'evil-dir')
    await fs.symlink(realOutsideDir, symlinkDir)

    // Manually plant a snapshot entry whose path resolves into evil-dir
    const bucketDir = path.join(tmpDir, '.marvin', 'snapshots', USER_BUCKET_ID)
    await fs.mkdir(bucketDir, { recursive: true })
    const escapingId = '33333333-3333-4333-8333-333333333333'

    // Write the snapshot data file to make it "findable"
    const snapDataDir = path.join(bucketDir, escapingId)
    await fs.mkdir(path.join(snapDataDir, 'evil-dir'), { recursive: true })
    await fs.writeFile(path.join(snapDataDir, 'evil-dir', 'target.md'), 'snap content', 'utf8')

    const manifest = {
      entries: [
        {
          snapshotId: escapingId,
          trigger: 'user-trash',
          createdAt: new Date().toISOString(),
          timestamp: Date.now(),
          paths: ['evil-dir/target.md'],
        },
      ],
    }
    await fs.writeFile(userManifestPath(tmpDir), JSON.stringify(manifest), 'utf8')

    try {
      await expect(restoreUserSnapshot(tmpDir, escapingId)).rejects.toThrow(
        /MARVIN_INVALID_PATH|MARVIN_OUTSIDE_VAULT|invalid/i
      )

      // outsideDir must be empty
      expect(await fs.readdir(realOutsideDir)).toHaveLength(0)
    } finally {
      await fs.rm(outsideDir, { recursive: true, force: true })
    }
  })
})

// ---------------------------------------------------------------------------
// C. AI-turn regression: existing snapshot paths unaffected by U2
// ---------------------------------------------------------------------------

describe('regression: AI-turn snapshot path is unaffected by U2 additions', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('writeSnapshot still creates a turnId-scoped directory', async () => {
    const turnId = newTurnId()
    const ok = await writeSnapshot(tmpDir, turnId, 'note.md', '# AI note', 'file:write')

    expect(ok).toBe(true)
    const turnDir = path.join(tmpDir, '.marvin', 'snapshots', turnId)
    expect(
      await fs
        .access(turnDir)
        .then(() => true)
        .catch(() => false)
    ).toBe(true)
  })

  it('readSnapshot retrieves AI-turn content unaffected by concurrent user captures', async () => {
    const aiContent = '# Written by AI'
    const turnId = newTurnId()
    await writeSnapshot(tmpDir, turnId, 'shared.md', aiContent, 'file:write')

    // Also do a user capture of the same path
    await writeVaultFile('shared.md', aiContent)
    await captureUserSnapshot(tmpDir, ['shared.md'], 'user-trash')

    const snap = await readSnapshot(tmpDir, turnId, 'shared.md')
    expect(snap).toBe(aiContent)
  })

  it('restoreSnapshot (AI-turn) restores the correct version and is not confused by _user bucket', async () => {
    const v1 = '# Version 1 — AI'
    const v2 = '# Version 2 — user'

    await writeVaultFile('doc.md', v1)
    const turnId = newTurnId()
    await writeSnapshot(tmpDir, turnId, 'doc.md', v1, 'file:write')

    await writeVaultFile('doc.md', v2)
    await captureUserSnapshot(tmpDir, ['doc.md'], 'user-trash')

    // Restore the AI-turn snapshot — should get v1 back
    await restoreSnapshot(tmpDir, turnId, 'doc.md')
    expect(await readVaultFile('doc.md')).toBe(v1)
  })

  it('listTurns does NOT include _user bucket as a turn entry', async () => {
    const turnId = newTurnId()
    await writeSnapshot(tmpDir, turnId, 'file.md', 'content', 'file:write')

    await writeVaultFile('file.md', 'content')
    await captureUserSnapshot(tmpDir, ['file.md'], 'user-trash')

    const turns = await listTurns(tmpDir)
    expect(turns.some((m) => m.turnId === USER_BUCKET_ID)).toBe(false)
    expect(turns.some((m) => m.turnId === turnId)).toBe(true)
  })

  it('gc does not trash or remove the _user bucket directory', async () => {
    const { shell } = await import('electron')
    const trashSpy = vi.mocked(shell.trashItem)
    trashSpy.mockClear()

    // Create an AI turn that will be expired by the aggressive policy below
    const expiredId = newTurnId()
    await writeSnapshot(tmpDir, expiredId, 'a.md', 'content', 'file:write')
    // Backdate so maxAgeDays=0 expires it
    const manifestFile = path.join(tmpDir, '.marvin', 'snapshots', expiredId, '_manifest.json')
    const m = JSON.parse(await fs.readFile(manifestFile, 'utf8'))
    m.createdAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()
    await fs.writeFile(manifestFile, JSON.stringify(m), 'utf8')

    // Also create a user capture
    await writeVaultFile('a.md', 'content')
    await captureUserSnapshot(tmpDir, ['a.md'], 'user-trash')

    await gc(tmpDir, { maxTurns: 0, maxAgeDays: 0, maxBytes: 0 })

    // The _user bucket dir must NOT have been passed to trashItem
    const trashedPaths = trashSpy.mock.calls.map((c) => c[0] as string)
    const userBucketTrashed = trashedPaths.some((p) => p.includes(USER_BUCKET_ID))
    expect(userBucketTrashed).toBe(false)

    // The _user manifest must still exist
    const manifestExists = await fs
      .access(userManifestPath(tmpDir))
      .then(() => true)
      .catch(() => false)
    expect(manifestExists).toBe(true)
  })

  it('gc correctly expires old AI turns even when _user bucket exists alongside them', async () => {
    const { shell } = await import('electron')
    const trashSpy = vi.mocked(shell.trashItem)
    trashSpy.mockClear()

    const id1 = newTurnId()
    const id2 = newTurnId()
    await writeSnapshot(tmpDir, id1, 'f1.md', 'c1', 'file:write')
    await writeSnapshot(tmpDir, id2, 'f2.md', 'c2', 'file:write')

    // Create user capture
    await writeVaultFile('f1.md', 'c1')
    await captureUserSnapshot(tmpDir, ['f1.md'], 'user-trash')

    // Expire both AI turns by count
    await gc(tmpDir, { maxTurns: 0, maxAgeDays: 7, maxBytes: 200 * 1024 * 1024 })

    // Both AI turns trashed, _user bucket not touched
    const trashedPaths = trashSpy.mock.calls.map((c) => c[0] as string)
    expect(trashedPaths.some((p) => p.includes(id1))).toBe(true)
    expect(trashedPaths.some((p) => p.includes(id2))).toBe(true)
    expect(trashedPaths.some((p) => p.includes(USER_BUCKET_ID))).toBe(false)
  })

  it('all original trigger types (file:write, watcher, cascade, etc.) still work', async () => {
    const triggers = [
      'file:write',
      'watcher',
      'restore',
      'cascade',
      'buffer-save',
      'external-rejected',
    ] as const
    for (const trigger of triggers) {
      const turnId = newTurnId()
      const ok = await writeSnapshot(tmpDir, turnId, 'test.md', 'content', trigger)
      expect(ok).toBe(true)

      const turns = await listTurns(tmpDir)
      const m = turns.find((t) => t.turnId === turnId)
      expect(m?.trigger).toBe(trigger)
    }
  })

  it('writeSnapshot still rejects invalid turnId (no regression on H4 boundary)', async () => {
    const ok = await writeSnapshot(tmpDir, 'invalid-turn', 'file.md', 'content', 'file:write')
    expect(ok).toBe(false)
  })

  it('readSnapshot still throws MARVIN_INVALID_TURN_ID on traversal turnId', async () => {
    await expect(readSnapshot(tmpDir, '../../../etc/evil', 'file.md')).rejects.toThrow(
      /MARVIN_INVALID_TURN_ID/i
    )
  })

  it('restoreSnapshot still throws MARVIN_INVALID_PATH on traversal relPath', async () => {
    const turnId = newTurnId()
    await expect(restoreSnapshot(tmpDir, turnId, '../../escape.md')).rejects.toThrow(
      /MARVIN_INVALID_PATH/i
    )
  })
})
