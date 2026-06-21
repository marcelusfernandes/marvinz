/**
 * Mede o OutcomeRecord de uma issue a partir de fatos coletados de git/gh.
 * `buildOutcome` é PURO (testável); o CLI lê os fatos de variáveis de ambiente
 * que o GitHub Action preenche (gh/jq), monta o OutcomeRecord e imprime o JSON
 * — que o workflow pipa para `record-outcome`.
 *
 * Definições TRAVADAS no README (§1.4). Os campos factuais são `measured`; o
 * único `estimated` é `actual_human_interventions`, que uma Action não julga —
 * usa um proxy transparente (nº de reviews CHANGES_REQUESTED), marcado como tal.
 */

import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { OutcomeRecord } from './schema.ts'
import type { OutcomeRecord as OutcomeRecordType } from './schema.ts'

export type PrFacts = {
  issueId: string
  harnessVersion: string
  prNumber: number | null // ponteiro de rastreabilidade p/ deep-dive (null se ausente)
  mergeSha: string | null // ponteiro de rastreabilidade p/ deep-dive (null se ausente)
  filesTouched: number
  actualIterations: number // review cycles + correction commits pós-1º review
  downstreamFanout: number
  prReviewCycles: number
  changesRequested: number // proxy auto p/ human interventions (não-julgado)
  createdAt: string // ISO 8601
  mergedAt: string // ISO 8601
}

function hoursBetween(startIso: string, endIso: string): number {
  const ms = Date.parse(endIso) - Date.parse(startIso)
  return Math.round((ms / 3_600_000) * 100) / 100
}

export function buildOutcome(f: PrFacts): OutcomeRecordType {
  return OutcomeRecord.parse({
    issue_id: f.issueId,
    completed_at: f.mergedAt,
    harness_version: f.harnessVersion,
    pr_number: f.prNumber,
    merge_sha: f.mergeSha,
    actual_files_touched: {
      value: f.filesTouched,
      provenance: 'measured',
      evidence: 'gh pr view --json files | length',
    },
    actual_iterations: {
      value: f.actualIterations,
      provenance: 'measured',
      evidence:
        'review submissions + correction commits after 1st review (gh pr view --json reviews,commits)',
    },
    actual_downstream_fanout: {
      value: f.downstreamFanout,
      provenance: 'measured',
      evidence: 'grep -rl importers of changed src/electron files (post-merge)',
    },
    pr_review_cycles: {
      value: f.prReviewCycles,
      provenance: 'measured',
      evidence: 'gh pr view --json reviews (submissions)',
    },
    time_to_merge_hours: {
      value: hoursBetween(f.createdAt, f.mergedAt),
      provenance: 'measured',
      evidence: 'mergedAt - createdAt',
    },
    // O único campo julgado — uma Action não julga. Proxy transparente, marcado estimated.
    actual_human_interventions: {
      value: f.changesRequested,
      provenance: 'estimated',
      evidence: 'auto-proxy: CHANGES_REQUESTED review count — NOT human-judged',
    },
  })
}

// pr_number / merge_sha são nullable no schema → ficam FORA daqui (opcionais no
// CLI; ausente = null é válido). Só os campos genuinamente obrigatórios entram.
const ENV_KEYS = [
  'HARNESS_ISSUE',
  'HARNESS_VERSION',
  'HARNESS_FILES',
  'HARNESS_ITERATIONS',
  'HARNESS_FANOUT',
  'HARNESS_REVIEW_CYCLES',
  'HARNESS_CHANGES_REQUESTED',
  'HARNESS_CREATED_AT',
  'HARNESS_MERGED_AT',
] as const

export function main(env: NodeJS.ProcessEnv = process.env): number {
  for (const key of ENV_KEYS) {
    if (!env[key]) {
      process.stderr.write(`error: missing env ${key}\n`)
      return 2
    }
  }
  const nums = {
    filesTouched: Number(env.HARNESS_FILES),
    actualIterations: Number(env.HARNESS_ITERATIONS),
    downstreamFanout: Number(env.HARNESS_FANOUT),
    prReviewCycles: Number(env.HARNESS_REVIEW_CYCLES),
    changesRequested: Number(env.HARNESS_CHANGES_REQUESTED),
  }
  if (Object.values(nums).some((n) => !Number.isFinite(n))) {
    process.stderr.write('error: a numeric env var is not a finite number\n')
    return 2
  }
  // Rastreabilidade opcional (nullable no schema): ausente/vazio/garbage → null,
  // nunca derruba o registro por um ponteiro de deep-dive.
  const prNumberRaw = Number(env.HARNESS_PR_NUMBER)
  const prNumber = env.HARNESS_PR_NUMBER && Number.isFinite(prNumberRaw) ? prNumberRaw : null
  const mergeSha = env.HARNESS_MERGE_SHA || null
  try {
    const outcome = buildOutcome({
      issueId: env.HARNESS_ISSUE as string,
      harnessVersion: env.HARNESS_VERSION as string,
      prNumber,
      mergeSha,
      createdAt: env.HARNESS_CREATED_AT as string,
      mergedAt: env.HARNESS_MERGED_AT as string,
      ...nums,
    })
    process.stdout.write(JSON.stringify(outcome) + '\n')
    return 0
  } catch (error) {
    process.stderr.write(`error: failed to build outcome: ${(error as Error).message}\n`)
    return 1
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : ''
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  process.exit(main())
}
