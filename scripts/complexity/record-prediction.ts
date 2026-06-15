/**
 * CLI de emissão: lê um PredictionVector JSON do stdin, valida, anexa.
 * Exit: 0 ok / 1 inválido / 2 uso.
 *
 * A emissão é NÃO-FATAL (§1.9) — o fluxo de discovery trata exit!=0 sem abortar
 * a missão. Este módulo NUNCA lança exceção: todo caminho de erro retorna um
 * exit code.
 */

import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { appendPrediction } from './ledger.ts'
import { PredictionVector } from './schema.ts'

function readStdin(): Promise<string> {
  return new Promise((resolveStdin, reject) => {
    let data = ''
    process.stdin.setEncoding('utf-8')
    process.stdin.on('data', (chunk) => {
      data += chunk
    })
    process.stdin.on('end', () => resolveStdin(data))
    process.stdin.on('error', reject)
  })
}

/**
 * @param stdinText  injetável p/ testes; se ausente, lê o stdin real.
 * @param repoRoot   injetável p/ testes; se ausente, usa a raiz do repo.
 */
export async function main(stdinText?: string, repoRoot?: string): Promise<number> {
  let raw: string
  try {
    raw = (stdinText ?? (await readStdin())).trim()
  } catch {
    process.stderr.write('error: falha ao ler stdin\n')
    return 2
  }

  if (!raw) {
    process.stderr.write('error: nenhum JSON no stdin\n')
    return 2
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    process.stderr.write(`error: JSON inválido: ${(error as Error).message}\n`)
    return 1
  }

  const result = PredictionVector.safeParse(parsed)
  if (!result.success) {
    process.stderr.write(`error: PredictionVector inválido:\n${result.error.message}\n`)
    return 1
  }

  try {
    const path = appendPrediction(result.data, repoRoot)
    process.stdout.write(`recorded prediction for issue ${result.data.issue_id} -> ${path}\n`)
    return 0
  } catch (error) {
    process.stderr.write(`error: falha ao anexar: ${(error as Error).message}\n`)
    return 1
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : ''
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  // Top-level catch: garante que nem uma falha inesperada vire exceção não tratada.
  main()
    .then((code) => process.exit(code))
    .catch(() => process.exit(1))
}
