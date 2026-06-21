/**
 * Unit tests for the window-level Cmd+F shortcut predicate. Keeps the
 * heavy App.tsx render out of the loop — the predicate is the only piece
 * with non-trivial branching, so testing it directly is the leanest
 * cover for the behavior the user actually sees.
 */

// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { resolveAppFindShortcut } from '../appFindShortcut'

type EventArgs = {
  key?: string
  metaKey?: boolean
  ctrlKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
  target?: Element | null
}

function makeEvent(args: EventArgs = {}): Parameters<typeof resolveAppFindShortcut>[0] {
  return {
    key: args.key ?? 'f',
    metaKey: args.metaKey ?? false,
    ctrlKey: args.ctrlKey ?? false,
    altKey: args.altKey ?? false,
    shiftKey: args.shiftKey ?? false,
    target: args.target ?? null,
  }
}

describe('resolveAppFindShortcut', () => {
  it('returns "find" for Cmd+F when an MD tab is active and no modal is open', () => {
    const result = resolveAppFindShortcut(makeEvent({ metaKey: true, key: 'f' }), {
      modalOpen: false,
      activeMarkdownPath: '/vault/note.md',
    })
    expect(result).toBe('find')
  })

  it('also accepts Ctrl+F (cross-platform; Linux/Windows fallback)', () => {
    const result = resolveAppFindShortcut(makeEvent({ ctrlKey: true, key: 'f' }), {
      modalOpen: false,
      activeMarkdownPath: '/vault/note.md',
    })
    expect(result).toBe('find')
  })

  it('returns "replace" for Cmd+Alt+F', () => {
    const result = resolveAppFindShortcut(makeEvent({ metaKey: true, altKey: true, key: 'f' }), {
      modalOpen: false,
      activeMarkdownPath: '/vault/note.md',
    })
    expect(result).toBe('replace')
  })

  it('handles the uppercase F variant (Shift not pressed; capslock case)', () => {
    const result = resolveAppFindShortcut(makeEvent({ metaKey: true, key: 'F' }), {
      modalOpen: false,
      activeMarkdownPath: '/vault/note.md',
    })
    expect(result).toBe('find')
  })

  it('returns null when no command modifier is pressed', () => {
    const result = resolveAppFindShortcut(makeEvent({ key: 'f' }), {
      modalOpen: false,
      activeMarkdownPath: '/vault/note.md',
    })
    expect(result).toBeNull()
  })

  it('returns null for keys other than f/F', () => {
    const result = resolveAppFindShortcut(makeEvent({ metaKey: true, key: 'g' }), {
      modalOpen: false,
      activeMarkdownPath: '/vault/note.md',
    })
    expect(result).toBeNull()
  })

  it('returns null when Shift is pressed (avoids stealing Cmd+Shift+F bindings)', () => {
    const result = resolveAppFindShortcut(makeEvent({ metaKey: true, shiftKey: true, key: 'f' }), {
      modalOpen: false,
      activeMarkdownPath: '/vault/note.md',
    })
    expect(result).toBeNull()
  })

  it('returns null when a modal/palette/dialog is open', () => {
    const result = resolveAppFindShortcut(makeEvent({ metaKey: true, key: 'f' }), {
      modalOpen: true,
      activeMarkdownPath: '/vault/note.md',
    })
    expect(result).toBeNull()
  })

  it('returns null when the active tab is not a markdown note', () => {
    const result = resolveAppFindShortcut(makeEvent({ metaKey: true, key: 'f' }), {
      modalOpen: false,
      activeMarkdownPath: null,
    })
    expect(result).toBeNull()
  })

  it('returns null when the event originated inside the editor surface', () => {
    // Build a DOM fragment so .closest() walks ancestors realistically.
    const editor = document.createElement('div')
    editor.className = 'editor'
    const inner = document.createElement('div')
    editor.appendChild(inner)
    document.body.appendChild(editor)
    const result = resolveAppFindShortcut(makeEvent({ metaKey: true, key: 'f', target: inner }), {
      modalOpen: false,
      activeMarkdownPath: '/vault/note.md',
    })
    expect(result).toBeNull()
    document.body.removeChild(editor)
  })

  it('still fires when the event target is unrelated chrome (sidebar, tab bar)', () => {
    const sidebar = document.createElement('div')
    sidebar.className = 'sidebar'
    document.body.appendChild(sidebar)
    const result = resolveAppFindShortcut(makeEvent({ metaKey: true, key: 'f', target: sidebar }), {
      modalOpen: false,
      activeMarkdownPath: '/vault/note.md',
    })
    expect(result).toBe('find')
    document.body.removeChild(sidebar)
  })
})
