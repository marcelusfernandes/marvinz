import { describe, it, expect, beforeEach } from 'vitest'
import { useClipboardStore, clipPasteLabel } from '../clipboardStore'

describe('clipboardStore', () => {
  beforeEach(() => {
    useClipboardStore.getState().clear()
  })

  it('initial state is mode=null and empty paths', () => {
    const s = useClipboardStore.getState()
    expect(s.mode).toBeNull()
    expect(s.paths.size).toBe(0)
  })

  it('set("copy", paths) populates mode and paths', () => {
    useClipboardStore.getState().set('copy', ['/v/a.md', '/v/b.md'])
    const s = useClipboardStore.getState()
    expect(s.mode).toBe('copy')
    expect(Array.from(s.paths)).toEqual(['/v/a.md', '/v/b.md'])
  })

  it('set("cut", paths) overrides a prior copy', () => {
    useClipboardStore.getState().set('copy', ['/v/a.md'])
    useClipboardStore.getState().set('cut', ['/v/b.md'])
    const s = useClipboardStore.getState()
    expect(s.mode).toBe('cut')
    expect(Array.from(s.paths)).toEqual(['/v/b.md'])
  })

  it('clear() resets to initial state', () => {
    useClipboardStore.getState().set('cut', ['/v/a.md'])
    useClipboardStore.getState().clear()
    const s = useClipboardStore.getState()
    expect(s.mode).toBeNull()
    expect(s.paths.size).toBe(0)
  })
})

describe('clipPasteLabel', () => {
  it('returns "Paste" when mode is null', () => {
    expect(clipPasteLabel({ mode: null, paths: new Set() })).toBe('Paste')
  })
  it('returns "Paste" for single-path clipboard', () => {
    expect(clipPasteLabel({ mode: 'copy', paths: new Set(['/v/a.md']) })).toBe('Paste')
  })
  it('pluralizes for multi-path clipboard', () => {
    expect(clipPasteLabel({ mode: 'cut', paths: new Set(['/v/a.md', '/v/b.md']) })).toBe(
      'Paste 2 items',
    )
  })
})
