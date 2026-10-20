// Waking the AI from the editor's side (push to the AI, 2026-10-19).
//
// The hands-on test: whenever the AI's watch (`--watch` under Claude Code's Monitor) was not running, the
// editor said "Your AI isn't watching this editor. Type 'look' in Claude Code or Codex, or run /arrange in this
// folder." That is the AI's plumbing, not the person's fault, and it sent them to another window to type a command.
// The fix is to make that state not happen: the request reaches the AI without the person going anywhere.
//
// How (Claude Code; the plugin's hooks in .claude-plugin/plugin.json run these):
//
//   studio.mjs --hook wait     Stop and UserPromptSubmit, `async` + `asyncRewake`. Runs in the background while the
//                              session lives. It waits for a new request in any editor started under the session's
//                              folder and, when one comes, prints its `studio:` lines and exits 2: Claude Code then
//                              wakes the AI with those lines (even when it was idle). While it waits it keeps
//                              .studio/wake.json fresh, so the editor knows a request will reach the AI ("Your AI
//                              has it" at once, no warning). It steps aside when a `--watch` runs (that one already
//                              wakes the AI) or another wait hook already waits for the folder (one is enough).
//   studio.mjs --hook prompt   UserPromptSubmit, plain. Whatever the person types next in the AI's window ("hi",
//                              "go on", anything — no magic word), requests still waiting are put in front of the
//                              AI with it, so nothing is forgotten when the wake could not run.
//
// WHY each request wakes at most once (.studio/told.json, ai-watch.mjs): a request the AI saw and chose not to finish
// must not wake it again every time it goes idle. Requests that came while the AI was busy (nobody printed them) wake
// it the moment it stops.
//
// WHY a list of running editors in the temp folder (editorsDir): a hook only knows the session's folder, and the game
// is often a subfolder of it (.scratch/runner/). Walking the tree on every prompt would be slow in a big repository;
// the editor writes one small file when it starts and removes it when it stops.
//
// Not reachable from here: Codex (no hooks) and an AI whose session was closed. There the editor says, calmly, that
// the request is kept and goes in the next time the AI runs, with one "Call your AI" button (copies the word).

import { promises as fs, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { isRequestId } from '../schema/handoff.mjs';
import { handoffLine, markTold, pidAlive, readTold, watchAlive, wakeAlive, AIW_BEAT_MS } from './ai-watch.mjs';
import { writeStudioFile } from './files.mjs';

const POLL_MS = 400;
/** How long one wait hook stays before it ends on its own (the next Stop or prompt starts another). */
export const WAKE_MAX_MS = 12 * 60 * 60_000;
/** The first line of a wake: tells the AI where the lines come from and what to do (arrange skill §3). */
export const WAKE_HEAD = 'studio: from the Game Studio editor (arrange skill §3.1) - handle these requests now, in order:';

/** The folder of running editors' entries: per user, in the temp folder (nothing in the person's home). */
export function editorsDir() {
  const uid = typeof process.getuid === 'function' ? process.getuid() : 'u';
  return path.join(os.tmpdir(), `game-studio-${uid}`, 'editors');
}

const entryName = (rootReal) => crypto.createHash('sha1').update(rootReal).digest('hex').slice(0, 16) + '.json';

/** The running editor says where it is (cli.mjs, after `studio: ready`). */
export async function registerEditor(rootReal, pid = process.pid, dir = editorsDir()) {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, entryName(rootReal)), JSON.stringify({ version: 1, root: rootReal, pid }) + '\n');
}

export async function unregisterEditor(rootReal, dir = editorsDir()) {
  await fs.rm(path.join(dir, entryName(rootReal)), { force: true }).catch(() => {});
}

/** Running editors whose game folder is the session's folder, inside it, or holds it. */
export async function editorsFor(cwd, dir = editorsDir()) {
  const names = await fs.readdir(dir).catch(() => []);
  let here;
  try {
    here = await fs.realpath(cwd);
  } catch {
    here = path.resolve(cwd);
  }
  const out = [];
  for (const n of names.filter((x) => x.endsWith('.json'))) {
    let e;
    try {
      e = JSON.parse(await fs.readFile(path.join(dir, n), 'utf8'));
    } catch {
      continue;
    }
    if (typeof e?.root !== 'string' || !pidAlive(e.pid)) {
      await fs.rm(path.join(dir, n), { force: true }).catch(() => {}); // an editor that died without saying so
      continue;
    }
    const inside = (a, b) => a === b || a.startsWith(b + path.sep);
    if (inside(e.root, here) || inside(here, e.root)) out.push(e.root);
  }
  return out.sort();
}

/** Waiting requests (not moved to done/), oldest first. */
export async function waitingRequests(rootReal) {
  const dir = path.join(rootReal, '.studio', 'requests');
  const names = (await fs.readdir(dir).catch(() => [])).filter((n) => n.endsWith('.json') && isRequestId(n.slice(0, -5))).sort();
  const out = [];
  for (const n of names) {
    try {
      out.push({ id: n.slice(0, -5), rec: JSON.parse(await fs.readFile(path.join(dir, n), 'utf8')), rel: `.studio/requests/${n}` });
    } catch {
      // half-written: the next look has it
    }
  }
  return out;
}

/**
 * The lines for some requests of one folder, each ending with the game folder in [brackets]: the paths in a line are
 * inside the game folder, which is often not the session's folder (.scratch/runner/), and a session can hold several.
 */
function linesFor(root, list) {
  return list.map((r) => `${handoffLine(r.rec, r.rel)} [${root}]`);
}

/**
 * `--hook prompt`: requests still waiting go in front of the AI with whatever the person typed.
 * Returns the hook's stdout (JSON, or '' for nothing to add).
 */
export async function promptHook(cwd, dir = editorsDir()) {
  const roots = await editorsFor(cwd, dir);
  const lines = [];
  for (const root of roots) {
    const list = await waitingRequests(root);
    if (!list.length) continue;
    lines.push(...linesFor(root, list.slice(-8)));
    await markTold(root, list[list.length - 1].id);
  }
  if (!lines.length) return '';
  const ctx = `${WAKE_HEAD.replace(' now, in order', ' along with what the person said, in order')}\n${lines.join('\n')}`;
  return JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: ctx } });
}

/**
 * `--hook wait`: wait for a request the AI has not been shown and wake it with its lines (exit 2), or step aside
 * (exit 0). `err` gets the lines (Claude Code shows an asyncRewake hook's stderr to the AI).
 */
export async function waitHook(cwd, { dir = editorsDir(), err = (l) => process.stderr.write(l + '\n'), signal, maxMs = WAKE_MAX_MS } = {}) {
  const endAt = Date.now() + maxMs;
  const mine = new Set();
  let lastBeat = 0;
  const release = async () => {
    for (const root of mine) {
      const f = path.join(root, '.studio', 'wake.json');
      try {
        if (JSON.parse(readFileSync(f, 'utf8'))?.pid === process.pid) await fs.rm(f, { force: true });
      } catch {
        // gone already
      }
    }
    mine.clear();
  };
  try {
    while (!signal?.aborted && Date.now() < endAt) {
      const roots = await editorsFor(cwd, dir);
      // The editors here closed: nothing to wait for (the next Stop starts another if one opens).
      if (!roots.length) return 0;
      const now = Date.now();
      const beat = now - lastBeat >= AIW_BEAT_MS;
      const due = [];
      for (const root of roots) {
        // A --watch wakes the AI by itself; another wait hook already waits here: step aside for this folder.
        if (await watchAlive(root)) {
          if (mine.delete(root)) await fs.rm(path.join(root, '.studio', 'wake.json'), { force: true }).catch(() => {});
          continue;
        }
        if (!mine.has(root) && (await wakeAlive(root))) continue;
        mine.add(root);
        if (beat) await writeStudioFile(root, 'wake.json', JSON.stringify({ version: 1, pid: process.pid, at: new Date().toISOString() }) + '\n').catch(() => {});
        const told = await readTold(root);
        const fresh = (await waitingRequests(root)).filter((r) => !told || r.id > told);
        if (fresh.length) due.push({ root, fresh });
      }
      if (beat) lastBeat = now;
      // Nobody else needs this hook (every folder has its watch or its waiter): end quietly.
      if (!mine.size) return 0;
      if (due.length) {
        const lines = [WAKE_HEAD];
        for (const d of due) {
          lines.push(...linesFor(d.root, d.fresh));
          await markTold(d.root, d.fresh[d.fresh.length - 1].id);
        }
        err(lines.join('\n'));
        return 2;
      }
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
    return 0;
  } finally {
    await release();
  }
}

/** Read the hook's input (JSON on stdin) without hanging when there is none. */
export async function readHookInput(stdin = process.stdin, waitMs = 1000) {
  if (stdin.isTTY) return {};
  const text = await new Promise((resolve) => {
    let s = '';
    const t = setTimeout(() => resolve(s), waitMs);
    stdin.setEncoding('utf8');
    stdin.on('data', (d) => (s += d));
    stdin.on('end', () => {
      clearTimeout(t);
      resolve(s);
    });
    stdin.on('error', () => resolve(s));
  });
  try {
    const j = JSON.parse(text || '{}');
    return j && typeof j === 'object' ? j : {};
  } catch {
    return {};
  }
}

/** `studio.mjs --hook <prompt|wait>`: the exit code for the hook (0, or 2 = wake the AI). */
export async function runHook(kind) {
  const input = await readHookInput();
  const cwd = typeof input.cwd === 'string' && input.cwd ? input.cwd : process.cwd();
  if (kind === 'prompt') {
    const out = await promptHook(cwd);
    if (out) process.stdout.write(out + '\n');
    return 0;
  }
  if (kind === 'wait') {
    const ac = new AbortController();
    for (const s of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(s, () => ac.abort());
    return waitHook(cwd, { signal: ac.signal });
  }
  process.stderr.write('studio: --hook must be prompt or wait\n');
  return 0; // never block the AI over a typo in a hook
}
