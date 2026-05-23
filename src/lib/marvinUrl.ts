/**
 * Build a `marvin://` URL for an absolute file path inside the vault.
 *
 * `localhost` is a placeholder hostname: Chromium's standard URL parser
 * refuses an empty hostname for schemes registered as `standard`, and
 * would otherwise consume the first path segment (e.g. `Users`) as the
 * host. Each path segment is URL-encoded so spaces and unicode survive.
 */
export function toMarvinUrl(absPath: string): string {
  const encoded = absPath
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/')
  return `marvin://localhost${encoded}`
}
