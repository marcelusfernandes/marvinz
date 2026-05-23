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
  return (node) => {
    // A wrapper is required as the node view's root `dom`: ProseMirror owns
    // that element and any `replaceWith` on it would be reverted on the next
    // reconciliation pass. Mutating the wrapper's *children* is safe.
    const dom = document.createElement('span')
    dom.className = 'md-image'

    const src = String(node.attrs.src ?? '')
    const alt = String(node.attrs.alt ?? '')
    const title = String(node.attrs.title ?? '')

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

    return { dom }
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
