import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BashCard } from '../tool-bodies/BashCard'
import { ReadCard } from '../tool-bodies/ReadCard'
import { readPath, readString, basename } from '../tool-bodies/types'

// ---------------------------------------------------------------------------
// BashCard
// ---------------------------------------------------------------------------

describe('BashCard — structure', () => {
  it('renders chat-tool-card-bash wrapper', () => {
    const { container } = render(
      <BashCard toolUseId="tu1" tool="Bash" input={{ command: 'ls' }} status="running" />
    )
    expect(container.querySelector('.chat-tool-card-bash')).toBeInTheDocument()
  })

  it('sets data-tool attribute to the tool name', () => {
    const { container } = render(
      <BashCard toolUseId="tu1" tool="Bash" input={{ command: 'ls' }} status="running" />
    )
    expect(container.querySelector('[data-tool="Bash"]')).toBeInTheDocument()
  })

  it('renders the command in the IN block', () => {
    render(
      <BashCard toolUseId="tu1" tool="Bash" input={{ command: 'echo hello' }} status="running" />
    )
    const inBlock = document.querySelector('[data-channel="in"]')
    expect(inBlock?.textContent).toContain('echo hello')
  })

  it('renders $ prompt label', () => {
    const { container } = render(
      <BashCard toolUseId="tu1" tool="Bash" input={{ command: 'ls' }} status="running" />
    )
    expect(container.querySelector('.chat-tool-io-label')?.textContent).toBe('$')
  })

  it('falls back to "(no command)" when command is missing', () => {
    render(<BashCard toolUseId="tu1" tool="Bash" input={{}} status="running" />)
    expect(document.querySelector('[data-channel="in"]')?.textContent).toContain('(no command)')
  })

  it('reads command from "cmd" key when "command" is absent', () => {
    render(<BashCard toolUseId="tu1" tool="Bash" input={{ cmd: 'pwd' }} status="running" />)
    expect(document.querySelector('[data-channel="in"]')?.textContent).toContain('pwd')
  })
})

describe('BashCard — output block visibility', () => {
  it('does not render OUT block while status is running', () => {
    const { container } = render(
      <BashCard toolUseId="tu1" tool="Bash" input={{ command: 'ls' }} status="running" />
    )
    expect(container.querySelector('[data-channel="out"]')).not.toBeInTheDocument()
  })

  it('does not render OUT block while status is pending_approval', () => {
    const { container } = render(
      <BashCard toolUseId="tu1" tool="Bash" input={{ command: 'ls' }} status="pending_approval" />
    )
    expect(container.querySelector('[data-channel="out"]')).not.toBeInTheDocument()
  })

  it('renders OUT block when status is ok', () => {
    const { container } = render(
      <BashCard
        toolUseId="tu1"
        tool="Bash"
        input={{ command: 'ls' }}
        status="ok"
        result="file.txt"
      />
    )
    expect(container.querySelector('[data-channel="out"]')).toBeInTheDocument()
  })

  it('renders OUT block when status is error', () => {
    const { container } = render(
      <BashCard
        toolUseId="tu1"
        tool="Bash"
        input={{ command: 'rm' }}
        status="error"
        errorMessage="Permission denied"
      />
    )
    expect(container.querySelector('[data-channel="out"]')).toBeInTheDocument()
  })

  it('OUT block has data-error="true" when status is error', () => {
    const { container } = render(
      <BashCard
        toolUseId="tu1"
        tool="Bash"
        input={{ command: 'rm' }}
        status="error"
        errorMessage="fail"
      />
    )
    expect(container.querySelector('[data-channel="out"][data-error="true"]')).toBeInTheDocument()
  })

  it('OUT block does not have data-error when status is ok', () => {
    const { container } = render(
      <BashCard toolUseId="tu1" tool="Bash" input={{ command: 'ls' }} status="ok" result="file" />
    )
    const out = container.querySelector('[data-channel="out"]')
    expect(out?.getAttribute('data-error')).toBeNull()
  })
})

describe('BashCard — output content', () => {
  it('renders string result in OUT block', () => {
    render(
      <BashCard
        toolUseId="tu1"
        tool="Bash"
        input={{ command: 'ls' }}
        status="ok"
        result="notes.md"
      />
    )
    expect(document.querySelector('[data-channel="out"]')?.textContent).toContain('notes.md')
  })

  it('renders errorMessage in OUT block', () => {
    render(
      <BashCard
        toolUseId="tu1"
        tool="Bash"
        input={{ command: 'rm' }}
        status="error"
        errorMessage="Permission denied"
      />
    )
    expect(document.querySelector('[data-channel="out"]')?.textContent).toContain(
      'Permission denied'
    )
  })

  it('renders "(no output)" when result is null and status is ok', () => {
    render(
      <BashCard toolUseId="tu1" tool="Bash" input={{ command: 'ls' }} status="ok" result={null} />
    )
    expect(document.querySelector('[data-channel="out"]')?.textContent).toContain('(no output)')
  })

  it('renders stdout from object result if present', () => {
    render(
      <BashCard
        toolUseId="tu1"
        tool="Bash"
        input={{ command: 'ls' }}
        status="ok"
        result={{ stdout: 'out.txt' }}
      />
    )
    expect(document.querySelector('[data-channel="out"]')?.textContent).toContain('out.txt')
  })
})

describe('BashCard — output clipping', () => {
  const longOutput = 'x'.repeat(700)

  it('clips long output (>600 chars) with ellipsis by default', () => {
    render(
      <BashCard
        toolUseId="tu1"
        tool="Bash"
        input={{ command: 'cat' }}
        status="ok"
        result={longOutput}
      />
    )
    const out = document.querySelector('[data-channel="out"]')
    expect(out?.textContent).toMatch(/…$/)
  })

  it('shows "Show full output" button when output is long', () => {
    render(
      <BashCard
        toolUseId="tu1"
        tool="Bash"
        input={{ command: 'cat' }}
        status="ok"
        result={longOutput}
      />
    )
    expect(screen.getByRole('button', { name: /show full output/i })).toBeInTheDocument()
  })

  it('does not show expand button when output is short (≤600 chars)', () => {
    render(
      <BashCard toolUseId="tu1" tool="Bash" input={{ command: 'ls' }} status="ok" result="short" />
    )
    expect(screen.queryByRole('button', { name: /show full output/i })).not.toBeInTheDocument()
  })

  it('expands output on "Show full output" click', () => {
    render(
      <BashCard
        toolUseId="tu1"
        tool="Bash"
        input={{ command: 'cat' }}
        status="ok"
        result={longOutput}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /show full output/i }))
    const out = document.querySelector('[data-channel="out"]')
    expect(out?.textContent).not.toMatch(/…$/)
  })

  it('shows "Collapse output" after expanding', () => {
    render(
      <BashCard
        toolUseId="tu1"
        tool="Bash"
        input={{ command: 'cat' }}
        status="ok"
        result={longOutput}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /show full output/i }))
    expect(screen.getByRole('button', { name: /collapse output/i })).toBeInTheDocument()
  })

  it('collapses again on "Collapse output" click', () => {
    render(
      <BashCard
        toolUseId="tu1"
        tool="Bash"
        input={{ command: 'cat' }}
        status="ok"
        result={longOutput}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /show full output/i }))
    fireEvent.click(screen.getByRole('button', { name: /collapse output/i }))
    const out = document.querySelector('[data-channel="out"]')
    expect(out?.textContent).toMatch(/…$/)
  })
})

// ---------------------------------------------------------------------------
// ReadCard
// ---------------------------------------------------------------------------

describe('ReadCard — structure', () => {
  it('renders chat-tool-card-read wrapper', () => {
    const { container } = render(
      <ReadCard
        toolUseId="tu1"
        tool="Read"
        input={{ file_path: '/vault/note.md' }}
        status="running"
      />
    )
    expect(container.querySelector('.chat-tool-card-read')).toBeInTheDocument()
  })

  it('sets data-tool attribute', () => {
    const { container } = render(
      <ReadCard
        toolUseId="tu1"
        tool="Read"
        input={{ file_path: '/vault/note.md' }}
        status="running"
      />
    )
    expect(container.querySelector('[data-tool="Read"]')).toBeInTheDocument()
  })

  it('renders filename pill for file_path input', () => {
    const { container } = render(
      <ReadCard
        toolUseId="tu1"
        tool="Read"
        input={{ file_path: '/vault/note.md' }}
        status="running"
      />
    )
    const pill = container.querySelector('.chat-tool-pill')
    expect(pill?.textContent).toBe('note.md')
  })

  it('shows full path in title attribute of pill', () => {
    const { container } = render(
      <ReadCard
        toolUseId="tu1"
        tool="Read"
        input={{ file_path: '/vault/note.md' }}
        status="running"
      />
    )
    const pill = container.querySelector('.chat-tool-pill')
    expect(pill?.getAttribute('title')).toBe('/vault/note.md')
  })

  it('reads path from "path" key when file_path absent', () => {
    const { container } = render(
      <ReadCard toolUseId="tu1" tool="Read" input={{ path: '/vault/readme.md' }} status="running" />
    )
    expect(container.querySelector('.chat-tool-pill')?.textContent).toBe('readme.md')
  })

  it('falls back to "(no path)" when input has no recognizable path key', () => {
    const { container } = render(
      <ReadCard toolUseId="tu1" tool="Read" input={{}} status="running" />
    )
    expect(container.querySelector('.chat-tool-pill')?.textContent).toBe('(no path)')
  })

  it('does not render error label when status is ok', () => {
    const { container } = render(
      <ReadCard toolUseId="tu1" tool="Read" input={{ file_path: '/vault/note.md' }} status="ok" />
    )
    expect(container.querySelector('.chat-tool-error-label')).not.toBeInTheDocument()
  })

  it('renders error label when status is error', () => {
    const { container } = render(
      <ReadCard
        toolUseId="tu1"
        tool="Read"
        input={{ file_path: '/vault/note.md' }}
        status="error"
      />
    )
    expect(container.querySelector('.chat-tool-error-label')).toBeInTheDocument()
  })

  it('does not render error label during running status', () => {
    const { container } = render(
      <ReadCard
        toolUseId="tu1"
        tool="Read"
        input={{ file_path: '/vault/note.md' }}
        status="running"
      />
    )
    expect(container.querySelector('.chat-tool-error-label')).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// types utilities — readPath, readString, basename
// ---------------------------------------------------------------------------

describe('readPath — utility', () => {
  it('returns null for null input', () => {
    expect(readPath(null)).toBeNull()
  })

  it('returns null for non-object input', () => {
    expect(readPath('string')).toBeNull()
    expect(readPath(42)).toBeNull()
  })

  it('reads file_path key', () => {
    expect(readPath({ file_path: '/vault/note.md' })).toBe('/vault/note.md')
  })

  it('reads path key when file_path absent', () => {
    expect(readPath({ path: '/tmp/file.txt' })).toBe('/tmp/file.txt')
  })

  it('reads filename key as fallback', () => {
    expect(readPath({ filename: 'report.md' })).toBe('report.md')
  })

  it('reads file key as last resort', () => {
    expect(readPath({ file: 'data.json' })).toBe('data.json')
  })

  it('returns null when no recognized key is present', () => {
    expect(readPath({ command: 'ls' })).toBeNull()
  })

  it('returns null for empty string values', () => {
    expect(readPath({ file_path: '' })).toBeNull()
  })

  it('prefers file_path over path when both present', () => {
    expect(readPath({ file_path: '/primary.md', path: '/secondary.md' })).toBe('/primary.md')
  })
})

describe('readString — utility', () => {
  it('returns null for null input', () => {
    expect(readString(null, 'key')).toBeNull()
  })

  it('returns the string value for a known key', () => {
    expect(readString({ command: 'ls' }, 'command')).toBe('ls')
  })

  it('returns null when key is absent', () => {
    expect(readString({ command: 'ls' }, 'cmd')).toBeNull()
  })

  it('returns null for empty string values', () => {
    expect(readString({ command: '' }, 'command')).toBeNull()
  })

  it('returns null for non-string values', () => {
    expect(readString({ count: 3 }, 'count')).toBeNull()
  })
})

describe('basename — utility', () => {
  it('returns just the filename from an absolute path', () => {
    expect(basename('/vault/notes/file.md')).toBe('file.md')
  })

  it('returns the whole string when no slash is present', () => {
    expect(basename('file.md')).toBe('file.md')
  })

  it('handles trailing slash gracefully (empty segment)', () => {
    expect(basename('/vault/')).toBe('')
  })

  it('handles root path', () => {
    expect(basename('/')).toBe('')
  })

  it('works with relative paths', () => {
    expect(basename('folder/sub/note.md')).toBe('note.md')
  })
})
