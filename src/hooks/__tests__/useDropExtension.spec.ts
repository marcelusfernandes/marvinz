// @vitest-environment jsdom

import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useDropExtension } from '../useDropExtension'

// The drop behavior (internal-path vs external-file branching, flash-highlight
// insert) is exercised end-to-end by the Editor-drop / LiveMarkdown-drop specs
// and the #605 e2e. The property that matters at the hook boundary — and that
// those specs don't isolate — is memoization stability: the extension must NOT
// be rebuilt on unrelated rerenders, because rebuilding a CodeMirror extension
// tears the editor state (undo history, cursor) down.
describe('useDropExtension (#590)', () => {
  it('returns a stable extension across rerenders when its deps are unchanged', () => {
    const onImportToast = () => {}
    const { result, rerender } = renderHook((props) => useDropExtension(props), {
      initialProps: { vaultPath: '/v', filePath: '/v/n.md', onImportToast },
    })
    const first = result.current
    rerender({ vaultPath: '/v', filePath: '/v/n.md', onImportToast })
    expect(result.current).toBe(first)
  })

  it('rebuilds the extension only when a dep (filePath / vaultPath) changes', () => {
    const onImportToast = () => {}
    const { result, rerender } = renderHook((props) => useDropExtension(props), {
      initialProps: { vaultPath: '/v', filePath: '/v/a.md', onImportToast },
    })
    const first = result.current
    rerender({ vaultPath: '/v', filePath: '/v/b.md', onImportToast })
    expect(result.current).not.toBe(first)
  })

  it('produces a truthy CodeMirror extension', () => {
    const { result } = renderHook(() => useDropExtension({ vaultPath: '/v', filePath: '/v/n.md' }))
    expect(result.current).toBeTruthy()
  })
})
