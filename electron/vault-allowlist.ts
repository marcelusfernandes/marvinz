import path from 'node:path'

/**
 * Asserts that `vaultPath` is in the allowedVaultPaths set.
 * Throws 'MARVIN_VAULT_NOT_ALLOWED' if not present.
 * Used by the vault:watch handler before accepting a new vault path.
 */
export function assertAllowedVault(vaultPath: string, allowedVaultPaths: Set<string>): void {
  const resolved = path.resolve(vaultPath)
  if (!allowedVaultPaths.has(resolved)) {
    throw new Error('MARVIN_VAULT_NOT_ALLOWED')
  }
}
