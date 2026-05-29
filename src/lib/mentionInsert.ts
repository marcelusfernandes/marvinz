import type { PaletteItem } from './paletteRanker'
import { IMAGE_EXT_RE, linkFromNoteDir, mdLinkTarget } from './dropAttachments'
import { stripMdExt } from './wikilinks'

const MARKDOWN_EXT_RE = /\.(md|markdown)$/i

// Build the text inserted when a mention is selected, branching on file type:
// markdown notes become `[[Name]]` wikilinks, images become `![[file.png]]`
// embeds, and everything else becomes a markdown link. The link target is
// file-relative to the current note (what the click resolver expects) and
// angle-wrapped when it contains spaces/parens, matching internalDragMarkdown.
// The resolvers in wikilinks.ts match notes by stripped basename and images by
// full name, so the extension handling here mirrors that.
export function mentionInsertText(item: PaletteItem, currentFilePath: string): string {
  if (item.isMarkdown || MARKDOWN_EXT_RE.test(item.name)) {
    return `[[${stripMdExt(item.name)}]]`
  }
  if (IMAGE_EXT_RE.test(item.name)) {
    return `![[${item.name}]]`
  }
  const link = mdLinkTarget(linkFromNoteDir(currentFilePath, item.path))
  return `[${item.name}](${link})`
}
