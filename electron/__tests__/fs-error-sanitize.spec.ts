import { describe, it, expect, vi } from 'vitest'

// main.ts touches the electron module at import time — mock it (same shape as
// app-menu-template.spec.ts) so we can import the pure wrapFsError helper.
vi.mock('electron', () => ({
  app: { getPath: vi.fn(), on: vi.fn(), whenReady: vi.fn(() => ({ then: vi.fn() })) },
  BrowserWindow: vi.fn(),
  Menu: { buildFromTemplate: vi.fn(), setApplicationMenu: vi.fn() },
  MenuItem: vi.fn(),
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  protocol: { registerSchemesAsPrivileged: vi.fn(), handle: vi.fn() },
  dialog: {},
  shell: {},
  clipboard: {},
  WebContentsView: vi.fn(),
}))

import { wrapFsError } from '../main.js'

function errno(code: string, message: string): NodeJS.ErrnoException {
  const e = new Error(message) as NodeJS.ErrnoException
  e.code = code
  return e
}

describe('wrapFsError', () => {
  it('maps an fs ErrnoException to MARVIN_FS_<CODE> and drops the host path', () => {
    const raw = errno('EACCES', "EACCES: permission denied, open '/Users/lipe/vault/foo.md'")
    expect(() => wrapFsError(raw)).toThrow('MARVIN_FS_EACCES')
    try {
      wrapFsError(raw)
    } catch (e) {
      expect((e as Error).message).toBe('MARVIN_FS_EACCES')
      expect((e as Error).message).not.toContain('/Users/lipe')
    }
  })

  it('maps other fs codes (ENOSPC, EISDIR, EEXIST)', () => {
    expect(() => wrapFsError(errno('ENOSPC', 'no space'))).toThrow('MARVIN_FS_ENOSPC')
    expect(() => wrapFsError(errno('EISDIR', 'is dir'))).toThrow('MARVIN_FS_EISDIR')
    expect(() => wrapFsError(errno('EEXIST', 'exists'))).toThrow('MARVIN_FS_EEXIST')
  })

  it('passes MARVIN_* domain codes through untouched', () => {
    const domain = new Error('MARVIN_OUTSIDE_VAULT')
    expect(() => wrapFsError(domain)).toThrow('MARVIN_OUTSIDE_VAULT')
    const tooLarge = new Error('MARVIN_TOO_LARGE: 42')
    expect(() => wrapFsError(tooLarge)).toThrow('MARVIN_TOO_LARGE: 42')
  })

  it('passes SNAPSHOT_* codes through untouched', () => {
    expect(() => wrapFsError(new Error('SNAPSHOT_NO_VAULT'))).toThrow('SNAPSHOT_NO_VAULT')
  })

  it('falls back to MARVIN_FS_UNKNOWN for an error with no code', () => {
    expect(() => wrapFsError(new Error('weird failure'))).toThrow('MARVIN_FS_UNKNOWN')
  })

  it('falls back to MARVIN_FS_UNKNOWN for a non-Error throw', () => {
    expect(() => wrapFsError('string error')).toThrow('MARVIN_FS_UNKNOWN')
  })
})
