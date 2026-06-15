import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

// Web demo build (issue #441): bundles the real renderer with the window.marvin
// mock installed (src/demo/main.tsx), producing a static bundle the landing can
// embed in an iframe. No Electron, no preload — runs in a plain browser.
//
// Output goes to website/public/demo/ so the Next.js site serves it at /demo/.
// base: './' keeps asset + BASE_URL paths relative so it works under /demo/.
export default defineConfig({
  // The demo's index.html is the build root, so it emits at outDir/index.html
  // (served as /demo/index.html by the site), not a nested path.
  root: resolve(__dirname, 'src/demo'),
  base: './',
  publicDir: resolve(__dirname, 'public'),
  // Enable the native chat UI so the demo shows the Claude chat panel (not the
  // terminal). The flag is off in release Electron builds; the demo opts in so
  // visitors see the scripted agent session.
  define: {
    'import.meta.env.VITE_CHAT_UI_ENABLED': JSON.stringify('true'),
  },
  plugins: [react()],
  build: {
    outDir: resolve(__dirname, 'website/public/demo'),
    emptyOutDir: true,
  },
})
