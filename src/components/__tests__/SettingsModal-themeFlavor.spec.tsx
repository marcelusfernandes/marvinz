// @vitest-environment jsdom

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import { SettingsModal } from '../SettingsModal'
import { seedFromMain } from '../../lib/settingsStore'

function renderModal() {
  return render(
    <SettingsModal onClose={vi.fn()} layoutMode="editor-center" onLayoutChange={vi.fn()} />,
  )
}

describe('SettingsModal — Color flavor control', () => {
  beforeEach(() => {
    Object.assign(window, {
      marvin: { settings: { set: vi.fn().mockResolvedValue(undefined) } },
    })
    window.localStorage.clear()
    // Reset the store back to the default flavor between tests.
    seedFromMain({ themeFlavor: 'default' })
  })

  it('renders Default and Pastel radios with Default checked by default', () => {
    seedFromMain({ themeFlavor: 'default' })
    renderModal()
    const group = screen.getByRole('radiogroup', { name: 'Color flavor' })
    expect(within(group).getByRole('radio', { name: 'Default' })).toBeChecked()
    expect(within(group).getByRole('radio', { name: 'Pastel' })).not.toBeChecked()
  })

  it('reflects aria-checked when themeFlavor is pastel', () => {
    seedFromMain({ themeFlavor: 'pastel' })
    renderModal()
    const group = screen.getByRole('radiogroup', { name: 'Color flavor' })
    expect(within(group).getByRole('radio', { name: 'Pastel' })).toBeChecked()
    expect(within(group).getByRole('radio', { name: 'Default' })).not.toBeChecked()
  })

  it('persists the flavor through the settings IPC on click', () => {
    seedFromMain({ themeFlavor: 'default' })
    renderModal()
    const group = screen.getByRole('radiogroup', { name: 'Color flavor' })
    fireEvent.click(within(group).getByRole('radio', { name: 'Pastel' }))
    expect(window.marvin.settings.set).toHaveBeenCalledWith({ themeFlavor: 'pastel' })
  })
})
