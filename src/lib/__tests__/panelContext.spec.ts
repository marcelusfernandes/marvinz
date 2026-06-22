// @vitest-environment jsdom
//
// Unit tests for the focus-routed Cmd+Z chain (U4 #150 → V2 #456).
// getActivePanelContext detects the focused surface; resolveUndoTarget turns a
// keystroke + context into an UndoRoute the global handler dispatches on.

import { describe, it, expect, afterEach } from 'vitest'
import { getActivePanelContext, resolveUndoTarget } from '../panelContext'

afterEach(() => {
  document.body.innerHTML = ''
})

describe('getActivePanelContext', () => {
  it('returns "editor" when focus is inside a .cm-editor (Source mode)', () => {
    document.body.innerHTML =
      '<div class="cm-editor"><div class="cm-content" tabindex="0">x</div></div>'
    ;(document.querySelector('.cm-content') as HTMLElement).focus()
    expect(getActivePanelContext()).toBe('editor')
  })

  it('returns "editor" when focus is inside a .ProseMirror (Page/preview mode)', () => {
    // The default markdown surface is ProseMirror (Milkdown), not CodeMirror.
    document.body.innerHTML =
      '<div class="ProseMirror milkdown-host" contenteditable="true" tabindex="0">x</div>'
    ;(document.querySelector('.ProseMirror') as HTMLElement).focus()
    expect(getActivePanelContext()).toBe('editor')
  })

  it('returns "file-tree" when focus is inside [data-panel="file-tree"]', () => {
    document.body.innerHTML = '<div data-panel="file-tree"><button>row</button></div>'
    ;(document.querySelector('button') as HTMLElement).focus()
    expect(getActivePanelContext()).toBe('file-tree')
  })

  it('returns "editable" for a focused input', () => {
    document.body.innerHTML = '<input />'
    ;(document.querySelector('input') as HTMLElement).focus()
    expect(getActivePanelContext()).toBe('editable')
  })

  it('returns "editable" for a focused textarea', () => {
    document.body.innerHTML = '<textarea></textarea>'
    ;(document.querySelector('textarea') as HTMLElement).focus()
    expect(getActivePanelContext()).toBe('editable')
  })

  it('returns "editable" for a focused select', () => {
    document.body.innerHTML = '<select><option>a</option></select>'
    ;(document.querySelector('select') as HTMLElement).focus()
    expect(getActivePanelContext()).toBe('editable')
  })

  it('returns "editable" for a focused contentEditable host (non-editor)', () => {
    document.body.innerHTML = '<div contenteditable="true" tabindex="0">x</div>'
    ;(document.querySelector('[contenteditable]') as HTMLElement).focus()
    expect(getActivePanelContext()).toBe('editable')
  })

  it('returns "editable" for a focused input INSIDE the file tree (inline rename)', () => {
    // The inline rename/create field lives inside [data-panel="file-tree"] but
    // must keep its own native text undo — Cmd+Z there must NOT undo a file op.
    document.body.innerHTML = '<div data-panel="file-tree"><input class="rename-input" /></div>'
    ;(document.querySelector('input') as HTMLElement).focus()
    expect(getActivePanelContext()).toBe('editable')
  })

  it('returns "neutral" when focus is on a non-editable element (e.g. a button)', () => {
    document.body.innerHTML = '<button>toolbar</button>'
    ;(document.querySelector('button') as HTMLElement).focus()
    expect(getActivePanelContext()).toBe('neutral')
  })

  it('returns "neutral" when nothing is focused (activeElement is body)', () => {
    document.body.innerHTML = '<div>nothing focusable here</div>'
    expect(getActivePanelContext()).toBe('neutral')
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

  it('routes Cmd+Z in the file tree to the file-ops undo', () => {
    expect(resolveUndoTarget(cmdZ, 'file-tree', true)).toEqual({ target: 'file-tree' })
  })

  it('returns null for Cmd+Z when the editor is truly focused (native keymap owns it)', () => {
    expect(resolveUndoTarget(cmdZ, 'editor', true)).toBeNull()
  })

  it('returns null for Cmd+Z when an editable control is focused (browser-native undo)', () => {
    expect(resolveUndoTarget(cmdZ, 'editable', true)).toBeNull()
  })

  it('falls back to the active editor for Cmd+Z with neutral focus + an editable note open', () => {
    expect(resolveUndoTarget(cmdZ, 'neutral', true)).toEqual({
      target: 'fallback-editor',
      direction: 'undo',
    })
  })

  it('fallback redo for Cmd+Shift+Z with neutral focus + an editable note open', () => {
    expect(resolveUndoTarget({ ...cmdZ, shiftKey: true }, 'neutral', true)).toEqual({
      target: 'fallback-editor',
      direction: 'redo',
    })
  })

  it('returns null for neutral focus when there is no editable active note (nothing to fall back to)', () => {
    expect(resolveUndoTarget(cmdZ, 'neutral', false)).toBeNull()
  })

  it('returns null for Cmd+Shift+Z in the file tree (file-op redo is deferred to the engine)', () => {
    expect(resolveUndoTarget({ ...cmdZ, shiftKey: true }, 'file-tree', true)).toBeNull()
  })

  it('returns null without the Cmd/Ctrl modifier', () => {
    expect(
      resolveUndoTarget({ ...cmdZ, metaKey: false, ctrlKey: false }, 'file-tree', true)
    ).toBeNull()
  })

  it('accepts Ctrl+Z (non-mac) for the file tree', () => {
    expect(
      resolveUndoTarget(
        { key: 'z', shiftKey: false, metaKey: false, ctrlKey: true },
        'file-tree',
        true
      )
    ).toEqual({ target: 'file-tree' })
  })

  it('returns null for non-Z keys', () => {
    expect(resolveUndoTarget({ ...cmdZ, key: 'y' }, 'file-tree', true)).toBeNull()
  })
})
