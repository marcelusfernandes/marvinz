import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

import { assertRenameTargetAvailable, isCaseOnlyPath, isSameFile } from '../fs-rename-guard.js'

// ---------------------------------------------------------------------------
// assertRenameTargetAvailable — real filesystem, reproduces the #562 bug
// ---------------------------------------------------------------------------

let dir: string

async function setup(): Promise<void> {
  const raw = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-rename-guard-'))
  dir = await fs.realpath(raw)
}

async function teardown(): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true })
}

describe('assertRenameTargetAvailable — case-only rename (#562)', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('allows a case-only rename target on a case-insensitive filesystem', async () => {
    // On default case-insensitive volumes (APFS/NTFS), 'Notes.md' resolves to
    // the same inode as 'notes.md' — this is not a real collision.
    const oldPath = path.join(dir, 'notes.md')
    const newPath = path.join(dir, 'Notes.md')
    await fs.writeFile(oldPath, 'content', 'utf8')

    await expect(assertRenameTargetAvailable(oldPath, newPath)).resolves.toBeUndefined()

    // Confirm the guard doesn't just happen to pass — the actual rename works too.
    await fs.rename(oldPath, newPath)
    expect(await fs.readFile(newPath, 'utf8')).toBe('content')
  })

  it('rejects a genuine collision with a different existing file', async () => {
    const oldPath = path.join(dir, 'notes.md')
    const collidingPath = path.join(dir, 'README.md')
    await fs.writeFile(oldPath, 'content', 'utf8')
    await fs.writeFile(collidingPath, 'other content', 'utf8')

    await expect(assertRenameTargetAvailable(oldPath, collidingPath)).rejects.toThrow(
      'MARVIN_FS_EEXIST'
    )
    expect(await fs.readFile(collidingPath, 'utf8')).toBe('other content')
  })

  it('allows the rename when the target does not exist at all', async () => {
    const oldPath = path.join(dir, 'notes.md')
    const newPath = path.join(dir, 'renamed.md')
    await fs.writeFile(oldPath, 'content', 'utf8')

    await expect(assertRenameTargetAvailable(oldPath, newPath)).resolves.toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// isCaseOnlyPath — pure string comparison
// ---------------------------------------------------------------------------

describe('isCaseOnlyPath', () => {
  it('is true for paths differing only in case', () => {
    expect(isCaseOnlyPath('/vault/notes.md', '/vault/Notes.md')).toBe(true)
  })

  it('is false for identical paths', () => {
    expect(isCaseOnlyPath('/vault/notes.md', '/vault/notes.md')).toBe(false)
  })

  it('is false for a different basename regardless of case', () => {
    expect(isCaseOnlyPath('/vault/notes.md', '/vault/README.md')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// isSameFile — the safety net against the case-sensitive-volume trap: two
// different files can share a lowercase path shape, so string equality alone
// (isCaseOnlyPath) must never be the sole gate — inode+device identity is.
// This is synthetic because the two-distinct-files-same-lowercase-name case
// is not reproducible on this machine's case-insensitive APFS volume.
// ---------------------------------------------------------------------------

describe('isSameFile', () => {
  it('is true when inode and device both match', () => {
    expect(isSameFile({ ino: 42, dev: 1 }, { ino: 42, dev: 1 })).toBe(true)
  })

  it('is false when the inode differs (distinct files, same-shaped path)', () => {
    expect(isSameFile({ ino: 42, dev: 1 }, { ino: 43, dev: 1 })).toBe(false)
  })

  it('is false when the device differs even if the inode number matches', () => {
    expect(isSameFile({ ino: 42, dev: 1 }, { ino: 42, dev: 2 })).toBe(false)
  })
})
