/**
 * Tests for the file:writeBinary IPC handler logic.
 *
 * The handler lives inline in main.ts (not exported), so these tests replicate
 * its logic directly — same pattern as vault-allowlist.spec.ts simulating
 * vault:pick / vault:watch without importing from main.ts.
 *
 * Handler contract (electron/main.ts ~line 607):
 *   1. assertInVault(join(vaultPath, relPath)) → assertInsideVaultAsync
 *   2. decode base64, check decoded.length > (maxBytes ?? 25MB) → MARVIN_TOO_LARGE: <n>
 *   3. mkdir(dirname(safe), { recursive: true })
 *   4. writeFile(safe, decoded)
 *   5. return path.relative(vaultPath, safe)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { assertInsideVaultAsync } from '../vault-boundary.js'

// ---------------------------------------------------------------------------
// Mirror of the handler — keeps tests honest about what the real handler does
// ---------------------------------------------------------------------------

async function writeBinary(
  vaultPath: string,
  payload: { relPath: string; base64Bytes: string; maxBytes?: number }
): Promise<string> {
  const { relPath, base64Bytes, maxBytes } = payload
  const absolute = path.join(vaultPath, relPath)
  const safe = await assertInsideVaultAsync(vaultPath, absolute)
  const limit = maxBytes ?? 25 * 1024 * 1024
  // Raw-length gate before decode (mirrors main.ts file:writeBinary).
  if (base64Bytes.length > Math.floor((limit * 4) / 3) + 4) {
    throw new Error('MARVIN_TOO_LARGE: payload')
  }
  const decoded = Buffer.from(base64Bytes, 'base64')
  if (decoded.length > limit) throw new Error(`MARVIN_TOO_LARGE: ${decoded.length}`)
  await fs.mkdir(path.dirname(safe), { recursive: true })
  await fs.writeFile(safe, decoded)
  return path.relative(vaultPath, safe)
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let vault: string

async function setup(): Promise<void> {
  const raw = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-writebinary-'))
  vault = await fs.realpath(raw)
}

async function teardown(): Promise<void> {
  await fs.rm(vault, { recursive: true, force: true })
}

// ---------------------------------------------------------------------------
// 1. Out-of-vault traversal — rejected before any I/O
// ---------------------------------------------------------------------------

describe('file:writeBinary — out-of-vault traversal', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('rejects relPath "../etc/passwd" with MARVIN_OUTSIDE_VAULT', async () => {
    await expect(writeBinary(vault, { relPath: '../etc/passwd', base64Bytes: '' })).rejects.toThrow(
      'MARVIN_OUTSIDE_VAULT'
    )
  })
})

// ---------------------------------------------------------------------------
// 1b. Symlink escape — a symlinked dir pointing outside the vault is rejected.
// Direct coverage on the handler spec (transitively covered by boundary.spec,
// but this guards against the handler ever inlining/swapping the boundary check).
// ---------------------------------------------------------------------------

describe('file:writeBinary — symlink escape', () => {
  let outsideDir: string

  beforeEach(async () => {
    await setup()
    const raw = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-writebinary-outside-'))
    outsideDir = await fs.realpath(raw)
    // <vault>/escape → symlink to a directory outside the vault
    await fs.symlink(outsideDir, path.join(vault, 'escape'))
  })

  afterEach(async () => {
    await teardown()
    await fs.rm(outsideDir, { recursive: true, force: true })
  })

  it('rejects a write through a symlink that points outside the vault', async () => {
    await expect(
      writeBinary(vault, {
        relPath: 'escape/secret.bin',
        base64Bytes: Buffer.from('x').toString('base64'),
      })
    ).rejects.toThrow('MARVIN_OUTSIDE_VAULT')
    // Nothing written into the symlink target.
    await expect(fs.access(path.join(outsideDir, 'secret.bin'))).rejects.toThrow()
  })
})

// ---------------------------------------------------------------------------
// 2. Oversized payload — error thrown before file lands on disk
// ---------------------------------------------------------------------------

describe('file:writeBinary — oversized payload', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('throws MARVIN_TOO_LARGE and leaves no file on disk', async () => {
    const bytes = Buffer.alloc(11)
    const b64 = bytes.toString('base64')
    const relPath = 'attachments/big.bin'

    await expect(writeBinary(vault, { relPath, base64Bytes: b64, maxBytes: 10 })).rejects.toThrow(
      'MARVIN_TOO_LARGE: 11'
    )

    // File must not exist after the throw
    await expect(fs.access(path.join(vault, relPath))).rejects.toThrow()
  })

  it('fires the raw-length pre-check (": payload") before decoding an oversized string', async () => {
    // 100-char base64 with maxBytes:10 trips the raw gate (limit*4/3+4 ≈ 17),
    // so it rejects before Buffer.from ever allocates.
    const b64 = 'A'.repeat(100)
    const relPath = 'attachments/huge.bin'

    await expect(writeBinary(vault, { relPath, base64Bytes: b64, maxBytes: 10 })).rejects.toThrow(
      /MARVIN_TOO_LARGE: payload$/
    )

    await expect(fs.access(path.join(vault, relPath))).rejects.toThrow()
  })

  it('catches a string that slips under the raw gate but decodes over the limit', async () => {
    // limit=10 → raw gate ≈ 17 chars. 16 chars is under it, but decodes to 12
    // bytes (> 10), so the exact decoded check fires — proves the two-gate design.
    const b64 = 'A'.repeat(16)
    const relPath = 'attachments/adversarial.bin'

    await expect(writeBinary(vault, { relPath, base64Bytes: b64, maxBytes: 10 })).rejects.toThrow(
      /MARVIN_TOO_LARGE: 12$/
    )

    await expect(fs.access(path.join(vault, relPath))).rejects.toThrow()
  })
})

// ---------------------------------------------------------------------------
// 3. Auto-mkdir — handler creates missing parent directories
// ---------------------------------------------------------------------------

describe('file:writeBinary — auto-mkdir', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('creates attachments/ dir and writes file when dir does not exist', async () => {
    const relPath = 'attachments/sub/photo.png'
    // confirm attachments/ does not exist
    await expect(fs.access(path.join(vault, 'attachments'))).rejects.toThrow()

    await writeBinary(vault, { relPath, base64Bytes: Buffer.from('hello').toString('base64') })

    const dest = path.join(vault, relPath)
    await expect(fs.access(dest)).resolves.toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// 4. Base64 round-trip — full 256-byte buffer survives encode → write → read
// ---------------------------------------------------------------------------

describe('file:writeBinary — base64 round-trip', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('writes 256-byte binary buffer and reads back identical bytes', async () => {
    const original = Buffer.from(new Uint8Array(Array.from({ length: 256 }, (_, i) => i)))
    const b64 = original.toString('base64')
    const relPath = 'attachments/roundtrip.bin'

    await writeBinary(vault, { relPath, base64Bytes: b64 })

    const written = await fs.readFile(path.join(vault, relPath))
    expect(written.equals(original)).toBe(true)
  })
})
