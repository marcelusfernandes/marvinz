import { useCallback, useRef, useState, type RefObject } from 'react'
import {
  replaceFrontmatter,
  serializeFrontmatter,
  splitFrontmatter,
  type Frontmatter,
} from '../lib/frontmatter'

type FmCache = { prefix: string; data: Frontmatter; yaml: string }

/**
 * Frontmatter split/serialize glue for the note editor's body-vs-Properties
 * editing paths, plus the #558 prefix cache. Extracted from Editor.tsx (#590)
 * with the cache moved INTACT: `fmCacheRef` is the synchronous source of truth
 * for the body-change callback; the `fmCache` state mirror is returned so the
 * preview useMemo can read it during render WITHOUT touching the ref.
 */
export function useFrontmatterEditing({
  latestValue,
  scheduleSave,
}: {
  latestValue: RefObject<string>
  scheduleSave: (next: string) => void
}): {
  fmCache: FmCache | null
  handleBodyChange: (newBody: string) => void
  handlePropertiesChange: (nextData: Frontmatter | null) => void
} {
  // Cache the split of `content` into its serialized frontmatter prefix so the
  // body-change path can prepend it without re-parsing. Invalidated when the
  // content no longer starts with the cached prefix. The ref is the sync source
  // of truth for the body-change callback; the state mirror feeds the preview
  // useMemo without reading a ref during render (#558).
  const fmCacheRef = useRef<FmCache | null>(null)
  const [fmCache, setFmCache] = useState<FmCache | null>(null)
  const frontmatterFor = useCallback((content: string): FmCache | null => {
    const cached = fmCacheRef.current
    if (cached && content.startsWith(cached.prefix)) return cached
    const { data } = splitFrontmatter(content)
    if (!data) {
      fmCacheRef.current = null
      setFmCache(null)
      return null
    }
    const yaml = serializeFrontmatter(data)
    const next: FmCache = { prefix: `---\n${yaml}\n---\n\n`, data, yaml }
    fmCacheRef.current = next
    setFmCache(next)
    return next
  }, [])

  // Live-preview body changes: keep the current frontmatter, replace the body.
  const handleBodyChange = useCallback(
    (newBody: string) => {
      const fm = frontmatterFor(latestValue.current)
      scheduleSave(fm ? `${fm.prefix}${newBody}` : newBody)
    },
    [frontmatterFor, scheduleSave, latestValue]
  )

  // Properties changes: replace the frontmatter, keep the body untouched.
  const handlePropertiesChange = useCallback(
    (nextData: Frontmatter | null) => {
      const next = replaceFrontmatter(latestValue.current, nextData)
      scheduleSave(next)
    },
    [scheduleSave, latestValue]
  )

  return { fmCache, handleBodyChange, handlePropertiesChange }
}
