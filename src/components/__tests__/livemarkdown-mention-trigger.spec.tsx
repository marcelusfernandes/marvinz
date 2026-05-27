// @vitest-environment jsdom

/**
 * Integration tests for the @-mention trigger in LiveMarkdown.
 *
 * Strategy: mirror LiveMarkdown-drop.spec.tsx — mock Milkdown/prosemirror
 * dependencies, capture the mentionPlugin's callbacks by intercepting
 * `prosePluginsCtx.update`, then drive the picker via those callbacks
 * and verify React state + PM dispatch.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act } from '@testing-library/react'
import React from 'react'

// ---------------------------------------------------------------------------
// Hoisted symbols — module-stable identities shared between mock factories
// ---------------------------------------------------------------------------

const {
  PARSER_CTX,
  EDITOR_VIEW_CTX,
  EDITOR_VIEW_OPTIONS_CTX,
  ROOT_CTX,
  DEFAULT_VALUE_CTX,
  PROSE_PLUGINS_CTX,
  LISTENER_CTX,
} = vi.hoisted(() => ({
  PARSER_CTX: Symbol('parserCtx'),
  EDITOR_VIEW_CTX: Symbol('editorViewCtx'),
  EDITOR_VIEW_OPTIONS_CTX: Symbol('editorViewOptionsCtx'),
  ROOT_CTX: Symbol('rootCtx'),
  DEFAULT_VALUE_CTX: Symbol('defaultValueCtx'),
  PROSE_PLUGINS_CTX: Symbol('prosePluginsCtx'),
  LISTENER_CTX: Symbol('listenerCtx'),
}))

// Captured mention trigger callbacks — filled when the editor config runs.
// The plugin closure calls these so we can drive the picker state in tests.
const capturedMentionCallbacks: {
  onOpen?: (from: number, anchor: { x: number; y: number }) => void
  onUpdate?: (query: string, anchor: { x: number; y: number }) => void
  onClose?: () => void
} = {}

// ---------------------------------------------------------------------------
// Fake PM view
// ---------------------------------------------------------------------------

const fakeView = {
  state: {
    schema: {
      text: (s: string) => ({ _kind: 'text', text: s }),
      marks: { link: { name: 'link' }, inlineCode: { name: 'inlineCode' } },
    },
    selection: { from: 5 },
    get tr() {
      const doc = {
        content: { size: 1000 },
        resolve: (_n: number) => ({ pos: _n, nodeBefore: null, marks: () => [] }),
      }
      return {
        _replaceWiths: [] as Array<{ from: number; to: number; content: unknown }>,
        doc,
        replaceWith(from: number, to: number, content: unknown) {
          this._replaceWiths.push({ from, to, content })
          return this
        },
        setSelection: vi.fn(function (this: unknown) { return this }),
        setStoredMarks: vi.fn(function (this: unknown) { return this }),
        setMeta: vi.fn(function (this: unknown) { return this }),
      }
    },
  },
  dispatch: vi.fn(),
  focus: vi.fn(),
  posAtCoords: vi.fn(() => ({ pos: 5, inside: 0 })),
  coordsAtPos: vi.fn(() => ({ left: 100, bottom: 200 })),
}

// ---------------------------------------------------------------------------
// Fake ctx — captures mentionPlugin from prosePluginsCtx.update
// ---------------------------------------------------------------------------

const fakeCtx = {
  set: vi.fn(),
  update: vi.fn((key: symbol, updater: (prev: unknown[]) => unknown[]) => {
    if (key !== PROSE_PLUGINS_CTX) return
    const plugins = updater([])
    for (const p of plugins as Array<unknown>) {
      // The mentionTrigger plugin has a `view` spec that emits callbacks.
      // We detect it by checking if its `key.key` name contains 'mention'.
      const plugin = p as {
        key?: { key?: string }
        spec?: {
          view?: (v: unknown) => {
            update: (v: unknown, p: unknown) => void
            destroy: () => void
          }
        }
      }
      if (plugin?.key?.key?.includes('mention')) {
        // The plugin's view effect is how the callbacks get wired up.
        // But the callbacks are already baked in via `mentionTrigger(cbs)` in
        // LiveMarkdown's useMemo. We need to reach into the plugin's closure.
        // Since we mock `mentionTrigger` below, we intercept there instead.
      }
    }
  }),
  get: vi.fn((key: symbol) => {
    if (key === PARSER_CTX) return (md: string) => {
      // Simulate the Milkdown parser: if the markdown contains a wikilink: href,
      // return a fake PM node whose first text child carries a link mark.
      const match = md.match(/\[([^\]]+)\]\(wikilink:([^)]+)\)/)
      if (match) {
        const linkMark = { type: { name: 'link' }, attrs: { href: `wikilink:${match[2]}` } }
        return {
          childCount: 1,
          firstChild: {
            isTextblock: true,
            childCount: 1,
            firstChild: {
              isText: true,
              text: match[1],
              marks: [linkMark],
            },
            content: {
              size: match[1].length,
              firstChild: {
                isText: true,
                text: match[1],
                marks: [linkMark],
              },
            },
            // copy() needed by PM inline-merge path
            copy: (content: unknown) => ({ content, childCount: 1, firstChild: content }),
          },
          // +2 accounts for the paragraph wrapper's open + close tag tokens
          // when computing PM positions (size = 1 open + text length + 1 close).
          content: { size: match[1].length + 2 },
        }
      }
      return null
    }
    if (key === LISTENER_CTX) return { markdownUpdated: vi.fn() }
    if (key === EDITOR_VIEW_CTX) return fakeView
    return undefined
  }),
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@milkdown/core', () => ({
  Editor: {
    make: () => {
      const builder = {
        config: (cb: (ctx: typeof fakeCtx) => void) => {
          cb(fakeCtx)
          return builder
        },
        use: () => builder,
      }
      return builder
    },
  },
  defaultValueCtx: DEFAULT_VALUE_CTX,
  editorViewCtx: EDITOR_VIEW_CTX,
  editorViewOptionsCtx: EDITOR_VIEW_OPTIONS_CTX,
  parserCtx: PARSER_CTX,
  prosePluginsCtx: PROSE_PLUGINS_CTX,
  rootCtx: ROOT_CTX,
}))

vi.mock('@milkdown/react', () => ({
  Milkdown: () => null,
  MilkdownProvider: ({ children }: { children: React.ReactNode }) => children,
  useEditor: (cb: (root: HTMLElement) => unknown) => {
    cb(document.createElement('div'))
    // Return a fake editor whose ctx.get(editorViewCtx) = fakeView, so that
    // handleMentionSelect can retrieve the view and dispatch the transaction.
    return { get: () => ({ ctx: fakeCtx }) }
  },
}))

vi.mock('@milkdown/preset-commonmark', () => ({ commonmark: {} }))
vi.mock('@milkdown/preset-gfm', () => ({ gfm: {} }))
vi.mock('@milkdown/plugin-listener', () => ({
  listener: {},
  listenerCtx: LISTENER_CTX,
}))

vi.mock('prosemirror-history', () => ({
  history: () => ({}),
  undo: () => {},
  redo: () => {},
  undoDepth: () => 0,
  redoDepth: () => 0,
}))

vi.mock('prosemirror-commands', () => ({ selectAll: () => {} }))
vi.mock('prosemirror-keymap', () => ({ keymap: () => ({}) }))
vi.mock('prosemirror-dropcursor', () => ({ dropCursor: () => ({}) }))
vi.mock('prosemirror-search', () => ({
  search: () => ({}),
  findNext: () => {},
  findPrev: () => {},
}))

vi.mock('prosemirror-state', async () => {
  const actual = await vi.importActual<typeof import('prosemirror-state')>('prosemirror-state')
  return {
    ...actual,
    TextSelection: { near: vi.fn((pos: unknown) => ({ _kind: 'sel', pos })) },
  }
})

vi.mock('../../lib/imageNodeView', () => ({ imageNodeView: () => ({}) }))
vi.mock('../../lib/pmJustReplacedHighlight', () => ({ justReplacedPlugin: () => ({}) }))
vi.mock('../../lib/pmJustInsertedHighlight', () => ({
  justInsertedPlugin: () => ({}),
  justInsertedPluginKey: {},
}))
vi.mock('../../lib/wikilinks', () => ({
  // Returns the commonmark link form that Milkdown's parser would receive.
  parseWikilinks: (s: string) => s.replace(/\[\[([^\]]+)\]\]/g, '[$1](wikilink:$1)'),
  unparseWikilinks: (s: string) => s,
  stripMdExt: (name: string) => name.replace(/\.md$/, ''),
}))
vi.mock('../../lib/dropAttachments', () => ({
  MARVIN_PATH_MIME: 'application/x-marvin-path',
  collectFiles: () => [],
  emitSummaryToast: () => {},
  internalDragMarkdown: () => '',
  persistDroppedFiles: async () => ({ inserts: [], errors: [] }),
}))

// Intercept mentionTrigger to capture the callbacks LiveMarkdown passes in.
vi.mock('../../lib/pmMentionTrigger', () => ({
  mentionTrigger: vi.fn((cbs: {
    onOpen: (from: number, anchor: { x: number; y: number }) => void
    onUpdate: (query: string, anchor: { x: number; y: number }) => void
    onClose: () => void
  }) => {
    capturedMentionCallbacks.onOpen = cbs.onOpen
    capturedMentionCallbacks.onUpdate = cbs.onUpdate
    capturedMentionCallbacks.onClose = cbs.onClose
    // Return a fake plugin that passes the Plugin check
    return { key: { key: 'marvinz-mention-trigger' }, spec: {} }
  }),
}))

// ---------------------------------------------------------------------------
// Import after all mocks
// ---------------------------------------------------------------------------

import { LiveMarkdown } from '../LiveMarkdown'

// ---------------------------------------------------------------------------
// window.marvin mock
// ---------------------------------------------------------------------------

function setupMarvinMock() {
  Object.defineProperty(globalThis, 'window', {
    value: {
      ...(typeof window !== 'undefined' ? window : {}),
      marvin: {
        file: { writeBinary: vi.fn(async ({ relPath }: { relPath: string }) => relPath) },
        app: { showContextMenu: vi.fn(), canPaste: vi.fn().mockResolvedValue(false) },
        editor: { writeClipboard: vi.fn(), readClipboard: vi.fn() },
        shell: { openExternal: vi.fn() },
      },
    },
    writable: true,
    configurable: true,
  })
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MARKDOWN_ITEM = {
  name: 'My Note.md',
  path: '/vault/My Note.md',
  rel: 'My Note.md',
  isMarkdown: true,
  mtime: 0,
}

function defaultProps(paletteItems = [MARKDOWN_ITEM]) {
  return {
    body: '',
    onChange: vi.fn(),
    onLinkClick: vi.fn(),
    filePath: '/vault/note.md',
    vaultPath: '/vault',
    paletteItems,
    remountKey: 'k',
  }
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  setupMarvinMock()
  capturedMentionCallbacks.onOpen = undefined
  capturedMentionCallbacks.onUpdate = undefined
  capturedMentionCallbacks.onClose = undefined
  fakeView.dispatch.mockClear()
  fakeView.focus.mockClear()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LiveMarkdown — @-mention trigger integration', () => {
  it('renders MentionPicker after onOpen fires', async () => {
    render(<LiveMarkdown {...defaultProps()} />)
    expect(capturedMentionCallbacks.onOpen).toBeTypeOf('function')

    await act(async () => {
      capturedMentionCallbacks.onOpen!(0, { x: 100, y: 200 })
    })

    // MentionPicker is portalled to body; query match should appear
    expect(document.body.querySelector('.mention-picker')).toBeTruthy()
  })

  it('dismisses MentionPicker after onClose fires', async () => {
    render(<LiveMarkdown {...defaultProps()} />)

    await act(async () => {
      capturedMentionCallbacks.onOpen!(0, { x: 100, y: 200 })
    })
    expect(document.body.querySelector('.mention-picker')).toBeTruthy()

    await act(async () => {
      capturedMentionCallbacks.onClose!()
    })
    expect(document.body.querySelector('.mention-picker')).toBeFalsy()
  })

  it('inserts [[Name]] wikilink (stripMdExt applied) when item is clicked', async () => {
    const { fireEvent } = await import('@testing-library/react')
    render(<LiveMarkdown {...defaultProps()} />)

    await act(async () => {
      capturedMentionCallbacks.onOpen!(0, { x: 100, y: 200 })
    })

    const picker = document.body.querySelector('.mention-picker')
    expect(picker).toBeTruthy()

    // Click the first row button
    const row = picker!.querySelector('button.mention-picker-row')
    expect(row).toBeTruthy()

    await act(async () => {
      fireEvent.click(row!)
    })

    // dispatch should have been called with a transaction containing replaceWith
    expect(fakeView.dispatch).toHaveBeenCalled()
    const dispatchedTr = fakeView.dispatch.mock.calls[0]?.[0] as {
      _replaceWiths: Array<{ from: number; to: number; content: unknown }>
    }
    expect(dispatchedTr._replaceWiths).toHaveLength(1)

    // REGRESSION ASSERTION: the inserted content must NOT be plain text `[[My Note]]`.
    // handleMentionSelect must go through the Milkdown parser (parserCtx) so that
    // the inserted node carries a `link` mark with href `wikilink:My Note`.
    const inserted = dispatchedTr._replaceWiths[0].content as {
      text?: string
      marks?: Array<{ type: { name: string }; attrs: { href: string } }>
    }
    // Must NOT be a plain-text node with the literal wikilink syntax.
    expect(inserted.text).not.toBe('[[My Note]]')
    // Must be a node whose marks include a `link` mark with a wikilink: href.
    expect(inserted.marks).toBeDefined()
    expect(inserted.marks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: { name: 'link' }, attrs: expect.objectContaining({ href: 'wikilink:My Note' }) }),
      ]),
    )

    // Picker should be gone after selection
    expect(document.body.querySelector('.mention-picker')).toBeFalsy()
  })

  it('falls back to literal text + warns when parserCtx returns null', async () => {
    const { fireEvent } = await import('@testing-library/react')
    // Force the parser to return null for this test (simulates parser failure
    // or unexpected commonmark output). Spy on console.warn so we can assert
    // observability.
    const originalGet = fakeCtx.get.getMockImplementation()
    fakeCtx.get = vi.fn((key: symbol) => {
      if (key === PARSER_CTX) return (_md: string) => null
      return originalGet?.(key)
    })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      render(<LiveMarkdown {...defaultProps()} />)
      await act(async () => {
        capturedMentionCallbacks.onOpen!(0, { x: 100, y: 200 })
      })
      const row = document.body.querySelector('button.mention-picker-row')
      await act(async () => {
        fireEvent.click(row!)
      })

      // Dispatch should still fire — the bail-out must not silently drop
      // the user's selection.
      expect(fakeView.dispatch).toHaveBeenCalled()
      const tr = fakeView.dispatch.mock.calls[0]?.[0] as {
        _replaceWiths: Array<{ content: { _kind: string; text?: string } }>
      }
      expect(tr._replaceWiths).toHaveLength(1)
      // Fallback path inserts a literal text node carrying the wikilink syntax.
      expect(tr._replaceWiths[0].content).toEqual({ _kind: 'text', text: '[[My Note]]' })
      // Warn must fire so the failure is observable in prod logs.
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('parserCtx returned an unexpected shape'),
        expect.any(Object),
      )
      expect(document.body.querySelector('.mention-picker')).toBeFalsy()
    } finally {
      warnSpy.mockRestore()
      // Restore the original get implementation for subsequent tests.
      if (originalGet) fakeCtx.get = vi.fn(originalGet)
    }
  })

  it('dismisses picker on Escape without inserting text', async () => {
    render(<LiveMarkdown {...defaultProps()} />)

    await act(async () => {
      capturedMentionCallbacks.onOpen!(0, { x: 100, y: 200 })
    })
    expect(document.body.querySelector('.mention-picker')).toBeTruthy()

    await act(async () => {
      const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      document.dispatchEvent(event)
    })

    expect(fakeView.dispatch).not.toHaveBeenCalled()
    expect(document.body.querySelector('.mention-picker')).toBeFalsy()
  })

  it('filters out non-markdown items from mentionItems', async () => {
    const nonMarkdown = { name: 'photo.png', path: '/v/photo.png', rel: 'photo.png', isMarkdown: false, mtime: 0 }
    render(<LiveMarkdown {...defaultProps([nonMarkdown])} />)

    await act(async () => {
      capturedMentionCallbacks.onOpen!(0, { x: 100, y: 200 })
    })

    // With no matching markdown items, MentionPicker renders null
    expect(document.body.querySelector('.mention-picker')).toBeFalsy()
  })
})
