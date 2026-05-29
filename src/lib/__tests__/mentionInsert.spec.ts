import { describe, it, expect } from 'vitest'
import type { PaletteItem } from '../paletteRanker'
import { mentionInsertText } from '../mentionInsert'

const VAULT = '/vault'

function item(partial: Partial<PaletteItem> & { name: string }): PaletteItem {
  const rel = partial.rel ?? partial.name
  return {
    path: partial.path ?? `${VAULT}/${rel}`,
    rel,
    name: partial.name,
    isMarkdown: partial.isMarkdown ?? false,
  }
}

// Extract the destination from a `[name](dest)` link, unwrapping the angle
// brackets mdLinkTarget adds for targets containing spaces/parens.
function linkDest(insert: string): string {
  const dest = insert.replace(/^.*\]\(/, '').replace(/\)$/, '')
  return dest.startsWith('<') ? dest.slice(1, -1) : dest
}

// Mirror of resolveLink in Editor.tsx:138 — the click handler both surfaces
// route through. Replicated here (it is small + pure) so the resolution test
// proves the emitted target actually lands on the file from any note dir.
function resolveLink(href: string, currentFile: string, vaultPath: string): string | null {
  if (!href) return null
  const baseDir = href.startsWith('/') ? vaultPath : currentFile.replace(/\/[^/]+$/, '')
  const stack = baseDir.split('/')
  for (const seg of href.split('/')) {
    if (seg === '..') stack.pop()
    else if (seg !== '.' && seg !== '') stack.push(seg)
  }
  const resolved = stack.join('/')
  return resolved.startsWith(vaultPath) ? resolved : null
}

const NOTE = `${VAULT}/note.md`

describe('mentionInsertText', () => {
  it('inserts a wikilink for markdown notes, stripping the extension', () => {
    expect(mentionInsertText(item({ name: 'My Note.md', isMarkdown: true }), NOTE)).toBe(
      '[[My Note]]',
    )
  })

  it('treats .markdown extension as a note even when isMarkdown is false', () => {
    expect(mentionInsertText(item({ name: 'Spec.markdown' }), NOTE)).toBe('[[Spec]]')
  })

  it('inserts an embed for images using the full filename', () => {
    expect(mentionInsertText(item({ name: 'diagram.png' }), NOTE)).toBe('![[diagram.png]]')
  })

  it('inserts a file-relative markdown link for other files', () => {
    expect(
      mentionInsertText(
        item({ name: 'report.pdf', path: `${VAULT}/docs/report.pdf` }),
        NOTE,
      ),
    ).toBe('[report.pdf](docs/report.pdf)')
  })

  it('emits an UP-relative target when the note lives in a subdirectory', () => {
    const insert = mentionInsertText(
      item({ name: 'report.pdf', path: `${VAULT}/docs/report.pdf` }),
      `${VAULT}/notes/today.md`,
    )
    expect(insert).toBe('[report.pdf](../docs/report.pdf)')
  })

  it('other-link RESOLVES back to the target from a subdirectory note (Blocker 1)', () => {
    const target = `${VAULT}/docs/report.pdf`
    const note = `${VAULT}/notes/today.md`
    const insert = mentionInsertText(item({ name: 'report.pdf', path: target }), note)
    // The destination, resolved as the click handler would, must be the file.
    expect(resolveLink(linkDest(insert), note, VAULT)).toBe(target)
  })

  it('angle-wraps targets containing spaces (Blocker 2)', () => {
    const insert = mentionInsertText(
      item({ name: 'Q3 Budget.csv', path: `${VAULT}/finance/Q3 Budget.csv` }),
      NOTE,
    )
    expect(insert).toBe('[Q3 Budget.csv](<finance/Q3 Budget.csv>)')
    // And the unwrapped destination still resolves to the file.
    expect(resolveLink(linkDest(insert), NOTE, VAULT)).toBe(`${VAULT}/finance/Q3 Budget.csv`)
  })

  it('falls back to a markdown link when an extensionless file is not markdown', () => {
    expect(
      mentionInsertText(item({ name: 'LICENSE', path: `${VAULT}/LICENSE` }), NOTE),
    ).toBe('[LICENSE](LICENSE)')
  })
})
