// The real AI side of the real-agent play test: Claude Code or Codex, run the way a newcomer runs them, in an
// empty folder, with this checkout's plugin, and talked to in plain English.
//
// WHY two drivers that look the same from outside: the play test (realagent.mjs) only needs "say this", "is it
// still working?", "what did it say last?" and a transcript. How each agent keeps a conversation going differs:
//
// - Claude Code: ONE long `claude -p --input-format stream-json` process. The conversation stays open while stdin
//   is open, and — the important part — a background watch (the Monitor tool on `studio.mjs --watch`, SKILL.md §3)
//   wakes the agent by itself and starts a new turn with no user message. That is what an interactive session does,
//   so the editor's "Your AI has it" can be measured for real. (Tried 10/17: `claude -p` + `--resume` per message
//   ends the process after each answer, which kills the watch; nothing would ever wake the agent.)
// - Codex: `codex exec --json` for the first message, `codex exec resume <thread>` for each next one. Nothing wakes
//   Codex between messages (the skill says so and tells it not to run the watch), so the newcomer types "look" in
//   Codex when the editor says the AI isn't watching.
//
// A newcomer's environment, not the developer's: Claude runs with `--setting-sources project` (no user hooks or
// settings) and the user CLAUDE.md files excluded (they say "always answer in Japanese" on this machine); Codex runs
// with its own temporary CODEX_HOME (no user AGENTS.md / config), signed in by copying the existing sign-in file
// there (never printed). Both get LANG=en_US.UTF-8 and a PATH whose first `open` only writes the URL to a file:
// the skill tells the editor to open the person's default browser, and the play test must never open a real one.
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const now = (t0) => (Date.now() - t0) / 1000;

/** A PATH folder whose `open` / `xdg-open` record the URL instead of opening a browser. */
export function fakeOpener(dir, logFile) {
  mkdirSync(dir, { recursive: true });
  for (const name of ['open', 'xdg-open']) {
    const f = join(dir, name);
    writeFileSync(f, `#!/bin/sh\necho "$(date +%s) $*" >> '${logFile}'\n`);
    chmodSync(f, 0o755);
  }
  return dir;
}

/** The newcomer's environment for an agent: English, the fake opener first on the PATH. */
export function agentEnv(binDir, extra = {}) {
  return { ...process.env, PATH: `${binDir}:${process.env.PATH}`, LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8', ...extra };
}

/** Shared bookkeeping: transcript, busy flag, the last thing the agent said in a finished turn. */
function base(t0) {
  const log = [];
  const waiters = new Set();
  const st = {
    t0, log, busy: false, idleSince: Date.now(), turns: 0, lastText: '', lastTurnText: '', cost: 0, error: null,
    add(who, text) { log.push({ s: now(t0), who, text }); },
    setBusy(b) {
      if (st.busy === b) return;
      st.busy = b;
      if (!b) { st.idleSince = Date.now(); st.turns += 1; }
      for (const w of waiters) w();
    },
    /** Wait until the agent has been idle for `quietMs` (or `maxMs` passed). Returns true when idle. */
    async waitIdle(maxMs, quietMs = 2500) {
      const end = Date.now() + maxMs;
      while (Date.now() < end) {
        if (!st.busy && Date.now() - st.idleSince >= quietMs) return true;
        await new Promise((r) => { const w = () => { waiters.delete(w); r(); }; waiters.add(w); setTimeout(w, 250); });
      }
      return !st.busy;
    },
  };
  return st;
}

/**
 * Claude Code in one long stream-json conversation.
 * opts: { cwd, env, pluginDir, permissionMode, model }
 */
export function claudeAgent({ cwd, env, pluginDir, permissionMode = 'auto', model }) {
  const t0 = Date.now();
  const st = base(t0);
  const cfg = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
  // Exclude the developer's own CLAUDE.md files (the config dir and ~/.claude, which may be a link to it).
  const settings = { claudeMdExcludes: [`${cfg}/**`, `${join(homedir(), '.claude')}/**`], autoMemoryEnabled: false };
  const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
    '--setting-sources', 'project', '--settings', JSON.stringify(settings),
    '--plugin-dir', pluginDir, '--permission-mode', permissionMode];
  if (model) args.push('--model', model);
  const proc = spawn('claude', args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = '';
  let started = false;
  proc.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      let m;
      try { m = JSON.parse(line); } catch { continue; }
      if (m.type === 'system' && m.subtype === 'init') {
        // The first init is the session; later ones are turns the agent starts by itself (a watch line woke it).
        if (started && !st.busy) st.add('sys', 'woke up by itself (background watch line)');
        started = true;
        st.setBusy(true);
      } else if (m.type === 'system' && m.subtype === 'task_notification') {
        st.add('sys', `background task: ${(m.summary || m.status || '').toString().slice(0, 200)}`);
      } else if (m.type === 'assistant') {
        for (const c of m.message?.content || []) {
          if (c.type === 'text' && c.text.trim()) { st.add('agent', c.text.trim()); st.lastText = c.text.trim(); }
          else if (c.type === 'tool_use') st.add('tool', `${c.name} ${toolLine(c.name, c.input)}`);
        }
      } else if (m.type === 'user' && Array.isArray(m.message?.content)) {
        for (const c of m.message.content) {
          if (c.type === 'tool_result' && c.is_error) st.add('tool-error', flat(c.content).slice(0, 400));
        }
      } else if (m.type === 'result') {
        st.cost = m.total_cost_usd ?? st.cost;
        st.lastTurnText = (m.result || st.lastText || '').trim();
        if (m.permission_denials?.length) st.add('denied', JSON.stringify(m.permission_denials).slice(0, 400));
        st.setBusy(false);
      }
    }
  });
  let errBuf = '';
  proc.stderr.on('data', (d) => { errBuf += d; });
  proc.on('exit', (c) => { st.add('sys', `claude exited (${c}) ${errBuf.trim().slice(0, 300)}`); st.exited = true; st.setBusy(false); });
  return {
    name: 'claude',
    st,
    /** One user message (the newcomer typing in Claude Code). */
    say(text) {
      st.add('user', text);
      st.setBusy(true);
      proc.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: text } }) + '\n');
    },
    async stop() {
      try { proc.stdin.end(); } catch { /* gone */ }
      await new Promise((r) => { if (proc.exitCode !== null) return r(); proc.once('exit', r); setTimeout(() => { try { proc.kill('SIGTERM'); } catch { /* gone */ } r(); }, 8000); });
    },
  };
}

/** Find (or fetch once with npx) a working `codex` binary. Returns its path, or null with a reason. */
export function findCodex(cacheDir) {
  const ok = (bin) => spawnSync(bin, ['--version'], { encoding: 'utf8' }).status === 0;
  if (process.env.STUDIO_CODEX && ok(process.env.STUDIO_CODEX)) return { bin: process.env.STUDIO_CODEX };
  const w = spawnSync('which', ['codex'], { encoding: 'utf8' });
  if (w.status === 0 && ok(w.stdout.trim())) return { bin: w.stdout.trim() };
  // The globally installed codex on some Macs fails with ENOENT (a missing platform binary): fetch the latest with npx
  // into a private npm cache, the same way a newcomer following the README would.
  const env = { ...process.env, npm_config_cache: cacheDir };
  const r = spawnSync('npx', ['-y', '@openai/codex@latest', '--version'], { encoding: 'utf8', env, timeout: 240000 });
  if (r.status !== 0) return { bin: null, why: `npx @openai/codex@latest failed: ${(r.stderr || '').trim().slice(-200)}` };
  const npx = join(cacheDir, '_npx');
  for (const d of existsSync(npx) ? readdirSync(npx) : []) {
    const b = join(npx, d, 'node_modules/.bin/codex');
    if (existsSync(b) && ok(b)) return { bin: b, version: r.stdout.trim() };
  }
  return { bin: null, why: 'codex fetched with npx but its binary was not found in the cache' };
}

/**
 * Codex with its own CODEX_HOME, the plugin installed from this checkout, one `codex exec` per message.
 * opts: { bin, cwd, env, home, pluginDir, sandbox, extraArgs }
 */
export function codexAgent({ bin, cwd, env, home, pluginDir, sandbox = 'workspace-write', extraArgs = [] }) {
  const t0 = Date.now();
  const st = base(t0);
  mkdirSync(home, { recursive: true });
  const cenv = { ...env, CODEX_HOME: home };
  // Signed in as the same account: copy the sign-in file (never read or printed here).
  const auth = join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'auth.json');
  if (existsSync(auth)) copyFileSync(auth, join(home, 'auth.json'));
  else st.add('sys', 'no Codex sign-in file on this machine: Codex will ask to log in');
  // Install the plugin the way the README says (marketplace add + plugin add), into this CODEX_HOME only.
  for (const a of [['plugin', 'marketplace', 'add', pluginDir], ['plugin', 'add', 'game-studio@game-studio']]) {
    const r = spawnSync(bin, a, { env: cenv, cwd, encoding: 'utf8', timeout: 120000 });
    st.add('sys', `codex ${a.join(' ')} -> ${r.status} ${(r.stdout + r.stderr).trim().split('\n').slice(-2).join(' | ').slice(0, 300)}`);
  }
  let thread = null;
  let proc = null;
  return {
    name: 'codex',
    st,
    say(text) {
      st.add('user', text);
      st.setBusy(true);
      // `exec resume` takes no -s/-C (codex 0.163): the sandbox goes in as a config value for both.
      const common = ['--json', '--skip-git-repo-check', '-c', `sandbox_mode="${sandbox}"`, ...extraArgs];
      const args = thread ? ['exec', 'resume', ...common, thread, text] : ['exec', ...common, '-C', cwd, text];
      proc = spawn(bin, args, { cwd, env: cenv, stdio: ['ignore', 'pipe', 'pipe'] });
      let buf = '';
      let last = '';
      proc.stdout.on('data', (d) => {
        buf += d;
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i);
          buf = buf.slice(i + 1);
          let m;
          try { m = JSON.parse(line); } catch { continue; }
          if (m.type === 'thread.started') thread = m.thread_id;
          const it = m.item;
          if (m.type === 'item.completed' && it) {
            if (it.type === 'agent_message' && it.text?.trim()) { st.add('agent', it.text.trim()); last = it.text.trim(); }
            else if (it.type === 'command_execution') st.add('tool', `shell ${String(it.command).slice(0, 300)} -> ${it.exit_code}`);
            else if (it.type === 'file_change') st.add('tool', `edit ${(it.changes || []).map((c) => `${c.kind} ${c.path}`).join(', ')}`);
            else if (it.type === 'error') st.add('tool-error', String(it.message).slice(0, 300));
          }
          if (m.type === 'turn.failed' || m.type === 'error') st.add('tool-error', JSON.stringify(m).slice(0, 300));
        }
      });
      let err = '';
      proc.stderr.on('data', (d) => { err += d; });
      proc.on('exit', (c) => {
        if (c) {
          st.add('sys', `codex exec exited ${c}: ${err.trim().split('\n').slice(-3).join(' | ').slice(0, 300)}`);
          // A usage error means the conversation cannot go on; the play test stops waiting instead of timing out.
          if (c === 2 && /Usage:/.test(err)) st.exited = true;
        }
        st.lastTurnText = last;
        st.setBusy(false);
      });
    },
    async stop() {
      if (proc && proc.exitCode === null) proc.kill('SIGTERM');
    },
  };
}

// ---- the newcomer's answers ----

/**
 * What a newcomer answers to the agent's last message, or null when it asked nothing. `kind` names the question so
 * the report can count them ("sample", "apply-way", "names", "other").
 */
export function newcomerAnswer(text) {
  const t = (text || '').toLowerCase();
  if (!/\?|\bwhich\b|\bchoose\b|\bpick one\b|\blet me know\b|\bwould you like\b|\bshall i\b|\bdo you want\b/.test(t)) return null;
  if (/\b3d\b/.test(t) && /\b2d\b/.test(t)) return { kind: 'sample', reply: '3D' };
  if (/loader|rewrite|two ways|which way|placement\.json/.test(t)) return { kind: 'apply-way', reply: 'The loader, please (option 1).' };
  if (/\bname\b|\bnames\b|no name/.test(t)) return { kind: 'names', reply: 'Sure, go ahead.' };
  if (/\bkumodeck\b|sign in|account|publish/.test(t)) return { kind: 'other', reply: 'No thanks, not now.' };
  return { kind: 'other', reply: 'Yes, go ahead.' };
}

function toolLine(name, input = {}) {
  if (name === 'Bash' || name === 'Monitor') return String(input.command || '').replace(/\s+/g, ' ').slice(0, 300);
  if (name === 'Read' || name === 'Write' || name === 'Edit') return String(input.file_path || '');
  if (name === 'Skill') return `${input.skill || ''} ${input.args || ''}`;
  return JSON.stringify(input).slice(0, 200);
}
function flat(c) {
  return Array.isArray(c) ? c.map((x) => x.text || '').join(' ') : String(c || '');
}
