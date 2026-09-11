import { createContext, useContext, useMemo, type ReactNode } from 'react'

/**
 * Session-global values that descendants would otherwise receive by prop
 * drilling from App (#581). Scoped to `vaultPath` only: settings already live
 * in a global store (`settingsStore`), so consumers read those via `useSetting`
 * directly rather than through a redundant context layer (sanctioned deviation
 * from the AC's "vault path and settings" wording — the AC's intent is to end
 * drilling, not to prescribe the mechanism).
 */
type AppContextValue = {
  /** Active vault path, or null before a vault has been opened. */
  vaultPath: string | null
}

const AppContext = createContext<AppContextValue | null>(null)

export function AppProvider({
  vaultPath,
  children,
}: {
  vaultPath: string | null
  children: ReactNode
}) {
  // Memoized so consumers only re-render when the vault path actually changes
  // (vault switch), not on every App render.
  const value = useMemo(() => ({ vaultPath }), [vaultPath])
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

// Provider + consumer hook share this file by design (standard context pattern);
// the hook export is safe here.
// eslint-disable-next-line react-refresh/only-export-components
export function useAppContext(): AppContextValue {
  const ctx = useContext(AppContext)
  if (ctx === null) {
    // Fail loud: a consumer rendered outside the provider is a wiring bug, not
    // a case to paper over with a silent default.
    throw new Error('useAppContext must be used within an AppProvider')
  }
  return ctx
}
