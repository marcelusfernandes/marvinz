// Demo bridge mock for window.marvin (issue #441).
//
// Implements the surface the real renderer touches at boot/read paths against
// an in-memory demo vault, plus a scripted Claude agent session. Every
// destructive or OS-bound call is a safe no-op that returns a plausibly shaped
// value so the real <App> boots in a plain browser with zero console errors.
//
// Additions-only: nothing under src/ outside src/demo/ is changed.

import type {
  MarvinAPI,
  Settings,
  FileNode,
  MoveResult,
  SnapshotEnvelope,
  ImportExternalResult,
  SearchResult,
} from '../types'
import type { AgentEvent, AgentRequest, ApprovalDecision } from '../shared/agent-protocol'
import { DEMO_VAULT_ROOT, DEMO_FILES, DEMO_TREE } from './demo-vault'

const noopUnsub = () => {}
const fileContent = new Map(DEMO_FILES.map((f) => [f.path, f.content]))

// Mutable so installMarvinMock can set the theme passed from the host page.
let demoColorTheme: 'light' | 'dark' = 'light'

const DEMO_SETTINGS: Settings = {
  vaultPath: DEMO_VAULT_ROOT,
  iconTheme: 'material',
  colorTheme: 'light',
  visualStyle: 'modern',
  themeFlavor: 'default',
  terminalModeEnabled: false,
  agentsPaneTransparent: false,
  editorEffectsMaster: true,
  editorEffectCaretSlide: true,
  saveMode: 'auto',
}

const okEnvelope = <T>(data: T): SnapshotEnvelope<T> => ({ ok: true, data })

// ---- Scripted Claude session -------------------------------------------------
// Replays a believable tool-call turn into the agent sidebar. Driven entirely
// by timers; the approval gate resolves when the renderer calls agent.approve.

type EventCb = (event: AgentEvent) => void
const agentListeners = new Map<string, EventCb>()
const pendingApprovals = new Map<string, () => void>()
const startedSessions = new Set<string>()
const timers: ReturnType<typeof setTimeout>[] = []

function later(ms: number, fn: () => void) {
  timers.push(setTimeout(fn, ms))
}

function emit(sessionId: string, event: AgentEvent) {
  agentListeners.get(sessionId)?.(event)
}

function runScriptedSession(sessionId: string) {
  const messageId = `${sessionId}-m1`
  const toolUseId = `${sessionId}-t1`
  const now = Date.now()

  later(150, () =>
    emit(sessionId, {
      type: 'session-init',
      sessionId,
      provider: 'claude',
      cliSessionId: `demo-${sessionId}`,
      model: 'claude-opus',
      cwd: DEMO_VAULT_ROOT,
      startedAt: now,
    })
  )

  later(400, () => emit(sessionId, { type: 'message-start', sessionId, messageId, role: 'assistant' }))

  const reply =
    "I'll record the restore decision in research-notes.md and snapshot the change so you can roll it back."
  reply.split(' ').forEach((word, i) => {
    later(600 + i * 45, () =>
      emit(sessionId, {
        type: 'text-delta',
        sessionId,
        messageId,
        delta: (i === 0 ? '' : ' ') + word,
        seq: i,
      })
    )
  })

  const afterText = 600 + reply.split(' ').length * 45 + 250

  later(afterText, () =>
    emit(sessionId, {
      type: 'tool-use',
      sessionId,
      toolUseId,
      name: 'write_file',
      input: { path: 'research-notes.md' },
      messageId,
      snapshotSaved: true,
      snapshotTurnId: 'demo-turn-1',
    })
  )

  later(afterText + 150, () =>
    emit(sessionId, {
      type: 'permission-request',
      sessionId,
      toolUseId,
      toolName: 'write_file',
      input: { path: 'research-notes.md' },
      risk: 'safe',
      suggestion: 'allow',
      snapshotSaved: true,
      snapshotTurnId: 'demo-turn-1',
    })
  )

  // Resolve the rest of the turn once the user approves (or auto-advance as a
  // fallback so the demo never stalls if approval UI is not interacted with).
  const finishTurn = () => {
    emit(sessionId, {
      type: 'tool-result',
      sessionId,
      toolUseId,
      output: 'research-notes.md updated',
      isError: false,
      durationMs: 1200,
    })
    later(250, () =>
      emit(sessionId, {
        type: 'turn-snapshot-summary',
        sessionId,
        turnId: 'demo-turn-1',
        fileCount: 1,
        fileNames: ['research-notes.md'],
      })
    )
    later(400, () =>
      emit(sessionId, { type: 'message-end', sessionId, messageId, stopReason: 'end_turn' })
    )
    later(550, () =>
      emit(sessionId, {
        type: 'turn-result',
        sessionId,
        usage: { inputTokens: 1840, outputTokens: 96 },
        costUSD: 0.012,
        durationMs: 2400,
      })
    )
  }

  pendingApprovals.set(toolUseId, finishTurn)
  later(afterText + 6000, () => {
    // Fallback auto-approve so the loop is self-completing in the demo.
    if (pendingApprovals.has(toolUseId)) {
      pendingApprovals.delete(toolUseId)
      finishTurn()
    }
  })
}

// ---- The mock API ------------------------------------------------------------

export const marvinMock: MarvinAPI = {
  settings: {
    get: async () => ({ ...DEMO_SETTINGS, colorTheme: demoColorTheme }),
    set: async (partial) => ({ ...DEMO_SETTINGS, colorTheme: demoColorTheme, ...partial }),
  },

  vault: {
    pick: async () => DEMO_VAULT_ROOT,
    current: async () => DEMO_VAULT_ROOT,
    tree: async () => DEMO_TREE as FileNode[],
    watch: async () => {},
    onChanged: () => noopUnsub,
  },

  file: {
    pick: async () => null,
    read: async (filePath) => fileContent.get(filePath) ?? '',
    // Edits live only in memory for the demo — keep the in-memory copy in sync
    // so re-reads reflect the user's typing, but nothing touches disk.
    write: async (filePath, content) => {
      fileContent.set(filePath, content)
    },
    exportPdf: async () => {},
    create: async (parentDir, name) => `${parentDir}/${name}`,
    writeBinary: async (payload) => `${payload.vaultPath}/${payload.relPath}`,
    copy: async (srcPath, destDir) => `${destDir}/${srcPath.split('/').pop()}`,
    moveBatch: async (srcs, destDir) =>
      srcs.map(
        (src) => ({ src, dest: `${destDir}/${src.split('/').pop()}`, ok: true }) as MoveResult
      ),
    onChanged: () => noopUnsub,
  },

  office: {
    readDocx: async () => ({ html: '', messages: [] }),
    writeDocx: async () => {},
    readXlsx: async () => ({ rows: [], sheetNames: ['Sheet1'] }),
    writeXlsx: async () => {},
  },

  folder: {
    create: async (parentDir, name) => `${parentDir}/${name}`,
  },

  path: {
    rename: async (_oldPath, newPath) => newPath,
    trash: async () => {},
  },

  claude: {
    detect: async () => '/demo/claude',
  },

  agent: {
    // Only Claude is "installed" so the New-agent action opens a Claude chat
    // directly (the single-agent path), without the native context-menu picker
    // that the demo cannot drive.
    detect: async (name) => (name === 'claude' ? '/demo/claude' : null),
    request: async (req: AgentRequest) => {
      if (req.type === 'start') {
        if (!startedSessions.has(req.sessionId)) {
          startedSessions.add(req.sessionId)
          runScriptedSession(req.sessionId)
        }
      } else if (req.type === 'approval') {
        const resolve = pendingApprovals.get(req.toolUseId)
        if (resolve) {
          pendingApprovals.delete(req.toolUseId)
          // Only advance on allow; a deny ends the turn quietly.
          if ((req.decision as ApprovalDecision).kind === 'allow') resolve()
        }
      }
      return { ok: true as const }
    },
    approve: async (_sessionId, toolUseId, decision) => {
      const resolve = pendingApprovals.get(toolUseId)
      if (resolve) {
        pendingApprovals.delete(toolUseId)
        if (decision.kind === 'allow') resolve()
      }
      return { ok: true as const }
    },
    onEvent: (sessionId, cb) => {
      agentListeners.set(sessionId, cb)
      return () => agentListeners.delete(sessionId)
    },
  },

  browser: {
    create: async (opts) => ({ url: opts.url, title: 'Preview', canBack: false, canForward: false }),
    navigate: async () => {},
    back: async () => {},
    forward: async () => {},
    reload: async () => {},
    stop: async () => {},
    setBounds: async () => {},
    setGeometry: async () => {},
    setActive: async () => {},
    setAllHidden: async () => {},
    close: async () => {},
    onEvent: () => noopUnsub,
  },

  shell: {
    openExternal: async () => {},
    reveal: async () => {},
  },

  pty: {
    spawn: async () => ({ pid: 0 }),
    write: async () => {},
    resize: async () => {},
    kill: async () => {},
    onData: () => noopUnsub,
    onExit: () => noopUnsub,
  },

  snapshot: {
    listTurns: async () => okEnvelope([]),
    listForFile: async () => okEnvelope([]),
    read: async () => okEnvelope(''),
    restore: async () => okEnvelope({ preTurnId: 'demo-pre' }),
    saveBuffer: async () => okEnvelope({ turnId: 'demo-turn', saved: true }),
    saveExternalChange: async () => okEnvelope({ turnId: 'demo-turn', saved: true }),
    onTurnCompleted: () => noopUnsub,
  },

  editor: {
    readClipboard: async () => '',
    writeClipboard: async () => {},
    writeClipboardRich: async () => {},
    readClipboardRich: async () => ({ html: '', text: '' }),
    getSpellcheckContext: async () => ({ misspelledWord: '', suggestions: [] }),
  },

  app: {
    showContextMenu: async () => null,
    canPaste: async () => false,
    onMenuAction: () => noopUnsub,
    setMenuNoteContext: () => {},
    confirmUnsavedChanges: async () => 'discard',
  },

  fs: {
    importExternal: async () => ({ imported: [], skipped: [] }) as ImportExternalResult,
    getPathForFile: () => '',
  },

  search: {
    content: async (): Promise<SearchResult> => [],
  },
}

export function installMarvinMock(theme: 'light' | 'dark' = 'light') {
  demoColorTheme = theme
  ;(window as unknown as { marvin: MarvinAPI }).marvin = marvinMock
}
