import { imageSchema } from '@milkdown/preset-commonmark'
import { $view } from '@milkdown/utils'
import type { NodeViewConstructor } from '@milkdown/prose/view'

import { resolveImageSrc } from './marvinUrl'
import type { PaletteItem } from './paletteRanker'

/**
 * Build a Milkdown plugin that replaces the default `<img>` rendering with a
 * vault-aware view. The view does **not** mutate the ProseMirror schema or
 * markdown round-trip — it only rewrites the rendered `src` and swaps in a
 * placeholder when the image can't be resolved.
 *
 * The vault context (`filePath`, `vaultPath`, `paletteItems`) is closed over
 * at plugin construction time. Because the Milkdown editor is fully remounted
 * on file switch via `remountKey`, the closure is always fresh for the active
 * file — no need to pipe these values through Milkdown's `ctx`.
 */
export function imageNodeView(deps: {
  filePath: string
  vaultPath: string
  paletteItems: PaletteItem[]
}) {
  return $view(imageSchema.node, () => buildImageNodeView(deps))
}

function buildImageNodeView({
  filePath,
  vaultPath,
  paletteItems,
}: {
  filePath: string
  vaultPath: string
  paletteItems: PaletteItem[]
}): NodeViewConstructor {
  return (initialNode, _view, _getPos, initialDecorations) => {
    // A wrapper is required as the node view's root `dom`: ProseMirror owns
    // that element and any `replaceWith` on it would be reverted on the next
    // reconciliation pass. Mutating the wrapper's *children* is safe.
    const dom = document.createElement('span')
    dom.className = 'md-image'

    const src = String(initialNode.attrs.src ?? '')
    const alt = String(initialNode.attrs.alt ?? '')
    const title = String(initialNode.attrs.title ?? '')

    const img = document.createElement('img')
    if (alt) img.setAttribute('alt', alt)
    if (title) img.setAttribute('title', title)
    img.dataset.rawSrc = src

    const showPlaceholder = () => {
      if (dom.firstChild === img) {
        dom.replaceChild(buildPlaceholder(src), img)
      }
    }

    const resolved = resolveImageSrc(src, filePath, vaultPath, paletteItems)
    if (resolved.kind === 'missing') {
      dom.appendChild(buildPlaceholder(src))
    } else {
      img.addEventListener('error', showPlaceholder, { once: true })
      img.setAttribute('src', resolved.url)
      dom.appendChild(img)
    }

    // Mirror outer decorations onto `dom.classList`. ProseMirror won't merge
    // decoration classes into a custom node view's wrapper automatically —
    // without this, `Decoration.node(...{ class: '...' })` is invisible. We
    // diff the previous set so the class is also removed when the
    // decoration clears.
    const applied = new Set<string>()
    const applyDecorations = (
      decorations: readonly { type?: { attrs?: { class?: string } }; spec?: { class?: string } }[]
    ) => {
      const wanted = new Set<string>()
      for (const d of decorations) {
        const className =
          (d as { type?: { attrs?: { class?: string } } }).type?.attrs?.class ??
          (d as { spec?: { class?: string } }).spec?.class
        if (className) {
          for (const c of className.split(/\s+/)) if (c) wanted.add(c)
        }
      }
      for (const c of applied) {
        if (!wanted.has(c)) {
          dom.classList.remove(c)
          applied.delete(c)
        }
      }
      for (const c of wanted) {
        if (!applied.has(c)) {
          dom.classList.add(c)
          applied.add(c)
        }
      }
    }

    // Apply decorations present at construction time too — the image node
    // view is built in the same transaction that adds the just-inserted
    // decoration, so the class must be present from the first paint or the
    // CSS animation never gets a chance to fire.
    if (initialDecorations && initialDecorations.length > 0) {
      applyDecorations(initialDecorations)
    }

    return {
      dom,
      update(newNode, decorations) {
        if (newNode.type !== initialNode.type) return false
        applyDecorations(decorations)
        return true
      },
    }
  }
}

function buildPlaceholder(rawSrc: string): HTMLSpanElement {
  const placeholder = document.createElement('span')
  placeholder.className = 'md-image-broken'
  placeholder.setAttribute('role', 'img')
  placeholder.setAttribute('aria-label', `Missing image: ${rawSrc}`)
  placeholder.title = rawSrc || 'Missing image'
  placeholder.textContent = '⛌ image not found'
  return placeholder
}
