/**
 * Check de variância no PR-open: compara o diff real com a predição da issue
 * e renderiza um comentário **advisory** (§1.7 — nunca bloqueia o merge; a
 * decisão de escalar review é humana, senão o flag vira tratamento e suja a
 * calibração).
 *
 * `buildVariance` e `renderComment` são PUROS (testáveis). O CLI lê a predição
 * do ledger + os actuals baratos (env, do diff) e imprime o comentário; o
 * workflow faz upsert dele na PR. Sem predição → imprime nada (no-op).
 */

import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { readPredictions } from './ledger.ts'
import type { PredictionVector } from './schema.ts'

export const VARIANCE_MARKER = '<!-- harness:variance -->'

export type Actuals = { filesTouched: number; downstreamFanout: number }

export type Variance = {
  predicted_size: string
  predicted_fanout: number
  actual_fanout: number
  fanout_underestimate: number
  files_touched: number
  flags: string[]
}

// Orçamento grosseiro de arquivos por banda de tamanho (heurística, advisory).
const SIZE_FILE_BUDGET: Record<string, number> = { low: 5, medium: 20, high: Number.POSITIVE_INFINITY }

export function buildVariance(prediction: PredictionVector, actuals: Actuals): Variance {
  const predicted_fanout = prediction.structural.downstream_fanout.value
  const fanout_underestimate = actuals.downstreamFanout - predicted_fanout
  const flags: string[] = []
  if (fanout_underestimate > 0) {
    flags.push(
      `blast radius maior que o previsto: ${actuals.downstreamFanout} importers reais vs ${predicted_fanout} previstos (+${fanout_underestimate}).`,
    )
  }
  const budget = SIZE_FILE_BUDGET[prediction.predicted_size] ?? Number.POSITIVE_INFINITY
  if (actuals.filesTouched > budget) {
    flags.push(
      `mais arquivos (${actuals.filesTouched}) que o esperado para size '${prediction.predicted_size}' (~${budget}).`,
    )
  }
  return {
    predicted_size: prediction.predicted_size,
    predicted_fanout,
    actual_fanout: actuals.downstreamFanout,
    fanout_underestimate,
    files_touched: actuals.filesTouched,
    flags,
  }
}

export function renderComment(v: Variance): string {
  const head = `${VARIANCE_MARKER}\n### 🔭 Harness — variância predição × diff (advisory)\n`
  const foot = '\n\n_Advisory — não bloqueia o merge; escalar review é decisão humana (§1.7)._'
  const summary = `predicted_size **${v.predicted_size}** · fanout previsto **${v.predicted_fanout}** vs real **${v.actual_fanout}** · arquivos **${v.files_touched}**`
  if (v.flags.length === 0) {
    return `${head}\nNenhuma variância relevante. ${summary}.${foot}`
  }
  return `${head}\n${summary}\n\n${v.flags.map((f) => `- ⚠️ ${f}`).join('\n')}${foot}`
}

export function main(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
  repoRoot?: string,
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
    // Sem predição → no-op advisory. Imprime nada; o workflow não comenta.
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
