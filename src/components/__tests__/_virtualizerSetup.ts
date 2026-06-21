// Shared JSDOM shims for components that use @tanstack/react-virtual.
//
// JSDOM doesn't lay out elements: clientHeight/offsetHeight are 0,
// getBoundingClientRect() returns all zeros, and ResizeObserver is absent.
// useVirtualizer relies on these to size the viewport and decide which rows
// to render. With everything reading as 0 the virtualizer renders nothing,
// every assertion that asks for visible rows fails.
//
// Call setupVirtualizerMocks() in beforeEach (or once per test file) and the
// teardown returned from it in afterEach to restore the originals.
//
// Usage:
//   import { setupVirtualizerMocks } from './_virtualizerSetup'
//
//   let restoreVirtualizer: () => void
//   beforeEach(() => { restoreVirtualizer = setupVirtualizerMocks() })
//   afterEach(() => { restoreVirtualizer() })
//
// Override defaults when a test needs a different viewport/row height:
//   restoreVirtualizer = setupVirtualizerMocks(800, 32)

type ResizeObserverCallback = (entries: ResizeObserverEntry[], observer: ResizeObserver) => void

class MockResizeObserver implements ResizeObserver {
  // Constructor accepts the callback to match the spec, even though we never
  // invoke it (virtualizer only needs the API surface to exist).
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(_cb: ResizeObserverCallback) {}
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

export function setupVirtualizerMocks(viewportHeight = 600, rowHeight = 28): () => void {
  const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect
  const originalClientHeight = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    'clientHeight'
  )
  const originalOffsetHeight = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    'offsetHeight'
  )
  const originalResizeObserver = (globalThis as { ResizeObserver?: unknown }).ResizeObserver

  HTMLElement.prototype.getBoundingClientRect = function (): DOMRect {
    const isRow = this.classList?.contains('file-tree-row')
    const height = isRow ? rowHeight : viewportHeight
    return {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 0,
      bottom: height,
      width: 0,
      height,
      toJSON: () => ({}),
    } as DOMRect
  }

  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get(): number {
      return this.classList?.contains('file-tree-row') ? rowHeight : viewportHeight
    },
  })

  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(): number {
      return this.classList?.contains('file-tree-row') ? rowHeight : viewportHeight
    },
  })
  ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = MockResizeObserver

  return function restore(): void {
    HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect
    if (originalClientHeight) {
      Object.defineProperty(HTMLElement.prototype, 'clientHeight', originalClientHeight)
    } else {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientHeight
    }
    if (originalOffsetHeight) {
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', originalOffsetHeight)
    } else {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>).offsetHeight
    }
    if (originalResizeObserver === undefined) {
      delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver
    } else {
      ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = originalResizeObserver
    }
  }
}
