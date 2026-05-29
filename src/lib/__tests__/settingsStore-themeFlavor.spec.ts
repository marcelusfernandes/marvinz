// @vitest-environment jsdom

import { describe, it, expect, beforeEach, vi } from 'vitest'

const LS_PREFIX = 'marvin:settings:'

// settingsStore is a module-level singleton that reads localStorage at import
// time. We must reset modules and re-import to get a fresh read per test.

describe('settingsStore — themeFlavor persistence', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.resetModules()
  })

  it('reads themeFlavor "default" from localStorage', async () => {
    window.localStorage.setItem(`${LS_PREFIX}themeFlavor`, 'default')
    const { getSettings } = await import('../../lib/settingsStore')
    expect(getSettings().themeFlavor).toBe('default')
  })

  it('reads themeFlavor "pastel" from localStorage', async () => {
    window.localStorage.setItem(`${LS_PREFIX}themeFlavor`, 'pastel')
    const { getSettings } = await import('../../lib/settingsStore')
    expect(getSettings().themeFlavor).toBe('pastel')
  })

  it('ignores invalid themeFlavor values', async () => {
    window.localStorage.setItem(`${LS_PREFIX}themeFlavor`, 'invalid-value')
    const { getSettings } = await import('../../lib/settingsStore')
    expect(getSettings().themeFlavor).toBeUndefined()
  })

  it('returns undefined themeFlavor when key is absent', async () => {
    const { getSettings } = await import('../../lib/settingsStore')
    expect(getSettings().themeFlavor).toBeUndefined()
  })

  it('round-trips themeFlavor through setSetting → localStorage', async () => {
    Object.assign(window, {
      marvin: { settings: { set: vi.fn().mockResolvedValue(undefined) } },
    })
    const { setSetting } = await import('../../lib/settingsStore')
    await setSetting('themeFlavor', 'pastel')
    expect(window.localStorage.getItem(`${LS_PREFIX}themeFlavor`)).toBe('pastel')
    expect(window.marvin.settings.set).toHaveBeenCalledWith({ themeFlavor: 'pastel' })
  })

  it('rehydrates themeFlavor via seedFromMain', async () => {
    const { getSettings, seedFromMain } = await import('../../lib/settingsStore')
    expect(getSettings().themeFlavor).toBeUndefined()
    seedFromMain({ themeFlavor: 'pastel' })
    expect(getSettings().themeFlavor).toBe('pastel')
  })
})
