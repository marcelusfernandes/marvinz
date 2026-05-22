---
name: create-pom
description: |
  Creates a Page Object Model (POM) class for a specified page in a Playwright E2E test suite. Generates the POM file with proper structure, comment banners, JSDoc, setUp/tearDown lifecycle methods, and locators. Use when asked to create a POM, page object, or page model.
user-invocable: true
argument-hint: "[page-name]"
---

# Create Page Object Model

Generate a POM class for the specified page following all E2E test conventions.

---

## Workflow

1. **Determine the page name** from the user's request (e.g., "Settings" → `settings.page.ts`)
2. **Check if a POM already exists** for this page in `e2e/poms/`. If so, add methods to the existing POM — do NOT create a second POM for the same page
3. **Identify the base page class** in `e2e/poms/base.page.ts` and extend it
4. **Read the target page** in the application to understand its elements and interactions
5. **Generate the POM file** following the template below
6. **Verify** the file compiles with no TypeScript errors

---

## Rules

- **One page = one POM** — every distinct page/view gets exactly one POM file
- **All POMs extend the base page class** — check `e2e/poms/base.page.ts` for the abstract class
- **Implement `setUp()` and `tearDown()`** — inherited from the base class
- **Reusable helpers belong in `BasePage`** — if a helper method is useful across multiple POMs (e.g., `waitForToast`, `dismissModal`), it must live in `BasePage`, not in a derived POM. Derived POMs should contain only page-specific behavior. If you find yourself writing the same helper in a second POM, promote it to `BasePage` immediately
- **NEVER reference another POM from within a POM** — if a test needs multiple pages, the spec file orchestrates between POMs
- **Detailed JSDoc on every public method** — describe what it does step by step, with `@param` tags
- **Use the selector priority order**: `getByRole()` > `getByLabel()` > `getByText()` > `getByPlaceholder()` > `locator()`

---

## POM Structure

Organise every POM with these clearly separated sections using comment banners:

```typescript
import { Page, Locator, expect } from '@playwright/test';
// TODO: Import your project's base page class
import { BasePage } from './base.page';

export class FeaturePage extends BasePage {
    constructor(page: Page) {
        super(page);
    }

    // ==========================================
    // LIFECYCLE (from BasePage)
    // ==========================================

    /**
     * Navigates to the feature page and cleans up any stale data
     * left by previous failed test runs.
     *
     * Steps:
     * 1. Navigates to /feature via direct URL.
     * 2. Waits for the page heading to be visible.
     * 3. Deletes any items matching the test data pattern.
     */
    async setUp(): Promise<void> {
        // TODO: Implement navigation and cleanup
    }

    /**
     * Cleans up any data created during the test suite.
     *
     * Steps:
     * 1. Navigates to /feature.
     * 2. Deletes all items created by this test run.
     */
    async tearDown(): Promise<void> {
        // TODO: Implement cleanup
    }

    // ==========================================
    // LOCATORS
    // ==========================================

    /** The main heading of the feature page. */
    get heading(): Locator {
        return this.page.getByRole('heading', { name: 'Feature Name' });
    }

    /** The "Create" button that opens the creation modal. */
    get createButton(): Locator {
        return this.page.getByRole('button', { name: /create/i });
    }

    // TODO: Add locators for all interactive elements on this page

    // ==========================================
    // NAVIGATION
    // ==========================================

    /**
     * Navigates directly to the feature page via URL.
     *
     * Steps:
     * 1. Calls page.goto('/feature').
     * 2. Asserts the page heading is visible.
     * 3. Asserts the URL contains '/feature'.
     */
    async navigateToPage(): Promise<void> {
        await this.page.goto('/feature');
        await expect(this.heading).toBeVisible();
        await expect(this.page).toHaveURL(/\/feature/);
    }

    // ==========================================
    // VERIFICATION
    // ==========================================

    /**
     * Verifies an item appears in the list with the expected name.
     *
     * Steps:
     * 1. Locates the item row by name text.
     * 2. Asserts the row is visible.
     *
     * @param name - The expected item name
     */
    async verifyItemExists(name: string): Promise<void> {
        await expect(
            this.page.getByRole('row', { name: new RegExp(name, 'i') })
        ).toBeVisible();
    }

    // ==========================================
    // CREATE
    // ==========================================

    /**
     * Creates a new item via the creation modal.
     *
     * Steps:
     * 1. Clicks the "Create" button to open the modal.
     * 2. Fills in the name field.
     * 3. Clicks "Submit" and waits for the modal to close.
     *
     * @param name - Display name for the new item
     */
    async createItem(name: string): Promise<void> {
        await this.createButton.click();
        const modal = this.page.getByRole('dialog');
        await modal.getByLabel('Name').fill(name);
        await modal.getByRole('button', { name: 'Submit' }).click();
        await expect(modal).toBeHidden();
    }

    // ==========================================
    // EDIT
    // ==========================================

    // TODO: Add edit methods

    // ==========================================
    // DELETE
    // ==========================================

    // TODO: Add delete methods
}
```

---

## JSDoc Requirements

Every public method MUST have a JSDoc comment with:

1. **Summary line** — what the method does
2. **Steps block** — numbered list of what happens when called
3. **@param tags** — for every parameter
4. **@returns tag** — if the method returns a value

This is critical because LLMs read these comments to understand what actions are available and generate test specs from them.

```typescript
/**
 * Updates an existing item's name and value.
 *
 * Steps:
 * 1. Locates the item row by its current name.
 * 2. Clicks the "Edit" button within that row.
 * 3. Clears and fills the name field with the new name.
 * 4. Clears and fills the value field with the new value.
 * 5. Clicks "Save" and waits for the edit modal to close.
 * 6. Waits for the success toast notification to appear.
 *
 * @param currentName - The item's current display name (used to locate the row)
 * @param newName     - The new display name
 * @param newValue    - The new value
 */
async editItem(currentName: string, newName: string, newValue: string): Promise<void> {
```

---

## Naming

- File: `e2e/poms/{feature}.page.ts` (lowercase, kebab-case feature name)
- Class: `{Feature}Page` (PascalCase)
- The feature name must match the corresponding spec and test-data files

See [references/pom-template.md](references/pom-template.md) for the full boilerplate.
