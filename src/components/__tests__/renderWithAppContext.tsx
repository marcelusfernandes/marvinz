// Drop-in replacement for @testing-library/react's `render`, wrapping the UI
// in AppProvider (#581) so specs stay valid once Editor/LiveMarkdown/
// AgentTerminal/AgentsPane stop accepting `vaultPath` as a prop and read
// useAppContext() instead. Until that migration lands, these components still
// read their own `vaultPath` prop — this wrapper just puts the matching
// context value in place ahead of time so the migration doesn't also require
// touching every spec that renders them.
//
// Defaults to '/vault', matching the vaultPath prop value already used by
// every affected spec; pass `{ vaultPath }` to override for a specific case
// (e.g. a "no vault open" scenario).
//
// `rerender` re-wraps automatically so callers can keep calling
// `rerender(<Editor .../>)` exactly as before. It also accepts an optional
// second argument, `rerender(ui, { vaultPath })`, to change the CONTEXT value
// on a rerender (e.g. simulating a vault switch on an already-mounted
// component, #618) — sticky across subsequent calls that omit it, so a later
// `rerender(ui)` keeps the last vaultPath rather than reverting to the
// initial one.
import { render, type RenderOptions, type RenderResult } from '@testing-library/react'
import type { ReactElement, ReactNode } from 'react'
import { AppProvider } from '../../context/AppContext'

type RerenderWithVaultPath = (nextUi: ReactNode, next?: { vaultPath?: string | null }) => void

export function renderWithAppContext(
  ui: ReactElement,
  options?: RenderOptions & { vaultPath?: string | null }
): Omit<RenderResult, 'rerender'> & { rerender: RerenderWithVaultPath } {
  const { vaultPath = '/vault', ...rtlOptions } = options ?? {}
  let currentVaultPath = vaultPath
  const result = render(<AppProvider vaultPath={currentVaultPath}>{ui}</AppProvider>, rtlOptions)
  return {
    ...result,
    rerender: (nextUi, next) => {
      if (next && next.vaultPath !== undefined) currentVaultPath = next.vaultPath
      result.rerender(<AppProvider vaultPath={currentVaultPath}>{nextUi}</AppProvider>)
    },
  }
}
