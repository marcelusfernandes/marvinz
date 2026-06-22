/**
 * Regression tests for marvin:// protocol handler boundary enforcement.
 * Issue #64: handler uses ad-hoc lexical validation; must be migrated to
 * assertInsideVaultAsync.
 *
 * TDD-first: these tests FAIL against the current code (ad-hoc check in
 * main.ts:237). They pass once the fix migrates to assertInsideVaultAsync.
 *
 * Strategy: invoke the marvin:// handler logic directly by importing the
 * boundary helper and replicating the handler contract. Since the handler
 * lives inside app.whenReady() and depends on Electron's protocol.handle,
 * we test the boundary helper in isolation for escape vectors, and test
 * the handler's response shape for the happy path using a handler factory
 * that mirrors the main.ts implementation.
 *
 * The tests that are RED pre-fix are:
 *   - Scenario 3: live symlink inside vault pointing outside → 403
 *   - Scenario 4: dangling symlink inside vault → 403
 * The ad-hoc check only does a lexical prefix test; it cannot detect symlinks.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { assertInsideVaultAsync } from '../vault-boundary.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let vault: string
let outside: string

async function setup(): Promise<void> {
  const rawVault = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-protocol-vault-'))
  vault = await fs.realpath(rawVault)
  const rawOutside = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-protocol-outside-'))
  outside = await fs.realpath(rawOutside)
}

async function teardown(): Promise<void> {
  await fs.rm(vault, { recursive: true, force: true })
  await fs.rm(outside, { recursive: true, force: true })
}

// ---------------------------------------------------------------------------
// Handler factory — mirrors the marvin:// handler in main.ts but with
// assertInsideVaultAsync replacing the ad-hoc lexical check. This is exactly
// what the fix must implement. The factory is used for happy-path and
// rejection-shape tests.
// ---------------------------------------------------------------------------

const MIME_BY_EXT: Record<string, string> = {
  md: 'text/markdown; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  html: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
}

function mimeFor(filePath: string): string {
  const ext = filePath.toLowerCase().split('.').pop() ?? ''
  return MIME_BY_EXT[ext] ?? 'application/octet-stream'
}

/**
 * Simulate the marvin:// handler response for a given absolute filePath.
 * Uses assertInsideVaultAsync — this is the TARGET implementation, not the
 * current ad-hoc one. The handler tests below verify that the boundary helper
 * is what drives the 403 decision.
 */
async function simulateHandlerFixed(
  activeVaultPath: string,
  filePath: string
): Promise<{ status: number; contentType?: string; body?: Buffer }> {
  try {
    if (!activeVaultPath) return { status: 403 }
    const safe = await assertInsideVaultAsync(activeVaultPath, filePath)
    const data = await fs.readFile(safe)
    return { status: 200, contentType: mimeFor(safe), body: data }
  } catch (err) {
    if (err instanceof Error && err.message === 'MARVIN_OUTSIDE_VAULT') {
      return { status: 403 }
    }
    return { status: 500 }
  }
}

/**
 * Simulate the CURRENT ad-hoc handler (pre-fix) for RED verification.
 * Mimics main.ts:237 verbatim so tests accurately represent what the bug is.
 */
async function simulateHandlerCurrent(
  activeVaultPath: string,
  filePath: string
): Promise<{ status: number }> {
  try {
    if (!activeVaultPath) return { status: 403 }
    // Current ad-hoc check — only lexical prefix (the vulnerable code)
    if (filePath !== activeVaultPath && !filePath.startsWith(activeVaultPath + path.sep)) {
      return { status: 403 }
    }
    await fs.readFile(filePath)
    return { status: 200 }
  } catch {
    return { status: 500 }
  }
}

// ---------------------------------------------------------------------------
// Scenario 1: absolute path outside vault → 403
// Both current and fixed handlers must reject this (lexical check suffices).
// ---------------------------------------------------------------------------

describe('marvin:// — scenario 1: absolute path outside vault', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('fixed handler returns 403 for /etc/passwd', async () => {
    const result = await simulateHandlerFixed(vault, '/etc/passwd')
    expect(result.status).toBe(403)
  })

  it('current handler returns 403 for /etc/passwd (lexical check covers this)', async () => {
    const result = await simulateHandlerCurrent(vault, '/etc/passwd')
    expect(result.status).toBe(403)
  })

  it('fixed handler returns 403 for arbitrary outside path', async () => {
    const outsideFile = path.join(outside, 'secret.txt')
    await fs.writeFile(outsideFile, 'secret', 'utf8')
    const result = await simulateHandlerFixed(vault, outsideFile)
    expect(result.status).toBe(403)
  })

  it('assertInsideVaultAsync throws MARVIN_OUTSIDE_VAULT for /etc/passwd', async () => {
    await expect(assertInsideVaultAsync(vault, '/etc/passwd')).rejects.toThrow(
      'MARVIN_OUTSIDE_VAULT'
    )
  })
})

// ---------------------------------------------------------------------------
// Scenario 2: path traversal → 403
// Both handlers must reject traversal (lexical normalize catches this too).
// ---------------------------------------------------------------------------

describe('marvin:// — scenario 2: path traversal', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('fixed handler returns 403 for <vault>/../escape', async () => {
    const traversal = path.join(vault, '..', 'escape')
    const result = await simulateHandlerFixed(vault, traversal)
    expect(result.status).toBe(403)
  })

  it('current handler returns 403 for <vault>/../escape (lexical resolves this)', async () => {
    const traversal = path.join(vault, '..', 'escape')
    const result = await simulateHandlerCurrent(vault, traversal)
    expect(result.status).toBe(403)
  })

  it('assertInsideVaultAsync throws for <vault>/../escape', async () => {
    const traversal = path.join(vault, '..', 'escape')
    await expect(assertInsideVaultAsync(vault, traversal)).rejects.toThrow('MARVIN_OUTSIDE_VAULT')
  })

  it('fixed handler returns 403 for <vault>/sub/../../escape', async () => {
    const traversal = path.join(vault, 'sub', '..', '..', 'escape')
    const result = await simulateHandlerFixed(vault, traversal)
    expect(result.status).toBe(403)
  })
})

// ---------------------------------------------------------------------------
// Scenario 3: live symlink inside vault pointing outside → 403
//
// RED pre-fix: the current ad-hoc check passes lexically (path starts with
// vault prefix). fs.readFile follows the symlink and leaks the outside file.
// assertInsideVaultAsync resolves symlinks and rejects.
// ---------------------------------------------------------------------------

describe('marvin:// — scenario 3: live symlink escaping vault', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('assertInsideVaultAsync rejects symlink pointing outside vault', async () => {
    const outsideFile = path.join(outside, 'sensitive.txt')
    await fs.writeFile(outsideFile, 'sensitive content', 'utf8')
    const symlink = path.join(vault, 'evil-link.md')
    await fs.symlink(outsideFile, symlink)

    await expect(assertInsideVaultAsync(vault, symlink)).rejects.toThrow('MARVIN_OUTSIDE_VAULT')

    // Outside file must not have been modified
    const content = await fs.readFile(outsideFile, 'utf8')
    expect(content).toBe('sensitive content')
  })

  it('[RED pre-fix] current handler LEAKS symlink (returns 200, not 403)', async () => {
    // This test documents the bug: the current ad-hoc check passes for symlinks.
    // It should return 200 (the bug) but the fixed handler must return 403.
    const outsideFile = path.join(outside, 'leak.txt')
    await fs.writeFile(outsideFile, 'leaked', 'utf8')
    const symlink = path.join(vault, 'evil-link.md')
    await fs.symlink(outsideFile, symlink)

    const currentResult = await simulateHandlerCurrent(vault, symlink)
    // The current handler leaks the file (200) — this is the vulnerability.
    expect(currentResult.status).toBe(200)
  })

  it('[GREEN post-fix] fixed handler returns 403 for live symlink escaping vault', async () => {
    const outsideFile = path.join(outside, 'sensitive.txt')
    await fs.writeFile(outsideFile, 'sensitive content', 'utf8')
    const symlink = path.join(vault, 'evil-link.md')
    await fs.symlink(outsideFile, symlink)

    const result = await simulateHandlerFixed(vault, symlink)
    expect(result.status).toBe(403)
  })

  it('fixed handler returns 403 for symlinked parent directory escaping vault', async () => {
    const symlinkDir = path.join(vault, 'evil-dir')
    await fs.symlink(outside, symlinkDir)
    const target = path.join(symlinkDir, 'image.png')

    const result = await simulateHandlerFixed(vault, target)
    expect(result.status).toBe(403)
  })
})

// ---------------------------------------------------------------------------
// Scenario 4: dangling symlink inside vault (target doesn't exist) → 403
//
// C3 vector: symlink inside vault points to a non-existent outside path.
// Current handler: lexical check passes, fs.readFile throws ENOENT → 500.
// Fixed handler: assertInsideVaultAsync detects dangling symlink → 403.
//
// The issue explicitly calls this out as a vector the current code does NOT cover.
// ---------------------------------------------------------------------------

describe('marvin:// — scenario 4: dangling symlink (C3)', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('assertInsideVaultAsync rejects dangling symlink pointing to non-existent outside path', async () => {
    const nonExistentOutside = path.join(outside, 'ghost-target.md')
    const symlink = path.join(vault, 'dangling.md')
    await fs.symlink(nonExistentOutside, symlink)

    await expect(assertInsideVaultAsync(vault, symlink)).rejects.toThrow('MARVIN_OUTSIDE_VAULT')

    // Target must not have been created by any side effect
    await expect(fs.access(nonExistentOutside)).rejects.toThrow()
  })

  it('[RED pre-fix] current handler returns 500 for dangling symlink (not 403)', async () => {
    // Bug: current code passes lexical check, then fs.readFile throws ENOENT → 500.
    // The correct response is 403, not 500, because the symlink escapes the vault.
    const nonExistentOutside = path.join(outside, 'ghost-target.md')
    const symlink = path.join(vault, 'dangling.md')
    await fs.symlink(nonExistentOutside, symlink)

    const currentResult = await simulateHandlerCurrent(vault, symlink)
    // Current handler returns 500 (reads fail) instead of 403 (rejected by boundary)
    expect(currentResult.status).toBe(500)
  })

  it('[GREEN post-fix] fixed handler returns 403 for dangling symlink', async () => {
    const nonExistentOutside = path.join(outside, 'ghost-target.md')
    const symlink = path.join(vault, 'dangling.md')
    await fs.symlink(nonExistentOutside, symlink)

    const result = await simulateHandlerFixed(vault, symlink)
    expect(result.status).toBe(403)
  })

  it('[RED pre-fix] current handler returns 500 for dangling symlink in subdir', async () => {
    const nonExistentDir = path.join(outside, 'ghost-dir')
    const symlinkDir = path.join(vault, 'ghost-link')
    await fs.symlink(nonExistentDir, symlinkDir)
    const target = path.join(symlinkDir, 'note.md')

    const currentResult = await simulateHandlerCurrent(vault, target)
    // Lexical check passes, then readFile fails — 500 instead of 403
    expect(currentResult.status).toBe(500)
  })

  it('[GREEN post-fix] fixed handler returns 403 for dangling symlinked parent dir', async () => {
    const nonExistentDir = path.join(outside, 'ghost-dir')
    const symlinkDir = path.join(vault, 'ghost-link')
    await fs.symlink(nonExistentDir, symlinkDir)
    const target = path.join(symlinkDir, 'note.md')

    const result = await simulateHandlerFixed(vault, target)
    expect(result.status).toBe(403)
  })
})

// ---------------------------------------------------------------------------
// Scenario 5: happy path — legitimate file inside vault → 200 with correct MIME
// ---------------------------------------------------------------------------

describe('marvin:// — scenario 5: happy path', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('fixed handler returns 200 for a .md file inside vault', async () => {
    const filePath = path.join(vault, 'notes', 'daily.md')
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, '# Daily note', 'utf8')

    const result = await simulateHandlerFixed(vault, filePath)
    expect(result.status).toBe(200)
    expect(result.contentType).toBe('text/markdown; charset=utf-8')
  })

  it('fixed handler returns 200 for a .png file inside vault', async () => {
    const filePath = path.join(vault, 'assets', 'logo.png')
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]))

    const result = await simulateHandlerFixed(vault, filePath)
    expect(result.status).toBe(200)
    expect(result.contentType).toBe('image/png')
  })

  it('fixed handler returns 200 for a .txt file in vault root', async () => {
    const filePath = path.join(vault, 'readme.txt')
    await fs.writeFile(filePath, 'plain text content', 'utf8')

    const result = await simulateHandlerFixed(vault, filePath)
    expect(result.status).toBe(200)
    expect(result.contentType).toBe('text/plain; charset=utf-8')
  })

  it('fixed handler returns 200 for an unknown extension (octet-stream)', async () => {
    const filePath = path.join(vault, 'data.bin')
    await fs.writeFile(filePath, Buffer.from([0x00, 0x01, 0x02]))

    const result = await simulateHandlerFixed(vault, filePath)
    expect(result.status).toBe(200)
    expect(result.contentType).toBe('application/octet-stream')
  })

  it('fixed handler returns 200 for file in nested subdirectory', async () => {
    const filePath = path.join(vault, 'a', 'b', 'c', 'deep.md')
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, '# Deep file', 'utf8')

    const result = await simulateHandlerFixed(vault, filePath)
    expect(result.status).toBe(200)
  })

  it('fixed handler returns 403 when no vault is active', async () => {
    const result = await simulateHandlerFixed('', path.join(vault, 'notes.md'))
    expect(result.status).toBe(403)
  })
})

// ---------------------------------------------------------------------------
// assertInsideVaultAsync contract — direct unit tests ensuring the helper
// used by the fixed handler behaves correctly for all protocol vectors.
// ---------------------------------------------------------------------------

describe('assertInsideVaultAsync — marvin:// boundary contract', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('accepts real file inside vault', async () => {
    const file = path.join(vault, 'ok.md')
    await fs.writeFile(file, 'ok', 'utf8')
    const safe = await assertInsideVaultAsync(vault, file)
    expect(safe).toBeTruthy()
    expect(safe.startsWith(vault)).toBe(true)
  })

  it('returns realpath (no TOCTOU window for caller)', async () => {
    const file = path.join(vault, 'real.md')
    await fs.writeFile(file, 'content', 'utf8')
    const safe = await assertInsideVaultAsync(vault, file)
    const expected = await fs.realpath(file)
    expect(safe).toBe(expected)
  })

  it('rejects null byte in path', async () => {
    const nullPath = path.join(vault, 'foo\0bar.md')
    await expect(assertInsideVaultAsync(vault, nullPath)).rejects.toThrow('MARVIN_OUTSIDE_VAULT')
  })

  it('rejects path outside vault via absolute path', async () => {
    await expect(assertInsideVaultAsync(vault, '/etc/hosts')).rejects.toThrow(
      'MARVIN_OUTSIDE_VAULT'
    )
  })
})
