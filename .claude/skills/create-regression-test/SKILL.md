---
name: create-regression-test
description: |
  Creates a regression or smoke test spec file for a Playwright E2E test suite. Generates the spec file, test data JSON, and fixture updates. Handles complete test scaffolding including beforeAll cleanup, POM usage, and parallel-safe data. Use when asked to write a regression test, smoke test, or E2E test for a feature.
user-invocable: true
argument-hint: "[feature-name]"
disable-model-invocation: true
---

# Create Regression / Smoke Test

Generate a complete test spec with associated test data and fixture integration.

---

## Workflow

1. **Determine the feature name** from the user's request
2. **Determine the suite** — regression (default) or smoke
3. **Check if a POM exists** in `e2e/poms/{feature}.page.ts`
   - If yes, read its public methods and JSDoc to understand available actions
   - If no, create one first using the `create-pom` skill
4. **Check if test data exists** in `e2e/test-data/{feature}.json`
   - If yes, read and use the existing data shape
   - If no, create the JSON file with template data
5. **Check fixtures** in `e2e/fixtures/base.ts`
   - If the feature is not yet registered, add the interface and loader
6. **Create the spec file** in the appropriate directory
7. **Run the test** to verify it passes:
   ```bash
   npx playwright test --project="chromium:regression" {feature}.spec.ts
   ```

---

## Spec File Structure

Every spec follows this exact pattern:

```typescript
import { test } from '../../fixtures/base';
import { getAuthFilePath } from '../../helpers/env-config';
import { FeaturePage } from '../../poms/feature.page';

const authFile = getAuthFilePath();

test.describe('Feature Name Tests', () => {
    // One-time setup: clean stale data from previous failed runs
    test.beforeAll(async ({ browser }) => {
        const context = await browser.newContext({
            storageState: authFile,
        });
        const page = await context.newPage();
        const pom = new FeaturePage(page);
        await pom.setUp();
        await page.close();
        await context.close();
    });

    test('should create a new item', async ({ page, testData }) => {
        const pom = new FeaturePage(page);
        const item = testData.feature.items[0];

        await pom.navigateToPage();
        await pom.createItem(item.name, item.value);
        await pom.verifyItemExists(item.name);
    });

    test('should edit an existing item', async ({ page, testData }) => {
        const pom = new FeaturePage(page);
        const item = testData.feature.items[0];
        const updated = testData.feature.updatedItem;

        await pom.navigateToPage();
        await pom.createItem(item.name, item.value);
        await pom.editItem(item.name, updated.name, updated.value);
        await pom.verifyItemExists(updated.name);
    });

    test('should delete an item', async ({ page, testData }) => {
        const pom = new FeaturePage(page);
        const item = testData.feature.items[1];

        await pom.navigateToPage();
        await pom.createItem(item.name, item.value);
        await pom.deleteItem(item.name);
        await pom.verifyItemNotExists(item.name);
    });
});
```

---

## Critical Rules

### No Raw Page Calls in Specs

A spec must NEVER call `page.getByRole()`, `page.locator()`, `page.waitForTimeout()`, or any raw Playwright page method. All interaction goes through the POM.

**Only acceptable uses of `page` in a spec:**
1. Passing it to the POM constructor: `new FeaturePage(page)`
2. Creating contexts in `beforeAll`: `browser.newContext()` / `context.newPage()`

### Test Independence

- Every test navigates independently via `pom.navigateToPage()`
- Every test creates its own data — never rely on data from another test
- Tests run in parallel — use unique-suffixed test data to avoid collisions

### Custom Test Import

Always import `test` from the project's custom fixtures:

```typescript
// CORRECT
import { test } from '../../fixtures/base';

// WRONG — loses access to testData fixture
import { test } from '@playwright/test';
```

---

## Test Data

### JSON File: `e2e/test-data/{feature}.json`

```json
{
    "items": [
        { "name": "ItemA", "key": "keyA", "value": "some-value" },
        { "name": "ItemB", "key": "keyB", "value": "other-value" }
    ],
    "updatedItem": { "name": "Updated", "value": "new-value" }
}
```

### Rules

- **Never hardcode data in spec or POM files**
- All string values get unique suffixes automatically via the testData fixture
- Shape the data to match what the POM methods expect as parameters

See [references/spec-template.md](references/spec-template.md) and [references/test-data-template.md](references/test-data-template.md) for full templates.

---

## beforeAll Cleanup Pattern

The `beforeAll` block must:

1. Create a **new browser context** manually (not from the test's page fixture)
2. Load `storageState` for authentication
3. Instantiate the POM and call `setUp()`
4. Close the page and context when done

This ensures stale data from previous failed runs is cleaned before any test executes.

---

## File Checklist

When creating a regression/smoke test, you should produce:

- [ ] `e2e/poms/{feature}.page.ts` — POM (create or update)
- [ ] `e2e/test-data/{feature}.json` — Test data
- [ ] `e2e/fixtures/base.ts` — Updated with feature interface and loader (if new feature)
- [ ] `e2e/tests/regression/{feature}.spec.ts` (or `tests/smoke/`) — Spec file
- [ ] All tests are independent and parallel-safe
- [ ] No raw `page` calls in the spec
- [ ] No hardcoded test data
- [ ] Tests pass on chromium: `npx playwright test --project="chromium:regression" {feature}.spec.ts`
