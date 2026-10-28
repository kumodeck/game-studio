// Checkpoints' files (pause-edit stage 3, 2026-10-28; src/server/checkpoints.mjs, CONTRACT.md §1.14 "Checkpoints", §3.2):
// the plan's Q2 answered (a) — the editor keeps them in .studio/checkpoints/<id>.json, never in the game. The file's form, the
// id from the person's name (any language), the same name in the same level kept again replaces it and in another level
// gets -2, a broken file never listed, a rename, a delete, and the local API (cookie and same-origin as every write).
// Run: node --test test/checkpoint-files.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import {
  addCheckpoint, checkpointFile, checkpointIdFor, checkpointSlug, cleanCheckpointName, deleteCheckpoint, getCheckpoint, listCheckpoints, readCheckpoint,
  renameCheckpoint, CHECKPOINT_MAX_CHARS,
} from '../src/server/checkpoints.mjs';
import { startStudioServer } from '../src/server/server.mjs';
import { resolveInside } from '../src/server/files.mjs';

async function folder() {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-checkpoint-'));
  const root = await fs.realpath(base);
  await fs.writeFile(path.join(root, 'index.html'), '<!doctype html><html><head></head><body></body></html>');
  return root;
}
const MOMENT = { v: 1, seed: 11, score: 13008, timeLeft: 5, boss: { x: -2, z: -18 }, shots: [[0, 1, -10]] };

test('the slug: letters and digits of any language, the rest "-"; never a dot, a slash or empty', () => {
  assert.equal(checkpointSlug('Before the boss'), 'Before-the-boss');
  assert.equal(checkpointSlug('ボスの前'), 'ボスの前');
  assert.equal(checkpointSlug('0:42'), '0-42');
  assert.equal(checkpointSlug('../../etc/passwd'), 'etc-passwd');
  assert.equal(checkpointSlug('.env'), 'env');
  assert.equal(checkpointSlug('!!!'), 'checkpoint');
  assert.equal(checkpointSlug(''), 'checkpoint');
  assert.equal(cleanCheckpointName('  two\nlines  '), 'two lines');
  assert.equal(cleanCheckpointName('x'.repeat(80)).length, 40);
});

test('the id: the same name in the same level replaces; another level\'s gets -2; a broken file is never replaced', () => {
  const have = new Map([['Before-the-boss', null], ['cave-0-42', 'cave'], ['broken', undefined]]);
  assert.equal(checkpointIdFor('Before the boss', null, have), 'Before-the-boss');
  assert.equal(checkpointIdFor('Before the boss', 'cave', have), 'Before-the-boss-2');
  assert.equal(checkpointIdFor('broken', null, have), 'broken-2');
  assert.equal(checkpointIdFor('New one', null, have), 'New-one');
});

test('the file\'s form: { version, name, at, level, time, moment, shot }; what is not one is refused', () => {
  const now = new Date('2026-10-28T12:00:00.000Z');
  const f = checkpointFile({ name: ' Before the boss ', level: null, time: 42.31049, moment: MOMENT, shot: 'data:image/jpeg;base64,AAAA' }, now);
  assert.deepEqual(f.value, { version: 1, name: 'Before the boss', at: '2026-10-28T12:00:00.000Z', level: null, time: 42.31, moment: MOMENT, shot: 'data:image/jpeg;base64,AAAA' });
  assert.match(checkpointFile({ name: '', time: 1, moment: {} }).error, /"name"/);
  assert.match(checkpointFile({ name: 'x', time: -1, moment: {} }).error, /"time"/);
  assert.match(checkpointFile({ name: 'x', time: 1 }).error, /"moment" is missing/);
  assert.match(checkpointFile({ name: 'x', time: 1, moment: { s: 'x'.repeat(CHECKPOINT_MAX_CHARS) } }).error, /at most/);
  assert.match(checkpointFile({ name: 'x', time: 1, moment: {}, shot: 'javascript:alert(1)' }).error, /"shot"/);
  assert.match(checkpointFile({ name: 'x', time: 1, moment: {}, level: 3 }).error, /"level"/);
});

test('readCheckpoint: a broken file is null (cut short, not JSON, no moment, no name); a later version still reads', () => {
  const good = JSON.stringify({ version: 1, name: 'A', at: '2026-10-28T12:00:00Z', level: null, time: 3, moment: { a: 1 } });
  assert.deepEqual(readCheckpoint(good), { version: 1, name: 'A', at: '2026-10-28T12:00:00Z', level: null, time: 3, moment: { a: 1 } });
  assert.equal(readCheckpoint(good.slice(0, 30)), null);
  assert.equal(readCheckpoint('[]'), null);
  assert.equal(readCheckpoint(JSON.stringify({ version: 1, name: 'A', at: '2026-10-28T12:00:00Z' })), null, 'no moment');
  assert.equal(readCheckpoint(JSON.stringify({ version: 1, name: '', at: '2026-10-28T12:00:00Z', moment: 1 })), null, 'no name');
  assert.equal(readCheckpoint(JSON.stringify({ version: 0, name: 'A', at: '2026-10-28T12:00:00Z', moment: 1 })), null);
  assert.equal(readCheckpoint(JSON.stringify({ version: 2, name: 'A', at: '2026-10-28T12:00:00Z', moment: 1, extra: true })).name, 'A');
  // A moment of null is a moment (the game's own choice).
  assert.equal(readCheckpoint(JSON.stringify({ version: 1, name: 'A', at: '2026-10-28T12:00:00Z', moment: null })).moment, null);
});

test('in a folder: keep, list newest first with each level, a broken file apart, rename, delete', async (t) => {
  const root = await folder();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  assert.deepEqual(await listCheckpoints(root), { checkpoints: [], broken: [] }, 'no folder yet');
  const a = await addCheckpoint(root, { name: 'Before the boss', level: null, time: 42.3, moment: MOMENT }, new Date('2026-10-28T10:00:00Z'));
  assert.equal(a.path, '.studio/checkpoints/Before-the-boss.json');
  const onDisk = JSON.parse(await fs.readFile(path.join(root, a.path), 'utf8'));
  assert.deepEqual(Object.keys(onDisk), ['version', 'name', 'at', 'level', 'time', 'moment']);
  await addCheckpoint(root, { name: 'ボスの前', level: 'cave', time: 12, moment: { x: 1 } }, new Date('2026-10-28T11:00:00Z'));
  await addCheckpoint(root, { name: '0:05', level: null, time: 5, moment: { y: 2 } }, new Date('2026-10-28T09:00:00Z'));
  // A file cut short (an editor that died writing, a hand edit): listed apart, never offered.
  await fs.writeFile(path.join(root, '.studio/checkpoints/cut.json'), '{"version":1,"name":"cut","at":"2026-10-28T');
  // Something else in the folder: not a checkpoint file name at all — not listed.
  await fs.writeFile(path.join(root, '.studio/checkpoints/notes.txt'), 'hi');
  const l = await listCheckpoints(root);
  assert.deepEqual(l.checkpoints.map((c) => [c.id, c.level]), [['ボスの前', 'cave'], ['Before-the-boss', null], ['0-05', null]]);
  assert.deepEqual(l.broken, ['cut']);
  assert.ok(!('moment' in l.checkpoints[0]), 'the list carries no moment');
  // Kept again with the same name in the same level: that one replaced (one file), newer.
  await addCheckpoint(root, { name: 'Before the boss', level: null, time: 43, moment: { again: true } }, new Date('2026-10-28T12:00:00Z'));
  const again = await listCheckpoints(root);
  assert.equal(again.checkpoints.length, 3);
  assert.equal(again.checkpoints[0].id, 'Before-the-boss');
  assert.deepEqual((await getCheckpoint(root, 'Before-the-boss')).moment, { again: true });
  // The same name in another level: its own file.
  const other = await addCheckpoint(root, { name: 'Before the boss', level: 'cave', time: 1, moment: {} });
  assert.equal(other.id, 'Before-the-boss-2');
  assert.equal(await getCheckpoint(root, 'cut'), null);
  assert.equal(await getCheckpoint(root, '../secret'), null);
  // Rename: the file follows the name; the moment stays.
  const r = await renameCheckpoint(root, 'Before-the-boss', 'At the gate');
  assert.equal(r.id, 'At-the-gate');
  assert.equal(await getCheckpoint(root, 'Before-the-boss'), null);
  assert.deepEqual((await getCheckpoint(root, 'At-the-gate')).moment, { again: true });
  await assert.rejects(renameCheckpoint(root, 'nope', 'x'), /no such checkpoint/);
  // Delete.
  assert.equal(await deleteCheckpoint(root, 'At-the-gate'), true);
  assert.equal(await deleteCheckpoint(root, 'At-the-gate'), false);
  await assert.rejects(deleteCheckpoint(root, '../index'), /not a checkpoint id/);
});

test('the game page never gets them: .studio/ is not served', async (t) => {
  const root = await folder();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await addCheckpoint(root, { name: 'x', level: null, time: 1, moment: {} });
  const r = await resolveInside(root, '/.studio/checkpoints/x.json');
  assert.equal(r.ok, false);
});

test('the local API: list, keep, read, rename, delete — with the pass and same-origin only', async (t) => {
  const root = await folder();
  const srv = await startStudioServer({ root, log: () => {} });
  t.after(async () => {
    await srv.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  const token = new URL(srv.url).searchParams.get('t');
  const host = new URL(srv.origin).host;
  const cookie = `studio_${srv.port}=${token}`;
  const req = (method, p, { headers = {}, body } = {}) => new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: srv.port, method, path: p, headers: { host, cookie, ...(body ? { 'content-type': 'application/json' } : {}), ...headers } }, (res) => {
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
    r.end(body);
  });
  const api = '/__studio/api/checkpoints';
  assert.equal((await req('GET', api, { headers: { cookie: '' } })).status, 403, 'no pass');
  assert.deepEqual((await req('GET', api)).json, { checkpoints: [], broken: [] });
  const add = await req('POST', api, { body: JSON.stringify({ name: 'ボスの前', level: null, time: 42.3, moment: MOMENT }) });
  assert.equal(add.status, 200);
  assert.deepEqual(add.json, { ok: true, id: 'ボスの前', path: '.studio/checkpoints/ボスの前.json' });
  assert.equal((await req('POST', api, { body: JSON.stringify({ name: 'x', time: 1, moment: {} }), headers: { origin: 'http://evil.example' } })).status, 403, 'another origin');
  assert.equal((await req('POST', api, { body: JSON.stringify({ name: '', time: 1, moment: {} }) })).status, 422);
  const list = (await req('GET', api)).json;
  assert.deepEqual(list.checkpoints.map((c) => [c.id, c.name, c.time]), [['ボスの前', 'ボスの前', 42.3]]);
  const one = await req('GET', `${api}/${encodeURIComponent('ボスの前')}`);
  assert.deepEqual(one.json.value.moment, MOMENT);
  assert.equal((await req('GET', `${api}/nope`)).status, 404);
  const ren = await req('PATCH', `${api}/${encodeURIComponent('ボスの前')}`, { body: JSON.stringify({ name: 'Before the boss' }) });
  assert.deepEqual(ren.json, { ok: true, id: 'Before-the-boss', path: '.studio/checkpoints/Before-the-boss.json' });
  assert.equal((await req('DELETE', `${api}/Before-the-boss`)).status, 200);
  assert.equal((await req('DELETE', `${api}/Before-the-boss`)).status, 404);
  assert.deepEqual((await req('GET', api)).json, { checkpoints: [], broken: [] });
});

test('the requests of ⚑\'s ✦ and the line\'s ✦: intent moment-save / moment-load, the checkpoint named, the AI\'s line', async () => {
  const { normalizeRequestInput } = await import('../src/schema/handoff.mjs');
  const { handoffLine } = await import('../src/server/ai-watch.mjs');
  const save = normalizeRequestInput({ kind: 'play', text: 'Let the game start from this moment', lang: 'en', paused: true, intent: 'moment-save' });
  assert.equal(save.ok, true);
  assert.equal(save.value.intent, 'moment-save');
  assert.match(handoffLine({ ...save.value, id: 'r' }, '.studio/requests/r.json'), /let the game start from this moment: codeMoment save \/ load, SKILL.md "Checkpoints"/);
  const load = normalizeRequestInput({ kind: 'play', text: 'Make the checkpoint “Before the boss” open again', lang: 'en', paused: true, intent: 'moment-load',
    checkpoint: { id: 'Before-the-boss', name: 'Before the boss', error: "Cannot read properties of undefined (reading 'map')", logs: [{ level: 'error', text: 'load(m) failed: …', ago: 0 }, { level: 'bogus', text: '' }] } });
  assert.equal(load.ok, true);
  assert.deepEqual(load.value.checkpoint, { id: 'Before-the-boss', name: 'Before the boss', error: "Cannot read properties of undefined (reading 'map')", logs: [{ level: 'error', text: 'load(m) failed: …' }] });
  assert.match(handoffLine({ ...load.value, id: 'r' }, '.studio/requests/r.json'), /checkpoint "Before the boss" \.studio\/checkpoints\/Before-the-boss\.json does not open: Cannot read/);
  // Not paused: no checkpoint intent (it is a paused moment's ✦ only); a bad id is dropped, the rest stays.
  const playing = normalizeRequestInput({ kind: 'play', text: 'x', lang: 'en', intent: 'moment-save' });
  assert.equal(playing.value.intent, undefined);
  const bad = normalizeRequestInput({ kind: 'play', text: 'x', lang: 'en', paused: true, intent: 'moment-load', checkpoint: { id: '../x', name: 'n' } });
  assert.deepEqual(bad.value.checkpoint, { name: 'n' });
});

test('the one ✦ of a game without codeMoment (pause walk 2 ✕2): intent moment-connect, paused only, the AI\'s line names both', async () => {
  const { normalizeRequestInput } = await import('../src/schema/handoff.mjs');
  const { handoffLine } = await import('../src/server/ai-watch.mjs');
  const r = normalizeRequestInput({ kind: 'play', text: 'Show this moment’s numbers and let the game start from here', lang: 'en', paused: true, intent: 'moment-connect' });
  assert.equal(r.ok, true);
  assert.equal(r.value.intent, 'moment-connect');
  const line = handoffLine({ ...r.value, id: 'r' }, '.studio/requests/r.json');
  assert.match(line, /connect this moment to the game: codeMoment values \+ save \/ load in one go, SKILL.md "This moment" and "Checkpoints", --check-moment/);
  assert.doesNotMatch(line, /make this moment's values editable|let the game start from this moment/, 'one ask, said once');
  assert.equal(normalizeRequestInput({ kind: 'play', text: 'x', lang: 'en', intent: 'moment-connect' }).value.intent, undefined, 'a paused moment\'s ✦ only');
});

test('--check-moment\'s script before the game: load(moment) at the first frame, before it runs; a throw stops it', async () => {
  const { momentLoadScript } = await import('../src/server/moment-check.mjs');
  const vm = await import('node:vm');
  const run = (load) => {
    const frames = [];
    const order = [];
    const win = { addEventListener: () => {}, requestAnimationFrame: (cb) => (frames.push(cb), frames.length), JSON, String, Symbol };
    win.window = win;
    win.globalThis = win;
    vm.createContext(win);
    vm.runInContext(momentLoadScript(JSON.stringify({ v: 1, score: 13008 })), win);
    // The game: its world, its hooks, its loop.
    win[Symbol.for('game-studio.moment')] = { save: () => ({}), load: (m) => (order.push(['load', m.score]), load?.(m)) };
    win.requestAnimationFrame(() => order.push(['frame']));
    return { win, order, frames };
  };
  const ok = run();
  assert.deepEqual(ok.order, [], 'nothing before the browser\'s frame');
  await ok.frames[0](16);
  assert.deepEqual(ok.order, [['load', 13008], ['frame']], 'load first, then the game\'s first frame');
  assert.equal(ok.win.__studioMomentCheck.loaded, true);
  assert.equal(ok.win.__studioMomentCheck.frames, 1);
  const bad = run(() => { throw new TypeError("Cannot read properties of undefined (reading 'position')"); });
  await bad.frames[0](16);
  assert.deepEqual(bad.order, [['load', 13008]], 'a load that throws: the frame does not run');
  assert.match(bad.win.__studioMomentCheck.error, /reading 'position'/);
});
