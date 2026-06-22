// Newline-delimited JSON parser with backpressure safety.
// Consumes Buffer chunks, emits one parsed object per complete line.
// Malformed lines are forwarded to onMalformed without crashing.
// Safety limits:
//   - 16 MB line cap: if the internal buffer exceeds this, the line is
//     treated as malformed and the buffer is reset.
//   - 3 consecutive malformed lines trigger a fatal error via onFatal,
//     signalling the caller that the stream is unrecoverable.

import { StringDecoder } from 'node:string_decoder'

const LINE_CAP_BYTES = 16 * 1024 * 1024
const MALFORMED_CRASH_THRESHOLD = 3

export class NdjsonStream {
  private buf = ''
  private consecutiveMalformed = 0
  // StringDecoder holds incomplete multi-byte sequences between chunks.
  private readonly decoder = new StringDecoder('utf8')

  readonly #onLine: (obj: unknown) => void
  readonly #onMalformed: (line: string, err: Error) => void
  readonly #onFatal: (err: Error) => void

  constructor(
    onLine: (obj: unknown) => void,
    onMalformed: (line: string, err: Error) => void,
    onFatal: (err: Error) => void
  ) {
    this.#onLine = onLine
    this.#onMalformed = onMalformed
    this.#onFatal = onFatal
  }

  push(chunk: Buffer): void {
    this.buf += this.decoder.write(chunk)

    let nl: number
    while ((nl = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, nl).trim()
      this.buf = this.buf.slice(nl + 1)
      if (!line) continue
      try {
        this.#onLine(JSON.parse(line))
        this.consecutiveMalformed = 0
      } catch (e) {
        this.consecutiveMalformed++
        this.#onMalformed(line, e as Error)
        if (this.consecutiveMalformed >= MALFORMED_CRASH_THRESHOLD) {
          this.#onFatal(new Error('NDJSON_TOO_MANY_MALFORMED'))
          return
        }
      }
    }

    if (this.buf.length > LINE_CAP_BYTES) {
      this.consecutiveMalformed++
      this.#onMalformed(this.buf, new Error('LINE_TOO_LONG'))
      this.buf = ''
      if (this.consecutiveMalformed >= MALFORMED_CRASH_THRESHOLD) {
        this.#onFatal(new Error('NDJSON_TOO_MANY_MALFORMED'))
      }
    }
  }

  // Flush any remaining data in the buffer as a final line.
  end(): void {
    // Flush any incomplete multi-byte sequence held by the decoder.
    const tail = this.decoder.end()
    if (tail) this.buf += tail
    if (this.buf.trim()) {
      this.push(Buffer.from('\n'))
    }
  }
}
