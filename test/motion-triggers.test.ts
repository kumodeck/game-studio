// When a motion plays, and motions as Library assets (studio-motion-triggers, 2026-10-22), without a browser: the
// Library's store (motion-library.ts: an old file's clips become Library motions, the same keys = the same motion),
// the object's clips as attachments (motion-model.ts), and timeline-wire.ts — a key edited on one object changes every
// object that uses the motion, attach / detach from the card, rename and delete with one undo step, the head's
// Starts / Stops, the area dragged in the game, and Try (the loader's motionRunner) posing the scene. The plate and the
// Library page in a real editor: test/studio-motion-triggers.browser.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MotionLibrary } from '../src/shell/motion-library.ts';
import { attachWorld, MotionStore, roundLib } from '../src/shell/motion-model.ts';
import { UndoStack } from '../src/shell/undo.ts';
import { createTimeline } from '../src/shell/timeline-wire.ts';
import type { TimelineActs, TimelineView } from '../src/shell/timeline-panel.ts';
import { cueSlug, whenShort } from '../src/shell/timeline-panel.ts';
import { validateStudioFile } from '../src/schema/studio-files.mjs';
import type { Motion, MotionClip, PlacementFile, Pose, ShellToBridge } from '../src/contract.ts';

const hop: MotionClip = { name: 'Hop', len: 1, repeat: 'once', keys: { p: [{ t: 0, v: [0, 0, 0], ease: 'linear' }, { t: 1, v: [0, 2, 0], ease: 'linear' }] } };
const file = (extra: object): PlacementFile => ({ version: 1, tool: 'placement', dim: '3d', space: 'local', objects: {}, ...extra }) as PlacementFile;

test('library: an old file — each clip with keys becomes a Library motion (same keys = one), not a change', () => {
  const lib = new MotionLibrary();
  const f = file({ motion: {
    crate: { clips: [{ ...hop, start: true }] },
    barrel: { clips: [{ ...hop }] },
    door: { clips: [{ ...hop, keys: { r: [{ t: 0, v: [0, 0, 0] }, { t: 1, v: [0, 1, 0] }] }, when: 'when the player is near' }] },
  } });
  lib.restore(f);
  assert.deepEqual(lib.list().map((m) => m.name), ['Hop', 'Hop 2'], 'the same name with other keys: "Hop 2"');
  assert.deepEqual(lib.changedNames(), [], 'opening is not a change');
  const store = new MotionStore();
  store.lib = lib;
  store.restore(f.motion);
  assert.deepEqual(store.get('crate')!.clips![0]!.use, 'Hop');
  assert.deepEqual(store.get('crate')!.clips![0]!.when, { on: 'start' }, "studio-timeline's start: true");
  assert.equal(store.get('door')!.clips![0]!.use, 'Hop 2');
  assert.deepEqual(store.get('door')!.clips![0]!.when, { on: 'say', say: 'when the player is near' }, 'its words, for the AI');
  assert.deepEqual(store.changedKeys(), [], 'and the objects are not changes either');
  const out = { ...file({}), motion: store.result('3d', () => false), motions: lib.result((m) => roundLib(m)) };
  assert.deepEqual(out.motion!.door, { clips: [{ name: 'Hop', use: 'Hop 2', when: { on: 'say', say: 'when the player is near' } }] }, 'its old name kept for playMotion(key, name)');
  const v = validateStudioFile(out, { tool: 'placement' });
  assert.ok(v.ok, JSON.stringify(v));
  // A level not on screen is turned at once (a save writes it in the new shape even if never visited).
  const lvl = attachWorld({ gate: { clips: [{ ...hop }] } }, lib, '3d');
  assert.deepEqual(lvl, { gate: { clips: [{ use: 'Hop', when: { on: 'say' } }] } });
});

function rig() {
  const places: Record<string, Pose> = { crate: { p: [0, 0, 0], r: 0, s: 1 }, barrel: { p: [5, 0, 0], r: 0, s: 1 }, player: { p: [9, 0, 9], r: 0, s: 1 } };
  const store = new MotionStore();
  const lib = new MotionLibrary();
  store.lib = lib;
  lib.set('Hop', hop);
  lib.markSaved();
  store.set('crate', { clips: [{ name: 'Hop', use: 'Hop', len: 1, when: { on: 'key', key: 'KeyE' }, keys: {} }] });
  store.set('barrel', { clips: [{ name: 'Hop', use: 'Hop', len: 1, when: { on: 'start' }, keys: {} }] });
  const other: Record<string, Motion> = { gate: { clips: [{ use: 'Hop', when: { on: 'start' } } as MotionClip] } };
  const undo = new UndoStack();
  const sent: ShellToBridge[] = [];
  let picked: string | null = 'crate';
  let acts!: TimelineActs;
  let view!: () => TimelineView;
  const stand = { el: { hidden: true } as HTMLElement, render() {}, place() {} };
  const tl = createTimeline({
    store, lib, others: () => [other], undo, send: (m) => sent.push(structuredClone(m)), dim: () => '3d', usable: () => true, picked: () => picked,
    place: (k) => places[k], order: () => Object.keys(places), label: (k) => k, select: (k) => (picked = k), changed: () => {},
    layout: () => {}, numbers: () => {}, narrow: () => false, t: (k, v) => (v?.name ? `${k}:${v.name}` : k),
  }, (v, a) => ((view = v), (acts = a), stand as never));
  return { store, lib, other, undo, sent, tl, acts: () => acts, view: () => view(), pick: (k: string | null) => (picked = k) };
}

test('wire: a key changed on one object changes the motion everywhere it is used; undo puts it back', () => {
  const r = rig();
  r.tl.setOpen(true);
  r.tl.onMessage({ type: 'studio:timeline/point', key: 'crate', i: 1, v: [0, 3, 0], end: true });
  assert.deepEqual(r.tl.motionOf('barrel')!.clips![0]!.keys.p![1]!.v, [0, 3, 0], 'the barrel uses the same Hop');
  assert.deepEqual(r.store.get('crate')!.clips![0]!.keys, {}, 'the object keeps only which motion and when');
  assert.deepEqual(r.lib.changedNames(), ['Hop']);
  assert.equal(r.view().uses, 2, 'the head says it is on 2 objects');
  const step = r.undo.peekUndo()!;
  for (const c of step.changes.slice().reverse()) if (c.kind === 'motion') r.tl.apply(c, 'undo');
  assert.deepEqual(r.lib.get('Hop')!.keys.p![1]!.v, [0, 2, 0]);
});

test('wire: attach from the Library, detach, duplicate, rename (everywhere), delete — each one undo step', () => {
  const r = rig();
  r.lib.set('Spin', { name: 'Spin', len: 2, repeat: 'loop', keys: { r: [{ t: 0, v: [0, 0, 0] }, { t: 2, v: [0, 6.2832, 0] }] } });
  r.tl.attach('crate', 'Spin');
  const cs = r.store.get('crate')!.clips!;
  assert.deepEqual(cs.map((c) => [c.use, c.when]), [['Hop', { on: 'key', key: 'KeyE' }], ['Spin', { on: 'start' }]], 'nothing started with the game yet: Spin does');
  r.tl.detach('crate', 'Spin');
  assert.equal(r.store.get('crate')!.clips!.length, 1);
  assert.ok(r.lib.has('Spin'), 'detaching keeps the motion in the Library');
  const n = r.tl.duplicateLib('Hop');
  assert.equal(n, 'Hop 2');
  assert.deepEqual(r.lib.get('Hop 2')!.keys, hop.keys);
  assert.equal(r.tl.renameLib('Hop', 'Jump'), 'Jump');
  assert.equal(r.store.get('crate')!.clips![0]!.use, 'Jump');
  assert.equal(r.store.get('barrel')!.clips![0]!.use, 'Jump');
  assert.equal((r.other.gate!.clips![0] as MotionClip).use, 'Jump', 'another level too');
  let step = r.undo.peekUndo()!;
  assert.equal(step.changes[0]!.kind, 'motion-rename');
  r.tl.apply(step.changes[0] as never, 'undo');
  assert.equal(r.store.get('crate')!.clips![0]!.use, 'Hop');
  r.tl.deleteLib('Hop');
  assert.equal(r.lib.has('Hop'), false);
  assert.equal(r.store.get('crate'), null, 'off every object');
  assert.equal(r.other.gate, undefined, 'and the other levels');
  step = r.undo.peekUndo()!;
  for (const c of step.changes.slice().reverse()) r.tl.apply(c as never, 'undo');
  assert.ok(r.lib.has('Hop'));
  assert.equal(r.store.get('crate')!.clips![0]!.use, 'Hop', 'undo puts it back on the crate');
});

test('wire: Starts / Stops from the head; the area box goes to the game and its drag comes back as one undo step', () => {
  const r = rig();
  r.tl.setOpen(true);
  const a = r.acts();
  assert.deepEqual(r.view().when, { on: 'key', key: 'KeyE' });
  a.setWhen({ on: 'enter', area: r.view().defaultArea(), who: r.view().player! });
  const w = r.store.get('crate')!.clips![0]!.when as { on: string; area: { p: number[]; size: number[] }; who: string };
  assert.equal(w.on, 'enter');
  assert.deepEqual(w.area, { p: [0, 0, 0], size: [3, 2, 3] }, 'a box where the object stands');
  assert.equal(w.who, 'player', 'the player is guessed from the keys');
  const box = r.sent.filter((m) => m.type === 'studio:timeline/area').pop() as Extract<ShellToBridge, { type: 'studio:timeline/area' }>;
  assert.equal(box.key, 'crate');
  const steps = r.undo.size;
  r.tl.onMessage({ type: 'studio:timeline/area-moved', key: 'crate', p: [1, 0, 1], end: false });
  r.tl.onMessage({ type: 'studio:timeline/area-moved', key: 'crate', p: [2, 0, 2], end: true });
  assert.deepEqual((r.store.get('crate')!.clips![0]!.when as typeof w).area.p, [2, 0, 2]);
  assert.equal(r.undo.size, steps + 1);
  a.setUntil({ times: 3 });
  assert.deepEqual(r.store.get('crate')!.clips![0]!.until, { times: 3 });
  a.setUntil(null);
  assert.equal(r.store.get('crate')!.clips![0]!.until, undefined);
  a.setWhen({ on: 'cue', cue: 'chest-opened' });
  assert.deepEqual(r.view().cueNames, ['chest-opened']);
  assert.equal(r.lib.changedNames().length, 0, 'when / until are the object\'s: the Library motion is untouched');
});

test('wire: Try — the cues of the scene, played by the loader\'s rules', () => {
  const r = rig();
  const keep = { raf: globalThis.requestAnimationFrame, caf: globalThis.cancelAnimationFrame, now: performance.now };
  const frames: Array<(t: number) => void> = [];
  let now = 1000;
  globalThis.requestAnimationFrame = ((cb: (t: number) => void) => frames.push(cb)) as never;
  globalThis.cancelAnimationFrame = (() => {}) as never;
  performance.now = () => now;
  try {
    r.tl.setOpen(true);
    const ids = r.view().cues.map((c) => c.id);
    assert.deepEqual(ids, ['start', 'key:KeyE']);
    r.tl.tryCue('start');
    now = 1500;
    frames.shift()!(now);
    const pose = (k: string) => (r.sent.filter((m) => m.type === 'studio:timeline/pose').pop() as Extract<ShellToBridge, { type: 'studio:timeline/pose' }>).poses.find((p) => p.key === k)!.pose;
    assert.deepEqual(pose('barrel').p, [5, 1, 0], 'the game started: the barrel hops');
    assert.deepEqual(pose('crate').p, [0, 0, 0], 'the crate waits for E');
    r.tl.tryCue('key:KeyE');
    now = 2000;
    frames.shift()!(now);
    assert.deepEqual(pose('crate').p, [0, 1, 0], 'E: the crate hops');
    assert.equal(r.tl.state().trying, true);
    assert.deepEqual(r.tl.state().lit, { crate: 'Hop' });
    r.tl.stopTry();
    assert.equal(r.tl.state().trying, false);
  } finally {
    globalThis.requestAnimationFrame = keep.raf;
    globalThis.cancelAnimationFrame = keep.caf;
    performance.now = keep.now;
  }
});

test('panel helpers: a cue name from words; a row\'s when in a few characters', () => {
  assert.equal(cueSlug('Chest opened!'), 'chest-opened');
  assert.equal(cueSlug('宝箱'), 'cue');
  const t = (k: string) => k.split('.').pop()!;
  assert.equal(whenShort(t, { on: 'start' }, null, 'pingpong'), '∞ always');
  assert.equal(whenShort(t, { on: 'key', key: 'KeyE' }, { times: 3 }, 'loop'), '⌨ E · 3×');
  assert.equal(whenShort(t, { on: 'cue', cue: 'boss-down' }, null, 'once'), '✦ boss-down');
});
