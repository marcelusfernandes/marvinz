import path from 'node:path'
import os from 'node:os'
import { lstat, realpath, readdir, cp } from 'node:fs/promises'
import { assertCwdInsideVaultAsync } from './vault-boundary.js'
import { resolveImportName } from './fs-import-names.js'

type ImportResult = {
  imported: string[]
  skipped: { source: string; reason: 'not-found' | 'denied' | 'broken-symlink' | 'fs-error' }[]
}

// Best-effort defense in depth against trivial exfiltration of well-known
// sensitive paths. The primary defense is no renderer XSS; this stops
// naive attempts (e.g. a compromised renderer asking for /etc/passwd).
// realpath() is called before these checks so symlink aliases like
// /private/etc resolve to their canonical form before matching.
const BLOCKED_PATH_PREFIXES = [
  '/etc/',
  '/System/',
  '/Library/',
  '/usr/',
  '/var/db/',
  '/var/log/',
  '/var/root/',
  '/var/spool/',
  '/dev/',
  '/bin/',
  '/sbin/',
  // macOS: realpath resolves /etc → /private/etc, /var → /private/var, etc.
  '/private/etc/',
  '/private/var/db/',
  '/private/var/log/',
  '/private/var/root/',
  '/private/var/spool/',
]

const BLOCKED_HOME_SUBPATHS = [
  '.ssh/',
  '.aws/',
  '.gnupg/',
  '.config/', // gcloud, gh CLI, and many other tool credentials/configs
  '.docker/', // registry credentials
  '.kube/', // cluster admin kubeconfigs
  'Library/Keychains/',
  'Library/Cookies/',
  'Library/Application Support/', // browser saved passwords, IDE tokens, Slack/Discord auth
  'Library/Mail/',
  'Library/Messages/',
  'Library/Containers/',
  'Library/Group Containers/',
]

// Loose credential-bearing files directly in ~ (the subpath matcher only
// covers directories). Matched as exact `~/<name>`.
const BLOCKED_HOME_FILES = [
  '.gitconfig', // may carry [credential] plaintext
  '.netrc',
  '.npmrc',
  '.pypirc',
  '.zsh_history',
  '.bash_history',
]

// os.homedir() may contain symlink components on macOS (FileVault, NFS mounts).
// Cache the realpath-resolved value so blocklist comparisons are resolved-vs-resolved.
let resolvedHome: string | undefined

async function getResolvedHome(): Promise<string> {
  if (!resolvedHome) resolvedHome = await realpath(os.homedir())
  return resolvedHome
}

export function isDenied(real: string, home: string): boolean {
  // POSIX separators only — Marvinz targets macOS (Linux best-effort, Windows unsupported)
  const isBlockedAbsolute = BLOCKED_PATH_PREFIXES.some(
    (p) => real.startsWith(p) || real + '/' === p
  )
  const isBlockedInHome = BLOCKED_HOME_SUBPATHS.some((p) => {
    const base = home + '/' + p.replace(/\/$/, '')
    return real === base || real.startsWith(base + '/')
  })
  const isBlockedFile = BLOCKED_HOME_FILES.some((name) => real === home + '/' + name)
  return isBlockedAbsolute || isBlockedInHome || isBlockedFile
}

export async function importExternal(
  activeVaultPath: string,
  sources: string[],
  destDir: string
): Promise<ImportResult> {
  const safeDestDir = await assertCwdInsideVaultAsync(activeVaultPath, destDir)

  const entries = await readdir(safeDestDir)
  // Lowercased to match case-insensitive filesystem semantics (APFS/NTFS
  // default); resolveImportName also compares case-insensitively, so this
  // keeps the set's own invariant consistent as entries are added below.
  const namesSet = new Set(entries.map((n) => n.normalize('NFC').toLowerCase()))

  const imported: string[] = []
  const skipped: ImportResult['skipped'] = []
  const home = await getResolvedHome()

  for (const source of sources) {
    try {
      await lstat(source)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
        skipped.push({ source, reason: 'not-found' })
        continue
      }
      throw e
    }

    // realpath first — resolves symlink aliases (e.g. /private/etc → /etc)
    // before the blocklist check, preventing bypass via symlink indirection.
    // realpath→cp is intentionally non-atomic; renderer is the trust boundary,
    // so the swap race adds nothing a compromised renderer doesn't already have.
    let real: string
    try {
      real = await realpath(source)
    } catch (e) {
      // ENOENT here means a dangling symlink (target gone) — a user error they
      // can fix, distinct from a security-policy block. Other codes (EACCES,
      // ELOOP) stay 'denied' for defense.
      const reason = (e as NodeJS.ErrnoException).code === 'ENOENT' ? 'broken-symlink' : 'denied'
      skipped.push({ source, reason })
      continue
    }

    if (isDenied(real, home)) {
      skipped.push({ source, reason: 'denied' })
      continue
    }

    const basename = path.basename(source).normalize('NFC')
    const finalName = resolveImportName(basename, namesSet)
    namesSet.add(finalName.toLowerCase())

    try {
      await cp(source, path.join(safeDestDir, finalName), {
        recursive: true,
        dereference: false,
        // Defense in depth: even if collision detection above were bypassed,
        // fail fast instead of silently overwriting an existing vault file.
        errorOnExist: true,
        force: false,
      })
      imported.push(path.join(safeDestDir, finalName))
    } catch {
      skipped.push({ source, reason: 'fs-error' })
    }
  }

  return { imported, skipped }
}
