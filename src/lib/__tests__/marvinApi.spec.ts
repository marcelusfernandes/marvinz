import { describe, it, expect } from 'vitest'
import { friendlyFileError, friendlyPtyError, friendlySnapshotError } from '../marvinApi'

describe('friendlyFileError', () => {
  it('maps MARVIN_COPY_CONFLICT_LIMIT to a user-facing message', () => {
    expect(friendlyFileError('MARVIN_COPY_CONFLICT_LIMIT')).toBe(
      'Too many copies of this file already exist here.'
    )
  })

  it('maps other known file/office MARVIN_* codes', () => {
    expect(friendlyFileError('MARVIN_FS_EEXIST')).toBe(
      'A file or folder with that name already exists.'
    )
    expect(friendlyFileError('MARVIN_IS_DIRECTORY')).toBe('That path is a folder, not a file.')
    expect(friendlyFileError('MARVIN_BINARY')).toBe('This file cannot be opened as text.')
    expect(friendlyFileError('MARVIN_INVALID_ROWS')).toBe('Invalid spreadsheet data.')
    expect(friendlyFileError('MARVIN_INVALID_SHEET_NAME')).toBe('Invalid sheet name.')
  })

  it('strips the ": <detail>" suffix before matching MARVIN_TOO_LARGE', () => {
    expect(friendlyFileError('MARVIN_TOO_LARGE: 12345678')).toBe('File is too large.')
    expect(friendlyFileError('MARVIN_TOO_LARGE')).toBe('File is too large.')
  })

  it('maps any MARVIN_FS_<code> to a generic disk-error message', () => {
    expect(friendlyFileError('MARVIN_FS_ENOENT')).toBe('Disk error (ENOENT).')
    expect(friendlyFileError('MARVIN_FS_EACCES')).toBe('Disk error (EACCES).')
  })

  it('passes through an unrecognized MARVIN_* code unchanged', () => {
    expect(friendlyFileError('MARVIN_SOMETHING_ELSE')).toBe('MARVIN_SOMETHING_ELSE')
  })

  it('passes through a non-MARVIN_* message unchanged', () => {
    expect(friendlyFileError('ENOENT: no such file or directory')).toBe(
      'ENOENT: no such file or directory'
    )
  })
})

describe('friendlyPtyError', () => {
  it('maps the pty-spawn-guard shell rejection codes', () => {
    expect(friendlyPtyError('MARVIN_SHELL_NOT_ALLOWED')).toBe('This shell is not allowed to run.')
    expect(friendlyPtyError('MARVIN_SHELL_ARGS_FORBIDDEN')).toBe(
      'Arguments are not allowed for this shell.'
    )
  })

  it('passes through an unrecognized message unchanged', () => {
    expect(friendlyPtyError('spawn ENOENT')).toBe('spawn ENOENT')
  })
})

describe('friendlySnapshotError', () => {
  it('maps known SNAPSHOT_*/MARVIN_* codes', () => {
    expect(friendlySnapshotError('SNAPSHOT_NO_VAULT')).toBe('No folder is open.')
    expect(friendlySnapshotError('SNAPSHOT_INVALID_TURN_ID')).toBe('Invalid version identifier.')
    expect(friendlySnapshotError('MARVIN_INVALID_PATH')).toBe('Invalid file path.')
  })

  it('maps any SNAPSHOT_FS_<code> to a generic disk-error message', () => {
    expect(friendlySnapshotError('SNAPSHOT_FS_ENOENT')).toBe('File or version not found.')
    expect(friendlySnapshotError('SNAPSHOT_FS_EPERM')).toBe('Operation not permitted.')
  })

  it('maps the electron/snapshot.ts trigger/lookup codes (MARVIN_INVALID_TRIGGER, MARVIN_UNKNOWN_SNAPSHOT)', () => {
    expect(friendlySnapshotError('MARVIN_INVALID_TRIGGER')).toBe('Invalid operation.')
    expect(friendlySnapshotError('MARVIN_UNKNOWN_SNAPSHOT')).toBe('Snapshot not found.')
  })

  it('falls back to a generic "could not complete" message for unknown codes', () => {
    expect(friendlySnapshotError('SNAPSHOT_WEIRD_CODE')).toBe(
      'Could not complete the operation. (SNAPSHOT_WEIRD_CODE)'
    )
  })
})
