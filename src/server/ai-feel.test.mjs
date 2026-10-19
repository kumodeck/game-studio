// AI feel (2026-10-16): "is an AI watching" (ai-watch.mjs), the game files' signature and
// "Undo AI change" (ai-undo.mjs), through the real server routes and the built CLI.
// Run: node --test src/server/ai-feel.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startStudioServer } from './server.mjs';
import { runWatch, handoffLine } from './ai-watch.mjs';

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function start() {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'game-studio-ai-feel-'));
  const root = path.join(base, 'game');
  await fs.mkdir(path.join(root, 'js'), { recursive: true });
  await fs.writeFile(path.join(root, 'index.html'), '<!doctype html><title>t</title><script type="module" src="js/main.js"></script>');
  await fs.writeFile(path.join(root, 'js/main.js'), 'export const lighthouses = 1;\n');
  await fs.writeFile(path.join(root, '.env'), 'API_KEY=nope');
  await fs.writeFile(path.join(base, 'outside.txt'), 'outside');
  await fs.symlink(path.join(base, 'outside.txt'), path.join(root, 'link-out.txt'));
  const lines = [];
  const srv = await startStudioServer({ root, log: (l) => lines.push(l) });
  const token = new URL(srv.url).searchParams.get('t');
  const host = new URL(srv.origin).host;
  const cookie = `studio_${srv.port}=${token}`;
  const req = (method, p, body) =>
    new Promise((resolve, reject) => {
      const r = http.request({ host: '127.0.0.1', port: srv.port, method, path: '/__studio/api/' + p, headers: { host, cookie, ...(body ? { 'content-type': 'application/json' } : {}) } }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try {
            json = JSON.parse(text);
          } catch {
            /* not JSON */
          }
          resolve({ status: res.statusCode, json });
        });
      });
      r.on('error', reject);
      r.end(body ? JSON.stringify(body) : undefined);
    });
  const close = async () => {
    await srv.close();
    await fs.rm(base, { recursive: true, force: true });
  };
  return { base, root, lines, req, close };
}

test('watching: false with no watch, true while `--watch` runs, false again the moment it stops', async (t) => {
  const s = await start();
  t.after(s.close);
  let r = await s.req('POST', 'request', { kind: 'ask', text: 'Add three lighthouses around the island' });
  assert.equal(r.status, 200);
  assert.equal(r.json.watching, false, 'nobody watches yet: the answer says so at once');

  const out = [];
  const ac = new AbortController();
  const done = runWatch(await fs.realpath(s.root), { out: (l) => out.push(l), signal: ac.signal });
  await sleep(150);
  // The waiting request is printed first, in the server's own words.
  assert.equal(out[0], 'studio: watching 1 waiting');
  assert.match(out[1], /^studio: request ask \.studio\/requests\/\d{8}-\d{6}-\d{3}-ask-[0-9a-f]{4}\.json "Add three lighthouses around the island" \(whole game\)$/);
  assert.equal(out[1], s.lines.at(-1), 'the watch line is the server line');
  let st = await s.req('GET', 'status');
  assert.equal(st.json.watching, true);
  assert.equal(st.json.seen, r.json.id);

  r = await s.req('POST', 'request', { kind: 'ask', text: 'Make it night' });
  assert.equal(r.json.watching, true);
  await sleep(600);
  assert.match(out.at(-1), /"Make it night"/);
  st = await s.req('GET', 'status');
  assert.equal(st.json.seen, r.json.id, 'seen follows within one poll (~0.4 s)');

  ac.abort();
  await done;
  st = await s.req('GET', 'status');
  assert.equal(st.json.watching, false, 'the watch removed its file when it stopped');
});

test('watching: a heartbeat from a dead process or an old one does not count', async (t) => {
  const s = await start();
  t.after(s.close);
  await fs.mkdir(path.join(s.root, '.studio'), { recursive: true });
  await fs.writeFile(path.join(s.root, '.studio/watch.json'), JSON.stringify({ version: 1, pid: 999999, at: new Date().toISOString() }));
  assert.equal((await s.req('GET', 'status')).json.watching, false, 'pid 999999 is not running');
  await fs.writeFile(path.join(s.root, '.studio/watch.json'), JSON.stringify({ version: 1, pid: process.pid, at: new Date(Date.now() - 60_000).toISOString() }));
  assert.equal((await s.req('GET', 'status')).json.watching, false, 'a minute old');
  await fs.writeFile(path.join(s.root, '.studio/watch.json'), '{ broken');
  assert.equal((await s.req('GET', 'status')).json.watching, false);
});

test('code signature: changes with the game files, not with the editor\'s own files', async (t) => {
  const s = await start();
  t.after(s.close);
  const code = async () => (await s.req('GET', 'status')).json.code;
  const a = await code();
  assert.match(a, /^[0-9a-f]{16}$/);
  // The editor's draft (placement.json), its notes under .studio/ and dot files: no reload.
  const placement = { version: 1, tool: 'placement', dim: '3d', objects: { tree: { p: [1, 0, 0], was: { p: [0, 0, 0] } } } };
  await s.req('PUT', 'files/placement?handoff=0', placement);
  await s.req('POST', 'request', { kind: 'ask', text: 'hi' });
  await fs.writeFile(path.join(s.root, '.notes'), 'x');
  assert.equal(await code(), a);
  // The AI rewrites the code: a new signature.
  await sleep(20);
  await fs.writeFile(path.join(s.root, 'js/main.js'), 'export const lighthouses = 4;\n');
  const b = await code();
  assert.notEqual(b, a);
  await fs.writeFile(path.join(s.root, 'js/extra.js'), '// new\n');
  assert.notEqual(await code(), b);
});

test('undo AI change: back to the files as they were at the request, then redo puts the change back', async (t) => {
  const s = await start();
  t.after(s.close);
  const main = path.join(s.root, 'js/main.js');
  const ask = await s.req('POST', 'request', { kind: 'ask', text: 'Add three lighthouses around the island' });
  assert.equal(ask.json.undo, true, 'the host kept the files before the AI could read the request');

  // The "AI": rewrites a file, adds one, and the person's draft layout changes meanwhile.
  await fs.writeFile(main, 'export const lighthouses = 4;\n');
  await fs.mkdir(path.join(s.root, 'models'));
  await fs.writeFile(path.join(s.root, 'models/lighthouse.js'), 'export {};\n');
  const placement = { version: 1, tool: 'placement', dim: '3d', objects: { boat: { p: [2, 0, 0], was: { p: [0, 0, 0] } } } };
  await s.req('PUT', 'files/placement?handoff=0', placement);

  const u = await s.req('POST', 'undo', { to: ask.json.id });
  assert.equal(u.status, 200, JSON.stringify(u.json));
  assert.equal(await fs.readFile(main, 'utf8'), 'export const lighthouses = 1;\n');
  await assert.rejects(fs.stat(path.join(s.root, 'models/lighthouse.js')), 'the file the AI made is gone (kept for redo)');
  assert.deepEqual([u.json.restored, u.json.removed], [1, 1]);
  // Untouched: the person's layout, dot files, and the symlink (never followed or replaced).
  assert.match(await fs.readFile(path.join(s.root, 'placement.json'), 'utf8'), /boat/);
  assert.equal(await fs.readFile(path.join(s.root, '.env'), 'utf8'), 'API_KEY=nope');
  assert.equal((await fs.lstat(path.join(s.root, 'link-out.txt'))).isSymbolicLink(), true);
  // The AI is told: an `undone` request and its line.
  const rec = JSON.parse(await fs.readFile(path.join(s.root, '.studio/requests', `${u.json.id}.json`), 'utf8'));
  assert.equal(rec.kind, 'undone');
  assert.deepEqual(rec.files.sort(), ['js/main.js', 'models/lighthouse.js']);
  assert.match(rec.text, /Undo AI change/);
  assert.equal(s.lines.at(-1), handoffLine(rec, `.studio/requests/${u.json.id}.json`));
  assert.match(s.lines.at(-1), /^studio: undone \.studio\/requests\/.*-undone-[0-9a-f]{4}\.json "The person pressed/);

  const r = await s.req('POST', 'undo', { to: u.json.redo, redo: true });
  assert.equal(r.status, 200);
  assert.equal(await fs.readFile(main, 'utf8'), 'export const lighthouses = 4;\n');
  assert.equal(await fs.readFile(path.join(s.root, 'models/lighthouse.js'), 'utf8'), 'export {};\n');
  assert.match(s.lines.at(-1), /pressed Redo/);
});

test('undo: unknown or malformed ids are refused and change nothing', async (t) => {
  const s = await start();
  t.after(s.close);
  assert.equal((await s.req('POST', 'undo', { to: '../../etc' })).status, 400);
  assert.equal((await s.req('POST', 'undo', { to: '20261016-153012-482-ask-9f3c' })).status, 404);
  assert.equal(await fs.readFile(path.join(s.root, 'js/main.js'), 'utf8'), 'export const lighthouses = 1;\n');
});

test('undo: a snapshot manifest with a path that leaves the folder is not followed', async (t) => {
  const s = await start();
  t.after(s.close);
  const ask = await s.req('POST', 'request', { kind: 'ask', text: 'x' });
  const mf = path.join(s.root, '.studio/undo', `${ask.json.id}.json`);
  const m = JSON.parse(await fs.readFile(mf, 'utf8'));
  const sha = m.files[0][1];
  m.files.push(['../outside.txt', sha, 1], ['.studio/status.json', sha, 1], ['link-out.txt', sha, 1]);
  await fs.writeFile(mf, JSON.stringify(m));
  const u = await s.req('POST', 'undo', { to: ask.json.id });
  assert.equal(u.status, 200);
  assert.equal(await fs.readFile(path.join(s.base, 'outside.txt'), 'utf8'), 'outside');
  await assert.rejects(fs.stat(path.join(s.root, '.studio/status.json')));
  assert.equal((await fs.lstat(path.join(s.root, 'link-out.txt'))).isSymbolicLink(), true);
});

test('the built studio.mjs --watch prints its first line and removes its heartbeat when stopped', { timeout: 20000 }, async (t) => {
  const s = await start();
  t.after(s.close);
  const child = spawn(process.execPath, [path.join(PKG, 'skills/arrange/bin/studio.mjs'), s.root, '--watch'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (c) => (out += c));
  for (let i = 0; i < 100 && !out.includes('\n'); i++) await sleep(50);
  assert.equal(out.split('\n')[0], 'studio: watching 0 waiting');
  for (let i = 0; i < 60 && !(await s.req('GET', 'status')).json.watching; i++) await sleep(50);
  const ask = await s.req('POST', 'request', { kind: 'ask', text: 'Add three lighthouses around the island' });
  assert.equal(ask.json.watching, true);
  for (let i = 0; i < 40 && !out.includes('lighthouses'); i++) await sleep(50);
  assert.match(out, /studio: request ask .*"Add three lighthouses around the island" \(whole game\)/);
  child.kill('SIGTERM');
  await new Promise((r) => child.on('exit', r));
  assert.equal((await s.req('GET', 'status')).json.watching, false);
});

// e2e-save 2026-10-18: ⌘S hands over placement.json and library.json 1 ms apart. Both snapshots found no
// .studio/undo/ and the second mkdir failed (EEXIST): that request had no "Undo AI change".
test('undo: two snapshots at the same moment both keep a copy', async () => {
  const { snapshotGame, hasSnapshot } = await import('./ai-undo.mjs');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'game-studio-undo-race-'));
  await fs.writeFile(path.join(root, 'index.html'), '<!doctype html><title>t</title>');
  await fs.mkdir(path.join(root, '.studio'));
  const a = '20261018-134758-235-saved-6078', b = '20261018-134758-236-saved-d5cc';
  const got = await Promise.all([snapshotGame(root, a), snapshotGame(root, b)]);
  assert.deepEqual(got, [true, true]);
  assert.ok(await hasSnapshot(root, a) && await hasSnapshot(root, b));
  await fs.rm(root, { recursive: true, force: true });
});
