import path from 'node:path'
import os from 'node:os'
import { lstat, realpath, readdir, cp } from 'node:fs/promises'
import { assertInsideVaultAsync } from './vault-boundary.js'
import { resolveImportName } from './fs-import-names.js'

type ImportResult = {
  imported: string[]
  skipped: { source: string; reason: 'not-found' | 'denied' | 'fs-error' }[]
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
  'Library/Keychains/',
  'Library/Cookies/',
]

// os.homedir() may contain symlink components on macOS (FileVault, NFS mounts).
// Cache the realpath-resolved value so blocklist comparisons are resolved-vs-resolved.
let resolvedHome: string | undefined

async function getResolvedHome(): Promise<string> {
  if (!resolvedHome) resolvedHome = await realpath(os.homedir())
  return resolvedHome
}

function isDenied(real: string, home: string): boolean {
  // POSIX separators only — Marvinz targets macOS (Linux best-effort, Windows unsupported)
  const isBlockedAbsolute = BLOCKED_PATH_PREFIXES.some(
    p => real.startsWith(p) || real + '/' === p,
  )
  const isBlockedInHome = BLOCKED_HOME_SUBPATHS.some(p => {
    const base = home + '/' + p.replace(/\/$/, '')
    return real === base || real.startsWith(base + '/')
  })
  return isBlockedAbsolute || isBlockedInHome
}

export async function importExternal(
  activeVaultPath: string,
  sources: string[],
  destDir: string,
): Promise<ImportResult> {
  const safeDestDir = await assertInsideVaultAsync(activeVaultPath, destDir)

  const entries = await readdir(safeDestDir)
  const namesSet = new Set(entries.map(n => n.normalize('NFC')))

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
    } catch {
      skipped.push({ source, reason: 'denied' })
      continue
    }

    if (isDenied(real, home)) {
      skipped.push({ source, reason: 'denied' })
      continue
    }

    const basename = path.basename(source).normalize('NFC')
    const finalName = resolveImportName(basename, namesSet)
    namesSet.add(finalName)

    try {
      await cp(source, path.join(safeDestDir, finalName), {
        recursive: true,
        dereference: false,
        errorOnExist: false,
      })
      imported.push(path.join(safeDestDir, finalName))
    } catch {
      skipped.push({ source, reason: 'fs-error' })
    }
  }

  return { imported, skipped }
}
