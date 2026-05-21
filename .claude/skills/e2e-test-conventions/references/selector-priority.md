# Selector Priority Reference

## Priority Order with Examples

### 1. `getByRole()` — First Choice

Most resilient selector. Use for buttons, headings, dialogs, links, and other ARIA-role elements.

```typescript
// Buttons
page.getByRole('button', { name: 'Submit' });
page.getByRole('button', { name: /create new/i });

// Headings
page.getByRole('heading', { name: 'Dashboard' });

// Dialogs
page.getByRole('dialog');

// Links
page.getByRole('link', { name: 'Settings' });

// Rows in a table
page.getByRole('row', { name: /john@example.com/i });

// Tabs
page.getByRole('tab', { name: 'General' });
```

### 2. `getByLabel()` — Form Fields

Best for inputs, selects, and textareas that have associated labels.

```typescript
page.getByLabel('Email address');
page.getByLabel('Password');
page.getByLabel(/expiry date/i);
```

### 3. `getByText()` — Visible Text

Use when the element doesn't have a meaningful role or label.

```typescript
page.getByText('No items found');
page.getByText(/successfully created/i);
```

### 4. `getByPlaceholder()` — Input Placeholders

Fallback for inputs without labels.

```typescript
page.getByPlaceholder('Search...');
page.getByPlaceholder(/enter your name/i);
```

### 5. `locator()` with CSS / `filter()` — Last Resort

Only use when role-based selectors are not feasible.

```typescript
// CSS selector
page.locator('[data-testid="item-card"]');

// Filtering by child content
page.locator('.card').filter({ hasText: 'Premium Plan' });

// Chaining locators
page.locator('table tbody tr').filter({ hasText: itemName }).getByRole('button', { name: 'Delete' });
```

## Common Patterns

### Icon Buttons (No Visible Text)

```typescript
// Prefer aria-label
page.getByRole('button', { name: 'Close' }); // if aria-label="Close" is set

// Filter by child icon content
page.locator('button').filter({ has: page.locator('.icon-trash') });
```

### Dynamically Rendered Elements

Tooltips, popovers, and dropdowns may not be in the DOM initially:

```typescript
// Wait for the element to appear
await page.getByRole('tooltip').waitFor();

// Or use filter on a parent that IS in the DOM
page.locator('.dropdown-menu').filter({ hasText: 'Delete' });
```

### Table Row Actions

```typescript
// Find a row by content, then find the action button within it
const row = page.getByRole('row', { name: /john@example.com/i });
await row.getByRole('button', { name: 'Edit' }).click();
```
