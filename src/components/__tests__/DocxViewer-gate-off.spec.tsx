// @vitest-environment jsdom
//
// Gate tests for DocxViewer with OFFICE_EDIT_ENABLED = false (release mode).
//
// One file per flag state — static mock, no mutation — guarantees deterministic
// results regardless of async scheduling between describe blocks.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { btn, renderViewerLoaded, setupDocxMock } from './office-viewer-test-helpers'

vi.mock('../../lib/featureFlags', () => ({
  OFFICE_EDIT_ENABLED: false,
  CHAT_UI_ENABLED: false,
}))

vi.mock('../Icon', () => ({
  Icon: ({ name }: { name: string }) => <span data-icon={name} />,
}))

import { DocxViewer } from '../DocxViewer'

const renderLoaded = () => renderViewerLoaded(DocxViewer, '.docx-viewer-content', '/vault/doc.docx')

describe('DocxViewer — OFFICE_EDIT_ENABLED=false (read-only)', () => {
  beforeEach(() => {
    setupDocxMock()
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
