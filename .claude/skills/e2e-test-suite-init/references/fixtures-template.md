# Fixtures Template

```typescript
import { test as base } from '@playwright/test';

// ──────────────────────────────────────────────
// Test Data Interfaces — add one per feature
// ──────────────────────────────────────────────

// Example:
// interface VaultItem {
//     name: string;
//     key: string;
//     value: string;
// }
//
// interface VaultTestData {
//     items: VaultItem[];
//     updatedItem: { name: string; value: string };
// }

interface FeatureTestData {
    // Register each feature's test data type here:
    // vault: VaultTestData;
}

// ──────────────────────────────────────────────
// stampUnique — collision-free parallel data
// ──────────────────────────────────────────────

/**
 * Recursively appends a unique suffix (timestamp + random ID) to every
 * string value in the given data structure. This guarantees parallel
 * workers never collide on test data.
 *
 * Example: "keyA" → "keyA-1711234567890-a1b2c3"
 */
function stampUnique(data: unknown): unknown {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    if (typeof data === 'string') return `${data}-${suffix}`;
    if (Array.isArray(data)) return data.map(stampUnique);
    if (typeof data === 'object' && data !== null) {
        return Object.fromEntries(
            Object.entries(data).map(([k, v]) => [k, stampUnique(v)])
        );
    }
    return data;
}

// ──────────────────────────────────────────────
// Custom test fixture
// ──────────────────────────────────────────────

export const test = base.extend<{ testData: FeatureTestData }>({
    testData: async ({}, use) => {
        const raw: FeatureTestData = {
            // Load each feature's JSON here:
            // vault: require('../test-data/vault.json'),
        };
        await use(stampUnique(raw) as FeatureTestData);
    },
});

export { expect } from '@playwright/test';
```

## Adding a New Feature

1. Create `e2e/test-data/{feature}.json` with template data
2. Add a TypeScript interface above for the data shape
3. Add the feature key to the `FeatureTestData` interface
4. Load it in the `testData` fixture alongside existing features
