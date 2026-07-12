import type { MarvinAPI } from '../types'

type FileApi = MarvinAPI['file']
type OfficeApi = MarvinAPI['office']

// Known MARVIN_* codes thrown by the file/office IPC handlers
// (electron/ipc/fs-handlers.ts, electron/conflictResolver.ts,
// electron/fs-rename-guard.ts), mapped to a user-facing message. Codes not
// listed here (or messages that aren't MARVIN_*-shaped at all, e.g. a mammoth
// parse error) pass through unchanged.
const FILE_ERROR_MESSAGES: Record<string, string> = {
  MARVIN_COPY_CONFLICT_LIMIT: 'Too many copies of this file already exist here.',
  MARVIN_FS_EEXIST: 'A file or folder with that name already exists.',
  MARVIN_IS_DIRECTORY: 'That path is a folder, not a file.',
  MARVIN_BINARY: 'This file cannot be opened as text.',
  MARVIN_INVALID_ROWS: 'Invalid spreadsheet data.',
  MARVIN_INVALID_SHEET_NAME: 'Invalid sheet name.',
}

export function friendlyFileError(message: string): string {
  const code = message.split(':')[0].trim()
  const mapped = FILE_ERROR_MESSAGES[code]
  if (mapped) return mapped
  if (code === 'MARVIN_TOO_LARGE') return 'File is too large.'
  if (code.startsWith('MARVIN_FS_')) return `Disk error (${code.slice('MARVIN_FS_'.length)}).`
  return message
}

function wrapFileError<T>(promise: Promise<T>): Promise<T> {
  return promise.catch((err: unknown) => {
    if (err instanceof Error) throw new Error(friendlyFileError(err.message))
    throw err
  })
}

export const marvin = {
  search: {
    content: (query: string) => window.marvin.search.content(query),
  },
  file: {
    pick: (...args: Parameters<FileApi['pick']>) => wrapFileError(window.marvin.file.pick(...args)),
    // Not wrapped: App.tsx's isBinaryReadError/isDirectoryReadError/isTooLargeReadError
    // and humanizeError() branch on this call's raw MARVIN_* message (see #596 notes) —
    // rewriting it here would silently break that control flow.
    read: (...args: Parameters<FileApi['read']>) => window.marvin.file.read(...args),
    write: (...args: Parameters<FileApi['write']>) =>
      wrapFileError(window.marvin.file.write(...args)),
    exportPdf: (...args: Parameters<FileApi['exportPdf']>) =>
      wrapFileError(window.marvin.file.exportPdf(...args)),
    create: (...args: Parameters<FileApi['create']>) =>
      wrapFileError(window.marvin.file.create(...args)),
    writeBinary: (...args: Parameters<FileApi['writeBinary']>) =>
      wrapFileError(window.marvin.file.writeBinary(...args)),
    copy: (...args: Parameters<FileApi['copy']>) => wrapFileError(window.marvin.file.copy(...args)),
    moveBatch: (...args: Parameters<FileApi['moveBatch']>) =>
      wrapFileError(window.marvin.file.moveBatch(...args)),
    onChanged: (...args: Parameters<FileApi['onChanged']>) => window.marvin.file.onChanged(...args),
  },
  office: {
    readDocx: (...args: Parameters<OfficeApi['readDocx']>) =>
      wrapFileError(window.marvin.office.readDocx(...args)),
    writeDocx: (...args: Parameters<OfficeApi['writeDocx']>) =>
      wrapFileError(window.marvin.office.writeDocx(...args)),
    readXlsx: (...args: Parameters<OfficeApi['readXlsx']>) =>
      wrapFileError(window.marvin.office.readXlsx(...args)),
    writeXlsx: (...args: Parameters<OfficeApi['writeXlsx']>) =>
      wrapFileError(window.marvin.office.writeXlsx(...args)),
  },
}
