import { describe, it, expect } from 'vitest'
import { resolveTerminalPath } from '../terminalPathResolver'

const VAULT = '/Users/me/vault'

describe('resolveTerminalPath', () => {
  it('resolves a simple relative path against the vault root', () => {
    expect(resolveTerminalPath('src/foo.tsx', VAULT)).toEqual({
      absolutePath: `${VAULT}/src/foo.tsx`,
    })
  })

  it('strips a leading ./ prefix', () => {
    expect(resolveTerminalPath('./docs/spec.md', VAULT)).toEqual({
      absolutePath: `${VAULT}/docs/spec.md`,
    })
  })

  it('strips git diff a/ and b/ prefixes', () => {
    expect(resolveTerminalPath('a/src/foo.tsx', VAULT)).toEqual({
      absolutePath: `${VAULT}/src/foo.tsx`,
    })
    expect(resolveTerminalPath('b/electron/main.ts', VAULT)).toEqual({
      absolutePath: `${VAULT}/electron/main.ts`,
    })
  })

  it('extracts a trailing :line suffix', () => {
    expect(resolveTerminalPath('src/foo.tsx:42', VAULT)).toEqual({
      absolutePath: `${VAULT}/src/foo.tsx`,
      line: 42,
    })
  })

  it('extracts :line:col and keeps only the line', () => {
    expect(resolveTerminalPath('src/foo.tsx:42:7', VAULT)).toEqual({
      absolutePath: `${VAULT}/src/foo.tsx`,
      line: 42,
    })
  })

  it('returns null for an absolute path outside the vault', () => {
    expect(resolveTerminalPath('/usr/bin/node', VAULT)).toBeNull()
    expect(resolveTerminalPath('/etc/passwd', VAULT)).toBeNull()
  })

  it('accepts an absolute path inside the vault', () => {
    expect(resolveTerminalPath(`${VAULT}/src/foo.tsx`, VAULT)).toEqual({
      absolutePath: `${VAULT}/src/foo.tsx`,
    })
  })

  it('returns null for a path that escapes the vault via ..', () => {
    expect(resolveTerminalPath('../secrets.txt', VAULT)).toBeNull()
    expect(resolveTerminalPath('src/../../escape.ts', VAULT)).toBeNull()
  })

  it('normalizes interior . and .. segments that stay inside the vault', () => {
    expect(resolveTerminalPath('src/./components/../foo.tsx', VAULT)).toEqual({
      absolutePath: `${VAULT}/src/foo.tsx`,
    })
  })

  it('returns null for empty or whitespace input', () => {
    expect(resolveTerminalPath('', VAULT)).toBeNull()
    expect(resolveTerminalPath('   ', VAULT)).toBeNull()
  })

  it('returns null when no vault is provided', () => {
    expect(resolveTerminalPath('src/foo.tsx', '')).toBeNull()
  })
})
