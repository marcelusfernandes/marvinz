import { describe, expect, it } from 'vitest'

import {
  AgentSignals,
  Metric,
  PredictionVector,
  StructuralSignals,
  domainBoundariesCrossed,
  weightedRiskScore,
} from '../schema.ts'
import { makePrediction } from './fixtures.ts'

describe('PredictionVector', () => {
  it('valida um vetor de exemplo e aplica defaults honestos', () => {
    const parsed = PredictionVector.parse(makePrediction())
    expect(parsed.schema_version).toBe('2.1')
    expect(parsed.score_source).toBe('heuristic') // §1.8 — heuristic por padrão
    expect(parsed.prediction_confidence).toBe('medium')
    expect(parsed.complexity_score).toBeNull()
    expect(parsed.assigned_to).toBeNull()
  })

  it('deixa max_node_centrality null por padrão (§1.3 — não estimar centralidade)', () => {
    const parsed = PredictionVector.parse(makePrediction())
    expect(parsed.structural.max_node_centrality).toBeNull()
  })

  it('rejeita um vetor malformado (campo obrigatório ausente)', () => {
    const bad = makePrediction({ agents: { risks_raised: [] } }) // sem rounds_to_convergence
    expect(PredictionVector.safeParse(bad).success).toBe(false)
  })

  it('rejeita predicted_size fora da banda', () => {
    expect(PredictionVector.safeParse(makePrediction({ predicted_size: 'epic' })).success).toBe(
      false
    )
  })
})

describe('Metric', () => {
  it('exige provenance válido — float sem proveniência é mentira (§1.2)', () => {
    expect(Metric.safeParse({ value: 1, provenance: 'measured' }).success).toBe(true)
    expect(Metric.safeParse({ value: 1, provenance: 'vibes' }).success).toBe(false)
    expect(Metric.safeParse({ value: 1 }).success).toBe(false)
  })

  it('default de evidence é null', () => {
    expect(Metric.parse({ value: 1, provenance: 'estimated' }).evidence).toBeNull()
  })
})

describe('AgentSignals.disagreement_score', () => {
  it('aceita [0,1] e rejeita fora do intervalo', () => {
    const base = { risks_raised: [], rounds_to_convergence: 1 }
    expect(AgentSignals.safeParse({ ...base, disagreement_score: 0.5 }).success).toBe(true)
    expect(AgentSignals.safeParse({ ...base, disagreement_score: 1.5 }).success).toBe(false)
  })
})

describe('derivados', () => {
  it('weightedRiskScore soma pesos por severidade', () => {
    const agents = AgentSignals.parse({
      risks_raised: [
        { description: 'a', severity: 'low' },
        { description: 'b', severity: 'high' },
        { description: 'c', severity: 'critical' },
      ],
      rounds_to_convergence: 1,
    })
    expect(weightedRiskScore(agents)).toBe(1 + 7 + 15)
  })

  it('domainBoundariesCrossed deduplica e nunca é negativo', () => {
    const one = StructuralSignals.parse({
      downstream_fanout: { value: 0, provenance: 'measured' },
      upstream_fanout: { value: 0, provenance: 'measured' },
      domains_touched: ['chat', 'chat', 'editor'],
      touches_shared_contract: false,
      touches_nondeterministic: false,
    })
    expect(domainBoundariesCrossed(one)).toBe(1)

    const empty = StructuralSignals.parse({
      downstream_fanout: { value: 0, provenance: 'measured' },
      upstream_fanout: { value: 0, provenance: 'measured' },
      touches_shared_contract: false,
      touches_nondeterministic: false,
    })
    expect(domainBoundariesCrossed(empty)).toBe(0)
  })
})
