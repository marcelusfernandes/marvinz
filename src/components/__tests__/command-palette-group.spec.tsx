// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { CommandPalette } from '../CommandPalette'
import type { PaletteItem } from '../CommandPalette'

vi.mock('../Icon', () => ({ Icon: () => null }))
vi.mock('../MaterialIcon', () => ({ MaterialIcon: () => null }))
vi.mock('../HighlightedMatch', () => ({
  HighlightedMatch: ({ text }: { text: string }) => <span>{text}</span>,
}))
vi.mock('../../lib/settingsStore', () => ({
  useSetting: () => 'codicon',
}))

beforeEach(() => {
  // jsdom doesn't implement scrollIntoView
  window.HTMLElement.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function paletteItem(rel: string, isMarkdown: boolean): PaletteItem {
  return { path: `/vault/${rel}`, rel, name: rel.split('/').pop()!, isMarkdown }
}

const NOTE_A = paletteItem('alpha.md', true)
const NOTE_B = paletteItem('beta.md', true)
const NOTE_C = paletteItem('gamma.md', true)
const NOTE_D = paletteItem('delta.md', true)
const NOTE_E = paletteItem('epsilon.md', true)
const AGENT_A = paletteItem('.claude/agents/react.md', true)
const AGENT_B = paletteItem('.claude/agents/electron.md', true)
const COMMAND_A = paletteItem('.claude/commands/import.md', true)
const RULE_A = paletteItem('.claude/rules/git-workflow.md', true)
const HOOK_A = paletteItem('.claude/hooks/pre-commit.sh', false)
const OTHER_A = paletteItem('report.pdf', false)

const noop = () => {}

// ===========================================================================
// Section rendering — Notes only
// ===========================================================================

describe('CommandPalette — grouped render — Notes only', () => {
  it('renders a "Notes" section header when results contain only notes', () => {
    const { getAllByText } = render(
      <CommandPalette items={[NOTE_A, NOTE_B]} onPick={noop} onClose={noop} />
    )
    const headers = getAllByText(/^Notes/)
    expect(headers.length).toBeGreaterThanOrEqual(1)
    expect(headers[0].className).toContain('palette-section-header')
  })

  it('does NOT render Agents, Commands, Rules, or Hooks headers when absent', () => {
    const { queryByText } = render(
      <CommandPalette items={[NOTE_A, NOTE_B]} onPick={noop} onClose={noop} />
    )
    expect(queryByText(/^Agents/)).toBeNull()
    expect(queryByText(/^Commands/)).toBeNull()
    expect(queryByText(/^Rules/)).toBeNull()
    expect(queryByText(/^Hooks/)).toBeNull()
  })
})

// ===========================================================================
// Section rendering — mixed Notes + Agents
// ===========================================================================

describe('CommandPalette — grouped render — Notes + Agents', () => {
  it('renders both "Notes" and "Agents" section headers', () => {
    const { getAllByText } = render(
      <CommandPalette items={[NOTE_A, AGENT_A, AGENT_B]} onPick={noop} onClose={noop} />
    )
    const noteHeaders = getAllByText(/^Notes/)
    const agentHeaders = getAllByText(/^Agents/)
    expect(noteHeaders.length).toBeGreaterThanOrEqual(1)
    expect(agentHeaders.length).toBeGreaterThanOrEqual(1)
    expect(noteHeaders[0].className).toContain('palette-section-header')
    expect(agentHeaders[0].className).toContain('palette-section-header')
  })

  it('renders note items under Notes section and agent items under Agents section', () => {
    const { getByText } = render(
      <CommandPalette items={[NOTE_A, AGENT_A]} onPick={noop} onClose={noop} />
    )
    expect(getByText('alpha.md')).toBeTruthy()
    expect(getByText('react.md')).toBeTruthy()
  })
})

// ===========================================================================
// Section omission — empty sections
// ===========================================================================

describe('CommandPalette — grouped render — empty sections omitted', () => {
  it('omits Commands header when no command items exist', () => {
    const { queryByText } = render(
      <CommandPalette items={[NOTE_A, AGENT_A]} onPick={noop} onClose={noop} />
    )
    expect(queryByText(/^Commands/)).toBeNull()
  })

  it('omits Rules header when no rule items exist', () => {
    const { queryByText } = render(
      <CommandPalette items={[NOTE_A, COMMAND_A]} onPick={noop} onClose={noop} />
    )
    expect(queryByText(/^Rules/)).toBeNull()
  })

  it('renders all six section headers when all categories present', () => {
    const items = [NOTE_A, OTHER_A, AGENT_A, COMMAND_A, RULE_A, HOOK_A]
    const { getAllByText } = render(<CommandPalette items={items} onPick={noop} onClose={noop} />)
    expect(getAllByText(/^Notes/).length).toBeGreaterThanOrEqual(1)
    expect(getAllByText(/^Other/).length).toBeGreaterThanOrEqual(1)
    expect(getAllByText(/^Agents/).length).toBeGreaterThanOrEqual(1)
    expect(getAllByText(/^Commands/).length).toBeGreaterThanOrEqual(1)
    expect(getAllByText(/^Rules/).length).toBeGreaterThanOrEqual(1)
    expect(getAllByText(/^Hooks/).length).toBeGreaterThanOrEqual(1)
  })
})

// ===========================================================================
// Keyboard nav — headers are skipped
// ===========================================================================

describe('CommandPalette — keyboard nav skips section headers', () => {
  it('ArrowDown 3 times moves activeIdx through items only, skipping headers', () => {
    // NOTE_A, AGENT_A: two sections with a header between them
    // activeIdx starts at 0 (NOTE_A), ArrowDown → goes to AGENT_A, not the header
    const onPick = vi.fn()
    const { getByRole } = render(
      <CommandPalette items={[NOTE_A, AGENT_A]} onPick={onPick} onClose={noop} />
    )
    const input = getByRole('textbox')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    // Press Enter — should activate AGENT_A (index 1 in flat item list)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onPick).toHaveBeenCalledTimes(1)
    const [calledItem] = onPick.mock.calls[0] as [PaletteItem, boolean]
    expect(calledItem.rel).toBe(AGENT_A.rel)
  })

  it('ArrowDown 3 times in a Notes-only list with 5 items lands on the 4th item', () => {
    const onPick = vi.fn()
    const { getByRole } = render(
      <CommandPalette
        items={[NOTE_A, NOTE_B, NOTE_C, NOTE_D, NOTE_E]}
        onPick={onPick}
        onClose={noop}
      />
    )
    const input = getByRole('textbox')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onPick).toHaveBeenCalledTimes(1)
    const [calledItem] = onPick.mock.calls[0] as [PaletteItem, boolean]
    expect(calledItem.rel).toBe(NOTE_D.rel)
  })
})

// ===========================================================================
// Section header counter
// ===========================================================================

describe('CommandPalette — section header counter', () => {
  it('shows count in parentheses when section has more than 1 item', () => {
    const { getAllByText } = render(
      <CommandPalette
        items={[NOTE_A, NOTE_B, NOTE_C, NOTE_D, NOTE_E]}
        onPick={noop}
        onClose={noop}
      />
    )
    const header = getAllByText(/^Notes \(\d+\)/)[0]
    expect(header).toBeTruthy()
    expect(header.textContent).toBe('Notes (5)')
  })

  it('shows no count when section has exactly 1 item', () => {
    const { getAllByText, queryByText } = render(
      <CommandPalette items={[NOTE_A]} onPick={noop} onClose={noop} />
    )
    expect(getAllByText('Notes').length).toBeGreaterThanOrEqual(1)
    expect(queryByText(/^Notes \(/)).toBeNull()
  })
})
