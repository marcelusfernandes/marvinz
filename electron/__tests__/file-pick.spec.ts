/**
 * Tests for the file:pick IPC handler logic (issue #307).
 *
 * The handler lives inline in main.ts and is not exported, so these tests
 * replicate its logic directly — same pattern as vault-allowlist.spec.ts and
 * file-write-binary.spec.ts.
 *
 * Handler contract (electron/main.ts):
 *   1. No activeVaultPath → return null immediately.
 *   2. dialog.canceled or empty filePaths → return null.
 *   3. fs.realpath fails on chosen path → return null.
 *   4. chosen realpath outside vault (not prefixed by vaultPath + sep, not equal to vaultPath) → return null.
 *   5. chosen realpath inside vault → return resolvedChosen.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

// ---------------------------------------------------------------------------
// Mirror of the handler — keeps tests honest about what the real handler does
// ---------------------------------------------------------------------------

async function filePick(
  activeVaultPath: string | null,
  dialogResult: { canceled: boolean; filePaths: string[] }
): Promise<string | null> {
  if (!activeVaultPath) return null
  if (dialogResult.canceled || dialogResult.filePaths.length === 0) return null
  const chosen = dialogResult.filePaths[0]
  let resolvedChosen: string
  try {
    resolvedChosen = await fs.realpath(path.resolve(chosen))
  } catch {
    return null
  }
  if (
    !resolvedChosen.startsWith(activeVaultPath + path.sep) &&
    resolvedChosen !== activeVaultPath
  ) {
    return null
  }
  return resolvedChosen
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let vault: string
let noteFile: string

async function setup(): Promise<void> {
  const raw = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-filepick-'))
  vault = await fs.realpath(raw)
  noteFile = path.join(vault, 'note.md')
  await fs.writeFile(noteFile, '# hello')
}

async function teardown(): Promise<void> {
  await fs.rm(vault, { recursive: true, force: true })
}

// ---------------------------------------------------------------------------
// 1. No vault open → always null
// ---------------------------------------------------------------------------

describe('file:pick — no active vault', () => {
  it('returns null when activeVaultPath is null', async () => {
    await expect(
      filePick(null, { canceled: false, filePaths: ['/some/file.md'] })
    ).resolves.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 2. Dialog canceled or empty
// ---------------------------------------------------------------------------

describe('file:pick — dialog canceled / empty', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('returns null when canceled is true', async () => {
    await expect(filePick(vault, { canceled: true, filePaths: [] })).resolves.toBeNull()
  })

  it('returns null when filePaths is empty even if canceled is false', async () => {
    await expect(filePick(vault, { canceled: false, filePaths: [] })).resolves.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 3. Chosen path does not exist (realpath fails)
// ---------------------------------------------------------------------------

describe('file:pick — nonexistent chosen path', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('returns null when the chosen file does not exist on disk', async () => {
    const ghost = path.join(vault, `ghost-${Date.now()}.md`)
    await expect(filePick(vault, { canceled: false, filePaths: [ghost] })).resolves.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 4. Allowlist check — path outside vault is rejected
// ---------------------------------------------------------------------------

describe('file:pick — allowlist: outside vault', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('returns null for a real file outside the vault', async () => {
    const outside = os.tmpdir()
    await expect(filePick(vault, { canceled: false, filePaths: [outside] })).resolves.toBeNull()
  })

  it('returns null for a path that is a parent of the vault', async () => {
    const parent = path.dirname(vault)
    await expect(filePick(vault, { canceled: false, filePaths: [parent] })).resolves.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 5. Happy path — file inside vault is accepted
// ---------------------------------------------------------------------------

describe('file:pick — inside vault', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('returns the realpath for a file directly inside the vault', async () => {
    const result = await filePick(vault, { canceled: false, filePaths: [noteFile] })
    expect(result).toBe(noteFile)
  })

  it('resolves symlinks before the allowlist check — symlinked file inside vault is accepted', async () => {
    const symlink = path.join(vault, `sym-${Date.now()}.md`)
    await fs.symlink(noteFile, symlink)
    const result = await filePick(vault, { canceled: false, filePaths: [symlink] })
    expect(result).toBe(noteFile)
  })

  it('returns the realpath for a file in a subdirectory', async () => {
    const subDir = path.join(vault, 'subdir')
    await fs.mkdir(subDir)
    const subFile = path.join(subDir, 'child.md')
    await fs.writeFile(subFile, '# child')
    const result = await filePick(vault, { canceled: false, filePaths: [subFile] })
    expect(result).toBe(subFile)
  })
})
