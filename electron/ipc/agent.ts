// agent:* / claude:detect IPC handlers — binary detection and agent-session
// request dispatch (start/cancel/kill/approval). Extracted from main.ts
// (#580); shared state main.ts still owns (the shell-env cache, the vault
// allowlist) flows in via `AgentHandlersCtx` rather than a circular import of
// main.js. registerDynamicShell/assertAgentDetectAllowed/registerDetectedAgent
// (stateless guard modules) and spawnAgent/cancelAgent/killAgentSession/
// handleApproval (electron/agent/index.ts session orchestration) are imported
// directly, same as electron/ipc/pty.ts imports assertPtySpawnAllowed.
import { ipcMain } from 'electron'
import path from 'node:path'
import fs from 'node:fs/promises'
import { statSync } from 'node:fs'
import { assertAllowedVault } from '../vault-allowlist.js'
import { registerDynamicShell } from '../pty-spawn-guard.js'
import { assertAgentDetectAllowed, registerDetectedAgent } from '../agent-detect-guard.js'
import { spawnAgent, cancelAgent, killAgentSession, handleApproval } from '../agent/index.js'
import type { AgentRequest, AgentEvent } from '../agent/protocol.js'

export type AgentHandlersCtx = {
  getShellEnv: () => NodeJS.ProcessEnv
  getAllowedVaultPaths: () => Set<string>
}

function detectBinary(name: string, ctx: AgentHandlersCtx): string | null {
  // Defensive: only allow simple binary names — no path traversal or shell.
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) return null
  const env = ctx.getShellEnv()
  const pathDirs = (env.PATH || '').split(':').filter(Boolean)
  const fallback = [path.join(env.HOME || '', '.local/bin'), '/usr/local/bin', '/opt/homebrew/bin']
  for (const dir of [...pathDirs, ...fallback]) {
    const candidate = path.join(dir, name)
    try {
      const st = statSync(candidate)
      if (st.isFile() || st.isSymbolicLink()) return candidate
    } catch {
      // ignore
    }
  }
  return null
}

type AgentResponse = { ok: true } | { ok: false; error: string }

// L2: sessionId must be alphanumeric + dash/underscore only — no path traversal.
const SESSION_ID_RE = /^[a-zA-Z0-9_-]+$/

function requireAgentRequest(raw: unknown): AgentRequest {
  if (!raw || typeof raw !== 'object' || !('type' in raw)) {
    throw new Error('AGENT_INVALID_REQUEST')
  }
  const obj = raw as Record<string, unknown>
  if ('sessionId' in obj) {
    if (typeof obj.sessionId !== 'string' || !SESSION_ID_RE.test(obj.sessionId)) {
      throw new Error('AGENT_INVALID_REQUEST')
    }
  }
  // M3: validate decision.kind for approval requests.
  if (obj.type === 'approval') {
    const d = obj.decision as Record<string, unknown> | undefined
    if (!d || (d.kind !== 'allow' && d.kind !== 'deny')) {
      throw new Error('AGENT_INVALID_REQUEST')
    }
  }
  return raw as AgentRequest
}

export function registerAgentHandlers(ctx: AgentHandlersCtx): void {
  ipcMain.handle('agent:detect', async (_e, name: string) => {
    assertAgentDetectAllowed(name)
    const detected = detectBinary(name, ctx)
    if (detected) {
      registerDetectedAgent(detected)
      // Also register on the pty allowlist so users can open the agent in the
      // legacy xterm terminal via pty:spawn (the chat panel uses child_process.spawn,
      // but the terminal panel uses pty.spawn and needs the binary allowlisted).
      registerDynamicShell(detected)
    }
    return detected
  })

  // Back-compat shim for the previous renderer API.
  ipcMain.handle('claude:detect', async () => {
    const detected = detectBinary('claude', ctx)
    if (detected) registerDynamicShell(detected)
    return detected
  })

  ipcMain.handle('agent:request', async (e, raw: unknown): Promise<AgentResponse> => {
    try {
      const req = requireAgentRequest(raw)

      // Events go back to the renderer that made the request, not a global win ref.
      const sender = e.sender
      function senderSend(channel: string, payload: AgentEvent) {
        try {
          if (!sender.isDestroyed()) sender.send(channel, payload)
        } catch {
          // renderer being torn down — ignore
        }
      }

      if (req.type === 'start') {
        // C2: vaultRoot must be an allowed vault path (opened via dialog or settings).
        let resolvedVault: string
        try {
          resolvedVault = await fs.realpath(path.resolve(req.vaultRoot))
        } catch {
          throw new Error('MARVIN_VAULT_NOT_ALLOWED')
        }
        assertAllowedVault(resolvedVault, ctx.getAllowedVaultPaths())

        const binary =
          process.env.NODE_ENV === 'test' && process.env.MOCK_CLAUDE_BIN
            ? process.env.MOCK_CLAUDE_BIN
            : detectBinary('claude', ctx)
        if (!binary) {
          senderSend(`agent:event:${req.sessionId}`, {
            type: 'error',
            sessionId: req.sessionId,
            code: 'AGENT_NOT_FOUND',
            message: 'claude binary not found in PATH',
            recoverable: false,
          })
          return { ok: true }
        }
        // Register the binary so pty-spawn-guard validates it if ever needed.
        registerDynamicShell(binary)
        await spawnAgent({ ...req, vaultRoot: resolvedVault }, binary, senderSend)
        return { ok: true }
      }

      if (req.type === 'cancel') {
        await cancelAgent(req.sessionId)
        return { ok: true }
      }

      if (req.type === 'kill') {
        await killAgentSession(req.sessionId)
        return { ok: true }
      }

      if (req.type === 'approval') {
        handleApproval(req.sessionId, req.toolUseId, req.decision)
        return { ok: true }
      }

      return { ok: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { ok: false, error: message }
    }
  })
}
