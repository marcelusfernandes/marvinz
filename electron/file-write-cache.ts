import fs from 'node:fs/promises'

/**
 * Persist text and advance the watcher baseline only after the write succeeds.
 * This keeps a later AI-triggered watcher snapshot anchored to the most recent
 * in-app save rather than to an older editor read.
 */
export async function writeTextFileAndRefreshCache(
  cache: Map<string, string>,
  filePath: string,
  content: string
): Promise<void> {
  await fs.writeFile(filePath, content, 'utf8')
  cache.set(filePath, content)
}
