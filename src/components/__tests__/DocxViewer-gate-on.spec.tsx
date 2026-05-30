// @vitest-environment jsdom
//
// Gate tests for DocxViewer with OFFICE_EDIT_ENABLED = true (dev mode).
//
// One file per flag state — static mock, no mutation — guarantees deterministic
// results regardless of async scheduling between describe blocks.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { btn, renderViewerLoaded, setupDocxMock } from './office-viewer-test-helpers'

vi.mock('../../lib/featureFlags', () => ({
  OFFICE_EDIT_ENABLED: true,
  CHAT_UI_ENABLED: false,
}))

vi.mock('../Icon', () => ({
  Icon: ({ name }: { name: string }) => <span data-icon={name} />,
}))

import { DocxViewer } from '../DocxViewer'

const renderLoaded = () => renderViewerLoaded(DocxViewer, '.docx-viewer-content', '/vault/doc.docx')

describe('DocxViewer — OFFICE_EDIT_ENABLED=true (edit available)', () => {
  beforeEach(() => {
    setupDocxMock()
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
