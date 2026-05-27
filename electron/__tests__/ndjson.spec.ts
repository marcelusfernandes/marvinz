import { describe, it, expect, vi } from 'vitest'
import { NdjsonStream } from '../agent/ndjson.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStream() {
  const onLine = vi.fn()
  const onMalformed = vi.fn()
  const onFatal = vi.fn()
  const stream = new NdjsonStream(onLine, onMalformed, onFatal)
  return { stream, onLine, onMalformed, onFatal }
}

function buf(s: string): Buffer {
  return Buffer.from(s, 'utf8')
}

// ---------------------------------------------------------------------------
// Basic line parsing
// ---------------------------------------------------------------------------

describe('NdjsonStream — basic line parsing', () => {
  it('parses a single complete line', () => {
    const { stream, onLine, onMalformed } = makeStream()
    stream.push(buf('{"type":"text-delta"}\n'))
    expect(onLine).toHaveBeenCalledOnce()
    expect(onLine).toHaveBeenCalledWith({ type: 'text-delta' })
    expect(onMalformed).not.toHaveBeenCalled()
  })

  it('parses multiple lines in a single chunk', () => {
    const { stream, onLine, onMalformed } = makeStream()
    stream.push(buf('{"a":1}\n{"b":2}\n{"c":3}\n'))
    expect(onLine).toHaveBeenCalledTimes(3)
    expect(onLine).toHaveBeenNthCalledWith(1, { a: 1 })
    expect(onLine).toHaveBeenNthCalledWith(2, { b: 2 })
    expect(onLine).toHaveBeenNthCalledWith(3, { c: 3 })
    expect(onMalformed).not.toHaveBeenCalled()
  })

  it('parses a single line split across multiple chunks', () => {
    const { stream, onLine, onMalformed } = makeStream()
    stream.push(buf('{"type"'))
    expect(onLine).not.toHaveBeenCalled()
    stream.push(buf(':"text"'))
    expect(onLine).not.toHaveBeenCalled()
    stream.push(buf('}\n'))
    expect(onLine).toHaveBeenCalledOnce()
    expect(onLine).toHaveBeenCalledWith({ type: 'text' })
    expect(onMalformed).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Empty and whitespace-only lines
// ---------------------------------------------------------------------------

describe('NdjsonStream — empty and whitespace lines', () => {
  it('skips empty lines', () => {
    const { stream, onLine, onMalformed } = makeStream()
    stream.push(buf('\n\n{"a":1}\n\n'))
    expect(onLine).toHaveBeenCalledOnce()
    expect(onLine).toHaveBeenCalledWith({ a: 1 })
    expect(onMalformed).not.toHaveBeenCalled()
  })

  it('skips whitespace-only lines', () => {
    const { stream, onLine, onMalformed } = makeStream()
    stream.push(buf('   \n\t\n{"a":1}\n  \t  \n'))
    expect(onLine).toHaveBeenCalledOnce()
    expect(onLine).toHaveBeenCalledWith({ a: 1 })
    expect(onMalformed).not.toHaveBeenCalled()
  })

  it('handles a chunk that is only newlines', () => {
    const { stream, onLine, onMalformed } = makeStream()
    stream.push(buf('\n\n\n'))
    expect(onLine).not.toHaveBeenCalled()
    expect(onMalformed).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Invalid JSON → onMalformed, continues parsing
// ---------------------------------------------------------------------------

describe('NdjsonStream — invalid JSON lines', () => {
  it('calls onMalformed for invalid JSON and continues parsing next line', () => {
    const { stream, onLine, onMalformed } = makeStream()
    stream.push(buf('not-json\n{"valid":true}\n'))
    expect(onMalformed).toHaveBeenCalledOnce()
    expect(onMalformed.mock.calls[0][0]).toBe('not-json')
    expect(onMalformed.mock.calls[0][1]).toBeInstanceOf(Error)
    expect(onLine).toHaveBeenCalledOnce()
    expect(onLine).toHaveBeenCalledWith({ valid: true })
  })

  it('calls onMalformed with the bad line string', () => {
    const { stream, onMalformed } = makeStream()
    const badLine = '{unclosed'
    stream.push(buf(`${badLine}\n`))
    expect(onMalformed).toHaveBeenCalledOnce()
    expect(onMalformed.mock.calls[0][0]).toBe(badLine)
    expect(onMalformed.mock.calls[0][1]).toBeInstanceOf(SyntaxError)
  })

  it('recovers after multiple malformed lines interspersed with valid ones', () => {
    const { stream, onLine, onMalformed } = makeStream()
    stream.push(buf('{"ok":1}\nbad\n{"ok":2}\nbad2\n{"ok":3}\n'))
    expect(onLine).toHaveBeenCalledTimes(3)
    expect(onMalformed).toHaveBeenCalledTimes(2)
    expect(onLine).toHaveBeenNthCalledWith(1, { ok: 1 })
    expect(onLine).toHaveBeenNthCalledWith(2, { ok: 2 })
    expect(onLine).toHaveBeenNthCalledWith(3, { ok: 3 })
  })

  it('calls onMalformed with an Error instance', () => {
    const { stream, onMalformed } = makeStream()
    stream.push(buf('bad json here\n'))
    expect(onMalformed.mock.calls[0][1]).toBeInstanceOf(Error)
  })
})

// ---------------------------------------------------------------------------
// 16MB line cap → LINE_TOO_LONG
// ---------------------------------------------------------------------------

describe('NdjsonStream — 16MB line cap', () => {
  it('emits LINE_TOO_LONG via onMalformed when buffer exceeds 16MB without newline', () => {
    const { stream, onLine, onMalformed } = makeStream()
    const LIMIT = 16 * 1024 * 1024
    // Push just over the limit without a newline
    const bigChunk = Buffer.alloc(LIMIT + 1, 0x61) // 'a' repeated
    stream.push(bigChunk)
    expect(onMalformed).toHaveBeenCalledOnce()
    expect(onMalformed.mock.calls[0][1]).toBeInstanceOf(Error)
    expect(onMalformed.mock.calls[0][1].message).toBe('LINE_TOO_LONG')
    expect(onLine).not.toHaveBeenCalled()
  })

  it('clears the buffer after LINE_TOO_LONG so subsequent valid lines parse', () => {
    const { stream, onLine, onMalformed } = makeStream()
    const LIMIT = 16 * 1024 * 1024
    const bigChunk = Buffer.alloc(LIMIT + 1, 0x61)
    stream.push(bigChunk)
    expect(onMalformed).toHaveBeenCalledOnce()
    // After clearing, a new valid line should parse correctly
    stream.push(buf('{"recovered":true}\n'))
    expect(onLine).toHaveBeenCalledOnce()
    expect(onLine).toHaveBeenCalledWith({ recovered: true })
  })

  it('does not trigger LINE_TOO_LONG if data arrives in chunks with newlines', () => {
    const { stream, onLine, onMalformed } = makeStream()
    const LIMIT = 16 * 1024 * 1024
    // Push 16MB split into two valid lines
    const half = Buffer.alloc(LIMIT / 2, 0x61)
    const jsonLine1 = buf('{"a":1}\n')
    const jsonLine2 = buf('{"b":2}\n')
    stream.push(jsonLine1)
    stream.push(half) // still accumulating, but no newline yet
    stream.push(buf('\n')) // flush the half as a whitespace-only (trimmed) line → skip
    stream.push(jsonLine2)
    // The large chunk gets trimmed to empty (all 'a's are not empty, so onMalformed fires for it)
    // Actually half is 'aaaa...' which is not valid JSON — onMalformed called once
    // But no LINE_TOO_LONG since it had a newline before hitting limit
    expect(onMalformed).toHaveBeenCalledOnce()
    expect(onMalformed.mock.calls[0][1].message).not.toBe('LINE_TOO_LONG')
    expect(onLine).toHaveBeenCalledTimes(2)
    expect(onMalformed).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ message: 'LINE_TOO_LONG' }))
  })
})

// ---------------------------------------------------------------------------
// end() — flushes partial trailing content
// ---------------------------------------------------------------------------

describe('NdjsonStream — end()', () => {
  it('flushes partial trailing content by appending a newline', () => {
    const { stream, onLine, onMalformed } = makeStream()
    stream.push(buf('{"partial":true}'))
    expect(onLine).not.toHaveBeenCalled()
    stream.end()
    expect(onLine).toHaveBeenCalledOnce()
    expect(onLine).toHaveBeenCalledWith({ partial: true })
    expect(onMalformed).not.toHaveBeenCalled()
  })

  it('does not emit for empty buffer on end()', () => {
    const { stream, onLine, onMalformed } = makeStream()
    stream.end()
    expect(onLine).not.toHaveBeenCalled()
    expect(onMalformed).not.toHaveBeenCalled()
  })

  it('does not emit for whitespace-only buffer on end()', () => {
    const { stream, onLine, onMalformed } = makeStream()
    stream.push(buf('   '))
    stream.end()
    expect(onLine).not.toHaveBeenCalled()
    expect(onMalformed).not.toHaveBeenCalled()
  })

  it('calls onMalformed for invalid JSON trailing content on end()', () => {
    const { stream, onMalformed } = makeStream()
    stream.push(buf('not-json'))
    stream.end()
    expect(onMalformed).toHaveBeenCalledOnce()
    expect(onMalformed.mock.calls[0][0]).toBe('not-json')
  })

  it('flushes multiple complete lines and partial content on end()', () => {
    const { stream, onLine, onMalformed } = makeStream()
    stream.push(buf('{"a":1}\n{"b":2}\n{"c":3}'))
    stream.end()
    expect(onLine).toHaveBeenCalledTimes(3)
    expect(onMalformed).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// UTF-8 multi-byte chars at chunk boundary
// ---------------------------------------------------------------------------

describe('NdjsonStream — UTF-8 multi-byte boundary', () => {
  it('handles UTF-8 multi-byte character split at chunk boundary without corruption', () => {
    const { stream, onLine, onMalformed } = makeStream()
    // '€' is 3 bytes: 0xe2 0x82 0xac
    const fullLine = `{"msg":"€ sign"}\n`
    const fullBuf = Buffer.from(fullLine, 'utf8')
    // Find the byte offset of '€' start (after {"msg":"  — 9 bytes)
    const splitAt = fullBuf.indexOf(0xe2) + 1 // split mid-codepoint
    const chunk1 = fullBuf.slice(0, splitAt)
    const chunk2 = fullBuf.slice(splitAt)
    stream.push(chunk1)
    stream.push(chunk2)
    expect(onLine).toHaveBeenCalledOnce()
    expect(onLine).toHaveBeenCalledWith({ msg: '€ sign' })
    expect(onMalformed).not.toHaveBeenCalled()
  })

  it('handles 4-byte emoji split across chunks', () => {
    const { stream, onLine, onMalformed } = makeStream()
    // '😀' is 4 bytes: 0xf0 0x9f 0x98 0x80
    const fullLine = `{"e":"😀"}\n`
    const fullBuf = Buffer.from(fullLine, 'utf8')
    const emojiIdx = fullBuf.indexOf(0xf0)
    // Split right in the middle of the emoji
    const chunk1 = fullBuf.slice(0, emojiIdx + 2)
    const chunk2 = fullBuf.slice(emojiIdx + 2)
    stream.push(chunk1)
    stream.push(chunk2)
    expect(onLine).toHaveBeenCalledOnce()
    expect(onLine).toHaveBeenCalledWith({ e: '😀' })
    expect(onMalformed).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// onFatal — 3 consecutive malformed lines trigger crash detection
// ---------------------------------------------------------------------------

describe('NdjsonStream — consecutive malformed crash (onFatal)', () => {
  it('calls onFatal after 3 consecutive malformed lines', () => {
    const { stream, onLine, onMalformed, onFatal } = makeStream()
    stream.push(buf('bad1\nbad2\nbad3\n'))
    expect(onMalformed).toHaveBeenCalledTimes(3)
    expect(onFatal).toHaveBeenCalledOnce()
    expect(onFatal.mock.calls[0][0]).toBeInstanceOf(Error)
    expect(onFatal.mock.calls[0][0].message).toBe('NDJSON_TOO_MANY_MALFORMED')
    expect(onLine).not.toHaveBeenCalled()
  })

  it('does not call onFatal when a valid line resets the consecutive counter', () => {
    const { stream, onLine, onMalformed, onFatal } = makeStream()
    stream.push(buf('bad1\nbad2\n{"ok":true}\nbad3\nbad4\n'))
    // Two malformed, then reset by valid, then two more malformed — never hits 3 in a row
    expect(onMalformed).toHaveBeenCalledTimes(4)
    expect(onFatal).not.toHaveBeenCalled()
    expect(onLine).toHaveBeenCalledOnce()
    expect(onLine).toHaveBeenCalledWith({ ok: true })
  })

  it('stops processing after onFatal is called', () => {
    const { stream, onLine, onFatal } = makeStream()
    // 3 malformed then a valid line — the valid line should not be reached after fatal
    stream.push(buf('bad1\nbad2\nbad3\n{"after":true}\n'))
    expect(onFatal).toHaveBeenCalledOnce()
    expect(onLine).not.toHaveBeenCalled()
  })

  it('calls onFatal after LINE_TOO_LONG counts toward consecutive malformed', () => {
    const { stream, onLine, onMalformed, onFatal } = makeStream()
    const LIMIT = 16 * 1024 * 1024
    // 2 malformed lines first, then a LINE_TOO_LONG — total 3 consecutive → onFatal
    stream.push(buf('bad1\nbad2\n'))
    const bigChunk = Buffer.alloc(LIMIT + 1, 0x61)
    stream.push(bigChunk)
    expect(onMalformed).toHaveBeenCalledTimes(3)
    expect(onFatal).toHaveBeenCalledOnce()
    expect(onLine).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Concurrent / interleaved valid and invalid chunks
// ---------------------------------------------------------------------------

describe('NdjsonStream — concurrent / interleaved chunks', () => {
  it('handles interleaved valid and invalid lines across multiple pushes', () => {
    const { stream, onLine, onMalformed } = makeStream()
    stream.push(buf('{"seq":1}\n'))
    stream.push(buf('bad-line\n'))
    stream.push(buf('{"seq":2}\n'))
    stream.push(buf('another-bad\n'))
    stream.push(buf('{"seq":3}\n'))
    expect(onLine).toHaveBeenCalledTimes(3)
    expect(onMalformed).toHaveBeenCalledTimes(2)
    expect(onLine).toHaveBeenNthCalledWith(1, { seq: 1 })
    expect(onLine).toHaveBeenNthCalledWith(2, { seq: 2 })
    expect(onLine).toHaveBeenNthCalledWith(3, { seq: 3 })
    expect(onMalformed.mock.calls[0][0]).toBe('bad-line')
    expect(onMalformed.mock.calls[1][0]).toBe('another-bad')
  })

  it('correctly accumulates across many small single-byte pushes', () => {
    const { stream, onLine, onMalformed } = makeStream()
    const line = '{"x":42}\n'
    for (const byte of Buffer.from(line, 'utf8')) {
      stream.push(Buffer.from([byte]))
    }
    expect(onLine).toHaveBeenCalledOnce()
    expect(onLine).toHaveBeenCalledWith({ x: 42 })
    expect(onMalformed).not.toHaveBeenCalled()
  })

  it('handles empty chunks without side effects', () => {
    const { stream, onLine, onMalformed } = makeStream()
    stream.push(buf(''))
    stream.push(buf('{"a":1}\n'))
    stream.push(buf(''))
    expect(onLine).toHaveBeenCalledOnce()
    expect(onMalformed).not.toHaveBeenCalled()
  })

  it('parses a large number of lines correctly', () => {
    const { stream, onLine, onMalformed } = makeStream()
    const lines = Array.from({ length: 500 }, (_, i) => `{"i":${i}}\n`).join('')
    stream.push(buf(lines))
    expect(onLine).toHaveBeenCalledTimes(500)
    expect(onMalformed).not.toHaveBeenCalled()
    expect(onLine).toHaveBeenNthCalledWith(1, { i: 0 })
    expect(onLine).toHaveBeenNthCalledWith(500, { i: 499 })
  })
})
