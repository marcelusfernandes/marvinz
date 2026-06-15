import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

// Approach (A): importExternal is a plain async function, ipcMain.handle just forwards.
import { importExternal, isDenied } from '../fs-import-external.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let vault: string // active vault root
let destDir: string // destination inside vault
let outside: string // directory outside vault but allowed (tmpdir is not blocklisted)

async function setup(): Promise<void> {
  const rawVault = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-import-vault-'))
  vault = await fs.realpath(rawVault)
  destDir = path.join(vault, 'imported')
  await fs.mkdir(destDir)

  const rawOutside = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-import-outside-'))
  outside = await fs.realpath(rawOutside)
}

async function teardown(): Promise<void> {
  await fs.rm(vault, { recursive: true, force: true })
  await fs.rm(outside, { recursive: true, force: true })
}

// ---------------------------------------------------------------------------
// 1. Simple copy — single file lands in destDir with correct content
// ---------------------------------------------------------------------------

describe('importExternal — simple file copy', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('copies a single file into destDir and returns it in imported', async () => {
    const src = path.join(outside, 'note.md')
    await fs.writeFile(src, '# Hello', 'utf8')

    const result = await importExternal(vault, [src], destDir)

    expect(result.skipped).toHaveLength(0)
    expect(result.imported).toHaveLength(1)

    const dest = path.join(destDir, 'note.md')
    expect(result.imported[0]).toBe(dest)
    const content = await fs.readFile(dest, 'utf8')
    expect(content).toBe('# Hello')
  })

  it('accepts destDir equal to vault root (drop on tree root)', async () => {
    const src = path.join(outside, 'root-drop.md')
    await fs.writeFile(src, '# Root', 'utf8')

    const result = await importExternal(vault, [src], vault)

    expect(result.skipped).toHaveLength(0)
    expect(result.imported).toHaveLength(1)
    expect(result.imported[0]).toBe(path.join(vault, 'root-drop.md'))
  })
})

// ---------------------------------------------------------------------------
// 2. Recursive copy — directory tree is preserved
// ---------------------------------------------------------------------------

describe('importExternal — recursive directory copy', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('copies a directory with nested files and preserves hierarchy', async () => {
    const srcDir = path.join(outside, 'project')
    await fs.mkdir(path.join(srcDir, 'sub'), { recursive: true })
    await fs.writeFile(path.join(srcDir, 'README.md'), 'root', 'utf8')
    await fs.writeFile(path.join(srcDir, 'sub', 'a.md'), 'a', 'utf8')
    await fs.writeFile(path.join(srcDir, 'sub', 'b.md'), 'b', 'utf8')

    const result = await importExternal(vault, [srcDir], destDir)

    expect(result.skipped).toHaveLength(0)
    expect(result.imported).toHaveLength(1)

    const destRoot = path.join(destDir, 'project')
    expect(result.imported[0]).toBe(destRoot)
    expect(await fs.readFile(path.join(destRoot, 'README.md'), 'utf8')).toBe('root')
    expect(await fs.readFile(path.join(destRoot, 'sub', 'a.md'), 'utf8')).toBe('a')
    expect(await fs.readFile(path.join(destRoot, 'sub', 'b.md'), 'utf8')).toBe('b')
  })
})

// ---------------------------------------------------------------------------
// 3. Conflict resolution — resolveImportName wired correctly
// ---------------------------------------------------------------------------

describe('importExternal — conflict resolution', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('renames an incoming file when the destination name already exists', async () => {
    await fs.writeFile(path.join(destDir, 'foo.md'), 'existing', 'utf8')

    const src = path.join(outside, 'foo.md')
    await fs.writeFile(src, 'incoming', 'utf8')

    const result = await importExternal(vault, [src], destDir)

    expect(result.skipped).toHaveLength(0)
    expect(result.imported).toHaveLength(1)
    expect(result.imported[0]).toBe(path.join(destDir, 'foo (1).md'))

    expect(await fs.readFile(path.join(destDir, 'foo.md'), 'utf8')).toBe('existing')
    expect(await fs.readFile(path.join(destDir, 'foo (1).md'), 'utf8')).toBe('incoming')
  })

  it('avoids collision between multiple sources in the same batch', async () => {
    const src1 = path.join(outside, 'note.md')
    const src2 = path.join(outside, 'dup', 'note.md')
    await fs.mkdir(path.join(outside, 'dup'))
    await fs.writeFile(src1, 'first', 'utf8')
    await fs.writeFile(src2, 'second', 'utf8')

    const result = await importExternal(vault, [src1, src2], destDir)

    expect(result.skipped).toHaveLength(0)
    expect(result.imported).toHaveLength(2)

    const names = result.imported.map((p) => path.basename(p)).sort()
    expect(names).toEqual(['note (1).md', 'note.md'])
  })

  it('detects conflict when existing file is NFD and incoming source is NFC', async () => {
    // macOS HFS+ often stores filenames in NFD; incoming sources may be NFC.
    // The implementation normalizes both to NFC before collision-checking.
    const nfdName = 'café.md'.normalize('NFD') // e + U+0301 combining accent
    const nfcName = 'café.md'.normalize('NFC') // precomposed U+00E9

    await fs.writeFile(path.join(destDir, nfdName), 'existing', 'utf8')

    const src = path.join(outside, nfcName)
    await fs.writeFile(src, 'incoming', 'utf8')

    const result = await importExternal(vault, [src], destDir)

    expect(result.skipped).toHaveLength(0)
    expect(result.imported).toHaveLength(1)
    expect(path.basename(result.imported[0])).toBe('café (1).md')
  })
})

// ---------------------------------------------------------------------------
// 4. Boundary violation — destDir outside vault throws MARVIN_OUTSIDE_VAULT
// ---------------------------------------------------------------------------

describe('importExternal — boundary violation', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('throws MARVIN_OUTSIDE_VAULT when destDir is outside the vault', async () => {
    const src = path.join(outside, 'safe.md')
    await fs.writeFile(src, 'content', 'utf8')

    await expect(importExternal(vault, [src], outside)).rejects.toThrow('MARVIN_OUTSIDE_VAULT')
  })

  it('throws MARVIN_OUTSIDE_VAULT for path-traversal destDir', async () => {
    const traversal = path.join(vault, '..', 'escape')
    const src = path.join(outside, 'safe.md')
    await fs.writeFile(src, 'content', 'utf8')

    await expect(importExternal(vault, [src], traversal)).rejects.toThrow('MARVIN_OUTSIDE_VAULT')
  })
})

// ---------------------------------------------------------------------------
// 5. Source missing — skipped with reason 'not-found', imported continues
// ---------------------------------------------------------------------------

describe('importExternal — missing source', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('skips a non-existent source with reason not-found', async () => {
    const missing = path.join(outside, 'ghost.md')
    const real = path.join(outside, 'real.md')
    await fs.writeFile(real, 'content', 'utf8')

    const result = await importExternal(vault, [missing, real], destDir)

    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0]).toMatchObject({ source: missing, reason: 'not-found' })
    expect(result.imported).toHaveLength(1)
    expect(result.imported[0]).toBe(path.join(destDir, 'real.md'))
  })
})

// ---------------------------------------------------------------------------
// 6. Blocklist denial — blocked paths skipped with reason 'denied'
// ---------------------------------------------------------------------------

describe('importExternal — blocklist denial', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('skips a symlink whose target resolves to a blocklisted path (/etc/)', async () => {
    // /etc/hosts resolves to /private/etc/hosts on macOS — still matches /etc/ after
    // realpath, because realpath resolves /etc → /private/etc. The blocklist uses
    // the realpath'd value, so this catches the /private/etc alias automatically.
    const symlink = path.join(outside, 'evil-link')
    try {
      await fs.symlink('/etc/hosts', symlink)
    } catch {
      return // can't create symlink in this environment
    }

    const result = await importExternal(vault, [symlink], destDir)
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0]).toMatchObject({ source: symlink, reason: 'denied' })
    expect(result.imported).toHaveLength(0)
  })

  it('skips a file inside ~/.ssh/ with reason denied', async () => {
    const sshDir = path.join(os.homedir(), '.ssh')
    let sshFile: string | undefined
    try {
      const entries = await fs.readdir(sshDir)
      if (entries.length === 0) return
      sshFile = path.join(sshDir, entries[0])
    } catch {
      return // ~/.ssh doesn't exist in this environment
    }
    if (!sshFile) return
    const result = await importExternal(vault, [sshFile], destDir)
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0]).toMatchObject({ source: sshFile, reason: 'denied' })
    expect(result.imported).toHaveLength(0)
  })

  it('skips the ~/.ssh directory itself as source with reason denied (B2)', async () => {
    // B2: the blocklist matcher `real.startsWith(home + '/' + p)` with p='.ssh/'
    // blocks files INSIDE ~/.ssh but NOT the ~/.ssh dir itself (real === home + '/.ssh',
    // which does NOT start with home + '/.ssh/'). The fix must also check
    // `real + '/' === home + '/' + p` (or equivalent).
    // This test is TDD-red until electron applies the B2 patch.
    const sshDir = path.join(os.homedir(), '.ssh')
    try {
      await fs.access(sshDir)
    } catch {
      return // ~/.ssh doesn't exist in this environment — skip
    }

    const result = await importExternal(vault, [sshDir], destDir)
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0]).toMatchObject({ source: sshDir, reason: 'denied' })
    expect(result.imported).toHaveLength(0)
  })

  it('allows a regular file in tmpdir (tmpdir is not blocklisted)', async () => {
    const src = path.join(outside, 'allowed.md')
    await fs.writeFile(src, 'ok', 'utf8')

    const result = await importExternal(vault, [src], destDir)
    expect(result.imported).toHaveLength(1)
    expect(result.skipped).toHaveLength(0)
  })

  it('skips a dangling symlink with reason broken-symlink (not denied) (#204)', async () => {
    const symlink = path.join(outside, 'dangling-link')
    try {
      await fs.symlink(path.join(outside, 'does-not-exist'), symlink)
    } catch {
      return // can't create symlink in this environment
    }

    const result = await importExternal(vault, [symlink], destDir)
    expect(result.imported).toHaveLength(0)
    expect(result.skipped).toHaveLength(1)
    // The discriminator: a broken link is a user-fixable error, NOT a policy block.
    expect(result.skipped[0]).toMatchObject({ source: symlink, reason: 'broken-symlink' })
  })

  it('keeps a blocklisted target as denied, not broken-symlink (#204)', async () => {
    // /etc/hosts exists → realpath succeeds → isDenied blocks it → 'denied',
    // confirming the broken-symlink branch only catches realpath failures.
    const symlink = path.join(outside, 'policy-link')
    try {
      await fs.symlink('/etc/hosts', symlink)
    } catch {
      return
    }
    const result = await importExternal(vault, [symlink], destDir)
    expect(result.skipped[0]).toMatchObject({ source: symlink, reason: 'denied' })
  })
})

// ---------------------------------------------------------------------------
// 6b. isDenied — synthetic home, covers the expanded high-value blocklist (#203)
// ---------------------------------------------------------------------------

describe('isDenied — expanded credential blocklist (#203)', () => {
  const HOME = '/home/u'

  it('blocks high-value credential directories', () => {
    for (const p of [
      '/home/u/.config/gcloud/application_default_credentials.json',
      '/home/u/.docker/config.json',
      '/home/u/.kube/config',
      '/home/u/Library/Application Support/Google/Chrome/Login Data',
      '/home/u/Library/Mail/x',
      '/home/u/Library/Messages/chat.db',
      '/home/u/Library/Containers/com.x/Data/y',
      '/home/u/Library/Group Containers/group.x/y',
      // pre-existing entries still blocked
      '/home/u/.ssh/id_rsa',
      '/home/u/.aws/credentials',
    ]) {
      expect(isDenied(p, HOME)).toBe(true)
    }
  })

  it('blocks the credential directories themselves (not just children)', () => {
    expect(isDenied('/home/u/.config', HOME)).toBe(true)
    expect(isDenied('/home/u/.kube', HOME)).toBe(true)
  })

  it('blocks loose credential files directly in ~', () => {
    for (const name of [
      '.gitconfig',
      '.netrc',
      '.npmrc',
      '.pypirc',
      '.zsh_history',
      '.bash_history',
    ]) {
      expect(isDenied(`/home/u/${name}`, HOME)).toBe(true)
    }
  })

  it('allows ordinary files and avoids prefix false-positives', () => {
    expect(isDenied('/home/u/notes/foo.md', HOME)).toBe(false)
    expect(isDenied('/home/u/.gitconfig-backup', HOME)).toBe(false) // exact-match only
    expect(isDenied('/home/u/.configuration/x', HOME)).toBe(false) // not the .config/ dir
  })
})

// ---------------------------------------------------------------------------
// 7. Mixed valid/invalid sources
// ---------------------------------------------------------------------------

describe('importExternal — mixed valid and invalid sources', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('imports valid sources and skips invalid ones in the same call', async () => {
    const good1 = path.join(outside, 'good1.md')
    const good2 = path.join(outside, 'good2.md')
    const missing = path.join(outside, 'missing.md')
    await fs.writeFile(good1, 'g1', 'utf8')
    await fs.writeFile(good2, 'g2', 'utf8')

    const result = await importExternal(vault, [good1, missing, good2], destDir)

    expect(result.imported).toHaveLength(2)
    const importedNames = result.imported.map((p) => path.basename(p)).sort()
    expect(importedNames).toEqual(['good1.md', 'good2.md'])

    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0]).toMatchObject({ source: missing, reason: 'not-found' })
  })
})
