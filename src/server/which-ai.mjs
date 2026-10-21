// Which AI is behind this editor, for the AI line's "More in Claude" / "More in Codex" (a try of v0.1.8, 2026-10-21: "it
// should say 'see Claude for details' — Claude if you use Claude, Codex if Codex, or something general like 'see your AI'").
//
// WHY: the AI's line in the editor is one line ("Made it a triple jump / 'let me triple jump' · Done."). The AI's full
// answer — what it changed, why, what it would do next — is in its own window, and nothing on the line said so.
//
// Only what the editor already knows, never a new question to the person:
//   1. the plugin's wake hook is waiting for this folder (.studio/wake.json, ai-wake.mjs): only Claude Code runs it
//      (Codex has no hooks), so that is Claude, whatever started the editor;
//   2. the environment the editor was started in. The AI starts the editor from its own shell (SKILL.md §1, `--detach`
//      keeps the environment, lifecycle.mjs): Claude Code puts CLAUDECODE=1 (and CLAUDE_CODE_ENTRYPOINT) there, Codex
//      its CODEX_* variables (CODEX_SANDBOX, CODEX_SANDBOX_NETWORK_DISABLED, CODEX_THREAD_ID…).
//      CODEX_HOME is left out on purpose: people set it in their shell profile, so it is there in Claude Code too and
//      in a plain terminal.
// Anything else (a plain terminal, another agent, a hosted editor): undefined, and the line says "More in your AI".
// Claude wins over Codex when both are there (Codex started inside a Claude Code session is still read in Claude).

/** @typedef {'claude' | 'codex'} AiAgent */

/**
 * @param {Record<string, string | undefined>} env  the editor's environment (process.env)
 * @returns {AiAgent | undefined}
 */
export function agentFromEnv(env) {
  if (!env) return undefined;
  if (env.CLAUDECODE === '1' || env.CLAUDE_CODE_ENTRYPOINT) return 'claude';
  if (Object.keys(env).some((k) => k.startsWith('CODEX_') && k !== 'CODEX_HOME' && env[k])) return 'codex';
  return undefined;
}

/**
 * @param {{ wake: boolean, env: AiAgent | undefined }} o  wake = the wake hook's heartbeat is fresh (ai-watch.mjs wakeAlive)
 * @returns {AiAgent | undefined}
 */
export function whichAi(o) {
  return o.wake ? 'claude' : o.env;
}
