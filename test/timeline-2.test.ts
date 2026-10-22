// The timeline's second stage (studio-timeline-2, 2026-10-22), without a browser: the path's handles and corners and a
// key put on the path (path-edit.ts + the loader's trackAt / handlesOf), several ways to start (`when` as a list), the
// area's size from a corner, and scene motions (several objects in one motion: scene-motion.ts + timeline-wire.ts),
// through the file (rounding, the schema) and the loader's runner. The plate and the game: test/studio-timeline-2.browser.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MotionLibrary } from '../src/shell/motion-library.ts';
import { MotionStore, roundLib } from '../src/shell/motion-model.ts';
import { UndoStack } from '../src/shell/undo.ts';
import { createTimeline } from '../src/shell/timeline-wire.ts';
import type { TimelineActs, TimelineView } from '../src/shell/timeline-panel.ts';
import { whensShort } from '../src/shell/timeline-panel.ts';
import { bend, handles, insertAt, pointKind, setKind, toggleCorner } from '../src/shell/path-edit.ts';
import { validateStudioFile } from '../src/schema/studio-files.mjs';
import { motionRunner, resolveClip, trackAt } from '../src/loader/studio-placement.js';
import type { Motion, MotionClip, MotionKey, PlacementFile, Pose, ShellToBridge } from '../src/contract.ts';

const near = (a: number[] | null, b: number[], eps = 1e-6) => !!a && a.every((v, i) => Math.abs(v - b[i]!) < eps);
const P = (ks: MotionKey[], t: number) => trackAt(ks, t, true) as number[];
const row: MotionKey[] = [
  { t: 0, v: [0, 0, 0], ease: 'linear' },
  { t: 1, v: [2, 1, 0], ease: 'linear' },
  { t: 2, v: [4, 0, 0], ease: 'linear' },
  { t: 3, v: [6, 0, 2], ease: 'linear' },
];

test('path: a smooth point\'s handles are the curve it already draws (grabbing one does not move the path)', () => {
  const h = handles(row, 1);
  // A sixth of the way from the key before (0, 0, 0) to the key after (4, 0, 0), either way.
  assert.ok(near(h.in, [-4 / 6, 0, 0]) && near(h.out, [4 / 6, 0, 0]), JSON.stringify(h));
  assert.equal(handles(row, 0).in, null, 'the first point has no "in"');
  assert.equal(handles(row, 3).out, null, 'the last has no "out"');
  // The same handles written by hand: the same curve, everywhere (Catmull-Rom = this Bézier).
  const frozen = row.map((k, i) => ({ ...k, ...(handles(row, i).in ? { in: handles(row, i).in! } : {}), ...(handles(row, i).out ? { out: handles(row, i).out! } : {}) }));
  for (const t of [0.25, 0.5, 1.3, 1.9, 2.5]) assert.ok(near(P(frozen, t), P(row, t), 1e-9), `t=${t}: ${P(frozen, t)} vs ${P(row, t)}`);
});

test('path: bend — the other handle lines up (Alt: stays), a corner pulled out turns round; kinds', () => {
  const b = bend(row, 1, 'out', [1, 1, 0]);
  const k = b[1]!;
  assert.ok(near(k.out!, [1, 1, 0]));
  // Lined up: the opposite way, keeping its own length (|in| was 4/6).
  const l = 4 / 6;
  assert.ok(near(k.in!, [-l / Math.SQRT2, -l / Math.SQRT2, 0], 1e-4), JSON.stringify(k.in));
  assert.equal(pointKind(k), 'custom');
  assert.ok(!near(P(b, 1.5), P(row, 1.5), 1e-3), 'the path bends');
  assert.ok(near(P(b, 0.5), P(bend(row, 1, 'out', [1, 1, 0]), 0.5)), 'deterministic');
  const alone = bend(row, 1, 'out', [1, 1, 0], true)[1]!;
  assert.ok(near(alone.in!, [-4 / 6, 0, 0], 1e-4), 'Alt: the other side keeps where it was');
  // Corner, then pulled out: the other side follows with the dragged one's length.
  const c = setKind(row, 1, 'corner');
  assert.equal(pointKind(c[1]!), 'corner');
  assert.ok(near(P(c, 1), [2, 1, 0]), 'the point is still on the path');
  const out = bend(c, 1, 'out', [0, 0, 2])[1]!;
  assert.ok(near(out.in!, [0, 0, -2]), JSON.stringify(out.in));
  assert.equal(pointKind(toggleCorner(c, 1)[1]!), 'smooth', 'double-click again: smooth');
  assert.equal(pointKind(toggleCorner(row, 2)[2]!), 'corner');
  // A corner's spans come straight in: the span 1→2 leaves point 1 along the chord's direction at first.
  const a = P(c, 1.05), z = P(c, 1);
  assert.ok(a[1]! < z[1]! + 1e-9 && a[0]! > z[0]!, 'heads towards the next point, not past it');
});

test('path: a key put on the line keeps the shape — exactly in a bent span (de Casteljau), on the curve in a smooth one', () => {
  const bent = bend(row, 1, 'out', [1, 2, 0]);
  const before = [1.1, 1.3, 1.5, 1.7, 1.9].map((t) => P(bent, t));
  const { keys, i } = insertAt(bent, 1.5);
  assert.equal(i, 2);
  assert.equal(keys.length, 5);
  assert.ok(near(keys[2]!.v, P(bent, 1.5), 1e-3), 'the new point is where the path was');
  // The same points are still on the path (the time along it shifts a little; the shape does not): each old sample is
  // within a few mm of the new curve.
  const after = Array.from({ length: 400 }, (_, j) => P(keys, 1 + j / 400));
  for (const p of before) assert.ok(after.some((q) => Math.hypot(q[0]! - p[0]!, q[1]! - p[1]!, q[2]! - p[2]!) < 0.01), `kept: ${p}`);
  // The spans beyond did not move.
  for (const t of [0.5, 2.5]) assert.ok(near(P(keys, t), P(bent, t), 1e-3), `t=${t}`);
  const sm = insertAt(row, 0.5);
  assert.ok(near(sm.keys[1]!.v, P(row, 0.5), 1e-3) && !sm.keys[1]!.in, 'between smooth points: smooth, on the curve');
  assert.equal(insertAt(row, 1).keys.length, 4, 'a key already there: nothing added');
});

test('file: handles, `when` lists and scene motions — the schema takes them, refuses the bad ones; rounding keeps them', () => {
  const f = (extra: object): PlacementFile => ({ version: 1, tool: 'placement', dim: '3d', space: 'local', objects: {}, ...extra }) as PlacementFile;
  const good = f({
    motions: [
      { name: 'Row', len: 3, keys: { p: [{ t: 0, v: [0, 0, 0] }, { t: 1.5, v: [1, 0, 0], in: [-0.5, 0, 0], out: [0.5, 0.2, 0] }, { t: 3, v: [2, 0, 0], in: [0, 0, 0], out: [0, 0, 0] }] } },
      { name: 'Arrival', len: 4, tracks: { rowboat: { p: [{ t: 0, v: [0, 0, 0] }, { t: 3, v: [-4, 0, 1] }] }, barrel: { r: [{ t: 1, v: [0, 0, 0] }, { t: 2, v: [0, 0, 6.2832] }] } } },
    ],
    motion: {
      rowboat: { clips: [{ use: 'Arrival', when: [{ on: 'key', key: 'KeyE' }, { on: 'click' }] }] },
      barrel: { clips: [{ use: 'Arrival', when: [{ on: 'key', key: 'KeyE' }, { on: 'click' }] }] },
      crate: { clips: [{ use: 'Row', when: { on: 'start' } }] },
    },
  });
  const v = validateStudioFile(good, { tool: 'placement' });
  assert.ok(v.ok, JSON.stringify(v));
  const bad = (extra: object, what: RegExp) => {
    const r = validateStudioFile(f(extra), { tool: 'placement' });
    assert.ok(!r.ok && JSON.stringify(r).match(what), `${what}: ${JSON.stringify(r)}`);
  };
  bad({ motions: [{ name: 'R', len: 1, keys: { r: [{ t: 0, v: [0, 0, 0], in: [0, 0, 0] }] } }] }, /in/);
  bad({ motions: [{ name: 'R', len: 1, keys: { p: [{ t: 0, v: [0, 0, 0], out: [0, 0] }] } }] }, /out/);
  bad({ motions: [{ name: 'S', len: 1, keys: {}, tracks: { a: {} } }] }, /keys or tracks/);
  bad({ motions: [{ name: 'S', len: 1, tracks: {} }] }, /tracks/);
  bad({ motions: [{ name: 'H', len: 1, keys: {} }], motion: { a: { clips: [{ use: 'H', when: [{ on: 'click' }] }] } } }, /list of 2/);
  bad({ motions: [{ name: 'H', len: 1, keys: {} }], motion: { a: { clips: [{ use: 'H', when: [{ on: 'click' }, { on: 'nope' }] }] } } }, /when\[1\]/);
  // Rounding: the handles and the list survive; a list of one is written as itself.
  const lib = new MotionLibrary();
  lib.restore(good);
  const out = lib.result((m) => roundLib(m))!;
  assert.deepEqual(out[0]!.keys.p![1], { t: 1.5, v: [1, 0, 0], in: [-0.5, 0, 0], out: [0.5, 0.2, 0] });
  assert.deepEqual(Object.keys(out[1]!.tracks!), ['rowboat', 'barrel']);
  assert.equal('keys' in out[1]!, false, 'a scene motion is written with tracks only');
  const store = new MotionStore();
  store.lib = lib;
  store.restore(good.motion);
  assert.deepEqual(store.changedKeys(), [], 'opening is not a change');
  assert.deepEqual(store.result('3d', () => false)!.rowboat, { clips: [{ use: 'Arrival', when: [{ on: 'key', key: 'KeyE' }, { on: 'click' }] }] });
  store.set('crate', { clips: [{ name: 'Row', use: 'Row', len: 3, when: [{ on: 'click' }], keys: {} }] });
  assert.deepEqual(store.result('3d', () => false)!.crate, { clips: [{ use: 'Row', when: { on: 'click' } }] });
});

test('loader: any of the `when`s starts it; a scene starts all of its objects together; resolveClip gives each its track', () => {
  const lib = [{ name: 'Arrival', len: 2, tracks: { boat: { p: [{ t: 0, v: [0, 0, 0], ease: 'linear' }, { t: 2, v: [4, 0, 0] }] }, buoy: { p: [{ t: 0, v: [0, 0, 0], ease: 'linear' }, { t: 2, v: [0, -1, 0] }] } } },
    { name: 'Hop', len: 1, keys: { p: [{ t: 0, v: [0, 0, 0], ease: 'linear' }, { t: 1, v: [0, 1, 0] }] } }];
  const both = [{ on: 'key', key: 'KeyE' }, { on: 'click' }];
  const boat = resolveClip({ use: 'Arrival', when: both }, lib, 'boat')!;
  assert.equal(boat.scene, true);
  assert.deepEqual(boat.keys.p![1].v, [4, 0, 0], "the boat's own track");
  assert.deepEqual(boat.when, { on: 'key', key: 'KeyE' }, '`when` stays the first (older callers)');
  assert.equal(boat.whens.length, 2);
  const run = motionRunner([
    { key: 'boat', clips: [boat] },
    { key: 'buoy', clips: [resolveClip({ use: 'Arrival', when: both }, lib, 'buoy')] },
    { key: 'crate', clips: [resolveClip({ use: 'Hop', when: [{ on: 'key', key: 'KeyF' }, { on: 'click' }] }, lib, 'crate')] },
  ]);
  run.fire({ on: 'start' }, 0);
  assert.equal(run.playing().size, 0);
  run.fire({ on: 'click', key: 'crate' }, 0);
  assert.deepEqual([...run.playing().keys()], ['crate'], 'the click (the second way) starts the crate');
  run.fire({ on: 'click', key: 'boat' }, 1000);
  assert.deepEqual([...run.playing().keys()].sort(), ['boat', 'buoy', 'crate'], 'a click on the boat starts the whole scene');
  const at = run.step(2000, () => null);
  assert.ok(near(at.get('boat').p, [2, 0, 0]) && near(at.get('buoy').p, [0, -0.5, 0]), 'one time line: both half-way');
});

// ----- the wire: scenes, handles and the line, the area's corner, the "or" -----
function rig() {
  const places: Record<string, Pose> = { boat: { p: [0, 0, 0], r: 0, s: 1 }, buoy: { p: [5, 0, 0], r: 0, s: 1 }, crate: { p: [9, 0, 9], r: 0, s: 1 }, rock: { p: [3, 0, 3], r: 0, s: 1 } };
  const store = new MotionStore();
  const lib = new MotionLibrary();
  store.lib = lib;
  lib.set('Row', { name: 'Row', len: 3, keys: { p: row.slice(0, 3) } });
  lib.markSaved();
  store.set('boat', { clips: [{ name: 'Row', use: 'Row', len: 3, when: { on: 'start' }, keys: {} }] });
  store.markSaved();
  const undo = new UndoStack();
  const sent: ShellToBridge[] = [];
  let picked: string | null = 'boat';
  let acts!: TimelineActs;
  let view!: () => TimelineView;
  const stand = { el: { hidden: true } as HTMLElement, render() {}, place() {}, focusStarts() {} };
  const tl = createTimeline({
    store, lib, others: () => [], undo, send: (m) => sent.push(structuredClone(m)), dim: () => '3d', usable: () => true, picked: () => picked,
    place: (k) => places[k], order: () => Object.keys(places), label: (k) => k, select: (k) => (picked = k), changed: () => {},
    layout: () => {}, numbers: () => {}, narrow: () => false, t: (k, v) => (v?.name ? `${k}:${v.name}` : k),
  }, (v, a) => ((view = v), (acts = a), stand as never));
  tl.setOpen(true);
  const undoAll = () => {
    const step = undo.peekUndo()!;
    for (const c of step.changes.slice().reverse()) if (c.kind === 'motion' || c.kind === 'motion-lib' || c.kind === 'motion-rename') tl.apply(c, 'undo');
    undo.undo();
  };
  return { store, lib, undo, sent, tl, acts: () => acts, view: () => view(), pick: (k: string | null) => (picked = k), places, undoAll };
}

test('wire: a handle dragged (live, one undo step), a corner by double-click, Point ▾, a key put on the line', () => {
  const r = rig();
  r.tl.onMessage({ type: 'studio:timeline/handle', key: 'boat', i: 1, side: 'out', h: [1, 1, 0], alone: false, end: false });
  r.tl.onMessage({ type: 'studio:timeline/handle', key: 'boat', i: 1, side: 'out', h: [1, 2, 0], alone: false, end: true });
  const k = r.lib.get('Row')!.keys.p![1]!;
  assert.deepEqual(k.out, [1, 2, 0]);
  assert.ok(k.in && k.in[0]! < 0 && k.in[1]! < 0, 'the other side lined up');
  assert.equal(r.undo.peekUndo()!.changes.length, 1, 'one undo step for the drag');
  r.undoAll();
  assert.equal(r.lib.get('Row')!.keys.p![1]!.out, undefined, 'undo: smooth again');
  r.tl.onMessage({ type: 'studio:timeline/corner', key: 'boat', i: 1 });
  assert.equal(pointKind(r.lib.get('Row')!.keys.p![1]!), 'corner');
  // Point ▾ on the picked point.
  r.acts().pickKeys([{ key: 'boat', ch: 'p', t: 1 }], false);
  assert.equal(r.view().point, 'corner');
  r.acts().point!('smooth');
  assert.equal(pointKind(r.lib.get('Row')!.keys.p![1]!), 'smooth');
  // The line clicked at 0.5 s: a key there, picked, the time line on it.
  r.tl.onMessage({ type: 'studio:timeline/insert', key: 'boat', t: 0.5 });
  const ks = r.lib.get('Row')!.keys.p!;
  assert.deepEqual(ks.map((x) => x.t), [0, 0.5, 1, 2]);
  assert.equal(r.tl.state().time, 0.5);
  assert.deepEqual(r.tl.state().sel, [{ key: 'boat', ch: 'p', t: 0.5 }]);
  // The path sent to the game has the new point picked (its handles show there).
  const path = r.sent.filter((m) => m.type === 'studio:timeline/path').pop() as Extract<ShellToBridge, { type: 'studio:timeline/path' }>;
  assert.deepEqual(path.sel, [1]);
});

test('wire: "or" — a second way to start, its Try ▶, the row says both; the area resized from a corner', () => {
  const r = rig();
  r.acts().setWhen([{ on: 'start' }, { on: 'key', key: 'KeyE' }]);
  assert.deepEqual(r.store.get('boat')!.clips![0]!.when, [{ on: 'start' }, { on: 'key', key: 'KeyE' }]);
  assert.ok(r.tl.state().cues.includes('key:KeyE'), JSON.stringify(r.tl.state().cues));
  assert.equal(r.view().whens!.length, 2);
  const rw = r.view().rowWhen('boat')!;
  assert.equal(whensShort((k) => k, rw.whens!, rw.until, rw.repeat), '▶ tl.when.short.start tl.when.or ⌨ E');
  // The second becomes an area; its corner dragged in the game: size and middle together, one undo step.
  r.acts().setWhen([{ on: 'start' }, { on: 'enter', area: { p: [0, 1, 0], size: [3, 2, 3] } }]);
  const area = r.sent.filter((m) => m.type === 'studio:timeline/area').pop() as Extract<ShellToBridge, { type: 'studio:timeline/area' }>;
  assert.deepEqual(area.area, { p: [0, 1, 0], size: [3, 2, 3] }, 'the box is the "enter" one, even second');
  r.tl.onMessage({ type: 'studio:timeline/area-moved', key: 'boat', p: [0.5, 1, 0], size: [4, 2, 3], end: true });
  const w = r.store.get('boat')!.clips![0]!.when as Array<{ on: string; area?: { p: number[]; size: number[] } }>;
  assert.deepEqual(w[1]!.area, { p: [0.5, 1, 0], size: [4, 2, 3] });
  assert.deepEqual(w[0], { on: 'start' }, 'the first way stays');
  r.acts().setWhen({ on: 'click' });
  assert.deepEqual(r.store.get('boat')!.clips![0]!.when, { on: 'click' }, 'back to one');
});

test('wire: a scene — made from the clip menu, an object joins (+ Add, or moved with auto key), one "when", taken out, undo', () => {
  const r = rig();
  r.acts().clip('new:scene');
  const name = r.view().scene!.name;
  assert.equal(r.view().scene!.n, 1);
  assert.ok(r.lib.get(name)!.tracks, 'a Library motion with tracks');
  // The boat's first key in the scene.
  r.tl.setTime(2);
  r.tl.moved('boat', { p: [3, 0, 0], r: 0, s: 1 }, true, { p: [0, 0, 0], r: 0, s: 1 });
  assert.deepEqual(r.lib.get(name)!.tracks!.boat!.p!.map((k) => k.v), [[0, 0, 0], [3, 0, 0]]);
  // The crate (no motion of its own) picked: its row is the way in.
  r.pick('crate');
  let v = r.view();
  assert.ok(v.scene, 'the scene stays open');
  assert.deepEqual(v.rows.map((x) => [x.key, x.member]), [['boat', true], ['crate', false]]);
  r.acts().join!('crate');
  assert.deepEqual(r.view().rows.map((x) => [x.key, x.member]), [['boat', true], ['crate', true]]);
  // The buoy joins by being moved with ● on.
  r.pick('buoy');
  r.tl.setTime(1);
  r.tl.moved('buoy', { p: [5, -1, 0], r: 0, s: 1 }, true, { p: [5, 0, 0], r: 0, s: 1 });
  assert.deepEqual(Object.keys(r.lib.get(name)!.tracks!).sort(), ['boat', 'buoy', 'crate']);
  assert.equal(r.view().scene!.n, 3);
  // One "when" for the scene: set on any of them, all three have it.
  r.acts().setWhen({ on: 'key', key: 'KeyE' });
  for (const k of ['boat', 'buoy', 'crate']) assert.deepEqual(r.store.get(k)!.clips!.find((c) => c.use === name)!.when, { on: 'key', key: 'KeyE' }, k);
  assert.equal(r.undo.peekUndo()!.changes.length, 3, 'one undo step for the three');
  // Saved, it is valid; the loader runs it as one.
  const file = { version: 1, tool: 'placement', dim: '3d', space: 'local', objects: {}, motion: r.store.result('3d', () => false), motions: r.lib.result((m) => roundLib(m)) };
  const ok = validateStudioFile(file, { tool: 'placement' });
  assert.ok(ok.ok, JSON.stringify(ok));
  // Taken out: its track goes; undo brings it (and its keys) back.
  r.acts().leave!('buoy');
  assert.deepEqual(Object.keys(r.lib.get(name)!.tracks!).sort(), ['boat', 'crate']);
  r.undoAll();
  assert.deepEqual(r.lib.get(name)!.tracks!.buoy!.p!.map((k) => k.v), [[0, 0, 0], [0, -1, 0]]);
  // The rock has motions of its own? No — but picking an object with its own motion closes the scene.
  r.store.set('rock', { clips: [{ name: 'Row', use: 'Row', len: 3, when: { on: 'start' }, keys: {} }] });
  r.pick('rock');
  assert.equal(r.view().scene, null);
  // Picking a member opens it again.
  r.pick('crate');
  assert.equal(r.view().scene!.name, name);
});

test('wire: a scene motion dropped on an object puts the object in it (with the scene\'s "when")', () => {
  const r = rig();
  r.lib.set('Intro', { name: 'Intro', len: 2, keys: {}, tracks: { boat: { p: [{ t: 0, v: [0, 0, 0] }, { t: 2, v: [1, 0, 0] }] } } });
  r.store.set('boat', { clips: [{ name: 'Intro', use: 'Intro', len: 2, when: { on: 'cue', cue: 'go' }, keys: {} }] });
  assert.ok(r.tl.attach('rock', 'Intro'));
  assert.deepEqual(r.store.get('rock')!.clips![0]!.when, { on: 'cue', cue: 'go' });
  assert.deepEqual(Object.keys(r.lib.get('Intro')!.tracks!).sort(), ['boat', 'rock']);
  const m: Motion | null = r.tl.motionOf('rock');
  assert.equal(m!.clips![0]!.scene, true);
  void (null as unknown as MotionClip);
});
