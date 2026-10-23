// Starting the editor so it outlives the AI's turn, and stopping only the editor this folder started
// (agent-solid pass 2026-10-17).
//
// Two things a real Claude Code / Codex run showed (docs: the real-agent play test of 10/17):
//
// 1. `--detach`. Codex ends every shell command of a turn when the turn ends, and the editor went with it, whether
//    it was started with `&` or `nohup` (a blank page for the person). Only a process in a NEW SESSION survived (Codex
//    found that out itself with Python's `Popen(start_new_session=True)`). So `studio.mjs <folder> --detach` starts
//    the editor again as its own session (`spawn(..., { detached: true })` = setsid), writes its output to
//    .studio/studio.log, waits for its `studio: ready` line, prints `studio: ready <url> pid <pid>` and returns. One
//    command, the same in every agent; Claude Code's watch (`--watch` under Monitor) is a separate process and is
//    not touched by this.
//
// 2. `--stop`. Claude stopped "its" editor with `pkill -f "studio.mjs . --starter 3d"` and also stopped another
//    person's editor on the same computer that happened to have the same command line. The server now writes its
//    pid, its address and a stop secret into .studio/server.json of the folder it serves; `studio.mjs <folder>
//    --stop` asks exactly those editors to stop (POST /__studio/stop with the secret), or else signals their pids
//    after checking that each is still a studio process (pids are reused), and stops this folder's watch (pid from
//    .studio/watch.json). Nothing is ever matched by name.
//    WHY the request first: the 10/17 Codex run (workspace-write + network) said "already stopped" and left the
//    editor running. In Codex's sandbox a command may not signal another process (kill → EPERM, even one an earlier
//    command started) and may not even run `ps`; a request to the editor's own port is allowed.
//
// WHY a list in server.json and not one pid: an agent that started the editor twice in one folder (a restart after
// a crash it misread) must be able to stop both. Dead entries are dropped whenever the file is written.

import { promises as fs, existsSync, openSync, closeSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { pidAlive } from './ai-watch.mjs';
import { writeStudioFile } from './files.mjs';

/** How long `--detach` waits for the editor's `studio: ready` line (a starter copy + listen take < 2 s). */
export const DETACH_WAIT_MS = 60_000;
const STOP_WAIT_MS = 4000;

/**
 * Is `pid` (still) a Game Studio process? `want` narrows it ('--watch' for the watch). Pids are reused: a pid from
 * an old server.json may belong to anything by now, and --stop must never stop that.
 * Without `ps` (Windows, a stripped container) it cannot check and trusts the file: the pid was written by us and
 * is alive.
 */
export function isStudioProcess(pid, want = '') {
  if (gone(pid)) return false;
  if (process.platform === 'win32') return true;
  let cmd;
  try {
    cmd = execFileSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (e) {
    // ps ran and found no such process (exit 1): not ours. ps could not run at all (no ps; or Codex's sandbox,
    // which refuses to start it: EPERM, checked 10/17): trust the pid, it was written by us and is alive.
    return !(e && Number.isInteger(e.status));
  }
  return /studio\.mjs|server\/cli\.mjs/.test(cmd) && (!want || cmd.includes(want));
}

async function readServers(rootReal) {
  try {
    const j = JSON.parse(await fs.readFile(path.join(rootReal, '.studio', 'server.json'), 'utf8'));
    return Array.isArray(j?.servers) ? j.servers.filter((s) => Number.isInteger(s?.pid) && s.pid > 0) : [];
  } catch {
    return [];
  }
}

async function writeServers(rootReal, list) {
  if (!list.length) {
    await fs.rm(path.join(rootReal, '.studio', 'server.json'), { force: true }).catch(() => {});
    return;
  }
  await writeStudioFile(rootReal, 'server.json', JSON.stringify({ version: 1, servers: list }, null, 2) + '\n');
}

/**
 * The running editor writes itself into .studio/server.json (url included: the passcode in it only guards against
 * other web pages, and this file is in the person's own folder, like the log that prints the same line).
 */
export async function recordServer(rootReal, info) {
  const list = (await readServers(rootReal)).filter((s) => s.pid !== process.pid && pidAlive(s.pid));
  list.push({ pid: process.pid, url: info.url, port: info.port, origin: info.origin, stopToken: info.stopToken, startedAt: new Date().toISOString() });
  await writeServers(rootReal, list).catch(() => {});
}

/**
 * The editor's link was opened in some browser (the pass traded for a cookie, server.mjs): kept as `openedAt` in this
 * process's entry, so `--detach` on a running editor opens the browser only when nobody has opened it yet.
 */
export async function markOpened(rootReal) {
  const list = await readServers(rootReal);
  const me = list.find((s) => s.pid === process.pid);
  if (!me || me.openedAt) return;
  me.openedAt = new Date().toISOString();
  await writeServers(rootReal, list).catch(() => {});
}

/** On a normal stop: take this process out again. */
export async function forgetServer(rootReal, pid = process.pid) {
  const list = (await readServers(rootReal)).filter((s) => s.pid !== pid && pidAlive(s.pid));
  await writeServers(rootReal, list).catch(() => {});
}

/** The editors running for this folder (checked: alive and a studio process). */
export async function liveServers(rootReal) {
  const out = [];
  for (const s of await readServers(rootReal)) {
    if (!isStudioProcess(s.pid)) continue;
    // Answers on its port too: in a sandbox the pid check above can only trust the file.
    if (typeof s.origin === 'string' && !(await fetch(`${s.origin}/__studio/`, { signal: AbortSignal.timeout(1000) }).then(() => true, () => false))) continue;
    out.push(s);
  }
  return out;
}

/**
 * Gone = no such process, or a zombie: it has exited and only waits for its parent to collect it (the agent's
 * Monitor, a test runner busy in spawnSync). kill(pid, 0) still succeeds on a zombie, so ask ps when it is there.
 */
function gone(pid) {
  if (!pidAlive(pid)) return true;
  if (process.platform === 'win32') return false;
  try {
    return execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().startsWith('Z');
  } catch {
    return false;
  }
}

/** Can this process see `pid` at all? False when signals to it are refused (EPERM: another user, a sandbox). */
function canSeePid(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code !== 'EPERM'; // ESRCH (no such process) is seeing it: it is gone
  }
}

async function waitGone(pid, ms) {
  const end = Date.now() + ms;
  while (!gone(pid) && Date.now() < end) await new Promise((r) => setTimeout(r, 100));
  return gone(pid);
}

/**
 * Ask the editor to stop itself (POST /__studio/stop with the folder's stop secret, server.mjs). The only way that
 * works from inside Codex's sandbox, where signals to other processes are refused. True once its port is closed.
 */
async function stopByRequest(s) {
  if (typeof s.origin !== 'string' || typeof s.stopToken !== 'string' || !/^http:\/\/(127\.0\.0\.1|\[?[\d.:a-f]+\]?|localhost):\d+$/.test(s.origin)) return false;
  try {
    const r = await fetch(`${s.origin}/__studio/stop`, { method: 'POST', headers: { 'x-studio-stop': s.stopToken }, signal: AbortSignal.timeout(2000) });
    if (!r.ok) return false;
  } catch {
    return false; // not listening (gone already, or not this editor): the pid path decides
  }
  const end = Date.now() + STOP_WAIT_MS;
  while (Date.now() < end) {
    try {
      await fetch(`${s.origin}/__studio/`, { signal: AbortSignal.timeout(500) });
    } catch {
      // Connection refused: its port is closed. That is not yet "stopped": the editor closes its port first, then
      // takes itself out of server.json and unregisters (cli.mjs stop()) before it exits, so for a few ms the pid
      // is still alive. Wait for the pid as well, so "studio: stopped pid N" means N is gone (the flaky
      // lifecycle.test.mjs `--detach … --stop stops it`, ~3 in 50 runs, 2026-10-22). Only where we can see the
      // pid: in Codex's sandbox kill(pid, 0) is refused (EPERM) and the closed port is all the proof there is.
      if (canSeePid(s.pid)) await waitGone(s.pid, STOP_WAIT_MS);
      return true;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

async function stopPid(pid) {
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    return true; // gone already
  }
  if (await waitGone(pid, STOP_WAIT_MS)) return true;
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    /* gone */
  }
  return waitGone(pid, 1000);
}

/**
 * `--stop`: the editors this folder started and this folder's watch, by pid. Returns the pids it stopped.
 * `roots`: the folder and, when the game is served from its public/, that too (the server writes into the folder it
 * serves).
 */
export async function stopFolder(roots) {
  const stopped = [];
  let watch = null;
  for (const rootReal of roots) {
    for (const s of await readServers(rootReal)) {
      if ((await stopByRequest(s)) || (isStudioProcess(s.pid) && (await stopPid(s.pid)))) stopped.push(s.pid);
    }
    await writeServers(rootReal, []);
    // The watch writes its pid into watch.json every 1.5 s (ai-watch.mjs). Stopping it makes the editor's
    // "your AI is watching" honest again, and ends the agent's Monitor instead of leaving it on a dead editor.
    try {
      const w = JSON.parse(await fs.readFile(path.join(rootReal, '.studio', 'watch.json'), 'utf8'));
      if (Number.isInteger(w?.pid) && w.pid !== process.pid && isStudioProcess(w.pid, '--watch') && (await stopPid(w.pid))) watch = w.pid;
    } catch {
      /* no watch */
    }
  }
  return { stopped, watch };
}

/**
 * `--detach`: start `script` with `args` (the same command without --detach) as its own session, its output in
 * `log`, and wait for `studio: ready`. Resolves { code, lines, url?, pid }:
 * - ready: code 0, `lines` = the studio: lines before it (e.g. `studio: started …`), `url`;
 * - the editor exited first (no game: exit 4, a folder error: 2, EPERM: 1): its exit code, `lines` = the whole log;
 * - no ready line in time: code 1, the editor is left running (its pid is in the result).
 */
export async function detachEditor({ script, args, log, cwd = process.cwd(), env = process.env, waitMs = DETACH_WAIT_MS }) {
  const fd = openSync(log, 'w');
  let child;
  try {
    child = spawn(process.execPath, [script, ...args], { cwd, env, detached: true, stdio: ['ignore', fd, fd] });
  } finally {
    closeSync(fd);
  }
  let exited = null;
  child.on('exit', (code, sig) => {
    exited = code ?? (sig ? 1 : 0);
  });
  child.on('error', () => {
    exited = 1;
  });
  child.unref();
  const end = Date.now() + waitMs;
  const read = () => (existsSync(log) ? readFileSync(log, 'utf8') : '');
  for (;;) {
    const text = read();
    const m = text.match(/^studio: ready (\S+)/m);
    if (m) {
      const before = text.slice(0, m.index).split('\n').filter((l) => l.startsWith('studio: '));
      return { code: 0, url: m[1], pid: child.pid, lines: before };
    }
    if (exited !== null) {
      // Let the last write land, then hand back everything it said.
      await new Promise((r) => setTimeout(r, 50));
      return { code: exited || 1, pid: child.pid, lines: read().split('\n').filter(Boolean) };
    }
    if (Date.now() > end) return { code: 1, pid: child.pid, lines: [], timeout: true };
    await new Promise((r) => setTimeout(r, 100));
  }
}
