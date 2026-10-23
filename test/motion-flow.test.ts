// Making a motion and putting it on objects (studio-motion-flow; a hands-on try of v0.1.18, 2026-10-22: "I couldn't tell how to make a
// motion and then put it on objects"), without a browser: timeline-wire.ts's make (the card's "+ New motion", the
// Library's "+ New motion"), attach / show (a drop, the card's "From Library", the Library's detail: the plate opens on
// it with "✓ attached · When does it move?"), and the first-time steps shown once. The drag itself, the card's two
// buttons and the Library's tile in a real editor: test/studio-motion-flow.browser.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MotionLibrary } from '../src/shell/motion-library.ts';
import { MotionStore } from '../src/shell/motion-model.ts';
import { UndoStack } from '../src/shell/undo.ts';
import { createTimeline } from '../src/shell/timeline-wire.ts';
import type { TimelineActs, TimelineView } from '../src/shell/timeline-panel.ts';
import { normalizeUi } from '../src/shell/ui-prefs.ts';
import type { MotionClip, Pose } from '../src/contract.ts';

// make → a move plays the motion (studio-no-presets): ▶'s frames are never run here.
globalThis.requestAnimationFrame ??= (() => 0) as never;
globalThis.cancelAnimationFrame ??= (() => {}) as never;

const hop: MotionClip = { name: 'Hop', len: 1, repeat: 'once', keys: { p: [{ t: 0, v: [0, 0, 0] }, { t: 1, v: [0, 2, 0] }] } };

function rig(seenBefore: string[] = []) {
  const places: Record<string, Pose> = { crate: { p: [0, 0, 0], r: 0, s: 1 }, barrel: { p: [5, 0, 0], r: 0, s: 1 } };
  const store = new MotionStore();
  const lib = new MotionLibrary();
  store.lib = lib;
  lib.set('Hop', hop);
  lib.markSaved();
  store.set('barrel', { clips: [{ name: 'Hop', use: 'Hop', len: 1, when: { on: 'start' }, keys: {} }] });
  const undo = new UndoStack();
  const seen = new Set<string>(seenBefore);
  let picked: string | null = null;
  let acts!: TimelineActs;
  let view!: () => TimelineView;
  let focused = 0;
  const stand = { el: { hidden: true } as HTMLElement, render() {}, place() {}, focusStarts: () => focused++ };
  const tl = createTimeline({
    store, lib, others: () => [], undo, send: () => {}, dim: () => '3d', usable: () => true, picked: () => picked,
    place: (k) => places[k], order: () => Object.keys(places), label: (k) => k, select: (k) => (picked = k), changed: () => {},
    layout: () => {}, numbers: () => {}, narrow: () => false, t: (k, v) => (v?.name ? `${k}:${v.name}` : k),
    seen: (id) => seen.has(id), markSeen: (id) => seen.add(id),
  }, (v, a) => ((view = v), (acts = a), stand as never));
  return { store, lib, undo, tl, seen, acts: () => acts, view: () => view(), pick: (k: string | null) => (picked = k), focused: () => focused };
}

test('make: an object with no motion — the plate opens on it, nothing is made until it moves (no empty "Motion" left behind)', () => {
  const r = rig();
  r.pick('crate');
  r.tl.make('crate');
  assert.equal(r.tl.isOpen(), true);
  assert.equal(r.view().focus, 'crate');
  assert.equal(r.store.get('crate'), null, 'no clip yet');
  assert.deepEqual(r.lib.list().map((m) => m.name), ['Hop'], 'no new Library motion yet');
  assert.equal(r.undo.peekUndo(), null, 'not an edit');
  // Then the hand: a moment, a move — the first clip, as ◆ Timeline always did.
  r.tl.setTime(1);
  r.tl.moved('crate', { p: [2, 0, 0], r: 0, s: 1 }, true, { p: [0, 0, 0], r: 0, s: 1 });
  assert.equal(r.tl.motionOf('crate')!.clips!.length, 1);
});

test('make: an object that moves already gets a new motion from its next move (a move must not change the one it has)', () => {
  const r = rig();
  r.pick('barrel');
  r.tl.make('barrel');
  // studio-no-presets: nothing made by a look — the plate shows no motion until the move.
  assert.deepEqual(r.tl.motionOf('barrel')!.clips!.map((c) => c.name), ['Hop']);
  assert.equal(r.tl.state().clip, null, 'waiting for the move');
  r.tl.moved('barrel', { p: [6, 0, 0], r: 0, s: 1 }, true, { p: [5, 0, 0], r: 0, s: 1 });
  const cs = r.tl.motionOf('barrel')!.clips!;
  // The first name is the object's (studio-words-plan: motion.firstName; this rig's t() shows the key and the vars).
  assert.deepEqual(cs.map((c) => c.name), ['Hop', 'motion.firstName:barrel']);
  assert.equal(r.tl.state().clip, 'motion.firstName:barrel', 'the plate shows the new one');
  assert.deepEqual(cs[1]!.when, { on: 'say' }, 'the second motion waits (the first one starts with the game)');
  assert.deepEqual(r.lib.get('Hop')!.keys.p!.map((k) => k.v), [[0, 0, 0], [0, 2, 0]], 'Hop is as it was');
});

test('attach + show: the plate opens on the attached motion, "attached" with Starts focused, until a "when" is chosen', () => {
  const r = rig();
  r.pick('crate');
  assert.equal(r.tl.attach('crate', 'Hop'), true);
  r.tl.show('crate', 'Hop', true);
  assert.equal(r.tl.isOpen(), true);
  assert.equal(r.view().attached, 'Hop');
  assert.equal(r.focused(), 1, '"When does it move?" is open (Starts focused)');
  assert.deepEqual(r.view().when, { on: 'start' }, 'its first motion: when the game starts');
  r.acts().setWhen({ on: 'key', key: 'KeyE' });
  assert.equal(r.view().attached, null, 'a "when" chosen: the row reads Starts again');
  assert.deepEqual(r.tl.motionOf('crate')!.clips![0]!.when, { on: 'key', key: 'KeyE' });
  // Attaching the same motion again is "it is on there": true, nothing added.
  assert.equal(r.tl.attach('crate', 'Hop'), true);
  assert.equal(r.tl.motionOf('crate')!.clips!.length, 1);
  assert.equal(r.tl.attach('nowhere', 'Hop'), false, 'not an object in this scene');
  assert.equal(r.tl.attach('crate', 'Nope'), false, 'not a Library motion');
});

// studio-motion-line (2026-10-23): the first-time three steps are gone (the line says the next step), and "Fine-tune"
// is remembered — opened once, the plate opens with it open (the game's ui prefs `seen`, test/motion-line.test.ts has more).
test('no first-time steps any more; Fine-tune, once opened, stays open (seen: timeline-fine)', () => {
  const r = rig();
  r.pick('crate');
  r.tl.setOpen(true);
  assert.equal('coach' in r.view(), false, 'the view has no first-time steps');
  assert.equal(r.view().fine, false, 'Fine-tune starts closed');
  r.acts().fine!(true);
  assert.equal(r.view().fine, true);
  assert.ok(r.seen.has('timeline-fine'), 'kept in the prefs');
  // A new editor on the same game (the prefs say it was opened): open from the start.
  const r2 = rig(['timeline-fine']);
  r2.pick('crate');
  r2.tl.setOpen(true);
  assert.equal(r2.view().fine, true, 'opened before: open from the start');
  r2.acts().fine!(false);
  assert.equal(r2.view().fine, false, 'closed by hand: closed');
});

test('ui prefs keep the hints closed (`seen`): short slugs only, at most 20', () => {
  assert.deepEqual(normalizeUi({ seen: ['timeline-steps', 'timeline-steps', 'Bad Name', 3] }).seen, ['timeline-steps']);
  assert.equal(normalizeUi({}).seen, undefined);
  assert.equal(normalizeUi({ seen: Array.from({ length: 30 }, (_, i) => `h${i}`) }).seen!.length, 20);
});
