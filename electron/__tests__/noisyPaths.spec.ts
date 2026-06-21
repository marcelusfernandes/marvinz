import { describe, it, expect } from 'vitest'
import { relPathIsNoisy, NOISY_DIRS, isNoisy } from '../noisyPaths'

describe('relPathIsNoisy', () => {
  it('flags internal snapshot bookkeeping deep under .marvin/', () => {
    expect(relPathIsNoisy('.marvin/snapshots/20260526T023148Z-361d4e/_manifest.json')).toBe(true)
  })

  it('flags Obsidian workspace state under .obsidian/', () => {
    expect(relPathIsNoisy('.obsidian/workspace.json')).toBe(true)
  })

  it('flags deep files inside any noisy directory', () => {
    expect(relPathIsNoisy('node_modules/foo/package.json')).toBe(true)
    expect(relPathIsNoisy('.git/refs/heads/main')).toBe(true)
    expect(relPathIsNoisy('dist/bundle.js')).toBe(true)
  })

  it('flags noisy files anywhere in the tree', () => {
    expect(relPathIsNoisy('notes/.DS_Store')).toBe(true)
  })

  it('does NOT flag a real user file at the vault root', () => {
    expect(relPathIsNoisy('testev3.md')).toBe(false)
    // A real user file legitimately named workflow.json must NOT be filtered —
    // the leak was .obsidian/workspace.json, not a root workflow.json.
    expect(relPathIsNoisy('workflow.json')).toBe(false)
  })

  it('does NOT flag a real user file in a normal subdirectory', () => {
    expect(relPathIsNoisy('knowledge/journal/2026-05-25.md')).toBe(false)
  })

  it('does NOT flag the vault root itself (empty relPath)', () => {
    expect(relPathIsNoisy('')).toBe(false)
  })
})

describe('NOISY_DIRS / isNoisy', () => {
  it('includes .obsidian so its config files are excluded', () => {
    expect(NOISY_DIRS.has('.obsidian')).toBe(true)
  })

  it('isNoisy still works per-entry for the file tree', () => {
    expect(isNoisy('.obsidian', true)).toBe(true)
    expect(isNoisy('.git', true)).toBe(true)
    expect(isNoisy('notes', true)).toBe(false)
    expect(isNoisy('.DS_Store', false)).toBe(true)
    expect(isNoisy('foo.md', false)).toBe(false)
  })
})
