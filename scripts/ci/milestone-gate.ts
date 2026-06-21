/**
 * Milestone completeness gate (#506). Pure core + thin CLI.
 *
 * A milestone must not ship incomplete: the blocking check runs on the release PR
 * (develop → main) and fails if the PR's milestone still has open issues; an
 * advisory variant runs on feature PRs (develop) for visibility. Membership comes
 * from `gh` (the workflow pipes `gh issue list --json number,title,state` to the
 * CLI), keeping this module pure and testable.
 */

import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export type IssueLite = { number: number; title: string; state: string }

/** Issues not yet closed (state comparison is case-insensitive: gh returns "OPEN"/"CLOSED"). */
export function openIssues(issues: IssueLite[]): IssueLite[] {
  return issues.filter((i) => i.state.toLowerCase() !== 'closed')
}

export type GateResult = { complete: boolean; message: string }

export function renderGate(milestone: string, issues: IssueLite[]): GateResult {
  const open = openIssues(issues)
  if (issues.length === 0) {
    return { complete: true, message: `Milestone "${milestone}" has no issues — nothing to gate.` }
  }
  if (open.length === 0) {
    return {
      complete: true,
      message: `✅ Milestone "${milestone}" complete — all ${issues.length} issues closed.`,
    }
  }
  const list = open.map((i) => `- #${i.number} ${i.title}`).join('\n')
  return {
    complete: false,
    message: `❌ Milestone "${milestone}" incomplete — ${open.length}/${issues.length} issues still open:\n${list}`,
  }
}

function readStdin(): Promise<string> {
  return new Promise((res, rej) => {
    let data = ''
    process.stdin.setEncoding('utf-8')
    process.stdin.on('data', (c) => (data += c))
    process.stdin.on('end', () => res(data))
    process.stdin.on('error', rej)
  })
}

/**
 * CLI: milestone title in argv[0], a JSON array of issues on stdin.
 * Prints the gate message. Exit: 0 complete · 1 incomplete (blocking) · 2 usage/parse.
 *
 * @param stdinText injetável p/ testes
 * @param argv      injetável p/ testes
 */
export async function main(
  stdinText?: string,
  argv: string[] = process.argv.slice(2)
): Promise<number> {
  const milestone = argv[0]
  if (!milestone) {
    process.stderr.write(
      'usage: gh issue list ... --json number,title,state | milestone-gate.ts <milestone>\n'
    )
    return 2
  }
  let raw: string
  try {
    raw = (stdinText ?? (await readStdin())).trim()
  } catch {
    process.stderr.write('error: failed to read stdin\n')
    return 2
  }
  let issues: IssueLite[]
  try {
    issues = raw ? (JSON.parse(raw) as IssueLite[]) : []
  } catch (error) {
    process.stderr.write(`error: invalid issues JSON: ${(error as Error).message}\n`)
    return 2
  }
  const result = renderGate(milestone, issues)
  process.stdout.write(result.message + '\n')
  return result.complete ? 0 : 1
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : ''
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  main()
    .then((code) => process.exit(code))
    .catch(() => process.exit(2))
}
