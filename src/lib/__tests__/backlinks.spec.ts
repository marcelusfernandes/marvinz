import { describe, it, expect } from 'vitest'
import { buildBacklinkIndex, getBacklinks, type NoteSource } from '../backlinks'
import type { PaletteItem } from '../paletteRanker'

const VAULT = '/vault'

function md(rel: string): PaletteItem {
  return { path: `${VAULT}/${rel}`, rel, name: rel.split('/').pop() as string, isMarkdown: true }
}

function img(rel: string): PaletteItem {
  return { path: `${VAULT}/${rel}`, rel, name: rel.split('/').pop() as string, isMarkdown: false }
}

function note(rel: string, content: string): NoteSource {
  return { path: `${VAULT}/${rel}`, content }
}

describe('buildBacklinkIndex', () => {
  it('records a plain [[Name]] link under the target note', () => {
    const items = [md('Alpha.md'), md('Beta.md')]
    const sources = [note('Alpha.md', 'see [[Beta]] for details')]
    const index = buildBacklinkIndex(sources, VAULT, items)

    const links = getBacklinks(index, `${VAULT}/Beta.md`)
    expect(links).toHaveLength(1)
    expect(links[0]).toMatchObject({
      sourcePath: `${VAULT}/Alpha.md`,
      sourceName: 'Alpha.md',
      line: 1,
      isEmbed: false,
    })
    expect(links[0].lineText).toBe('see [[Beta]] for details')
  })

  it('resolves [[Name|Display]] by target name, ignoring the display alias', () => {
    const items = [md('Alpha.md'), md('Beta.md')]
    const sources = [note('Alpha.md', '[[Beta|the beta note]]')]
    const index = buildBacklinkIndex(sources, VAULT, items)
    expect(getBacklinks(index, `${VAULT}/Beta.md`)).toHaveLength(1)
  })

  it('aggregates multiple sources linking the same target', () => {
    const items = [md('Alpha.md'), md('Gamma.md'), md('Beta.md')]
    const sources = [note('Alpha.md', 'link [[Beta]]'), note('Gamma.md', 'also [[Beta]]')]
    const index = buildBacklinkIndex(sources, VAULT, items)

    const links = getBacklinks(index, `${VAULT}/Beta.md`)
    expect(links.map((l) => l.sourceName).sort()).toEqual(['Alpha.md', 'Gamma.md'])
  })

  it('records each occurrence separately with correct 1-based line numbers', () => {
    const items = [md('Alpha.md'), md('Beta.md')]
    const sources = [note('Alpha.md', 'intro\n[[Beta]] first\nmiddle\n[[Beta]] again')]
    const index = buildBacklinkIndex(sources, VAULT, items)

    const links = getBacklinks(index, `${VAULT}/Beta.md`)
    expect(links).toHaveLength(2)
    expect(links.map((l) => l.line)).toEqual([2, 4])
  })

  it('captures multiple links on the same line', () => {
    const items = [md('A.md'), md('B.md'), md('C.md')]
    const sources = [note('A.md', 'both [[B]] and [[C]] here')]
    const index = buildBacklinkIndex(sources, VAULT, items)
    expect(getBacklinks(index, `${VAULT}/B.md`)).toHaveLength(1)
    expect(getBacklinks(index, `${VAULT}/C.md`)).toHaveLength(1)
  })

  it('marks embed links (![[Name]]) as isEmbed and resolves images', () => {
    const items = [md('Note.md'), img('diagram.png')]
    const sources = [note('Note.md', 'figure: ![[diagram.png]]')]
    const index = buildBacklinkIndex(sources, VAULT, items)

    const links = getBacklinks(index, `${VAULT}/diagram.png`)
    expect(links).toHaveLength(1)
    expect(links[0].isEmbed).toBe(true)
  })

  it('excludes self-links', () => {
    const items = [md('Alpha.md')]
    const sources = [note('Alpha.md', 'I reference [[Alpha]] myself')]
    const index = buildBacklinkIndex(sources, VAULT, items)
    expect(getBacklinks(index, `${VAULT}/Alpha.md`)).toEqual([])
  })

  it('skips links whose target does not resolve', () => {
    const items = [md('Alpha.md')]
    const sources = [note('Alpha.md', 'dangling [[Nonexistent]] link')]
    const index = buildBacklinkIndex(sources, VAULT, items)
    expect(index.size).toBe(0)
  })

  it('resolves path-qualified links (folder/Name)', () => {
    const items = [md('Alpha.md'), md('sub/Beta.md')]
    const sources = [note('Alpha.md', 'nested [[sub/Beta]]')]
    const index = buildBacklinkIndex(sources, VAULT, items)
    expect(getBacklinks(index, `${VAULT}/sub/Beta.md`)).toHaveLength(1)
  })

  it('truncates long context snippets to 200 chars + ellipsis', () => {
    const items = [md('Alpha.md'), md('Beta.md')]
    const long = 'x'.repeat(300) + ' [[Beta]]'
    const sources = [note('Alpha.md', long)]
    const index = buildBacklinkIndex(sources, VAULT, items)

    const links = getBacklinks(index, `${VAULT}/Beta.md`)
    expect(links[0].lineText).toHaveLength(201) // 200 + '…'
    expect(links[0].lineText.endsWith('…')).toBe(true)
  })

  it('ignores empty targets like [[]]', () => {
    const items = [md('Alpha.md')]
    const sources = [note('Alpha.md', 'empty [[]] link')]
    const index = buildBacklinkIndex(sources, VAULT, items)
    expect(index.size).toBe(0)
  })
})

describe('getBacklinks', () => {
  it('returns an empty array for a note with no incoming links', () => {
    const index = buildBacklinkIndex([], VAULT, [])
    expect(getBacklinks(index, `${VAULT}/Lonely.md`)).toEqual([])
  })
})
