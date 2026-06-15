/**
 * Ledger JSONL append-only. Pareamento por issue_id na LEITURA (join em memória),
 * "last write per issue_id wins". Versionado no git (queremos ler o histórico cru
 * em diff). Toda escrita passa pelo schema Zod — registro malformado nunca chega
 * ao ledger.
 */

import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  CalibrationPair,
  OutcomeRecord,
  PredictionVector,
  sameHarness,
  type PredictionVector as PredictionVectorType,
  type OutcomeRecord as OutcomeRecordType,
  type CalibrationPair as CalibrationPairType,
} from './schema.ts'
import type { ZodType } from 'zod'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

export const LEDGER_DIRNAME = '_complexity-ledger'
export const PREDICTIONS_FILE = 'predictions.jsonl'
export const OUTCOMES_FILE = 'outcomes.jsonl'

export function ledgerDir(repoRoot: string = REPO_ROOT): string {
  return join(repoRoot, LEDGER_DIRNAME)
}

function append(path: string, record: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  appendFileSync(path, JSON.stringify(record) + '\n', 'utf-8')
}

export function appendPrediction(
  prediction: PredictionVectorType,
  repoRoot: string = REPO_ROOT,
): string {
  // Revalida na fronteira: nunca confie que o caller já validou.
  const valid = PredictionVector.parse(prediction)
  const path = join(ledgerDir(repoRoot), PREDICTIONS_FILE)
  append(path, valid)
  return path
}

export function appendOutcome(outcome: OutcomeRecordType, repoRoot: string = REPO_ROOT): string {
  const valid = OutcomeRecord.parse(outcome)
  const path = join(ledgerDir(repoRoot), OUTCOMES_FILE)
  append(path, valid)
  return path
}

function read<T>(path: string, schema: ZodType<T>): T[] {
  let text: string
  try {
    text = readFileSync(path, 'utf-8')
  } catch {
    return [] // arquivo ausente → ledger vazio
  }
  return text
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => schema.parse(JSON.parse(line)))
}

export function readPredictions(repoRoot: string = REPO_ROOT): PredictionVectorType[] {
  return read(join(ledgerDir(repoRoot), PREDICTIONS_FILE), PredictionVector)
}

export function readOutcomes(repoRoot: string = REPO_ROOT): OutcomeRecordType[] {
  return read(join(ledgerDir(repoRoot), OUTCOMES_FILE), OutcomeRecord)
}

/** Join por issue_id (last write wins). Só pares da MESMA harness_version entram. */
export function calibrationPairs(repoRoot: string = REPO_ROOT): CalibrationPairType[] {
  const predictions = new Map<string, PredictionVectorType>()
  for (const prediction of readPredictions(repoRoot)) {
    predictions.set(prediction.issue_id, prediction) // último vence
  }
  const outcomes = new Map<string, OutcomeRecordType>()
  for (const outcome of readOutcomes(repoRoot)) {
    outcomes.set(outcome.issue_id, outcome)
  }

  const pairs: CalibrationPairType[] = []
  for (const [issueId, prediction] of predictions) {
    const outcome = outcomes.get(issueId)
    if (!outcome) continue
    const pair = CalibrationPair.parse({ prediction, outcome })
    if (sameHarness(pair)) pairs.push(pair)
  }
  return pairs
}
