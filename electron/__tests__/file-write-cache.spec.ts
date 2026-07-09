import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { writeTextFileAndRefreshCache } from '../file-write-cache.js'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-file-write-cache-'))
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('writeTextFileAndRefreshCache', () => {
  it('uses the saved content as the next watcher baseline', async () => {
    const filePath = path.join(tmpDir, 'note.md')
    const cache = new Map([[filePath, 'first editor read']])

    await writeTextFileAndRefreshCache(cache, filePath, 'latest user save')

    await expect(fs.readFile(filePath, 'utf8')).resolves.toBe('latest user save')
    expect(cache.get(filePath)).toBe('latest user save')
  })

  it('does not advance the watcher baseline when the write fails', async () => {
    const filePath = path.join(tmpDir, 'missing-parent', 'note.md')
    const cache = new Map([[filePath, 'last known good version']])

    await expect(writeTextFileAndRefreshCache(cache, filePath, 'failed save')).rejects.toMatchObject({
      code: 'ENOENT',
    })

    expect(cache.get(filePath)).toBe('last known good version')
  })
})
