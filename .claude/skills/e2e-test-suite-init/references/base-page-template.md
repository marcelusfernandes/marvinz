# Base Page Template

```typescript
import { Page, expect } from '@playwright/test';

/**
 * Abstract base class for all Page Object Models.
 *
 * Every POM in the test suite must extend this class and implement
 * the setUp() and tearDown() lifecycle methods.
 */
export abstract class BasePage {
    protected page: Page;

    constructor(page: Page) {
        this.page = page;
    }

    // ==========================================
    // LIFECYCLE (abstract — every POM must implement)
    // ==========================================

    /**
     * Navigate to the page and clean up any stale data left by
     * previous failed test runs. Called once via test.beforeAll
     * in the spec file.
     */
    abstract setUp(): Promise<void>;

    /**
     * Clean up any data created during the test suite.
     * Called when needed in the spec (e.g. test.afterAll).
     */
    abstract tearDown(): Promise<void>;

    // ==========================================
    // REUSABLE HELPERS
    // ==========================================
    // Place broadly useful helper methods here so every POM
    // inherits them. If a helper is needed by more than one
    // POM, it belongs here — not in a derived page class.

    /**
     * Waits for a toast notification with the expected message
     * to appear, then verifies its text content.
     *
     * Steps:
     * 1. Waits for a toast element to become visible.
     * 2. Asserts the toast contains the expected message text.
     *
     * @param message - The expected text content of the toast
     */
    async waitForToast(message: string): Promise<void> {
        const toast = this.page.getByRole('status');
        await expect(toast).toBeVisible();
        await expect(toast).toContainText(message);
    }

    /**
     * Dismisses any open modal dialog by clicking its close button.
     *
     * Steps:
     * 1. Locates the dialog's close button.
     * 2. Clicks the close button.
     * 3. Waits for the dialog to be detached from the DOM.
     */
    async dismissModal(): Promise<void> {
        const dialog = this.page.getByRole('dialog');
        await dialog.getByRole('button', { name: /close/i }).click();
        await expect(dialog).not.toBeVisible();
    }

    /**
     * Waits for any loading indicator to disappear before proceeding.
     *
     * Steps:
     * 1. Checks if a loading spinner/indicator is present.
     * 2. If present, waits for it to be hidden.
     */
    async waitForLoadingComplete(): Promise<void> {
        const spinner = this.page.getByRole('progressbar');
        await expect(spinner).toBeHidden();
    }
}
```
