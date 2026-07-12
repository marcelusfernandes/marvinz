// @vitest-environment jsdom
//
// Issue #581, AC5's "setting change" clause: settings live in settingsStore
// (useSyncExternalStore), not AppContext — vaultPath alone moved to context;
// consumers keep reading settings via `useSetting` directly (the sanctioned
// deviation documented in src/context/AppContext.tsx). The existing
// settingsStore-*.spec.ts files cover persistence (getSettings/localStorage)
// but never mount a `useSetting` consumer and prove it actually re-renders
// when the value changes after mount — this is that proof.
//
// Placed as .spec.tsx (not .spec.ts) to run under vitest's jsdom project:
// renderHook needs a real DOM to mount into, unlike the plain-state
// settingsStore-*.spec.ts files that only call getSettings()/setSetting()
// directly.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// settingsStore is a module-level singleton seeded from localStorage at
// import time — reset modules and re-import per test for isolation.

describe('useSetting — reactivity on setting change', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.resetModules()
  })

  it('re-renders a useSetting consumer with the new value after setSetting', async () => {
    Object.assign(window, {
      marvin: { settings: { set: vi.fn().mockResolvedValue(undefined) } },
    })
    const { useSetting, setSetting } = await import('../settingsStore')

    const { result } = renderHook(() => useSetting('saveMode'))
    expect(result.current).toBeUndefined()

    await act(async () => {
      await setSetting('saveMode', 'manual')
    })

    expect(result.current).toBe('manual')
  })

  it('re-renders a useSetting consumer when seedFromMain updates the value', async () => {
    const { useSetting, seedFromMain } = await import('../settingsStore')

    const { result } = renderHook(() => useSetting('themeFlavor'))
    expect(result.current).toBeUndefined()

    act(() => {
      seedFromMain({ themeFlavor: 'pastel' })
    })

    expect(result.current).toBe('pastel')
  })
})
