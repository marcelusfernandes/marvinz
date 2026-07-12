// @vitest-environment jsdom
//
// Isolated coverage for AppPanels (issue #585, region-component extraction
// from App.tsx's render tree). AppPanels is a prop-forwarding shell around the
// AgentsPane and the overlay stack (dialog, error toast, command palette,
// settings, snapshot panel/toasts, import toast) — already exercised through
// the App-level specs that mount the full tree. The one piece of logic
// AppPanels itself owns is the `dialogConfig` derivation (rename-folder vs
// rename-file title from `dialog.isDir`), so that branch gets explicit
// coverage here; the rest is a light smoke check of conditional rendering.

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('../AgentsPane', () => ({
  AgentsPane: () => <div data-testid="agents-pane-stub" />,
}))
vi.mock('../InputDialog', () => ({
  InputDialog: ({ title }: { title: string }) => <div data-testid="input-dialog">{title}</div>,
}))
vi.mock('../CommandPalette', () => ({
  CommandPalette: () => <div data-testid="command-palette-stub" />,
}))
vi.mock('../SettingsModal', () => ({
  SettingsModal: () => <div data-testid="settings-modal-stub" />,
}))
vi.mock('../SnapshotPanel', () => ({
  SnapshotPanel: () => <div data-testid="snapshot-panel-stub" />,
}))
vi.mock('../SnapshotToast', () => ({
  SnapshotToast: ({ files }: { files: string[] }) => (
    <div data-testid="snapshot-toast">{files.join(',')}</div>
  ),
}))
vi.mock('../ImportToast', () => ({
  ImportToast: () => <div data-testid="import-toast-stub" />,
}))

import { AppPanels } from '../AppPanels'

function noop() {}

function baseProps(overrides: Partial<React.ComponentProps<typeof AppPanels>> = {}) {
  return {
    vaultPath: '/vault',
    agents: [],
    newAgentTabTick: 0,
    onRewind: noop,
    onOpenFile: noop,
    onFocusChange: noop,
    setTurnToast: noop,
    dialog: null,
    onCreate: noop,
    setDialog: noop,
    error: null,
    setError: noop,
    paletteOpen: false,
    paletteItemsBase: [],
    onPalettePick: noop,
    setPaletteOpen: noop,
    settingsOpen: false,
    layoutMode: 'editor-center' as const,
    onLayoutChange: noop,
    setSettingsOpen: noop,
    snapshotPanel: null,
    setSnapshotPanel: noop,
    onSnapshotRestored: noop,
    turnToast: null,
    openSnapshotPanel: noop,
    externalToast: null,
    setExternalToast: noop,
    importToast: null,
    setImportToast: noop,
    ...overrides,
  }
}

describe('AppPanels — smoke + dialogConfig branch (#585)', () => {
  it('renders the AgentsPane and no overlays when all overlay state is empty', () => {
    render(<AppPanels {...baseProps()} />)

    expect(screen.getByTestId('agents-pane-stub')).toBeInTheDocument()
    expect(screen.queryByTestId('input-dialog')).toBeNull()
    expect(screen.queryByTestId('command-palette-stub')).toBeNull()
    expect(screen.queryByTestId('settings-modal-stub')).toBeNull()
  })

  it('shows each overlay only when its backing state is present', () => {
    render(<AppPanels {...baseProps({ paletteOpen: true, settingsOpen: true, error: 'boom' })} />)

    expect(screen.getByTestId('command-palette-stub')).toBeInTheDocument()
    expect(screen.getByTestId('settings-modal-stub')).toBeInTheDocument()
    expect(screen.getByText('boom')).toBeInTheDocument()
  })

  it('dialogConfig: a directory rename dialog gets the "Rename folder" title', () => {
    render(
      <AppPanels
        {...baseProps({ dialog: { kind: 'rename', target: '/vault/docs', isDir: true } })}
      />
    )

    expect(screen.getByTestId('input-dialog')).toHaveTextContent('Rename folder')
  })

  it('dialogConfig: a file rename dialog gets the "Rename file" title', () => {
    render(
      <AppPanels
        {...baseProps({ dialog: { kind: 'rename', target: '/vault/note.md', isDir: false } })}
      />
    )

    expect(screen.getByTestId('input-dialog')).toHaveTextContent('Rename file')
  })

  it('externalToast: renders the vault-relative path when the file is inside the vault', () => {
    render(
      <AppPanels
        {...baseProps({
          externalToast: { filePath: '/vault/sub/note.md', source: 'external' },
        })}
      />
    )

    expect(screen.getByTestId('snapshot-toast')).toHaveTextContent('sub/note.md')
  })
})
