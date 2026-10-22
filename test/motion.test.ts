// Motion (motion-gui, 2026-10-22), without a browser: the file's `motion` part (schema), the editor's bookkeeping
// (motion-model.ts inside PlacementModel: Save count, the file, save), the card's helpers (kinds, + / −), one undo
// step per change and the shell's wiring to the game page (motion-wire.ts: what is sent, the seed, a point drag).
// The loader's maths (motionAt) and its frame loop are tested in src/loader/studio-placement.test.mjs; the card and
// the path in a real editor in test/studio-motion.browser.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PlacementModel } from '../src/shell/placement-model.ts';
import { UndoStack } from '../src/shell/undo.ts';
import { addPoint, dropPoint, fallbackPath, kindOf, MotionStore, sameMotion, withKind } from '../src/shell/motion-model.ts';
import { createMotionWire } from '../src/shell/motion-wire.ts';
import { validateStudioFile, canonicalJSON } from '../src/schema/studio-files.mjs';
import type { Item, Motion, ShellToBridge } from '../src/contract.ts';

const item = (key: string, p: number[]): Item => ({ key, label: key, kinds: ['mesh'], rotatable: true, scalable: true, pose: { p, r: 0, s: 1 } });
const file = (extra: object, dim = '3d') => ({ version: 1, tool: 'placement', dim, space: 'local', objects: {}, ...extra });
type R = { ok: true; value: { motion?: Record<string, Motion> } } | { ok: false; errors: string[] };
const check = (f: object) => validateStudioFile(f, { tool: 'placement' }) as R;

test('schema: a motion is kept, rounded, and a file without one is byte for byte what it was', () => {
  const r = check(file({ motion: { boat: { path: [[7.00049, 0, -2]], speed: 1.5, repeat: 'pingpong' }, buoy: { spin: 1.570796 } } }));
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual(r.value.motion, { boat: { path: [[7, 0, -2]], speed: 1.5, repeat: 'pingpong' }, buoy: { spin: 1.5708 } });
  const plain = check(file({}));
  assert.ok(plain.ok);
  assert.equal(canonicalJSON(plain.value), canonicalJSON(file({})), 'no motion field appears');
  assert.ok(!('motion' in plain.value));
});

test('schema: bad motions are refused with a reason', () => {
  const bad = (m: unknown, why: RegExp, extra: object = {}) => {
    const r = check(file({ motion: m, ...extra }));
    assert.equal(r.ok, false, JSON.stringify(m));
    if (!r.ok) assert.ok(r.errors.some((e) => why.test(e)), r.errors.join('\n'));
  };
  bad({ a: {} }, /needs a path or a spin/);
  bad({ a: { path: [] } }, /1 to 32 points/);
  bad({ a: { path: [[1, 2]] } }, /3 numbers/);
  bad({ a: { path: [[1, 0, 0]], repeat: 'bounce' } }, /pingpong, loop, once/);
  bad({ a: { path: [[1, 0, 0]], speed: 0 } }, /more than 0/);
  bad({ a: { spin: 0 } }, /must not be 0/);
  bad({ a: { spin: 1, speed: 2 } }, /only with a path/);
  bad({ a: { path: Array.from({ length: 33 }, () => [1, 0, 0]) } }, /1 to 32 points/);
  bad({ a: { path: [[1, 0, 0]], wobble: 1 } }, /wobble/);
  bad({ __proto__x: { spin: 1 }, 'bad key!': { spin: 1 } }, /key must match/);
  bad({ lamp: { spin: 1 } }, /also in removed/, { removed: [{ key: 'lamp' }] });
  // 2D: two numbers a point.
  assert.ok(check(file({ motion: { bird: { path: [[120, -40]], speed: 80, repeat: 'loop' } } }, '2d')).ok);
});

test('helpers: the card\'s kinds keep the points; + and − on a loop and a back-and-forth', () => {
  assert.equal(kindOf(null), 'none');
  assert.equal(kindOf({ spin: 1 }), 'spin');
  assert.equal(kindOf({ path: [[1, 0, 0]] }), 'pingpong');
  assert.equal(kindOf({ path: [[1, 0, 0]], repeat: 'loop', spin: 1 }), 'loop', 'a path with a spin shows its path');
  const pp = withKind(null, 'pingpong', '3d')!;
  assert.deepEqual(pp, { path: [], speed: 1.5, repeat: 'pingpong' }, 'no points yet: the game picks them (seed)');
  const mine: Motion = { path: [[3, 0, 1], [5, 0, 0]], speed: 2, repeat: 'pingpong' };
  assert.deepEqual(withKind(mine, 'loop', '3d'), { path: [[3, 0, 1], [5, 0, 0]], speed: 2, repeat: 'loop' }, 'switching kind keeps the person\'s points');
  assert.deepEqual(withKind(mine, 'spin', '3d'), { spin: Math.PI / 2 });
  assert.equal(withKind(mine, 'none', '3d'), null);
  // +: a loop grows a corner in the middle of its closing side; a back-and-forth goes on past its end.
  assert.deepEqual(addPoint({ path: [[4, 0, 0], [4, 0, 4]], repeat: 'loop' }).path, [[4, 0, 0], [4, 0, 4], [2, 0, 2]]);
  assert.deepEqual(addPoint({ path: [[4, 0, 0]], repeat: 'pingpong' }).path, [[4, 0, 0], [6, 0, 0]]);
  assert.deepEqual(dropPoint({ path: [[4, 0, 0], [6, 0, 0]] }).path, [[4, 0, 0]]);
  assert.deepEqual(dropPoint({ path: [[4, 0, 0]] }).path, [[4, 0, 0]], 'a path keeps one point');
  assert.deepEqual(fallbackPath('loop', '3d'), [[3, 0, 0], [3, 0, -3], [0, 0, -3]]);
  assert.ok(sameMotion({ path: [[1.0001, 0, 0]] }, { path: [[1, 0, 0]] }), 'same at the file\'s rounding');
});

test('model: a motion is one Save count, goes to the file, and is saved', () => {
  const m = new PlacementModel();
  m.setItems([item('boat', [8.5, 0, 9.6]), item('buoy', [-10, 0, -1])], '3d');
  assert.equal(m.dirty(), 0);
  m.motion.set('boat', { path: [[6, 0, -1]], speed: 1.5, repeat: 'pingpong' });
  m.motion.set('buoy', { spin: 1 });
  assert.equal(m.dirty(), 2);
  assert.deepEqual([...m.changedKeys()].sort(), ['boat', 'buoy'], 'a dot on both rows');
  const f = m.result();
  assert.deepEqual(f.objects, {}, 'a motion is not a move');
  assert.deepEqual(f.motion, { boat: { path: [[6, 0, -1]], speed: 1.5, repeat: 'pingpong' }, buoy: { spin: 1 } });
  assert.ok((check(f) as { ok: boolean }).ok, 'what the model writes, the schema takes');
  m.markSaved();
  assert.equal(m.dirty(), 0);
  // Back to none after the save: one change again, and the file has no motion part.
  m.motion.set('buoy', null);
  m.motion.set('boat', null);
  assert.equal(m.dirty(), 2);
  assert.equal(m.result().motion, undefined);
});

test('model: the saved file\'s motions are where the editor starts; a deleted object\'s motion is not written', () => {
  const m = new PlacementModel();
  m.restore({ version: 1, tool: 'placement', dim: '3d', space: 'local', objects: {}, motion: { boat: { spin: 2 } } });
  m.setItems([item('boat', [0, 0, 0])], '3d');
  assert.deepEqual(m.motion.get('boat'), { spin: 2 });
  assert.equal(m.dirty(), 0, 'as saved');
  m.remove('boat');
  assert.equal(m.result().motion, undefined);
});

test('store: a path still waiting for its points changes nothing yet', () => {
  const s = new MotionStore();
  s.set('a', { path: [], speed: 1, repeat: 'pingpong' });
  assert.deepEqual(s.changedKeys(), []);
  assert.equal(s.result('3d', () => false), undefined);
});

test('wire: the card\'s change is one undo step and goes to the game; the seed replaces the stand-in points', () => {
  const store = new MotionStore();
  const undo = new UndoStack();
  const sent: ShellToBridge[] = [];
  let changed = 0;
  const w = createMotionWire({ store, undo, send: (m) => sent.push(m), dim: () => '3d', picked: () => 'boat', changed: () => changed++ });
  w.sync();
  assert.deepEqual(sent.pop(), { type: 'studio:motion/show', key: null, motion: null });
  w.sync();
  assert.equal(sent.length, 0, 'nothing new: nothing sent');
  // "Back and forth" chosen: stand-in points at once, the game asked for points in sight.
  w.row.setMotion('boat', withKind(null, 'pingpong', '3d'), { seed: true });
  const show = sent.pop() as Extract<ShellToBridge, { type: 'studio:motion/show' }>;
  assert.equal(show.seed, true);
  assert.deepEqual(show.motion?.path, [[3, 0, 0]]);
  assert.equal(undo.size, 1);
  // The game answers with points on screen: the same undo step now ends there.
  w.onMessage({ type: 'studio:motion/changed', key: 'boat', motion: { path: [[5, 0, -1]], speed: 1.5, repeat: 'pingpong' }, end: true, seed: true });
  assert.deepEqual(store.get('boat')?.path, [[5, 0, -1]]);
  assert.equal(undo.size, 1);
  const top = undo.peekUndo()!.changes[0] as { kind: string; from: Motion | null; to: Motion | null };
  assert.deepEqual([top.kind, top.from, top.to?.path], ['motion', null, [[5, 0, -1]]]);
  // A point dragged: live moves, then one step from before the drag.
  w.onMessage({ type: 'studio:motion/changed', key: 'boat', motion: { path: [[6, 0, -1]], speed: 1.5, repeat: 'pingpong' }, end: false });
  w.onMessage({ type: 'studio:motion/changed', key: 'boat', motion: { path: [[7, 0, -2]], speed: 1.5, repeat: 'pingpong' }, end: true });
  assert.equal(undo.size, 2);
  const drag = undo.peekUndo()!.changes[0] as { from: Motion; to: Motion };
  assert.deepEqual([drag.from.path, drag.to.path], [[[5, 0, -1]], [[7, 0, -2]]]);
  // ⌘Z: back to the seeded points, and the game is told.
  w.apply(undo.undo()!.changes[0] as never, 'undo');
  assert.deepEqual(store.get('boat')?.path, [[5, 0, -1]]);
  assert.deepEqual((sent.pop() as { motion: Motion }).motion.path, [[5, 0, -1]]);
  // ▶ and its stop by itself.
  w.row.play('boat');
  assert.deepEqual(sent.pop(), { type: 'studio:motion/play', key: 'boat', motion: store.get('boat') });
  assert.equal(w.row.playing(), 'boat');
  w.onMessage({ type: 'studio:motion/played', key: null });
  assert.equal(w.row.playing(), null);
  assert.ok(changed > 0);
});
