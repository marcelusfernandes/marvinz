// @vitest-environment jsdom
//
// Isolated coverage for AppSidebar (issue #585, region-component extraction
// from App.tsx's render tree). AppSidebar is mostly a prop-forwarding shell
// around FileTree/FileTreeToolbar — already covered thoroughly through the
// App-level specs (App-tab-lifecycle, App-navigation-*, etc., which mount
// AppSidebar as part of the full tree) and FileTree's own extensive isolated
// specs. The one piece of logic AppSidebar itself owns is the
// visualStyle 'legacy' vs modern branch in its header/footer — and no
// existing test anywhere in the suite exercises the 'legacy' branch (every
// App-level spec mocks useVisualStyle to 'modern'). That's the actual gap
// this file closes; the rest is a light smoke check, not a re-test of
// FileTree or the App-level behavior net.

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('../FileTree', () => ({
  FileTree: () => <div data-testid="file-tree-stub" />,
}))
vi.mock('../FileTreeToolbar', () => ({
  FileTreeToolbar: () => <div data-testid="file-tree-toolbar-stub" />,
}))
vi.mock('../Icon', () => ({
  Icon: ({ name }: { name: string }) => <span data-testid={`icon-${name}`} />,
}))

import { AppSidebar } from '../AppSidebar'

function noop() {}

function baseProps(overrides: Partial<React.ComponentProps<typeof AppSidebar>> = {}) {
  return {
    visualStyle: 'modern' as const,
    vaultPath: '/vault/my-notes',
    tree: [],
    selectedPaths: new Set<string>(),
    activeFilePath: null,
    openPaths: new Set<string>(),
    creatingIn: null,
    isAnyOpen: false,
    onNewFile: noop,
    onNewFolder: noop,
    onToggleAll: noop,
    onSidebarContextMenu: noop,
    onSidebarPaste: noop,
    onToggleOpen: noop,
    onSelect: noop,
    onClearSelection: noop,
    onCreatingInChange: noop,
    onNodeContextMenu: noop,
    onMove: noop,
    onImportResult: noop,
    onPickVault: noop,
    onOpenSettings: noop,
    ...overrides,
  }
}

describe('AppSidebar — smoke + visualStyle branch (#585)', () => {
  it('renders the FileTree/FileTreeToolbar shell and derives the vault name from vaultPath', () => {
    render(<AppSidebar {...baseProps()} />)

    expect(screen.getByTestId('file-tree-stub')).toBeInTheDocument()
    expect(screen.getByTestId('file-tree-toolbar-stub')).toBeInTheDocument()
    expect(screen.getByText('my-notes')).toBeInTheDocument()
  })

  it('modern visualStyle: footer shows separate Switch Folder and Settings buttons', () => {
    render(<AppSidebar {...baseProps({ visualStyle: 'modern' })} />)

    expect(screen.getByText('Switch Folder')).toBeInTheDocument()
    expect(screen.getByText('Settings')).toBeInTheDocument()
    expect(screen.queryByText('Switch folder')).toBeNull()
  })

  it('legacy visualStyle: header is a plain vault-name span, footer is a single "Switch folder" text button', () => {
    render(<AppSidebar {...baseProps({ visualStyle: 'legacy' })} />)

    expect(screen.getByText('my-notes').className).toBe('vault-name')
    expect(screen.getByText('Switch folder')).toBeInTheDocument()
    expect(screen.queryByText('Switch Folder')).toBeNull()
    expect(screen.queryByText('Settings')).toBeNull()
  })

  it('legacy visualStyle: clicking "Switch folder" calls onPickVault (no separate settings button to wire)', () => {
    const onPickVault = vi.fn()
    render(<AppSidebar {...baseProps({ visualStyle: 'legacy', onPickVault })} />)

    screen.getByText('Switch folder').click()

    expect(onPickVault).toHaveBeenCalledTimes(1)
  })
})
