# Folder Structure Reference

## Directory Details

### `e2e/auth/`

Contains the authentication setup project. The `auth.setup.ts` file logs in once and saves the session state to the path from `AUTH_FILE` via `getAuthFilePath()`. This file is loaded by every test project via `storageState` in the Playwright config.

### `e2e/fixtures/`

Contains custom Playwright fixtures that extend the default `test` object. The primary fixture (`base.ts`) adds a `testData` fixture that:

1. Loads the appropriate JSON file from `test-data/`
2. Stamps every string value with a unique suffix for parallel safety
3. Provides typed access to test data within each test

### `e2e/helpers/`

Shared utility functions that are NOT page objects. Key files:

- `env-config.ts` — Reads `TEST_ENV`, loads the matching `.env.{env}` file, and exports helper functions such as `getEnvConfig()`, `getBaseUrl()`, `getCredentials()`, and `getAuthFilePath()`

### `e2e/poms/`

Page Object Models — one file per page/view. Every POM extends `BasePage` (`base.page.ts`), which enforces `setUp()` and `tearDown()` lifecycle methods and provides reusable helper methods shared across all POMs (e.g., `waitForToast`, `dismissModal`, `waitForLoadingComplete`). Derived POMs should contain only page-specific behavior; any helper that is useful across multiple pages belongs in `BasePage`.

### `e2e/test-data/`

JSON files containing test data for each feature. Named to match the corresponding POM and spec file (e.g., `vault.json` for `vault.page.ts` and `vault.spec.ts`).

### `e2e/tests/`

Test specs organised into three suites:

- **`regression/`** — Permanent tests that run on every build. Full feature coverage.
- **`handover/`** — Temporary tests tied to specific tickets. Promoted to regression or deleted when the ticket is done.
- **`smoke/`** — Quick sanity checks covering the critical path only.

### Configuration Files

- **`playwright.config.ts`** — Defines browser × suite projects, authentication dependencies, and base configuration
- **`tsconfig.json`** — TypeScript configuration for the test suite
- **`.env.example`** — Template for environment variables (committed to git)
- **`.env.{env}`** — Per-environment variable files (git-ignored, contain secrets)
