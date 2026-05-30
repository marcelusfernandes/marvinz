import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { computeHash, harnessVersion } from '../harness-version.ts'

let root: string

function seedAgentDirs(): void {
  mkdirSync(join(root, '.claude', 'agents'), { recursive: true })
  mkdirSync(join(root, '.claude', 'commands'), { recursive: true })
  writeFileSync(join(root, '.claude', 'agents', 'reviewer.md'), 'you are a reviewer\n')
  writeFileSync(join(root, '.claude', 'commands', 'squad.md'), 'mount a team\n')
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'cx-version-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('computeHash', () => {
  it('é determinístico para o mesmo conteúdo', () => {
    seedAgentDirs()
    expect(computeHash(root)).toBe(computeHash(root))
  })

  it('muda quando o conteúdo de um prompt muda', () => {
    seedAgentDirs()
    const before = computeHash(root)
    writeFileSync(join(root, '.claude', 'agents', 'reviewer.md'), 'you are a STRICT reviewer\n')
    expect(computeHash(root)).not.toBe(before)
  })

  it('produz um hash de 7 chars mesmo sem diretórios (não fatal)', () => {
    const hash = computeHash(root)
    expect(hash).toMatch(/^[0-9a-f]{7}$/)
  })
})

describe('harnessVersion', () => {
  it('formata como {model}+{hash}', () => {
    seedAgentDirs()
    const version = harnessVersion('claude-opus-4-8', root)
    expect(version).toMatch(/^claude-opus-4-8\+[0-9a-f]{7}$/)
  })
})
