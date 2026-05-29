// @vitest-environment jsdom

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const LS_PREFIX = 'marvin:settings:'

beforeEach(() => {
  window.localStorage.clear()
  vi.resetModules()
  Object.assign(window, {
    marvin: { settings: { set: vi.fn().mockResolvedValue({}) } },
  })
})

async function renderModal() {
  const { SettingsModal } = await import('../SettingsModal')
  render(
    <SettingsModal
      onClose={() => {}}
      layoutMode="editor-center"
      onLayoutChange={() => {}}
    />,
  )
}

function rowFor(labelText: string): HTMLElement {
  const label = screen.getByText(labelText)
  return label.closest('.modal-section-row') as HTMLElement
}

describe('SettingsModal — editor effects toggles', () => {
  it('master defaults on and flips to off via setSetting', async () => {
    await renderModal()
    const toggle = rowFor('Smooth editor').querySelector(
      '[role="switch"]',
    ) as HTMLElement
    expect(toggle).toHaveAttribute('aria-checked', 'true')

    fireEvent.click(toggle)

    expect(window.marvin.settings.set).toHaveBeenCalledWith({
      editorEffectsMaster: false,
    })
  })

  it('caret slide defaults on and flips to off via setSetting', async () => {
    await renderModal()
    const toggle = rowFor('Caret slide').querySelector(
      '[role="switch"]',
    ) as HTMLElement
    expect(toggle).toHaveAttribute('aria-checked', 'true')

    fireEvent.click(toggle)

    expect(window.marvin.settings.set).toHaveBeenCalledWith({
      editorEffectCaretSlide: false,
    })
  })

  it('disables the caret slide row when master is off, value preserved', async () => {
    window.localStorage.setItem(`${LS_PREFIX}editorEffectsMaster`, 'false')
    await renderModal()
    const row = rowFor('Caret slide')
    const toggle = row.querySelector('[role="switch"]') as HTMLButtonElement
    expect(row).toHaveClass('is-disabled')
    expect(toggle).toBeDisabled()
    expect(toggle).toHaveAttribute('aria-checked', 'true')
  })
})
