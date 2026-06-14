import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron/simple'
import { visualizer } from 'rollup-plugin-visualizer'
import { copyFileSync, mkdirSync, chmodSync } from 'node:fs'
import { resolve } from 'node:path'
import { execSync } from 'node:child_process'
import type { Plugin } from 'vite'

// SIGKILL the whole process subtree rooted at `pid`, children first.
function sigkillTree(pid: number): void {
  let children: number[] = []
  try {
    children = execSync(`pgrep -P ${pid}`, { encoding: 'utf8' })
      .split('\n')
      .map(Number)
      .filter((n) => n > 0)
  } catch {
    // pgrep exits non-zero when there are no children — nothing to recurse.
  }
  for (const child of children) sigkillTree(child)
  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    // Already gone — ignore.
  }
}

// Ctrl+C in the dev terminal must terminate the spawned Electron app. The
// Electron main process cannot do this itself: node-pty resets every signal
// handler to SIG_DFL on pty.spawn() (so process.on('SIGINT') stops firing once
// a terminal is opened), and Electron hijacks SIGINT into an app.quit() that
// only schedules on a starved Chromium message loop. The reliable fix lives in
// the launcher (this vite/node process, which never spawns a pty): on
// SIGINT/SIGTERM, force-kill the entire Electron process tree, then exit.
function killElectronOnSignal(): Plugin {
  return {
    name: 'kill-electron-on-signal',
    apply: 'serve',
    configureServer() {
      const onSignal = (): never => {
        const pid = (process as { electronApp?: { pid?: number } }).electronApp?.pid
        if (pid != null) sigkillTree(pid)
        process.exit(0)
      }
      process.once('SIGINT', onSignal)
      process.once('SIGTERM', onSignal)
    },
  }
}

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
      // claude CLI spawns the hook via execve — needs +x on the script itself.
      chmodSync(dest, 0o755)
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
    killElectronOnSignal(),
    copyBridgePlugin(),
    process.env.ANALYZE &&
      visualizer({
        open: true,
        gzipSize: true,
        brotliSize: true,
        filename: 'dist/stats.html',
      }),
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
  ].filter(Boolean),
})
