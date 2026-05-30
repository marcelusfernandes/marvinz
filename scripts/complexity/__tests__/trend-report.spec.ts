import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { appendOutcome, appendPrediction } from '../ledger.ts'
import { OutcomeRecord, PredictionVector } from '../schema.ts'
import { main } from '../trend-report.ts'
import { makeOutcome, makePrediction } from './fixtures.ts'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'cx-trend-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('trend-report CLI', () => {
  it('ledger de predições vazio e sem arg → exit 2', () => {
    expect(main([], '2026-01-01T00:00:00Z', root)).toBe(2)
  })

  it('com harness_version e pares → exit 0', () => {
    vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    appendPrediction(PredictionVector.parse(makePrediction({ issue_id: '1', harness_version: 'v1' })), root)
    appendOutcome(OutcomeRecord.parse(makeOutcome({ issue_id: '1', harness_version: 'v1' })), root)
    expect(main(['v1'], '2026-01-01T00:00:00Z', root)).toBe(0)
  })

  it('sem arg usa a harness_version da predição mais recente', () => {
    vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    appendPrediction(PredictionVector.parse(makePrediction({ issue_id: '1', harness_version: 'vX' })), root)
    expect(main([], '2026-01-01T00:00:00Z', root)).toBe(0)
  })
})
