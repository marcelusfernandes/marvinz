/**
 * CLI de medição (Phase 2): lê um OutcomeRecord JSON do stdin, valida, anexa.
 * Exit: 0 ok / 1 inválido / 2 uso.
 *
 * Disparado PÓS-MERGE por um comando/time SEPARADO de quem prediz e de quem
 * implementa (§1.6). O factual vem de git/gh; só `actual_human_interventions`
 * é julgado (`estimated`). As definições operacionais estão TRAVADAS no README
 * antes de coletar o 1º registro (§1.4) — não invente campos na hora.
 *
 * Thin wrapper sobre runLedgerCli (#594); NUNCA lança exceção.
 */

import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { runLedgerCli } from './ledger-cli.ts'
import { appendOutcome } from './ledger.ts'
import { OutcomeRecord } from './schema.ts'

/**
 * @param stdinText  injetável p/ testes; se ausente, lê o stdin real.
 * @param repoRoot   injetável p/ testes; se ausente, usa a raiz do repo.
 */
export function main(stdinText?: string, repoRoot?: string): Promise<number> {
  return runLedgerCli({
    schema: OutcomeRecord,
    append: appendOutcome,
    schemaLabel: 'OutcomeRecord',
    recordLabel: 'outcome',
    stdinText,
    repoRoot,
  })
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : ''
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  main()
    .then((code) => process.exit(code))
    .catch(() => process.exit(1))
}
