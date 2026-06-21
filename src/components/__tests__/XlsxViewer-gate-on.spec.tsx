// @vitest-environment jsdom
//
// Gate tests for XlsxViewer with OFFICE_EDIT_ENABLED = true (dev mode).
//
// One file per flag state — static mock, no mutation — guarantees deterministic
// results regardless of async scheduling between describe blocks.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { btn, renderViewerLoaded, setupXlsxMock } from './office-viewer-test-helpers'

vi.mock('../../lib/featureFlags', () => ({
  OFFICE_EDIT_ENABLED: true,
  CHAT_UI_ENABLED: false,
}))

vi.mock('../Icon', () => ({
  Icon: ({ name }: { name: string }) => <span data-icon={name} />,
}))

import { XlsxViewer } from '../XlsxViewer'

const renderLoaded = () =>
  renderViewerLoaded(XlsxViewer, '.xlsx-viewer-content', '/vault/data.xlsx')

describe('XlsxViewer — OFFICE_EDIT_ENABLED=true (edit available)', () => {
  beforeEach(() => {
    setupXlsxMock()
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
