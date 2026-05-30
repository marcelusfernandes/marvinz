import { describe, expect, it } from 'vitest'

import {
  binaryTrend,
  buildTrendReport,
  confidenceFor,
  median,
  ordinalTrend,
  routingAudit,
} from '../trend.ts'
import { OutcomeRecord, PredictionVector, type CalibrationPair } from '../schema.ts'
import { makeOutcome, makePrediction } from './fixtures.ts'

function mkPair(opts: {
  id: string
  nd?: boolean
  shared?: boolean
  fanout?: number
  iters: number
  oversight?: 'autonomous' | 'light_review' | 'deep_review'
  version?: string
}): CalibrationPair {
  const version = opts.version ?? 'v1'
  const base = makePrediction({ issue_id: opts.id })
  const structural: Record<string, unknown> = {
    ...(base.structural as Record<string, unknown>),
    touches_nondeterministic: opts.nd ?? false,
    touches_shared_contract: opts.shared ?? false,
  }
  if (opts.fanout !== undefined) {
    structural.downstream_fanout = { value: opts.fanout, provenance: 'measured', evidence: 'grep' }
  }
  const prediction = PredictionVector.parse({
    ...base,
    structural,
    harness_version: version,
    assigned_oversight: opts.oversight ?? 'light_review',
  })
  const outcome = OutcomeRecord.parse(
    makeOutcome({
      issue_id: opts.id,
      harness_version: version,
      actual_iterations: { value: opts.iters, provenance: 'measured', evidence: 'gh pr view' },
    }),
  )
  return { prediction, outcome }
}

describe('median / confidenceFor', () => {
  it('median de ímpares e pares', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([1, 2, 3, 4])).toBe(2.5)
    expect(median([])).toBeNaN()
  })

  it('confiança honesta por nº de exemplos', () => {
    expect(confidenceFor(3)).toBe('low') // fraco
    expect(confidenceFor(10)).toBe('medium') // sugestivo
    expect(confidenceFor(25)).toBe('high') // consistente
  })
})

describe('binaryTrend', () => {
  it('compara mediana de iterações entre grupos true/false', () => {
    const pairs = [
      mkPair({ id: '1', nd: true, iters: 5 }),
      mkPair({ id: '2', nd: true, iters: 4 }),
      mkPair({ id: '3', nd: false, iters: 2 }),
      mkPair({ id: '4', nd: false, iters: 1 }),
    ]
    const t = binaryTrend('touches_nondeterministic', (p) => p.prediction.structural.touches_nondeterministic, pairs, true)
    expect(t).not.toBeNull()
    expect(t!.direction).toContain('mais iterações')
    expect(t!.supporting_examples).toBe(4)
    expect(t!.confidence).toBe('low')
  })

  it('sem contraste (só um grupo) → null', () => {
    const pairs = [mkPair({ id: '1', nd: true, iters: 5 }), mkPair({ id: '2', nd: true, iters: 4 })]
    expect(binaryTrend('touches_nondeterministic', (p) => p.prediction.structural.touches_nondeterministic, pairs, true)).toBeNull()
  })
})

describe('ordinalTrend', () => {
  it('co-movimento concordante → "mais iterações"', () => {
    const pairs = [
      mkPair({ id: '1', fanout: 1, iters: 1 }),
      mkPair({ id: '2', fanout: 2, iters: 2 }),
      mkPair({ id: '3', fanout: 3, iters: 3 }),
    ]
    const t = ordinalTrend('downstream_fanout', (p) => p.prediction.structural.downstream_fanout.value, pairs, true)
    expect(t).not.toBeNull()
    expect(t!.direction).toContain('mais iterações')
  })

  it('< 3 pares → null (variação insuficiente)', () => {
    const pairs = [mkPair({ id: '1', fanout: 1, iters: 1 }), mkPair({ id: '2', fanout: 2, iters: 2 })]
    expect(ordinalTrend('downstream_fanout', (p) => p.prediction.structural.downstream_fanout.value, pairs, true)).toBeNull()
  })
})

describe('routingAudit', () => {
  it('conta sub-provisionados (autonomous + iterações > mediana)', () => {
    const pairs = [
      mkPair({ id: '1', oversight: 'autonomous', iters: 10 }),
      mkPair({ id: '2', oversight: 'light_review', iters: 1 }),
    ]
    expect(routingAudit(pairs)).toContain('sub-provisionados (autonomous + iterações > mediana): 1')
  })

  it('sem pares → mensagem honesta', () => {
    expect(routingAudit([])).toContain('sem pares')
  })
})

describe('buildTrendReport', () => {
  it('filtra por harness_version e mantém score_source heuristic (§1.8)', () => {
    const pairs = [
      mkPair({ id: '1', nd: true, iters: 5, version: 'v1' }),
      mkPair({ id: '2', nd: false, iters: 1, version: 'v1' }),
      mkPair({ id: '3', nd: true, iters: 9, version: 'v2' }), // outra versão → excluído
    ]
    const report = buildTrendReport(pairs, 'v1', '2026-01-01T00:00:00Z')
    expect(report.harness_version).toBe('v1')
    expect(report.pairs_analyzed).toBe(2)
    expect(report.score_source).toBe('heuristic')
    expect(report.trends.length).toBeGreaterThan(0)
  })

  it('ledger vazio → relatório honesto, sem tendências', () => {
    const report = buildTrendReport([], 'v1', '2026-01-01T00:00:00Z')
    expect(report.pairs_analyzed).toBe(0)
    expect(report.trends).toEqual([])
    expect(report.routing_audit).toContain('sem pares')
  })
})
