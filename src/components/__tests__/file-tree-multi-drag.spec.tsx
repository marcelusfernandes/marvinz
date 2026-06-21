// @vitest-environment jsdom
//
// Drag-start encoding and ghost rendering for multi-drag (issue #350).
//
// Tests cover:
//  1. Non-selected item drag → singular MIME only
//  2. Selected item with selectedPaths.size === 1 → singular MIME only
//  3. Selected item with selectedPaths.size > 1 → plural MIME JSON array, no singular MIME
//  4. Drag ghost text: "N items" when N > 1, filename when N === 1

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { FileTree } from '../FileTree'
import { smallTree } from './file-tree-fixtures'
import { setupVirtualizerMocks } from './_virtualizerSetup'

// ---------------------------------------------------------------------------
// Constants matching the implementation
// ---------------------------------------------------------------------------

const SINGULAR_MIME = 'application/x-marvin-path'
const PLURAL_MIME = 'application/x-marvin-paths'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../lib/settingsStore', () => ({
  seedFromMain: vi.fn(),
  useSetting: () => undefined,
  subscribe: vi.fn(() => () => {}),
  getSettings: vi.fn(() => ({})),
}))

vi.mock('../Icon', () => ({
  Icon: ({ name, className }: { name: string; className?: string }) => (
    <span data-testid={`icon-${name}`} className={className} />
  ),
}))

vi.mock('../MaterialIcon', () => ({
  MaterialIcon: ({ name, className }: { name: string; className?: string }) => (
    <img data-testid={`material-icon-${name}`} className={className} alt="" />
  ),
}))

function setupMarvinMock() {
  Object.assign(window, {
    marvin: {
      fs: {
        getPathForFile: vi.fn((f: File) => `/resolved/${f.name}`),
        importExternal: vi.fn().mockResolvedValue({ imported: [], skipped: [] }),
      },
    },
  })
}

// ---------------------------------------------------------------------------
// DataTransfer capture helper
// Unlike the rest of the file-tree specs, drag-start tests need to capture
// setData calls — we instrument a per-test DataTransfer spy.
// ---------------------------------------------------------------------------

type DtSpy = {
  data: Record<string, string>
  setData: ReturnType<typeof vi.fn>
  getData: (key: string) => string
  effectAllowed: string
  setDragImage: ReturnType<typeof vi.fn>
  types: string[]
}

function makeDragStartDt(): DtSpy {
  const data: Record<string, string> = {}
  const dt: DtSpy = {
    data,
    effectAllowed: '',
    setData: vi.fn((key: string, value: string) => {
      data[key] = value
    }),
    getData: (key: string) => data[key] ?? '',
    setDragImage: vi.fn(),
    get types() {
      return Object.keys(data)
    },
  }
  return dt
}

// ---------------------------------------------------------------------------
// Prop builder
// ---------------------------------------------------------------------------

function baseProps(overrides: Partial<Parameters<typeof FileTree>[0]> = {}) {
  return {
    nodes: smallTree,
    vaultPath: '/vault',
    selectedPaths: new Set<string>(),
    activeFilePath: null as string | null,
    openPaths: new Set<string>(),
    creatingIn: null,
    onToggleOpen: vi.fn(),
    onSelect: vi.fn(),
    onCreatingInChange: vi.fn(),
    onContextMenu: vi.fn(),
    onMove: vi.fn(),
    onImportResult: vi.fn(),
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let restoreVirtualizer: () => void

beforeEach(() => {
  restoreVirtualizer = setupVirtualizerMocks()
  setupMarvinMock()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  restoreVirtualizer()
})

// ===========================================================================
// 1. Drag a non-selected item → singular MIME only, plural MIME absent
// ===========================================================================

describe('handleDragStart — non-selected item', () => {
  it('sets singular MIME to node.path', () => {
    const dt = makeDragStartDt()
    render(<FileTree {...baseProps({ selectedPaths: new Set() })} />)
    const btn = screen.getByText('readme').closest('button')!
    fireEvent.dragStart(btn, { dataTransfer: dt })

    expect(dt.setData).toHaveBeenCalledWith(SINGULAR_MIME, '/vault/readme.md')
  })

  it('does NOT set plural MIME when item is not in selectedPaths', () => {
    const dt = makeDragStartDt()
    render(<FileTree {...baseProps({ selectedPaths: new Set() })} />)
    const btn = screen.getByText('readme').closest('button')!
    fireEvent.dragStart(btn, { dataTransfer: dt })

    expect(dt.data[PLURAL_MIME]).toBeUndefined()
    expect(dt.setData).not.toHaveBeenCalledWith(PLURAL_MIME, expect.anything())
  })

  it('sets text/plain to the single path', () => {
    const dt = makeDragStartDt()
    render(<FileTree {...baseProps({ selectedPaths: new Set() })} />)
    const btn = screen.getByText('readme').closest('button')!
    fireEvent.dragStart(btn, { dataTransfer: dt })

    expect(dt.data['text/plain']).toBe('/vault/readme.md')
  })
})

// ===========================================================================
// 2. Drag a selected item with selectedPaths.size === 1 → singular MIME (compat)
// ===========================================================================

describe('handleDragStart — selected item, size === 1', () => {
  it('uses singular MIME (not plural) for a single-item selection', () => {
    const dt = makeDragStartDt()
    render(<FileTree {...baseProps({ selectedPaths: new Set(['/vault/readme.md']) })} />)
    const btn = screen.getByText('readme').closest('button')!
    fireEvent.dragStart(btn, { dataTransfer: dt })

    expect(dt.setData).toHaveBeenCalledWith(SINGULAR_MIME, '/vault/readme.md')
    expect(dt.setData).not.toHaveBeenCalledWith(PLURAL_MIME, expect.anything())
  })

  it('text/plain equals the single path', () => {
    const dt = makeDragStartDt()
    render(<FileTree {...baseProps({ selectedPaths: new Set(['/vault/readme.md']) })} />)
    const btn = screen.getByText('readme').closest('button')!
    fireEvent.dragStart(btn, { dataTransfer: dt })

    expect(dt.data['text/plain']).toBe('/vault/readme.md')
  })
})

// ===========================================================================
// 3. Drag a selected item with selectedPaths.size > 1 → plural MIME JSON array
// ===========================================================================

describe('handleDragStart — selected item, size > 1', () => {
  it('sets plural MIME to a JSON array of all selected paths', () => {
    const selected = new Set(['/vault/readme.md', '/vault/docs', '/vault/assets'])
    const dt = makeDragStartDt()
    render(<FileTree {...baseProps({ selectedPaths: selected })} />)
    const btn = screen.getByText('readme').closest('button')!
    fireEvent.dragStart(btn, { dataTransfer: dt })

    const pluralCall = dt.setData.mock.calls.find((c: unknown[]) => c[0] === PLURAL_MIME)
    expect(pluralCall).toBeDefined()
    const parsed = JSON.parse(pluralCall![1] as string) as unknown
    expect(Array.isArray(parsed)).toBe(true)
    expect((parsed as string[]).length).toBe(3)
    expect(parsed).toContain('/vault/readme.md')
    expect(parsed).toContain('/vault/docs')
    expect(parsed).toContain('/vault/assets')
  })

  it('does NOT set singular MIME when N > 1', () => {
    const selected = new Set(['/vault/readme.md', '/vault/docs'])
    const dt = makeDragStartDt()
    render(<FileTree {...baseProps({ selectedPaths: selected })} />)
    const btn = screen.getByText('readme').closest('button')!
    fireEvent.dragStart(btn, { dataTransfer: dt })

    expect(dt.setData).not.toHaveBeenCalledWith(SINGULAR_MIME, expect.anything())
  })

  it('text/plain is the newline-joined list of all paths', () => {
    const selected = new Set(['/vault/readme.md', '/vault/docs', '/vault/assets'])
    const dt = makeDragStartDt()
    render(<FileTree {...baseProps({ selectedPaths: selected })} />)
    const btn = screen.getByText('readme').closest('button')!
    fireEvent.dragStart(btn, { dataTransfer: dt })

    const textPlain = dt.data['text/plain']
    const lines = textPlain.split('\n')
    expect(lines).toHaveLength(3)
    expect(lines).toContain('/vault/readme.md')
    expect(lines).toContain('/vault/docs')
    expect(lines).toContain('/vault/assets')
  })
})

// ===========================================================================
// 4. Drag ghost text
// ===========================================================================

describe('buildDragGhost — ghost label', () => {
  it('ghost shows filename (not "N items") when dragging a single non-selected item', () => {
    const dt = makeDragStartDt()
    // Spy on document.body.appendChild to capture the ghost element
    const appendSpy = vi.spyOn(document.body, 'appendChild')
    render(<FileTree {...baseProps({ selectedPaths: new Set() })} />)
    const btn = screen.getByText('readme').closest('button')!
    fireEvent.dragStart(btn, { dataTransfer: dt })

    const ghosts = appendSpy.mock.calls
      .map(([el]) => el as HTMLElement)
      .filter((el) => el?.classList?.contains('file-tree-drag-ghost'))
    expect(ghosts.length).toBeGreaterThanOrEqual(1)
    const ghost = ghosts[ghosts.length - 1]
    expect(ghost.textContent).not.toMatch(/\d+ items/)
    expect(ghost.textContent).toContain('readme.md')
    appendSpy.mockRestore()
  })

  it('ghost shows "N items" text when dragging N > 1 selected items', () => {
    const selected = new Set(['/vault/readme.md', '/vault/docs', '/vault/assets'])
    const dt = makeDragStartDt()
    const appendSpy = vi.spyOn(document.body, 'appendChild')
    render(<FileTree {...baseProps({ selectedPaths: selected })} />)
    const btn = screen.getByText('readme').closest('button')!
    fireEvent.dragStart(btn, { dataTransfer: dt })

    const ghosts = appendSpy.mock.calls
      .map(([el]) => el as HTMLElement)
      .filter((el) => el?.classList?.contains('file-tree-drag-ghost'))
    expect(ghosts.length).toBeGreaterThanOrEqual(1)
    const ghost = ghosts[ghosts.length - 1]
    expect(ghost.textContent).toMatch(/3 items/)
    appendSpy.mockRestore()
  })
})
