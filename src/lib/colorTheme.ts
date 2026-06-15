import { useEffect } from 'react'
import { useSetting } from './settingsStore'

export type ResolvedTheme = 'light' | 'dark'

function resolve(setting: 'light' | 'dark' | 'system' | undefined): ResolvedTheme {
  if (setting === 'light' || setting === 'dark') return setting
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/**
 * Applies `data-theme` on <html> based on the user's `colorTheme` setting.
 * When the setting is 'system' (or unset), follows `prefers-color-scheme`
 * and updates live when the OS preference changes.
 */
export function useColorTheme(): ResolvedTheme {
  const setting = useSetting('colorTheme')
  const resolved = resolve(setting)

  useEffect(() => {
    document.documentElement.dataset.theme = resolved
  }, [resolved])

  useEffect(() => {
    if (setting && setting !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => {
      document.documentElement.dataset.theme = mq.matches ? 'dark' : 'light'
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [setting])

  return resolved
}

/**
 * Applies `data-agents-pane-transparent` on <html> based on the user's
 * `agentsPaneTransparent` setting. Removes the attribute when off so the pane
 * stays opaque.
 */
export function useAgentsPaneTransparent(): boolean {
  const setting = useSetting('agentsPaneTransparent') ?? false

  useEffect(() => {
    if (setting) {
      document.documentElement.dataset.agentsPaneTransparent = 'true'
    } else {
      delete document.documentElement.dataset.agentsPaneTransparent
    }
  }, [setting])

  return setting
}

/**
 * Applies editor micro-animation data-attributes on <html>: `data-editor-effects`
 * (master) and `data-editor-effect-caret-slide`. CSS targets the combination,
 * so absent attributes disable the effect. Both default on.
 *
 * Also sets a central reduced-motion signal on <html> via `data-reduced-motion`.
 * CSS effects opt out via the `@media (prefers-reduced-motion: no-preference)`
 * guard; JS-driven effects (char entrance, parallax — subs of #20) read this
 * attribute since a media query can't gate a JS decoration or scroll listener.
 */
export function useEditorEffects(): void {
  const master = useSetting('editorEffectsMaster') ?? true
  const caretSlide = useSetting('editorEffectCaretSlide') ?? true

  useEffect(() => {
    if (master) {
      document.documentElement.dataset.editorEffects = 'on'
    } else {
      delete document.documentElement.dataset.editorEffects
    }
  }, [master])

  useEffect(() => {
    if (caretSlide) {
      document.documentElement.dataset.editorEffectCaretSlide = 'on'
    } else {
      delete document.documentElement.dataset.editorEffectCaretSlide
    }
  }, [caretSlide])

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const apply = () => {
      if (mq.matches) {
        document.documentElement.dataset.reducedMotion = 'true'
      } else {
        delete document.documentElement.dataset.reducedMotion
      }
    }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])
}
