/**
 * Shared harness for the ledger-append CLIs (record-outcome, record-prediction).
 * Reads a JSON record from stdin, validates it against a Zod schema, and appends
 * it via a ledger function. Exit: 0 ok / 1 inválido / 2 uso. NUNCA lança exceção
 * — todo caminho de erro retorna um exit code. Extracted from the two CLIs
 * (#594) so the stdin/parse/validate/append/exit-code contract lives once.
 */

type ParseResult<T> = { success: true; data: T } | { success: false; error: { message: string } }

type LedgerSchema<T> = { safeParse: (data: unknown) => ParseResult<T> }

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

export async function runLedgerCli<T extends { issue_id: string }>(opts: {
  /** Zod schema whose `safeParse` validates the parsed stdin JSON. */
  schema: LedgerSchema<T>
  /** Appends a validated record to its JSONL ledger; returns the file path. */
  append: (data: T, repoRoot?: string) => string
  /** Schema name for the "<label> inválido" validation error. */
  schemaLabel: string
  /** Record noun for the "recorded <label> for issue" success line. */
  recordLabel: string
  /** Injectable stdin text for tests; reads the real stdin when absent. */
  stdinText?: string
  /** Injectable repo root for tests; uses the ledger default when absent. */
  repoRoot?: string
}): Promise<number> {
  let raw: string
  try {
    raw = (opts.stdinText ?? (await readStdin())).trim()
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

  const result = opts.schema.safeParse(parsed)
  if (!result.success) {
    process.stderr.write(`error: ${opts.schemaLabel} inválido:\n${result.error.message}\n`)
    return 1
  }

  try {
    const path = opts.append(result.data, opts.repoRoot)
    process.stdout.write(
      `recorded ${opts.recordLabel} for issue ${result.data.issue_id} -> ${path}\n`
    )
    return 0
  } catch (error) {
    process.stderr.write(`error: falha ao anexar: ${(error as Error).message}\n`)
    return 1
  }
}
