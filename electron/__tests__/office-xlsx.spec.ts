/**
 * Tests for office:readXlsx and office:writeXlsx IPC handler logic.
 *
 * Mirrors the handler logic from electron/main.ts (lines ~660-682).
 * Same pattern as file-write-binary.spec.ts: replicate handler logic directly
 * since ipcMain handlers are not exported.
 *
 * Handler contracts:
 *   office:readXlsx(filePath):
 *     1. assertInVault(filePath) → MARVIN_OUTSIDE_VAULT or MARVIN_NO_VAULT
 *     2. stat → MARVIN_TOO_LARGE if > 25MB
 *     3. readFile → XLSX.read → sheet_to_json
 *     4. return { rows: string[][], sheetNames: string[] }
 *
 *   office:writeXlsx(filePath, rows, sheetName):
 *     1. JSON.stringify(rows).length > 10MB → MARVIN_TOO_LARGE
 *     2. assertInVault(filePath) → MARVIN_OUTSIDE_VAULT
 *     3. aoa_to_sheet → book_new → book_append_sheet → write → writeFile
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { assertInsideVaultAsync } from '../vault-boundary.js'

// ---------------------------------------------------------------------------
// SheetJS mock — avoids native binary dependency in unit tests
// ---------------------------------------------------------------------------

vi.mock('xlsx', () => {
  const fakeSheet = { A1: { v: 'Name' }, B1: { v: 'Score' }, A2: { v: 'Alice' }, B2: { v: 42 }, '!ref': 'A1:B2' }
  const fakeWorkbook = {
    SheetNames: ['Sheet1'],
    Sheets: { Sheet1: fakeSheet },
  }
  return {
    default: {
      read: vi.fn().mockReturnValue(fakeWorkbook),
      write: vi.fn().mockReturnValue(Buffer.from('xlsx-bytes')),
      utils: {
        sheet_to_json: vi.fn().mockReturnValue([['Name', 'Score'], ['Alice', '42']]),
        aoa_to_sheet: vi.fn().mockReturnValue(fakeSheet),
        book_new: vi.fn().mockReturnValue({ SheetNames: [], Sheets: {} }),
        book_append_sheet: vi.fn(),
      },
    },
  }
})

// ---------------------------------------------------------------------------
// Mirror of office:readXlsx handler
// ---------------------------------------------------------------------------

async function readXlsx(
  vaultPath: string,
  filePath: string,
): Promise<{ rows: string[][]; sheetNames: string[] }> {
  const XLSX = (await import('xlsx')).default
  const safe = await assertInsideVaultAsync(vaultPath, filePath)
  const stats = await fs.stat(safe)
  if (stats.size > 25 * 1024 * 1024) throw new Error(`MARVIN_TOO_LARGE: ${stats.size}`)
  const buf = await fs.readFile(safe)
  const wb = XLSX.read(buf, { type: 'buffer' })
  const sheetNames = wb.SheetNames
  const sheet = wb.Sheets[sheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 })
  return { rows, sheetNames }
}

// ---------------------------------------------------------------------------
// Mirror of office:writeXlsx handler
// ---------------------------------------------------------------------------

async function writeXlsx(
  vaultPath: string,
  filePath: string,
  rows: string[][],
  sheetName: string,
): Promise<void> {
  if (JSON.stringify(rows).length > 10 * 1024 * 1024) throw new Error('MARVIN_TOO_LARGE')
  const XLSX = (await import('xlsx')).default
  const safe = await assertInsideVaultAsync(vaultPath, filePath)
  const ws = XLSX.utils.aoa_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetName ?? 'Sheet1')
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
  await fs.writeFile(safe, buf)
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let vault: string
let outside: string

async function setup(): Promise<void> {
  const rawVault = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-xlsx-vault-'))
  vault = await fs.realpath(rawVault)
  const rawOutside = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-xlsx-outside-'))
  outside = await fs.realpath(rawOutside)
}

async function teardown(): Promise<void> {
  await fs.rm(vault, { recursive: true, force: true })
  await fs.rm(outside, { recursive: true, force: true })
}

// ---------------------------------------------------------------------------
// office:readXlsx — happy path
// ---------------------------------------------------------------------------

describe('office:readXlsx — happy path', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('returns rows and sheetNames for a valid xlsx file inside vault', async () => {
    const filePath = path.join(vault, 'data.xlsx')
    await fs.writeFile(filePath, Buffer.from('fake-xlsx-bytes'))

    const result = await readXlsx(vault, filePath)

    expect(result).toHaveProperty('rows')
    expect(result).toHaveProperty('sheetNames')
    expect(Array.isArray(result.rows)).toBe(true)
    expect(Array.isArray(result.sheetNames)).toBe(true)
    expect(result.sheetNames).toContain('Sheet1')
  })
})

// ---------------------------------------------------------------------------
// office:readXlsx — out-of-vault rejection
// ---------------------------------------------------------------------------

describe('office:readXlsx — out-of-vault path', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('rejects a path outside the vault with MARVIN_OUTSIDE_VAULT', async () => {
    const filePath = path.join(outside, 'data.xlsx')
    await fs.writeFile(filePath, Buffer.from('fake'))

    await expect(readXlsx(vault, filePath)).rejects.toThrow('MARVIN_OUTSIDE_VAULT')
  })

  it('rejects a path traversal attempt with MARVIN_OUTSIDE_VAULT', async () => {
    const filePath = path.join(vault, '..', 'escape.xlsx')

    await expect(readXlsx(vault, filePath)).rejects.toThrow('MARVIN_OUTSIDE_VAULT')
  })
})

// ---------------------------------------------------------------------------
// office:readXlsx — file size limit
// ---------------------------------------------------------------------------

describe('office:readXlsx — size limit', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('throws MARVIN_TOO_LARGE when file exceeds 25MB', async () => {
    const filePath = path.join(vault, 'big.xlsx')
    // Write a sparse file that reports a large size via stat
    const fh = await fs.open(filePath, 'w')
    await fh.truncate(26 * 1024 * 1024)
    await fh.close()

    await expect(readXlsx(vault, filePath)).rejects.toThrow('MARVIN_TOO_LARGE')
  })

  it('does not throw for a file at exactly 25MB minus 1 byte', async () => {
    const filePath = path.join(vault, 'borderline.xlsx')
    const fh = await fs.open(filePath, 'w')
    await fh.truncate(25 * 1024 * 1024 - 1)
    await fh.close()

    // Should reach XLSX.read (which is mocked) without throwing size error
    await expect(readXlsx(vault, filePath)).resolves.toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// office:writeXlsx — happy path
// ---------------------------------------------------------------------------

describe('office:writeXlsx — happy path', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('writes the buffer returned by XLSX.write to the safe path', async () => {
    const filePath = path.join(vault, 'output.xlsx')
    const rows = [['Name', 'Score'], ['Alice', '42']]

    await writeXlsx(vault, filePath, rows, 'Sheet1')

    const written = await fs.readFile(filePath)
    expect(written.equals(Buffer.from('xlsx-bytes'))).toBe(true)
  })

  it('uses the provided sheetName when appending the sheet', async () => {
    const XLSX = (await import('xlsx')).default
    const filePath = path.join(vault, 'named.xlsx')
    const rows = [['A', 'B']]

    await writeXlsx(vault, filePath, rows, 'MySheet')

    expect(XLSX.utils.book_append_sheet).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'MySheet',
    )
  })
})

// ---------------------------------------------------------------------------
// office:writeXlsx — out-of-vault rejection
// ---------------------------------------------------------------------------

describe('office:writeXlsx — out-of-vault path', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('rejects a path outside the vault with MARVIN_OUTSIDE_VAULT', async () => {
    const filePath = path.join(outside, 'output.xlsx')
    const rows = [['A']]

    await expect(writeXlsx(vault, filePath, rows, 'Sheet1')).rejects.toThrow('MARVIN_OUTSIDE_VAULT')
  })

  it('does not create any file when path is rejected', async () => {
    const filePath = path.join(outside, 'output.xlsx')
    const rows = [['A']]

    await expect(writeXlsx(vault, filePath, rows, 'Sheet1')).rejects.toThrow()
    await expect(fs.access(filePath)).rejects.toThrow()
  })
})

// ---------------------------------------------------------------------------
// office:writeXlsx — payload size limit
// ---------------------------------------------------------------------------

describe('office:writeXlsx — payload size limit', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('throws MARVIN_TOO_LARGE before any I/O when serialized rows exceed 10MB', async () => {
    const filePath = path.join(vault, 'huge.xlsx')
    // Build rows whose JSON serialization exceeds 10MB
    const bigCell = 'x'.repeat(1024)
    const rows = Array.from({ length: 11 * 1024 }, () => [bigCell])

    await expect(writeXlsx(vault, filePath, rows, 'Sheet1')).rejects.toThrow('MARVIN_TOO_LARGE')

    // File must not exist — vault boundary and I/O are skipped
    await expect(fs.access(filePath)).rejects.toThrow()
  })
})
