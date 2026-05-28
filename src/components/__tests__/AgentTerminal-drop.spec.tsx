// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { AgentTerminal } from '../AgentTerminal'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../Icon', () => ({ Icon: () => null }))
vi.mock('../../lib/colorTheme', () => ({ useColorTheme: () => 'light' }))
vi.mock('../../lib/terminalLinkProvider', () => ({
  createTerminalLinkProvider: () => ({ dispose: vi.fn() }),
  createOsc8LinkHandler: () => ({}),
}))

// xterm is a real DOM library that doesn't work in jsdom — stub it out.
vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    loadAddon = vi.fn()
    open = vi.fn()
    dispose = vi.fn()
    writeln = vi.fn()
    onData = vi.fn(() => ({ dispose: vi.fn() }))
    onResize = vi.fn(() => ({ dispose: vi.fn() }))
    registerLinkProvider = vi.fn(() => ({ dispose: vi.fn() }))
    options: Record<string, unknown> = {}
    cols = 80
    rows = 24
  },
}))

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit = vi.fn()
  },
}))

vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: class {},
}))

vi.mock('@xterm/xterm/css/xterm.css', () => ({}))

// jsdom doesn't implement ResizeObserver
global.ResizeObserver = class {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
}

// ---------------------------------------------------------------------------
// window.marvin mock
// ---------------------------------------------------------------------------

let ptyWriteMock: ReturnType<typeof vi.fn>

function noop() {}

function setupMarvinMock() {
  ptyWriteMock = vi.fn()
  Object.assign(window, {
    marvin: {
      pty: {
        spawn: vi.fn().mockResolvedValue({ pid: 0 }),
        write: ptyWriteMock,
        resize: vi.fn(),
        kill: vi.fn(),
        onData: vi.fn().mockReturnValue(noop),
        onExit: vi.fn().mockReturnValue(noop),
      },
    },
  })
}

// ---------------------------------------------------------------------------
// Default props
// ---------------------------------------------------------------------------

const VAULT = '/vault'
const PTY_ID = 'test-pty-1'

function defaultProps(overrides: Partial<Parameters<typeof AgentTerminal>[0]> = {}) {
  return {
    agent: { id: 'codex', name: 'Codex', binaryPath: '/usr/bin/codex' },
    ptyId: PTY_ID,
    vaultPath: VAULT,
    isActive: true,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// DataTransfer helpers — same pattern as Editor-drop.spec.tsx
// ---------------------------------------------------------------------------

function makeDragEvent(
  type: 'dragover' | 'dragleave' | 'drop',
  internalPath = '',
  internalPaths: string[] = [],
) {
  const event = new Event(type, { bubbles: true, cancelable: true }) as DragEvent
  const types: string[] = []
  if (internalPaths.length > 0) types.push('application/x-marvin-paths')
  else if (internalPath) types.push('application/x-marvin-path')
  const mimeData: Record<string, string> = {}
  if (internalPath) mimeData['application/x-marvin-path'] = internalPath
  if (internalPaths.length > 0)
    mimeData['application/x-marvin-paths'] = JSON.stringify(internalPaths)
  Object.defineProperty(event, 'dataTransfer', {
    value: {
      types,
      dropEffect: 'none',
      getData: (k: string) => mimeData[k] ?? '',
    },
    writable: false,
  })
  Object.defineProperty(event, 'preventDefault', { value: vi.fn(), writable: false })
  Object.defineProperty(event, 'stopPropagation', { value: vi.fn(), writable: false })
  return event
}

function getTerminalContainer() {
  return document.querySelector('.agent-terminal') as HTMLElement
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  setupMarvinMock()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ===========================================================================
// Tests
// ===========================================================================

describe('AgentTerminal — drop target (issue #365)', () => {
  it('singular MIME: writes @<rel> with trailing space to PTY', async () => {
    render(<AgentTerminal {...defaultProps()} />)
    await act(async () => {})

    const container = getTerminalContainer()
    container.dispatchEvent(makeDragEvent('drop', '/vault/foo.md'))

    expect(ptyWriteMock).toHaveBeenCalledTimes(1)
    expect(ptyWriteMock).toHaveBeenCalledWith(PTY_ID, '@/vault/foo.md ')
  })

  it('plural MIME (3 paths): writes all three @-prefixed paths joined by space', async () => {
    render(<AgentTerminal {...defaultProps()} />)
    await act(async () => {})

    const container = getTerminalContainer()
    container.dispatchEvent(
      makeDragEvent('drop', '', ['/vault/a.md', '/vault/sub/b.md', '/vault/c.md']),
    )

    expect(ptyWriteMock).toHaveBeenCalledTimes(1)
    expect(ptyWriteMock).toHaveBeenCalledWith(
      PTY_ID,
      '@/vault/a.md @/vault/sub/b.md @/vault/c.md ',
    )
  })

  it('drop without any marvin MIME: no PTY write (no-op)', async () => {
    render(<AgentTerminal {...defaultProps()} />)
    await act(async () => {})

    const container = getTerminalContainer()
    // No internalPath or internalPaths → no marvin MIME
    container.dispatchEvent(makeDragEvent('drop'))

    expect(ptyWriteMock).not.toHaveBeenCalled()
  })

  it('dragover with marvin MIME: preventDefault called and overlay appears', async () => {
    render(<AgentTerminal {...defaultProps()} />)
    await act(async () => {})

    const container = getTerminalContainer()
    const event = makeDragEvent('dragover', '/vault/foo.md')

    await act(async () => {
      container.dispatchEvent(event)
    })

    expect((event as DragEvent & { preventDefault: ReturnType<typeof vi.fn> }).preventDefault).toHaveBeenCalled()
    expect(screen.getByLabelText('Drop to insert path')).toBeInTheDocument()
  })

  it('dragover without marvin MIME: preventDefault not called, overlay absent', async () => {
    render(<AgentTerminal {...defaultProps()} />)
    await act(async () => {})

    const container = getTerminalContainer()
    const event = makeDragEvent('dragover')

    await act(async () => {
      container.dispatchEvent(event)
    })

    expect((event as DragEvent & { preventDefault: ReturnType<typeof vi.fn> }).preventDefault).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('Drop to insert path')).toBeNull()
  })

  it('dragleave: overlay hides after dragover', async () => {
    render(<AgentTerminal {...defaultProps()} />)
    await act(async () => {})

    const container = getTerminalContainer()

    await act(async () => {
      container.dispatchEvent(makeDragEvent('dragover', '/vault/foo.md'))
    })
    expect(screen.getByLabelText('Drop to insert path')).toBeInTheDocument()

    await act(async () => {
      container.dispatchEvent(makeDragEvent('dragleave'))
    })
    expect(screen.queryByLabelText('Drop to insert path')).toBeNull()
  })

  it('drop with no vault (vaultPath empty): no PTY write', async () => {
    render(<AgentTerminal {...defaultProps({ vaultPath: '' })} />)
    await act(async () => {})

    const container = getTerminalContainer()
    container.dispatchEvent(makeDragEvent('drop', '/vault/foo.md'))

    expect(ptyWriteMock).not.toHaveBeenCalled()
  })

  it('drop during streaming (isActive=true): PTY write still fires', async () => {
    // "Streaming" is an internal agent state; AgentTerminal has no dedicated
    // prop for it. The drop handler is unconditional — verify write happens
    // regardless of isActive and binaryPath being set (simulating an active session).
    render(<AgentTerminal {...defaultProps({ isActive: true })} />)
    await act(async () => {})

    const container = getTerminalContainer()
    container.dispatchEvent(makeDragEvent('drop', '/vault/foo.md'))

    expect(ptyWriteMock).toHaveBeenCalledWith(PTY_ID, '@/vault/foo.md ')
  })

  it('drop with malformed plural MIME (empty JSON array): overlay clears, no PTY write', async () => {
    render(<AgentTerminal {...defaultProps()} />)
    await act(async () => {})

    const container = getTerminalContainer()

    await act(async () => {
      container.dispatchEvent(makeDragEvent('dragover', '/vault/foo.md'))
    })
    expect(screen.getByLabelText('Drop to insert path')).toBeInTheDocument()

    // Plural MIME present in types, but payload is '[]' → readDraggedPaths returns []
    const malformedDrop = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent
    Object.defineProperty(malformedDrop, 'dataTransfer', {
      value: {
        types: ['application/x-marvin-paths'],
        dropEffect: 'none',
        getData: (k: string) => (k === 'application/x-marvin-paths' ? '[]' : ''),
      },
      writable: false,
    })
    Object.defineProperty(malformedDrop, 'preventDefault', { value: vi.fn(), writable: false })
    Object.defineProperty(malformedDrop, 'stopPropagation', { value: vi.fn(), writable: false })

    await act(async () => {
      container.dispatchEvent(malformedDrop)
    })

    expect(ptyWriteMock).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('Drop to insert path')).toBeNull()
  })

  it('claude-code agent: writes bare absolute path (no @ prefix)', async () => {
    render(
      <AgentTerminal
        {...defaultProps({
          agent: { id: 'claude-code', name: 'Claude Code', binaryPath: '/usr/bin/claude' },
        })}
      />,
    )
    await act(async () => {})

    const container = getTerminalContainer()
    container.dispatchEvent(makeDragEvent('drop', '/vault/foo.md'))

    expect(ptyWriteMock).toHaveBeenCalledWith(PTY_ID, '/vault/foo.md ')
  })
})
