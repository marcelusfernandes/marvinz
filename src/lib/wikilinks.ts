import type { PaletteItem } from './paletteRanker'

const WIKILINK_HREF_PREFIX = 'wikilink:'
const WIKILINK_IMAGE_HREF_PREFIX = 'wikilink-image:'
const WIKILINK_IMAGE_RE = /!\[\[([^\[\]\n|]+)(?:\|([^\[\]\n]+))?\]\]/g
const WIKILINK_RE = /\[\[([^\[\]\n|]+)(?:\|([^\[\]\n]+))?\]\]/g
const WIKILINK_LINK_RE = /\[([^\]\n]+)\]\(wikilink:([^)\s]+)\)/g
const WIKILINK_IMAGE_LINK_RE = /!\[([^\]\n]*)\]\(wikilink-image:([^)\s]+)\)/g

/**
 * Convert `[[Name]]`/`[[Name|Display]]` and the embed form
 * `![[Name]]`/`![[Name|Alt]]` into ordinary markdown link/image syntax using
 * sentinel URI schemes (`wikilink:` and `wikilink-image:`) so Milkdown can
 * render them as `<a>` / `<img>`. Inverse of {@link unparseWikilinks}.
 *
 * Order matters: the image form is matched first (its `!` would otherwise be
 * left as a literal next to the link form's output).
 *
 * Known limitation: literal `[[...]]` inside fenced or inline code is also
 * rewritten. Unlikely in note bodies; document and accept.
 */
export function parseWikilinks(md: string): string {
  const withImages = md.replace(WIKILINK_IMAGE_RE, (match, rawName, rawAlt) => {
    const name = String(rawName).trim()
    if (!name) return match
    const alt = (rawAlt ? String(rawAlt).trim() : '') || name
    const encoded = encodeURI(name)
    return `![${alt}](${WIKILINK_IMAGE_HREF_PREFIX}${encoded})`
  })
  return withImages.replace(WIKILINK_RE, (match, rawName, rawDisplay) => {
    const name = String(rawName).trim()
    if (!name) return match
    const display = (rawDisplay ? String(rawDisplay).trim() : '') || name
    const encoded = encodeURI(name)
    return `[${display}](${WIKILINK_HREF_PREFIX}${encoded})`
  })
}

/**
 * Inverse of {@link parseWikilinks}: recover `[[Name]]` / `[[Name|Display]]`
 * and `![[Name]]` / `![[Name|Alt]]` syntax from the rendered markdown emitted
 * by Milkdown.
 */
export function unparseWikilinks(md: string): string {
  const withoutLinks = md.replace(WIKILINK_LINK_RE, (_match, display, target) => {
    const name = safeDecode(target)
    if (display === name) return `[[${name}]]`
    return `[[${name}|${display}]]`
  })
  return withoutLinks.replace(WIKILINK_IMAGE_LINK_RE, (_match, alt, target) => {
    const name = safeDecode(target)
    if (alt === name || alt === '') return `![[${name}]]`
    return `![[${name}|${alt}]]`
  })
}

/**
 * Returns the decoded wikilink target when the href uses the `wikilink:`
 * scheme, otherwise null.
 */
export function isWikilinkHref(href: string): { name: string } | null {
  if (!href.startsWith(WIKILINK_HREF_PREFIX)) return null
  const raw = href.slice(WIKILINK_HREF_PREFIX.length)
  if (!raw) return null
  return { name: safeDecode(raw) }
}

/**
 * Returns true when the given image `src` uses the embed wikilink sentinel
 * scheme produced by {@link parseWikilinks}.
 */
export function isWikilinkImageSrc(src: string): boolean {
  return src.startsWith(WIKILINK_IMAGE_HREF_PREFIX)
}

/**
 * Resolve a wikilink target to an absolute markdown file path.
 *
 * Strategy:
 * - Containing `/`: resolve against vault root, appending `.md` if missing.
 * - Bare name: match by basename across all markdown items. With multiple
 *   matches, prefer the one in the same folder as the current file; else
 *   fall back to the first match.
 *
 * Fragments (`#section`) are stripped before matching — navigation is to
 * the file; in-file anchors are out of scope here.
 */
export function resolveWikilink(
  name: string,
  currentFile: string,
  vaultPath: string,
  items: PaletteItem[],
): string | null {
  const noFragment = name.split('#')[0].trim()
  if (!noFragment) return null

  if (noFragment.includes('/')) {
    const withExt =
      /\.(md|markdown)$/i.test(noFragment) ? noFragment : `${noFragment}.md`
    const absPath = `${vaultPath}/${withExt}`
    const exact = items.find((it) => it.path === absPath && it.isMarkdown)
    return exact ? exact.path : null
  }

  const target = stripMdExt(noFragment)
  const matches = items.filter(
    (it) => it.isMarkdown && stripMdExt(it.name) === target,
  )
  if (matches.length === 0) return null
  if (matches.length === 1) return matches[0].path

  const currentDir = currentFile.replace(/\/[^/]+$/, '')
  const sameDir = matches.find((it) => it.path.startsWith(`${currentDir}/`))
  return sameDir ? sameDir.path : matches[0].path
}

/**
 * Resolve an embed wikilink image (`wikilink-image:<encoded-name>`) to an
 * absolute file path inside the vault. Unlike {@link resolveWikilink}, this
 * does not filter by `isMarkdown` — image and other non-markdown items are
 * the whole point.
 *
 * `nameOrSrc` may be either the raw decoded name or the full
 * `wikilink-image:…` src — both are accepted.
 */
export function resolveWikilinkImage(
  nameOrSrc: string,
  currentFile: string,
  vaultPath: string,
  items: PaletteItem[],
): string | null {
  const raw = nameOrSrc.startsWith(WIKILINK_IMAGE_HREF_PREFIX)
    ? safeDecode(nameOrSrc.slice(WIKILINK_IMAGE_HREF_PREFIX.length))
    : nameOrSrc
  const name = raw.trim()
  if (!name) return null

  if (name.includes('/')) {
    const absPath = `${vaultPath}/${name}`
    const exact = items.find((it) => it.path === absPath)
    return exact ? exact.path : null
  }

  const matches = items.filter((it) => it.name === name)
  if (matches.length === 0) return null
  if (matches.length === 1) return matches[0].path

  const currentDir = currentFile.replace(/\/[^/]+$/, '')
  const sameDir = matches.find((it) => it.path.startsWith(`${currentDir}/`))
  return sameDir ? sameDir.path : matches[0].path
}

function stripMdExt(name: string): string {
  return name.replace(/\.(md|markdown)$/i, '')
}

function safeDecode(s: string): string {
  try {
    return decodeURI(s)
  } catch {
    return s
  }
}
