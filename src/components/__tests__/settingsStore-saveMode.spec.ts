// @vitest-environment jsdom

import { describe, it, expect, beforeEach, vi } from 'vitest'

const LS_PREFIX = 'marvin:settings:'

// settingsStore is a module-level singleton that reads localStorage at import
// time. We must reset modules and re-import to get a fresh read per test.

describe('settingsStore — saveMode persistence', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.resetModules()
  })

  it('reads saveMode "auto" from localStorage', async () => {
    window.localStorage.setItem(`${LS_PREFIX}saveMode`, 'auto')
    const { getSettings } = await import('../../lib/settingsStore')
    expect(getSettings().saveMode).toBe('auto')
  })

  it('reads saveMode "manual" from localStorage', async () => {
    window.localStorage.setItem(`${LS_PREFIX}saveMode`, 'manual')
    const { getSettings } = await import('../../lib/settingsStore')
    expect(getSettings().saveMode).toBe('manual')
  })

  it('ignores invalid saveMode values', async () => {
    window.localStorage.setItem(`${LS_PREFIX}saveMode`, 'invalid-value')
    const { getSettings } = await import('../../lib/settingsStore')
    expect(getSettings().saveMode).toBeUndefined()
  })

  it('returns undefined saveMode when key is absent', async () => {
    const { getSettings } = await import('../../lib/settingsStore')
    expect(getSettings().saveMode).toBeUndefined()
  })
})
