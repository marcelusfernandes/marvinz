---
name: e2e-test-suite-init
description: |
  Scaffolds a complete Playwright E2E test suite from scratch. Creates the e2e/ directory with configuration files, folder structure, base page class, custom fixtures, auth setup, and environment config. Use when: setting up E2E tests for a new project, initialising a Playwright test suite, or bootstrapping the e2e directory.
user-invocable: true
argument-hint: "[project-name]"
---

# Initialise E2E Test Suite

Scaffold the entire `e2e/` directory structure with all configuration files, base classes, fixtures, and helpers needed to start writing Playwright E2E tests.

---

## Pre-Flight Check

1. **Check if `e2e/` already exists.** If so, abort and inform the user — do NOT overwrite an existing test suite.
2. **Check if Playwright is installed.** If `@playwright/test` is not in `package.json`, add it.

---

## Workflow

### Step 1 — Create the Directory Structure

```
e2e/
├── auth/
│   └── auth.setup.ts
├── fixtures/
│   └── base.ts
├── helpers/
│   └── env-config.ts
├── poms/
│   └── base.page.ts
├── test-data/
├── tests/
│   ├── handover/
│   ├── regression/
│   └── smoke/
├── .auth/                   # git-ignored, holds saved session state
├── .gitignore
├── .env.example
├── playwright.config.ts
└── tsconfig.json
```

### Step 2 — Generate Configuration Files

Generate each file using the reference templates:

| File | Template Reference |
| ---- | ------------------ |
| `playwright.config.ts` | [references/playwright-config-template.md](references/playwright-config-template.md) |
| `poms/base.page.ts` | [references/base-page-template.md](references/base-page-template.md) |
| `fixtures/base.ts` | [references/fixtures-template.md](references/fixtures-template.md) |
| `helpers/env-config.ts` | [references/env-config-template.md](references/env-config-template.md) |
| `auth/auth.setup.ts` | See `e2e-test-conventions` skill, `references/auth-setup.md` |

### Step 3 — Generate Support Files

**`e2e/.gitignore`:**
```
.auth/
.env
.env.*
!.env.example
test-results/
playwright-report/
blob-report/
```

**`e2e/.env.example`:**
```env
BASE_URL="https://your-app.example.com"
LOGIN_EMAIL="test-user@example.com"
LOGIN_PASSWORD="your-password"
AUTH_FILE="e2e/.auth/user.json"
```

**`e2e/tsconfig.json`:**
```json
{
    "compilerOptions": {
        "target": "ES2022",
        "module": "commonjs",
        "moduleResolution": "node",
        "strict": true,
        "esModuleInterop": true,
        "skipLibCheck": true,
        "forceConsistentCasingInFileNames": true,
        "resolveJsonModule": true,
        "outDir": "./dist",
        "rootDir": "."
    },
    "include": ["**/*.ts"],
    "exclude": ["node_modules", "dist"]
}
```

### Step 4 — Adapt to the Project

Ask the user (or infer from the existing codebase) about:

1. **Login page URL** — to customise `auth.setup.ts`
2. **Post-login URL** — the URL to wait for after login (e.g., `/dashboard`, `/home`)
3. **Auth storage method** — cookies/localStorage only, or IndexedDB (Firebase, Supabase, etc.)
4. **Base URL** — the application URL for the default environment

### Step 5 — Print Next Steps

After generating all files, tell the user:

1. Install Playwright browsers: `npx playwright install`
2. Copy `.env.example` to `.env.production` and fill in values
3. Create a POM for the first page: `/create-pom [page-name]`
4. Create the first test: `/create-regression-test [feature]`

---

## Rules

- **Never overwrite an existing `e2e/` directory**
- All generated code must be TypeScript
- Follow the `e2e-test-conventions` skill for all patterns
- Use the two-layer env loading pattern (`getEnvConfig()`, `getBaseUrl()`, etc.)
- Auth file path must come from `AUTH_FILE` env var via `getAuthFilePath()`
- All five browsers must be configured in `playwright.config.ts`
- All three suites (regression, handover, smoke) must be configured
