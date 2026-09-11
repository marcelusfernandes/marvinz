// @vitest-environment jsdom

/**
 * Wiring test for SnapshotPanel's error-message rendering (#597).
 *
 * SnapshotPanel used to keep its own local ERROR_MESSAGES/friendlyError copy;
 * #597 lifted it into lib/marvinApi.ts's friendlySnapshotError so every
 * snapshot call site shares one map. Since snapshot methods RESOLVE an
 * envelope (`{ ok: false, error }`) rather than reject, tsc/eslint/the rest of
 * the suite passing does not prove this wiring — nothing else exercises it.
 * These tests mock only the IPC calls and use the REAL friendlySnapshotError,
 * so a wiring mistake (wrong import, mapping never applied) fails here.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SnapshotPanel } from '../SnapshotPanel'
import type { SnapshotManifest } from '../../types'

const mockListForFile = vi.fn()
const mockRead = vi.fn()
const mockRestore = vi.fn()

vi.mock('../../lib/marvinApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/marvinApi')>()
  return {
    ...actual,
    marvin: {
      snapshot: {
        listForFile: (...args: unknown[]) => mockListForFile(...args),
        read: (...args: unknown[]) => mockRead(...args),
        restore: (...args: unknown[]) => mockRestore(...args),
      },
    },
  }
})

const VERSION: SnapshotManifest = {
  turnId: '20260101T000000Z-abcdef01',
  files: [{ relPath: 'note.md', sizeBefore: 10, hashBefore: 'x'.repeat(64) }],
  createdAt: new Date().toISOString(),
  timestamp: Date.now(),
  trigger: 'file:write',
  status: 'completed',
}

function renderPanel(overrides: Partial<React.ComponentProps<typeof SnapshotPanel>> = {}) {
  const onClose = vi.fn()
  const onRestored = vi.fn()
  const onError = vi.fn()
  render(
    <SnapshotPanel
      filePath="/vault/note.md"
      relPath="note.md"
      currentContent="current"
      onClose={onClose}
      onRestored={onRestored}
      onError={onError}
      {...overrides}
    />
  )
  return { onClose, onRestored, onError }
}

beforeEach(() => {
  mockListForFile.mockReset()
  mockRead.mockReset()
  mockRestore.mockReset()
})

describe('SnapshotPanel — snapshot envelope error mapping (#597)', () => {
  it('renders the friendly message when listForFile resolves ok:false', async () => {
    mockListForFile.mockResolvedValue({ ok: false, error: 'MARVIN_INVALID_PATH' })

    renderPanel()

    expect(await screen.findByText('Invalid file path.')).toBeInTheDocument()
    expect(screen.queryByText('MARVIN_INVALID_PATH')).not.toBeInTheDocument()
  })

  it('renders the friendly message when read resolves ok:false', async () => {
    mockListForFile.mockResolvedValue({ ok: true, data: [VERSION] })
    mockRead.mockResolvedValue({ ok: false, error: 'SNAPSHOT_FS_ENOENT' })

    renderPanel()

    expect(await screen.findByText('File or version not found.')).toBeInTheDocument()
  })

  it('calls onError with the friendly message when restore resolves ok:false', async () => {
    mockListForFile.mockResolvedValue({ ok: true, data: [VERSION] })
    mockRead.mockResolvedValue({ ok: true, data: 'saved content' })
    mockRestore.mockResolvedValue({ ok: false, error: 'SNAPSHOT_INTERNAL_ERROR' })

    const { onError } = renderPanel()

    const restoreBtn = await screen.findByRole('button', { name: /restore this version/i })
    await waitFor(() => expect(restoreBtn).toBeEnabled())
    fireEvent.click(restoreBtn)

    await waitFor(() =>
      expect(onError).toHaveBeenCalledWith('Internal snapshot error. Please try again.')
    )
  })
})
