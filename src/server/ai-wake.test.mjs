// Waking the AI from the editor's side (ai-wake.mjs, push to the AI 2026-10-19): the plugin's hooks, through a real
// editor and the built CLI. Run: node --test src/server/ai-wake.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startStudioServer } from './server.mjs';
import { registerEditor, unregisterEditor, editorsFor, promptHook, waitHook, WAKE_HEAD } from './ai-wake.mjs';
import { readWatch, readTold, runWatch } from './ai-watch.mjs';

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A session folder with the game in a subfolder (like .scratch/runner/), its editor running and registered. */
async function start() {
  const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'game-studio-wake-')));
  const root = path.join(base, '.scratch', 'runner');
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(path.join(root, 'index.html'), '<!doctype html><title>t</title>');
  const dir = path.join(base, 'editors');
  const srv = await startStudioServer({ root, log: () => {} });
  await registerEditor(root, process.pid, dir);
  const token = new URL(srv.url).searchParams.get('t');
  const host = new URL(srv.origin).host;
  const post = (p, body) => new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: srv.port, method: 'POST', path: '/__studio/api/' + p,
      headers: { host, cookie: `studio_${srv.port}=${token}`, 'content-type': 'application/json' } }, (res) => {
      const c = [];
      res.on('data', (d) => c.push(d));
      res.on('end', () => resolve(JSON.parse(Buffer.concat(c).toString('utf8'))));
    });
    r.on('error', reject);
    r.end(JSON.stringify(body));
  });
  return { base, root, dir, srv, post, close: async () => { await srv.close(); await unregisterEditor(root, dir); } };
}

test('editors are found from the session folder (the game in a subfolder) and dead ones are dropped', async () => {
  const s = await start();
  try {
    assert.deepEqual(await editorsFor(s.base, s.dir), [s.root]);
    assert.deepEqual(await editorsFor(path.join(s.root, 'js'), s.dir), [s.root], 'a session inside the game folder');
    assert.deepEqual(await editorsFor(os.homedir() + '/somewhere-else', s.dir), []);
    await fs.writeFile(path.join(s.dir, 'dead.json'), JSON.stringify({ root: s.root, pid: 999999 }));
    assert.deepEqual(await editorsFor(s.base, s.dir), [s.root]);
    await assert.rejects(fs.stat(path.join(s.dir, 'dead.json')), 'an editor that died is forgotten');
  } finally {
    await s.close();
  }
});

test('wait hook: while it waits the editor says the AI will get it; a request wakes it (exit 2 + its line), once', async () => {
  const s = await start();
  try {
    const lines = [];
    const run = waitHook(s.base, { dir: s.dir, err: (l) => lines.push(l), maxMs: 20_000 });
    await sleep(600);
    assert.equal((await readWatch(s.root)).watching, true, 'wake.json makes it "watching": no warning in the editor');
    const r = await s.post('request', { kind: 'ask', text: 'Add a sky', lang: 'en' });
    assert.equal(r.watching, true);
    assert.equal(await run, 2, 'exit 2 = Claude Code wakes the AI');
    assert.equal(lines.length, 1);
    const [head, line] = lines[0].split('\n');
    assert.equal(head, WAKE_HEAD);
    assert.match(line, /^studio: request ask \.studio\/requests\/.+-ask-.+\.json "Add a sky" \(whole game\) \[/);
    // Told: the editor keeps "your AI has it" after the hook ended, and the next wait does not wake for it again.
    const w = await readWatch(s.root);
    assert.equal(w.watching, false);
    assert.equal(w.seen, r.id);
    assert.equal(await readTold(s.root), r.id);
    const again = await waitHook(s.base, { dir: s.dir, err: (l) => lines.push(l), maxMs: 1500 });
    assert.equal(again, 0, 'the same request does not wake the AI twice');
    assert.equal(lines.length, 1);
  } finally {
    await s.close();
  }
});

test('wait hook: a request that came while the AI was busy wakes it the moment it stops', async () => {
  const s = await start();
  try {
    const r = await s.post('request', { kind: 'ask', text: 'Make it night', lang: 'en' });
    assert.equal(r.watching, false, 'nobody waits while the AI works');
    const lines = [];
    assert.equal(await waitHook(s.base, { dir: s.dir, err: (l) => lines.push(l), maxMs: 5000 }), 2);
    assert.match(lines[0], /"Make it night"/);
  } finally {
    await s.close();
  }
});

test('wait hook steps aside for a --watch (it wakes the AI itself) and for another wait hook', async () => {
  const s = await start();
  const ac = new AbortController();
  try {
    const watch = runWatch(s.root, { out: () => {}, quiet: () => {}, signal: ac.signal, forMs: 0 });
    await sleep(500);
    assert.equal(await waitHook(s.base, { dir: s.dir, err: () => {}, maxMs: 3000 }), 0);
    ac.abort();
    await watch;
    const first = waitHook(s.base, { dir: s.dir, err: () => {}, maxMs: 4000 });
    await sleep(500);
    assert.equal(await waitHook(s.base, { dir: s.dir, err: () => {}, maxMs: 3000 }), 0, 'one waiter per folder');
    assert.equal(await first, 0, 'no request: ends on its own');
  } finally {
    ac.abort();
    await s.close();
  }
});

test('prompt hook: whatever the person types next, waiting requests go in front of the AI with it', async () => {
  const s = await start();
  try {
    assert.equal(await promptHook(s.base, s.dir), '', 'nothing waiting: nothing added');
    const r = await s.post('request', { kind: 'ask', text: 'Add a sky', lang: 'en' });
    const out = JSON.parse(await promptHook(s.base, s.dir));
    assert.equal(out.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
    assert.match(out.hookSpecificOutput.additionalContext, /"Add a sky"/);
    assert.equal(await readTold(s.root), r.id);
  } finally {
    await s.close();
  }
});

test('the built CLI: --hook reads the session folder from stdin; a typo never blocks the AI', async () => {
  const cli = path.join(PKG, 'skills/arrange/bin/studio.mjs');
  const run = (args, stdin) => new Promise((resolve) => {
    const p = spawn(process.execPath, [cli, ...args], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, TMPDIR: os.tmpdir() } });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.on('close', (code) => resolve({ code, out }));
    p.stdin.end(stdin);
  });
  const empty = await fs.mkdtemp(path.join(os.tmpdir(), 'game-studio-wake-none-'));
  const prompt = await run(['--hook', 'prompt'], JSON.stringify({ cwd: empty, hook_event_name: 'UserPromptSubmit' }));
  assert.deepEqual(prompt, { code: 0, out: '' }, 'no editor here: nothing, at once');
  const wait = await run(['--hook', 'wait'], JSON.stringify({ cwd: empty, hook_event_name: 'Stop' }));
  assert.equal(wait.code, 0, 'no editor here: ends at once');
  assert.equal((await run(['--hook', 'nope'], '{}')).code, 0);
});
