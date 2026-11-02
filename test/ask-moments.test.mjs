// The moment of each paused ask (pause-ask stage 3, 2026-11-02; src/server/ask-moments.mjs, CONTRACT.md §3.5.1 `back`):
// the file's form, a moment that is too big or not data, the time alone (a game without save / load), the path a
// request names, pruning to the newest few, and `--check-moment <back>`'s argument. The request route that keeps it:
// src/server/server.test.mjs. The screen: test/studio-pause.browser.mjs (moment, ▶ Try from).
// Run: node --test test/ask-moments.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { askMomentFile, askMomentId, askMomentPath, getAskMoment, keepAskMoment, readAskMoment, ASK_MOMENTS_KEPT } from '../src/server/ask-moments.mjs';
import { CHECKPOINT_MAX_CHARS } from '../src/server/checkpoints.mjs';
import { handoffLine } from '../src/server/ai-watch.mjs';

const ID = '20261102-120000-000-play-ab12';
const MOMENT = { v: 1, seed: 11, score: 13097, timeLeft: 24.86, boss: { x: -2, z: -18 } };

async function folder() {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'studio-asks-')));
  await fs.writeFile(path.join(root, 'index.html'), '<!doctype html><html><head></head><body></body></html>');
  return root;
}

test('the file: the time, the level, the whole moment when the game has save / load, the camera', () => {
  const now = new Date('2026-11-02T12:00:00Z');
  const f = askMomentFile({ time: 5.0234, level: 'level-1', moment: MOMENT, view: { eye: [0, 3, 6], target: [0, 0, -10] } }, now);
  assert.deepEqual(f.value, { version: 1, at: '2026-11-02T12:00:00.000Z', level: 'level-1', time: 5.023, moment: MOMENT, view: { eye: [0, 3, 6], target: [0, 0, -10] } });
  // No save / load in the game (decided 2026-11-02: the AI adds them with its first fix from a pause): the time alone.
  const bare = askMomentFile({ time: 5.02 }, now).value;
  assert.equal('moment' in bare, false);
  assert.equal(bare.level, null);
  // A camera that is not one is dropped (a hint), never an error.
  assert.equal('view' in askMomentFile({ time: 1, view: { eye: [0, 'x', 0], target: [0, 0, 0] } }).value, false);
});

test('the file: no time, a moment that is not data or is too big — refused (the request is kept without it)', () => {
  assert.match(askMomentFile({}).error, /back\.time/);
  assert.match(askMomentFile({ time: -1 }).error, /back\.time/);
  assert.match(askMomentFile(null).error, /moment of the ask/);
  const loop = {};
  loop.self = loop;
  assert.match(askMomentFile({ time: 1, moment: loop }).error, /JSON data/);
  assert.match(askMomentFile({ time: 1, moment: 'x'.repeat(CHECKPOINT_MAX_CHARS + 1) }).error, /at most/);
});

test('read back: the same things, a broken file is null', () => {
  const v = askMomentFile({ time: 5.02, moment: MOMENT }, new Date('2026-11-02T12:00:00Z')).value;
  assert.deepEqual(readAskMoment(JSON.stringify(v)), v);
  assert.equal(readAskMoment('{not json'), null);
  assert.equal(readAskMoment(JSON.stringify({ version: 1 })), null, 'no time');
  // A moment of `null` (a game whose save() returned null) is still a moment: Try loads it.
  assert.deepEqual(readAskMoment(JSON.stringify({ version: 1, time: 2, moment: null })).moment, null);
});

test('the path a request names, and --check-moment <back> takes it, the file name or the bare id', () => {
  assert.equal(askMomentPath(ID), `.studio/asks/${ID}.json`);
  for (const a of [`.studio/asks/${ID}.json`, `asks/${ID}.json`, `${ID}.json`, ID, `./.studio/asks/${ID}.json`]) assert.equal(askMomentId(a), ID, a);
  for (const a of ['6', '.', 'index.html', '.studio/asks/../../etc.json', '']) assert.equal(askMomentId(a), null, a);
});

test('kept as .studio/asks/<request id>.json; only the newest are kept', async (t) => {
  const root = await folder();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const k = await keepAskMoment(root, ID, { time: 5.02, moment: MOMENT });
  assert.equal(k.path, `.studio/asks/${ID}.json`);
  assert.equal(k.exact, true);
  assert.deepEqual((await getAskMoment(root, ID)).moment, MOMENT);
  assert.equal(await getAskMoment(root, '../secret'), null);
  assert.equal(await getAskMoment(root, '20261102-120000-000-play-ffff'), null);
  assert.match((await keepAskMoment(root, ID, { time: 'soon' })).error, /back\.time/);
  // ASK_MOMENTS_KEPT + 3 more asks: the oldest go, the newest stay (ids sort by time).
  for (let i = 0; i < ASK_MOMENTS_KEPT + 3; i++) await keepAskMoment(root, `20261102-12${String(10 + i).padStart(2, '0')}00-000-play-ab12`, { time: i });
  const names = (await fs.readdir(path.join(root, '.studio', 'asks'))).sort();
  assert.equal(names.length, ASK_MOMENTS_KEPT);
  assert.equal(names.includes(`${ID}.json`), false, 'the oldest went');
});

test('the AI\'s line names the moment and how to open it before replying', () => {
  const line = handoffLine({ kind: 'play', text: 'Bring the boss in from here', paused: true, back: `.studio/asks/${ID}.json` }, `.studio/requests/${ID}.json`);
  assert.match(line, new RegExp(`moment \\.studio/asks/${ID}\\.json \\(--check-moment \\.studio/asks/${ID}\\.json before you reply\\)`));
});
