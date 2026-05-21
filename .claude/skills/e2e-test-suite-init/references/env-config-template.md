# Environment Config Template

```typescript
import * as dotenv from 'dotenv';
import * as path from 'path';

// ──────────────────────────────────────────────
// Two-layer loading
// ──────────────────────────────────────────────
// Layer 1: e2e/.env         — base file (optional)
// Layer 2: e2e/.env.{env}   — environment override (optional)
//
// dotenv never overwrites variables already present in the
// environment, so CLI exports and CI-injected values always win.
// ──────────────────────────────────────────────

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

// ──────────────────────────────────────────────
// Require helper
// ──────────────────────────────────────────────

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

// ──────────────────────────────────────────────
// Exported helpers
// ──────────────────────────────────────────────

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

## Usage

```typescript
// In auth.setup.ts
import { getBaseUrl, getCredentials, getAuthFilePath } from '../helpers/env-config';

// In playwright.config.ts
import { getAuthFilePath } from './helpers/env-config';

// In any helper
import { getEnvConfig } from '../helpers/env-config';
const config = getEnvConfig();
```
