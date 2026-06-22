// @vitest-environment jsdom

import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'

vi.mock('../Icon', () => ({
  Icon: ({ name }: { name: string }) => <span data-icon={name} />,
}))

vi.mock('../../lib/marvinUrl', () => ({
  toMarvinUrl: (p: string) => `marvin://file${p}`,
}))

import { PdfViewer } from '../PdfViewer'

describe('PdfViewer', () => {
  it('renders filename in toolbar', () => {
    const { container } = render(<PdfViewer path="/docs/report.pdf" />)
    const name = container.querySelector('.pdf-viewer-name')
    expect(name?.textContent).toBe('report.pdf')
  })

  it('renders embed with type="application/pdf" and src containing the path', () => {
    const { container } = render(<PdfViewer path="/docs/report.pdf" />)
    const embed = container.querySelector('embed')
    expect(embed).not.toBeNull()
    expect(embed!.getAttribute('type')).toBe('application/pdf')
    expect(embed!.getAttribute('src')).toContain('/docs/report.pdf')
  })

  it('calls onRevealInFinder with the correct path when button is clicked', () => {
    const onRevealInFinder = vi.fn()
    const { container } = render(
      <PdfViewer path="/docs/report.pdf" onRevealInFinder={onRevealInFinder} />
    )
    const btn = container.querySelector<HTMLButtonElement>('button.pdf-viewer-action')
    expect(btn).not.toBeNull()
    fireEvent.click(btn!)
    expect(onRevealInFinder).toHaveBeenCalledTimes(1)
    expect(onRevealInFinder).toHaveBeenCalledWith('/docs/report.pdf')
  })

  it('does not render action button when onRevealInFinder is omitted', () => {
    const { container } = render(<PdfViewer path="/docs/report.pdf" />)
    const btn = container.querySelector('button.pdf-viewer-action')
    expect(btn).toBeNull()
  })
})
