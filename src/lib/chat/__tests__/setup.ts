import { expect, afterEach } from 'vitest'
import * as matchers from '@testing-library/jest-dom/matchers'
import { cleanup } from '@testing-library/react'

expect.extend(matchers)
afterEach(() => {
  cleanup()
  // FileTree's drag-ghost is appended to document.body during dragstart and
  // removed in a requestAnimationFrame callback, which jsdom doesn't run
  // synchronously. Strip any leftover ghosts so they don't leak into
  // subsequent test queries.
  document.querySelectorAll('.file-tree-drag-ghost').forEach((el) => el.remove())
})
