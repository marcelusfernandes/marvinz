import type { PaletteItem } from './paletteRanker'
import { isWikilinkImageSrc, resolveWikilinkImage } from './wikilinks'

/**
 * Build a `marvin://` URL for an absolute file path inside the vault.
 *
 * `localhost` is a placeholder hostname: Chromium's standard URL parser
 * refuses an empty hostname for schemes registered as `standard`, and
 * would otherwise consume the first path segment (e.g. `Users`) as the
 * host. Each path segment is URL-encoded so spaces and unicode survive.
 */
export function toMarvinUrl(absPath: string): string {
  const encoded = absPath
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/')
  return `marvin://localhost${encoded}`
}

const EXTERNAL_RE = /^(https?:|data:)/i

export type ResolvedImageSrc =
  | { kind: 'marvin'; url: string }
  | { kind: 'external'; url: string }
  | { kind: 'missing' }

/**
 * Resolve a markdown image `src` to something the renderer can load.
 *
 * Branches:
 *   1. `http(s):` / `data:`           → external, passthrough.
 *   2. `wikilink-image:` sentinel     → resolve name via palette index.
 *   3. `/`-prefix                     → vault-absolute (join with vaultPath).
 *   4. Anything else                  → relative to `dirname(currentFile)`.
 *
 * The inside-vault check is **lexical only** — purely to render the broken
 * placeholder without a network round-trip when the path obviously escapes.
 * The boundary of truth remains `assertInsideVaultAsync` in the main process.
 */
export function resolveImageSrc(
  src: string,
  currentFile: string,
  vaultPath: string,
  items: PaletteItem[],
): ResolvedImageSrc {
  if (!src) return { kind: 'missing' }

  if (EXTERNAL_RE.test(src)) {
    return { kind: 'external', url: src }
  }

  if (isWikilinkImageSrc(src)) {
    const resolved = resolveWikilinkImage(src, currentFile, vaultPath, items)
    if (!resolved) return { kind: 'missing' }
    return { kind: 'marvin', url: toMarvinUrl(resolved) }
  }

  const baseDir = src.startsWith('/') ? vaultPath : dirOf(currentFile)
  const abs = lexicalJoin(baseDir, src)
  if (!abs) return { kind: 'missing' }
  if (!isInsideVault(abs, vaultPath)) return { kind: 'missing' }
  return { kind: 'marvin', url: toMarvinUrl(abs) }
}

function dirOf(p: string): string {
  const idx = p.lastIndexOf('/')
  return idx >= 0 ? p.slice(0, idx) : p
}

/**
 * Resolve `..` / `.` segments against `baseDir` purely lexically.
 * Returns `null` if the input is empty after normalisation.
 */
function lexicalJoin(baseDir: string, rel: string): string | null {
  const segments = rel.split('/')
  const stack = baseDir.split('/')
  for (const seg of segments) {
    if (seg === '..') stack.pop()
    else if (seg !== '.' && seg !== '') stack.push(seg)
  }
  const out = stack.join('/')
  return out ? out : null
}

function isInsideVault(absPath: string, vaultPath: string): boolean {
  return absPath === vaultPath || absPath.startsWith(vaultPath + '/')
}
