// Starting and stopping the editor the way a real AI does (agent-solid pass 2026-10-17, lifecycle.mjs):
// --detach outlives the command that started it (Codex ends a turn's processes), --stop stops this folder's editor
// and watch (by its stop secret, else by pid) and NOTHING else (a real Claude `pkill` also stopped another editor), and the same start line
// run twice opens the same editor / the same sample instead of failing.
//
//   npm run build && node --experimental-strip-types --no-warnings --test test/lifecycle.test.mjs
//
// The built CLI (skills/arrange/bin/studio.mjs) is what is tested: it is what the agent runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pidAlive } from '../src/server/ai-watch.mjs';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(PKG, 'skills/arrange/bin/studio.mjs');
const FAKE = join(PKG, 'test/first-run/starters');
const tmp = (name) => mkdtempSync(join(tmpdir(), `studio-life-${name}-`));
const run = (args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 30000 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('--detach: returns with the URL and pid, the editor keeps running, a second start reuses it, --stop stops it', async () => {
  const base = tmp('detach');
  const dir = join(base, 'game');
  try {
    const a = run([dir, '--starter', '3d', '--starters-dir', FAKE, '--detach', '--no-open']);
    assert.equal(a.status, 0, a.stdout + a.stderr);
    const lines = a.stdout.trim().split('\n');
    assert.equal(lines[0], 'studio: started fake-3d (2 files) Fake Harbor');
    const m = lines[1].match(/^studio: ready (http:\/\/127\.0\.0\.1:\d+\/__studio\/\?t=\S+) pid (\d+)$/);
    assert.ok(m, lines[1]);
    const pid = Number(m[2]);
    // The command has returned; the editor answers on its own.
    assert.ok(pidAlive(pid));
    assert.ok((await fetch(m[1])).status > 0, 'the editor answers');
    assert.match(readFileSync(join(dir, '.studio/studio.log'), 'utf8'), /studio: ready /);
    const sj = JSON.parse(readFileSync(join(dir, '.studio/server.json'), 'utf8'));
    assert.deepEqual(sj.servers.map((s) => s.pid), [pid]);
    // The same line again: the same editor, not a second one (and not "already has a game").
    const b = run([dir, '--starter', '3d', '--starters-dir', FAKE, '--detach', '--no-open']);
    assert.equal(b.status, 0, b.stderr);
    assert.equal(b.stdout.trim(), `studio: ready ${m[1]} pid ${pid} (already running)`);
    const s = run([dir, '--stop']);
    assert.equal(s.stdout.trim(), `studio: stopped pid ${pid}`);
    assert.ok(!pidAlive(pid));
    assert.ok(!existsSync(join(dir, '.studio/server.json')), 'nothing left that names a dead pid');
    assert.match(run([dir, '--stop']).stdout, /^studio: not running/);
  } finally {
    run([dir, '--stop']);
    rmSync(base, { recursive: true, force: true });
  }
});

test('--detach: the editor survives its starter\'s whole process group being killed (a Codex turn ending)', async () => {
  const base = tmp('group');
  const dir = join(base, 'game');
  try {
    // A shell in its own process group (as an agent runs a command), killed as a group after the start line.
    const sh = spawn('/bin/sh', ['-c', `"${process.execPath}" "${CLI}" "${dir}" --starter 3d --starters-dir "${FAKE}" --detach --no-open; sleep 30`], { detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    sh.stdout.on('data', (d) => (out += d));
    const t0 = Date.now();
    while (!/pid \d+/.test(out) && Date.now() - t0 < 20000) await sleep(100);
    const pid = Number(out.match(/pid (\d+)/)[1]);
    process.kill(-sh.pid, 'SIGKILL');
    await sleep(500);
    assert.ok(pidAlive(pid), 'the editor is still running');
    assert.equal(run([dir, '--stop']).stdout.trim(), `studio: stopped pid ${pid}`);
  } finally {
    run([dir, '--stop']);
    rmSync(base, { recursive: true, force: true });
  }
});

test('--stop: only this folder\'s editor and watch; another folder\'s editor with the same command keeps running', async () => {
  const base = tmp('stop');
  const one = join(base, 'one');
  const two = join(base, 'two');
  try {
    const a = run([one, '--starter', '3d', '--starters-dir', FAKE, '--detach', '--no-open']);
    const b = run([two, '--starter', '3d', '--starters-dir', FAKE, '--detach', '--no-open']);
    const pa = Number(a.stdout.match(/pid (\d+)/)[1]);
    const pb = Number(b.stdout.match(/pid (\d+)/)[1]);
    // Nothing waiting: its start line is on stderr (quiet watch, ai-watch.mjs).
    const watch = spawn(process.execPath, [CLI, one, '--watch'], { stdio: ['ignore', 'ignore', 'pipe'] });
    await new Promise((r) => watch.stderr.once('data', r));
    await sleep(300);
    assert.ok(existsSync(join(one, '.studio/watch.json')));
    const s = run([one, '--stop']);
    assert.equal(s.stdout.trim(), `studio: stopped pid ${pa} and the watch (pid ${watch.pid})`);
    await sleep(200);
    assert.ok(!pidAlive(pa));
    assert.ok(watch.exitCode !== null || watch.signalCode !== null || (await new Promise((r) => { watch.once('exit', () => r(true)); setTimeout(() => r(false), 2000); })), 'the watch went with it');
    assert.ok(pidAlive(pb), 'the other folder\'s editor is untouched');
    // A server.json naming a pid that is no studio process (pids are reused) stops nothing.
    assert.match(run([one, '--stop']).stdout, /^studio: not running/);
  } finally {
    run([one, '--stop']);
    run([two, '--stop']);
    rmSync(base, { recursive: true, force: true });
  }
});

test('--starter again after a start that did not come up: the same sample is opened, nothing copied', async () => {
  const base = tmp('again');
  const dir = join(base, 'game');
  try {
    // First start copies the sample; stop it (stands in for "the editor never came up").
    const a = run([dir, '--starter', '3d', '--starters-dir', FAKE, '--detach', '--no-open']);
    assert.equal(a.status, 0);
    run([dir, '--stop']);
    const b = run([dir, '--starter', '3d', '--starters-dir', FAKE, '--detach', '--no-open']);
    assert.equal(b.status, 0, b.stdout + b.stderr);
    assert.match(b.stdout, /^studio: note the sample fake-3d is already in this folder, so nothing was copied; opening it\nstudio: ready \S+ pid \d+\n$/);
    // A different sample is still refused: the folder has a game, and it is not that one.
    run([dir, '--stop']);
    const c = run([dir, '--starter', '2d', '--starters-dir', FAKE, '--no-open']);
    assert.equal(c.status, 2);
    assert.match(c.stderr, /already has a game/);
  } finally {
    run([dir, '--stop']);
    rmSync(base, { recursive: true, force: true });
  }
});

test('--detach: an editor that cannot start says why on stdout, with its exit code (no game: 4)', () => {
  const base = tmp('fail');
  try {
    const r = run([base, '--detach', '--no-open', '--starters-dir', FAKE]);
    assert.equal(r.status, 4);
    assert.match(r.stdout, /^studio: no-game /);
    assert.ok(!existsSync(join(base, '.studio/server.json')));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('EPERM on listen (a sandbox): one line that says what to do', () => {
  // The real thing needs a sandbox (checked by hand with `codex sandbox`, see cli.mjs); here a preload makes
  // listen() fail the same way, so the line itself is tested.
  const base = tmp('eperm');
  try {
    const pre = `import net from 'node:net'; net.Server.prototype.listen = function () { const e = Object.assign(new Error('listen EPERM: operation not permitted 127.0.0.1'), { code: 'EPERM', syscall: 'listen' }); process.nextTick(() => this.emit('error', e)); return this; };`;
    const r = spawnSync(process.execPath, ['--import', `data:text/javascript,${encodeURIComponent(pre)}`, CLI, join(base, 'g'), '--starter', '3d', '--starters-dir', FAKE, '--no-open'], { encoding: 'utf8', timeout: 20000 });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /^studio: listen EPERM: operation not permitted 127\.0\.0\.1 — your AI’s sandbox is blocking the editor’s local server .*codex -c sandbox_workspace_write\.network_access=true$/m);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('stop by request (Codex sandbox: no signals, no ps): only with the folder\'s stop secret', async () => {
  const base = tmp('req');
  const dir = join(base, 'game');
  try {
    const a = run([dir, '--starter', '3d', '--starters-dir', FAKE, '--detach', '--no-open']);
    const pid = Number(a.stdout.match(/pid (\d+)/)[1]);
    const s = JSON.parse(readFileSync(join(dir, '.studio/server.json'), 'utf8')).servers[0];
    assert.match(s.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.ok(s.stopToken && !s.url.includes(s.stopToken), 'a secret of its own, not the pass in the link');
    const host = { host: new URL(s.origin).host };
    assert.equal((await fetch(`${s.origin}/__studio/stop`, { method: 'POST', headers: { ...host, 'x-studio-stop': 'nope' } })).status, 403);
    assert.equal((await fetch(`${s.origin}/__studio/stop`, { method: 'POST' })).status, 403);
    assert.ok(pidAlive(pid), 'a wrong secret stops nothing');
    assert.equal((await fetch(`${s.origin}/__studio/stop`, { method: 'POST', headers: { 'x-studio-stop': s.stopToken } })).status, 200);
    const t0 = Date.now();
    while (pidAlive(pid) && Date.now() - t0 < 5000) await sleep(100);
    assert.ok(!pidAlive(pid));
    assert.ok(!existsSync(join(dir, '.studio/server.json')), 'it took itself out of server.json');
  } finally {
    run([dir, '--stop']);
    rmSync(base, { recursive: true, force: true });
  }
});
