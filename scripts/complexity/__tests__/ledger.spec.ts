import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  appendOutcome,
  appendPrediction,
  calibrationPairs,
  readOutcomes,
  readPredictions,
} from '../ledger.ts'
import { OutcomeRecord, PredictionVector } from '../schema.ts'
import { makeOutcome, makePrediction } from './fixtures.ts'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'cx-ledger-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('ledger vazio', () => {
  it('retorna [] quando não há arquivos', () => {
    expect(readPredictions(root)).toEqual([])
    expect(readOutcomes(root)).toEqual([])
    expect(calibrationPairs(root)).toEqual([])
  })
})

describe('round-trip', () => {
  it('anexa e relê predições', () => {
    appendPrediction(PredictionVector.parse(makePrediction()), root)
    const read = readPredictions(root)
    expect(read).toHaveLength(1)
    expect(read[0].issue_id).toBe('426')
  })
})

describe('calibrationPairs', () => {
  it('pareia predição e outcome pelo issue_id', () => {
    appendPrediction(PredictionVector.parse(makePrediction({ issue_id: '100' })), root)
    appendOutcome(OutcomeRecord.parse(makeOutcome({ issue_id: '100' })), root)
    const pairs = calibrationPairs(root)
    expect(pairs).toHaveLength(1)
    expect(pairs[0].prediction.issue_id).toBe('100')
    expect(pairs[0].outcome.issue_id).toBe('100')
  })

  it('exclui pares de harness_version divergente (§1.5)', () => {
    appendPrediction(
      PredictionVector.parse(makePrediction({ issue_id: '101', harness_version: 'model+aaaaaaa' })),
      root,
    )
    appendOutcome(
      OutcomeRecord.parse(makeOutcome({ issue_id: '101', harness_version: 'model+bbbbbbb' })),
      root,
    )
    expect(calibrationPairs(root)).toEqual([])
  })

  it('last-write-wins por issue_id', () => {
    appendPrediction(
      PredictionVector.parse(makePrediction({ issue_id: '102', predicted_size: 'low' })),
      root,
    )
    appendPrediction(
      PredictionVector.parse(makePrediction({ issue_id: '102', predicted_size: 'high' })),
      root,
    )
    appendOutcome(OutcomeRecord.parse(makeOutcome({ issue_id: '102' })), root)
    const pairs = calibrationPairs(root)
    expect(pairs).toHaveLength(1)
    expect(pairs[0].prediction.predicted_size).toBe('high') // segundo vence
  })

  it('ignora predição sem outcome correspondente', () => {
    appendPrediction(PredictionVector.parse(makePrediction({ issue_id: '103' })), root)
    expect(calibrationPairs(root)).toEqual([])
  })
})
