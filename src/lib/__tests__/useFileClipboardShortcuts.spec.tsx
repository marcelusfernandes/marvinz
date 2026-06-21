// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { FileNode } from '../../types'
import { useFileClipboardShortcuts, resolvePasteTarget } from '../../lib/useFileClipboardShortcuts'
import { useClipboardStore } from '../../lib/clipboardStore'

const VAULT = '/vault'
const tree: FileNode[] = [
  { name: 'a.md', path: '/vault/a.md', isDir: false },
  { name: 'b.md', path: '/vault/b.md', isDir: false },
  {
    name: 'sub',
    path: '/vault/sub',
    isDir: true,
    children: [{ name: 'c.md', path: '/vault/sub/c.md', isDir: false }],
  },
]

let copyMock: ReturnType<typeof vi.fn>
let moveBatchMock: ReturnType<typeof vi.fn>

function setupMarvinMock() {
  copyMock = vi.fn().mockResolvedValue('/vault/sub/a.md')
  moveBatchMock = vi
    .fn()
    .mockResolvedValue([{ src: '/vault/a.md', dest: '/vault/sub/a.md', ok: true }])
  Object.assign(window, {
    marvin: {
      file: { copy: copyMock, moveBatch: moveBatchMock },
    },
  })
}

function dispatchKey(opts: { key: string; meta?: boolean }) {
  const ev = new KeyboardEvent('keydown', {
    key: opts.key,
    metaKey: opts.meta ?? false,
    bubbles: true,
    cancelable: true,
  })
  window.dispatchEvent(ev)
  return ev
}

describe('useFileClipboardShortcuts', () => {
  beforeEach(() => {
    setupMarvinMock()
    useClipboardStore.getState().clear()
    document.body.innerHTML = ''
  })

  it('Cmd+C populates clipboard with selected paths', () => {
    renderHook(() =>
      useFileClipboardShortcuts({
        vaultPath: VAULT,
        selectedPaths: new Set(['/vault/a.md', '/vault/b.md']),
        tree,
        onClearSelection: vi.fn(),
        onPaste: vi.fn(),
      })
    )
    act(() => {
      dispatchKey({ key: 'c', meta: true })
    })
    const s = useClipboardStore.getState()
    expect(s.mode).toBe('copy')
    expect(Array.from(s.paths)).toEqual(['/vault/a.md', '/vault/b.md'])
  })

  it('Cmd+X populates clipboard with cut mode', () => {
    renderHook(() =>
      useFileClipboardShortcuts({
        vaultPath: VAULT,
        selectedPaths: new Set(['/vault/a.md']),
        tree,
        onClearSelection: vi.fn(),
        onPaste: vi.fn(),
      })
    )
    act(() => {
      dispatchKey({ key: 'x', meta: true })
    })
    const s = useClipboardStore.getState()
    expect(s.mode).toBe('cut')
    expect(Array.from(s.paths)).toEqual(['/vault/a.md'])
  })

  it('Cmd+V calls onPaste with selected folder as target', () => {
    const onPaste = vi.fn()
    useClipboardStore.getState().set('copy', ['/vault/a.md'])
    renderHook(() =>
      useFileClipboardShortcuts({
        vaultPath: VAULT,
        selectedPaths: new Set(['/vault/sub']),
        tree,
        onClearSelection: vi.fn(),
        onPaste,
      })
    )
    act(() => {
      dispatchKey({ key: 'v', meta: true })
    })
    expect(onPaste).toHaveBeenCalledWith('/vault/sub')
  })

  it('Cmd+V with empty selection targets the vault root', () => {
    const onPaste = vi.fn()
    useClipboardStore.getState().set('copy', ['/vault/a.md'])
    renderHook(() =>
      useFileClipboardShortcuts({
        vaultPath: VAULT,
        selectedPaths: new Set(),
        tree,
        onClearSelection: vi.fn(),
        onPaste,
      })
    )
    act(() => {
      dispatchKey({ key: 'v', meta: true })
    })
    expect(onPaste).toHaveBeenCalledWith(VAULT)
  })

  it('Cmd+V with empty clipboard is a no-op', () => {
    const onPaste = vi.fn()
    renderHook(() =>
      useFileClipboardShortcuts({
        vaultPath: VAULT,
        selectedPaths: new Set(),
        tree,
        onClearSelection: vi.fn(),
        onPaste,
      })
    )
    act(() => {
      dispatchKey({ key: 'v', meta: true })
    })
    expect(onPaste).not.toHaveBeenCalled()
  })

  it('Cmd+V with multi-selection is ambiguous, bails, and reports via onError', () => {
    const onPaste = vi.fn()
    const onError = vi.fn()
    useClipboardStore.getState().set('copy', ['/vault/a.md'])
    renderHook(() =>
      useFileClipboardShortcuts({
        vaultPath: VAULT,
        selectedPaths: new Set(['/vault/a.md', '/vault/b.md']),
        tree,
        onClearSelection: vi.fn(),
        onPaste,
        onError,
      })
    )
    let ev: KeyboardEvent
    act(() => {
      ev = dispatchKey({ key: 'v', meta: true })
    })
    expect(onPaste).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith('Select a single folder to paste into')
    expect(ev!.defaultPrevented).toBe(true)
  })

  it('Escape clears clipboard and selection', () => {
    const onClearSelection = vi.fn()
    useClipboardStore.getState().set('cut', ['/vault/a.md'])
    renderHook(() =>
      useFileClipboardShortcuts({
        vaultPath: VAULT,
        selectedPaths: new Set(['/vault/a.md']),
        tree,
        onClearSelection,
        onPaste: vi.fn(),
      })
    )
    act(() => {
      dispatchKey({ key: 'Escape' })
    })
    expect(useClipboardStore.getState().mode).toBeNull()
    expect(onClearSelection).toHaveBeenCalled()
  })

  it('bails out when an INPUT element has focus', () => {
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    renderHook(() =>
      useFileClipboardShortcuts({
        vaultPath: VAULT,
        selectedPaths: new Set(['/vault/a.md']),
        tree,
        onClearSelection: vi.fn(),
        onPaste: vi.fn(),
      })
    )
    act(() => {
      dispatchKey({ key: 'c', meta: true })
    })
    expect(useClipboardStore.getState().mode).toBeNull()
  })

  it('does not register a listener when vaultPath is null', () => {
    const onPaste = vi.fn()
    useClipboardStore.getState().set('copy', ['/vault/a.md'])
    renderHook(() =>
      useFileClipboardShortcuts({
        vaultPath: null,
        selectedPaths: new Set(),
        tree,
        onClearSelection: vi.fn(),
        onPaste,
      })
    )
    act(() => {
      dispatchKey({ key: 'v', meta: true })
    })
    expect(onPaste).not.toHaveBeenCalled()
  })
})

describe('resolvePasteTarget', () => {
  it('returns vault when selection is empty', () => {
    expect(resolvePasteTarget(new Set(), tree, VAULT)).toEqual({ target: VAULT })
  })
  it('returns folder path when single folder is selected', () => {
    expect(resolvePasteTarget(new Set(['/vault/sub']), tree, VAULT)).toEqual({
      target: '/vault/sub',
    })
  })
  it('returns parent dir when single file is selected', () => {
    expect(resolvePasteTarget(new Set(['/vault/sub/c.md']), tree, VAULT)).toEqual({
      target: '/vault/sub',
    })
  })
  it('returns ambiguous when multiple selected', () => {
    expect(resolvePasteTarget(new Set(['/vault/a.md', '/vault/b.md']), tree, VAULT)).toEqual({
      ambiguous: true,
    })
  })
  it('falls back to the path itself when single file is at filesystem root', () => {
    const rootTree: FileNode[] = [{ name: 'foo.md', path: '/foo.md', isDir: false }]
    expect(resolvePasteTarget(new Set(['/foo.md']), rootTree, '/vault')).toEqual({
      target: '/foo.md',
    })
  })
})
