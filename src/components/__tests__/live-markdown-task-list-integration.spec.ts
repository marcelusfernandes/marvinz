// @vitest-environment jsdom

/**
 * Integration test for task-list checkbox rendering in Page mode (issue #437).
 *
 * Unlike live-markdown-task-list-nodeview.spec.ts (which exercises the NodeView
 * constructor in isolation with fake nodes), this file mounts a REAL Milkdown
 * editor — commonmark + gfm + listener, with NO @milkdown/* mocks — and feeds
 * it raw markdown. It exercises the full production render path:
 *   remark parse → gfm task-list schema (checked attr) → nodeViews map → DOM.
 *
 * Three describe blocks:
 *   1. WITHOUT taskListNodeView — reproduces the bug: no <input> rendered.
 *   2. WITH taskListNodeView — proves the fix: <input type="checkbox"> present.
 *   3. DOM shape — regression coverage for layout (checkbox first child, content
 *      sibling); real-browser geometry and input-rule paths are in
 *      e2e/task-list-page-mode.spec.ts.
 */

 
import { describe, it, expect, afterEach } from 'vitest'
import {
  Editor,
  defaultValueCtx,
  rootCtx,
} from '@milkdown/core'
import { commonmark } from '@milkdown/preset-commonmark'
import { gfm } from '@milkdown/preset-gfm'
import { listener } from '@milkdown/plugin-listener'
import { taskListNodeView } from '../../lib/taskListNodeView'

// ---------------------------------------------------------------------------
// jsdom shims required by ProseMirror
// ---------------------------------------------------------------------------

if (typeof globalThis.getSelection === 'undefined') {
  ;(globalThis as unknown as Record<string, unknown>).getSelection = () =>
    document.getSelection()
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const flush = () => new Promise<void>((r) => setTimeout(r, 0))

let editors: Editor[] = []

afterEach(async () => {
  for (const ed of editors) {
    await ed.destroy().catch(() => {})
  }
  editors = []
  document.body.innerHTML = ''
})

 
async function mountEditor(
  markdown: string,
  opts: { withNodeView: boolean },
) {
  const root = document.createElement('div')
  document.body.appendChild(root)

  const builder = Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root)
      ctx.set(defaultValueCtx, markdown)
    })
    .use(commonmark)
    .use(gfm)
    .use(listener)

  if (opts.withNodeView) {
    builder.use(taskListNodeView())
  }

  const ed = await builder.create()
  editors.push(ed)
  await flush()
  return root
}

// ---------------------------------------------------------------------------
// Block 1: WITHOUT taskListNodeView — reproduces the bug
//
// gfm's toDOM emits: ["li", {"data-item-type":"task","data-checked":"false"}, 0]
// Rendered DOM: <li data-item-type="task" data-checked="false">task</li>
// No <input type="checkbox"> anywhere.
// ---------------------------------------------------------------------------

describe('task-list integration — WITHOUT taskListNodeView (bug reproduction)', () => {
  it('WITHOUT node view: no <input type="checkbox"> for `- [ ] task`', async () => {
    const root = await mountEditor('- [ ] task', { withNodeView: false })

    // Demonstrates the bug state: gfm toDOM produces no <input>.
    const checkbox = root.querySelector('input[type="checkbox"]')
    expect(checkbox).toBeNull()
  })

  it('WITHOUT node view: li carries data-item-type="task" but no checkbox', async () => {
    const root = await mountEditor('- [ ] task', { withNodeView: false })

    const li = root.querySelector('li[data-item-type="task"]')
    expect(li).not.toBeNull()
    expect(li!.querySelector('input[type="checkbox"]')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Block 2: WITH taskListNodeView — proves the fix
// ---------------------------------------------------------------------------

describe('task-list integration — WITH taskListNodeView (fix verification)', () => {
  it('renders an <input type="checkbox"> for `- [ ] task`', async () => {
    const root = await mountEditor('- [ ] task', { withNodeView: true })

    const checkbox = root.querySelector('input[type="checkbox"]')
    expect(checkbox).not.toBeNull()
  })

  it('the checkbox for `- [ ] task` is not checked', async () => {
    const root = await mountEditor('- [ ] task', { withNodeView: true })

    const checkbox = root.querySelector('input[type="checkbox"]') as HTMLInputElement | null
    expect(checkbox?.checked).toBe(false)
  })

  it('renders an <input type="checkbox"> for `- [x] done`', async () => {
    const root = await mountEditor('- [x] done', { withNodeView: true })

    const checkbox = root.querySelector('input[type="checkbox"]')
    expect(checkbox).not.toBeNull()
  })

  it('the checkbox for `- [x] done` is checked', async () => {
    const root = await mountEditor('- [x] done', { withNodeView: true })

    const checkbox = root.querySelector('input[type="checkbox"]') as HTMLInputElement | null
    expect(checkbox?.checked).toBe(true)
  })

  it('renders checkboxes for both `- [ ]` and `- [x]` in the same list', async () => {
    const root = await mountEditor('- [ ] todo\n- [x] done', { withNodeView: true })

    const checkboxes = root.querySelectorAll('input[type="checkbox"]')
    expect(checkboxes).toHaveLength(2)

    const [unchecked, checked] = checkboxes as unknown as [HTMLInputElement, HTMLInputElement]
    expect(unchecked.checked).toBe(false)
    expect(checked.checked).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Block 3: DOM shape — regression coverage for layout assertions
//
// jsdom cannot verify computed bounding boxes or CSS list-style-type reliably,
// but it CAN assert the structural shape the taskListNodeView builds. These
// tests guard that the checkbox is the first child of <li> and the content div
// is its immediate sibling, which is what the Chromium layout (A) tests depend on.
//
// Input-rule / contentEditable paths are NOT covered here — those require real
// Chromium. See e2e/task-list-page-mode.spec.ts for suite B verification.
// ---------------------------------------------------------------------------

describe('task-list integration — DOM shape / layout regression', () => {
  it('checkbox is the first child of <li data-item-type="task">', async () => {
    const root = await mountEditor('- [ ] item', { withNodeView: true })

    const li = root.querySelector('li[data-item-type="task"]')
    expect(li).not.toBeNull()

    const firstChild = li!.children[0] as HTMLElement | undefined
    expect(firstChild?.tagName).toBe('INPUT')
    expect(firstChild?.getAttribute('type')).toBe('checkbox')
  })

  it('.task-list-item__content is the sibling immediately after the checkbox', async () => {
    const root = await mountEditor('- [ ] item', { withNodeView: true })

    const li = root.querySelector('li[data-item-type="task"]')
    expect(li).not.toBeNull()

    const secondChild = li!.children[1] as HTMLElement | undefined
    expect(secondChild?.classList.contains('task-list-item__content')).toBe(true)
  })

  it('<li> has exactly two children: checkbox + content div', async () => {
    const root = await mountEditor('- [ ] item', { withNodeView: true })

    const li = root.querySelector('li[data-item-type="task"]')
    expect(li).not.toBeNull()
    expect(li!.children).toHaveLength(2)
  })

  it('checkbox has contentEditable="false" to prevent PM from managing it', async () => {
    const root = await mountEditor('- [ ] item', { withNodeView: true })

    const checkbox = root.querySelector('input[type="checkbox"]') as HTMLInputElement | null
    expect(checkbox).not.toBeNull()
    expect(checkbox!.contentEditable).toBe('false')
  })
})
