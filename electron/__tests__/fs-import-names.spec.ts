import { describe, it, expect } from 'vitest'
import { resolveImportName } from '../fs-import-names'

describe('resolveImportName — free name', () => {
  it('returns basename unchanged when not in existingNames', () => {
    expect(resolveImportName('foo.md', new Set())).toBe('foo.md')
  })

  it('returns basename unchanged when existingNames is empty array', () => {
    expect(resolveImportName('bar', [])).toBe('bar')
  })
})

describe('resolveImportName — simple conflict', () => {
  it('suffixes (1) before extension when basename already exists', () => {
    expect(resolveImportName('foo.md', new Set(['foo.md']))).toBe('foo (1).md')
  })
})

describe('resolveImportName — chained conflict', () => {
  it('increments suffix until a free slot is found', () => {
    const existing = new Set(['foo.md', 'foo (1).md', 'foo (2).md'])
    expect(resolveImportName('foo.md', existing)).toBe('foo (3).md')
  })
})

describe('resolveImportName — folder (no extension)', () => {
  it('suffixes (1) with no extension for names without a dot', () => {
    expect(resolveImportName('bar', new Set(['bar']))).toBe('bar (1)')
  })
})

describe('resolveImportName — multi-dot extension', () => {
  it('splits on last dot only, leaving compound extension intact except final segment', () => {
    expect(resolveImportName('archive.tar.gz', new Set(['archive.tar.gz']))).toBe(
      'archive.tar (1).gz'
    )
  })
})

describe('resolveImportName — dotfile', () => {
  it('treats leading dot as part of stem, not an extension separator', () => {
    expect(resolveImportName('.gitignore', new Set(['.gitignore']))).toBe('.gitignore (1)')
  })
})

describe('resolveImportName — already-suffixed basename', () => {
  it('does not strip existing (n) suffix — appends a new one', () => {
    expect(resolveImportName('foo (1).md', new Set(['foo (1).md']))).toBe('foo (1) (1).md')
  })
})

describe('resolveImportName — exhaustion', () => {
  it('throws MARVIN_IMPORT_NAME_EXHAUSTED after 999 failed attempts', () => {
    const existing = new Set<string>(['photo.jpg'])
    for (let n = 1; n <= 999; n++) {
      existing.add(`photo (${n}).jpg`)
    }
    expect(() => resolveImportName('photo.jpg', existing)).toThrow('MARVIN_IMPORT_NAME_EXHAUSTED')
  })
})

describe('resolveImportName — accepts Set or array', () => {
  it('returns the same result whether existingNames is a Set or an array', () => {
    const names = ['note.md', 'note (1).md']
    const fromArray = resolveImportName('note.md', names)
    const fromSet = resolveImportName('note.md', new Set(names))
    expect(fromArray).toBe('note (2).md')
    expect(fromSet).toBe('note (2).md')
  })
})

describe('resolveImportName — case-insensitive collision (#552)', () => {
  it('detects a collision that differs only in case and suffixes it', () => {
    // 'Notes.md' exists; incoming 'notes.md' collides on a case-insensitive
    // filesystem (APFS/NTFS) even though the strings are not identical.
    expect(resolveImportName('notes.md', new Set(['Notes.md']))).toBe('notes (1).md')
  })

  it('preserves the incoming basename case in the returned name', () => {
    // Detection is case-insensitive, but the returned name keeps the
    // caller's original casing — it must not be forced to lowercase.
    expect(resolveImportName('Notes.md', new Set(['notes.md']))).toBe('Notes (1).md')
  })
})
