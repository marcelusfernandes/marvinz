import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { buildAttachmentRelPath, attachmentMarkdown } from '../attachments'

// ---------------------------------------------------------------------------
// buildAttachmentRelPath — slug generation
// ---------------------------------------------------------------------------

describe('buildAttachmentRelPath — slug generation', () => {
  it('sanitizes uppercase, special chars, preserves extension', () => {
    expect(buildAttachmentRelPath('My Photo!.PNG')).toMatch(
      /^attachments\/\d{4}-\d{2}-\d{2}-\d{6}-my-photo-\.png$/
    )
  })

  it('no-extension file: no trailing dot in slug', () => {
    expect(buildAttachmentRelPath('no-extension')).toMatch(
      /^attachments\/\d{4}-\d{2}-\d{2}-\d{6}-no-extension$/
    )
  })

  it('sanitizes spaces and slashes, preserves .pdf extension', () => {
    const result = buildAttachmentRelPath('foo  bar/baz.pdf')
    expect(result).toMatch(/^attachments\/\d{4}-\d{2}-\d{2}-\d{6}-/)
    expect(result).toMatch(/\.pdf$/)
    // extract the slug after the timestamp prefix and verify no spaces/slashes
    const slug = result.replace(/^attachments\/\d{4}-\d{2}-\d{2}-\d{6}-/, '')
    expect(slug).not.toMatch(/[ /]/)
  })

  it('NFC and NFD forms of the same name produce an identical slug', () => {
    // Build both forms from one source so the test never depends on how the
    // editor saved a literal: NFD = e + U+0301, NFC = precomposed.
    const nfd = 'cafe\u0301.png'.normalize('NFD')
    const nfc = 'cafe\u0301.png'.normalize('NFC')
    expect(nfc).not.toBe(nfd) // distinct byte sequences...
    const stripTs = (s: string) => s.replace(/^attachments\/\d{4}-\d{2}-\d{2}-\d{6}-/, '')
    // ...but NFKC normalization collapses them to the same canonical slug.
    expect(stripTs(buildAttachmentRelPath(nfc))).toBe(stripTs(buildAttachmentRelPath(nfd)))
  })
})

// ---------------------------------------------------------------------------
// buildAttachmentRelPath — timestamp determinism
// ---------------------------------------------------------------------------

describe('buildAttachmentRelPath — timestamp determinism', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-25T14:30:12'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('timestamp segment matches 2026-05-25-143012', () => {
    const result = buildAttachmentRelPath('photo.png')
    expect(result).toMatch(/^attachments\/2026-05-25-143012-photo\.png$/)
  })
})

// ---------------------------------------------------------------------------
// attachmentMarkdown — image vs link branch
// ---------------------------------------------------------------------------

describe('attachmentMarkdown — image vs link', () => {
  it('image/png → markdown image syntax', () => {
    expect(attachmentMarkdown({ name: 'photo.png', type: 'image/png' }, 'attachments/x.png')).toBe(
      '![photo.png](attachments/x.png)'
    )
  })

  it('application/pdf → markdown link syntax', () => {
    expect(
      attachmentMarkdown({ name: 'doc.pdf', type: 'application/pdf' }, 'attachments/x.pdf')
    ).toBe('[doc.pdf](attachments/x.pdf)')
  })

  it('empty MIME type → link branch', () => {
    expect(attachmentMarkdown({ name: 'unknown', type: '' }, 'attachments/x')).toBe(
      '[unknown](attachments/x)'
    )
  })
})
