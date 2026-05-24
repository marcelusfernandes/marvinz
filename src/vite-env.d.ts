/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CHAT_UI_ENABLED?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
