/**
 * Unit tests for the fileOpsHistory store (U3, issue #149).
 *
 * Tests must FAIL against the current code (store does not yet exist)
 * and PASS once the implementation is in place.
 *
 * Coverage:
 * - push() records rename, move and trash entries
 * - 20-entry FIFO cap (oldest evicted on overflow)
 * - undoLast() calls the correct reverse IPC for each kind
 * - undoLast() on an empty stack is a safe no-op
 * - toast is triggered on successful undo
 * - toast is triggered on conflict / missing-target failures
 * - FIFO eviction ensures the cap is never exceeded
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// IPC bridge mock — isolated per test, injected via window.marvin
// ---------------------------------------------------------------------------

let renameMock: ReturnType<typeof vi.fn>
let restoreOneMock: ReturnType<typeof vi.fn>
let toastMock: ReturnType<typeof vi.fn<(msg: string) => void>>

function setupMarvinMock() {
  renameMock = vi.fn().mockResolvedValue(undefined)
  // restoreOne resolves an { ok } envelope (it never throws) — mirror the
  // real preload bridge so the store's envelope check is exercised faithfully.
  restoreOneMock = vi.fn().mockResolvedValue({ ok: true, data: {} })

  Object.assign(globalThis, {
    marvin: {
      path: { rename: renameMock },
      snapshot: { restoreOne: restoreOneMock },
    },
  })
}

// ---------------------------------------------------------------------------
// Import the store under test AFTER mocks are wired
// ---------------------------------------------------------------------------

// The store does not exist yet — this import will cause a compile/runtime
// error until the implementation is created, keeping the suite in RED.
import {
  useFileOpsHistory,
  type FileOp,
} from '../fileOpsHistory'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build the n-th unique rename op to fill the stack. */
function makeRenameOp(i: number): FileOp {
  return { kind: 'rename', from: `/v/file${i}.md`, to: `/v/renamed${i}.md` }
}

function makeMoveOp(i: number): FileOp {
  return { kind: 'move', from: `/v/src/file${i}.md`, to: `/v/dest/file${i}.md` }
}

function makeTrashOp(i: number): FileOp {
  return { kind: 'trash', path: `/v/note${i}.md`, snapshotId: `snap-${i}` }
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  setupMarvinMock()
  // Reset the store to empty before each test.
  useFileOpsHistory.getState().reset()
  toastMock = vi.fn<(msg: string) => void>()
})

// ---------------------------------------------------------------------------
// push() — recording operations
// ---------------------------------------------------------------------------

describe('fileOpsHistory — push()', () => {
  it('starts with an empty stack', () => {
    expect(useFileOpsHistory.getState().history).toHaveLength(0)
  })

  it('records a rename entry', () => {
    const op: FileOp = { kind: 'rename', from: '/v/a.md', to: '/v/b.md' }
    useFileOpsHistory.getState().push(op)
    const { history } = useFileOpsHistory.getState()
    expect(history).toHaveLength(1)
    expect(history[0]).toEqual(op)
  })

  it('records a move entry', () => {
    const op: FileOp = { kind: 'move', from: '/v/folder1/a.md', to: '/v/folder2/a.md' }
    useFileOpsHistory.getState().push(op)
    expect(useFileOpsHistory.getState().history[0]).toEqual(op)
  })

  it('records a trash entry with snapshotId', () => {
    const op: FileOp = { kind: 'trash', path: '/v/note.md', snapshotId: 'snap-abc' }
    useFileOpsHistory.getState().push(op)
    expect(useFileOpsHistory.getState().history[0]).toEqual(op)
  })

  it('stacks entries in push order (oldest at index 0)', () => {
    const ops = [makeRenameOp(1), makeRenameOp(2), makeRenameOp(3)]
    ops.forEach((op) => useFileOpsHistory.getState().push(op))
    const { history } = useFileOpsHistory.getState()
    expect(history[0]).toEqual(ops[0])
    expect(history[2]).toEqual(ops[2])
  })
})

// ---------------------------------------------------------------------------
// FIFO cap at 20
// ---------------------------------------------------------------------------

describe('fileOpsHistory — 20-entry FIFO cap', () => {
  it('never exceeds 20 entries', () => {
    for (let i = 0; i < 25; i++) {
      useFileOpsHistory.getState().push(makeRenameOp(i))
    }
    expect(useFileOpsHistory.getState().history).toHaveLength(20)
  })

  it('evicts the oldest entry when the cap is reached', () => {
    for (let i = 0; i < 20; i++) {
      useFileOpsHistory.getState().push(makeRenameOp(i))
    }
    // Push one more — entry 0 (oldest) should be evicted.
    useFileOpsHistory.getState().push(makeRenameOp(20))
    const { history } = useFileOpsHistory.getState()
    expect(history[0]).toEqual(makeRenameOp(1))
    expect(history[history.length - 1]).toEqual(makeRenameOp(20))
  })

  it('keeps exactly 20 entries after 30 pushes', () => {
    for (let i = 0; i < 30; i++) {
      useFileOpsHistory.getState().push(makeRenameOp(i))
    }
    expect(useFileOpsHistory.getState().history).toHaveLength(20)
  })
})

// ---------------------------------------------------------------------------
// undoLast() — reverse handlers
// ---------------------------------------------------------------------------

describe('fileOpsHistory — undoLast(): rename', () => {
  it('calls window.marvin.path.rename(to, from) to reverse a rename', async () => {
    const op: FileOp = { kind: 'rename', from: '/v/original.md', to: '/v/renamed.md' }
    useFileOpsHistory.getState().push(op)
    await useFileOpsHistory.getState().undoLast(toastMock)
    expect(renameMock).toHaveBeenCalledWith('/v/renamed.md', '/v/original.md')
  })

  it('pops the entry from the stack after a successful undo', async () => {
    useFileOpsHistory.getState().push({ kind: 'rename', from: '/v/a.md', to: '/v/b.md' })
    await useFileOpsHistory.getState().undoLast(toastMock)
    expect(useFileOpsHistory.getState().history).toHaveLength(0)
  })

  it('calls the toast callback with success message after rename undo', async () => {
    const op: FileOp = { kind: 'rename', from: '/v/original.md', to: '/v/renamed.md' }
    useFileOpsHistory.getState().push(op)
    await useFileOpsHistory.getState().undoLast(toastMock)
    expect(toastMock).toHaveBeenCalledTimes(1)
    const [msg] = toastMock.mock.calls[0] as [string]
    // Message must contain "undo" or "undid" (case-insensitive).
    expect(msg).toMatch(/und(o|id)/i)
    expect(msg).toMatch(/original\.md/i)
  })
})

describe('fileOpsHistory — undoLast(): move', () => {
  it('calls window.marvin.path.rename(to, from) to reverse a move', async () => {
    const op: FileOp = { kind: 'move', from: '/v/src/doc.md', to: '/v/dest/doc.md' }
    useFileOpsHistory.getState().push(op)
    await useFileOpsHistory.getState().undoLast(toastMock)
    expect(renameMock).toHaveBeenCalledWith('/v/dest/doc.md', '/v/src/doc.md')
  })

  it('pops the entry after a successful move undo', async () => {
    useFileOpsHistory.getState().push({ kind: 'move', from: '/v/a/x.md', to: '/v/b/x.md' })
    await useFileOpsHistory.getState().undoLast(toastMock)
    expect(useFileOpsHistory.getState().history).toHaveLength(0)
  })

  it('shows success toast after move undo', async () => {
    const op: FileOp = { kind: 'move', from: '/v/a/doc.md', to: '/v/b/doc.md' }
    useFileOpsHistory.getState().push(op)
    await useFileOpsHistory.getState().undoLast(toastMock)
    expect(toastMock).toHaveBeenCalledTimes(1)
    const [msg] = toastMock.mock.calls[0] as [string]
    // Message must contain "undo" or "undid" (case-insensitive).
    expect(msg).toMatch(/und(o|id)/i)
  })
})

describe('fileOpsHistory — undoLast(): trash', () => {
  it('calls window.marvin.snapshot.restoreOne(snapshotId) to reverse a trash', async () => {
    const op: FileOp = { kind: 'trash', path: '/v/note.md', snapshotId: 'snap-xyz' }
    useFileOpsHistory.getState().push(op)
    await useFileOpsHistory.getState().undoLast(toastMock)
    expect(restoreOneMock).toHaveBeenCalledWith('snap-xyz')
  })

  it('pops the trash entry after a successful restore', async () => {
    useFileOpsHistory.getState().push({ kind: 'trash', path: '/v/n.md', snapshotId: 'snap-1' })
    await useFileOpsHistory.getState().undoLast(toastMock)
    expect(useFileOpsHistory.getState().history).toHaveLength(0)
  })

  it('shows success toast with file name after trash undo', async () => {
    const op: FileOp = { kind: 'trash', path: '/v/note.md', snapshotId: 'snap-xyz' }
    useFileOpsHistory.getState().push(op)
    await useFileOpsHistory.getState().undoLast(toastMock)
    expect(toastMock).toHaveBeenCalledTimes(1)
    const [msg] = toastMock.mock.calls[0] as [string]
    expect(msg).toMatch(/note\.md/i)
  })
})

// ---------------------------------------------------------------------------
// undoLast() — empty stack
// ---------------------------------------------------------------------------

describe('fileOpsHistory — undoLast() on empty stack', () => {
  it('is a no-op when the stack is empty', async () => {
    await expect(
      useFileOpsHistory.getState().undoLast(toastMock),
    ).resolves.not.toThrow()
    expect(renameMock).not.toHaveBeenCalled()
    expect(restoreOneMock).not.toHaveBeenCalled()
    expect(toastMock).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// undoLast() — failure: IPC throws (conflict / missing target)
// ---------------------------------------------------------------------------

describe('fileOpsHistory — undoLast(): failure handling', () => {
  it('calls toast with failure message when rename reverse throws', async () => {
    renameMock.mockRejectedValue(new Error('ENOENT'))
    const op: FileOp = { kind: 'rename', from: '/v/original.md', to: '/v/renamed.md' }
    useFileOpsHistory.getState().push(op)
    await useFileOpsHistory.getState().undoLast(toastMock)
    expect(toastMock).toHaveBeenCalledTimes(1)
    const [msg] = toastMock.mock.calls[0] as [string]
    expect(msg).toMatch(/cannot undo|no longer exists|conflict/i)
  })

  it('re-pushes the entry when rename reverse fails', async () => {
    renameMock.mockRejectedValue(new Error('ENOENT'))
    const op: FileOp = { kind: 'rename', from: '/v/original.md', to: '/v/renamed.md' }
    useFileOpsHistory.getState().push(op)
    await useFileOpsHistory.getState().undoLast(toastMock)
    // Entry is restored so the user can retry or inspect.
    expect(useFileOpsHistory.getState().history).toHaveLength(1)
    expect(useFileOpsHistory.getState().history[0]).toEqual(op)
  })

  it('calls toast with failure message when restoreOne returns an error envelope', async () => {
    restoreOneMock.mockResolvedValue({ ok: false, error: 'snapshot missing' })
    const op: FileOp = { kind: 'trash', path: '/v/note.md', snapshotId: 'snap-xyz' }
    useFileOpsHistory.getState().push(op)
    await useFileOpsHistory.getState().undoLast(toastMock)
    expect(toastMock).toHaveBeenCalledTimes(1)
    const [msg] = toastMock.mock.calls[0] as [string]
    expect(msg).toMatch(/cannot undo|no longer exists|conflict/i)
  })

  it('re-pushes the trash entry when restoreOne fails', async () => {
    restoreOneMock.mockResolvedValue({ ok: false, error: 'snapshot missing' })
    const op: FileOp = { kind: 'trash', path: '/v/note.md', snapshotId: 'snap-xyz' }
    useFileOpsHistory.getState().push(op)
    await useFileOpsHistory.getState().undoLast(toastMock)
    expect(useFileOpsHistory.getState().history).toHaveLength(1)
    expect(useFileOpsHistory.getState().history[0]).toEqual(op)
  })
})

// ---------------------------------------------------------------------------
// Sequential undos
// ---------------------------------------------------------------------------

describe('fileOpsHistory — sequential undos', () => {
  it('undoes multiple ops in LIFO order (most recent first)', async () => {
    const rename1: FileOp = { kind: 'rename', from: '/v/a.md', to: '/v/b.md' }
    const rename2: FileOp = { kind: 'rename', from: '/v/c.md', to: '/v/d.md' }
    useFileOpsHistory.getState().push(rename1)
    useFileOpsHistory.getState().push(rename2)

    // First undo should reverse rename2 (most recent).
    await useFileOpsHistory.getState().undoLast(toastMock)
    expect(renameMock).toHaveBeenLastCalledWith('/v/d.md', '/v/c.md')
    expect(useFileOpsHistory.getState().history).toHaveLength(1)

    // Second undo should reverse rename1.
    renameMock.mockClear()
    await useFileOpsHistory.getState().undoLast(toastMock)
    expect(renameMock).toHaveBeenLastCalledWith('/v/b.md', '/v/a.md')
    expect(useFileOpsHistory.getState().history).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// undoLast() — reveal payload (#456): surfaces the affected path so App can
// activate the right tab, plus a remap for rename/move so open tabs that still
// record the post-rename path get pointed back at the restored path.
// ---------------------------------------------------------------------------

describe('fileOpsHistory — undoLast(): reveal payload', () => {
  it('returns the restored path + tab remap for a rename undo', async () => {
    const op: FileOp = { kind: 'rename', from: '/v/original.md', to: '/v/renamed.md' }
    useFileOpsHistory.getState().push(op)
    const res = await useFileOpsHistory.getState().undoLast(toastMock)
    expect(res.ok).toBe(true)
    expect(res.revealedPath).toBe('/v/original.md')
    // Open tabs currently record `/v/renamed.md`; remap them back to the origin.
    expect(res.remap).toEqual({ from: '/v/renamed.md', to: '/v/original.md' })
  })

  it('returns the restored path + tab remap for a move undo', async () => {
    const op: FileOp = { kind: 'move', from: '/v/src/doc.md', to: '/v/dest/doc.md' }
    useFileOpsHistory.getState().push(op)
    const res = await useFileOpsHistory.getState().undoLast(toastMock)
    expect(res.ok).toBe(true)
    expect(res.revealedPath).toBe('/v/src/doc.md')
    expect(res.remap).toEqual({ from: '/v/dest/doc.md', to: '/v/src/doc.md' })
  })

  it('returns the restored path with NO remap for a trash undo', async () => {
    const op: FileOp = { kind: 'trash', path: '/v/note.md', snapshotId: 'snap-xyz' }
    useFileOpsHistory.getState().push(op)
    const res = await useFileOpsHistory.getState().undoLast(toastMock)
    expect(res.ok).toBe(true)
    expect(res.revealedPath).toBe('/v/note.md')
    expect(res.remap).toBeUndefined()
  })

  it('returns ok:false with no reveal data on an empty stack', async () => {
    const res = await useFileOpsHistory.getState().undoLast(toastMock)
    expect(res.ok).toBe(false)
    expect(res.revealedPath).toBeUndefined()
    expect(res.remap).toBeUndefined()
  })

  it('returns ok:false with no reveal data when the reverse fails', async () => {
    renameMock.mockRejectedValue(new Error('ENOENT'))
    const op: FileOp = { kind: 'rename', from: '/v/original.md', to: '/v/renamed.md' }
    useFileOpsHistory.getState().push(op)
    const res = await useFileOpsHistory.getState().undoLast(toastMock)
    expect(res.ok).toBe(false)
    expect(res.revealedPath).toBeUndefined()
    expect(res.remap).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// reset()
// ---------------------------------------------------------------------------

describe('fileOpsHistory — reset()', () => {
  it('clears all entries', () => {
    useFileOpsHistory.getState().push(makeRenameOp(1))
    useFileOpsHistory.getState().push(makeMoveOp(1))
    useFileOpsHistory.getState().reset()
    expect(useFileOpsHistory.getState().history).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Mixed op types
// ---------------------------------------------------------------------------

describe('fileOpsHistory — mixed op types', () => {
  it('handles rename, move and trash ops in the same stack', () => {
    useFileOpsHistory.getState().push(makeRenameOp(1))
    useFileOpsHistory.getState().push(makeMoveOp(1))
    useFileOpsHistory.getState().push(makeTrashOp(1))
    expect(useFileOpsHistory.getState().history).toHaveLength(3)
  })
})
