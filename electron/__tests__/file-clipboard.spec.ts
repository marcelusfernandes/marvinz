import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { assertInsideVaultAsync } from '../vault-boundary.js'

// ---------------------------------------------------------------------------
// Mirrors of handler logic — same pattern as file-write-binary.spec.ts
// ---------------------------------------------------------------------------

type MoveResult = { src: string; dest: string; ok: boolean; error?: string }

async function resolveConflict(
  destDir: string,
  baseName: string,
  mode: 'copy' | 'move',
): Promise<string> {
  const ext = path.extname(baseName)
  const stem = ext ? baseName.slice(0, -ext.length) : baseName
  if (mode === 'move') {
    const direct = path.join(destDir, baseName)
    if (!existsSync(direct)) return direct
    for (let n = 2; n <= 100; n++) {
      const c = path.join(destDir, `${stem} ${n}${ext}`)
      if (!existsSync(c)) return c
    }
  } else {
    for (let n = 1; n <= 100; n++) {
      const c = path.join(destDir, n === 1 ? `Copy of ${stem}${ext}` : `Copy of ${stem} ${n}${ext}`)
      if (!existsSync(c)) return c
    }
  }
  throw new Error('MARVIN_COPY_CONFLICT_LIMIT')
}

async function fileCopy(vault: string, srcPath: string, destDir: string): Promise<string> {
  const safeSrc = await assertInsideVaultAsync(vault, srcPath)
  const safeDir = await assertInsideVaultAsync(vault, destDir)
  const destPath = await resolveConflict(safeDir, path.basename(safeSrc), 'copy')
  await fs.cp(safeSrc, destPath, { recursive: true, errorOnExist: false })
  return destPath
}

async function fileMoveBatch(
  vault: string,
  srcs: string[],
  destDir: string,
): Promise<MoveResult[]> {
  const safeDir = await assertInsideVaultAsync(vault, destDir)
  const results: MoveResult[] = []
  for (const src of srcs) {
    try {
      const safeSrc = await assertInsideVaultAsync(vault, src)
      const destPath = await resolveConflict(safeDir, path.basename(safeSrc), 'move')
      await fs.mkdir(path.dirname(destPath), { recursive: true })
      await fs.rename(safeSrc, destPath)
      results.push({ src, dest: destPath, ok: true })
    } catch (err) {
      results.push({ src, dest: '', ok: false, error: (err as Error).message })
    }
  }
  return results
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let vault: string

async function setup(): Promise<void> {
  const raw = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-clipboard-'))
  vault = await fs.realpath(raw)
}

async function teardown(): Promise<void> {
  await fs.rm(vault, { recursive: true, force: true })
}

// ---------------------------------------------------------------------------
// 1. copy file — no conflict
// ---------------------------------------------------------------------------

describe('file:copy — no conflict', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('always prefixes "Copy of" even when no conflict exists', async () => {
    await fs.writeFile(path.join(vault, 'note.md'), '# hello', 'utf8')
    const dest = path.join(vault, 'target')
    await fs.mkdir(dest)

    const result = await fileCopy(vault, path.join(vault, 'note.md'), dest)

    expect(result).toBe(path.join(dest, 'Copy of note.md'))
    const content = await fs.readFile(result, 'utf8')
    expect(content).toBe('# hello')
  })
})

// ---------------------------------------------------------------------------
// 2. copy file — conflict resolution
// ---------------------------------------------------------------------------

describe('file:copy — conflict resolution', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('generates "Copy of X.md" then "Copy of X 2.md" on subsequent conflicts', async () => {
    const src = path.join(vault, 'note.md')
    await fs.writeFile(src, 'v1', 'utf8')
    const dest = path.join(vault, 'dest')
    await fs.mkdir(dest)

    const first = await fileCopy(vault, src, dest)
    expect(first).toBe(path.join(dest, 'Copy of note.md'))

    const second = await fileCopy(vault, src, dest)
    expect(second).toBe(path.join(dest, 'Copy of note 2.md'))
  })
})

// ---------------------------------------------------------------------------
// 3. copy folder — recursive + conflict on folder name
// ---------------------------------------------------------------------------

describe('file:copy — recursive folder copy', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('copies folder recursively and resolves name conflict', async () => {
    const srcDir = path.join(vault, 'docs')
    await fs.mkdir(srcDir)
    await fs.writeFile(path.join(srcDir, 'a.md'), 'aaa', 'utf8')
    await fs.writeFile(path.join(srcDir, 'b.md'), 'bbb', 'utf8')
    const destParent = path.join(vault, 'archive')
    await fs.mkdir(destParent)

    const result = await fileCopy(vault, srcDir, destParent)

    expect(result).toBe(path.join(destParent, 'Copy of docs'))
    const children = await fs.readdir(result)
    expect(children.sort()).toEqual(['a.md', 'b.md'])

    const result2 = await fileCopy(vault, srcDir, destParent)
    expect(result2).toBe(path.join(destParent, 'Copy of docs 2'))
  })
})

// ---------------------------------------------------------------------------
// 4. move-batch — happy path preserves basename (no "Copy of" prefix)
// ---------------------------------------------------------------------------

describe('file:move-batch — happy path', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('moves all files preserving basename and returns ok:true for each', async () => {
    const a = path.join(vault, 'a.md')
    const b = path.join(vault, 'b.md')
    await fs.writeFile(a, '# A', 'utf8')
    await fs.writeFile(b, '# B', 'utf8')
    const destDir = path.join(vault, 'moved')
    await fs.mkdir(destDir)

    const results = await fileMoveBatch(vault, [a, b], destDir)

    expect(results).toHaveLength(2)
    expect(results[0].ok).toBe(true)
    expect(results[1].ok).toBe(true)
    expect(existsSync(a)).toBe(false)
    expect(existsSync(b)).toBe(false)
    expect(existsSync(path.join(destDir, 'a.md'))).toBe(true)
    expect(existsSync(path.join(destDir, 'b.md'))).toBe(true)
  })

  it('suffixes numerically when basename collides on move', async () => {
    const src = path.join(vault, 'note.md')
    await fs.writeFile(src, 'new', 'utf8')
    const destDir = path.join(vault, 'dest')
    await fs.mkdir(destDir)
    await fs.writeFile(path.join(destDir, 'note.md'), 'existing', 'utf8')

    const results = await fileMoveBatch(vault, [src], destDir)

    expect(results[0].ok).toBe(true)
    expect(results[0].dest).toBe(path.join(destDir, 'note 2.md'))
    expect(existsSync(src)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 5. move-batch — partial failure continues
// ---------------------------------------------------------------------------

describe('file:move-batch — partial failure', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('reports error for missing src, still moves the valid one', async () => {
    const good = path.join(vault, 'good.md')
    await fs.writeFile(good, 'ok', 'utf8')
    const missing = path.join(vault, 'ghost.md')
    const destDir = path.join(vault, 'out')
    await fs.mkdir(destDir)

    const results = await fileMoveBatch(vault, [missing, good], destDir)

    const failResult = results.find((r) => r.src === missing)
    const okResult = results.find((r) => r.src === good)

    expect(failResult?.ok).toBe(false)
    expect(failResult?.error).toBeTruthy()
    expect(okResult?.ok).toBe(true)
    expect(existsSync(path.join(destDir, 'good.md'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 6. path traversal — rejected by vault boundary
// ---------------------------------------------------------------------------

describe('file:copy — path traversal rejected', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('rejects srcPath with null byte via MARVIN_OUTSIDE_VAULT', async () => {
    await expect(
      fileCopy(vault, path.join(vault, 'ok.md\0'), vault),
    ).rejects.toThrow('MARVIN_OUTSIDE_VAULT')
  })

  it('rejects destDir outside vault via MARVIN_OUTSIDE_VAULT', async () => {
    const src = path.join(vault, 'note.md')
    await fs.writeFile(src, 'x', 'utf8')
    await expect(
      fileCopy(vault, src, '/tmp/evil'),
    ).rejects.toThrow('MARVIN_OUTSIDE_VAULT')
  })
})
