// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

const LS_PREFIX = 'marvin:settings:'

describe('useAgentsPaneTransparent — html attribute', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.resetModules()
    delete document.documentElement.dataset.agentsPaneTransparent
    Object.assign(window, {
      marvin: { settings: { set: vi.fn().mockResolvedValue({}) } },
    })
  })

  afterEach(() => {
    delete document.documentElement.dataset.agentsPaneTransparent
  })

  it('sets data-agents-pane-transparent on <html> when setting is true', async () => {
    window.localStorage.setItem(`${LS_PREFIX}agentsPaneTransparent`, 'true')
    const { useAgentsPaneTransparent } = await import('../../lib/colorTheme')
    renderHook(() => useAgentsPaneTransparent())
    expect(document.documentElement.dataset.agentsPaneTransparent).toBe('true')
  })

  it('leaves the attribute absent when setting is off', async () => {
    const { useAgentsPaneTransparent } = await import('../../lib/colorTheme')
    renderHook(() => useAgentsPaneTransparent())
    expect(document.documentElement.dataset.agentsPaneTransparent).toBeUndefined()
  })
})
