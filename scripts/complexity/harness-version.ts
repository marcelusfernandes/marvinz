/**
 * harness_version = `${model}+${hash}`, hash = content hash dos diretórios que
 * definem o comportamento dos agentes. Content-addressed: edições locais não
 * commitadas já mudam a distribuição dos sinais, então contam (§1.5).
 *
 * Tendências só são comparáveis dentro de uma mesma harness_version. Congele a
 * LÓGICA de extração de sinais mesmo evoluindo o resto, senão nunca acumula
 * exemplos suficientes por versão.
 */

import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

// Diretórios que definem o comportamento dos agentes neste projeto. Manter
// enxuto: quanto mais amplo o hash, mais a versão troca e menos exemplos por
// versão se acumulam (§1.5).
const DEFAULT_DIRS = ['.claude/agents', '.claude/commands'] as const

function walk(base: string): string[] {
  let out: string[] = []
  let entries
  try {
    entries = readdirSync(base, { withFileTypes: true })
  } catch {
    return []
  }
  for (const entry of entries) {
    const full = join(base, entry.name)
    if (entry.isDirectory()) out = out.concat(walk(full))
    else if (entry.isFile()) out.push(full)
  }
  return out
}

export function computeHash(
  repoRoot: string = REPO_ROOT,
  relDirs: readonly string[] = DEFAULT_DIRS,
): string {
  const files: string[] = []
  for (const rel of relDirs) {
    const base = join(repoRoot, rel)
    try {
      if (statSync(base).isDirectory()) files.push(...walk(base))
    } catch {
      // diretório ausente → ignora (não é fatal)
    }
  }
  const toPosix = (p: string): string => relative(repoRoot, p).split(sep).join('/')
  files.sort((a, b) => {
    const pa = toPosix(a)
    const pb = toPosix(b)
    return pa < pb ? -1 : pa > pb ? 1 : 0
  })
  const digest = createHash('sha1')
  for (const file of files) {
    digest.update(toPosix(file))
    digest.update(readFileSync(file))
  }
  return digest.digest('hex').slice(0, 7)
}

export function harnessVersion(model: string, repoRoot: string = REPO_ROOT): string {
  return `${model}+${computeHash(repoRoot)}`
}

export function main(argv: string[] = process.argv.slice(2)): number {
  if (argv.length === 0) {
    process.stderr.write('usage: tsx scripts/complexity/harness-version.ts <model-id>\n')
    return 2
  }
  process.stdout.write(harnessVersion(argv[0]) + '\n')
  return 0
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : ''
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  process.exit(main())
}
