// The timeline (studio-timeline, 2026-10-22: "make motion like Unity or Blender"), without a browser: the file's
// `motion` clips (schema; the older path / spin still taken), the maths shared with the game (the loader's clipAt:
// repeat, ease, a curve through the points), the key edits (timeline-model.ts), the older shape read as a clip, the
// model's Save count and file, and timeline-wire.ts — what a move, a typed number, a dragged path point or a key
// press does (auto key on / off, folded), what goes to the game page, one undo step per gesture. The plate itself
// and the path in a real editor: test/studio-timeline.browser.mjs. (Replaces test/motion.test.ts of motion-gui.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PlacementModel } from '../src/shell/placement-model.ts';
import { UndoStack } from '../src/shell/undo.ts';
import { MotionStore, roundMotion, sameMotion } from '../src/shell/motion-model.ts';
import { MotionLibrary, motionLibrary } from '../src/shell/motion-library.ts';
import { whenOf } from '../src/loader/studio-placement.js';
import {
  changedChannels, compose, copyKeys, deleteKeys, easeKeys, blankClip, keyTimes, moveKeys, offsetOf, offsetsAt, pasteKeys, setKey, toClips, withClip,
} from '../src/shell/timeline-model.ts';
import { createTimeline } from '../src/shell/timeline-wire.ts';
import { clipAt, trackAt } from '../src/loader/studio-placement.js';
import { validateStudioFile } from '../src/schema/studio-files.mjs';
import type { Item, Motion, MotionClip, Pose, ShellToBridge } from '../src/contract.ts';

const item = (key: string, p: number[]): Item => ({ key, label: key, kinds: ['mesh'], rotatable: true, scalable: true, pose: { p, r: 0, s: 1 } });
const file = (extra: object, dim = '3d') => ({ version: 1, tool: 'placement', dim, space: 'local', objects: {}, ...extra });
type R = { ok: true; value: { motion?: Record<string, Motion> } } | { ok: false; errors: string[] };
const check = (f: object) => validateStudioFile(f, { tool: 'placement' }) as R;
const near = (a: number[] | null | undefined, b: number[], eps = 1e-6) => !!a && a.length === b.length && a.every((v, i) => Math.abs(v - b[i]!) < eps);

const door: MotionClip = { name: 'Open', len: 2, repeat: 'once', keys: { r: [{ t: 0, v: [0, 0, 0] }, { t: 2, v: [0, 1.5708, 0], ease: 'linear' }] } };

// ----- the file -----

test('schema: clips are kept and rounded; the older shape still passes', () => {
  const r = check(file({ motion: {
    door: { clips: [{ ...door, when: 'when the player is near' }] },
    boat: { clips: [{ name: 'Row', len: 4.00049, repeat: 'pingpong', start: true, keys: { p: [{ t: 0, v: [0, 0, 0] }, { t: 2.0004, v: [-3.10049, 0.8, -1.2] }] } }] },
    buoy: { spin: 1.570796 },
  } }));
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual(r.value.motion!.boat!.clips![0], { name: 'Row', len: 4, repeat: 'pingpong', start: true, keys: { p: [{ t: 0, v: [0, 0, 0] }, { t: 2, v: [-3.1, 0.8, -1.2] }] } });
  assert.equal(r.value.motion!.door!.clips![0]!.when, 'when the player is near');
  assert.deepEqual(r.value.motion!.buoy, { spin: 1.5708 });
  // A game with levels: the clips are a level's (its `motion`), the deepest part of the file.
  assert.ok(check(file({ levels: [{ id: 'cave', motion: { door: { clips: [door] } } }] })).ok);
  // 2D: [x, y] positions, one angle.
  assert.ok(check(file({ motion: { bird: { clips: [{ name: 'Fly', len: 1, keys: { p: [{ t: 0, v: [0, 0] }, { t: 1, v: [80, -20] }], r: [{ t: 1, v: [0.5] }] } }] } } }, '2d')).ok);
});

test('schema: bad clips are refused with a reason', () => {
  const bad = (clips: unknown, why: RegExp, dim = '3d') => {
    const r = check(file({ motion: { a: { clips } } }, dim));
    assert.equal(r.ok, false, JSON.stringify(clips));
    if (!r.ok) assert.ok(r.errors.some((e) => why.test(e)), r.errors.join('\n'));
  };
  bad([], /1 to 16 clips/);
  bad([door, door], /used twice/);
  bad([{ ...door, start: true }, { ...door, name: 'B', start: true }], /only one clip/);
  bad([{ ...door, start: false }], /must be true/);
  bad([{ ...door, len: 0 }], /between 0.1 and 600/);
  bad([{ ...door, keys: { r: [{ t: 3, v: [0, 0, 0] }] } }], /after the clip/);
  bad([{ ...door, keys: { r: [{ t: 1, v: [0, 0, 0] }, { t: 0.5, v: [0, 0, 0] }] } }], /time order/);
  bad([{ ...door, keys: { p: [{ t: 0, v: [0, 0] }] } }], /3 numbers/);
  bad([{ ...door, keys: { r: [{ t: 0, v: [0, 0, 0], ease: 'bounce' }] } }], /linear, ease, step/);
  bad([{ ...door, keys: { q: [] } }], /unknown field/);
  bad([{ ...door, start: true, when: 'x' }], /only for a clip that waits/);
  const r = check(file({ motion: { a: { clips: [door], path: [[1, 0, 0]] } } }));
  assert.equal(r.ok, false, 'clips and the older shape are not mixed');
});

// ----- the maths the game and the editor share -----

test('clipAt: once stops on its last pose, loop wraps, pingpong comes back', () => {
  const p = (repeat: MotionClip['repeat']): MotionClip => ({ name: 'x', len: 2, repeat, keys: { p: [{ t: 0, v: [0, 0, 0], ease: 'linear' }, { t: 2, v: [4, 0, 0] }] } });
  assert.ok(near(clipAt(p('once'), 1).p, [2, 0, 0]));
  assert.ok(near(clipAt(p('once'), 5).p, [4, 0, 0]));
  assert.equal(clipAt(p('once'), 5).done, true);
  assert.ok(near(clipAt(p('loop'), 3).p, [2, 0, 0]), 'loop: 3 s is 1 s into the second round');
  assert.ok(near(clipAt(p('pingpong'), 3).p, [2, 0, 0]), 'pingpong: on its way back');
  assert.ok(near(clipAt(p('pingpong'), 4).p, [0, 0, 0]), 'pingpong: back at the start');
  assert.equal(clipAt(p('once'), 1).r, null, 'no angle keys: the angle is left alone');
  assert.equal(clipAt(null, 1).p, null);
});

test('trackAt: ease starts slowly, step holds, a curve goes through every point', () => {
  const lin = [{ t: 0, v: [0], ease: 'linear' }, { t: 1, v: [10] }];
  const eas = [{ t: 0, v: [0] }, { t: 1, v: [10] }];
  const stp = [{ t: 0, v: [0], ease: 'step' }, { t: 1, v: [10] }];
  assert.ok(near(trackAt(lin, 0.25, false), [2.5]));
  assert.ok((trackAt(eas, 0.25, false) as number[])[0]! < 2.5, 'ease (the default) is slower at the start');
  assert.ok(near(trackAt(eas, 0.5, false), [5]));
  assert.ok(near(trackAt(stp, 0.99, false), [0]), 'step holds until the next key');
  assert.ok(near(trackAt(stp, 1, false), [10]));
  const pts = [{ t: 0, v: [0, 0, 0], ease: 'linear' }, { t: 1, v: [2, 1, 0], ease: 'linear' }, { t: 2, v: [4, 0, 0], ease: 'linear' }];
  for (const k of pts) assert.ok(near(trackAt(pts, k.t, true), k.v), `the curve is at key ${k.t}`);
  const mid = trackAt(pts, 0.5, true) as number[];
  assert.ok(mid[1]! > 0.5, `smooth: rounder than the straight line between the first two points (${mid[1]})`);
  assert.equal(trackAt([{ t: 0, v: [0, 0] }, { t: 1, v: [1] }], 0.5, false), null, 'mixed widths: nothing');
});

test('compose / offsetOf: position added, angle added (tilt too), size multiplied — and back', () => {
  const place: Pose = { p: [1, 2, 3], r: 0.5, s: 2 };
  const pose = compose(place, { p: [1, 0, -1], r: [0.1, 0.2, 0], s: [1.5, 1.5, 1.5] }, '3d');
  assert.deepEqual(pose.p, [2, 2, 2]);
  assert.ok(Math.abs(pose.r! - 0.7) < 1e-9);
  assert.ok(near(pose.t, [0.1, 0]));
  assert.equal(pose.s, 3, 'a uniform size stays one number');
  assert.ok(near(offsetOf(place, pose, 'p', '3d'), [1, 0, -1]));
  assert.ok(near(offsetOf(place, pose, 'r', '3d'), [0.1, 0.2, 0]));
  assert.ok(near(offsetOf(place, pose, 's', '3d'), [1.5, 1.5, 1.5]));
  assert.deepEqual(changedChannels(place, { ...place, p: [1, 2.5, 3] }, '3d'), ['p']);
  assert.deepEqual(changedChannels(place, { ...place, r: 1 }, '3d'), ['r']);
  assert.equal(compose(place, { p: null, r: null, s: null }, '3d').t, undefined, 'no motion: no tilt appears');
});

// ----- key edits -----

test('keys: set (replace at the same moment, the length grows), move, delete, ease, copy and paste', () => {
  let c: MotionClip = { name: 'M', len: 1, repeat: 'once', keys: {} };
  c = setKey(c, 'p', 0, [0, 0, 0]);
  c = setKey(c, 'p', 2, [3, 0, 0]);
  assert.equal(c.len, 2, 'a key past the end makes the clip longer');
  c = setKey(c, 'p', 2.0001, [4, 0, 0]);
  assert.equal(c.keys.p!.length, 2, 'the same moment: replaced');
  assert.deepEqual(c.keys.p![1]!.v, [4, 0, 0]);
  const moved = moveKeys(c, 'a', [{ key: 'a', ch: 'p', t: 2 }], -0.5);
  assert.deepEqual(keyTimes(moved.clip), [0, 1.5]);
  assert.deepEqual(moved.moved, [{ key: 'a', ch: 'p', t: 1.5 }]);
  const onto = moveKeys(c, 'a', [{ key: 'a', ch: 'p', t: 2 }], -2);
  assert.deepEqual(onto.clip.keys.p, [{ t: 0, v: [4, 0, 0], ease: 'ease' }], 'a key dragged onto another replaces it');
  assert.equal(deleteKeys(c, 'a', [{ key: 'a', ch: 'p', t: 0 }, { key: 'a', ch: 'p', t: 2 }]).keys.p, undefined, 'no key left: the property goes');
  assert.equal(easeKeys(c, 'a', [{ key: 'a', ch: 'p', t: 0 }], 'step').keys.p![0]!.ease, 'step');
  const copied = copyKeys(c, 'a', [{ key: 'a', ch: 'p', t: 2 }]);
  assert.deepEqual(copied, [{ ch: 'p', dt: 0, v: [4, 0, 0], ease: 'ease' }]);
  const pasted = pasteKeys(c, copied, 1, '3d');
  assert.deepEqual(keyTimes(pasted.clip), [0, 1, 2]);
  assert.equal(pasteKeys(c, copied, 1, '2d').pasted.length, 0, 'a 3D key does not paste onto a 2D object');
  assert.deepEqual(withClip({ clips: [c] }, 'M', null), null);
  assert.deepEqual(withClip({ clips: [c] }, 'M', { ...c, name: 'N' })!.clips!.map((x) => x.name), ['N'], 'a rename keeps its place');
});

test('a new motion has no keys (studio-no-presets: no kinds to start from; studio-ui-lead2: no empty scene either — linking makes one)', () => {
  assert.deepEqual(blankClip('M').keys, {});
  assert.equal(blankClip('M').repeat, 'once');
});

test('the older shape (v0.1.13) is read as one clip', () => {
  const pp = toClips({ path: [[4, 0, 0]], speed: 2, repeat: 'pingpong' }, '3d')!.clips![0]!;
  assert.equal(pp.len, 2);
  assert.equal(pp.repeat, 'pingpong');
  assert.equal(pp.start, true, 'it played at the start: it still does');
  assert.ok(near(offsetsAt(pp, 1).p, [2, 0, 0]), 'the same speed: 2 m at 1 s');
  const loop = toClips({ path: [[2, 0, 0], [2, 0, 2]], speed: 1, repeat: 'loop' }, '3d')!.clips![0]!;
  assert.deepEqual(loop.keys.p!.map((k) => k.t), [0, 2, 4, 6.828], 'the way back to the start is the last key');
  const spin = toClips({ spin: Math.PI }, '3d')!.clips![0]!;
  assert.equal(spin.len, 2, 'one turn at π rad/s takes 2 s');
  assert.equal(spin.repeat, 'loop');
  assert.ok(near(offsetsAt(spin, 1).r, [0, Math.PI, 0]));
  assert.equal(toClips({ spin: -1 }, '2d')!.clips![0]!.keys.r![1]!.v.length, 1, '2D: one angle');
  assert.equal(toClips(null, '3d'), null);
});

// ----- the model -----

test('model: clips are one Save count per object, written as the schema wants; an old file opens unchanged', () => {
  const m = new PlacementModel();
  m.restore(file({ motion: { boat: { path: [[6, 0, -1]], speed: 1.5, repeat: 'pingpong' } } }) as never);
  m.setItems([item('boat', [8.5, 0, 9.6]), item('door', [0, 0, 0])], '3d');
  assert.equal(m.dirty(), 0, 'reading the older shape as a clip is not a change');
  assert.equal(m.motion.get('boat')!.clips![0]!.name, 'Motion');
  m.motion.set('door', { clips: [door] });
  assert.equal(m.dirty(), 1);
  const f = { ...m.result(), motions: motionLibrary.result() };
  assert.ok((check(f) as { ok: boolean }).ok, JSON.stringify(f));
  assert.deepEqual(f.motion!.boat, { clips: [{ use: 'Motion', when: { on: 'start' } }] }, 'the older shape: a Library motion "Motion", used by the boat at the start');
  assert.deepEqual(f.motion!.door, { clips: [{ name: 'Open', len: 2, keys: { r: [{ t: 0, v: [0, 0, 0] }, { t: 2, v: [0, 1.5708, 0], ease: 'linear' }] } }] });
  assert.ok(f.motion!.boat!.clips, 'the next save writes the older one as clips');
  m.remove('door');
  assert.equal(m.result().motion!.door, undefined, 'a deleted object\'s motion is not written');
  assert.ok(sameMotion({ clips: [door] }, roundMotion({ clips: [{ ...door, len: 2.0000001 }] })));
  assert.equal(new MotionStore().result('3d', () => false), undefined);
});

// ----- the wire: what a gesture does -----

function rig(places: Record<string, Pose> = { boat: { p: [0, 0, 0], r: 0, s: 1 }, buoy: { p: [5, 0, 0], r: 0, s: 1 } }) {
  const store = new MotionStore();
  const lib = new MotionLibrary();
  store.lib = lib;
  const undo = new UndoStack();
  const sent: ShellToBridge[] = [];
  let picked: string | null = 'boat';
  let changed = 0;
  const stand = { el: { hidden: true } as HTMLElement, render() {}, place() {} };
  const tl = createTimeline({
    store, lib, others: () => [], undo, send: (m) => sent.push(structuredClone(m)), dim: () => '3d', usable: () => true, picked: () => picked,
    place: (k) => places[k], order: () => Object.keys(places), label: (k) => k, select: (k) => (picked = k), changed: () => changed++,
    layout: () => {}, numbers: () => {}, narrow: () => false, t: (k) => k,
  }, () => stand);
  const poses = () => sent.filter((m) => m.type === 'studio:timeline/pose').pop() as Extract<ShellToBridge, { type: 'studio:timeline/pose' }> | undefined;
  return { store, lib, undo, sent, tl, places, poses, pick: (k: string | null) => (picked = k), changes: () => changed };
}
const at = (p: number[]): Pose => ({ p, r: 0, s: 1 });

test('wire: folded, a move is a move (nothing keyed)', () => {
  const r = rig();
  assert.equal(r.tl.moved('boat', at([1, 0, 0]), true, at([0, 0, 0])), false);
  assert.equal(r.tl.motionOf('boat'), null);
});

test('wire: open at 0 s with no motion yet, a move is still a move; after 0 s it makes the first clip', () => {
  const r = rig();
  r.tl.setOpen(true);
  assert.equal(r.tl.moved('boat', at([1, 0, 0]), true, at([0, 0, 0])), false, '0 s and nothing to animate: the place moves');
  r.tl.setTime(2);
  // A drag: live poses, then the end (the bridge's `from` only on the end).
  assert.equal(r.tl.moved('boat', at([1, 0, 0]), false), true);
  assert.equal(r.tl.moved('boat', at([3, 0, -1]), true, at([0, 0, 0])), true);
  const c = r.tl.motionOf('boat')!.clips![0]!;
  assert.equal(c.name, 'motion.firstName', 'named after the object (studio-words-plan; this rig’s t() returns the key)');
  assert.deepEqual(whenOf(c), { on: 'start' }, 'the first motion plays at the start');
  assert.deepEqual(c.keys.p, [{ t: 0, v: [0, 0, 0], ease: 'ease' }, { t: 2, v: [3, 0, -1], ease: 'ease' }], 'a key at 0 s of how it stood, and one at 2 s');
  assert.equal(c.keys.r, undefined, 'only what changed is keyed');
  assert.equal(r.undo.peekUndo()!.changes.length, 1, 'one undo step for the drag');
  assert.equal(r.undo.peekUndo()!.changes[0]!.kind, 'motion');
  // The game shows the boat at its place + the clip at 2 s.
  assert.deepEqual(r.poses()!.poses.find((p) => p.key === 'boat')!.pose.p, [3, 0, -1]);
  // At 1 s it is on its way (ease: half way at half the time).
  r.tl.setTime(1);
  assert.ok(near(r.poses()!.poses.find((p) => p.key === 'boat')!.pose.p, [1.5, 0, -0.5]));
  assert.ok(near(r.tl.shownPose('boat')!.p, [1.5, 0, -0.5]), 'the card shows it too');
});

test('wire: auto key off moves the place under the motion; folding puts every object at its place', () => {
  const r = rig();
  r.store.set('boat', { clips: [{ name: 'Row', len: 2, repeat: 'once', start: true, keys: { p: [{ t: 0, v: [0, 0, 0] }, { t: 2, v: [4, 0, 0] }] } }] });
  r.tl.setOpen(true);
  r.tl.setTime(2);
  assert.ok(near(r.tl.shownPose('boat')!.p, [4, 0, 0]));
  assert.equal(r.tl.records('boat'), true, 'auto key is on by default');
  // Auto key off: not a key; the shell turns the shown pose into a place.
  r.tl.setAuto(false);
  assert.equal(r.tl.records('boat'), false);
  assert.equal(r.tl.moved('boat', at([5, 0, 1]), true, at([4, 0, 0])), false);
  const place = r.tl.placeFor('boat', at([5, 0, 1]));
  assert.ok(near(place.p, [1, 0, 1]), 'shown 5 at 2 s = place 1 + the motion\'s 4');
  r.tl.setAuto(true);
  r.tl.setOpen(false);
  assert.deepEqual(r.poses()!.poses.find((p) => p.key === 'boat')!.pose.p, [0, 0, 0], 'folded: the place');
  assert.equal(r.tl.records('boat'), false);
  assert.deepEqual(r.tl.placeFor('boat', at([5, 0, 1])).p, [5, 0, 1], 'folded: a move is a move');
});

test('wire: a typed number keys only what it changed; a dragged path point is one undo step', () => {
  const r = rig();
  r.store.set('boat', { clips: [{ name: 'Row', len: 2, repeat: 'once', start: true, keys: { p: [{ t: 0, v: [0, 0, 0] }, { t: 2, v: [4, 0, 0] }] } }] });
  r.tl.setOpen(true);
  r.tl.setTime(1);
  const shown = r.tl.shownPose('boat')!;
  assert.equal(r.tl.card('boat', { ...shown, r: 1 }, shown), true);
  const c = r.tl.motionOf('boat')!.clips![0]!;
  assert.deepEqual(c.keys.r!.map((k) => [k.t, k.v[1]]), [[0, 0], [1, 1]], 'an angle key at 1 s (and the start)');
  assert.equal(c.keys.p!.length, 2, 'the position keys are untouched');
  const steps = r.undo.size;
  r.tl.onMessage({ type: 'studio:timeline/point', key: 'boat', i: 1, v: [4, 1, 0], end: false });
  r.tl.onMessage({ type: 'studio:timeline/point', key: 'boat', i: 1, v: [4, 2, 0], end: true });
  assert.deepEqual(r.tl.motionOf('boat')!.clips![0]!.keys.p![1]!.v, [4, 2, 0], 'the point is higher');
  assert.equal(r.undo.size, steps + 1, 'one step for the drag');
  // Undo it: the point comes back.
  const step = r.undo.peekUndo()!;
  for (const ch of step.changes) if (ch.kind === 'motion') r.tl.apply(ch, 'undo');
  assert.deepEqual(r.tl.motionOf('boat')!.clips![0]!.keys.p![1]!.v, [4, 0, 0]);
  // The path the game draws: the picked object's position keys, from its place.
  const path = r.sent.filter((m) => m.type === 'studio:timeline/path').pop() as Extract<ShellToBridge, { type: 'studio:timeline/path' }>;
  assert.equal(path.key, 'boat');
  assert.deepEqual(path.base, [0, 0, 0]);
  assert.equal(path.keys!.length, 2);
});

test('wire: keys — K sets one, Delete removes the picked ones once the plate was pressed, ⌘C / ⌘V copy them', () => {
  const r = rig();
  r.tl.setOpen(true);
  r.tl.setTime(1);
  assert.equal(r.tl.onKey({ key: 'k', ctrl: false, meta: false, shift: false }), true);
  assert.deepEqual(r.tl.motionOf('boat')!.clips![0]!.keys.p, [{ t: 1, v: [0, 0, 0], ease: 'ease' }], 'K: a position key at 1 s');
  // Delete belongs to the scene until the plate is pressed.
  assert.equal(r.tl.onKey({ key: 'Delete', ctrl: false, meta: false, shift: false }), false);
  assert.equal(r.tl.state().sel.length, 0);
  r.tl.untouch();
});

test('wire: several objects moved together at 1 s — each keyed, one undo step with the rest', () => {
  const r = rig();
  r.tl.setOpen(true);
  r.tl.setTime(1);
  const out = r.tl.movedGroup([{ key: 'boat', pose: at([1, 0, 0]), from: at([0, 0, 0]) }, { key: 'buoy', pose: at([6, 0, 0]), from: at([5, 0, 0]) }], true);
  assert.equal(out.rest.length, 0);
  assert.equal(out.changes.length, 2);
  assert.ok(near(offsetsAt(r.tl.motionOf('buoy')!.clips![0]!, 1).p, [1, 0, 0]));
});
