// @vitest-environment jsdom
//
// Isolated smoke coverage for AppEditorArea (issue #585, region-component
// extraction from App.tsx's render tree). The behavior that matters here — the
// note-tab Editor stack staying mounted across tab switches so CodeMirror undo
// history survives (#440) — is already verified through-the-tree by
// editor-undo-tab-switch.spec, which mounts the real <App/> (now rendering
// AppEditorArea) and drives a switch. This file is the light render check the
// AC asks for: the region wires up the tab bar, the note stack, the viewer
// variant switch, and the empty state.

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { NoteTab, ImageTab } from '../../lib/tabs'

vi.mock('../TabBar', () => ({ TabBar: () => <div data-testid="tab-bar-stub" /> }))
vi.mock('../Editor', () => ({ Editor: () => <div data-testid="editor-stub" /> }))
vi.mock('../ExternalChangeBanner', () => ({ ExternalChangeBanner: () => <div /> }))
vi.mock('../ImageViewer', () => ({ ImageViewer: () => <div data-testid="image-viewer-stub" /> }))
vi.mock('../PdfViewer', () => ({ PdfViewer: () => <div /> }))
vi.mock('../DocxViewer', () => ({ DocxViewer: () => <div /> }))
vi.mock('../XlsxViewer', () => ({ XlsxViewer: () => <div /> }))
vi.mock('../EmptyTab', () => ({ EmptyTab: () => <div data-testid="empty-tab-stub" /> }))
vi.mock('../BrowserPane', () => ({ BrowserPane: () => <div data-testid="browser-pane-stub" /> }))

import { AppEditorArea } from '../AppEditorArea'

function noop() {}

function baseProps(overrides: Partial<React.ComponentProps<typeof AppEditorArea>> = {}) {
  return {
    vaultPath: '/vault',
    tabs: [],
    activeTabId: null,
    activeTab: null,
    isDirty: false,
    mountedNoteTabs: [],
    onActivate: noop,
    onCloseTab: noop,
    onNewTab: noop,
    bufferContentRef: { current: new Map<string, string>() },
    onAcceptDisk: noop,
    onKeepMine: noop,
    clearPendingExternalChange: noop,
    getBufferSeed: undefined,
    layoutMode: 'editor-center',
    sidebarWidth: 240,
    agentsWidth: 320,
    paletteItemsWithMeta: [],
    onSave: async () => {},
    onBufferChange: noop,
    onNavigate: noop,
    onBack: noop,
    onForward: noop,
    openFindTick: 0,
    openReplaceTick: 0,
    onImportToast: noop,
    saveMode: 'auto' as const,
    onDirtyChange: noop,
    flushSaveRef: { current: null },
    onRegisterHandle: noop,
    focusedAgent: null,
    onSendSelection: noop,
    onConvertEmptyToBrowser: noop,
    onCreateNoteFromEmpty: noop,
    onChooseFileFromEmpty: noop,
    onBrowserUrlBarChange: noop,
    onBrowserNavigate: noop,
    onBrowserReady: noop,
    urlBarFocusTick: 0,
    ...overrides,
  }
}

const noteTab: NoteTab = {
  type: 'note',
  id: 'n1',
  path: '/vault/note.md',
  content: 'hello',
  version: 0,
  back: [],
  forward: [],
}

const imageTab: ImageTab = { type: 'image', id: 'i1', path: '/vault/pic.png' }

describe('AppEditorArea — smoke (#585)', () => {
  it('renders the tab bar and the empty-editor message when nothing is open', () => {
    render(<AppEditorArea {...baseProps()} />)

    expect(screen.getByTestId('tab-bar-stub')).toBeInTheDocument()
    expect(screen.getByText('Select a note or create a new one.')).toBeInTheDocument()
  })

  it('renders a mounted note tab as an Editor inside a keyed note-tab-container', () => {
    const { container } = render(
      <AppEditorArea
        {...baseProps({
          tabs: [noteTab],
          activeTabId: 'n1',
          activeTab: noteTab,
          mountedNoteTabs: [noteTab],
        })}
      />
    )

    expect(screen.getByTestId('editor-stub')).toBeInTheDocument()
    expect(container.querySelector('.note-tab-container[data-tab-id="n1"]')).not.toBeNull()
  })

  it('renders the ImageViewer for an active image tab', () => {
    render(
      <AppEditorArea {...baseProps({ tabs: [imageTab], activeTabId: 'i1', activeTab: imageTab })} />
    )

    expect(screen.getByTestId('image-viewer-stub')).toBeInTheDocument()
  })
})
