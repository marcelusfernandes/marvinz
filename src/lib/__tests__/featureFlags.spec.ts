import { describe, it, expect } from 'vitest'
import { resolveTabMode } from '../featureFlags'

describe('resolveTabMode', () => {
  describe('chat UI disabled (release builds)', () => {
    it('returns terminal for a chat provider regardless of terminalMode', () => {
      expect(resolveTabMode(false, false, true)).toBe('terminal')
      expect(resolveTabMode(false, true, true)).toBe('terminal')
    })

    it('returns terminal for a non-chat provider', () => {
      expect(resolveTabMode(false, false, false)).toBe('terminal')
      expect(resolveTabMode(false, true, false)).toBe('terminal')
    })
  })

  describe('chat UI enabled (dev builds)', () => {
    it('returns chat for a chat provider when terminalMode is off', () => {
      expect(resolveTabMode(true, false, true)).toBe('chat')
    })

    it('returns terminal for a chat provider when terminalMode is on', () => {
      expect(resolveTabMode(true, true, true)).toBe('terminal')
    })

    it('returns terminal for a non-chat provider regardless of terminalMode', () => {
      expect(resolveTabMode(true, false, false)).toBe('terminal')
      expect(resolveTabMode(true, true, false)).toBe('terminal')
    })
  })
})
