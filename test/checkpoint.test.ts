// Checkpoints (pause-edit stage 3, 2026-10-28; CONTRACT.md §1.14 "Checkpoints"): the loader's codeMoment({ save, load }),
// the game page's hands for them (src/bridge/moment-load.ts — save() checked as JSON data, a page opened from a checkpoint
// holding its first frame until load(m) ran, load() that throws or is gone), the kinds of a later pause there
// (play-move.ts madeBefore: the boss already there is still the game's), and the editor page's pure rules
// (src/shell/checkpoints.ts: this level's only, newest first, the Reload's checkpoint, the name's first words).
// The files (.studio/checkpoints/) are test/checkpoint-files.test.mjs; the whole way in a browser is
// test/studio-checkpoint.browser.mjs.
// Run: node --experimental-strip-types --no-warnings --test test/checkpoint.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { codeMoment } from '../src/loader/studio-placement.js';
import { fromCheckpoint, holdStep, momentData, momentHooks, saveMoment, startCheckpointHold, startMomentSave, MOMENT_WAIT_MS, NO_FRAME_MS, SETTLE_MS } from '../src/bridge/moment-load.ts';
import { createMomentKinds } from '../src/bridge/play-move.ts';
import { checkpointName, checkpointsOf, defaultCheckpointName, reloadCheckpoint } from '../src/shell/checkpoints.ts';
import type { CheckpointInfo, Item } from '../src/contract.ts';

const MOMENT = Symbol.for('game-studio.moment');
const g = globalThis as unknown as Record<string | symbol, unknown> & Window & typeof globalThis;
const fresh = () => {
  delete g[MOMENT];
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A run as the AI would deliver its save / load: the seed, the score, the time left, the boss (made by the game). */
function game() {
  const s = { seed: 11, score: 12480, timeLeft: 18.4, boss: null as null | { x: number; z: number }, loaded: 0 };
  codeMoment({
    values: { score: { name: 'Score', get: () => s.score, set: (v: number) => { s.score = v; } } },
    save: () => ({ v: 1, seed: s.seed, score: s.score, timeLeft: s.timeLeft, boss: s.boss && { ...s.boss } }),
    load: (m: { seed: number; score: number; timeLeft: number; boss: null | { x: number; z: number } }) => {
      s.seed = m.seed;
      s.score = m.score;
      s.timeLeft = m.timeLeft;
      s.boss = m.boss && { ...m.boss };
      s.loaded++;
    },
  });
  return s;
}

test('codeMoment: save / load kept beside the values; a later call with values only leaves them', () => {
  fresh();
  game();
  const h = momentHooks(g)!;
  assert.equal(typeof h.save, 'function');
  assert.equal(typeof h.load, 'function');
  codeMoment({ values: { hp: { name: 'Health', get: () => 3 } } });
  assert.ok(momentHooks(g), 'still there');
  // Values only, no hooks: nothing to keep a checkpoint with.
  fresh();
  codeMoment({ values: { hp: { name: 'Health', get: () => 3 } } });
  assert.equal(momentHooks(g), null);
  // save without load (or the other way): not a game that can start from the middle.
  fresh();
  codeMoment({ save: () => ({}) } as never);
  assert.equal(momentHooks(g), null);
  // Not a function: left out, said once.
  fresh();
  const warns: string[] = [];
  const was = console.warn;
  console.warn = (m: string) => warns.push(String(m));
  try {
    codeMoment({ save: 'yes', load: 3 } as never);
  } finally {
    console.warn = was;
  }
  assert.equal(momentHooks(g), null);
  assert.equal(warns.length, 2);
});

test('momentData: JSON data kept as JSON; a cycle, a BigInt, nothing, a function, too much is said', () => {
  assert.deepEqual(momentData({ a: 1, list: [1, 'two', null], at: { x: 1.5 } }), { ok: true, moment: { a: 1, list: [1, 'two', null], at: { x: 1.5 } }, chars: 44 });
  const cyc: Record<string, unknown> = {};
  cyc.me = cyc;
  assert.match((momentData(cyc) as { error: string }).error, /not plain data/);
  assert.match((momentData({ n: 10n }) as { error: string }).error, /not plain data/);
  assert.match((momentData(undefined) as { error: string }).error, /returned nothing/);
  assert.match((momentData(() => 1) as { error: string }).error, /returned a function/);
  assert.match((momentData({ s: 'x'.repeat(50) }, 40) as { error: string }).error, /at most 40/);
  // Inside, JSON's own rules: a function in an object is left out (SKILL.md asks for plain data).
  assert.deepEqual((momentData({ a: 1, f: () => 1 }) as { moment: unknown }).moment, { a: 1 });
});

test('saveMoment / moment/save: save() now — only while paused; no hooks = none; a save() that throws is said', () => {
  fresh();
  assert.equal((saveMoment(g) as { none: boolean }).none, true);
  const s = game();
  s.boss = { x: -2, z: -20 };
  assert.deepEqual(saveMoment(g), { ok: true, moment: { v: 1, seed: 11, score: 12480, timeLeft: 18.4, boss: { x: -2, z: -20 } } });
  // The message: refused while playing, answered with the same n.
  const sent: Array<Record<string, unknown>> = [];
  const listeners: Array<(ev: MessageEvent) => void> = [];
  const parent = { postMessage: (m: Record<string, unknown>) => sent.push(m) };
  const win = { parent, addEventListener: (_: string, fn: (ev: MessageEvent) => void) => listeners.push(fn), [MOMENT]: g[MOMENT] } as unknown as Window & typeof globalThis;
  let paused = false;
  startMomentSave({ win, parentOrigin: 'http://studio', paused: () => paused });
  const say = (data: unknown) => listeners.forEach((fn) => fn({ source: parent, origin: 'http://studio', data } as unknown as MessageEvent));
  say({ type: 'studio:moment/save', n: 1 });
  assert.deepEqual(sent.at(-1), { type: 'studio:moment/saved', n: 1, ok: false, error: 'the game is not paused' });
  paused = true;
  say({ type: 'studio:moment/save', n: 2 });
  assert.equal(sent.at(-1)!.ok, true);
  assert.equal((sent.at(-1)!.moment as { score: number }).score, 12480);
  fresh();
  codeMoment({ save: () => { throw new Error('foes is not defined\n at save'); }, load: () => {} });
  (win as unknown as Record<symbol, unknown>)[MOMENT] = g[MOMENT];
  say({ type: 'studio:moment/save', n: 3 });
  assert.deepEqual(sent.at(-1), { type: 'studio:moment/saved', n: 3, ok: false, error: 'save() failed (foes is not defined)' });
});

test('fromCheckpoint: only ?studioMoment=1', () => {
  assert.equal(fromCheckpoint('http://x/index.html?studioMoment=1'), true);
  assert.equal(fromCheckpoint('http://x/index.html?studioMoment=0'), false);
  assert.equal(fromCheckpoint('http://x/index.html'), false);
});

test('holdStep: load once the moment came and the game asked for its first frame (a moment later); late without a moment', () => {
  const base = { start: 0, loadedAt: null };
  assert.equal(holdStep({ ...base, now: 100, moment: false, askedAt: 50 }), 'wait');
  assert.equal(holdStep({ ...base, now: MOMENT_WAIT_MS, moment: false, askedAt: 50 }), 'late');
  assert.equal(holdStep({ ...base, now: 60, moment: true, askedAt: 50 }), 'wait', 'a codeMoment written after the loop starts is not in yet');
  assert.equal(holdStep({ ...base, now: 50 + SETTLE_MS, moment: true, askedAt: 50 }), 'load');
  // A game with no frames of its own: after the page loaded and NO_FRAME_MS.
  assert.equal(holdStep({ ...base, now: 500, moment: true, askedAt: null }), 'wait');
  assert.equal(holdStep({ start: 0, loadedAt: 100, now: 100 + NO_FRAME_MS, moment: true, askedAt: null }), 'load');
});

/** A game page as the hold sees it: its frames (held / let go), its clock, its rAF, the editor's messages. */
function page() {
  const sent: Array<Record<string, unknown>> = [];
  const listeners: Array<(ev: MessageEvent) => void> = [];
  const parent = { postMessage: (m: Record<string, unknown>) => sent.push(m) };
  const log: string[] = [];
  const frames: Array<() => void> = [];
  const win = {
    parent,
    console,
    document: { readyState: 'complete' },
    addEventListener: (type: string, fn: (ev: MessageEvent) => void) => {
      if (type === 'message') listeners.push(fn);
    },
    requestAnimationFrame: (cb: () => void) => (frames.push(cb), frames.length),
    [MOMENT]: g[MOMENT],
  } as unknown as Window & typeof globalThis;
  const time = { frozen: false, freeze: () => ((time.frozen = true), log.push('freeze')), thaw: () => ((time.frozen = false), log.push('thaw')) };
  const clock = { stop: () => log.push('clock stop'), go: () => log.push('clock go') };
  const before: Array<[number, string[]]> = [];
  const say = (data: unknown) => listeners.forEach((fn) => fn({ source: parent, origin: 'http://studio', data } as unknown as MessageEvent));
  return { win, sent, log, time, clock, before, say, frames };
}

test('a page opened from a checkpoint: held from the start, load(m) BEFORE the first frame, then let go', async () => {
  fresh();
  const s = game();
  const p = page();
  const hold = startCheckpointHold({ win: p.win, parentOrigin: 'http://studio', time: p.time, clock: p.clock, before: (sec, scene) => p.before.push([sec, scene]) });
  assert.deepEqual(p.log, ['freeze']);
  assert.equal(hold.holding, true);
  // The game asks for its first frame: its clock waits from here.
  p.win.requestAnimationFrame(() => p.log.push('frame'));
  assert.deepEqual(p.log, ['freeze', 'clock stop']);
  await sleep(60);
  assert.equal(s.loaded, 0, 'no moment yet: nothing loaded');
  p.say({ type: 'studio:moment/load', name: 'Before the boss', time: 42.3, scene: ['ship', 'gate'], moment: { seed: 7, score: 13008, timeLeft: 5, boss: { x: -2, z: -18 } } });
  await sleep(SETTLE_MS + 60);
  assert.equal(s.loaded, 1);
  assert.deepEqual({ seed: s.seed, score: s.score, timeLeft: s.timeLeft, boss: s.boss }, { seed: 7, score: 13008, timeLeft: 5, boss: { x: -2, z: -18 } });
  assert.deepEqual(p.before, [[42.3, ['ship', 'gate']]], 'the clock from 0:42.3, the scene\'s keys for the kinds');
  assert.deepEqual(p.log, ['freeze', 'clock stop', 'clock go', 'thaw'], 'the frame never ran before load');
  assert.deepEqual(p.sent.at(-1), { type: 'studio:moment/loaded', ok: true });
  assert.equal(hold.holding, false);
});

test('a load(m) that throws: the page stays held, the error and the console\'s lines go to the editor', async () => {
  fresh();
  codeMoment({ save: () => ({}), load: (m: { foes?: unknown[] }) => {
    console.warn('old checkpoint: no foes list');
    return m.foes!.map((f) => f);
  } });
  const p = page();
  const quiet = { warn: console.warn };
  console.warn = () => {};
  try {
    startCheckpointHold({ win: p.win, parentOrigin: 'http://studio', time: p.time, clock: p.clock, before: () => {} });
    p.win.requestAnimationFrame(() => {});
    p.say({ type: 'studio:moment/load', name: 'Old one', moment: { score: 1 } });
    await sleep(SETTLE_MS + 80);
  } finally {
    console.warn = quiet.warn;
  }
  const r = p.sent.at(-1) as { ok: boolean; why: string; error: string; logs: Array<{ level: string; text: string }> };
  assert.equal(r.ok, false);
  assert.equal(r.why, 'threw');
  assert.match(r.error, /Cannot read properties of undefined|undefined/);
  assert.equal(r.logs[0]!.text, 'old checkpoint: no foes list');
  assert.match(r.logs.at(-1)!.text, /^load\(m\) failed: /);
  assert.ok(!p.log.includes('thaw'), 'held: half a moment is not a game');
});

test('a game with no load() any more: nothing loaded, the page plays from its start (none)', async () => {
  fresh();
  codeMoment({ values: {} });
  const p = page();
  startCheckpointHold({ win: p.win, parentOrigin: 'http://studio', time: p.time, clock: p.clock, before: () => assert.fail('no before without a load') });
  p.win.requestAnimationFrame(() => {});
  p.say({ type: 'studio:moment/load', name: 'x', moment: {} });
  await sleep(SETTLE_MS + 60);
  assert.deepEqual(p.sent.at(-1), { type: 'studio:moment/loaded', ok: false, why: 'none' });
  assert.ok(p.log.includes('thaw'));
});

test('a load(m) that returns a promise: let go once it settles', async () => {
  fresh();
  let done = false;
  codeMoment({ save: () => ({}), load: () => new Promise<void>((r) => setTimeout(() => ((done = true), r()), 50)) });
  const p = page();
  startCheckpointHold({ win: p.win, parentOrigin: 'http://studio', time: p.time, clock: p.clock, before: () => {} });
  p.win.requestAnimationFrame(() => {});
  p.say({ type: 'studio:moment/load', name: 'x', moment: {} });
  await sleep(SETTLE_MS + 30);
  assert.ok(!p.log.includes('thaw'), 'waiting for the promise');
  await sleep(100);
  assert.ok(done);
  assert.ok(p.log.includes('thaw'));
  assert.deepEqual(p.sent.at(-1), { type: 'studio:moment/loaded', ok: true });
});

test('kinds on a page opened from a checkpoint: what the scene does not have is the game\'s (the boss already there)', async () => {
  const pose = (x: number) => ({ p: [x, 0, 0] });
  let list: Item[] = [
    { key: 'gate', label: 'gate', pose: pose(0) } as Item,
    { key: 'ship', label: 'ship', pose: pose(1) } as Item,
    { key: 'boss', label: 'boss', pose: pose(5) } as Item,
  ];
  const k = createMomentKinds(() => list, () => Promise.resolve(), Promise.resolve([]));
  await sleep(10);
  // A Play from the start would call the boss placed (it was there at the first frame and did not move).
  assert.deepEqual(k.pause(list, '3d'), {});
  k.resumed(list, '3d');
  k.madeBefore(['gate', 'ship']);
  list = list.map((i) => (i.key === 'ship' ? { ...i, pose: pose(2) } : i));
  assert.deepEqual(k.pause(list, '3d'), { ship: 'game', boss: 'new' });
  // Empty = not known: as a Play from the start (the boss placed again; the ship moved by the game).
  k.madeBefore([]);
  assert.deepEqual(k.pause(list, '3d'), { ship: 'game' });
});

const cp = (id: string, at: string, level: string | null = null): CheckpointInfo => ({ id, name: id, at, level, time: 1 });

test('checkpointsOf: this level\'s only, newest first; a game without levels lists those without a level', () => {
  const list = [cp('a', '2026-10-28T10:00:00Z'), cp('b', '2026-10-28T11:00:00Z'), cp('cave1', '2026-10-28T12:00:00Z', 'cave'), cp('c', '2026-10-28T09:00:00Z')];
  assert.deepEqual(checkpointsOf(list, null).map((c) => c.id), ['b', 'a', 'c']);
  assert.deepEqual(checkpointsOf(list, 'cave').map((c) => c.id), ['cave1']);
  assert.deepEqual(checkpointsOf(list, 'sky').map((c) => c.id), []);
});

test('reloadCheckpoint: the one this Play opened from, else the newest of this level, else none', () => {
  const list = [cp('a', '2026-10-28T10:00:00Z'), cp('b', '2026-10-28T11:00:00Z'), cp('cave1', '2026-10-28T12:00:00Z', 'cave')];
  assert.equal(reloadCheckpoint(list, null, 'a')!.id, 'a');
  assert.equal(reloadCheckpoint(list, null, null)!.id, 'b');
  assert.equal(reloadCheckpoint(list, null, 'gone')!.id, 'b');
  assert.equal(reloadCheckpoint(list, null, 'cave1')!.id, 'b', 'another level\'s is not this one\'s');
  assert.equal(reloadCheckpoint([], null, null), null);
});

test('the name: "0:42" first (the game\'s time), one line, at most 40', () => {
  assert.equal(defaultCheckpointName(42.31), '0:42');
  assert.equal(defaultCheckpointName(61.9), '1:01');
  assert.equal(checkpointName('  Before\n the   boss '), 'Before the boss');
  assert.equal(checkpointName('x'.repeat(60)).length, 40);
  assert.equal(checkpointName('   '), '');
});
