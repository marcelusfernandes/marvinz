import path from 'node:path'

// Directories whose entire subtree is irrelevant to the vault: VCS, build
// output, dependency caches, and tool/editor state (.obsidian, .marvin). These
// are hidden from the file tree and excluded from the snapshot watcher.
export const NOISY_DIRS = new Set([
  '.git',
  'node_modules',
  '.DS_Store',
  '.svn',
  '.hg',
  '.idea',
  '.marvin',
  '.obsidian',
  '.next',
  'dist',
  'build',
  'out',
  'target',
  '.turbo',
  '.cache',
])
export const NOISY_FILES = new Set(['.DS_Store', 'Thumbs.db'])

/** Per-entry check used while walking the tree (name + isDir already known). */
export function isNoisy(name: string, isDir: boolean): boolean {
  return isDir ? NOISY_DIRS.has(name) : NOISY_FILES.has(name)
}

/**
 * Whether a vault-relative path is noise. Tests EVERY path segment, not just the
 * basename: under the macOS fsevents backend the watcher receives deep file
 * paths, and a basename-only check lets files inside ignored dirs through (e.g.
 * `.marvin/snapshots/<turn>/_manifest.json`, `.obsidian/workspace.json`). The
 * path must be relative to the vault root so ancestor segments above the vault
 * (which may coincidentally match a noisy name) aren't considered.
 */
export function relPathIsNoisy(relPath: string): boolean {
  if (!relPath) return false
  const segments = relPath.split(path.sep)
  if (segments.some((seg) => NOISY_DIRS.has(seg))) return true
  return NOISY_FILES.has(segments[segments.length - 1])
}
