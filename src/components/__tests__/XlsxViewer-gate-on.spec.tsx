// @vitest-environment jsdom
//
// Gate tests for XlsxViewer with OFFICE_EDIT_ENABLED = true (dev mode).
//
// One file per flag state — static mock, no mutation — guarantees deterministic
// results regardless of async scheduling between describe blocks.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, waitFor } from '@testing-library/react'

vi.mock('../../lib/featureFlags', () => ({
  OFFICE_EDIT_ENABLED: true,
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

describe('XlsxViewer — OFFICE_EDIT_ENABLED=true (edit available)', () => {
  beforeEach(() => {
    setupMarvinMock()
  })

  afterEach(() => {
    cleanup()
  })

  it('renders the Edit button', async () => {
    const { container } = await renderLoaded()
    expect(btn(container, 'Edit spreadsheet')).not.toBeNull()
  })

  it('grid and sheet tabs still render', async () => {
    const { container } = await renderLoaded()
    expect(container.querySelector('table')).not.toBeNull()
    expect(container.querySelector('[role="tablist"]')).not.toBeNull()
  })
})
