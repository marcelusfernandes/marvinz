import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron/simple'
import { copyFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'

// Copy the hook bridge script (plain CJS, no build step) into dist-electron/
// so it lands alongside main.cjs and __dirname resolves in resolveBridgePath().
function copyBridgePlugin(): Plugin {
  return {
    name: 'copy-bridge-cjs',
    closeBundle() {
      const src = resolve(__dirname, 'electron/agent/hooks/pretooluse-bridge.cjs')
      const dest = resolve(__dirname, 'dist-electron/pretooluse-bridge.cjs')
      mkdirSync(resolve(__dirname, 'dist-electron'), { recursive: true })
      copyFileSync(src, dest)
    },
  }
}

export default defineConfig({
  // Electron loads the production renderer via file://, so asset URLs must
  // be relative (./assets/…). Without this, absolute paths like /assets/…
  // resolve to filesystem root and 404. Also makes BASE_URL relative so
  // `${import.meta.env.BASE_URL}material-icons/foo.svg` works in both dev
  // (served as /material-icons/…) and prod (./material-icons/…).
  base: './',
  plugins: [
    react(),
    copyBridgePlugin(),
    electron({
      main: {
        entry: 'electron/main.ts',
        vite: {
          build: {
            lib: {
              entry: 'electron/main.ts',
              formats: ['cjs'],
              fileName: () => 'main.cjs',
            },
            rollupOptions: {
              external: ['electron', 'node-pty', 'chokidar', 'fsevents'],
            },
          },
        },
      },
      preload: {
        input: 'electron/preload.ts',
        vite: {
          build: {
            rollupOptions: {
              external: ['electron'],
            },
          },
        },
      },
    }),
  ],
})
