import { describe, expect, it } from 'vitest'

import { buildMilestoneReport, main, renderMilestoneReport } from '../milestone-report.ts'
import { CalibrationPair } from '../schema.ts'
import { makeOutcome, makePrediction } from './fixtures.ts'

function pair(
  issueId: string,
  outcomeOverrides: Record<string, unknown> = {}
): ReturnType<typeof CalibrationPair.parse> {
  return CalibrationPair.parse({
    prediction: makePrediction({ issue_id: issueId }),
    outcome: makeOutcome({ issue_id: issueId, ...outcomeOverrides }),
  })
}

const iters = (n: number) => ({
  actual_iterations: { value: n, provenance: 'measured', evidence: 'x' },
})

describe('buildMilestoneReport', () => {
  it('agrega só os pares cujas issues pertencem ao milestone', () => {
    const pairs = [pair('1', iters(2)), pair('2', iters(4)), pair('99', iters(9))]
    const r = buildMilestoneReport(pairs, ['1', '2'], 'M1')
    expect(r.pairs_found).toBe(2)
    expect(r.issues_in_milestone).toBe(2)
    expect(r.median_iterations).toBe(3) // median(2, 4)
  })

  it('milestone sem pares → pairs_found 0 e medianas null', () => {
    const r = buildMilestoneReport([], ['1', '2'], 'Empty')
    expect(r.pairs_found).toBe(0)
    expect(r.median_iterations).toBeNull()
    expect(r.median_fanout_underestimate).toBeNull()
  })
})

describe('renderMilestoneReport', () => {
  it('0 pares → linha curta', () => {
    const out = renderMilestoneReport(buildMilestoneReport([], ['1'], 'M'))
    expect(out).toContain('0 calibration pairs')
  })

  it('com pares → inclui contagem e medianas', () => {
    const out = renderMilestoneReport(buildMilestoneReport([pair('1', iters(2))], ['1'], 'M'))
    expect(out).toContain('1/1 issues')
    expect(out).toContain('median iterations')
  })
})

describe('milestone-report CLI', () => {
  it('sem args → exit 2', () => {
    expect(main([])).toBe(2)
  })
})
