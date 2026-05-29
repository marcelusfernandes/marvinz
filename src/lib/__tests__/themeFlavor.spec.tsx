// @vitest-environment jsdom

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

// settingsStore is a module-level singleton seeded at import time. Reset
// modules per test so each gets a fresh store, then seed via seedFromMain.

async function load() {
  const store = await import('../settingsStore')
  const { useThemeFlavor } = await import('../themeFlavor')
  return { ...store, useThemeFlavor }
}

describe('useThemeFlavor', () => {
  beforeEach(() => {
    window.localStorage.clear()
    document.documentElement.removeAttribute('data-flavor')
    vi.resetModules()
  })

  it('resolves "pastel" → "pastel" and sets data-flavor', async () => {
    const { seedFromMain, useThemeFlavor } = await load()
    seedFromMain({ themeFlavor: 'pastel' })
    const { result } = renderHook(() => useThemeFlavor())
    expect(result.current).toBe('pastel')
    expect(document.documentElement.dataset.flavor).toBe('pastel')
  })

  it('resolves undefined → "default" and sets data-flavor', async () => {
    const { useThemeFlavor } = await load()
    const { result } = renderHook(() => useThemeFlavor())
    expect(result.current).toBe('default')
    expect(document.documentElement.dataset.flavor).toBe('default')
  })

  it('resolves "default" → "default"', async () => {
    const { seedFromMain, useThemeFlavor } = await load()
    seedFromMain({ themeFlavor: 'default' })
    const { result } = renderHook(() => useThemeFlavor())
    expect(result.current).toBe('default')
    expect(document.documentElement.dataset.flavor).toBe('default')
  })
})
