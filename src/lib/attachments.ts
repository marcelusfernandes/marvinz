function pad(n: number) {
  return String(n).padStart(2, '0')
}

function timestamp(): string {
  const d = new Date()
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  )
}

export function buildAttachmentRelPath(filename: string): string {
  const lastDot = filename.lastIndexOf('.')
  const hasExt = lastDot > 0
  const rawBase = hasExt ? filename.slice(0, lastDot) : filename
  const rawExt = hasExt ? filename.slice(lastDot + 1) : ''

  // NFKC first so NFC/NFD forms of the same name (e.g. macOS HFS+ uses NFD)
  // collapse to one canonical slug — reproducible across platforms.
  const sanitize = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[^a-z0-9._-]/g, '-')
  const base = sanitize(rawBase)
  const ext = sanitize(rawExt)

  const slug = hasExt ? `${base}.${ext}` : base
  return `attachments/${timestamp()}-${slug}`
}

export function attachmentMarkdown(file: { name: string; type: string }, relPath: string): string {
  if (file.type.startsWith('image/')) {
    return `![${file.name}](${relPath})`
  }
  return `[${file.name}](${relPath})`
}
