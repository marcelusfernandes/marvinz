# Authentication Setup Reference

## Pattern: Authenticate Once, Reuse Everywhere

Authentication runs once in a dedicated setup project before all test projects.

### auth.setup.ts

```typescript
import { test as setup, expect } from '@playwright/test';
import { getBaseUrl, getCredentials, getAuthFilePath } from '../helpers/env-config';

const authFile = getAuthFilePath();

setup('authenticate', async ({ page }) => {
    const { email, password } = getCredentials();

    // Navigate to login page
    await page.goto(getBaseUrl() + '/login');

    // Fill in credentials
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();

    // Wait for authentication to complete
    await page.waitForURL('**/dashboard');

    // Save session state
    // Use indexedDB: true if the app stores auth tokens in IndexedDB
    // (common with Firebase Auth, Supabase, AWS Amplify)
    await page.context().storageState({ path: authFile, indexedDB: true });

    // If the app only uses cookies/localStorage:
    // await page.context().storageState({ path: authFile });
});
```

### playwright.config.ts (relevant sections)

```typescript
import { defineConfig, devices } from '@playwright/test';
import { getAuthFilePath } from './helpers/env-config';

const authFile = getAuthFilePath();

export default defineConfig({
    projects: [
        // Setup project — runs first
        {
            name: 'setup',
            testDir: './auth',
            testMatch: /.*\.setup\.ts/,
        },

        // Browser × Suite projects — depend on setup
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
        // ... repeat for firefox, webkit, mobile-chrome, mobile-safari
    ],
});
```

### env-config.ts Pattern

```typescript
import * as dotenv from 'dotenv';
import * as path from 'path';

// Two-layer loading: base .env then environment-specific .env.{env}
if (!process.env.TEST_ENV) {
    throw new Error(
        'TEST_ENV is not set. You must specify the target environment explicitly.\n' +
        'Example: TEST_ENV=dev npx playwright test\n' +
        'Valid values depend on your .env.{env} files (e.g., local, dev, test, uat, production).\n\n' +
        'Why: Defaulting to production when TEST_ENV is missing is dangerous — ' +
        'a forgotten variable should never cause an E2E run to hit production by accident.'
    );
}

const env = process.env.TEST_ENV;
const e2eDir = path.resolve(__dirname, '..');

dotenv.config({ path: path.join(e2eDir, '.env') });
dotenv.config({ path: path.join(e2eDir, `.env.${env}`) });

function requireEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(
            `Missing required environment variable: ${name}\n` +
            `Ensure e2e/.env or e2e/.env.${env} exists and contains ${name}.\n` +
            `Copy .env.example to .env.${env} and fill in the values.`
        );
    }
    return value;
}

/** Returns the full environment config object. */
export function getEnvConfig() {
    return {
        env,
        baseUrl: requireEnv('BASE_URL'),
        email: requireEnv('LOGIN_EMAIL'),
        password: requireEnv('LOGIN_PASSWORD'),
        authFile: requireEnv('AUTH_FILE'),
    };
}

/** Returns the BASE_URL for the active environment. */
export function getBaseUrl(): string {
    return requireEnv('BASE_URL');
}

/** Returns login credentials for the active environment. */
export function getCredentials(): { email: string; password: string } {
    return {
        email: requireEnv('LOGIN_EMAIL'),
        password: requireEnv('LOGIN_PASSWORD'),
    };
}

/** Returns the path to the auth state file. */
export function getAuthFilePath(): string {
    return requireEnv('AUTH_FILE');
}
```

### .env.example

```env
# Copy this file to .env.{env} (e.g., .env.dev, .env.test, .env.production)
# and fill in the values for your environment.
#
# Select the active environment with: TEST_ENV=dev npx playwright test

BASE_URL="https://your-app.example.com"
LOGIN_EMAIL="test-user@example.com"
LOGIN_PASSWORD="your-password"
AUTH_FILE="e2e/.auth/user.json"
```

## Rules

- **NEVER** write login logic in specs, POMs, `beforeEach`, or `beforeAll`
- **NEVER** hardcode credentials — always use environment variables
- If the app uses IndexedDB for auth, you **must** pass `indexedDB: true` to `storageState()`
- `.env.*` files are git-ignored — only `.env.example` is committed
- All environment variables are required — missing ones throw with instructions
- `dotenv` never overwrites already-set variables — CLI and CI-injected values always win
