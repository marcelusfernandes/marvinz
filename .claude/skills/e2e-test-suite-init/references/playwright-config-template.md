# Playwright Config Template

```typescript
import { defineConfig, devices } from '@playwright/test';
import { getAuthFilePath } from './helpers/env-config';

const authFile = getAuthFilePath();

export default defineConfig({
    testDir: './tests',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 1 : undefined,
    reporter: 'html',
    use: {
        trace: 'on-first-retry',
    },

    projects: [
        // ── Setup ────────────────────────────────────
        {
            name: 'setup',
            testDir: './auth',
            testMatch: /.*\.setup\.ts/,
        },

        // ── Chromium ─────────────────────────────────
        {
            name: 'chromium:regression',
            use: { ...devices['Desktop Chrome'], storageState: authFile },
            dependencies: ['setup'],
            testDir: './tests/regression',
        },
        {
            name: 'chromium:handover',
            use: { ...devices['Desktop Chrome'], storageState: authFile },
            dependencies: ['setup'],
            testDir: './tests/handover',
        },
        {
            name: 'chromium:smoke',
            use: { ...devices['Desktop Chrome'], storageState: authFile },
            dependencies: ['setup'],
            testDir: './tests/smoke',
        },

        // ── Firefox ──────────────────────────────────
        {
            name: 'firefox:regression',
            use: { ...devices['Desktop Firefox'], storageState: authFile },
            dependencies: ['setup'],
            testDir: './tests/regression',
        },
        {
            name: 'firefox:handover',
            use: { ...devices['Desktop Firefox'], storageState: authFile },
            dependencies: ['setup'],
            testDir: './tests/handover',
        },
        {
            name: 'firefox:smoke',
            use: { ...devices['Desktop Firefox'], storageState: authFile },
            dependencies: ['setup'],
            testDir: './tests/smoke',
        },

        // ── WebKit ───────────────────────────────────
        {
            name: 'webkit:regression',
            use: { ...devices['Desktop Safari'], storageState: authFile },
            dependencies: ['setup'],
            testDir: './tests/regression',
        },
        {
            name: 'webkit:handover',
            use: { ...devices['Desktop Safari'], storageState: authFile },
            dependencies: ['setup'],
            testDir: './tests/handover',
        },
        {
            name: 'webkit:smoke',
            use: { ...devices['Desktop Safari'], storageState: authFile },
            dependencies: ['setup'],
            testDir: './tests/smoke',
        },

        // ── Mobile Chrome ────────────────────────────
        {
            name: 'mobile-chrome:regression',
            use: { ...devices['Pixel 5'], storageState: authFile },
            dependencies: ['setup'],
            testDir: './tests/regression',
        },
        {
            name: 'mobile-chrome:handover',
            use: { ...devices['Pixel 5'], storageState: authFile },
            dependencies: ['setup'],
            testDir: './tests/handover',
        },
        {
            name: 'mobile-chrome:smoke',
            use: { ...devices['Pixel 5'], storageState: authFile },
            dependencies: ['setup'],
            testDir: './tests/smoke',
        },

        // ── Mobile Safari ────────────────────────────
        {
            name: 'mobile-safari:regression',
            use: { ...devices['iPhone 12'], storageState: authFile },
            dependencies: ['setup'],
            testDir: './tests/regression',
        },
        {
            name: 'mobile-safari:handover',
            use: { ...devices['iPhone 12'], storageState: authFile },
            dependencies: ['setup'],
            testDir: './tests/handover',
        },
        {
            name: 'mobile-safari:smoke',
            use: { ...devices['iPhone 12'], storageState: authFile },
            dependencies: ['setup'],
            testDir: './tests/smoke',
        },
    ],
});
```
