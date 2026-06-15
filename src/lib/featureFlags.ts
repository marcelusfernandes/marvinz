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

// OFFICE_EDIT_ENABLED gates Office (Excel/Word) editing + save out of release
// builds while it is still under development. The read-only preview is always
// available; only the edit toggle, editable cells, and save path are gated.
// Vite statically replaces import.meta.env.VITE_OFFICE_EDIT_ENABLED at build time:
//   - dev (npm run dev): .env.development sets it to "true" → editing available
//   - release (vite build): var unset → flag false → editing unreachable, and the
//     dead branch is eligible for tree-shaking.
//
// To work on Office editing, run `npm run dev` (the env file enables it). To ship
// a release without it, build with the var unset (the default).
export const OFFICE_EDIT_ENABLED = import.meta.env.VITE_OFFICE_EDIT_ENABLED === 'true'

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
