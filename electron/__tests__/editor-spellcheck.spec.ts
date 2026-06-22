import { describe, it, expect, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Simulate module-scope lastSpellcheck state + handler logic
// ---------------------------------------------------------------------------

type SpellcheckContext = { misspelledWord: string; suggestions: string[] }

let lastSpellcheck: SpellcheckContext = { misspelledWord: '', suggestions: [] }

// Mirror of win.webContents.on('context-menu') callback
function captureContextMenuParams(params: {
  misspelledWord: string
  dictionarySuggestions: string[]
}): void {
  lastSpellcheck = {
    misspelledWord: params.misspelledWord,
    suggestions: params.dictionarySuggestions,
  }
}

// Mirror of editor:spellcheck-context handler
function spellcheckContextHandler(): SpellcheckContext {
  return lastSpellcheck
}

// ---------------------------------------------------------------------------
// editor:spellcheck-context
// ---------------------------------------------------------------------------

describe('editor:spellcheck-context', () => {
  beforeEach(() => {
    lastSpellcheck = { misspelledWord: '', suggestions: [] }
  })

  it('returns default empty state before any context-menu fires', () => {
    expect(spellcheckContextHandler()).toEqual({ misspelledWord: '', suggestions: [] })
  })

  it('returns misspelled word and suggestions after context-menu event', () => {
    captureContextMenuParams({ misspelledWord: 'helo', dictionarySuggestions: ['hello', 'helo'] })

    expect(spellcheckContextHandler()).toEqual({
      misspelledWord: 'helo',
      suggestions: ['hello', 'helo'],
    })
  })

  it('updates state on subsequent context-menu events', () => {
    captureContextMenuParams({ misspelledWord: 'wrold', dictionarySuggestions: ['world'] })
    captureContextMenuParams({ misspelledWord: 'teh', dictionarySuggestions: ['the', 'ten'] })

    expect(spellcheckContextHandler()).toEqual({
      misspelledWord: 'teh',
      suggestions: ['the', 'ten'],
    })
  })

  it('clears misspelled word when right-clicking a correctly spelled word', () => {
    captureContextMenuParams({ misspelledWord: 'helo', dictionarySuggestions: ['hello'] })
    captureContextMenuParams({ misspelledWord: '', dictionarySuggestions: [] })

    expect(spellcheckContextHandler()).toEqual({ misspelledWord: '', suggestions: [] })
  })
})
