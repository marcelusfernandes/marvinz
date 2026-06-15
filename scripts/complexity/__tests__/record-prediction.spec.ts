import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { readPredictions } from '../ledger.ts'
import { main } from '../record-prediction.ts'
import { makePrediction } from './fixtures.ts'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'cx-cli-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('record-prediction CLI', () => {
  it('JSON válido → exit 0 e anexa ao ledger', async () => {
    const code = await main(JSON.stringify(makePrediction()), root)
    expect(code).toBe(0)
    expect(readPredictions(root)).toHaveLength(1)
  })

  it('PredictionVector inválido → exit 1, nada anexado', async () => {
    const code = await main(JSON.stringify({ issue_id: '1' }), root)
    expect(code).toBe(1)
    expect(readPredictions(root)).toEqual([])
  })

  it('JSON sintaticamente quebrado → exit 1', async () => {
    expect(await main('{not json', root)).toBe(1)
  })

  it('stdin vazio → exit 2', async () => {
    expect(await main('', root)).toBe(2)
    expect(await main('   \n  ', root)).toBe(2)
  })

  it('nunca lança exceção (§1.9) — todo caminho resolve num exit code', async () => {
    await expect(main('', root)).resolves.toBeTypeOf('number')
    await expect(main('{bad', root)).resolves.toBeTypeOf('number')
    await expect(main(JSON.stringify({}), root)).resolves.toBeTypeOf('number')
    await expect(main(JSON.stringify(makePrediction()), root)).resolves.toBeTypeOf('number')
  })
})
