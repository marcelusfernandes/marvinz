// @vitest-environment jsdom
//
// Gate tests for DocxViewer with OFFICE_EDIT_ENABLED = true (dev mode).
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
        readDocx: vi.fn().mockResolvedValue({
          html: '<p>Hello World</p>',
          messages: [],
        }),
        writeDocx: vi.fn().mockResolvedValue(undefined),
      },
    },
  })
}

import { DocxViewer } from '../DocxViewer'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function btn(container: HTMLElement, title: string) {
  return container.querySelector<HTMLButtonElement>(`button[title="${title}"]`)
}

async function renderLoaded(path = '/vault/doc.docx') {
  const result = render(<DocxViewer path={path} />)
  await waitFor(() =>
    expect(result.container.querySelector('.docx-viewer-content')).not.toBeNull(),
  )
  return result
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DocxViewer — OFFICE_EDIT_ENABLED=true (edit available)', () => {
  beforeEach(() => {
    setupMarvinMock()
  })

  afterEach(() => {
    cleanup()
  })

  it('renders the Edit button', async () => {
    const { container } = await renderLoaded()
    expect(btn(container, 'Edit document text')).not.toBeNull()
  })

  it('preview HTML content still renders', async () => {
    const { container } = await renderLoaded()
    expect(container.querySelector('.docx-viewer-content')).not.toBeNull()
    expect(container.querySelector('.docx-viewer-content')!.textContent).toContain('Hello World')
  })
})
