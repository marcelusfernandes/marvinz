// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

const LS_PREFIX = 'marvin:settings:'

function mockMatchMedia(reduced: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: reduced,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia
}

describe('useEditorEffects — html attributes', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.resetModules()
    delete document.documentElement.dataset.editorEffects
    delete document.documentElement.dataset.editorEffectCaretSlide
    delete document.documentElement.dataset.reducedMotion
    mockMatchMedia(false)
    Object.assign(window, {
      marvin: { settings: { set: vi.fn().mockResolvedValue({}) } },
    })
  })

  afterEach(() => {
    delete document.documentElement.dataset.editorEffects
    delete document.documentElement.dataset.editorEffectCaretSlide
    delete document.documentElement.dataset.reducedMotion
  })

  it('defaults both attributes on when settings are absent', async () => {
    const { useEditorEffects } = await import('../../lib/colorTheme')
    renderHook(() => useEditorEffects())
    expect(document.documentElement.dataset.editorEffects).toBe('on')
    expect(document.documentElement.dataset.editorEffectCaretSlide).toBe('on')
  })

  it('removes master attribute when editorEffectsMaster is false', async () => {
    window.localStorage.setItem(`${LS_PREFIX}editorEffectsMaster`, 'false')
    const { useEditorEffects } = await import('../../lib/colorTheme')
    renderHook(() => useEditorEffects())
    expect(document.documentElement.dataset.editorEffects).toBeUndefined()
  })

  it('removes caret-slide attribute when editorEffectCaretSlide is false', async () => {
    window.localStorage.setItem(`${LS_PREFIX}editorEffectCaretSlide`, 'false')
    const { useEditorEffects } = await import('../../lib/colorTheme')
    renderHook(() => useEditorEffects())
    expect(document.documentElement.dataset.editorEffectCaretSlide).toBeUndefined()
  })

  it('sets data-reduced-motion when prefers-reduced-motion matches', async () => {
    mockMatchMedia(true)
    const { useEditorEffects } = await import('../../lib/colorTheme')
    renderHook(() => useEditorEffects())
    expect(document.documentElement.dataset.reducedMotion).toBe('true')
  })

  it('leaves data-reduced-motion absent when no reduced-motion preference', async () => {
    const { useEditorEffects } = await import('../../lib/colorTheme')
    renderHook(() => useEditorEffects())
    expect(document.documentElement.dataset.reducedMotion).toBeUndefined()
  })
})
