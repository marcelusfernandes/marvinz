# Test Data Template

## JSON File: `e2e/test-data/{feature}.json`

```json
{
    "items": [
        {
            "name": "ItemA",
            "key": "keyA",
            "value": "some-value"
        },
        {
            "name": "ItemB",
            "key": "keyB",
            "value": "other-value"
        }
    ],
    "updatedItem": {
        "name": "UpdatedItem",
        "value": "new-value"
    }
}
```

## Guidelines

### Data Shape

- Design the JSON structure to match what your POM methods expect as parameters
- Include enough items for tests that need distinct data (e.g., one for create, one for delete)
- Include an `updatedItem` object for edit/update tests
- Add any additional shapes your specific feature needs

### Unique Suffixes

The test fixture automatically appends a unique suffix (timestamp + random ID) to every string value in the JSON. This means:

- `"ItemA"` becomes `"ItemA-1711234567890-a1b2c3"` at runtime
- Tests running in parallel never collide
- You write clean template data; uniqueness is handled automatically

### TypeScript Interface

Add a corresponding interface in your fixtures file:

```typescript
interface {Feature}TestData {
    items: Array<{
        name: string;
        key: string;
        value: string;
    }>;
    updatedItem: {
        name: string;
        value: string;
    };
}
```

### Registration

Register the new feature in the fixtures' `FeatureTestData` interface and loader:

```typescript
interface FeatureTestData {
    // ... existing features
    {feature}: {Feature}TestData;
}
```

## Rules

- **Never hardcode test data in spec or POM files** — always use external JSON
- **Feature name must match** across JSON file, POM file, and spec file
- **All string values get stamped** — don't worry about uniqueness in the JSON itself
- **Keep data minimal** — only include what the tests actually use
