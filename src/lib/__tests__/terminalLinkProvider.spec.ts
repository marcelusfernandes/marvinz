import { describe, it, expect, vi } from 'vitest'
import type { Terminal, ILink } from '@xterm/xterm'
import { createTerminalLinkProvider, resolveOsc8Uri } from '../terminalLinkProvider'

const VAULT = '/Users/me/vault'

function fakeTerm(lines: string[]): Terminal {
  return {
    buffer: {
      active: {
        getLine: (y: number) => {
          const s = lines[y]
          return s == null ? undefined : { translateToString: () => s }
        },
      },
    },
  } as unknown as Terminal
}

// xterm calls provideLinks with a 1-based buffer line number, so y=1 reads
// the first line of the fake buffer.
function getLinks(term: Terminal, y = 1, onOpenFile = vi.fn()): ILink[] {
  const provider = createTerminalLinkProvider(term, { vaultPath: VAULT, onOpenFile })
  let result: ILink[] | undefined
  provider.provideLinks(y, (links) => {
    result = links
  })
  return result ?? []
}

function mouse(modifiers: Partial<MouseEvent>): MouseEvent {
  return { metaKey: false, ctrlKey: false, ...modifiers } as MouseEvent
}

describe('createTerminalLinkProvider — provideLinks', () => {
  it('detects a relative path with an extension and its cell range', () => {
    const term = fakeTerm(['✓ Edited src/components/AgentTerminal.tsx'])
    const links = getLinks(term, 1)
    expect(links).toHaveLength(1)
    expect(links[0].text).toBe('src/components/AgentTerminal.tsx')
    // "✓ Edited " is 9 chars → path starts at index 9 → x is 1-based.
    expect(links[0].range.start).toEqual({ x: 10, y: 1 })
    expect(links[0].range.end).toEqual({ x: 10 + links[0].text.length - 1, y: 1 })
  })

  it('detects ./ and a/ b/ prefixed paths', () => {
    expect(getLinks(fakeTerm(['see ./docs/spec.md']))[0].text).toBe('./docs/spec.md')
    expect(getLinks(fakeTerm(['diff a/src/foo.tsx']))[0].text).toBe('a/src/foo.tsx')
    expect(getLinks(fakeTerm(['diff b/src/foo.tsx']))[0].text).toBe('b/src/foo.tsx')
  })

  it('includes a trailing :line in the link text', () => {
    expect(getLinks(fakeTerm(['at electron/main.ts:552 now']))[0].text).toBe(
      'electron/main.ts:552',
    )
  })

  it('detects multiple paths on one line', () => {
    const links = getLinks(fakeTerm(['src/a.ts and src/b.ts']))
    expect(links.map((l) => l.text)).toEqual(['src/a.ts', 'src/b.ts'])
  })

  it('does not match absolute paths outside the vault', () => {
    expect(getLinks(fakeTerm(['ran /usr/bin/node script']))).toHaveLength(0)
  })

  it('matches a bare root-level file with an alphabetic-led extension', () => {
    expect(getLinks(fakeTerm(['Created testev3.md at root']))[0].text).toBe(
      'testev3.md',
    )
    expect(getLinks(fakeTerm(['see README.md for details']))[0].text).toBe(
      'README.md',
    )
  })

  it('does not match version strings or numeric tokens as bare files', () => {
    expect(getLinks(fakeTerm(['build finished in 2.5s']))).toHaveLength(0)
    expect(getLinks(fakeTerm(['Claude Code v2.1.150 ready']))).toHaveLength(0)
    expect(getLinks(fakeTerm(['done, e.g. nothing here']))).toHaveLength(0)
  })

  it('returns undefined (no links) for an empty line', () => {
    const onOpenFile = vi.fn()
    const provider = createTerminalLinkProvider(fakeTerm([]), {
      vaultPath: VAULT,
      onOpenFile,
    })
    let called: ILink[] | undefined = []
    provider.provideLinks(0, (links) => {
      called = links
    })
    expect(called).toBeUndefined()
  })
})

describe('createTerminalLinkProvider — activate', () => {
  it('opens the resolved file on Cmd+Click (metaKey)', () => {
    const onOpenFile = vi.fn()
    const links = getLinks(fakeTerm(['Edited src/foo.tsx']), 1, onOpenFile)
    links[0].activate(mouse({ metaKey: true }), links[0].text)
    expect(onOpenFile).toHaveBeenCalledWith(`${VAULT}/src/foo.tsx`)
  })

  it('opens the resolved file on Ctrl+Click (ctrlKey)', () => {
    const onOpenFile = vi.fn()
    const links = getLinks(fakeTerm(['Edited src/foo.tsx']), 1, onOpenFile)
    links[0].activate(mouse({ ctrlKey: true }), links[0].text)
    expect(onOpenFile).toHaveBeenCalledWith(`${VAULT}/src/foo.tsx`)
  })

  it('does nothing on a plain click without a modifier', () => {
    const onOpenFile = vi.fn()
    const links = getLinks(fakeTerm(['Edited src/foo.tsx']), 1, onOpenFile)
    links[0].activate(mouse({}), links[0].text)
    expect(onOpenFile).not.toHaveBeenCalled()
  })

  it('does not open when the token resolves outside the vault', () => {
    // The regex surfaces `../escape.ts` as a link, but the resolver rejects it
    // for escaping the vault — activate must honor that and not open anything.
    const onOpenFile = vi.fn()
    const links = getLinks(fakeTerm(['wrote ../escape.ts']), 1, onOpenFile)
    expect(links).toHaveLength(1)
    links[0].activate(mouse({ metaKey: true }), links[0].text)
    expect(onOpenFile).not.toHaveBeenCalled()
  })
})

describe('resolveOsc8Uri', () => {
  it('resolves a file:// URI inside the vault', () => {
    expect(resolveOsc8Uri(`file://${VAULT}/teste.md`, VAULT)).toBe(
      `${VAULT}/teste.md`,
    )
    expect(
      resolveOsc8Uri(`file://${VAULT}/knowledge/journal/2026-05-25.md`, VAULT),
    ).toBe(`${VAULT}/knowledge/journal/2026-05-25.md`)
  })

  it('decodes percent-encoded characters in file:// URIs', () => {
    expect(resolveOsc8Uri(`file://${VAULT}/my%20note.md`, VAULT)).toBe(
      `${VAULT}/my note.md`,
    )
  })

  it('resolves a bare relative path', () => {
    expect(resolveOsc8Uri('teste.md', VAULT)).toBe(`${VAULT}/teste.md`)
  })

  it('returns null for a file:// URI outside the vault', () => {
    expect(resolveOsc8Uri('file:///etc/passwd', VAULT)).toBeNull()
  })

  it('returns null for non-file schemes', () => {
    expect(resolveOsc8Uri('https://example.com', VAULT)).toBeNull()
    expect(resolveOsc8Uri('mailto:a@b.com', VAULT)).toBeNull()
  })
})
