#!/usr/bin/env bash
#
# block-force-push.sh — Claude Code PreToolUse hook (issue #201)
#
# Blocks `git push` with force semantics (--force / --force-with-lease /
# --force-if-includes / -f / +refspec) before the Bash tool runs. This is a
# deterministic guardrail on top of the prose rule in
# .claude/rules/git-workflow.md ("never force-push main or develop").
#
# Contract (PreToolUse): receives the tool-call JSON on stdin; the command
# string lives at tool_input.command. To block, we emit a deny decision on
# stdout and exit 2 (per Claude Code hook semantics).
#
# Parser: node — guaranteed present for anyone who can run this Electron/Vite
# project. Fast path below skips spawning node entirely unless the payload even
# mentions "push", so the hook is near-zero-cost for ordinary commands.
#
# Failure mode: if node is missing the hook exits non-zero-non-2 (non-blocking)
# and the push proceeds. That fail-open is intentional — server-side GitHub
# branch protection is the real backstop for main/develop, and blocking ALL
# pushes on a missing interpreter would be more harmful than the gap.

payload="$(cat)"

# Fast path: no "push" anywhere in the payload → cannot be a git push. Allow
# without spawning a parser.
case "$payload" in
  *push*) ;;
  *) exit 0 ;;
esac

FP_PAYLOAD="$payload" node -e '
  const raw = process.env.FP_PAYLOAD || "";
  let j;
  try { j = JSON.parse(raw); } catch (e) { process.exit(0); }
  if (j.tool_name !== "Bash") process.exit(0);

  const cmd = (j.tool_input && j.tool_input.command) || "";

  // Locate a "git ... push" in COMMAND POSITION: at the start of the line or
  // right after a shell separator (; && || | newline "("), optionally behind
  // env assignments / sudo / env. Requiring command position avoids blocking
  // the literal phrase when it appears as data (e.g. `echo "git push --force"`
  // or prose mentioning it). Tolerates "git -C dir push", "git --no-pager push".
  const m = cmd.match(
    /(?:^|[;&|\n(])\s*((?:\w+=\S*\s+|sudo\s+|env\s+)*git\s+(?:-C\s+\S+\s+|--\S+\s+)*push\b)/
  );
  if (!m) process.exit(0);

  // Scope force detection to this push command only, up to the next shell
  // separator, so a "-f" belonging to an earlier command in a compound line
  // (e.g. "grep -f x && git push") does not trigger a false positive.
  const tail = cmd.slice(m.index + m[0].indexOf(m[1]));
  const seg = tail.split(/&&|\|\||[;|\n]/)[0];
  const args = seg.replace(/^.*?push\b/, "");

  const forced =
    /--force\b/.test(seg) ||                            // --force, --force-with-lease, --force-if-includes
    /(?:^|\s)-[A-Za-z]*f[A-Za-z]*(?=\s|$)/.test(seg) || // -f or bundled short flags containing f
    /\s\+\S/.test(args);                                // +refspec (e.g. "git push origin +main")

  if (!forced) process.exit(0);

  const reason =
    "Force-push blocked by .claude/hooks/block-force-push.sh (issue #201). " +
    "Rewriting history is prohibited on this repo — see .claude/rules/git-workflow.md. " +
    "main and develop are also protected server-side. If a force-push is genuinely " +
    "required, the human operator must run it manually outside Claude Code.";

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  }));
  process.stderr.write(reason + "\n");
  process.exit(2);
'
exit $?
