/**
 * Schema do harness de estimativa de complexidade (AGÊNTICO).
 *
 * Port TypeScript/Zod de docs/specs/harness-estimative.md (§4.1). Campos
 * preenchidos por AGENTES como subproduto da deliberação. Sinal numérico sem
 * `provenance` é opinião disfarçada de medida — ver Provenance / Metric.
 *
 * Fidelidade ao contrato: os campos em disco (JSONL) ficam em snake_case,
 * iguais ao schema pydantic original. Os derivados são funções camelCase
 * (idioma TS) em vez de métodos/getters.
 */

import { z } from 'zod'

export const SCHEMA_VERSION = '2.0'

export const Severity = z.enum(['low', 'medium', 'high', 'critical'])
export type Severity = z.infer<typeof Severity>

/** Banda qualitativa enquanto não houver dados p/ um float honesto. */
export const Band = z.enum(['low', 'medium', 'high'])
export type Band = z.infer<typeof Band>

export const Oversight = z.enum([
  'autonomous', // delega à IA, review leve
  'light_review', // humano revisa, sem pareamento
  'deep_review', // sênior + supervisão densa
])
export type Oversight = z.infer<typeof Oversight>

export const ScoreSource = z.enum([
  'heuristic', // pesos chutados — não confiar p/ decisão dura
  'calibrated', // pesos/tendências vindos da Camada 3
])
export type ScoreSource = z.infer<typeof ScoreSource>

export const Provenance = z.enum([
  'measured', // agente RODOU tool (grep/script/query) — reproduzível
  'estimated', // julgamento do agente — vibe, tratar com suspeita
])
export type Provenance = z.infer<typeof Provenance>

/** Sinal numérico que carrega COMO foi obtido. Nunca finja `measured`. */
export const Metric = z.object({
  value: z.number(),
  provenance: Provenance,
  // Se measured: o comando rodado. Se estimated: a base do palpite.
  evidence: z.string().nullable().default(null),
})
export type Metric = z.infer<typeof Metric>

export const Risk = z.object({
  description: z.string(),
  severity: Severity,
  raised_by: z.string().nullable().default(null), // qual agente levantou
})
export type Risk = z.infer<typeof Risk>

/** CAMADA 1 — sinais do grafo de dependências. Só é 'não-opinião' quando measured. */
export const StructuralSignals = z.object({
  downstream_fanout: Metric, // quem QUEBRA se eu mexer = blast radius
  upstream_fanout: Metric, // de quanto dependo = carga de contexto p/ entender
  domains_touched: z.array(z.string()).default([]),
  // NÃO estime centralidade por LLM. Só preencha se computou de verdade; senão null.
  max_node_centrality: Metric.nullable().default(null),
  touches_shared_contract: z.boolean(), // toca interface consumida por outros?
  touches_nondeterministic: z.boolean(), // toca prompt/IA em produção? Peso desproporcional.
})
export type StructuralSignals = z.infer<typeof StructuralSignals>

/** CAMADA 2 — subproduto da deliberação do time (quase de graça). */
export const AgentSignals = z.object({
  risks_raised: z.array(Risk).default([]),
  uncovered_angles_count: z.number().int().default(0),
  spec_branch_count: z.number().int().default(1),
  rounds_to_convergence: z.number().int(), // proxy de divergência
  disagreement_score: z.number().min(0).max(1).nullable().default(null), // 0=consenso, 1=conflito
})
export type AgentSignals = z.infer<typeof AgentSignals>

export const PredictionVector = z.object({
  issue_id: z.string(),
  predicted_at: z.string(), // ISO 8601
  schema_version: z.string().default(SCHEMA_VERSION),
  harness_version: z.string(), // {model}+{hash dos prompts/comandos} — controla drift

  structural: StructuralSignals,
  agents: AgentSignals,

  predicted_size: Band, // tamanho esperado do diff — melhor preditor de esforço
  predicted_iterations: Band,
  predicted_decision_density: Band, // intervenções de julgamento humano esperadas
  prediction_confidence: Band.default('medium'),

  complexity_score: z.number().nullable().default(null), // derivado; só p/ roteamento
  score_source: ScoreSource.default('heuristic'),

  // Decidido A PARTIR da predição e AFETA o outcome → variável de tratamento na calibração.
  assigned_oversight: Oversight,
  assigned_to: z.string().nullable().default(null), // NUNCA p/ ranquear pessoas
})
export type PredictionVector = z.infer<typeof PredictionVector>

/** Registrado pós-merge por um time SEPARADO (Phase 2). Factual vem de git/gh. */
export const OutcomeRecord = z.object({
  issue_id: z.string(),
  completed_at: z.string(),
  harness_version: z.string(),

  actual_files_touched: Metric, // git diff --name-only base...merge | wc -l
  actual_iterations: Metric, // ciclos de review + commits de correção pós-1º review
  actual_downstream_fanout: Metric, // fanout real recomputado pós-merge
  pr_review_cycles: Metric.nullable().default(null),
  time_to_merge_hours: Metric.nullable().default(null),

  revisited: z.boolean().default(false), // issue reaberta na janela
  revisit_window_days: z.number().int().default(30),
  rework_after_merge: z.boolean().default(false),

  escaped_to_production: z.boolean().default(false),
  nondeterministic_regression: z.boolean().nullable().default(null),

  // Único campo inerentemente julgado → estimated. Label mais ruidoso.
  actual_human_interventions: Metric,
})
export type OutcomeRecord = z.infer<typeof OutcomeRecord>

export const CalibrationPair = z.object({
  prediction: PredictionVector,
  outcome: OutcomeRecord,
})
export type CalibrationPair = z.infer<typeof CalibrationPair>

// ── Derivados (funções puras; equivalem aos @property do schema pydantic) ──

export function domainBoundariesCrossed(s: StructuralSignals): number {
  return Math.max(0, new Set(s.domains_touched).size - 1)
}

const RISK_WEIGHTS: Record<Severity, number> = { low: 1, medium: 3, high: 7, critical: 15 }

export function weightedRiskScore(a: AgentSignals): number {
  return a.risks_raised.reduce((sum, r) => sum + RISK_WEIGHTS[r.severity], 0)
}

/** >0 = discovery subestimou o alcance = sinal da qualidade do próprio harness. */
export function fanoutUnderestimate(pair: CalibrationPair): number {
  return (
    pair.outcome.actual_downstream_fanout.value - pair.prediction.structural.downstream_fanout.value
  )
}

export function sameHarness(pair: CalibrationPair): boolean {
  return pair.prediction.harness_version === pair.outcome.harness_version
}
