import type { Terminal, ILink, ILinkProvider, ILinkHandler } from '@xterm/xterm'
import { resolveTerminalPath } from './terminalPathResolver'

type Options = {
  vaultPath: string
  /** Opens the resolved absolute path in the editor/preview pane. */
  onOpenFile: (absolutePath: string) => void
}

/**
 * Resolves the URI of an OSC 8 hyperlink (as emitted by CLIs like Claude Code
 * for file references) to an absolute path inside the vault. Handles file://
 * URIs and bare/relative paths; returns null for anything outside the vault or
 * for non-file URIs (http, mailto, …). Pure — existence is checked on open.
 */
export function resolveOsc8Uri(uri: string, vaultPath: string): string | null {
  if (!uri || !vaultPath) return null
  let pathPart = uri
  if (/^file:\/\//i.test(uri)) {
    try {
      pathPart = decodeURIComponent(new URL(uri).pathname)
    } catch {
      return null
    }
  } else if (/^[a-z][a-z0-9+.-]*:/i.test(uri)) {
    // Some other scheme (http, mailto, vscode, …) — not a vault file.
    return null
  }
  const resolved = resolveTerminalPath(pathPart, vaultPath)
  return resolved ? resolved.absolutePath : null
}

// Matches relative file paths printed by agent CLIs:
//   src/foo.tsx · ./docs/spec.md · a/src/foo.tsx · electron/main.ts:42 · README.md
// A leading lookbehind blocks absolute paths (the tail of `/usr/bin/foo.ts` is
// preceded by `/`). Three alternatives, most specific first:
//  1. ./ ../ a/ b/ prefix + optional dirs + file
//  2. one or more directory segments + file
//  3. a bare root-level file (no slash) — restricted to an alphabetic-led,
//     2-6 char extension so version strings (v2.1.150, 2.5s) don't false-match.
const FILE = '[\\w.@~+-]+\\.[\\w]+(?::\\d+(?::\\d+)?)?'
const BARE = '[\\w@~+-]+\\.[A-Za-z][A-Za-z0-9]{1,5}(?::\\d+(?::\\d+)?)?'
const PATH_SOURCE =
  '(?<![\\w./-])(' +
  `(?:(?:\\.{1,2}\\/|[ab]\\/)(?:[\\w.@~+-]+\\/)*|(?:[\\w.@~+-]+\\/)+)${FILE}` +
  `|${BARE}` +
  ')'

/** Fresh regex per call so the global `lastIndex` is never shared. */
export function makePathRegex(): RegExp {
  return new RegExp(PATH_SOURCE, 'g')
}

export function createTerminalLinkProvider(
  term: Terminal,
  { vaultPath, onOpenFile }: Options,
): ILinkProvider {
  const activate = (event: MouseEvent, text: string) => {
    // Cmd (macOS) / Ctrl (Win/Linux) is required — a plain click keeps the
    // terminal's native text-selection behavior.
    if (!event.metaKey && !event.ctrlKey) return
    const resolved = resolveTerminalPath(text, vaultPath)
    if (!resolved) return
    onOpenFile(resolved.absolutePath)
  }

  return {
    provideLinks(y, callback) {
      // xterm passes a 1-based buffer line number; getLine is 0-based.
      const line = term.buffer.active.getLine(y - 1)?.translateToString(true)
      if (!line) {
        callback(undefined)
        return
      }
      const links: ILink[] = []
      const re = makePathRegex()
      let match: RegExpExecArray | null
      while ((match = re.exec(line)) !== null) {
        const text = match[1]
        const startX = match.index + 1 // ranges are 1-based
        links.push({
          text,
          range: {
            start: { x: startX, y },
            end: { x: startX + text.length - 1, y },
          },
          decorations: { pointerCursor: true, underline: true },
          activate,
        })
      }
      callback(links.length > 0 ? links : undefined)
    },
  }
}

/**
 * Handles OSC 8 hyperlinks emitted by the agent CLI (Claude Code renders file
 * references as OSC 8 links). Cmd/Ctrl+Click opens the file in our editor
 * instead of xterm's default confirm() dialog. `allowNonHttpProtocols` must be
 * set on the Terminal so file:// URIs reach this handler.
 */
export function createOsc8LinkHandler(
  { vaultPath, onOpenFile }: Options,
): ILinkHandler {
  return {
    allowNonHttpProtocols: true,
    activate(event, uri) {
      if (!event.metaKey && !event.ctrlKey) return
      const absolutePath = resolveOsc8Uri(uri, vaultPath)
      if (!absolutePath) return
      onOpenFile(absolutePath)
    },
  }
}
