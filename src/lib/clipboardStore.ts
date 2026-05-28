import { create } from 'zustand'

export type ClipboardMode = 'copy' | 'cut' | null

type State = {
  mode: ClipboardMode
  paths: string[]
  set: (mode: 'copy' | 'cut', paths: string[]) => void
  clear: () => void
}

export const useClipboardStore = create<State>((set) => ({
  mode: null,
  paths: [],
  set: (mode, paths) => set({ mode, paths }),
  clear: () => set({ mode: null, paths: [] }),
}))
