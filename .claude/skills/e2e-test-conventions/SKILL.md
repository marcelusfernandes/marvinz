---
name: e2e-test-conventions
description: |
  Core conventions and rules for Playwright E2E testing with TypeScript. Covers project structure, naming conventions, selector strategy, authentication, navigation, environment configuration, test independence, and parallelism. Automatically loaded when writing or modifying E2E tests.

  Use when: generating E2E tests, creating POMs, reviewing test code, or setting up a Playwright test suite.
user-invocable: false
---

# E2E Test Conventions

These conventions apply to all Playwright E2E test code. Read and follow them whenever generating, modifying, or reviewing tests.

---

## Technology Stack

- **Playwright** for browser automation and test running
- **TypeScript** for all test code (no plain JavaScript)
- Framework-agnostic — adapt selectors and helpers to whatever UI framework the project uses

---

## Project Structure

The `e2e/` directory follows this layout:

```
e2e/
├── auth/                    # Authentication setup (runs before all tests)
│   └── auth.setup.ts        # Logs in and saves session state
├── fixtures/                # Custom Playwright fixtures
│   └── base.ts              # Extends Playwright's test with custom fixtures
├── helpers/                 # Shared utility functions (NOT page objects)
│   └── env-config.ts        # Environment resolution
├── poms/                    # Page Object Models (one file per page)
│   └── base.page.ts         # Abstract base class — all POMs extend this
├── test-data/               # External test data (JSON files)
├── tests/                   # Test specs organised by suite
│   ├── handover/            # Ticket-driven handover tests (temporary)
│   ├── regression/          # Full regression tests (permanent)
│   └── smoke/               # Quick critical-path checks
├── playwright.config.ts
├── tsconfig.json
└── .env.example             # Template for environment variables
```

**Rules:**
- Do NOT create files outside this structure
- Do NOT move existing files without explicit permission

See [references/folder-structure.md](references/folder-structure.md) for details on each directory.

---

## Browser × Suite Configuration

The Playwright config defines projects using `{browser}:{suite}` naming:

**Browsers:** `chromium`, `firefox`, `webkit`, `mobile-chrome`, `mobile-safari`

**Suites:**

| Suite | Directory | Purpose | Lifecycle |
| ----- | --------- | ------- | --------- |
| `regression` | `tests/regression/` | Full regression | Permanent |
| `handover` | `tests/handover/` | Ticket-driven handover | Temporary — promote or delete |
| `smoke` | `tests/smoke/` | Critical-path sanity | Permanent |

Every project depends on the `setup` project which handles authentication.

### Running Tests

```bash
# From e2e/ directory
npx playwright test                                    # All browsers × all suites
npx playwright test --project="chromium:regression"    # Single project
npx playwright test --project="*:smoke"                # One suite, all browsers
npx playwright test --project="firefox:*"              # One browser, all suites
```

---

## Naming Conventions

| Type | Pattern | Example |
| ---- | ------- | ------- |
| Page Object Model | `{feature}.page.ts` in `poms/` | `dashboard.page.ts` |
| Regression spec | `{feature}.spec.ts` in `tests/regression/` | `dashboard.spec.ts` |
| Smoke spec | `{feature}.spec.ts` in `tests/smoke/` | `dashboard.spec.ts` |
| Handover spec | `{TICKET}-{description}.spec.ts` in `tests/handover/` | `PROJ-123-bulk-delete.spec.ts` |
| Test data | `{feature}.json` in `test-data/` | `dashboard.json` |

The `{feature}` name **must match** across POM, spec, and test-data files.

---

## Test Independence and Parallelism

### Every Test Must Be Fully Independent

- Each test runs in **isolation** and in **any order**
- A test must **never** depend on state created by a previous test
- Each test navigates to its page via the POM's navigation method

### Parallel Safety

All tests run in parallel across multiple workers. To avoid collisions:

- Append unique suffixes (timestamp + random ID) to all test data values
- Never share mutable state between tests
- Each test creates its own data, verifies it, and cleans it up

---

## Authentication

Authentication is performed **once** in a setup project (`auth/auth.setup.ts`) that runs before all test projects. The session state is saved to a file and reused via Playwright's `storageState` configuration.

**NEVER** write login logic in specs, POMs, `beforeEach`, or `beforeAll`. Authentication is already handled.

If the application stores auth tokens in IndexedDB (Firebase Auth, Supabase, AWS Amplify, etc.), use the `indexedDB` option:

```typescript
await page.context().storageState({ path: authFile, indexedDB: true });
```

See [references/auth-setup.md](references/auth-setup.md) for the full pattern.

---

## Navigation

- **Always use direct URL navigation** (`page.goto('/dashboard')`)
- **Do NOT click through menus or sidebars** — menu state and animations cause flaky tests
- After navigating, assert the URL and a key heading/element are visible

---

## BasePage vs Derived POM Methods

`BasePage` is the single home for **reusable helper methods** that are useful across multiple pages. Derived POMs should stay focused on page-specific behavior only.

### When a method belongs in `BasePage`

Move a helper to `BasePage` when it is:

- **Reusable across multiple POMs** — e.g., dismissing a modal, waiting for a toast notification, or checking a loading spinner
- **Not tightly coupled to a single page** — it works the same regardless of which page is active
- **Generic enough to be inherited cleanly** — no page-specific selectors or assumptions
- **Likely to be duplicated** if left in a feature-specific POM

Examples of `BasePage` helpers:
- `waitForToast(message)` — waits for and verifies a toast notification
- `dismissModal()` — closes any open modal dialog
- `waitForLoadingComplete()` — waits for a loading spinner to disappear
- `getTableRowCount()` — counts rows in a data table present on many pages

### When a method belongs in a derived POM

Keep a helper in the specific POM when it is:

- **Unique to one page** — e.g., filling a page-specific form
- **Dependent on page-specific structure** — uses selectors that only exist on that page
- **Not expected to be reused** elsewhere

### Why this matters

- **Reduces duplication** — shared logic lives in one place instead of being copied across POMs
- **Centralises shared behavior** — updates to a common helper propagate to all POMs automatically
- **Keeps derived POMs small and focused** — each POM only contains what is specific to its page
- **Improves discoverability** — developers know to look at `BasePage` for shared utilities

### Rule

If you find yourself writing the same helper in a second POM, **promote it to `BasePage`** immediately. Do not leave duplicate helpers scattered across feature POMs.

---

## Selectors and Locator Strategy

Use this priority order:

1. `getByRole()` — buttons, headings, dialogs (most resilient)
2. `getByLabel()` — form fields
3. `getByText()` — visible text content
4. `getByPlaceholder()` — input placeholders
5. `locator()` with CSS / `filter()` — last resort

**Tips:**
- Dynamically rendered attributes (tooltips, popovers) may not be in the DOM at query time — use `filter()` to match child content
- Icon buttons often lack visible text — match by `aria-label` or child icon content
- Prefer role-based and label-based selectors over CSS classes (brittle and framework-specific)

See [references/selector-priority.md](references/selector-priority.md) for examples.

---

## Environment Configuration

Each environment has its own `.env.{env}` file in the `e2e/` directory:

| File | Environment |
| ---- | ----------- |
| `.env.local` | Local development |
| `.env.dev` | Development server |
| `.env.test` | Test server |
| `.env.uat` | UAT server |
| `.env.production` | Production |

**Every file uses the same variable names** — only the values differ:

```env
BASE_URL="https://your-app.example.com"
LOGIN_EMAIL="test-user@example.com"
LOGIN_PASSWORD="your-password"
AUTH_FILE="e2e/.auth/user.json"
```

### Selecting the Active Environment

`TEST_ENV` is **required**. If it is not set, `env-config.ts` throws immediately — the test run will not start. This prevents accidental E2E runs against production when someone forgets to set the variable.

```bash
TEST_ENV=dev npx playwright test          # loads .env then .env.dev
TEST_ENV=production npx playwright test    # loads .env then .env.production
npx playwright test                        # ❌ ERROR — TEST_ENV is not set
```

### Two-Layer Loading

`helpers/env-config.ts` reads `TEST_ENV` and loads environment variables in two layers via `dotenv`:

1. `e2e/.env` — base file (can hold `TEST_ENV` and all variables)
2. `e2e/.env.{env}` — optional environment-specific override

**Both files are optional.** If neither exists the process relies on variables already present in the environment (e.g. injected by CI or a container). `dotenv` never overwrites a variable that is already set, so CLI exports and CI-injected values always win.

The module exports helper functions — `getEnvConfig()`, `getBaseUrl()`, `getCredentials()`, and `getAuthFilePath()` — instead of a static constant. Loading runs once per process; subsequent calls are no-ops.

### Rules

- **`TEST_ENV` is required** — missing it throws an error so E2E runs never silently target production
- All variables (`BASE_URL`, `LOGIN_EMAIL`, `LOGIN_PASSWORD`, `AUTH_FILE`) are **required** — missing ones throw an error
- **Never fall back to hardcoded defaults** for required environment values; throw an error if they are missing
- `.env.*` files contain secrets and are **git-ignored**
- `.env.example` is the only env file committed — it serves as the template

---

## Test Data

- All test data lives in `e2e/test-data/{feature}.json`
- **Never hardcode data in spec or POM files**
- Use a custom fixture to load and stamp test data with unique suffixes
- Always import `test` from your custom fixtures, **not** from `@playwright/test`

---

## Spec File Rules

- All page interaction goes through POMs — **never** call `page.getByRole()`, `page.locator()`, etc. directly in specs
- The only acceptable uses of `page` in a spec: passing to POM constructor, or creating contexts in `beforeAll`
- Use `test.beforeAll` with a manually created browser context to call POM `setUp()` for cleanup
- Each test navigates independently via POM navigation methods
