// @vitest-environment jsdom
//
// Unit tests for getActivePanelContext (U4, issue #150) — the focus detector
// that lets the global Cmd+Z handler route to the right panel.

import { describe, it, expect, afterEach } from 'vitest'
import { getActivePanelContext, resolveUndoTarget } from '../panelContext'

afterEach(() => {
  document.body.innerHTML = ''
})

describe('getActivePanelContext', () => {
  it('returns "editor" when focus is inside a .cm-editor', () => {
    document.body.innerHTML =
      '<div class="cm-editor"><div class="cm-content" tabindex="0">x</div></div>'
    ;(document.querySelector('.cm-content') as HTMLElement).focus()
    expect(getActivePanelContext()).toBe('editor')
  })

  it('returns "file-tree" when focus is inside [data-panel="file-tree"]', () => {
    document.body.innerHTML = '<div data-panel="file-tree"><button>row</button></div>'
    ;(document.querySelector('button') as HTMLElement).focus()
    expect(getActivePanelContext()).toBe('file-tree')
  })

  it('returns "other" when focus is in an unrelated element', () => {
    document.body.innerHTML = '<input />'
    ;(document.querySelector('input') as HTMLElement).focus()
    expect(getActivePanelContext()).toBe('other')
  })

  it('returns "other" when nothing is focused (activeElement is body)', () => {
    document.body.innerHTML = '<div>nothing focusable here</div>'
    expect(getActivePanelContext()).toBe('other')
  })

  it('prefers "editor" over "file-tree" when an editor is nested in the tree', () => {
    document.body.innerHTML =
      '<div data-panel="file-tree"><div class="cm-editor"><span tabindex="0">x</span></div></div>'
    ;(document.querySelector('span') as HTMLElement).focus()
    expect(getActivePanelContext()).toBe('editor')
  })
})

describe('resolveUndoTarget', () => {
  const cmdZ = { key: 'z', shiftKey: false, metaKey: true, ctrlKey: false }

  it('returns "file-tree" for Cmd+Z when the file tree is focused', () => {
    expect(resolveUndoTarget(cmdZ, 'file-tree')).toBe('file-tree')
  })

  it('returns null for Cmd+Z when the editor is focused (CodeMirror owns it)', () => {
    expect(resolveUndoTarget(cmdZ, 'editor')).toBeNull()
  })

  it('returns null for Cmd+Z when focus is elsewhere', () => {
    expect(resolveUndoTarget(cmdZ, 'other')).toBeNull()
  })

  it('returns null for Cmd+Shift+Z even in the file tree (redo is editor-only in V1)', () => {
    expect(resolveUndoTarget({ ...cmdZ, shiftKey: true }, 'file-tree')).toBeNull()
  })

  it('returns null without the Cmd/Ctrl modifier', () => {
    expect(
      resolveUndoTarget({ ...cmdZ, metaKey: false, ctrlKey: false }, 'file-tree'),
    ).toBeNull()
  })

  it('accepts Ctrl+Z (non-mac) for the file tree', () => {
    expect(
      resolveUndoTarget(
        { key: 'z', shiftKey: false, metaKey: false, ctrlKey: true },
        'file-tree',
      ),
    ).toBe('file-tree')
  })

  it('returns null for non-Z keys', () => {
    expect(resolveUndoTarget({ ...cmdZ, key: 'y' }, 'file-tree')).toBeNull()
  })
})
