// "▶ Preview" plays only the timeline's rows (studio-preview-rows, 2026-10-24). A request, made while making sea-stack's motion in
// Lantern Cove: "I'm making the motion of the object I picked, but when I play it other objects start moving too — I
// want to play only the objects lined up on the timeline I'm on". Without a browser: what timeline-wire.ts sends the
// game page on ▶, a move of the time line and a cue's ▶ (Try), for the rows and for every other object. The page
// itself: test/studio-preview-rows.browser.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UndoStack } from '../src/shell/undo.ts';
import { MotionStore } from '../src/shell/motion-model.ts';
import { MotionLibrary } from '../src/shell/motion-library.ts';
import { createTimeline } from '../src/shell/timeline-wire.ts';
import type { TimelineActs, TimelineView } from '../src/shell/timeline-panel.ts';
import type { MotionClip, Pose, ShellToBridge } from '../src/contract.ts';

const rise = (len: number, repeat: MotionClip['repeat'] = 'once'): Omit<MotionClip, 'name'> => ({ len, repeat, keys: { p: [{ t: 0, v: [0, 0, 0] }, { t: len, v: [0, len, 0], ease: 'linear' }] } });

// stack: the picked one (its motion at the start). gull: a loop from the start. boat: after the stack's motion ends.
// crab: no motion. Rows with the stack picked: only the stack.
function rig() {
  const places: Record<string, Pose> = {
    stack: { p: [0, 0, 0], r: 0, s: 1 }, gull: { p: [5, 0, 0], r: 0, s: 1 }, boat: { p: [9, 0, 0], r: 0, s: 1 }, crab: { p: [2, 0, 2], r: 0, s: 1 },
  };
  const store = new MotionStore();
  const lib = new MotionLibrary();
  store.lib = lib;
  store.set('stack', { clips: [{ name: 'Rise', ...rise(1), when: { on: 'start' } }] });
  store.set('gull', { clips: [{ name: 'Fly', ...rise(2, 'loop'), when: { on: 'start' } }] });
  store.set('boat', { clips: [{ name: 'Sail', ...rise(1), when: { on: 'after', key: 'stack', use: 'Rise' } }] });
  const sent: ShellToBridge[] = [];
  let picked: string | null = 'stack';
  let acts!: TimelineActs;
  let view!: () => TimelineView;
  const stand = { el: { hidden: true } as HTMLElement, render() {}, place() {} };
  const tl = createTimeline({
    store, lib, others: () => [], undo: new UndoStack(), send: (m) => sent.push(structuredClone(m)), dim: () => '3d', usable: () => true,
    picked: () => picked, place: (k) => places[k], order: () => Object.keys(places), label: (k) => k, select: (k) => (picked = k),
    changed: () => {}, layout: () => {}, numbers: () => {}, narrow: () => false, t: (k) => k,
  }, (v, a) => ((view = v), (acts = a), stand as never));
  const pose = (k: string) => (sent.filter((m) => m.type === 'studio:timeline/pose').pop() as Extract<ShellToBridge, { type: 'studio:timeline/pose' }>).poses.find((p) => p.key === k)?.pose;
  return { tl, sent, pose, acts: () => acts, view: () => view(), pick: (k: string | null) => (picked = k) };
}

/** Frames and the clock by hand: `step(ms)` moves the clock and runs the next frame. */
function clock() {
  const keep = { raf: globalThis.requestAnimationFrame, caf: globalThis.cancelAnimationFrame, now: performance.now };
  const frames: Array<(t: number) => void> = [];
  let now = 1000;
  globalThis.requestAnimationFrame = ((cb: (t: number) => void) => frames.push(cb)) as never;
  globalThis.cancelAnimationFrame = (() => {}) as never;
  performance.now = () => now;
  return {
    step(ms: number) {
      now += ms;
      frames.shift()?.(now);
    },
    done() {
      globalThis.requestAnimationFrame = keep.raf;
      globalThis.cancelAnimationFrame = keep.caf;
      performance.now = keep.now;
    },
  };
}

test('preview rows: the time line moved shows the rows moving, every other object at its place', () => {
  const r = rig();
  r.tl.setOpen(true);
  assert.deepEqual(r.view().rows.map((x) => x.key), ['stack'], 'the picked object is the one row');
  r.tl.setTime(0.5);
  assert.deepEqual(r.pose('stack')!.p, [0, 0.5, 0], 'the row: its motion at 0.5 s');
  assert.deepEqual(r.pose('gull')!.p, [5, 0, 0], 'not a row: at its place');
  assert.deepEqual(r.pose('boat')!.p, [9, 0, 0]);
  assert.deepEqual(r.tl.shownPose('gull')!.p, [5, 0, 0], 'the card and a drag see it where it is shown');
  assert.deepEqual(r.tl.placeFor('gull', { p: [6, 0, 0], r: 0, s: 1 }).p, [6, 0, 0], 'a move of it is a move of its place');
});

test('preview rows: ▶ moves only the rows, and stops at the end of theirs (a loop elsewhere does not keep it going)', () => {
  const r = rig();
  const c = clock();
  try {
    r.tl.setOpen(true);
    r.acts().play(true);
    c.step(500);
    assert.deepEqual(r.pose('stack')!.p, [0, 0.5, 0]);
    assert.equal(r.pose('gull'), undefined, 'the gull is not sent at all while ▶ runs: it stays where it stood');
    c.step(1000);
    assert.equal(r.tl.state().playing, false, 'the stack\'s once ended: ▶ stops, though the gull loops');
    assert.deepEqual(r.pose('gull')!.p, [5, 0, 0], 'stopped: every other object at its place');
  } finally {
    c.done();
  }
});

test('preview rows: a pick changes the rows, and what moves with them', () => {
  const r = rig();
  r.tl.setOpen(true);
  r.tl.setTime(1);
  assert.deepEqual(r.pose('gull')!.p, [5, 0, 0]);
  r.pick('gull');
  r.tl.render();
  assert.deepEqual(r.pose('gull')!.p, [5, 1, 0], 'the gull picked: its row, its motion at 1 s');
  assert.deepEqual(r.pose('stack')!.p, [0, 0, 0], 'the stack left the rows: back at its place');
  r.acts().showAll(true);
  assert.deepEqual(r.pose('stack')!.p, [0, 1, 0], '⋯ "Show every motion": every moving object is a row, and moves');
});

test('preview rows: a cue\'s ▶ runs the scene, but an "after" chained to an object off the timeline stays put', () => {
  const r = rig();
  const c = clock();
  try {
    r.tl.setOpen(true);
    r.tl.tryCue('start');
    c.step(500);
    assert.deepEqual(r.pose('stack')!.p, [0, 0.5, 0], 'the row runs');
    assert.deepEqual(r.pose('gull')!.p, [5, 0, 0], 'the gull (from the start, not a row) stays');
    c.step(1000);
    assert.equal(r.tl.state().lit.boat, 'Sail', 'the boat\'s Sail did start after the stack\'s Rise (the game\'s rules)…');
    assert.deepEqual(r.pose('boat')!.p, [9, 0, 0], '…but the boat is not on the timeline: it is not moved');
    r.pick('boat');
    c.step(250);
    assert.ok(r.pose('boat')!.p[1]! > 0, 'picked, the boat is a row: its Sail shows');
    r.tl.stopTry();
  } finally {
    c.done();
  }
});
