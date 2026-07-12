// @vitest-environment jsdom
//
// Contract test for AppContext (issue #581, AC5: "tests cover context values
// propagate + update on vault switch / setting change"). Written against the
// real provider (src/context/AppContext.tsx, commit 2bf25e4) — the
// foundational context/provider, independent of the still-open A/B decision
// on whether leaf components drop `vaultPath` as a prop or keep an optional
// override. This proves propagation generically at the context boundary,
// rather than per-leaf-component, which is the right level for AC5: whatever
// A/B answer lands, any consumer reading `useAppContext()` inherits this
// guarantee.
//
// Covers: initial value propagates to consumers; consumers re-render with the
// new value when the provider's vaultPath changes (the "vault switch" case);
// the memoized context value keeps referential identity when vaultPath is
// unchanged (so an unrelated App re-render doesn't cascade into every
// consumer); and the fail-loud throw when used outside a provider.

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AppProvider, useAppContext } from '../AppContext'

function VaultPathProbe() {
  const { vaultPath } = useAppContext()
  return <div data-testid="vault-path-probe">{vaultPath ?? '(none)'}</div>
}

function ContextValueProbe({ onRender }: { onRender: (value: unknown) => void }) {
  const ctx = useAppContext()
  onRender(ctx)
  return null
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('AppContext — propagation', () => {
  it('propagates the initial vaultPath to consumers', () => {
    render(
      <AppProvider vaultPath="/vault-a">
        <VaultPathProbe />
      </AppProvider>
    )
    expect(screen.getByTestId('vault-path-probe').textContent).toBe('/vault-a')
  })

  it('propagates null before a vault has been opened', () => {
    render(
      <AppProvider vaultPath={null}>
        <VaultPathProbe />
      </AppProvider>
    )
    expect(screen.getByTestId('vault-path-probe').textContent).toBe('(none)')
  })

  it('re-renders consumers with the new vaultPath on a vault switch', () => {
    const { rerender } = render(
      <AppProvider vaultPath="/vault-a">
        <VaultPathProbe />
      </AppProvider>
    )
    expect(screen.getByTestId('vault-path-probe').textContent).toBe('/vault-a')

    rerender(
      <AppProvider vaultPath="/vault-b">
        <VaultPathProbe />
      </AppProvider>
    )

    expect(screen.getByTestId('vault-path-probe').textContent).toBe('/vault-b')
  })
})

describe('AppContext — memoization', () => {
  it('keeps the same context value reference across a re-render when vaultPath is unchanged', () => {
    const seen: unknown[] = []
    const { rerender } = render(
      <AppProvider vaultPath="/vault-a">
        <ContextValueProbe onRender={(v) => seen.push(v)} />
      </AppProvider>
    )

    // Re-render the provider with an unrelated change (children identity)
    // but the same vaultPath — the memoized value must not be recreated.
    rerender(
      <AppProvider vaultPath="/vault-a">
        <ContextValueProbe onRender={(v) => seen.push(v)} />
      </AppProvider>
    )

    expect(seen).toHaveLength(2)
    expect(seen[1]).toBe(seen[0])
  })

  it('creates a new context value reference when vaultPath changes', () => {
    const seen: unknown[] = []
    const { rerender } = render(
      <AppProvider vaultPath="/vault-a">
        <ContextValueProbe onRender={(v) => seen.push(v)} />
      </AppProvider>
    )

    rerender(
      <AppProvider vaultPath="/vault-b">
        <ContextValueProbe onRender={(v) => seen.push(v)} />
      </AppProvider>
    )

    expect(seen).toHaveLength(2)
    expect(seen[1]).not.toBe(seen[0])
  })
})

describe('AppContext — fail-loud outside a provider', () => {
  it('throws when useAppContext is called without an AppProvider ancestor', () => {
    // React logs the thrown render error to console.error even though this
    // test asserts on it — suppress that expected noise for this case only.
    vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => render(<VaultPathProbe />)).toThrow(
      'useAppContext must be used within an AppProvider'
    )
  })
})
