/**
 * Integration tests for vault-allowlist.ts (assertAllowedVault) and the
 * vault:watch allowlist check pattern introduced in commits d3cb1ca + 46a8b78.
 *
 * vault-allowlist.ts is intentionally stateless: it exports one pure function
 * assertAllowedVault(path, Set). main.ts owns the allowedVaultPaths Set and
 * passes it at each call site.
 *
 * These tests:
 *  1. Verify assertAllowedVault contract directly (unit).
 *  2. Simulate the full vault:pick → allowlist → vault:watch flow using real
 *     temp dirs and symlinks — no Electron IPC needed.
 *
 * Issues: #63 (symlink realpath), #66 (allowlist enforcement).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { assertAllowedVault } from '../vault-allowlist.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string

async function setup(): Promise<void> {
  const raw = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-allowlist-'))
  tmpDir = await fs.realpath(raw)
}

async function teardown(): Promise<void> {
  await fs.rm(tmpDir, { recursive: true, force: true })
}

// Replicates what vault:pick/bootstrap does: fs.realpath → add to set.
// Returns null on ENOENT (mirrors the skip-allowlist behavior in d3cb1ca).
async function simulateVaultPick(
  vaultPath: string,
  allowedSet: Set<string>
): Promise<string | null> {
  let resolved: string
  try {
    resolved = await fs.realpath(path.resolve(vaultPath))
  } catch {
    return null
  }
  allowedSet.add(resolved)
  return resolved
}

// Replicates what vault:watch does: fs.realpath → assertAllowedVault (46a8b78).
// Throws MARVIN_VAULT_NOT_ALLOWED on ENOENT or if not in allowlist.
async function simulateVaultWatch(vaultPath: string, allowedSet: Set<string>): Promise<string> {
  let resolved: string
  try {
    resolved = await fs.realpath(path.resolve(vaultPath))
  } catch {
    throw new Error('MARVIN_VAULT_NOT_ALLOWED')
  }
  assertAllowedVault(resolved, allowedSet)
  return resolved
}

// ---------------------------------------------------------------------------
// assertAllowedVault — pure function contract
// ---------------------------------------------------------------------------

describe('assertAllowedVault — empty set rejects everything', () => {
  it('rejects root path', () => {
    expect(() => assertAllowedVault('/', new Set())).toThrow('MARVIN_VAULT_NOT_ALLOWED')
  })

  it('rejects an arbitrary absolute path', () => {
    expect(() => assertAllowedVault('/some/path', new Set())).toThrow('MARVIN_VAULT_NOT_ALLOWED')
  })
})

describe('assertAllowedVault — path in set', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('accepts a path present in the set', () => {
    expect(() => assertAllowedVault(tmpDir, new Set([tmpDir]))).not.toThrow()
  })

  it('accepts one of multiple paths in the set', () => {
    const other = path.join(os.tmpdir(), 'other-vault')
    expect(() => assertAllowedVault(tmpDir, new Set([other, tmpDir]))).not.toThrow()
  })

  it('resolves path traversal before checking — accepts when traversal resolves to registered path', () => {
    // path.join(tmpDir, 'sub', '..') === tmpDir after resolve
    const withTraversal = path.join(tmpDir, 'sub', '..')
    expect(() => assertAllowedVault(withTraversal, new Set([tmpDir]))).not.toThrow()
  })
})

describe('assertAllowedVault — path not in set', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('rejects a path not in the set', () => {
    const other = path.join(os.tmpdir(), 'other-vault')
    expect(() => assertAllowedVault(tmpDir, new Set([other]))).toThrow('MARVIN_VAULT_NOT_ALLOWED')
  })

  it('rejects a child path — allowlist is exact-match only', () => {
    const child = path.join(tmpDir, 'subdir')
    expect(() => assertAllowedVault(child, new Set([tmpDir]))).toThrow('MARVIN_VAULT_NOT_ALLOWED')
  })

  it('rejects traversal that resolves to an unregistered parent', () => {
    const traversalToParent = path.join(tmpDir, '..')
    expect(() => assertAllowedVault(traversalToParent, new Set([tmpDir]))).toThrow(
      'MARVIN_VAULT_NOT_ALLOWED'
    )
  })
})

// ---------------------------------------------------------------------------
// vault:pick → vault:watch flow — normal vault (no symlink)
// ---------------------------------------------------------------------------

describe('vault:pick → vault:watch — normal vault, no symlink', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('pick stores realpath; watch with same path succeeds', async () => {
    const allowedSet = new Set<string>()
    await simulateVaultPick(tmpDir, allowedSet)
    await expect(simulateVaultWatch(tmpDir, allowedSet)).resolves.toBe(tmpDir)
  })

  it('watch on a path that was never picked throws MARVIN_VAULT_NOT_ALLOWED', async () => {
    const allowedSet = new Set<string>()
    await simulateVaultPick(tmpDir, allowedSet)

    const raw2 = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-other-'))
    const other = await fs.realpath(raw2)
    try {
      await expect(simulateVaultWatch(other, allowedSet)).rejects.toThrow(
        'MARVIN_VAULT_NOT_ALLOWED'
      )
    } finally {
      await fs.rm(other, { recursive: true, force: true })
    }
  })
})

// ---------------------------------------------------------------------------
// vault:pick → vault:watch — symlink vault (macOS /var → /private/var scenario)
//
// Scenario: renderer passes the lexical symlink path to vault:watch.
// vault:pick stored the realpath. vault:watch resolves its arg to realpath too.
// Both sides reach the same string → assertAllowedVault passes.
// ---------------------------------------------------------------------------

describe('vault:watch check-side realpath — symlink vault scenarios', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('symlink watch arg: both sides resolve to same realpath → watch succeeds', async () => {
    const symlinkDir = path.join(os.tmpdir(), `marvin-watch-sym-${Date.now()}`)
    await fs.symlink(tmpDir, symlinkDir)
    try {
      const allowedSet = new Set<string>()

      // vault:pick side: store realpath of symlink
      const picked = await simulateVaultPick(symlinkDir, allowedSet)
      const expectedRealpath = await fs.realpath(symlinkDir)
      expect(picked).toBe(expectedRealpath)

      // vault:watch receives the same lexical symlink path from renderer
      // It also resolves to realpath → assertAllowedVault finds it in the set
      const watched = await simulateVaultWatch(symlinkDir, allowedSet)
      expect(watched).toBe(expectedRealpath)
    } finally {
      await fs.rm(symlinkDir, { force: true })
    }
  })

  it('macOS /var→/private/var: lexical path differs from realpath; realpath comparison makes watch pass', async () => {
    const symlinkDir = path.join(os.tmpdir(), `marvin-macos-sym-${Date.now()}`)
    await fs.symlink(tmpDir, symlinkDir)
    try {
      const allowedSet = new Set<string>()
      await simulateVaultPick(symlinkDir, allowedSet)

      // On macOS path.resolve(symlinkDir) ≠ fs.realpath(symlinkDir) for /var paths.
      // Verify the allowlist contains the realpath, not the lexical path.
      const realpath = await fs.realpath(symlinkDir)
      const lexical = path.resolve(symlinkDir)
      expect(allowedSet.has(realpath)).toBe(true)
      if (lexical !== realpath) {
        expect(allowedSet.has(lexical)).toBe(false)
      }

      // vault:watch resolves the symlink arg → same realpath → passes
      await expect(simulateVaultWatch(symlinkDir, allowedSet)).resolves.toBe(realpath)
    } finally {
      await fs.rm(symlinkDir, { force: true })
    }
  })

  it('nonexistent path passed to vault:watch throws MARVIN_VAULT_NOT_ALLOWED', async () => {
    const allowedSet = new Set<string>()
    const nonexistent = path.join(os.tmpdir(), `marvin-noexist-${Date.now()}`)
    await expect(simulateVaultWatch(nonexistent, allowedSet)).rejects.toThrow(
      'MARVIN_VAULT_NOT_ALLOWED'
    )
  })
})

// ---------------------------------------------------------------------------
// vault:pick ENOENT — stale or removed path is never added to allowlist
// ---------------------------------------------------------------------------

describe('vault:pick ENOENT — allowlist unchanged on realpath failure', () => {
  it('stale path (ENOENT) → simulateVaultPick returns null, set remains empty', async () => {
    const allowedSet = new Set<string>()
    const stale = path.join(os.tmpdir(), `marvin-stale-${Date.now()}`)
    const result = await simulateVaultPick(stale, allowedSet)
    expect(result).toBeNull()
    expect(allowedSet.size).toBe(0)
  })

  it('vault:watch after failed pick throws MARVIN_VAULT_NOT_ALLOWED', async () => {
    const allowedSet = new Set<string>()
    const stale = path.join(os.tmpdir(), `marvin-stale2-${Date.now()}`)
    await simulateVaultPick(stale, allowedSet)
    // stale was never added → watch on any path fails
    await expect(simulateVaultWatch(stale, allowedSet)).rejects.toThrow('MARVIN_VAULT_NOT_ALLOWED')
  })
})
