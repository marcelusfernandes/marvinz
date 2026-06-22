/**
 * CLI (Phase 2): lê o ledger, monta o TrendReport de UMA harness_version e o
 * imprime como JSON. Uso:
 *   tsx scripts/complexity/trend-report.ts [harness_version]
 * Sem argumento, usa a harness_version da predição mais recente no ledger.
 * Exit: 0 ok / 2 sem dados.
 */

import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { calibrationPairs, readPredictions } from './ledger.ts'
import { buildTrendReport } from './trend.ts'

function latestHarnessVersion(repoRoot?: string): string | null {
  const predictions = readPredictions(repoRoot)
  return predictions.length ? predictions[predictions.length - 1].harness_version : null
}

/**
 * @param argv        [harness_version?]
 * @param generatedAt ISO timestamp (injetável p/ testes determinísticos)
 * @param repoRoot    injetável p/ testes
 */
export function main(
  argv: string[] = process.argv.slice(2),
  generatedAt: string = new Date().toISOString(),
  repoRoot?: string
): number {
  const version = argv[0] ?? latestHarnessVersion(repoRoot)
  if (!version) {
    process.stderr.write(
      'error: nenhuma harness_version (ledger de predições vazio).\n' +
        'uso: tsx scripts/complexity/trend-report.ts [harness_version]\n'
    )
    return 2
  }
  const report = buildTrendReport(calibrationPairs(repoRoot), version, generatedAt)
  process.stdout.write(JSON.stringify(report, null, 2) + '\n')
  return 0
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : ''
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  try {
    process.exit(main())
  } catch {
    process.exit(1)
  }
}
