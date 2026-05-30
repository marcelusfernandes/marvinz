// @vitest-environment jsdom
//
// Gate tests for DocxViewer with OFFICE_EDIT_ENABLED = false (release mode).
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

describe('DocxViewer — OFFICE_EDIT_ENABLED=false (read-only)', () => {
  beforeEach(() => {
    setupMarvinMock()
  })

  afterEach(() => {
    cleanup()
  })

  it('does not render the Edit button', async () => {
    const { container } = await renderLoaded()
    expect(btn(container, 'Edit document text')).toBeNull()
  })

  it('does not render Save or Cancel buttons', async () => {
    const { container } = await renderLoaded()
    expect(btn(container, 'Save changes to .docx')).toBeNull()
    expect(btn(container, 'Discard changes')).toBeNull()
  })

  it('no textarea is rendered — read-only HTML preview only', async () => {
    const { container } = await renderLoaded()
    expect(container.querySelector('textarea')).toBeNull()
  })

  it('preview HTML content renders', async () => {
    const { container } = await renderLoaded()
    expect(container.querySelector('.docx-viewer-content')).not.toBeNull()
    expect(container.querySelector('.docx-viewer-content')!.textContent).toContain('Hello World')
  })

  it('dirty indicator is not shown', async () => {
    const { container } = await renderLoaded()
    expect(container.querySelector('.docx-viewer-dirty')).toBeNull()
  })
})
