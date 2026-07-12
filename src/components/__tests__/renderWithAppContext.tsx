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
// `rerender(<Editor .../>)` exactly as before.

import { render, type RenderOptions, type RenderResult } from '@testing-library/react'
import type { ReactElement, ReactNode } from 'react'
import { AppProvider } from '../../context/AppContext'

export function renderWithAppContext(
  ui: ReactElement,
  options?: RenderOptions & { vaultPath?: string | null }
): RenderResult {
  const { vaultPath = '/vault', ...rtlOptions } = options ?? {}
  const result = render(<AppProvider vaultPath={vaultPath}>{ui}</AppProvider>, rtlOptions)
  return {
    ...result,
    rerender: (nextUi: ReactNode) =>
      result.rerender(<AppProvider vaultPath={vaultPath}>{nextUi}</AppProvider>),
  }
}
