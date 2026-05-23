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
  return $view(imageSchema, () => buildImageNodeView(deps))
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
    const dom = document.createElement('img')
    const src = String(node.attrs.src ?? '')
    const alt = String(node.attrs.alt ?? '')
    const title = String(node.attrs.title ?? '')

    if (alt) dom.setAttribute('alt', alt)
    if (title) dom.setAttribute('title', title)
    dom.dataset.rawSrc = src

    const resolved = resolveImageSrc(src, filePath, vaultPath, paletteItems)
    if (resolved.kind === 'missing') {
      replaceWithPlaceholder(dom, src)
    } else {
      dom.setAttribute('src', resolved.url)
      dom.addEventListener(
        'error',
        () => replaceWithPlaceholder(dom, src),
        { once: true },
      )
    }

    return { dom }
  }
}

function replaceWithPlaceholder(img: HTMLImageElement, rawSrc: string): void {
  const placeholder = document.createElement('span')
  placeholder.className = 'md-image-broken'
  placeholder.setAttribute('role', 'img')
  placeholder.setAttribute('aria-label', `Missing image: ${rawSrc}`)
  placeholder.title = rawSrc || 'Missing image'
  placeholder.textContent = '⛌ image not found'
  img.replaceWith(placeholder)
}
