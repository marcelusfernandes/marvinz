# Spec File Template

Copy and adapt this template when creating a new regression or smoke test.

```typescript
import { test } from '../../fixtures/base';
import { getAuthFilePath } from '../../helpers/env-config';
import { {Feature}Page } from '../../poms/{feature}.page';

const authFile = getAuthFilePath();

test.describe('{Feature Name} Tests', () => {
    // One-time setup: clean stale data from previous failed runs
    test.beforeAll(async ({ browser }) => {
        const context = await browser.newContext({
            storageState: authFile,
        });
        const page = await context.newPage();
        const pom = new {Feature}Page(page);
        await pom.setUp();
        await page.close();
        await context.close();
    });

    // Optional: clean up data created during the suite
    // test.afterAll(async ({ browser }) => {
    //     const context = await browser.newContext({
    //         storageState: authFile,
    //     });
    //     const page = await context.newPage();
    //     const pom = new {Feature}Page(page);
    //     await pom.tearDown();
    //     await page.close();
    //     await context.close();
    // });

    test('should display the {feature} page', async ({ page }) => {
        const pom = new {Feature}Page(page);
        await pom.navigateToPage();
        // Add verification assertions via POM methods
    });

    test('should create a new {item}', async ({ page, testData }) => {
        const pom = new {Feature}Page(page);
        const item = testData.{feature}.items[0];

        await pom.navigateToPage();
        await pom.create{Item}(item.name, item.value);
        await pom.verify{Item}Exists(item.name);
    });

    test('should edit an existing {item}', async ({ page, testData }) => {
        const pom = new {Feature}Page(page);
        const item = testData.{feature}.items[0];
        const updated = testData.{feature}.updatedItem;

        await pom.navigateToPage();
        // Create the item first (test independence)
        await pom.create{Item}(item.name, item.value);
        await pom.edit{Item}(item.name, updated.name, updated.value);
        await pom.verify{Item}Exists(updated.name);
    });

    test('should delete an {item}', async ({ page, testData }) => {
        const pom = new {Feature}Page(page);
        const item = testData.{feature}.items[1];

        await pom.navigateToPage();
        // Create the item first (test independence)
        await pom.create{Item}(item.name, item.value);
        await pom.delete{Item}(item.name);
        await pom.verify{Item}NotExists(item.name);
    });
});
```

## Placeholders

Replace these placeholders when using the template:

| Placeholder | Example |
| ----------- | ------- |
| `{Feature}` | `Vault` (PascalCase) |
| `{feature}` | `vault` (lowercase) |
| `{Feature Name}` | `Vault Management` (human-readable) |
| `{Item}` | `Secret` (PascalCase, the entity being tested) |
| `{item}` | `secret` (lowercase) |
