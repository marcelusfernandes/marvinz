// Build-time feature flags.
//
// CHAT_UI_ENABLED gates the native chat UI (bubbles + approval gate + diff/
// snapshot) out of release builds while it is still under development. Vite
// statically replaces import.meta.env.VITE_CHAT_UI_ENABLED at build time:
//   - dev (npm run dev): .env.development sets it to "true" → chat available
//   - release (vite build): var unset → flag false → chat unreachable, and the
//     dead branch is eligible for tree-shaking.
//
// To work on the chat UI, run `npm run dev` (the env file enables it). To ship
// a release without it, build with the var unset (the default).
export const CHAT_UI_ENABLED = import.meta.env.VITE_CHAT_UI_ENABLED === 'true'

// MODERN_UI_ENABLED gates the redesigned Modern visual style out of release
// builds while it is being polished. Same Vite static-replace pattern as
// CHAT_UI_ENABLED above:
//   - dev (npm run dev): .env.development sets it to "true" → Modern toggle
//     available in Settings; user choice respected
//   - release (vite build): var unset → flag false → useVisualStyle forces
//     'legacy' regardless of persisted setting; Settings hides the toggle
//
// The user's `visualStyle` setting is preserved on disk when the flag is off
// (not mutated) — when the flag is re-enabled, the user's previous choice
// returns automatically.
export const MODERN_UI_ENABLED = import.meta.env.VITE_MODERN_UI_ENABLED === 'true'

export type TabMode = 'chat' | 'terminal'

// Pure resolver for a new agent tab's mode. Extracted so the gating logic is
// unit-testable without touching import.meta.env.
//   - chatUiEnabled false → always 'terminal' (release: chat is gated)
//   - chatUiEnabled true  → 'chat' for chat-capable providers unless the user
//     opted into terminal mode
export function resolveTabMode(
  chatUiEnabled: boolean,
  terminalModeDefault: boolean,
  isChatProvider: boolean,
): TabMode {
  if (!chatUiEnabled) return 'terminal'
  return !terminalModeDefault && isChatProvider ? 'chat' : 'terminal'
}
