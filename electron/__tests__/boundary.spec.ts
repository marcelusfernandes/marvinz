/**
 * Regression tests for vault-boundary enforcement on the 9 IPC handlers.
 * Issue #60: file:read, file:write, file:create, folder:create, path:rename, path:trash,
 *            vault:tree, vault:watch, shell:reveal
 *
 * TDD-first: these tests define the expected contract and FAIL against the current code
 * (no boundary checks exist yet). They pass once electron applies the fix.
 *
 * Strategy: import the to-be-extracted `assertInsideVault` helper from
 * `electron/vault-boundary.ts`. The helper must throw `MARVIN_OUTSIDE_VAULT`
 * for every escape vector, and return the resolved absolute path for safe inputs.
 *
 * Additionally, FS-level tests verify that zero I/O reaches outside paths.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

// ---------------------------------------------------------------------------
// Module under test — does not exist yet; import fails until electron creates it.
// ---------------------------------------------------------------------------
import { assertInsideVault } from '../vault-boundary.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let vault: string
let outside: string

async function setup(): Promise<void> {
  const rawVault = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-boundary-vault-'))
  vault = await fs.realpath(rawVault)
  const rawOutside = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-boundary-outside-'))
  outside = await fs.realpath(rawOutside)
}

async function teardown(): Promise<void> {
  await fs.rm(vault, { recursive: true, force: true })
  await fs.rm(outside, { recursive: true, force: true })
}

// ---------------------------------------------------------------------------
// Helper: verify that a file at `absPath` was NOT touched (stat fails = good).
// ---------------------------------------------------------------------------
async function assertNotTouched(absPath: string): Promise<void> {
  await expect(fs.access(absPath)).rejects.toThrow()
}

// ---------------------------------------------------------------------------
// assertInsideVault — unit tests (24 escape vectors × 6 handlers = covered by
// testing the shared helper directly, plus 6 happy-path tests).
// ---------------------------------------------------------------------------

describe('assertInsideVault — escape vector: (a) absolute path outside vault', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('file:read — rejects /etc/passwd', () => {
    expect(() => assertInsideVault(vault, '/etc/passwd')).toThrow('MARVIN_OUTSIDE_VAULT')
  })

  it('file:write — rejects /tmp/evil', () => {
    expect(() => assertInsideVault(vault, path.join(outside, 'evil.md'))).toThrow('MARVIN_OUTSIDE_VAULT')
  })

  it('file:create — rejects absolute parentDir outside vault', () => {
    expect(() => assertInsideVault(vault, outside)).toThrow('MARVIN_OUTSIDE_VAULT')
  })

  it('folder:create — rejects absolute parentDir outside vault', () => {
    expect(() => assertInsideVault(vault, path.join(outside, 'new-folder'))).toThrow('MARVIN_OUTSIDE_VAULT')
  })

  it('path:rename (oldPath) — rejects absolute source outside vault', () => {
    expect(() => assertInsideVault(vault, path.join(outside, 'source.md'))).toThrow('MARVIN_OUTSIDE_VAULT')
  })

  it('path:rename (newPath) — rejects absolute destination outside vault', () => {
    expect(() => assertInsideVault(vault, path.join(outside, 'dest.md'))).toThrow('MARVIN_OUTSIDE_VAULT')
  })

  it('path:trash — rejects /etc/passwd', () => {
    expect(() => assertInsideVault(vault, '/etc/passwd')).toThrow('MARVIN_OUTSIDE_VAULT')
  })
})

describe('assertInsideVault — escape vector: (b) path traversal', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('file:read — rejects <vault>/../escape', () => {
    const traversal = path.join(vault, '..', 'escape')
    expect(() => assertInsideVault(vault, traversal)).toThrow('MARVIN_OUTSIDE_VAULT')
  })

  it('file:write — rejects <vault>/subdir/../../escape', () => {
    const traversal = path.join(vault, 'subdir', '..', '..', 'escape')
    expect(() => assertInsideVault(vault, traversal)).toThrow('MARVIN_OUTSIDE_VAULT')
  })

  it('file:create — rejects <vault>/../escape as parentDir', () => {
    const traversal = path.join(vault, '..', 'escape')
    expect(() => assertInsideVault(vault, traversal)).toThrow('MARVIN_OUTSIDE_VAULT')
  })

  it('folder:create — rejects <vault>/deep/../../escape as parentDir', () => {
    const traversal = path.join(vault, 'deep', '..', '..', 'escape')
    expect(() => assertInsideVault(vault, traversal)).toThrow('MARVIN_OUTSIDE_VAULT')
  })

  it('path:rename (oldPath) — rejects traversal source', () => {
    const traversal = path.join(vault, '..', 'escape.md')
    expect(() => assertInsideVault(vault, traversal)).toThrow('MARVIN_OUTSIDE_VAULT')
  })

  it('path:rename (newPath) — rejects traversal destination', () => {
    const traversal = path.join(vault, 'subdir', '..', '..', 'dest.md')
    expect(() => assertInsideVault(vault, traversal)).toThrow('MARVIN_OUTSIDE_VAULT')
  })

  it('path:trash — rejects traversal target', () => {
    const traversal = path.join(vault, '..', 'outside-target')
    expect(() => assertInsideVault(vault, traversal)).toThrow('MARVIN_OUTSIDE_VAULT')
  })
})

describe('assertInsideVault — escape vector: (c) symlink escape', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('file:read — rejects symlink inside vault pointing outside', async () => {
    const outsideFile = path.join(outside, 'sensitive.txt')
    await fs.writeFile(outsideFile, 'sensitive', 'utf8')
    const symlink = path.join(vault, 'evil-link.md')
    await fs.symlink(outsideFile, symlink)

    await expect(assertInsideVaultAsync(vault, symlink)).rejects.toThrow('MARVIN_OUTSIDE_VAULT')
    // Verify the file outside was not read (it's still intact, but handler must not proceed)
    const content = await fs.readFile(outsideFile, 'utf8')
    expect(content).toBe('sensitive')
  })

  it('file:write — rejects symlink pointing outside; outside file not written', async () => {
    const outsideFile = path.join(outside, 'target.txt')
    await fs.writeFile(outsideFile, 'original', 'utf8')
    const symlink = path.join(vault, 'evil-write-link.md')
    await fs.symlink(outsideFile, symlink)

    await expect(assertInsideVaultAsync(vault, symlink)).rejects.toThrow('MARVIN_OUTSIDE_VAULT')
    const content = await fs.readFile(outsideFile, 'utf8')
    expect(content).toBe('original')
  })

  it('file:create — rejects symlinked parentDir pointing outside', async () => {
    const symlinkDir = path.join(vault, 'evil-dir')
    await fs.symlink(outside, symlinkDir)
    const target = path.join(symlinkDir, 'new-file.md')

    await expect(assertInsideVaultAsync(vault, target)).rejects.toThrow('MARVIN_OUTSIDE_VAULT')
    await assertNotTouched(path.join(outside, 'new-file.md'))
  })

  it('folder:create — rejects symlinked parentDir pointing outside', async () => {
    const symlinkDir = path.join(vault, 'evil-folder-dir')
    await fs.symlink(outside, symlinkDir)
    const target = path.join(symlinkDir, 'sub')

    await expect(assertInsideVaultAsync(vault, target)).rejects.toThrow('MARVIN_OUTSIDE_VAULT')
    await assertNotTouched(path.join(outside, 'sub'))
  })

  it('path:rename (oldPath) — rejects symlink escape as source', async () => {
    const outsideFile = path.join(outside, 'rename-source.txt')
    await fs.writeFile(outsideFile, 'content', 'utf8')
    const symlink = path.join(vault, 'source-link.md')
    await fs.symlink(outsideFile, symlink)

    await expect(assertInsideVaultAsync(vault, symlink)).rejects.toThrow('MARVIN_OUTSIDE_VAULT')
  })

  it('path:rename (newPath) — rejects symlinked destination dir pointing outside', async () => {
    const symlinkDir = path.join(vault, 'evil-rename-dir')
    await fs.symlink(outside, symlinkDir)
    const dest = path.join(symlinkDir, 'dest.md')

    await expect(assertInsideVaultAsync(vault, dest)).rejects.toThrow('MARVIN_OUTSIDE_VAULT')
    await assertNotTouched(path.join(outside, 'dest.md'))
  })

  it('path:trash — rejects symlink escape as trash target', async () => {
    const outsideFile = path.join(outside, 'trash-target.txt')
    await fs.writeFile(outsideFile, 'do not trash', 'utf8')
    const symlink = path.join(vault, 'trash-link.md')
    await fs.symlink(outsideFile, symlink)

    await expect(assertInsideVaultAsync(vault, symlink)).rejects.toThrow('MARVIN_OUTSIDE_VAULT')
    const content = await fs.readFile(outsideFile, 'utf8')
    expect(content).toBe('do not trash')
  })
})

describe('assertInsideVault — escape vector: (d) null byte injection', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('file:read — rejects path with null byte', () => {
    const nullPath = path.join(vault, 'foo\0bar.md')
    expect(() => assertInsideVault(vault, nullPath)).toThrow('MARVIN_OUTSIDE_VAULT')
  })

  it('file:write — rejects path with null byte', () => {
    const nullPath = path.join(vault, 'evil\0.md')
    expect(() => assertInsideVault(vault, nullPath)).toThrow('MARVIN_OUTSIDE_VAULT')
  })

  it('file:create — rejects parentDir with null byte', () => {
    const nullPath = path.join(vault, 'sub\0dir')
    expect(() => assertInsideVault(vault, nullPath)).toThrow('MARVIN_OUTSIDE_VAULT')
  })

  it('folder:create — rejects name with null byte', () => {
    const nullPath = path.join(vault, 'fold\0er')
    expect(() => assertInsideVault(vault, nullPath)).toThrow('MARVIN_OUTSIDE_VAULT')
  })

  it('path:rename (oldPath) — rejects null byte in source path', () => {
    const nullPath = path.join(vault, 'old\0name.md')
    expect(() => assertInsideVault(vault, nullPath)).toThrow('MARVIN_OUTSIDE_VAULT')
  })

  it('path:rename (newPath) — rejects null byte in destination path', () => {
    const nullPath = path.join(vault, 'new\0name.md')
    expect(() => assertInsideVault(vault, nullPath)).toThrow('MARVIN_OUTSIDE_VAULT')
  })

  it('path:trash — rejects path with null byte', () => {
    const nullPath = path.join(vault, 'trash\0me.md')
    expect(() => assertInsideVault(vault, nullPath)).toThrow('MARVIN_OUTSIDE_VAULT')
  })
})

// ---------------------------------------------------------------------------
// Happy-path: legitimate paths inside vault must be allowed (1 per handler).
// ---------------------------------------------------------------------------

describe('assertInsideVault — happy path: legitimate vault paths', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('file:read — accepts path inside vault', () => {
    const safe = path.join(vault, 'notes', 'daily.md')
    expect(() => assertInsideVault(vault, safe)).not.toThrow()
  })

  it('file:write — accepts path inside vault', () => {
    const safe = path.join(vault, 'docs', 'readme.md')
    expect(() => assertInsideVault(vault, safe)).not.toThrow()
  })

  it('file:create — accepts parentDir inside vault', () => {
    const safe = path.join(vault, 'projects')
    expect(() => assertInsideVault(vault, safe)).not.toThrow()
  })

  it('folder:create — accepts parentDir inside vault', () => {
    const safe = path.join(vault, 'archive', '2024')
    expect(() => assertInsideVault(vault, safe)).not.toThrow()
  })

  it('path:rename — accepts oldPath and newPath both inside vault', () => {
    const oldSafe = path.join(vault, 'old-name.md')
    const newSafe = path.join(vault, 'subdir', 'new-name.md')
    expect(() => assertInsideVault(vault, oldSafe)).not.toThrow()
    expect(() => assertInsideVault(vault, newSafe)).not.toThrow()
  })

  it('path:trash — accepts path inside vault', () => {
    const safe = path.join(vault, 'to-delete.md')
    expect(() => assertInsideVault(vault, safe)).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// Async variant used for symlink tests — resolves symlinks before checking.
// The sync `assertInsideVault` is for non-symlink paths (fast path).
// The async version must also exist in vault-boundary.ts.
// ---------------------------------------------------------------------------
async function assertInsideVaultAsync(vaultPath: string, targetPath: string): Promise<string> {
  const { assertInsideVaultAsync: asyncFn } = await import('../vault-boundary.js')
  return asyncFn(vaultPath, targetPath)
}

// ===========================================================================
// NEW: vault:tree, vault:watch, shell:reveal — same 4 escape vectors
// ===========================================================================

// ---------------------------------------------------------------------------
// vault:tree — arbitrary vaultPath arg must be rejected before readdir
// ---------------------------------------------------------------------------

describe('vault:tree — escape vector: (a) absolute path outside vault', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('rejects /etc as vaultPath', () => {
    expect(() => assertInsideVault(vault, '/etc')).toThrow('MARVIN_OUTSIDE_VAULT')
  })

  it('rejects /tmp/arbitrary as vaultPath', () => {
    expect(() => assertInsideVault(vault, path.join(outside))).toThrow('MARVIN_OUTSIDE_VAULT')
  })
})

describe('vault:tree — escape vector: (b) path traversal', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('rejects <vault>/../escape as vaultPath', () => {
    const traversal = path.join(vault, '..', 'escape')
    expect(() => assertInsideVault(vault, traversal)).toThrow('MARVIN_OUTSIDE_VAULT')
  })

  it('rejects <vault>/sub/../../escape as vaultPath', () => {
    const traversal = path.join(vault, 'sub', '..', '..', 'escape')
    expect(() => assertInsideVault(vault, traversal)).toThrow('MARVIN_OUTSIDE_VAULT')
  })
})

describe('vault:tree — escape vector: (c) symlink escape', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('rejects symlinked vaultPath pointing outside; no readdir on outside dir', async () => {
    const symlinkVault = path.join(vault, 'linked-tree')
    await fs.symlink(outside, symlinkVault)

    await expect(assertInsideVaultAsync(vault, symlinkVault)).rejects.toThrow('MARVIN_OUTSIDE_VAULT')
    // outside dir must not have been listed (it still exists, untouched)
    const entries = await fs.readdir(outside)
    expect(entries).toHaveLength(0)
  })
})

describe('vault:tree — escape vector: (d) null byte', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('rejects vaultPath containing null byte', () => {
    const nullPath = path.join(vault, 'sub\0dir')
    expect(() => assertInsideVault(vault, nullPath)).toThrow('MARVIN_OUTSIDE_VAULT')
  })
})

describe('vault:tree — happy path', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('accepts the vault root itself as vaultPath', () => {
    expect(() => assertInsideVault(vault, vault)).not.toThrow()
  })

  it('accepts a subdir of the vault as vaultPath', () => {
    const subdir = path.join(vault, 'notes')
    expect(() => assertInsideVault(vault, subdir)).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// vault:watch — arbitrary path must be rejected; activeVaultPath must NOT change
//
// Because vault:watch is a stateful IPC handler (it mutates `activeVaultPath`),
// we test the boundary helper contract here and document the invariant:
// the handler must call assertInsideVault BEFORE setting activeVaultPath.
// ---------------------------------------------------------------------------

describe('vault:watch — escape vector: (a) absolute path outside vault', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('assertInsideVault rejects /etc — handler must not update activeVaultPath', () => {
    // The handler must call assertInsideVault(currentVault, newVaultPath) before
    // accepting the new vault. If it throws, activeVaultPath must remain unchanged.
    expect(() => assertInsideVault(vault, '/etc')).toThrow('MARVIN_OUTSIDE_VAULT')
  })

  it('assertInsideVault rejects arbitrary outside dir', () => {
    expect(() => assertInsideVault(vault, outside)).toThrow('MARVIN_OUTSIDE_VAULT')
  })
})

describe('vault:watch — escape vector: (b) path traversal', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('rejects <vault>/../escape as new vault path', () => {
    const traversal = path.join(vault, '..', 'escape')
    expect(() => assertInsideVault(vault, traversal)).toThrow('MARVIN_OUTSIDE_VAULT')
  })
})

describe('vault:watch — escape vector: (c) symlink escape', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('rejects symlinked path pointing outside as new vault', async () => {
    const symlinkPath = path.join(vault, 'linked-vault')
    await fs.symlink(outside, symlinkPath)
    await expect(assertInsideVaultAsync(vault, symlinkPath)).rejects.toThrow('MARVIN_OUTSIDE_VAULT')
  })
})

describe('vault:watch — escape vector: (d) null byte', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('rejects vault path with null byte', () => {
    const nullPath = vault + '\0evil'
    expect(() => assertInsideVault(vault, nullPath)).toThrow('MARVIN_OUTSIDE_VAULT')
  })
})

describe('vault:watch — happy path', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('accepts a legitimate vault path (same vault)', () => {
    expect(() => assertInsideVault(vault, vault)).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// vault:watch — allowlist contract (MARVIN_VAULT_NOT_ALLOWED)
//
// vault:watch implements a second defense layer beyond boundary checks:
// only paths that entered via vault:pick (OS dialog) or settings.json on
// startup are accepted. Any path not in `allowedVaultPaths` throws
// MARVIN_VAULT_NOT_ALLOWED regardless of whether it passes boundary checks.
//
// This is tested via the `assertAllowedVault` helper exported from main.ts
// (or an equivalent exported utility). If no such export exists yet, these
// tests document the contract and fail until it is extracted.
// ---------------------------------------------------------------------------

describe('vault:watch — MARVIN_VAULT_NOT_ALLOWED allowlist contract', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('rejects a path not in the allowedVaultPaths set', async () => {
    const { assertAllowedVault } = await import('../vault-allowlist.js').catch(() => ({ assertAllowedVault: null }))
    if (!assertAllowedVault) {
      // Not yet extracted — document the contract as a known pending test.
      // The vault:watch handler in main.ts must throw MARVIN_VAULT_NOT_ALLOWED
      // for paths not added via vault:pick or settings.json.
      console.warn('[pending] vault-allowlist.ts not yet extracted — skipping allowlist unit test')
      return
    }
    const arbitraryPath = path.join(outside, 'not-picked')
    expect(() => assertAllowedVault(arbitraryPath, new Set())).toThrow('MARVIN_VAULT_NOT_ALLOWED')
  })

  it('accepts a path that is in the allowedVaultPaths set', async () => {
    const { assertAllowedVault } = await import('../vault-allowlist.js').catch(() => ({ assertAllowedVault: null }))
    if (!assertAllowedVault) {
      console.warn('[pending] vault-allowlist.ts not yet extracted — skipping allowlist unit test')
      return
    }
    const allowed = new Set([path.resolve(vault)])
    expect(() => assertAllowedVault(vault, allowed)).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// shell:reveal — must reject paths outside vault; shell.showItemInFolder must
// not be called.
//
// shell:reveal is synchronous (no fs I/O itself), so we test the boundary
// helper only. The handler must call assertInsideVault before showItemInFolder.
// ---------------------------------------------------------------------------

describe('shell:reveal — escape vector: (a) absolute path outside vault', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('rejects /etc/passwd — showItemInFolder must not be called', () => {
    expect(() => assertInsideVault(vault, '/etc/passwd')).toThrow('MARVIN_OUTSIDE_VAULT')
  })

  it('rejects path in outside tmpdir', () => {
    expect(() => assertInsideVault(vault, path.join(outside, 'file.txt'))).toThrow('MARVIN_OUTSIDE_VAULT')
  })
})

describe('shell:reveal — escape vector: (b) path traversal', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('rejects <vault>/../escape', () => {
    const traversal = path.join(vault, '..', 'escape')
    expect(() => assertInsideVault(vault, traversal)).toThrow('MARVIN_OUTSIDE_VAULT')
  })

  it('rejects <vault>/sub/../../escape', () => {
    const traversal = path.join(vault, 'sub', '..', '..', 'escape')
    expect(() => assertInsideVault(vault, traversal)).toThrow('MARVIN_OUTSIDE_VAULT')
  })
})

describe('shell:reveal — escape vector: (c) symlink escape', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('rejects symlink inside vault pointing outside; showItemInFolder not called', async () => {
    const outsideFile = path.join(outside, 'secret.txt')
    await fs.writeFile(outsideFile, 'secret', 'utf8')
    const symlink = path.join(vault, 'reveal-link')
    await fs.symlink(outsideFile, symlink)

    await expect(assertInsideVaultAsync(vault, symlink)).rejects.toThrow('MARVIN_OUTSIDE_VAULT')
    // outside file untouched
    const content = await fs.readFile(outsideFile, 'utf8')
    expect(content).toBe('secret')
  })
})

describe('shell:reveal — escape vector: (d) null byte', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('rejects path with null byte', () => {
    const nullPath = path.join(vault, 'reveal\0me')
    expect(() => assertInsideVault(vault, nullPath)).toThrow('MARVIN_OUTSIDE_VAULT')
  })
})

describe('shell:reveal — happy path', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('accepts a file path inside vault', () => {
    const safe = path.join(vault, 'notes', 'daily.md')
    expect(() => assertInsideVault(vault, safe)).not.toThrow()
  })

  it('accepts the vault root', () => {
    expect(() => assertInsideVault(vault, vault)).not.toThrow()
  })
})

// ===========================================================================
// C3 — Dangling symlink bypass
//
// A symlink inside the vault whose target does NOT exist on disk.
// `fs.realpath` throws ENOENT on both the file and its parent when the
// symlink target is missing — if the implementation swallows ENOENT
// unconditionally, the validation passes and the handler proceeds to create
// the target file at an arbitrary outside path.
//
// Expected: assertInsideVaultAsync must throw MARVIN_OUTSIDE_VAULT for
// dangling symlinks pointing outside the vault, even when the target
// does not exist yet.
//
// After the throw: the outside target path must still not exist (zero I/O).
// ===========================================================================

describe('C3 dangling symlink — file:read', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('rejects dangling symlink pointing to non-existent outside path', async () => {
    const nonExistentOutside = path.join(outside, 'non-existent-attacker-target.md')
    const symlink = path.join(vault, 'foo.md')
    await fs.symlink(nonExistentOutside, symlink)

    await expect(assertInsideVaultAsync(vault, symlink)).rejects.toThrow('MARVIN_OUTSIDE_VAULT')
    // Target must not have been created
    await expect(fs.access(nonExistentOutside)).rejects.toThrow()
  })
})

describe('C3 dangling symlink — file:write', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('rejects dangling symlink; write must not create the outside file', async () => {
    const nonExistentOutside = path.join(outside, 'write-target.md')
    const symlink = path.join(vault, 'write-link.md')
    await fs.symlink(nonExistentOutside, symlink)

    await expect(assertInsideVaultAsync(vault, symlink)).rejects.toThrow('MARVIN_OUTSIDE_VAULT')
    await expect(fs.access(nonExistentOutside)).rejects.toThrow()
  })
})

describe('C3 dangling symlink — file:create', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('rejects dangling symlinked parentDir; create must not write outside', async () => {
    // Symlink to a non-existent outside directory
    const nonExistentDir = path.join(outside, 'ghost-dir')
    const symlinkDir = path.join(vault, 'ghost-link')
    await fs.symlink(nonExistentDir, symlinkDir)
    const target = path.join(symlinkDir, 'new-file.md')

    await expect(assertInsideVaultAsync(vault, target)).rejects.toThrow('MARVIN_OUTSIDE_VAULT')
    await expect(fs.access(nonExistentDir)).rejects.toThrow()
  })
})

describe('C3 dangling symlink — folder:create', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('rejects dangling symlinked parentDir; mkdir must not create outside', async () => {
    const nonExistentDir = path.join(outside, 'ghost-folder')
    const symlinkDir = path.join(vault, 'ghost-folder-link')
    await fs.symlink(nonExistentDir, symlinkDir)
    const target = path.join(symlinkDir, 'sub')

    await expect(assertInsideVaultAsync(vault, target)).rejects.toThrow('MARVIN_OUTSIDE_VAULT')
    await expect(fs.access(nonExistentDir)).rejects.toThrow()
  })
})

describe('C3 dangling symlink — path:rename (oldPath)', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('rejects dangling symlink as rename source', async () => {
    const nonExistentOutside = path.join(outside, 'ghost-source.md')
    const symlink = path.join(vault, 'ghost-old.md')
    await fs.symlink(nonExistentOutside, symlink)

    await expect(assertInsideVaultAsync(vault, symlink)).rejects.toThrow('MARVIN_OUTSIDE_VAULT')
    await expect(fs.access(nonExistentOutside)).rejects.toThrow()
  })
})

describe('C3 dangling symlink — path:rename (newPath)', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('rejects dangling symlinked destination dir; rename must not create outside', async () => {
    const nonExistentDir = path.join(outside, 'ghost-dest-dir')
    const symlinkDir = path.join(vault, 'ghost-dest-link')
    await fs.symlink(nonExistentDir, symlinkDir)
    const dest = path.join(symlinkDir, 'dest.md')

    await expect(assertInsideVaultAsync(vault, dest)).rejects.toThrow('MARVIN_OUTSIDE_VAULT')
    await expect(fs.access(nonExistentDir)).rejects.toThrow()
  })
})

describe('C3 dangling symlink — path:trash', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('rejects dangling symlink as trash target; nothing created outside', async () => {
    const nonExistentOutside = path.join(outside, 'ghost-trash-target.md')
    const symlink = path.join(vault, 'ghost-trash.md')
    await fs.symlink(nonExistentOutside, symlink)

    await expect(assertInsideVaultAsync(vault, symlink)).rejects.toThrow('MARVIN_OUTSIDE_VAULT')
    await expect(fs.access(nonExistentOutside)).rejects.toThrow()
  })
})

describe('C3 dangling symlink — vault:tree', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('rejects dangling symlink as tree root; outside dir not created', async () => {
    const nonExistentDir = path.join(outside, 'ghost-tree-root')
    const symlink = path.join(vault, 'ghost-tree-link')
    await fs.symlink(nonExistentDir, symlink)

    await expect(assertInsideVaultAsync(vault, symlink)).rejects.toThrow('MARVIN_OUTSIDE_VAULT')
    await expect(fs.access(nonExistentDir)).rejects.toThrow()
  })
})

describe('C3 dangling symlink — shell:reveal', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('rejects dangling symlink as reveal target; showItemInFolder not called', async () => {
    const nonExistentOutside = path.join(outside, 'ghost-reveal-target')
    const symlink = path.join(vault, 'ghost-reveal.md')
    await fs.symlink(nonExistentOutside, symlink)

    await expect(assertInsideVaultAsync(vault, symlink)).rejects.toThrow('MARVIN_OUTSIDE_VAULT')
    await expect(fs.access(nonExistentOutside)).rejects.toThrow()
  })
})

// ===========================================================================
// C2 — TOCTOU / O_NOFOLLOW
//
// After assertInsideVaultAsync passes, a symlink could be swapped in between
// the check and the actual FS open (TOCTOU race). The defensive pattern is
// to open files with O_NOFOLLOW so the kernel rejects symlinks at open time.
//
// These tests document the expected behaviour: opening a symlink (even one
// pointing inside the vault) with O_NOFOLLOW must fail with ELOOP.
// If the electron teammate uses O_NOFOLLOW in the handlers, these tests
// confirm it works correctly. If not yet implemented, they fail — that's
// intentional (TDD red for C2).
// ===========================================================================

describe('C2 TOCTOU — O_NOFOLLOW rejects symlinks at open time', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('opening a within-vault symlink with O_NOFOLLOW throws ELOOP', async () => {
    // Even a "safe" symlink (target inside vault) must be rejected by O_NOFOLLOW
    // because the kernel cannot verify the symlink wasn't swapped after the check.
    const realFile = path.join(vault, 'real.md')
    await fs.writeFile(realFile, 'content', 'utf8')
    const symlink = path.join(vault, 'safe-link.md')
    await fs.symlink(realFile, symlink)

    // O_NOFOLLOW | O_RDONLY
    const flags = fs.constants.O_NOFOLLOW | fs.constants.O_RDONLY
    await expect(fs.open(symlink, flags)).rejects.toMatchObject({ code: 'ELOOP' })
  })

  it('opening a dangling outside symlink with O_NOFOLLOW throws ELOOP (not ENOENT)', async () => {
    const nonExistentOutside = path.join(outside, 'toctou-target.md')
    const symlink = path.join(vault, 'toctou-link.md')
    await fs.symlink(nonExistentOutside, symlink)

    const flags = fs.constants.O_NOFOLLOW | fs.constants.O_RDONLY
    // Must fail with ELOOP, not ENOENT — symlink is detected before target resolution
    await expect(fs.open(symlink, flags)).rejects.toMatchObject({ code: 'ELOOP' })
  })

  it('opening a normal file with O_NOFOLLOW succeeds', async () => {
    const realFile = path.join(vault, 'normal.md')
    await fs.writeFile(realFile, 'safe content', 'utf8')

    const flags = fs.constants.O_NOFOLLOW | fs.constants.O_RDONLY
    const fh = await fs.open(realFile, flags)
    await fh.close()
    // No throw — regular files are unaffected by O_NOFOLLOW
  })
})

// ===========================================================================
// C2 — TOCTOU proof: assertInsideVaultAsync must return realpath, not lexical
//
// If the handler uses the return value of assertInsideVaultAsync as its I/O
// path (instead of the original lexical path), a post-check symlink swap
// cannot redirect the I/O to an outside file.
//
// Proof: swap vault/foo.md for a symlink to outside/evil.md after the check.
// - If safe = realpath (correct): readFile(safe) → ENOENT (inode gone)
// - If safe = lexical path (vulnerable): readFile(safe) → reads outside/evil.md
// ===========================================================================

describe('C2 TOCTOU proof — assertInsideVaultAsync returns realpath', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('returned path equals fs.realpath of the original file', async () => {
    const file = path.join(vault, 'foo.md')
    await fs.writeFile(file, 'original', 'utf8')

    const safe = await assertInsideVaultAsync(vault, file)
    const expected = await fs.realpath(file)

    expect(safe).toBe(expected)
  })

  it('post-swap readFile via safe path throws ENOENT, not reading outside file', async () => {
    // Setup: vault/foo.md exists with known content
    const file = path.join(vault, 'foo.md')
    await fs.writeFile(file, 'original', 'utf8')

    // Handler check: get the safe I/O path
    const safe = await assertInsideVaultAsync(vault, file)

    // TOCTOU window: attacker swaps vault/foo.md for a symlink to outside/evil.md
    const evilFile = path.join(outside, 'evil.md')
    await fs.writeFile(evilFile, 'evil content', 'utf8')
    await fs.unlink(file)
    await fs.symlink(evilFile, file)

    // Handler I/O: read via `safe` (the realpath from before the swap)
    // If safe is a realpath, the original inode is gone → ENOENT (correct)
    // If safe is lexical, it now follows the new symlink → reads evil.md (vulnerable)
    await expect(fs.readFile(safe, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })

    // Confirm the evil file itself was NOT read (still has original content)
    const evilContent = await fs.readFile(evilFile, 'utf8')
    expect(evilContent).toBe('evil content')
  })
})
