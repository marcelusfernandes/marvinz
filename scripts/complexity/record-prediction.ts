/**
 * CLI de emissão: lê um PredictionVector JSON do stdin, valida, anexa.
 * Exit: 0 ok / 1 inválido / 2 uso.
 *
 * A emissão é NÃO-FATAL (§1.9) — o fluxo de discovery trata exit!=0 sem abortar
 * a missão. Thin wrapper sobre runLedgerCli (#594); NUNCA lança exceção.
 */

import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { runLedgerCli } from './ledger-cli.ts'
import { appendPrediction } from './ledger.ts'
import { PredictionVector } from './schema.ts'

/**
 * @param stdinText  injetável p/ testes; se ausente, lê o stdin real.
 * @param repoRoot   injetável p/ testes; se ausente, usa a raiz do repo.
 */
export function main(stdinText?: string, repoRoot?: string): Promise<number> {
  return runLedgerCli({
    schema: PredictionVector,
    append: appendPrediction,
    schemaLabel: 'PredictionVector',
    recordLabel: 'prediction',
    stdinText,
    repoRoot,
  })
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : ''
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  // Top-level catch: garante que nem uma falha inesperada vire exceção não tratada.
  main()
    .then((code) => process.exit(code))
    .catch(() => process.exit(1))
}
