// Shared helpers for the office-viewer gate specs (XlsxViewer / DocxViewer).
//
// The per-file `vi.mock('../../lib/featureFlags', ...)` and `vi.mock('../Icon')`
// stay in each spec — they are hoisted per file and are what keeps the flag
// state isolated (one file per flag state). Only the flag-agnostic plumbing
// below is shared.

import { expect, vi } from 'vitest'
import { render, waitFor, type RenderResult } from '@testing-library/react'
import type { ComponentType } from 'react'

type ViewerProps = { path: string; onRevealInFinder?: (p: string) => void }

/** Select a button by its `title` attribute. */
export function btn(container: HTMLElement, title: string): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>(`button[title="${title}"]`)
}

/** Stub `window.marvin.office` for the XlsxViewer (2-sheet workbook, one data row). */
export function setupXlsxMock(): void {
  Object.assign(window, {
    marvin: {
      office: {
        readXlsx: vi.fn().mockResolvedValue({
          rows: [
            ['Name', 'Score'],
            ['Alice', '95'],
          ],
          sheetNames: ['Sheet1', 'Summary'],
        }),
        writeXlsx: vi.fn().mockResolvedValue(undefined),
      },
    },
  })
}

/** Stub `window.marvin.office` for the DocxViewer (simple HTML preview). */
export function setupDocxMock(): void {
  Object.assign(window, {
    marvin: {
      office: {
        readDocx: vi.fn().mockResolvedValue({ html: '<p>Hello World</p>', messages: [] }),
        writeDocx: vi.fn().mockResolvedValue(undefined),
      },
    },
  })
}

/** Render a viewer and wait until its content selector is present (file loaded). */
export async function renderViewerLoaded(
  Component: ComponentType<ViewerProps>,
  contentSelector: string,
  path: string
): Promise<RenderResult> {
  const result = render(<Component path={path} />)
  await waitFor(() => expect(result.container.querySelector(contentSelector)).not.toBeNull())
  return result
}
