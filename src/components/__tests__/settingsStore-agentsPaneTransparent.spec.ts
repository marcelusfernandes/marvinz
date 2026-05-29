// @vitest-environment jsdom

import { describe, it, expect, beforeEach, vi } from 'vitest'

const LS_PREFIX = 'marvin:settings:'

// settingsStore is a module-level singleton that reads localStorage at import
// time. We must reset modules and re-import to get a fresh read per test.

describe('settingsStore — agentsPaneTransparent persistence', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.resetModules()
    Object.assign(window, {
      marvin: { settings: { set: vi.fn().mockResolvedValue({}) } },
    })
  })

  it('reads agentsPaneTransparent "true" from localStorage', async () => {
    window.localStorage.setItem(`${LS_PREFIX}agentsPaneTransparent`, 'true')
    const { getSettings } = await import('../../lib/settingsStore')
    expect(getSettings().agentsPaneTransparent).toBe(true)
  })

  it('reads agentsPaneTransparent "false" from localStorage', async () => {
    window.localStorage.setItem(`${LS_PREFIX}agentsPaneTransparent`, 'false')
    const { getSettings } = await import('../../lib/settingsStore')
    expect(getSettings().agentsPaneTransparent).toBe(false)
  })

  it('returns undefined when key is absent', async () => {
    const { getSettings } = await import('../../lib/settingsStore')
    expect(getSettings().agentsPaneTransparent).toBeUndefined()
  })

  it('persists agentsPaneTransparent after setSetting', async () => {
    const { setSetting, getSettings } = await import('../../lib/settingsStore')
    await setSetting('agentsPaneTransparent', true)
    expect(getSettings().agentsPaneTransparent).toBe(true)
    expect(window.localStorage.getItem(`${LS_PREFIX}agentsPaneTransparent`)).toBe('true')
    expect(window.marvin.settings.set).toHaveBeenCalledWith({
      agentsPaneTransparent: true,
    })
  })
})
