import { create } from 'zustand'

export type ClipboardMode = 'copy' | 'cut' | null

type State = {
  mode: ClipboardMode
  // Set internally so per-row `has()` subscribers stay O(1) and return stable booleans.
  paths: Set<string>
  set: (mode: 'copy' | 'cut', paths: Iterable<string>) => void
  clear: () => void
}

export const useClipboardStore = create<State>((set) => ({
  mode: null,
  paths: new Set(),
  set: (mode, paths) => set({ mode, paths: new Set(paths) }),
  clear: () => set({ mode: null, paths: new Set() }),
}))

export function clipPasteLabel(clip: { mode: ClipboardMode; paths: Set<string> }): string {
  return clip.mode && clip.paths.size > 1 ? `Paste ${clip.paths.size} items` : 'Paste'
}
