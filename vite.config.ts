import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron/simple'

export default defineConfig({
  // Electron loads the production renderer via file://, so asset URLs must
  // be relative (./assets/…). Without this, absolute paths like /assets/…
  // resolve to filesystem root and 404. Also makes BASE_URL relative so
  // `${import.meta.env.BASE_URL}material-icons/foo.svg` works in both dev
  // (served as /material-icons/…) and prod (./material-icons/…).
  base: './',
  plugins: [
    react(),
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
