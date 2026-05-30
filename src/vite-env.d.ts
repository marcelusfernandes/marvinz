/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CHAT_UI_ENABLED?: string
  readonly VITE_OFFICE_EDIT_ENABLED?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

// Fontsource packages ship only CSS via side-effect imports; no .d.ts upstream.
declare module '@fontsource-variable/geist'
declare module '@fontsource-variable/geist-mono'
