export function resolveImportName(
  basename: string,
  existingNames: ReadonlySet<string> | readonly string[]
): string {
  const lookup = existingNames instanceof Set ? existingNames : new Set(existingNames)
  // Case-insensitive lookup: default filesystems (APFS, NTFS) treat names
  // differing only in case as the same file. Comparisons are case-insensitive,
  // but the returned name always preserves the caller's original casing.
  const lowerLookup = new Set([...lookup].map((n) => n.toLowerCase()))
  const collides = (name: string) => lowerLookup.has(name.toLowerCase())

  if (!collides(basename)) return basename

  const lastDot = basename.lastIndexOf('.')
  // leading dot on a dotfile (e.g. ".gitignore") does not count as extension separator
  const splitAt = basename.startsWith('.') && lastDot === 0 ? -1 : lastDot
  const stem = splitAt === -1 ? basename : basename.slice(0, splitAt)
  const ext = splitAt === -1 ? '' : basename.slice(splitAt)

  for (let n = 1; n <= 999; n++) {
    const candidate = `${stem} (${n})${ext}`
    if (!collides(candidate)) return candidate
  }

  throw new Error('MARVIN_IMPORT_NAME_EXHAUSTED')
}
