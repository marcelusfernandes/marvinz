import { realpathSync } from 'node:fs'

// Hardcoded set of binary names that may be resolved via agent:detect.
// Only these names can be added to dynamicShells and subsequently used in pty:spawn.
const ALLOWED_AGENT_NAMES = new Set(['claude', 'codex', 'cursor-agent', 'aider'])

// Mirrors the dynamicShells set in pty-spawn-guard.ts — populated here so
// assertAgentDetectAllowed and getDynamicShells can be tested in isolation.
// main.ts calls registerDynamicShell (in pty-spawn-guard.ts) after a successful detect;
// this module tracks the same state for testability.
const _dynamicShells = new Set<string>()

/**
 * Validates the agent name requested via agent:detect.
 * Throws MARVIN_AGENT_NOT_ALLOWED for any name not in the hardcoded allowlist.
 */
export function assertAgentDetectAllowed(name: string): void {
  if (typeof name !== 'string' || !ALLOWED_AGENT_NAMES.has(name)) {
    throw new Error('MARVIN_AGENT_NOT_ALLOWED')
  }
}

/**
 * Returns the current set of dynamicShells registered through this module.
 * Used by tests to assert that rejected detect attempts do not poison the set.
 */
export function getDynamicShells(): ReadonlySet<string> {
  return _dynamicShells
}

/**
 * Called after a successful binary detection to register the resolved path.
 * Must be called only after assertAgentDetectAllowed passes.
 */
export function registerDetectedAgent(resolvedPath: string): void {
  try {
    _dynamicShells.add(realpathSync(resolvedPath))
  } catch {
    // path doesn't exist or no perms — skip silently
  }
}
