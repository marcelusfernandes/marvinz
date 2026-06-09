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
 * Two describe blocks:
 *   1. WITHOUT taskListNodeView — reproduces the bug: no <input> rendered.
 *   2. WITH taskListNodeView — proves the fix: <input type="checkbox"> present.
 *
 * The diagnostic test in block 1 always passes and logs the exact HTML the
 * real gfm toDOM path emits without the node view, so the team can see
 * precisely what the broken state looks like.
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
  it('diagnostic — log exact HTML gfm toDOM produces for `- [ ] task`', async () => {
    const root = await mountEditor('- [ ] task', { withNodeView: false })

    const listItems = root.querySelectorAll('li')
    console.log('[bug-repro] rendered HTML:\n', root.innerHTML)
    for (const li of listItems) {
      console.log('[bug-repro] li.outerHTML:', li.outerHTML)
      console.log('[bug-repro]   data-item-type:', li.getAttribute('data-item-type'))
      console.log('[bug-repro]   data-checked:', li.getAttribute('data-checked'))
      console.log('[bug-repro]   has checkbox child:', li.querySelector('input[type="checkbox"]') !== null)
    }
    // Always passes — diagnostic only.
    expect(root.innerHTML).toBeDefined()
  })

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
