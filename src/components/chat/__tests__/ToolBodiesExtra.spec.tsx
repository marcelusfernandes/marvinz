import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { WriteCard } from '../tool-bodies/WriteCard'
import { AgentCard } from '../tool-bodies/AgentCard'
import { GenericToolCard } from '../tool-bodies/GenericToolCard'
import { ToolBody } from '../tool-bodies/index'

// ---------------------------------------------------------------------------
// WriteCard
// ---------------------------------------------------------------------------

describe('WriteCard — structure', () => {
  it('renders chat-tool-card-write wrapper', () => {
    const { container } = render(
      <WriteCard
        toolUseId="tu1"
        tool="Write"
        input={{ file_path: '/vault/note.md', content: 'hello' }}
        status="running"
      />
    )
    expect(container.querySelector('.chat-tool-card-write')).toBeInTheDocument()
  })

  it('sets data-tool attribute', () => {
    const { container } = render(
      <WriteCard
        toolUseId="tu1"
        tool="Write"
        input={{ file_path: '/vault/note.md', content: '' }}
        status="running"
      />
    )
    expect(container.querySelector('[data-tool="Write"]')).toBeInTheDocument()
  })

  it('renders filename pill showing basename', () => {
    const { container } = render(
      <WriteCard
        toolUseId="tu1"
        tool="Write"
        input={{ file_path: '/vault/src/utils.ts', content: '' }}
        status="running"
      />
    )
    expect(container.querySelector('.chat-tool-pill')?.textContent).toBe('utils.ts')
  })

  it('shows full path in pill title', () => {
    const { container } = render(
      <WriteCard
        toolUseId="tu1"
        tool="Write"
        input={{ file_path: '/vault/src/utils.ts', content: '' }}
        status="running"
      />
    )
    expect(container.querySelector('.chat-tool-pill')?.getAttribute('title')).toBe(
      '/vault/src/utils.ts'
    )
  })

  it('pill has data-risk="destructive"', () => {
    const { container } = render(
      <WriteCard
        toolUseId="tu1"
        tool="Write"
        input={{ file_path: '/vault/a.md', content: '' }}
        status="running"
      />
    )
    expect(container.querySelector('[data-risk="destructive"]')).toBeInTheDocument()
  })

  it('falls back to "(no path)" when input has no path key', () => {
    const { container } = render(
      <WriteCard toolUseId="tu1" tool="Write" input={{}} status="running" />
    )
    expect(container.querySelector('.chat-tool-pill')?.textContent).toBe('(no path)')
  })
})

describe('WriteCard — subline', () => {
  it('shows "Creating" subline for Write tool while running', () => {
    const { container } = render(
      <WriteCard
        toolUseId="tu1"
        tool="Write"
        input={{ file_path: '/vault/a.md', content: 'line' }}
        status="running"
      />
    )
    expect(container.querySelector('.chat-tool-subline')?.textContent).toMatch(/Creating/)
  })

  it('shows "Created" subline for Write tool on success', () => {
    const { container } = render(
      <WriteCard
        toolUseId="tu1"
        tool="Write"
        input={{ file_path: '/vault/a.md', content: 'line' }}
        status="ok"
      />
    )
    expect(container.querySelector('.chat-tool-subline')?.textContent).toMatch(/Created/)
  })

  it('shows diff counts for Edit tool', () => {
    const { container } = render(
      <WriteCard
        toolUseId="tu1"
        tool="Edit"
        input={{ file_path: '/vault/a.md', old_string: 'old\nold2', new_string: 'new\nnew2\nnew3' }}
        status="running"
      />
    )
    const subline = container.querySelector('.chat-tool-subline')?.textContent
    expect(subline).toMatch(/\+\d+/)
    expect(subline).toMatch(/-\d+/)
  })

  it('shows "Failed" subline on error', () => {
    const { container } = render(
      <WriteCard toolUseId="tu1" tool="Write" input={{ file_path: '/vault/a.md' }} status="error" />
    )
    expect(container.querySelector('.chat-tool-subline')?.textContent).toBe('Failed')
  })

  it('shows "Denied" subline on denied status', () => {
    const { container } = render(
      <WriteCard
        toolUseId="tu1"
        tool="Write"
        input={{ file_path: '/vault/a.md' }}
        status="denied"
      />
    )
    expect(container.querySelector('.chat-tool-subline')?.textContent).toBe('Denied')
  })

  it('shows "Cancelled" subline on cancelled status', () => {
    const { container } = render(
      <WriteCard
        toolUseId="tu1"
        tool="Write"
        input={{ file_path: '/vault/a.md' }}
        status="cancelled"
      />
    )
    expect(container.querySelector('.chat-tool-subline')?.textContent).toBe('Cancelled')
  })

  // Guards the #584 fix: WriteCard previously did NOT handle pending_approval,
  // so a pending Write fell through to "Creating". It must route through
  // toolStatusLabel like the other status states.
  it('shows "Awaiting approval" subline on pending_approval status', () => {
    const { container } = render(
      <WriteCard
        toolUseId="tu1"
        tool="Write"
        input={{ file_path: '/vault/a.md' }}
        status="pending_approval"
      />
    )
    expect(container.querySelector('.chat-tool-subline')?.textContent).toBe('Awaiting approval')
  })
})

// ---------------------------------------------------------------------------
// AgentCard
// ---------------------------------------------------------------------------

describe('AgentCard — structure', () => {
  it('renders chat-tool-card-agent wrapper', () => {
    const { container } = render(
      <AgentCard
        toolUseId="tu1"
        tool="Agent"
        input={{ description: 'Run tests' }}
        status="running"
      />
    )
    expect(container.querySelector('.chat-tool-card-agent')).toBeInTheDocument()
  })

  it('sets data-tool attribute', () => {
    const { container } = render(
      <AgentCard toolUseId="tu1" tool="Agent" input={{}} status="running" />
    )
    expect(container.querySelector('[data-tool="Agent"]')).toBeInTheDocument()
  })

  it('renders description text when present', () => {
    render(
      <AgentCard
        toolUseId="tu1"
        tool="Agent"
        input={{ description: 'Run the test suite' }}
        status="running"
      />
    )
    expect(screen.getByText('Run the test suite')).toBeInTheDocument()
  })

  it('renders subagent_type as a pill', () => {
    const { container } = render(
      <AgentCard
        toolUseId="tu1"
        tool="Agent"
        input={{ subagent_type: 'researcher' }}
        status="running"
      />
    )
    expect(container.querySelector('.chat-tool-agent-type')?.textContent).toBe('researcher')
  })

  it('renders prompt when present', () => {
    render(
      <AgentCard
        toolUseId="tu1"
        tool="Agent"
        input={{ prompt: 'Summarise this document' }}
        status="running"
      />
    )
    expect(screen.getByText('Summarise this document')).toBeInTheDocument()
  })

  it('does not render prompt when absent', () => {
    const { container } = render(
      <AgentCard toolUseId="tu1" tool="Agent" input={{}} status="running" />
    )
    expect(container.querySelector('.chat-tool-agent-prompt')).not.toBeInTheDocument()
  })

  it('shows string result in output area', () => {
    const { container } = render(
      <AgentCard toolUseId="tu1" tool="Agent" input={{}} status="ok" result="Done successfully" />
    )
    expect(container.querySelector('.chat-tool-agent-output')?.textContent).toContain(
      'Done successfully'
    )
  })

  it('shows errorMessage in output area on error', () => {
    const { container } = render(
      <AgentCard
        toolUseId="tu1"
        tool="Agent"
        input={{}}
        status="error"
        errorMessage="Sub-agent crashed"
      />
    )
    const out = container.querySelector('.chat-tool-agent-output')
    expect(out?.textContent).toContain('Sub-agent crashed')
    expect(out?.getAttribute('data-error')).toBe('true')
  })

  it('does not render output when result is null and no error', () => {
    const { container } = render(
      <AgentCard toolUseId="tu1" tool="Agent" input={{}} status="running" />
    )
    expect(container.querySelector('.chat-tool-agent-output')).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// GenericToolCard
// ---------------------------------------------------------------------------

describe('GenericToolCard — structure', () => {
  it('renders chat-tool-card-generic wrapper', () => {
    const { container } = render(
      <GenericToolCard
        toolUseId="tu1"
        tool="mcp__my_tool"
        input={{ foo: 'bar' }}
        status="running"
      />
    )
    expect(container.querySelector('.chat-tool-card-generic')).toBeInTheDocument()
  })

  it('sets data-tool attribute to the tool name', () => {
    const { container } = render(
      <GenericToolCard toolUseId="tu1" tool="mcp__custom" input={{}} status="running" />
    )
    expect(container.querySelector('[data-tool="mcp__custom"]')).toBeInTheDocument()
  })

  it('renders "Show input" expand button initially', () => {
    render(
      <GenericToolCard toolUseId="tu1" tool="mcp__tool" input={{ key: 'val' }} status="running" />
    )
    expect(screen.getByRole('button', { name: /show input/i })).toBeInTheDocument()
  })

  it('input pre block is hidden before expanding', () => {
    const { container } = render(
      <GenericToolCard toolUseId="tu1" tool="mcp__tool" input={{ key: 'val' }} status="running" />
    )
    expect(container.querySelector('[data-channel="in"]')).not.toBeInTheDocument()
  })

  it('shows input JSON after clicking expand', () => {
    render(
      <GenericToolCard toolUseId="tu1" tool="mcp__tool" input={{ key: 'val' }} status="running" />
    )
    fireEvent.click(screen.getByRole('button', { name: /show input/i }))
    expect(screen.getByRole('button', { name: /hide input/i })).toBeInTheDocument()
    expect(document.querySelector('[data-channel="in"]')?.textContent).toContain('"key"')
  })

  it('collapses input again on "Hide input" click', () => {
    const { container } = render(
      <GenericToolCard toolUseId="tu1" tool="mcp__tool" input={{ key: 'val' }} status="running" />
    )
    fireEvent.click(screen.getByRole('button', { name: /show input/i }))
    fireEvent.click(screen.getByRole('button', { name: /hide input/i }))
    expect(container.querySelector('[data-channel="in"]')).not.toBeInTheDocument()
  })

  it('does not render output block while running', () => {
    const { container } = render(
      <GenericToolCard toolUseId="tu1" tool="mcp__tool" input={{}} status="running" />
    )
    expect(container.querySelector('[data-channel="out"]')).not.toBeInTheDocument()
  })

  it('renders output block on success', () => {
    const { container } = render(
      <GenericToolCard toolUseId="tu1" tool="mcp__tool" input={{}} status="ok" result="done" />
    )
    expect(container.querySelector('[data-channel="out"]')).toBeInTheDocument()
  })

  it('renders output block on error with data-error=true', () => {
    const { container } = render(
      <GenericToolCard
        toolUseId="tu1"
        tool="mcp__tool"
        input={{}}
        status="error"
        errorMessage="oops"
      />
    )
    expect(container.querySelector('[data-channel="out"][data-error="true"]')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// ToolBody resolver — pickToolBody
// ---------------------------------------------------------------------------

describe('ToolBody resolver', () => {
  it('renders BashCard for tool="Bash"', () => {
    const { container } = render(
      <ToolBody toolUseId="tu1" tool="Bash" input={{ command: 'ls' }} status="running" />
    )
    expect(container.querySelector('.chat-tool-card-bash')).toBeInTheDocument()
  })

  it('renders BashCard for tool="bash"', () => {
    const { container } = render(
      <ToolBody toolUseId="tu1" tool="bash" input={{ command: 'ls' }} status="running" />
    )
    expect(container.querySelector('.chat-tool-card-bash')).toBeInTheDocument()
  })

  it('renders ReadCard for tool="Read"', () => {
    const { container } = render(
      <ToolBody toolUseId="tu1" tool="Read" input={{ file_path: '/vault/a.md' }} status="running" />
    )
    expect(container.querySelector('.chat-tool-card-read')).toBeInTheDocument()
  })

  it('renders WriteCard for tool="Write"', () => {
    const { container } = render(
      <ToolBody
        toolUseId="tu1"
        tool="Write"
        input={{ file_path: '/vault/a.md', content: '' }}
        status="running"
      />
    )
    expect(container.querySelector('.chat-tool-card-write')).toBeInTheDocument()
  })

  it('renders EditCard for tool="Edit"', () => {
    const { container } = render(
      <ToolBody toolUseId="tu1" tool="Edit" input={{ file_path: '/vault/a.md' }} status="running" />
    )
    expect(container.querySelector('.chat-tool-card-edit')).toBeInTheDocument()
  })

  it('renders EditCard for tool="edit_file"', () => {
    const { container } = render(
      <ToolBody
        toolUseId="tu1"
        tool="edit_file"
        input={{ file_path: '/vault/a.md' }}
        status="running"
      />
    )
    expect(container.querySelector('.chat-tool-card-edit')).toBeInTheDocument()
  })

  it('renders AgentCard for tool="Agent"', () => {
    const { container } = render(
      <ToolBody toolUseId="tu1" tool="Agent" input={{}} status="running" />
    )
    expect(container.querySelector('.chat-tool-card-agent')).toBeInTheDocument()
  })

  it('renders AgentCard for tool="Task"', () => {
    const { container } = render(
      <ToolBody toolUseId="tu1" tool="Task" input={{}} status="running" />
    )
    expect(container.querySelector('.chat-tool-card-agent')).toBeInTheDocument()
  })

  it('renders GenericToolCard for unknown tool names', () => {
    const { container } = render(
      <ToolBody toolUseId="tu1" tool="mcp__my_custom_tool" input={{}} status="running" />
    )
    expect(container.querySelector('.chat-tool-card-generic')).toBeInTheDocument()
  })

  it('does not crash for empty string tool name', () => {
    const { container } = render(<ToolBody toolUseId="tu1" tool="" input={{}} status="running" />)
    expect(container.querySelector('.chat-tool-card-generic')).toBeInTheDocument()
  })
})
