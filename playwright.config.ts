import { defineConfig } from 'playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 0,
  reporter: 'list',
  use: {
    // Electron tests use the _electron fixture, not a browser
    headless: false,
  },
})
