// @vitest-environment jsdom

/**
 * Unit tests for the mermaidNodeView NodeView constructor (real DOM).
 * Issue #353.
 *
 * Tests the buildCodeBlockView() export directly — no Milkdown editor needed.
 * This is the right layer to assert on DOM class names and mermaid.initialize()
 * options, because the main live-markdown-mermaid.spec.tsx mocks
 * '../../lib/mermaidNodeView' at module scope and can't exercise real NodeView DOM.
 *
 * Three mocks required here (and nothing else):
 *   - 'mermaid' — controls initialize/render without real SVG generation
 *   - '@milkdown/preset-commonmark' — stubs codeBlockSchema (static import in mermaidNodeView.ts)
 *   - '@milkdown/utils' — stubs $view (used by mermaidNodeView factory, not buildCodeBlockView)
 * Do NOT mock '../../lib/mermaidNodeView' — the real module is under test.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock 'mermaid' — lazy dynamic import inside mermaidNodeView.ts.
// No mermaid.parse() call in the implementation; render() rejection drives errors.
// themeVariables is computed from getComputedStyle at render time — empty strings
// in jsdom (no injected CSS). Assert stable scalars only via objectContaining.
// ---------------------------------------------------------------------------

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async (_id: string, _src: string) => ({ svg: '<svg/>' })),
  },
}))

// Required: mermaidNodeView.ts statically imports codeBlockSchema from here.
vi.mock('@milkdown/preset-commonmark', () => ({
  codeBlockSchema: { node: {} },
}))

// Required if exercising the mermaidNodeView() factory (harmless otherwise).
vi.mock('@milkdown/utils', () => ({
  $view: (_schema: unknown, factory: () => unknown) => factory,
}))

// ---------------------------------------------------------------------------
// Import after all mocks — real module, not mocked
// ---------------------------------------------------------------------------

import { buildCodeBlockView } from '../../lib/mermaidNodeView'
import mermaid from 'mermaid'

// Shared type reference — update() compares node types by reference (===),
// so initial and updated fake nodes must share the same type object.
const TYPE_CODE_BLOCK = { name: 'code_block' }

// ---------------------------------------------------------------------------
// Fake PMNode helpers
// ---------------------------------------------------------------------------

function makeMermaidNode(source = 'flowchart LR\n  A --> B') {
  return {
    type: TYPE_CODE_BLOCK,
    attrs: { language: 'mermaid' },
    textContent: source,
  }
}

function makePassthroughNode(language = 'typescript') {
  return {
    type: TYPE_CODE_BLOCK,
    attrs: { language },
    textContent: 'const x = 1',
  }
}

// Await the mermaid render microtask so DOM mutations settle before asserting.
const tick = () => new Promise<void>((r) => setTimeout(r, 0))

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let destroyFns: Array<() => void> = []

beforeEach(() => {
  destroyFns = []
  vi.mocked(mermaid.initialize).mockClear()
  vi.mocked(mermaid.render).mockClear()
  vi.mocked(mermaid.render).mockResolvedValue({ svg: '<svg/>' } as never)
})

afterEach(() => {
  // Disconnect MutationObserver installed by the mermaid view to avoid cross-test bleed.
  for (const destroy of destroyFns) destroy()
})

// ---------------------------------------------------------------------------
// Helper: build a real NodeView from buildCodeBlockView
// ---------------------------------------------------------------------------

function buildView(
  node: ReturnType<typeof makeMermaidNode> | ReturnType<typeof makePassthroughNode>
) {
  const constructor = buildCodeBlockView()
  const view = constructor(
    node as never,
    null as never,
    null as never,
    null as never,
    null as never
  )
  if (view.destroy) destroyFns.push(view.destroy.bind(view))
  return view
}

// ===========================================================================
// Tests
// ===========================================================================

describe('mermaidNodeView — passthrough branch (non-mermaid language)', () => {
  it('returns a <pre> dom with a <code> contentDOM for non-mermaid blocks', () => {
    const view = buildView(makePassthroughNode('typescript'))

    expect(view.dom.tagName).toBe('PRE')
    expect((view as { contentDOM?: HTMLElement }).contentDOM?.tagName).toBe('CODE')
  })

  it('sets data-language attribute on the <code> element', () => {
    const view = buildView(makePassthroughNode('python'))
    const code = (view as { contentDOM?: HTMLElement }).contentDOM
    expect(code?.getAttribute('data-language')).toBe('python')
  })

  it('update() returns false when language switches to mermaid', () => {
    const view = buildView(makePassthroughNode('typescript'))
    const mermaidNode = makeMermaidNode()
    const result = (view as unknown as { update: (n: unknown) => boolean }).update(mermaidNode)
    expect(result).toBe(false)
  })
})

describe('mermaidNodeView — mermaid branch: DOM structure', () => {
  it('returns a div.mermaid-diagram with a div.mermaid-diagram__canvas child', () => {
    const view = buildView(makeMermaidNode())

    expect(view.dom.classList.contains('mermaid-diagram')).toBe(true)
    expect(view.dom.querySelector('.mermaid-diagram__canvas')).not.toBeNull()
  })

  it('has no contentDOM (diagram is not directly editable)', () => {
    const view = buildView(makeMermaidNode())
    expect((view as { contentDOM?: unknown }).contentDOM).toBeUndefined()
  })

  it('ignoreMutation() always returns true', () => {
    const view = buildView(makeMermaidNode())
    expect((view as unknown as { ignoreMutation: () => boolean }).ignoreMutation()).toBe(true)
  })

  it('stopEvent() always returns false', () => {
    const view = buildView(makeMermaidNode())
    expect((view as unknown as { stopEvent: () => boolean }).stopEvent()).toBe(false)
  })
})

describe('mermaidNodeView — mermaid branch: successful render', () => {
  it('calls mermaid.initialize with stable options on render', async () => {
    buildView(makeMermaidNode())
    await tick()

    expect(mermaid.initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        startOnLoad: false,
        theme: 'base',
        securityLevel: 'strict',
      })
    )
  })

  it('calls mermaid.render with a string id and the trimmed source', async () => {
    const source = 'flowchart LR\n  A --> B'
    buildView(makeMermaidNode(source))
    await tick()

    expect(mermaid.render).toHaveBeenCalledWith(expect.stringMatching(/^marvinz-mermaid-/), source)
  })

  it('injects the returned SVG into the canvas element', async () => {
    vi.mocked(mermaid.render).mockResolvedValueOnce({ svg: '<svg id="ok"/>' } as never)
    const view = buildView(makeMermaidNode())
    await tick()

    const canvas = view.dom.querySelector('.mermaid-diagram__canvas')
    expect(canvas?.innerHTML).toContain('id="ok"')
  })

  it('dom does not carry .mermaid-diagram--error after a clean render', async () => {
    const view = buildView(makeMermaidNode())
    await tick()
    expect(view.dom.classList.contains('mermaid-diagram--error')).toBe(false)
  })
})

describe('mermaidNodeView — mermaid branch: error handling', () => {
  it('sets .mermaid-diagram--error on the root when render() rejects', async () => {
    vi.mocked(mermaid.render).mockRejectedValueOnce(new Error('bad syntax'))
    const view = buildView(makeMermaidNode('NOT VALID'))
    await tick()

    expect(view.dom.classList.contains('mermaid-diagram--error')).toBe(true)
  })

  it('renders .mermaid-diagram__error inside the canvas when render() rejects', async () => {
    vi.mocked(mermaid.render).mockRejectedValueOnce(new Error('bad syntax'))
    const view = buildView(makeMermaidNode('NOT VALID'))
    await tick()

    expect(view.dom.querySelector('.mermaid-diagram__error')).not.toBeNull()
  })

  it('error element contains .mermaid-diagram__error-label with "Diagram syntax error"', async () => {
    vi.mocked(mermaid.render).mockRejectedValueOnce(new Error('unexpected token'))
    const view = buildView(makeMermaidNode('NOT VALID'))
    await tick()

    const label = view.dom.querySelector('.mermaid-diagram__error-label')
    expect(label?.textContent).toBe('Diagram syntax error')
  })

  it('error detail shows the mermaid error message (sliced to 200 chars)', async () => {
    const errMsg = 'unexpected token at line 1'
    vi.mocked(mermaid.render).mockRejectedValueOnce(new Error(errMsg))
    const view = buildView(makeMermaidNode('NOT VALID'))
    await tick()

    const detail = view.dom.querySelector('.mermaid-diagram__error-detail')
    expect(detail?.textContent).toBe(errMsg)
  })

  it('does not throw when render() rejects — error is absorbed', async () => {
    vi.mocked(mermaid.render).mockRejectedValueOnce(new Error('bad'))
    await expect(async () => {
      buildView(makeMermaidNode('NOT VALID'))
      await tick()
    }).not.toThrow()
  })
})

describe('mermaidNodeView — mermaid branch: empty source', () => {
  it('does not call mermaid.render for an empty block', async () => {
    buildView(makeMermaidNode(''))
    await tick()

    expect(mermaid.render).not.toHaveBeenCalled()
  })

  it('does not set .mermaid-diagram--error for an empty block', async () => {
    const view = buildView(makeMermaidNode(''))
    await tick()

    expect(view.dom.classList.contains('mermaid-diagram--error')).toBe(false)
  })
})

describe('mermaidNodeView — mermaid branch: update()', () => {
  it('returns false when node type changes', async () => {
    const view = buildView(makeMermaidNode())
    const result = (view as unknown as { update: (n: unknown) => boolean }).update({
      type: { name: 'paragraph' },
      attrs: { language: 'mermaid' },
      textContent: '',
    })
    expect(result).toBe(false)
  })

  it('returns false when language switches away from mermaid', async () => {
    const view = buildView(makeMermaidNode())
    const result = (view as unknown as { update: (n: unknown) => boolean }).update(
      makePassthroughNode('python')
    )
    expect(result).toBe(false)
  })

  it('returns true and re-renders when source changes', async () => {
    const view = buildView(makeMermaidNode('flowchart LR\n  A --> B'))
    await tick()
    vi.mocked(mermaid.render).mockClear()

    const updated = (view as unknown as { update: (n: unknown) => boolean }).update(
      makeMermaidNode('flowchart LR\n  X --> Y')
    )
    expect(updated).toBe(true)
    await tick()
    expect(mermaid.render).toHaveBeenCalledTimes(1)
  })

  it('does not re-render when source is unchanged', async () => {
    const source = 'flowchart LR\n  A --> B'
    const view = buildView(makeMermaidNode(source))
    await tick()
    vi.mocked(mermaid.render).mockClear()
    ;(view as unknown as { update: (n: unknown) => boolean }).update(makeMermaidNode(source))
    await tick()
    expect(mermaid.render).not.toHaveBeenCalled()
  })
})
