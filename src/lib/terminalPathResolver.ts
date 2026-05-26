export type ResolvedTerminalPath = {
  /** Vault-relative path resolved to an absolute, normalized path. */
  absolutePath: string
  /** 1-based line number when the token carried a `:line` suffix. */
  line?: number
}

const LINE_SUFFIX_RE = /:(\d+)(?::\d+)?$/

// Collapse `.`/`..` segments. Returns null if the path escapes above root.
function normalizeSegments(segments: string[]): string[] | null {
  const stack: string[] = []
  for (const seg of segments) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      if (stack.length === 0) return null
      stack.pop()
      continue
    }
    stack.push(seg)
  }
  return stack
}

/**
 * Resolves a path token printed in the agent terminal to an absolute path
 * inside the vault. Pure: no filesystem access — existence is checked by the
 * caller at click time. Returns null for absolute paths outside the vault and
 * for relative paths that traverse above the vault root.
 */
export function resolveTerminalPath(
  text: string,
  vaultPath: string,
): ResolvedTerminalPath | null {
  const trimmed = text.trim()
  if (!trimmed || !vaultPath) return null

  let bare = trimmed
  let line: number | undefined
  const lineMatch = bare.match(LINE_SUFFIX_RE)
  if (lineMatch) {
    line = Number(lineMatch[1])
    bare = bare.slice(0, lineMatch.index)
  }

  const isAbsolute = bare.startsWith('/')
  if (!isAbsolute) {
    // Strip a single git-diff prefix (a/… or b/…), then a leading ./
    bare = bare.replace(/^[ab]\//, '')
    bare = bare.replace(/^\.\//, '')
  }

  const candidate = isAbsolute ? bare : `${vaultPath}/${bare}`
  const normalized = normalizeSegments(candidate.split('/'))
  if (!normalized) return null

  const absolutePath = '/' + normalized.join('/')
  if (absolutePath !== vaultPath && !absolutePath.startsWith(vaultPath + '/')) {
    return null
  }

  return line != null ? { absolutePath, line } : { absolutePath }
}
