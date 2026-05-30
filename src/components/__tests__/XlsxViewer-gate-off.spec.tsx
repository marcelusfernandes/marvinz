// @vitest-environment jsdom
//
// Gate tests for XlsxViewer with OFFICE_EDIT_ENABLED = false (release mode).
//
// One file per flag state — static mock, no mutation — guarantees deterministic
// results regardless of async scheduling between describe blocks.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, waitFor } from '@testing-library/react'

vi.mock('../../lib/featureFlags', () => ({
  OFFICE_EDIT_ENABLED: false,
  CHAT_UI_ENABLED: false,
}))

vi.mock('../Icon', () => ({
  Icon: ({ name }: { name: string }) => <span data-icon={name} />,
}))

// ---------------------------------------------------------------------------
// window.marvin stub
// ---------------------------------------------------------------------------

function setupMarvinMock() {
  Object.assign(window, {
    marvin: {
      office: {
        readXlsx: vi.fn().mockResolvedValue({
          rows: [
            ['Name', 'Score'],
            ['Alice', '95'],
          ],
          sheetNames: ['Sheet1', 'Summary'],
        }),
        writeXlsx: vi.fn().mockResolvedValue(undefined),
      },
    },
  })
}

import { XlsxViewer } from '../XlsxViewer'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function btn(container: HTMLElement, title: string) {
  return container.querySelector<HTMLButtonElement>(`button[title="${title}"]`)
}

async function renderLoaded(path = '/vault/data.xlsx') {
  const result = render(<XlsxViewer path={path} />)
  await waitFor(() =>
    expect(result.container.querySelector('.xlsx-viewer-content')).not.toBeNull(),
  )
  return result
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('XlsxViewer — OFFICE_EDIT_ENABLED=false (read-only)', () => {
  beforeEach(() => {
    setupMarvinMock()
  })

  afterEach(() => {
    cleanup()
  })

  it('does not render the Edit button', async () => {
    const { container } = await renderLoaded()
    expect(btn(container, 'Edit spreadsheet')).toBeNull()
  })

  it('does not render Save or Discard buttons', async () => {
    const { container } = await renderLoaded()
    expect(btn(container, 'Save changes to .xlsx')).toBeNull()
    expect(btn(container, 'Discard changes')).toBeNull()
  })

  it('cells are not editable inputs — read-only spans only', async () => {
    const { container } = await renderLoaded()
    expect(container.querySelectorAll('.xlsx-viewer-cell-input').length).toBe(0)
    expect(container.querySelector('.xlsx-viewer-cell-value')).not.toBeNull()
  })

  it('grid table renders with data rows', async () => {
    const { container } = await renderLoaded()
    expect(container.querySelector('table')).not.toBeNull()
    expect(container.querySelectorAll('tbody tr').length).toBe(1)
  })

  it('sheet tabs still render', async () => {
    const { container } = await renderLoaded()
    const tablist = container.querySelector('[role="tablist"]')
    expect(tablist).not.toBeNull()
    expect(tablist!.querySelectorAll('[role="tab"]').length).toBe(2)
  })

  it('edit mode class is not applied to the grid host', async () => {
    const { container } = await renderLoaded()
    expect(container.querySelector('.xlsx-viewer-edit')).toBeNull()
  })
})
