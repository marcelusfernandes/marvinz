/**
 * Persistence helpers for find-bar UI preferences. Currently a single key
 * tracks whether the Replace row is expanded; centralized here so both the
 * CodeMirror and Milkdown bars stay in lockstep.
 */

const REPLACE_EXPANDED_KEY = 'marvin:find-bar:replace-expanded'

export function readReplaceExpanded(): boolean {
  try {
    return window.localStorage.getItem(REPLACE_EXPANDED_KEY) === '1'
  } catch {
    return false
  }
}

export function writeReplaceExpanded(value: boolean): void {
  try {
    window.localStorage.setItem(REPLACE_EXPANDED_KEY, value ? '1' : '0')
  } catch {
    // Ignored — localStorage may be unavailable (SSR, sandboxed iframe).
  }
}
