import { describe, it, expect } from 'vitest'
import { formatPathsForAgent } from '../agent-drop-format'

const ROOT = '/vault'

describe('formatPathsForAgent — Codex', () => {
  it('single path → @<relative>', () => {
    expect(formatPathsForAgent(['/vault/notes/foo.md'], 'codex', ROOT)).toBe('@notes/foo.md')
  })

  it('multiple paths joined by single space, each prefixed with @', () => {
    expect(
      formatPathsForAgent(['/vault/a.md', '/vault/sub/b.md', '/vault/c.md'], 'codex', ROOT)
    ).toBe('@a.md @sub/b.md @c.md')
  })

  it('path with whitespace is wrapped in double quotes inside the @', () => {
    expect(formatPathsForAgent(['/vault/my file.md'], 'codex', ROOT)).toBe('@"my file.md"')
  })
})

describe('formatPathsForAgent — Claude Code', () => {
  it('single path → <relative> (no prefix)', () => {
    expect(formatPathsForAgent(['/vault/notes/foo.md'], 'claude-code', ROOT)).toBe('notes/foo.md')
  })

  it('multiple paths joined by single space, no prefix', () => {
    expect(formatPathsForAgent(['/vault/a.md', '/vault/b.md'], 'claude-code', ROOT)).toBe(
      'a.md b.md'
    )
  })

  it('path with whitespace is wrapped in double quotes', () => {
    expect(formatPathsForAgent(['/vault/my file.md'], 'claude-code', ROOT)).toBe('"my file.md"')
  })
})

describe('formatPathsForAgent — workspace edge cases', () => {
  it('path equal to workspaceRoot becomes "."', () => {
    expect(formatPathsForAgent([ROOT], 'codex', ROOT)).toBe('@.')
  })

  it('path outside workspace stays absolute', () => {
    expect(formatPathsForAgent(['/other/place.md'], 'claude-code', ROOT)).toBe('/other/place.md')
  })

  it('workspaceRoot with trailing slash is normalized', () => {
    expect(formatPathsForAgent(['/vault/foo.md'], 'codex', '/vault/')).toBe('@foo.md')
  })

  it('empty workspaceRoot keeps paths absolute', () => {
    expect(formatPathsForAgent(['/vault/foo.md'], 'codex', '')).toBe('@/vault/foo.md')
  })

  it('empty paths list → empty string', () => {
    expect(formatPathsForAgent([], 'codex', ROOT)).toBe('')
    expect(formatPathsForAgent([], 'claude-code', ROOT)).toBe('')
  })
})
