import { attachmentMarkdown, buildAttachmentRelPath } from './attachments'

export const ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024
export const MARVIN_PATH_MIME = 'application/x-marvin-path'
export const IMAGE_EXT_RE = /\.(png|jpe?g|gif|svg|webp|avif|bmp|ico|heic|heif)$/i

export type ImportToast = {
  state: 'success' | 'error' | 'partial'
  message: string
}
export type ToastEmitter = (toast: ImportToast) => void

export function uint8ToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

// Some drag sources (macOS screenshot UI thumbnail, NSFilePromise) leave
// dt.files empty but populate dt.items. This covers both.
export function collectFiles(dt: DataTransfer): File[] {
  const out: File[] = Array.from(dt.files ?? [])
  if (out.length > 0) return out
  if (dt.items) {
    for (let i = 0; i < dt.items.length; i++) {
      const item = dt.items[i]
      if (item.kind === 'file') {
        const f = item.getAsFile()
        if (f) out.push(f)
      }
    }
  }
  return out
}

// Compute a markdown link path from the directory holding the current note to
// the target file (both absolute). Falls back to the target path if either
// argument is empty.
export function linkFromNoteDir(noteAbsPath: string, targetAbsPath: string): string {
  if (!noteAbsPath || !targetAbsPath) return targetAbsPath
  const fromParts = noteAbsPath.split('/').slice(0, -1).filter(Boolean)
  const toParts = targetAbsPath.split('/').filter(Boolean)
  let i = 0
  while (i < fromParts.length && i < toParts.length && fromParts[i] === toParts[i]) i++
  const up = '../'.repeat(fromParts.length - i)
  const down = toParts.slice(i).join('/')
  return up + down || './'
}

// Wrap a markdown link target in angle brackets when it contains characters
// that would break standard `(url)` parsing (spaces or parens). The resolver
// (resolveImageSrc → toMarvinUrl) expects raw paths and URL-encodes per
// segment itself, so we must NOT pre-encode here.
export function mdLinkTarget(link: string): string {
  return /[\s()]/.test(link) ? `<${link}>` : link
}

// Build the markdown line for an internal drag (file already lives in the
// vault — we only emit a reference, no IPC copy).
export function internalDragMarkdown(noteAbsPath: string, targetAbsPath: string): string {
  const name = targetAbsPath.split('/').pop() ?? targetAbsPath
  const link = mdLinkTarget(linkFromNoteDir(noteAbsPath, targetAbsPath))
  return IMAGE_EXT_RE.test(name) ? `![${name}](${link})` : `[${name}](${link})`
}

export type WriteBinary = (payload: {
  vaultPath: string
  relPath: string
  base64Bytes: string
}) => Promise<string>

export type ExternalDropOutcome = {
  okCount: number
  errCount: number
  inserts: string[]
}

// Persist a list of files into <vault>/attachments/ via the writeBinary IPC,
// emitting a per-file error toast on rejection. Returns the markdown lines to
// insert (one per successfully-persisted file) plus tallies for the caller's
// summary toast.
export async function persistDroppedFiles(args: {
  files: File[]
  vaultPath: string
  notePath: string
  writeBinary: WriteBinary
  onToast: ToastEmitter | undefined
}): Promise<ExternalDropOutcome> {
  const { files, vaultPath, notePath, writeBinary, onToast } = args
  const inserts: string[] = []
  let okCount = 0
  let errCount = 0
  for (const file of files) {
    if (file.size > ATTACHMENT_MAX_BYTES) {
      errCount++
      onToast?.({ state: 'error', message: `${file.name} is larger than 25 MB.` })
      continue
    }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const base64Bytes =
        typeof Buffer !== 'undefined' ? Buffer.from(bytes).toString('base64') : uint8ToBase64(bytes)
      const relPath = buildAttachmentRelPath(file.name)
      const persistedRelPath = await writeBinary({ vaultPath, relPath, base64Bytes })
      const absoluteAttachmentPath = `${vaultPath}/${persistedRelPath}`
      const link = mdLinkTarget(linkFromNoteDir(notePath, absoluteAttachmentPath))
      inserts.push(attachmentMarkdown(file, link))
      okCount++
    } catch (err) {
      errCount++
      const reason = err instanceof Error ? err.message : String(err)
      onToast?.({ state: 'error', message: `Failed to import ${file.name}: ${reason}` })
    }
  }
  return { okCount, errCount, inserts }
}

// Emit the summary toast after a batch of drops. Caller decides whether to
// call this (e.g. skip if nothing was attempted).
export function emitSummaryToast(outcome: ExternalDropOutcome, onToast?: ToastEmitter): void {
  const { okCount, errCount } = outcome
  const total = okCount + errCount
  if (okCount === total && okCount > 0) {
    onToast?.({
      state: 'success',
      message: `Imported ${okCount} attachment${okCount > 1 ? 's' : ''}.`,
    })
  } else if (okCount > 0) {
    onToast?.({ state: 'partial', message: `Imported ${okCount} of ${total} attachments.` })
  }
}
