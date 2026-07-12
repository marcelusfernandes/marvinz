import { describe, it, expect } from 'vitest'
import { friendlyFileError } from '../marvinApi'

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
