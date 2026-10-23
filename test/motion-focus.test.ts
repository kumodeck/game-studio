// The timeline shows the picked object only, and the objects linked to it (studio-motion-focus, 2026-10-23; a request:
// "when I make a motion every other object's motion shows up too — mostly I only need the one I picked; sometimes I
// want it to work with other objects, so let me add the ones to link"), without a browser: timeline-wire.ts's rows,
// link / unlink (a scene motion, scene-motion.ts asScene / asOrdinary), ⋯'s "every motion", a click in the game while
// the list is open, undo, and the saved file. The plate in a real editor: test/studio-motion-focus.browser.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MotionLibrary } from '../src/shell/motion-library.ts';
import { MotionStore, roundLib } from '../src/shell/motion-model.ts';
import { UndoStack } from '../src/shell/undo.ts';
import { createTimeline } from '../src/shell/timeline-wire.ts';
import type { TimelineActs, TimelineView } from '../src/shell/timeline-panel.ts';
import { validateStudioFile } from '../src/schema/studio-files.mjs';
import type { LibraryMotion, MotionKey, Pose } from '../src/contract.ts';

const ROW: MotionKey[] = [{ t: 0, v: [0, 0, 0] }, { t: 1.5, v: [-2, 0, 1] }, { t: 3, v: [-4, 0, 0] }];
const BOB: MotionKey[] = [{ t: 0, v: [0, 0, 0] }, { t: 2, v: [0, 0.4, 0] }];

function rig() {
  const places: Record<string, Pose> = { lighthouse: { p: [0, 0, -9], r: 0, s: 1 }, boat: { p: [0, 0, 0], r: 0, s: 1 }, buoy: { p: [5, 0, 0], r: 0, s: 1 },
    crate: { p: [9, 0, 9], r: 0, s: 1 }, rock: { p: [3, 0, 3], r: 0, s: 1 } };
  const store = new MotionStore();
  const lib = new MotionLibrary();
  store.lib = lib;
  lib.set('Row', { name: 'Row', len: 3, repeat: 'pingpong', keys: { p: ROW } });
  lib.set('Bob', { name: 'Bob', len: 2, keys: { p: BOB } });
  lib.markSaved();
  store.set('boat', { clips: [{ name: 'Row', use: 'Row', len: 3, when: { on: 'key', key: 'KeyE' }, keys: {} }] });
  store.set('buoy', { clips: [{ name: 'Bob', use: 'Bob', len: 2, when: { on: 'start' }, keys: {} }] });
  store.markSaved();
  const undo = new UndoStack();
  let picked: string | null = 'boat';
  let group: string[] = ['boat'];
  const reselected: string[] = [];
  let acts!: TimelineActs;
  let view!: () => TimelineView;
  const stand = { el: { hidden: true } as HTMLElement, render() {}, place() {}, focusStarts() {} };
  const tl = createTimeline({
    store, lib, others: () => [], undo, send: () => {}, dim: () => '3d', usable: () => true, picked: () => picked, group: () => group,
    reselect: (k) => (reselected.push(k), (picked = k), (group = [k])),
    place: (k) => places[k], order: () => Object.keys(places), label: (k) => k, select: (k) => ((picked = k), (group = [k])), changed: () => {},
    layout: () => {}, numbers: () => {}, narrow: () => false, t: (k, v) => (v?.name ? `${k}:${v.name}` : k),
  }, (v, a) => ((view = v), (acts = a), stand as never));
  tl.setOpen(true);
  const undoAll = () => {
    const step = undo.peekUndo()!;
    for (const c of step.changes.slice().reverse()) if (c.kind === 'motion' || c.kind === 'motion-lib' || c.kind === 'motion-rename') tl.apply(c, 'undo');
    undo.undo();
  };
  const pick = (k: string | null, several?: string[]) => {
    picked = several ? null : k;
    group = several ?? (k ? [k] : []);
  };
  const rows = () => view().rows.map((r) => r.key);
  const file = () => ({ version: 1, tool: 'placement', dim: '3d', space: 'local', objects: {}, motion: store.result('3d', () => false), motions: lib.result((m: LibraryMotion) => roundLib(m)) });
  return { store, lib, undo, tl, acts: () => acts, view: () => view(), pick, rows, undoAll, reselected, file };
}

test('rows: the picked object only — not every moving one; several picked: those; ⋯ "every motion": all, the picked first', () => {
  const r = rig();
  assert.deepEqual(r.rows(), ['boat'], 'the boat picked: its row only (the buoy moves too)');
  r.pick('crate');
  assert.deepEqual(r.rows(), ['crate'], 'an object with no motion: its own (empty) row');
  r.pick(null, ['rock', 'buoy']);
  assert.deepEqual(r.rows(), ['buoy', 'rock'], 'several picked: those, in the list\'s order');
  // The ruler is the picked motion's, not the longest in the scene.
  r.pick('buoy');
  assert.equal(r.view().span, 2);
  r.acts().showAll!(true);
  assert.equal(r.view().all, true);
  assert.deepEqual(r.rows(), ['boat', 'buoy'], 'every moving object, in the list\'s order (studio-ui-lead2: the picked one is not moved up)');
  assert.equal(r.view().link, null, 'no "+ Link" while every motion is shown');
  r.acts().showAll!(false);
  assert.deepEqual(r.rows(), ['buoy']);
  assert.equal(r.view().moving, 2);
});

test('link: an ordinary motion becomes a scene of two (the picked object\'s keys kept), one undo step; unlink puts the file back', () => {
  const r = rig();
  const before = JSON.stringify(r.file());
  const items = r.view().link!.items();
  assert.deepEqual(items.map((i) => i.key), ['lighthouse', 'buoy', 'crate', 'rock'], 'the list: the scene\'s objects, not the rows');
  assert.equal(items.find((i) => i.key === 'buoy')!.note, 'Bob', 'a moving one says its motion');
  r.acts().link!('crate');
  assert.deepEqual(r.rows(), ['boat', 'crate']);
  assert.deepEqual(r.view().rows.map((x) => x.member), [true, true]);
  assert.deepEqual(r.view().scene, { name: 'Row', n: 2 });
  const l = r.lib.get('Row')!;
  assert.deepEqual(l.tracks, { boat: { p: ROW }, crate: {} }, 'Row holds both tracks, the boat\'s keys as they were');
  assert.deepEqual(r.store.get('crate')!.clips, [{ name: 'Row', use: 'Row', len: 3, when: { on: 'key', key: 'KeyE' }, keys: {} }], 'the crate starts with the boat ("when" copied)');
  // Saved: the schema takes it; the crate's attachment is the boat's.
  const f = r.file();
  const v = validateStudioFile(f, { tool: 'placement' });
  assert.ok(v.ok, JSON.stringify(v));
  const row = (f.motions as LibraryMotion[]).find((m) => m.name === 'Row')!;
  assert.deepEqual(Object.keys(row.tracks!).sort(), ['boat', 'crate']);
  assert.equal(JSON.stringify(row.keys ?? {}), '{}');
  // One undo step: the Library change first (undone last), then the crate (the boat's attachment did not change).
  const step = r.undo.peekUndo()!;
  assert.deepEqual(step.changes.map((c) => `${c.kind}:${c.key}`), ['motion-lib:Row', 'motion:crate']);
  r.undoAll();
  assert.equal(JSON.stringify(r.file()), before, 'undo: the file as it was');
  // Linked again, then unlinked with its ×: back to an ordinary motion, the file as it was.
  r.acts().link!('crate');
  r.acts().leave!('crate');
  assert.deepEqual(r.rows(), ['boat']);
  assert.equal(r.view().scene, null);
  assert.equal(JSON.stringify(r.file()), before, 'unlink the last one: the file as it was');
  r.undoAll();
  assert.deepEqual(Object.keys(r.lib.get('Row')!.tracks!).sort(), ['boat', 'crate'], 'undo of the unlink: linked again');
  assert.deepEqual(r.lib.get('Row')!.tracks!.boat, { p: ROW });
});

test('link: three objects, one time line; the linked one picked shows the same rows in the same order (studio-ui-lead2); × takes one out', () => {
  const r = rig();
  r.acts().link!('crate');
  r.acts().link!('buoy');
  assert.deepEqual(r.rows(), ['boat', 'crate', 'buoy'], 'the scene\'s order: the boat, then the linked ones as they were linked (saved with the motion)');
  assert.equal(r.view().scene!.n, 3);
  assert.deepEqual(r.store.get('buoy')!.clips!.map((c) => c.use), ['Bob', 'Row'], 'the buoy keeps its Bob');
  // The crate gets keys: moved with ● on, they go in its track of Row.
  r.pick('crate');
  assert.deepEqual(r.rows(), ['boat', 'crate', 'buoy'], 'the crate picked: the same rows, the same order (a pick moves no row)');
  r.tl.setTime(1);
  r.tl.moved('crate', { p: [9, 1, 9], r: 0, s: 1 }, true, { p: [9, 0, 9], r: 0, s: 1 });
  assert.deepEqual(r.lib.get('Row')!.tracks!.crate!.p!.map((k) => k.v), [[0, 0, 0], [0, 1, 0]]);
  assert.deepEqual(r.lib.get('Row')!.tracks!.boat, { p: ROW }, 'the boat\'s track untouched');
  // One "when" for all of them.
  r.acts().setWhen({ on: 'click' });
  for (const k of ['boat', 'buoy', 'crate']) assert.deepEqual(r.store.get(k)!.clips!.find((c) => c.use === 'Row')!.when, { on: 'click' }, k);
  // × on the buoy: out; the other two stay linked; its Bob stays.
  r.acts().leave!('buoy');
  assert.deepEqual(r.rows(), ['boat', 'crate']);
  assert.deepEqual(r.store.get('buoy')!.clips!.map((c) => c.use), ['Bob']);
  assert.deepEqual(Object.keys(r.lib.get('Row')!.tracks!).sort(), ['boat', 'crate']);
  // Something else picked: its own row only (the scene closes).
  r.pick('rock');
  assert.deepEqual(r.rows(), ['rock']);
  assert.equal(r.view().scene, null);
});

test('link: a motion other objects use too is copied first ("Row 2") — theirs stays; an object with no motion gets an empty one', () => {
  const r = rig();
  r.store.set('rock', { clips: [{ name: 'Row', use: 'Row', len: 3, when: { on: 'start' }, keys: {} }] });
  r.acts().link!('crate');
  assert.deepEqual(r.lib.get('Row'), { name: 'Row', len: 3, repeat: 'pingpong', keys: { p: ROW } }, 'Row as it was (the rock uses it)');
  assert.deepEqual(r.lib.get('Row 2')!.tracks, { boat: { p: ROW }, crate: {} });
  assert.deepEqual(r.store.get('boat')!.clips!.map((c) => [c.name, c.use]), [['Row 2', 'Row 2']]);
  assert.deepEqual(r.store.get('rock')!.clips!.map((c) => c.use), ['Row']);
  r.undoAll();
  assert.equal(r.lib.get('Row 2'), null, 'undo: the copy goes');
  assert.deepEqual(r.store.get('boat')!.clips!.map((c) => c.use), ['Row']);
  // No motion yet: the crate and the lighthouse share a new, empty one.
  r.pick('crate');
  r.acts().link!('lighthouse');
  const name = r.view().scene!.name;
  assert.deepEqual(r.lib.get(name)!.tracks, { crate: {}, lighthouse: {} });
  assert.deepEqual(r.rows(), ['crate', 'lighthouse']);
});

test('a click in the game while "+ Link an object" is open links that object, and the pick goes back', () => {
  const r = rig();
  assert.equal(r.tl.linkPick('buoy'), false, 'list closed: a pick is a pick');
  r.acts().linking!(true);
  assert.equal(r.view().link!.linking, true);
  assert.equal(r.tl.linkPick('buoy'), true);
  assert.deepEqual(r.rows(), ['boat', 'buoy']);
  assert.deepEqual(r.reselected, ['boat'], 'the boat is picked again');
  assert.equal(r.view().link!.linking, false, 'the list closes');
  // A click on nothing (or on the boat itself): nothing linked, the list closes, the pick goes back.
  r.acts().linking!(true);
  assert.equal(r.tl.linkPick(null), true);
  assert.deepEqual(r.rows(), ['boat', 'buoy']);
  assert.equal(r.view().link!.linking, false);
});
