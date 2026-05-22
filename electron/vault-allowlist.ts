import path from 'node:path'

/**
 * Asserts that `vaultPath` is in the allowedVaultPaths set.
 * Throws 'MARVIN_VAULT_NOT_ALLOWED' if not present.
 * Used by the vault:watch handler before accepting a new vault path.
 */
export function assertAllowedVault(vaultPath: string, allowedPaths: Set<string>): void {
  if (!allowedPaths.has(path.resolve(vaultPath))) {
    throw new Error('MARVIN_VAULT_NOT_ALLOWED')
  }
}
