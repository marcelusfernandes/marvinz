import { describe, expect, it, vi } from 'vitest'

import { OutcomeRecord } from '../schema.ts'
import { buildOutcome, main, type PrFacts } from '../measure-outcome.ts'

const FACTS: PrFacts = {
  issueId: '429',
  harnessVersion: 'claude-opus-4-8+4fca3fa',
  prNumber: 487,
  mergeSha: '55ad81e0000000000000000000000000000000aa',
  filesTouched: 12,
  actualIterations: 2,
  downstreamFanout: 5,
  prReviewCycles: 5,
  changesRequested: 0,
  createdAt: '2026-05-30T22:27:03Z',
  mergedAt: '2026-05-30T22:56:24Z',
}

function envFor(facts: PrFacts): NodeJS.ProcessEnv {
  return {
    HARNESS_ISSUE: facts.issueId,
    HARNESS_VERSION: facts.harnessVersion,
    HARNESS_PR_NUMBER: String(facts.prNumber),
    HARNESS_MERGE_SHA: facts.mergeSha,
    HARNESS_FILES: String(facts.filesTouched),
    HARNESS_ITERATIONS: String(facts.actualIterations),
    HARNESS_FANOUT: String(facts.downstreamFanout),
    HARNESS_REVIEW_CYCLES: String(facts.prReviewCycles),
    HARNESS_CHANGES_REQUESTED: String(facts.changesRequested),
    HARNESS_CREATED_AT: facts.createdAt,
    HARNESS_MERGED_AT: facts.mergedAt,
  }
}

describe('buildOutcome', () => {
  it('produz um OutcomeRecord válido com proveniências corretas', () => {
    const outcome = buildOutcome(FACTS)
    expect(OutcomeRecord.safeParse(outcome).success).toBe(true)
    expect(outcome.issue_id).toBe('429')
    expect(outcome.actual_files_touched.provenance).toBe('measured')
    expect(outcome.actual_downstream_fanout.value).toBe(5)
  })

  it('calcula time_to_merge_hours a partir das datas', () => {
    const outcome = buildOutcome(FACTS) // 22:27:03 → 22:56:24 = 29min21s ≈ 0.49h
    expect(outcome.time_to_merge_hours?.value).toBeCloseTo(0.49, 2)
  })

  it('human_interventions é estimated (proxy), nunca measured (§1.4)', () => {
    const outcome = buildOutcome({ ...FACTS, changesRequested: 3 })
    expect(outcome.actual_human_interventions.provenance).toBe('estimated')
    expect(outcome.actual_human_interventions.value).toBe(3)
    expect(outcome.actual_human_interventions.evidence).toContain('NOT human-judged')
  })

  it('carrega pr_number e merge_sha p/ rastreabilidade do deep-dive', () => {
    const outcome = buildOutcome(FACTS)
    expect(outcome.pr_number).toBe(487)
    expect(outcome.merge_sha).toBe('55ad81e0000000000000000000000000000000aa')
  })
})

describe('measure-outcome CLI (env-driven)', () => {
  it('env completo → exit 0 e imprime o JSON', () => {
    const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    expect(main(envFor(FACTS))).toBe(0)
    expect(write).toHaveBeenCalledOnce()
    write.mockRestore()
  })

  it('env faltando → exit 2', () => {
    const env = envFor(FACTS)
    delete env.HARNESS_VERSION
    expect(main(env)).toBe(2)
  })

  it('valor numérico inválido → exit 2', () => {
    expect(main({ ...envFor(FACTS), HARNESS_FILES: 'abc' })).toBe(2)
  })
})
