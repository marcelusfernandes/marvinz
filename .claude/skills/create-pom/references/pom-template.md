# POM Template

Copy and adapt this template when creating a new Page Object Model.

```typescript
import { Page, Locator, expect } from '@playwright/test';
// TODO: Adapt the import to your project's base page class
import { BasePage } from './base.page';

/**
 * Page Object Model for the {Feature} page.
 *
 * Encapsulates all locators and interactions for {URL path}.
 * All test specs should use this class — never interact with the page directly.
 */
export class {Feature}Page extends BasePage {
    constructor(page: Page) {
        super(page);
    }

    // ==========================================
    // LIFECYCLE (from BasePage)
    // ==========================================

    /**
     * Navigates to the {feature} page and cleans up stale data
     * from previous failed test runs.
     *
     * Steps:
     * 1. Navigates to {URL path} via direct URL.
     * 2. Waits for the page heading to be visible.
     * 3. Checks for and deletes any items matching test data patterns.
     */
    async setUp(): Promise<void> {
        await this.navigateToPage();
        // TODO: Add cleanup logic for stale test data
    }

    /**
     * Cleans up data created during the test suite.
     *
     * Steps:
     * 1. Navigates to {URL path}.
     * 2. Deletes all items created during this test run.
     */
    async tearDown(): Promise<void> {
        await this.navigateToPage();
        // TODO: Add cleanup logic
    }

    // ==========================================
    // LOCATORS
    // ==========================================

    /** The main heading of the {feature} page. */
    get heading(): Locator {
        return this.page.getByRole('heading', { name: '{Page Title}' });
    }

    // TODO: Add getter properties for all interactive elements.
    // Use the selector priority: getByRole > getByLabel > getByText > getByPlaceholder > locator

    // ==========================================
    // NAVIGATION
    // ==========================================

    /**
     * Navigates directly to the {feature} page.
     *
     * Steps:
     * 1. Navigates to {URL path} via page.goto().
     * 2. Asserts the page heading is visible.
     * 3. Asserts the URL matches the expected pattern.
     */
    async navigateToPage(): Promise<void> {
        await this.page.goto('/{feature}');
        await expect(this.heading).toBeVisible();
        await expect(this.page).toHaveURL(/\/{feature}/);
    }

    // ==========================================
    // VERIFICATION
    // ==========================================

    // TODO: Add verification methods that assert page state.
    // Each method should use expect() assertions.

    // ==========================================
    // CREATE
    // ==========================================

    // TODO: Add creation methods.

    // ==========================================
    // EDIT
    // ==========================================

    // TODO: Add edit/update methods.

    // ==========================================
    // DELETE
    // ==========================================

    // TODO: Add deletion methods.
}
```

## Checklist

Before finalising a POM, verify:

- [ ] File named `{feature}.page.ts` in `e2e/poms/`
- [ ] Class extends the project's base page class
- [ ] `setUp()` implemented — navigates and cleans stale data
- [ ] `tearDown()` implemented — cleans data created during tests
- [ ] All sections present with comment banners
- [ ] Every public method has detailed JSDoc with Steps and @param tags
- [ ] Selectors follow priority order (role > label > text > placeholder > CSS)
- [ ] No imports of other POMs
- [ ] No hardcoded test data (data comes from specs via method parameters)
- [ ] No reusable helpers that belong in `BasePage` — if a method could serve multiple POMs, move it to `base.page.ts`
- [ ] File compiles with no TypeScript errors
