// @vitest-environment jsdom

import { describe, it, expect, beforeEach, vi } from 'vitest'

const LS_PREFIX = 'marvin:settings:'

// settingsStore is a module-level singleton that reads localStorage at import
// time. We must reset modules and re-import to get a fresh read per test.

describe('settingsStore — editor effects persistence', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.resetModules()
    Object.assign(window, {
      marvin: { settings: { set: vi.fn().mockResolvedValue({}) } },
    })
  })

  it('reads editorEffectsMaster "false" from localStorage', async () => {
    window.localStorage.setItem(`${LS_PREFIX}editorEffectsMaster`, 'false')
    const { getSettings } = await import('../../lib/settingsStore')
    expect(getSettings().editorEffectsMaster).toBe(false)
  })

  it('reads editorEffectCaretSlide "true" from localStorage', async () => {
    window.localStorage.setItem(`${LS_PREFIX}editorEffectCaretSlide`, 'true')
    const { getSettings } = await import('../../lib/settingsStore')
    expect(getSettings().editorEffectCaretSlide).toBe(true)
  })

  it('returns undefined for both keys when absent', async () => {
    const { getSettings } = await import('../../lib/settingsStore')
    expect(getSettings().editorEffectsMaster).toBeUndefined()
    expect(getSettings().editorEffectCaretSlide).toBeUndefined()
  })

  it('persists editorEffectCaretSlide after setSetting', async () => {
    const { setSetting, getSettings } = await import('../../lib/settingsStore')
    await setSetting('editorEffectCaretSlide', false)
    expect(getSettings().editorEffectCaretSlide).toBe(false)
    expect(window.localStorage.getItem(`${LS_PREFIX}editorEffectCaretSlide`)).toBe(
      'false',
    )
    expect(window.marvin.settings.set).toHaveBeenCalledWith({
      editorEffectCaretSlide: false,
    })
  })
})
