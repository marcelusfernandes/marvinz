// @vitest-environment jsdom
//
// TabBar drag-source behavior (issue #367): tabs that wrap a vault file
// expose their path via application/x-marvin-path on dragstart so the
// agent panes accept the active tab as a drag source. Empty + browser
// tabs have no path to share and aren't draggable.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render } from '@testing-library/react'

vi.mock('../Icon', () => ({
  Icon: ({ name }: { name: string }) => <span data-testid={`icon-${name}`} />,
}))

vi.mock('../../lib/fileIcons', () => ({
  fileIconFor: () => 'file',
}))

function setupMarvinMock() {
  Object.assign(window, {
    marvin: {
      app: {
        showContextMenu: vi.fn().mockResolvedValue(null),
        canPaste: vi.fn().mockResolvedValue(false),
      },
      shell: {
        reveal: vi.fn().mockResolvedValue(undefined),
        openExternal: vi.fn(),
      },
    },
  })
}

import { TabBar } from '../TabBar'

const MIME = 'application/x-marvin-path'

const noteTab = { type: 'note' as const, id: 'n1', path: '/vault/note.md' }
const imageTab = { type: 'image' as const, id: 'i1', path: '/vault/img.png' }
const pdfTab = { type: 'pdf' as const, id: 'p1', path: '/vault/doc.pdf' }
const docxTab = { type: 'docx' as const, id: 'd1', path: '/vault/word.docx' }
const xlsxTab = { type: 'xlsx' as const, id: 'x1', path: '/vault/sheet.xlsx' }
const emptyTab = { type: 'empty' as const, id: 'e1', title: 'New tab' }
const browserTab = {
  type: 'browser' as const,
  id: 'b1',
  url: 'https://example.com',
  title: 'Example',
  loading: false,
}

// Dispatch a dragstart event on a tab DOM node with a stub DataTransfer
// that captures setData / effectAllowed calls.
function fireDragStart(element: Element) {
  const data: Record<string, string> = {}
  const setData = vi.fn((key: string, value: string) => {
    data[key] = value
  })
  const dt = {
    data,
    effectAllowed: 'none',
    setData,
    getData: (k: string) => data[k] ?? '',
    types: [] as string[],
    setDragImage: vi.fn(),
  }
  const event = new Event('dragstart', { bubbles: true, cancelable: true }) as DragEvent
  Object.defineProperty(event, 'dataTransfer', { value: dt, writable: false })
  element.dispatchEvent(event)
  return { setData, dt }
}

beforeEach(() => {
  setupMarvinMock()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// File tabs expose their path
// ---------------------------------------------------------------------------

describe('TabBar — file tabs as drag source', () => {
  const fileCases = [
    { name: 'note', tab: noteTab },
    { name: 'image', tab: imageTab },
    { name: 'pdf', tab: pdfTab },
    { name: 'docx', tab: docxTab },
    { name: 'xlsx', tab: xlsxTab },
  ]

  for (const { name, tab } of fileCases) {
    it(`${name} tab is draggable and emits MARVIN_PATH_MIME with the path`, () => {
      const { container } = render(
        <TabBar
          tabs={[tab]}
          activeId={tab.id}
          onActivate={vi.fn()}
          onClose={vi.fn()}
          onNewTab={vi.fn()}
        />
      )
      const tabEl = container.querySelector('.tab')!
      expect(tabEl.getAttribute('draggable')).toBe('true')

      const { setData } = fireDragStart(tabEl)
      expect(setData).toHaveBeenCalledWith(MIME, tab.path)
      expect(setData).toHaveBeenCalledWith('text/plain', tab.path)
    })
  }

  it('effectAllowed is set to "copy" so agent panes can accept the drag', () => {
    const { container } = render(
      <TabBar
        tabs={[noteTab]}
        activeId="n1"
        onActivate={vi.fn()}
        onClose={vi.fn()}
        onNewTab={vi.fn()}
      />
    )
    const { dt } = fireDragStart(container.querySelector('.tab')!)
    expect(dt.effectAllowed).toBe('copy')
  })
})

// ---------------------------------------------------------------------------
// Empty + browser tabs are not drag sources
// ---------------------------------------------------------------------------

describe('TabBar — non-file tabs are not drag sources', () => {
  it('empty tab is not draggable', () => {
    const { container } = render(
      <TabBar
        tabs={[emptyTab]}
        activeId="e1"
        onActivate={vi.fn()}
        onClose={vi.fn()}
        onNewTab={vi.fn()}
      />
    )
    const tabEl = container.querySelector('.tab')!
    // draggable={false} renders as the attribute absent or "false"
    expect(tabEl.getAttribute('draggable')).not.toBe('true')
  })

  it('browser tab is not draggable', () => {
    const { container } = render(
      <TabBar
        tabs={[browserTab]}
        activeId="b1"
        onActivate={vi.fn()}
        onClose={vi.fn()}
        onNewTab={vi.fn()}
      />
    )
    const tabEl = container.querySelector('.tab')!
    expect(tabEl.getAttribute('draggable')).not.toBe('true')
  })

  it('empty tab dragstart does NOT emit MARVIN_PATH_MIME', () => {
    const { container } = render(
      <TabBar
        tabs={[emptyTab]}
        activeId="e1"
        onActivate={vi.fn()}
        onClose={vi.fn()}
        onNewTab={vi.fn()}
      />
    )
    const { setData } = fireDragStart(container.querySelector('.tab')!)
    expect(setData).not.toHaveBeenCalledWith(MIME, expect.anything())
  })
})

// ---------------------------------------------------------------------------
// Mixed bar — only file tabs become drag sources
// ---------------------------------------------------------------------------

describe('TabBar — mixed bar', () => {
  it('with [empty, note, browser] only the note tab is draggable', () => {
    const { container } = render(
      <TabBar
        tabs={[emptyTab, noteTab, browserTab]}
        activeId="n1"
        onActivate={vi.fn()}
        onClose={vi.fn()}
        onNewTab={vi.fn()}
      />
    )
    const draggables = container.querySelectorAll('.tab[draggable="true"]')
    expect(draggables.length).toBe(1)
  })
})
