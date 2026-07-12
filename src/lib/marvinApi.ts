import type { MarvinAPI } from '../types'

type FileApi = MarvinAPI['file']
type OfficeApi = MarvinAPI['office']
type PtyApi = MarvinAPI['pty']
type AgentApi = MarvinAPI['agent']
type BrowserApi = MarvinAPI['browser']
type SnapshotApi = MarvinAPI['snapshot']

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

// Known MARVIN_* codes thrown by electron/pty-spawn-guard.ts. pty.spawn is the
// only pty method that can reject with one of these (AgentTerminal.tsx displays
// the rejection's raw message to the user, so mapping it here is user-visible).
const PTY_ERROR_MESSAGES: Record<string, string> = {
  MARVIN_SHELL_NOT_ALLOWED: 'This shell is not allowed to run.',
  MARVIN_SHELL_ARGS_FORBIDDEN: 'Arguments are not allowed for this shell.',
}

export function friendlyPtyError(message: string): string {
  const code = message.split(':')[0].trim()
  return PTY_ERROR_MESSAGES[code] ?? message
}

function wrapPtyError<T>(promise: Promise<T>): Promise<T> {
  return promise.catch((err: unknown) => {
    if (err instanceof Error) throw new Error(friendlyPtyError(err.message))
    throw err
  })
}

// Known SNAPSHOT_*/MARVIN_* codes returned in a SnapshotEnvelope's `error` field
// (electron/snapshot.ts). Unlike file/office, snapshot methods RESOLVE with
// `{ ok: false, error }` rather than rejecting — callers must run this on
// `res.error` themselves; there is no promise to .catch(). Lifted verbatim from
// SnapshotPanel.tsx's former local copy (#597) so every call site shares one map.
const SNAPSHOT_ERROR_MESSAGES: Record<string, string> = {
  SNAPSHOT_NO_VAULT: 'No folder is open.',
  SNAPSHOT_INVALID_TURN_ID: 'Invalid version identifier.',
  SNAPSHOT_INVALID_REL_PATH: 'Invalid file path.',
  SNAPSHOT_INTERNAL_ERROR: 'Internal snapshot error. Please try again.',
  SNAPSHOT_FS_ENOENT: 'File or version not found.',
  SNAPSHOT_FS_EACCES: 'No permission to access the file.',
  SNAPSHOT_FS_EPERM: 'Operation not permitted.',
  SNAPSHOT_FS_EISDIR: 'Path points to a directory.',
  MARVIN_INVALID_PATH: 'Invalid file path.',
  MARVIN_INVALID_TURN_ID: 'Invalid version identifier.',
}

export function friendlySnapshotError(code: string): string {
  const mapped = SNAPSHOT_ERROR_MESSAGES[code]
  if (mapped) return mapped
  if (code.startsWith('SNAPSHOT_FS_')) return `Disk error (${code.slice('SNAPSHOT_FS_'.length)}).`
  return `Could not complete the operation. (${code})`
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
  pty: {
    // Wrapped: the only pty call whose rejection reaches the user raw today
    // (AgentTerminal.tsx writes err.message straight into the terminal).
    spawn: (...args: Parameters<PtyApi['spawn']>) => wrapPtyError(window.marvin.pty.spawn(...args)),
    // Not wrapped: fire-and-forget from the renderer, no MARVIN_* mapping applies.
    write: (...args: Parameters<PtyApi['write']>) => window.marvin.pty.write(...args),
    resize: (...args: Parameters<PtyApi['resize']>) => window.marvin.pty.resize(...args),
    kill: (...args: Parameters<PtyApi['kill']>) => window.marvin.pty.kill(...args),
    onData: (...args: Parameters<PtyApi['onData']>) => window.marvin.pty.onData(...args),
    onExit: (...args: Parameters<PtyApi['onExit']>) => window.marvin.pty.onExit(...args),
  },
  agent: {
    detect: (...args: Parameters<AgentApi['detect']>) => window.marvin.agent.detect(...args),
    // Not wrapped: request/approve resolve an { ok } envelope, but no caller
    // reads it today (useToolApproval.ts/hooks.ts await-and-ignore) — nothing
    // to centralize without inventing unused behavior.
    request: (...args: Parameters<AgentApi['request']>) => window.marvin.agent.request(...args),
    approve: (...args: Parameters<AgentApi['approve']>) => window.marvin.agent.approve(...args),
    onEvent: (...args: Parameters<AgentApi['onEvent']>) => window.marvin.agent.onEvent(...args),
  },
  browser: {
    create: (...args: Parameters<BrowserApi['create']>) => window.marvin.browser.create(...args),
    navigate: (...args: Parameters<BrowserApi['navigate']>) =>
      window.marvin.browser.navigate(...args),
    back: (...args: Parameters<BrowserApi['back']>) => window.marvin.browser.back(...args),
    forward: (...args: Parameters<BrowserApi['forward']>) => window.marvin.browser.forward(...args),
    reload: (...args: Parameters<BrowserApi['reload']>) => window.marvin.browser.reload(...args),
    stop: (...args: Parameters<BrowserApi['stop']>) => window.marvin.browser.stop(...args),
    setBounds: (...args: Parameters<BrowserApi['setBounds']>) =>
      window.marvin.browser.setBounds(...args),
    setGeometry: (...args: Parameters<BrowserApi['setGeometry']>) =>
      window.marvin.browser.setGeometry(...args),
    setActive: (...args: Parameters<BrowserApi['setActive']>) =>
      window.marvin.browser.setActive(...args),
    setAllHidden: (...args: Parameters<BrowserApi['setAllHidden']>) =>
      window.marvin.browser.setAllHidden(...args),
    close: (...args: Parameters<BrowserApi['close']>) => window.marvin.browser.close(...args),
    onEvent: (...args: Parameters<BrowserApi['onEvent']>) => window.marvin.browser.onEvent(...args),
  },
  // Snapshot methods resolve a SnapshotEnvelope (`{ ok, data } | { ok: false,
  // error }`) rather than rejecting — pass through unwrapped and let the call
  // site run friendlySnapshotError on res.error, same as file/office run
  // friendlyFileError on a caught message.
  snapshot: {
    listTurns: (...args: Parameters<SnapshotApi['listTurns']>) =>
      window.marvin.snapshot.listTurns(...args),
    listForFile: (...args: Parameters<SnapshotApi['listForFile']>) =>
      window.marvin.snapshot.listForFile(...args),
    read: (...args: Parameters<SnapshotApi['read']>) => window.marvin.snapshot.read(...args),
    restore: (...args: Parameters<SnapshotApi['restore']>) =>
      window.marvin.snapshot.restore(...args),
    saveBuffer: (...args: Parameters<SnapshotApi['saveBuffer']>) =>
      window.marvin.snapshot.saveBuffer(...args),
    saveExternalChange: (...args: Parameters<SnapshotApi['saveExternalChange']>) =>
      window.marvin.snapshot.saveExternalChange(...args),
    capture: (...args: Parameters<SnapshotApi['capture']>) =>
      window.marvin.snapshot.capture(...args),
    restoreOne: (...args: Parameters<SnapshotApi['restoreOne']>) =>
      window.marvin.snapshot.restoreOne(...args),
    onTurnCompleted: (...args: Parameters<SnapshotApi['onTurnCompleted']>) =>
      window.marvin.snapshot.onTurnCompleted(...args),
  },
}
