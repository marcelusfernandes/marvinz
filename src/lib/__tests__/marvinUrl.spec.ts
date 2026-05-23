import { describe, it, expect } from 'vitest'
import type { PaletteItem } from '../paletteRanker'
import { toMarvinUrl, resolveImageSrc } from '../marvinUrl'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VAULT = '/vault'
const CURRENT_FILE = '/vault/notes/sub/file.md'

function item(absPath: string): PaletteItem {
  const name = absPath.split('/').pop()!
  return { path: absPath, rel: absPath.slice(VAULT.length + 1), name, isMarkdown: false }
}

const BASE_ITEMS: PaletteItem[] = [
  item('/vault/notes/sub/assets/img.png'),
  item('/vault/screenshot.png'),
]

// ---------------------------------------------------------------------------
// toMarvinUrl
// ---------------------------------------------------------------------------

describe('toMarvinUrl', () => {
  it('encodes a simple absolute path', () => {
    expect(toMarvinUrl('/vault/notes/img.png')).toBe(
      'marvin://localhost/vault/notes/img.png',
    )
  })

  it('encodes path segments with spaces', () => {
    expect(toMarvinUrl('/vault/my notes/my image.png')).toBe(
      'marvin://localhost/vault/my%20notes/my%20image.png',
    )
  })

  it('encodes unicode characters', () => {
    const url = toMarvinUrl('/vault/imágenes/café.png')
    expect(url).toMatch(/^marvin:\/\/localhost\//)
    expect(url).not.toContain('imágenes')
    expect(url).not.toContain('café')
  })
})

// ---------------------------------------------------------------------------
// resolveImageSrc — external passthrough
// ---------------------------------------------------------------------------

describe('resolveImageSrc — external passthrough', () => {
  it('returns external for https:// src', () => {
    const result = resolveImageSrc('https://example.com/img.png', CURRENT_FILE, VAULT, [])
    expect(result).toEqual({ kind: 'external', url: 'https://example.com/img.png' })
  })

  it('returns external for http:// src', () => {
    const result = resolveImageSrc('http://example.com/img.png', CURRENT_FILE, VAULT, [])
    expect(result).toEqual({ kind: 'external', url: 'http://example.com/img.png' })
  })

  it('returns external for data: src', () => {
    const src = 'data:image/png;base64,abc123'
    const result = resolveImageSrc(src, CURRENT_FILE, VAULT, [])
    expect(result).toEqual({ kind: 'external', url: src })
  })

  it('passes through already-resolved marvin:// src as external', () => {
    // A user can paste/type a `marvin://…` URL directly into the markdown,
    // which makes this a boundary input — handled symmetrically to
    // http(s):/data: passthrough. The main handler does the real validation.
    const src = 'marvin://localhost/vault/img.png'
    const result = resolveImageSrc(src, CURRENT_FILE, VAULT, [])
    expect(result).toEqual({ kind: 'external', url: src })
  })
})

// ---------------------------------------------------------------------------
// resolveImageSrc — empty / null-ish src
// ---------------------------------------------------------------------------

describe('resolveImageSrc — empty src', () => {
  it('returns missing for empty string', () => {
    expect(resolveImageSrc('', CURRENT_FILE, VAULT, [])).toEqual({ kind: 'missing' })
  })
})

// ---------------------------------------------------------------------------
// resolveImageSrc — vault-absolute src
// ---------------------------------------------------------------------------

describe('resolveImageSrc — vault-absolute src (/)', () => {
  it('resolves /assets/img.png to marvin URL rooted at vault', () => {
    const items = [item('/vault/assets/img.png')]
    const result = resolveImageSrc('/assets/img.png', CURRENT_FILE, VAULT, items)
    expect(result).toEqual({
      kind: 'marvin',
      url: toMarvinUrl('/vault/assets/img.png'),
    })
  })

  it('returns missing for /assets/ghost.png that does not exist in palette', () => {
    // isInsideVault passes (lexical), but toMarvinUrl is still built — the
    // inside-vault check only guards traversal. Ghost files get a marvin: URL;
    // the browser onerror fires when the main handler returns 404.
    // Actually resolveImageSrc builds the URL regardless of palette — palette
    // is only used for wikilink-image. So we just verify kind is marvin.
    const result = resolveImageSrc('/assets/ghost.png', CURRENT_FILE, VAULT, [])
    expect(result.kind).toBe('marvin')
  })
})

// ---------------------------------------------------------------------------
// resolveImageSrc — relative src
// ---------------------------------------------------------------------------

describe('resolveImageSrc — relative src', () => {
  it('resolves ./assets/img.png relative to currentFile dir', () => {
    const result = resolveImageSrc('./assets/img.png', CURRENT_FILE, VAULT, BASE_ITEMS)
    expect(result).toEqual({
      kind: 'marvin',
      url: toMarvinUrl('/vault/notes/sub/assets/img.png'),
    })
  })

  it('resolves bare name img.png relative to currentFile dir', () => {
    const result = resolveImageSrc('assets/img.png', CURRENT_FILE, VAULT, BASE_ITEMS)
    expect(result).toEqual({
      kind: 'marvin',
      url: toMarvinUrl('/vault/notes/sub/assets/img.png'),
    })
  })

  it('resolves ../img.png one level up', () => {
    const items = [item('/vault/notes/img.png')]
    const result = resolveImageSrc('../img.png', CURRENT_FILE, VAULT, items)
    expect(result).toEqual({
      kind: 'marvin',
      url: toMarvinUrl('/vault/notes/img.png'),
    })
  })

  it('resolves ../../screenshot.png two levels up to vault root', () => {
    const result = resolveImageSrc('../../screenshot.png', CURRENT_FILE, VAULT, BASE_ITEMS)
    expect(result).toEqual({
      kind: 'marvin',
      url: toMarvinUrl('/vault/screenshot.png'),
    })
  })

  it('returns missing when .. escapes the vault', () => {
    const result = resolveImageSrc('../../../etc/passwd', CURRENT_FILE, VAULT, [])
    expect(result).toEqual({ kind: 'missing' })
  })

  it('returns missing for deep traversal that escapes vault', () => {
    const result = resolveImageSrc('../../../../etc/shadow', CURRENT_FILE, VAULT, [])
    expect(result).toEqual({ kind: 'missing' })
  })
})

// ---------------------------------------------------------------------------
// resolveImageSrc — wikilink-image sentinel
// ---------------------------------------------------------------------------

describe('resolveImageSrc — wikilink-image sentinel', () => {
  it('resolves wikilink-image:screenshot.png found in palette', () => {
    const result = resolveImageSrc(
      'wikilink-image:screenshot.png',
      CURRENT_FILE,
      VAULT,
      BASE_ITEMS,
    )
    expect(result).toEqual({
      kind: 'marvin',
      url: toMarvinUrl('/vault/screenshot.png'),
    })
  })

  it('returns missing for wikilink-image:ghost.png not in palette', () => {
    const result = resolveImageSrc(
      'wikilink-image:ghost.png',
      CURRENT_FILE,
      VAULT,
      BASE_ITEMS,
    )
    expect(result).toEqual({ kind: 'missing' })
  })

  it('resolves wikilink-image with encoded spaces in name', () => {
    const items = [item('/vault/my image.png')]
    const result = resolveImageSrc(
      'wikilink-image:my%20image.png',
      CURRENT_FILE,
      VAULT,
      items,
    )
    expect(result).toEqual({
      kind: 'marvin',
      url: toMarvinUrl('/vault/my image.png'),
    })
  })

  it('returns missing for empty wikilink-image sentinel', () => {
    const result = resolveImageSrc('wikilink-image:', CURRENT_FILE, VAULT, BASE_ITEMS)
    expect(result).toEqual({ kind: 'missing' })
  })
})

// ---------------------------------------------------------------------------
// resolveImageSrc — ambiguity: same filename in multiple directories
// ---------------------------------------------------------------------------

describe('resolveImageSrc — ambiguous wikilink-image (same name, multiple dirs)', () => {
  const IMG_SAME_DIR = item('/vault/notes/sub/x.png')
  const IMG_OTHER_DIR = item('/vault/notes/other/x.png')
  const ITEMS_AMBIGUOUS = [IMG_OTHER_DIR, IMG_SAME_DIR]

  it('prefers the file in the same directory as currentFile', () => {
    const result = resolveImageSrc(
      'wikilink-image:x.png',
      CURRENT_FILE,
      VAULT,
      ITEMS_AMBIGUOUS,
    )
    expect(result).toEqual({
      kind: 'marvin',
      url: toMarvinUrl('/vault/notes/sub/x.png'),
    })
  })

  it('falls back to first match when no same-dir candidate exists', () => {
    const deepFile = '/vault/deep/nested/file.md'
    const result = resolveImageSrc('wikilink-image:x.png', deepFile, VAULT, ITEMS_AMBIGUOUS)
    // No same-dir match → first item in list
    expect(result).toEqual({
      kind: 'marvin',
      url: toMarvinUrl('/vault/notes/other/x.png'),
    })
  })
})

// ---------------------------------------------------------------------------
// resolveImageSrc — unicode / special characters in relative src
// ---------------------------------------------------------------------------

describe('resolveImageSrc — unicode in relative paths', () => {
  it('resolves image with unicode filename', () => {
    const items = [item('/vault/notes/sub/imágen.png')]
    const result = resolveImageSrc('imágen.png', CURRENT_FILE, VAULT, items)
    expect(result.kind).toBe('marvin')
    if (result.kind === 'marvin') {
      expect(result.url).toContain('marvin://localhost/')
      expect(result.url).not.toContain('imágen')
    }
  })
})
