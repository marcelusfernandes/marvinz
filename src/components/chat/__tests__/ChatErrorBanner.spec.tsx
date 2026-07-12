import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ChatErrorBanner } from '../ChatErrorBanner'

describe('ChatErrorBanner', () => {
  it('renders the error message inside an alert', () => {
    render(<ChatErrorBanner message="Something broke" onRetry={() => {}} />)
    const alert = screen.getByRole('alert')
    expect(alert).toBeInTheDocument()
    expect(alert).toHaveTextContent('Something broke')
  })

  it('calls onRetry when Retry is clicked', () => {
    const onRetry = vi.fn()
    render(<ChatErrorBanner message="oops" onRetry={onRetry} />)
    fireEvent.click(screen.getByRole('button', { name: /retry/i }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('shows a re-auth hint for AGENT_NOT_AUTHENTICATED', () => {
    render(
      <ChatErrorBanner message="Not logged in" code="AGENT_NOT_AUTHENTICATED" onRetry={() => {}} />
    )
    expect(screen.getByText(/claude login/i)).toBeInTheDocument()
  })

  it('shows no re-auth hint for other error codes', () => {
    render(<ChatErrorBanner message="Network error" code="AGENT_NETWORK" onRetry={() => {}} />)
    expect(screen.queryByText(/claude login/i)).not.toBeInTheDocument()
  })
})
