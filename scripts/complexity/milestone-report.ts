/**
 * Rollup por milestone (§505): um milestone é o acúmulo das suas sub-issues, então
 * sua "calibração" é a agregação dos pares predição×outcome cujas issues pertencem
 * a ele. A pertinência issue→milestone NÃO está no ledger — vem do `gh` (o workflow
 * passa os issue_ids como args), mantendo este módulo puro e testável.
 *
 * Leitura DIRECIONAL, não estimador (§1.8): conta pares + medianas honestas.
 */

import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { calibrationPairs } from './ledger.ts'
import { fanoutUnderestimate } from './schema.ts'
import type { CalibrationPair } from './schema.ts'
import { median } from './trend.ts'

export type MilestoneReport = {
  milestone: string
  issues_in_milestone: number
  pairs_found: number
  median_iterations: number | null
  median_fanout_underestimate: number | null
  fanout_underestimated: number // pares onde o fanout real superou o previsto
}

export function buildMilestoneReport(
  pairs: CalibrationPair[],
  issueIds: string[],
  milestone: string
): MilestoneReport {
  const ids = new Set(issueIds)
  const mp = pairs.filter((p) => ids.has(p.prediction.issue_id))
  const underestimates = mp.map(fanoutUnderestimate)
  return {
    milestone,
    issues_in_milestone: ids.size,
    pairs_found: mp.length,
    median_iterations: mp.length ? median(mp.map((p) => p.outcome.actual_iterations.value)) : null,
    median_fanout_underestimate: mp.length ? median(underestimates) : null,
    fanout_underestimated: underestimates.filter((x) => x > 0).length,
  }
}

export function renderMilestoneReport(r: MilestoneReport): string {
  if (r.pairs_found === 0) {
    return `**${r.milestone}** — ${r.issues_in_milestone} issues, 0 calibration pairs yet.`
  }
  return [
    `**${r.milestone}** — ${r.pairs_found}/${r.issues_in_milestone} issues with prediction×outcome pairs`,
    `- median iterations: ${r.median_iterations}`,
    `- median fanout underestimate: ${r.median_fanout_underestimate}`,
    `- fanout underestimated in ${r.fanout_underestimated}/${r.pairs_found} pairs`,
  ].join('\n')
}

/**
 * @param argv     [milestone, ...issueIds]
 * @param repoRoot injetável p/ testes
 */
export function main(argv: string[] = process.argv.slice(2), repoRoot?: string): number {
  const milestone = argv[0]
  const issueIds = argv.slice(1)
  if (!milestone || issueIds.length === 0) {
    process.stderr.write(
      'usage: tsx scripts/complexity/milestone-report.ts <milestone> <issueId...>\n'
    )
    return 2
  }
  const report = buildMilestoneReport(calibrationPairs(repoRoot), issueIds, milestone)
  process.stdout.write(renderMilestoneReport(report) + '\n')
  return 0
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : ''
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  process.exit(main())
}
