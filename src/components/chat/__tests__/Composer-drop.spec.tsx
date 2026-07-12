// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, act } from '@testing-library/react'
import { forwardRef } from 'react'
import { renderWithAppContext as render } from '../../__tests__/renderWithAppContext'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../Icon', () => ({ Icon: () => null }))
vi.mock('../ModePill', () => ({
  ModePill: forwardRef(() => null),
  MODE_OPTIONS: [{ value: 'default', label: 'Ask before edits', hint: '' }],
}))
vi.mock('../ModesPicker', () => ({ ModesPicker: () => null }))

// ---------------------------------------------------------------------------
// Chat store mock
// Composer reads draft and setComposerDraft via useChatStore selector calls.
// ---------------------------------------------------------------------------

const setDraftMock = vi.fn((_sid: string, next: string) => {
  currentDraft = next
})

// Mutable so individual tests can set an initial draft.
let currentDraft = ''

vi.mock('../../../lib/chat/store', () => ({
  useChatStore: (
    selector: (s: {
      sessions: Record<string, { composer: { draft: string }; permissionMode: string }>
      setComposerDraft: typeof setDraftMock
      setPermissionMode: () => void
    }) => unknown
  ) =>
    selector({
      get sessions() {
        return { 'test-session': { composer: { draft: currentDraft }, permissionMode: 'default' } }
      },
      setComposerDraft: setDraftMock,
      setPermissionMode: vi.fn(),
    }),
}))

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { Composer } from '../Composer'

// ---------------------------------------------------------------------------
// Default props
// ---------------------------------------------------------------------------

const SESSION_ID = 'test-session'
const VAULT = '/vault'

function defaultProps(
  overrides: Partial<Parameters<typeof Composer>[0] & { vaultPath: string }> = {}
) {
  return {
    sessionId: SESSION_ID,
    onSend: vi.fn(),
    vaultPath: VAULT,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// DataTransfer helpers — same pattern as AgentTerminal-drop.spec.tsx
// ---------------------------------------------------------------------------

function makeDragEvent(
  type: 'dragover' | 'dragleave' | 'drop',
  internalPath = '',
  internalPaths: string[] = []
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

function getComposer() {
  return document.querySelector('.chat-composer') as HTMLElement
}

function getTextarea() {
  return document.querySelector('.chat-composer-textarea') as HTMLTextAreaElement
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  currentDraft = ''
  setDraftMock.mockClear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ===========================================================================
// Tests
// ===========================================================================

describe('Composer — drop target (issue #366)', () => {
  it('singular MIME: inserts absolute path at caret with trailing space (no @ prefix)', async () => {
    render(<Composer {...defaultProps()} />)
    await act(async () => {})

    await act(async () => {
      getComposer().dispatchEvent(makeDragEvent('drop', '/vault/foo.md'))
    })

    expect(setDraftMock).toHaveBeenCalledTimes(1)
    const [, newDraft] = setDraftMock.mock.calls[0] as [string, string]
    expect(newDraft).toBe('/vault/foo.md ')
    expect(newDraft).not.toMatch(/@/)
  })

  it('plural MIME (3 paths): inserts all paths space-joined with trailing space', async () => {
    render(<Composer {...defaultProps()} />)
    await act(async () => {})

    await act(async () => {
      getComposer().dispatchEvent(
        makeDragEvent('drop', '', ['/vault/a.md', '/vault/b.md', '/vault/c.md'])
      )
    })

    expect(setDraftMock).toHaveBeenCalledTimes(1)
    const [, newDraft] = setDraftMock.mock.calls[0] as [string, string]
    expect(newDraft).toBe('/vault/a.md /vault/b.md /vault/c.md ')
    expect(newDraft).not.toMatch(/@/)
  })

  it('preserves surrounding text: inserts at caret position', async () => {
    currentDraft = 'before after'
    render(<Composer {...defaultProps()} />)
    await act(async () => {})

    // Caret at position 7 (between "before " and "after")
    getTextarea().setSelectionRange(7, 7)

    await act(async () => {
      getComposer().dispatchEvent(makeDragEvent('drop', '/vault/foo.md'))
    })

    expect(setDraftMock).toHaveBeenCalledTimes(1)
    const [, newDraft] = setDraftMock.mock.calls[0] as [string, string]
    expect(newDraft).toBe('before /vault/foo.md after')
  })

  it('drop without any marvin MIME: no setComposerDraft call', async () => {
    render(<Composer {...defaultProps()} />)
    await act(async () => {})

    await act(async () => {
      getComposer().dispatchEvent(makeDragEvent('drop'))
    })

    expect(setDraftMock).not.toHaveBeenCalled()
  })

  it('dragover with marvin MIME: preventDefault called and overlay appears', async () => {
    render(<Composer {...defaultProps()} />)
    await act(async () => {})

    const event = makeDragEvent('dragover', '/vault/foo.md')
    await act(async () => {
      getComposer().dispatchEvent(event)
    })

    expect(
      (event as DragEvent & { preventDefault: ReturnType<typeof vi.fn> }).preventDefault
    ).toHaveBeenCalled()
    expect(screen.getByTestId('chat-composer-drop-overlay')).toBeInTheDocument()
  })

  it('dragover without marvin MIME: no preventDefault, no overlay', async () => {
    render(<Composer {...defaultProps()} />)
    await act(async () => {})

    const event = makeDragEvent('dragover')
    await act(async () => {
      getComposer().dispatchEvent(event)
    })

    expect(
      (event as DragEvent & { preventDefault: ReturnType<typeof vi.fn> }).preventDefault
    ).not.toHaveBeenCalled()
    expect(screen.queryByTestId('chat-composer-drop-overlay')).toBeNull()
  })

  it('dragleave: overlay hides after dragover', async () => {
    render(<Composer {...defaultProps()} />)
    await act(async () => {})

    await act(async () => {
      getComposer().dispatchEvent(makeDragEvent('dragover', '/vault/foo.md'))
    })
    expect(screen.getByTestId('chat-composer-drop-overlay')).toBeInTheDocument()

    await act(async () => {
      getComposer().dispatchEvent(makeDragEvent('dragleave'))
    })
    expect(screen.queryByTestId('chat-composer-drop-overlay')).toBeNull()
  })

  it('dragleave into a child element: overlay stays visible', async () => {
    render(<Composer {...defaultProps()} />)
    await act(async () => {})

    await act(async () => {
      getComposer().dispatchEvent(makeDragEvent('dragover', '/vault/foo.md'))
    })
    expect(screen.getByTestId('chat-composer-drop-overlay')).toBeInTheDocument()

    // Simulate the pointer transitioning from .chat-composer into the
    // textarea child. The browser fires dragleave on the parent with
    // relatedTarget set to the child — the handler must NOT clear the
    // overlay in that case (otherwise it flickers on every child crossing).
    const leaveToChild = new Event('dragleave', { bubbles: true, cancelable: true })
    Object.defineProperty(leaveToChild, 'relatedTarget', { value: getTextarea() })
    await act(async () => {
      getComposer().dispatchEvent(leaveToChild)
    })

    expect(screen.getByTestId('chat-composer-drop-overlay')).toBeInTheDocument()
  })

  it('drop with no vault (vaultPath empty): no setComposerDraft call', async () => {
    // vaultPath: '' is this file's "no vault open" sentinel today; once
    // Composer reads useAppContext() instead (issue #618), "no vault" is
    // context's null — hence the explicit override here (every other call
    // site in this file relies on the helper's '/vault' default).
    render(<Composer {...defaultProps({ vaultPath: '' })} />, { vaultPath: null })
    await act(async () => {})

    await act(async () => {
      getComposer().dispatchEvent(makeDragEvent('drop', '/vault/foo.md'))
    })

    expect(setDraftMock).not.toHaveBeenCalled()
  })

  it('drop with malformed plural MIME (empty JSON array): overlay clears, no insert', async () => {
    render(<Composer {...defaultProps()} />)
    await act(async () => {})

    await act(async () => {
      getComposer().dispatchEvent(makeDragEvent('dragover', '/vault/foo.md'))
    })
    expect(screen.getByTestId('chat-composer-drop-overlay')).toBeInTheDocument()

    // Plural MIME present in types but payload is '[]' → readDraggedPaths returns []
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
      getComposer().dispatchEvent(malformedDrop)
    })

    expect(setDraftMock).not.toHaveBeenCalled()
    expect(screen.queryByTestId('chat-composer-drop-overlay')).toBeNull()
  })

  it('caret advances after insert: setSelectionRange called with end of inserted text', async () => {
    currentDraft = 'before after'
    render(<Composer {...defaultProps()} />)
    await act(async () => {})

    // Caret at position 7 (between "before " and "after")
    const textarea = getTextarea()
    textarea.setSelectionRange(7, 7)

    // Spy on setSelectionRange to capture what the rAF callback requests.
    // jsdom clamps to value.length when the textarea value hasn't re-rendered,
    // so we assert on the spy argument rather than the DOM property.
    const setSelectionRangeSpy = vi.spyOn(textarea, 'setSelectionRange')

    await act(async () => {
      getComposer().dispatchEvent(makeDragEvent('drop', '/vault/foo.md'))
    })

    expect(setDraftMock).toHaveBeenCalledTimes(1)

    // Flush the rAF so the caret-restore callback runs.
    // '/vault/foo.md ' is 14 chars → expected caret: 7 + 14 = 21.
    const expectedCaretPos = 7 + '/vault/foo.md '.length
    await act(async () => {
      await new Promise<void>((r) => requestAnimationFrame(() => r()))
    })

    // The last call to setSelectionRange must be the caret restore at position 21.
    const lastCall = setSelectionRangeSpy.mock.calls.at(-1)
    expect(lastCall).toBeDefined()
    expect(lastCall![0]).toBe(expectedCaretPos)
    expect(lastCall![1]).toBe(expectedCaretPos)
  })
})
