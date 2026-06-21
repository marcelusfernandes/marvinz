// @vitest-environment jsdom

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

beforeEach(() => {
  window.localStorage.clear()
  vi.resetModules()
  Object.assign(window, {
    marvin: { settings: { set: vi.fn().mockResolvedValue({}) } },
  })
})

async function renderModal() {
  const { SettingsModal } = await import('../SettingsModal')
  render(<SettingsModal onClose={() => {}} layoutMode="editor-center" onLayoutChange={() => {}} />)
}

describe('SettingsModal — transparent agents pane toggle', () => {
  it('reflects off by default and flips to on via setSetting', async () => {
    await renderModal()
    const label = screen.getByText('Transparent agents pane')
    const row = label.closest('.modal-section-row') as HTMLElement
    const toggle = row.querySelector('[role="switch"]') as HTMLElement
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    expect(toggle).toHaveTextContent('Off')

    fireEvent.click(toggle)

    expect(window.marvin.settings.set).toHaveBeenCalledWith({
      agentsPaneTransparent: true,
    })
  })
})
