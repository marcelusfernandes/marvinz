import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { readOutcomes } from '../ledger.ts'
import { main } from '../record-outcome.ts'
import { makeOutcome } from './fixtures.ts'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'cx-outcome-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('record-outcome CLI', () => {
  it('JSON válido → exit 0 e anexa ao ledger', async () => {
    const code = await main(JSON.stringify(makeOutcome()), root)
    expect(code).toBe(0)
    expect(readOutcomes(root)).toHaveLength(1)
  })

  it('OutcomeRecord inválido → exit 1, nada anexado', async () => {
    const code = await main(JSON.stringify({ issue_id: '1' }), root)
    expect(code).toBe(1)
    expect(readOutcomes(root)).toEqual([])
  })

  it('JSON quebrado → exit 1', async () => {
    expect(await main('{not json', root)).toBe(1)
  })

  it('stdin vazio → exit 2', async () => {
    expect(await main('', root)).toBe(2)
    expect(await main('   \n ', root)).toBe(2)
  })

  it('nunca lança exceção (§1.9)', async () => {
    await expect(main('', root)).resolves.toBeTypeOf('number')
    await expect(main('{bad', root)).resolves.toBeTypeOf('number')
    await expect(main(JSON.stringify({}), root)).resolves.toBeTypeOf('number')
    await expect(main(JSON.stringify(makeOutcome()), root)).resolves.toBeTypeOf('number')
  })
})
