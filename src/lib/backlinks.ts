import type { PaletteItem } from './paletteRanker'
import { resolveWikilink, resolveWikilinkImage } from './wikilinks'

/**
 * Backlinks: the reverse of wikilink resolution. Given every note's raw source,
 * build a map from each note's absolute path to the list of places that link to
 * it — the data behind an Obsidian-style "Linked mentions" panel.
 *
 * Pure and synchronous: the caller supplies note contents (already read by the
 * main process) and the palette items used elsewhere for forward resolution, so
 * a bare `[[Name]]` resolves to the same target the editor would navigate to.
 */

/** One markdown note's raw source, keyed by its absolute path. */
export type NoteSource = {
  path: string
  content: string
}

/** A single incoming link occurrence. */
export type Backlink = {
  /** Absolute path of the note that contains the link. */
  sourcePath: string
  /** Filename of the source note, for display. */
  sourceName: string
  /** 1-based line number of the occurrence. */
  line: number
  /** Trimmed text of that line, as a context snippet. */
  lineText: string
  /** True for embed links (`![[…]]`), false for plain (`[[…]]`). */
  isEmbed: boolean
}

export type BacklinkIndex = Map<string, Backlink[]>

// Matches `[[Name]]`, `[[Name|Display]]`, `![[Name]]`, `![[Name|Alt]]`.
// Group 1: leading `!` (embed) or empty. Group 2: the raw target name.
const WIKILINK_SCAN_RE = /(!?)\[\[([^[\]\n|]+)(?:\|[^[\]\n]+)?\]\]/g

const MAX_SNIPPET = 200

/**
 * Build the reverse index across the whole vault.
 *
 * Every `[[…]]` / `![[…]]` occurrence in each source is resolved to its target
 * note (via the same resolvers the editor uses) and recorded under that
 * target's absolute path. Self-links (a note linking to itself) are skipped.
 */
export function buildBacklinkIndex(
  sources: NoteSource[],
  vaultPath: string,
  items: PaletteItem[]
): BacklinkIndex {
  const index: BacklinkIndex = new Map()

  for (const source of sources) {
    const lines = source.content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const rawLine = lines[i]
      WIKILINK_SCAN_RE.lastIndex = 0
      let match: RegExpExecArray | null
      while ((match = WIKILINK_SCAN_RE.exec(rawLine)) !== null) {
        const isEmbed = match[1] === '!'
        const name = match[2].trim()
        if (!name) continue

        const targetPath = isEmbed
          ? resolveWikilinkImage(name, source.path, vaultPath, items)
          : resolveWikilink(name, source.path, vaultPath, items)
        if (!targetPath || targetPath === source.path) continue

        const trimmed = rawLine.trim()
        const lineText =
          trimmed.length > MAX_SNIPPET ? trimmed.slice(0, MAX_SNIPPET) + '…' : trimmed

        const list = index.get(targetPath)
        const entry: Backlink = {
          sourcePath: source.path,
          sourceName: basename(source.path),
          line: i + 1,
          lineText,
          isEmbed,
        }
        if (list) list.push(entry)
        else index.set(targetPath, [entry])
      }
    }
  }

  return index
}

/**
 * Look up the incoming links for one note. Returns an empty array when nothing
 * links to it (never null, so callers can render unconditionally).
 */
export function getBacklinks(index: BacklinkIndex, notePath: string): Backlink[] {
  return index.get(notePath) ?? []
}

function basename(p: string): string {
  const cut = p.lastIndexOf('/')
  return cut === -1 ? p : p.slice(cut + 1)
}
