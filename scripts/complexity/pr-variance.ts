/**
 * Check de variância no PR-open: compara o diff real com a predição da issue
 * e renderiza um comentário **advisory** (§1.7 — nunca bloqueia o merge; a
 * decisão de escalar review é humana, senão o flag vira tratamento e suja a
 * calibração).
 *
 * `buildVariance` e `renderComment` são PUROS (testáveis). O CLI lê a predição
 * do ledger + os actuals baratos (env, do diff) e imprime o comentário; o
 * workflow faz upsert dele na PR. Sem predição → advisory de cobertura (§503),
 * pedindo `/harness:predict`.
 */

import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { readPredictions } from './ledger.ts'
import type { PredictionVector } from './schema.ts'

export const VARIANCE_MARKER = '<!-- harness:variance -->'

export type Actuals = { filesTouched: number; downstreamFanout: number }

/** Severidade visual (§504). Heurística e provisória — recalibrada via #505. */
export type SeverityLevel = 'ok' | 'warn' | 'over'

const SEVERITY_EMOJI: Record<SeverityLevel, string> = { ok: '🟢', warn: '🟡', over: '🔴' }
const SEVERITY_RANK: Record<SeverityLevel, number> = { ok: 0, warn: 1, over: 2 }

export type Variance = {
  predicted_size: string
  predicted_fanout: number
  actual_fanout: number
  fanout_underestimate: number
  files_touched: number
  severity: SeverityLevel
  flags: string[]
}

// Orçamento grosseiro de arquivos por banda de tamanho (heurística, advisory).
const SIZE_FILE_BUDGET: Record<string, number> = {
  low: 5,
  medium: 20,
  high: Number.POSITIVE_INFINITY,
}

/**
 * Severidade por razão actual/esperado (só subestimativa importa). Cortes
 * heurísticos (§504): 🟢 ≤1.2× · 🟡 1.2–2× · 🔴 >2×. Quando o esperado é 0
 * (sem base de razão), usa valor absoluto: 🟡 ≥2 · 🔴 ≥4.
 */
export function ratioSeverity(actual: number, expected: number): SeverityLevel {
  if (expected <= 0) {
    if (actual >= 4) return 'over'
    if (actual >= 2) return 'warn'
    return 'ok'
  }
  const ratio = actual / expected
  if (ratio > 2) return 'over'
  if (ratio > 1.2) return 'warn'
  return 'ok'
}

function worst(a: SeverityLevel, b: SeverityLevel): SeverityLevel {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b
}

export function buildVariance(prediction: PredictionVector, actuals: Actuals): Variance {
  const predicted_fanout = prediction.structural.downstream_fanout.value
  const fanout_underestimate = actuals.downstreamFanout - predicted_fanout
  const flags: string[] = []
  if (fanout_underestimate > 0) {
    flags.push(
      `blast radius maior que o previsto: ${actuals.downstreamFanout} importers reais vs ${predicted_fanout} previstos (+${fanout_underestimate}).`
    )
  }
  const budget = SIZE_FILE_BUDGET[prediction.predicted_size] ?? Number.POSITIVE_INFINITY
  if (actuals.filesTouched > budget) {
    flags.push(
      `mais arquivos (${actuals.filesTouched}) que o esperado para size '${prediction.predicted_size}' (~${budget}).`
    )
  }
  // Severidade geral = pior entre fanout e arquivos (por razão actual/esperado).
  const severity = worst(
    ratioSeverity(actuals.downstreamFanout, predicted_fanout),
    ratioSeverity(actuals.filesTouched, budget)
  )
  return {
    predicted_size: prediction.predicted_size,
    predicted_fanout,
    actual_fanout: actuals.downstreamFanout,
    fanout_underestimate,
    files_touched: actuals.filesTouched,
    severity,
    flags,
  }
}

export function renderComment(v: Variance): string {
  // Badge de severidade no título → visível de relance, mesmo com o check verde (§504).
  const head = `${VARIANCE_MARKER}\n### ${SEVERITY_EMOJI[v.severity]} Harness — variância predição × diff (advisory)\n`
  const foot = '\n\n_Advisory — não bloqueia o merge; escalar review é decisão humana (§1.7)._'
  const summary = `predicted_size **${v.predicted_size}** · fanout previsto **${v.predicted_fanout}** vs real **${v.actual_fanout}** · arquivos **${v.files_touched}**`
  if (v.flags.length === 0) {
    return `${head}\nNenhuma variância relevante. ${summary}.${foot}`
  }
  return `${head}\n${summary}\n\n${v.flags.map((f) => `- ⚠️ ${f}`).join('\n')}${foot}`
}

/**
 * Advisory de cobertura: a issue não tem predição no ledger (§503). Sem o par
 * predição×outcome a calibração fica cega para esta issue. Não bloqueia (§1.7).
 */
export function renderNoPrediction(issueId: string): string {
  return (
    `${VARIANCE_MARKER}\n### 🔭 Harness — sem predição (advisory)\n\n` +
    `⚠️ A issue #${issueId} não tem **prediction** no ledger — sem ela não há par ` +
    `predição×outcome para calibrar. Rode \`/harness:predict ${issueId}\` na branch de ` +
    `trabalho para registrar a predição (issues criadas via \`/issues:create\` já a emitem).` +
    `\n\n_Advisory — não bloqueia o merge (§1.7)._`
  )
}

export function main(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
  repoRoot?: string
): number {
  const issueId = argv[0]
  if (!issueId) {
    process.stderr.write('usage: tsx scripts/complexity/pr-variance.ts <issue-id>\n')
    return 2
  }
  const files = Number(env.HARNESS_FILES)
  const fanout = Number(env.HARNESS_FANOUT)
  if (!Number.isFinite(files) || !Number.isFinite(fanout)) {
    process.stderr.write('error: HARNESS_FILES / HARNESS_FANOUT must be finite numbers\n')
    return 2
  }
  // Última predição da issue (last write wins).
  const prediction = [...readPredictions(repoRoot)].reverse().find((p) => p.issue_id === issueId)
  if (!prediction) {
    // Sem predição → advisory de cobertura (§503): pede pra rodar /harness:predict.
    process.stdout.write(renderNoPrediction(issueId) + '\n')
    return 0
  }
  const variance = buildVariance(prediction, { filesTouched: files, downstreamFanout: fanout })
  process.stdout.write(renderComment(variance) + '\n')
  return 0
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : ''
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  process.exit(main())
}
