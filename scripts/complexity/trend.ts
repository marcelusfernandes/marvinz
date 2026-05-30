/**
 * CAMADA 3 — trend card. Leitura DIRECIONAL dos sinais a priori contra o outcome
 * factual (proxy de dificuldade = `actual_iterations`). NÃO é regressão (§1.8):
 * com N pequeno, ajustar pesos confabula. Emite direção + nº de exemplos +
 * confiança honesta. `score_source` segue `heuristic` de propósito.
 *
 * Tendência só vale DENTRO de uma `harness_version` (§1.5) — o builder filtra.
 */

import { TrendReport, weightedRiskScore } from './schema.ts'
import type { Band, CalibrationPair, SignalTrend } from './schema.ts'

const BAND_ORDINAL: Record<Band, number> = { low: 0, medium: 1, high: 2 }

const iterationsOf = (p: CalibrationPair): number => p.outcome.actual_iterations.value

export function median(xs: number[]): number {
  if (xs.length === 0) return Number.NaN
  const sorted = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** Confiança honesta pelo nº de exemplos: <8 fraco, 8–19 sugestivo, ≥20 consistente. */
export function confidenceFor(n: number): Band {
  if (n < 8) return 'low'
  if (n < 20) return 'medium'
  return 'high'
}

/** Sinal binário: compara a mediana de iterações entre os grupos true/false. */
export function binaryTrend(
  name: string,
  getBool: (p: CalibrationPair) => boolean,
  pairs: CalibrationPair[],
  measuredOnly: boolean,
): SignalTrend | null {
  const yes = pairs.filter(getBool)
  const no = pairs.filter((p) => !getBool(p))
  if (yes.length === 0 || no.length === 0) return null // sem contraste → nada a dizer
  const my = median(yes.map(iterationsOf))
  const mn = median(no.map(iterationsOf))
  const direction =
    my === mn
      ? `${name}: sem diferença de iterações (mediana ${my} em ambos os grupos)`
      : `${name}=true → ${my > mn ? 'mais' : 'menos'} iterações (mediana ${my} vs ${mn})`
  return {
    signal_name: name,
    direction,
    supporting_examples: pairs.length,
    confidence: confidenceFor(pairs.length),
    based_on_measured_only: measuredOnly,
    note: null,
  }
}

/** Sinal ordinal: sinal do co-movimento (Kendall) entre o sinal e as iterações. */
export function ordinalTrend(
  name: string,
  getNum: (p: CalibrationPair) => number,
  pairs: CalibrationPair[],
  measuredOnly: boolean,
): SignalTrend | null {
  if (pairs.length < 3) return null // co-movimento precisa de variação mínima
  let concordant = 0
  let discordant = 0
  for (let i = 0; i < pairs.length; i++) {
    for (let j = i + 1; j < pairs.length; j++) {
      const s = Math.sign(getNum(pairs[i]) - getNum(pairs[j])) * Math.sign(iterationsOf(pairs[i]) - iterationsOf(pairs[j]))
      if (s > 0) concordant++
      else if (s < 0) discordant++
    }
  }
  if (concordant === 0 && discordant === 0) return null // sem variação → nada a dizer
  const sign = Math.sign(concordant - discordant)
  const tail = `(${concordant} concordantes vs ${discordant} discordantes)`
  const direction =
    sign === 0
      ? `${name}: co-movimento ambíguo com iterações ${tail}`
      : `${name} maior → ${sign > 0 ? 'mais' : 'menos'} iterações ${tail}`
  return {
    signal_name: name,
    direction,
    supporting_examples: pairs.length,
    confidence: confidenceFor(pairs.length),
    based_on_measured_only: measuredOnly,
    note: null,
  }
}

/**
 * Auditoria do roteamento: onde `assigned_oversight` parece sub/super-estimado
 * frente à dificuldade real. Tratado como variável de tratamento (§1.7), não
 * como label limpo — por isso é texto, não veredito.
 */
export function routingAudit(pairs: CalibrationPair[]): string {
  if (pairs.length === 0) return 'sem pares para auditar o roteamento.'
  const med = median(pairs.map(iterationsOf))
  const under = pairs.filter(
    (p) => p.prediction.assigned_oversight === 'autonomous' && iterationsOf(p) > med,
  ).length
  const over = pairs.filter(
    (p) => p.prediction.assigned_oversight === 'deep_review' && iterationsOf(p) < med,
  ).length
  return [
    `mediana de iterações: ${med} sobre ${pairs.length} pares.`,
    `sub-provisionados (autonomous + iterações > mediana): ${under}.`,
    `super-provisionados (deep_review + iterações < mediana): ${over}.`,
  ].join(' ')
}

/** Monta o TrendReport sobre os pares de UMA harness_version. */
export function buildTrendReport(
  allPairs: CalibrationPair[],
  harnessVersion: string,
  generatedAt: string,
): TrendReport {
  const pairs = allPairs.filter((p) => p.prediction.harness_version === harnessVersion)
  const trends: SignalTrend[] = []

  if (pairs.length >= 2) {
    const dfMeasured = pairs.every((p) => p.prediction.structural.downstream_fanout.provenance === 'measured')
    const ufMeasured = pairs.every((p) => p.prediction.structural.upstream_fanout.provenance === 'measured')
    const candidates = [
      ordinalTrend('downstream_fanout', (p) => p.prediction.structural.downstream_fanout.value, pairs, dfMeasured),
      ordinalTrend('upstream_fanout', (p) => p.prediction.structural.upstream_fanout.value, pairs, ufMeasured),
      // weighted_risk_score e predicted_size vêm de julgamento do agente, não de tool → não-measured.
      ordinalTrend('weighted_risk_score', (p) => weightedRiskScore(p.prediction.agents), pairs, false),
      ordinalTrend('predicted_size', (p) => BAND_ORDINAL[p.prediction.predicted_size], pairs, false),
      binaryTrend('touches_nondeterministic', (p) => p.prediction.structural.touches_nondeterministic, pairs, true),
      binaryTrend('touches_shared_contract', (p) => p.prediction.structural.touches_shared_contract, pairs, true),
    ]
    for (const trend of candidates) if (trend) trends.push(trend)
  }

  return TrendReport.parse({
    generated_at: generatedAt,
    harness_version: harnessVersion,
    pairs_analyzed: pairs.length,
    trends,
    routing_audit: routingAudit(pairs),
    score_source: 'heuristic',
  })
}
