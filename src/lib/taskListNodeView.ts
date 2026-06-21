import { extendListItemSchemaForTask } from '@milkdown/preset-gfm'
import { $view } from '@milkdown/utils'
import type { NodeViewConstructor } from '@milkdown/prose/view'

/**
 * Render a real `<input type="checkbox">` for GFM task-list items in Page mode
 * (issue #437).
 *
 * @milkdown/preset-gfm's task-list-item `toDOM` emits
 * `<li data-item-type="task" data-checked="...">` WITHOUT any `<input>`, so the
 * checkbox CSS (`.live-md input[type='checkbox']`) targets an element that never
 * exists and the box is invisible. This `$view` over the `list_item` node fills
 * that gap on the RENDERING side only — the gfm parse rule, input rule, and
 * serializer are untouched, so `- [ ]` / `- [x]` still round-trips byte-stable.
 *
 *  - `checked != null` → a `<li data-item-type="task">` whose first child is a
 *    real checkbox reflecting the attr, followed by an editable `contentDOM`.
 *  - `checked == null` → a plain `<li>` passthrough so ordinary bullet/ordered
 *    items behave exactly as before (no checkbox).
 *
 * Clicking the checkbox flips the `checked` attr via `setNodeMarkup`, which
 * re-serializes through the gfm `toMarkdown` runner and fires the
 * `markdownUpdated` listener — the save path. The DOM is also updated
 * synchronously for instant feedback before the transaction round-trips.
 */
export function taskListNodeView() {
  return $view(extendListItemSchemaForTask.node, () => buildTaskListItemView())
}

// Exported for unit tests: lets a spec exercise the NodeView constructor
// directly (task and passthrough branches) without standing up a full Milkdown
// editor.
export function buildTaskListItemView(): NodeViewConstructor {
  return (initialNode, editorView, getPos) => {
    const li = document.createElement('li')

    // Passthrough: a regular (non-task) list item has no checkbox. The
    // `contentDOM` is the `<li>` itself so list content stays editable.
    if (initialNode.attrs.checked == null) {
      return {
        dom: li,
        contentDOM: li,
        update(newNode) {
          if (newNode.type !== initialNode.type) return false
          // Gaining a `checked` attr means the item became a task — rebuild
          // the view so the checkbox branch takes over.
          return newNode.attrs.checked == null
        },
      }
    }

    li.setAttribute('data-item-type', 'task')

    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    checkbox.contentEditable = 'false'

    // Content lives in a sibling element so the checkbox is not swallowed by
    // ProseMirror's content reconciliation (contentDOM is fully PM-owned).
    const content = document.createElement('div')
    content.className = 'task-list-item__content'

    const reflect = (checked: boolean) => {
      checkbox.checked = checked
      li.setAttribute('data-checked', String(checked))
    }
    reflect(Boolean(initialNode.attrs.checked))

    // Keep the editor selection where the user left it — a mousedown inside the
    // checkbox would otherwise move the caret into the item before the click.
    checkbox.addEventListener('mousedown', (event) => {
      event.preventDefault()
    })

    // Toggle on click: flip the attr through a PM transaction so the change
    // serializes back to `- [ ]` / `- [x]`, and mirror it onto the DOM
    // immediately for instant visual feedback.
    checkbox.addEventListener('click', (event) => {
      event.preventDefault()
      const pos = getPos()
      if (pos == null) return
      // Read the current state from the DOM so repeated clicks toggle correctly
      // even before the transaction round-trips back through `update`.
      const current = li.getAttribute('data-checked') === 'true'
      const toggled = !current
      reflect(toggled)
      editorView.dispatch(
        editorView.state.tr.setNodeMarkup(pos, undefined, {
          ...initialNode.attrs,
          checked: toggled,
        })
      )
    })

    li.appendChild(checkbox)
    li.appendChild(content)

    return {
      dom: li,
      contentDOM: content,
      update(newNode) {
        if (newNode.type !== initialNode.type) return false
        // Losing the `checked` attr means it stopped being a task — rebuild.
        if (newNode.attrs.checked == null) return false
        reflect(Boolean(newNode.attrs.checked))
        return true
      },
    }
  }
}
