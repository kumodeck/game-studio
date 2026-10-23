// No motion presets (studio-no-presets, 2026-10-23). A review, on "Back and forth / Round / Once / Spin" in the
// menus: "what is this? presets? why are 'back and forth' and 'round' in there?" — and to keeping just "Make a motion"
// and "Use a saved motion": "we don't need them". Without a browser:
//   1. no kind's words anywhere on screen (the i18n tables, the shell's sources); the repeat in ⋯ stays (it is a setting);
//   2. a file made before (a motion that goes back and forth, the older path / spin shape) still plays as it did;
//   3. make → a drag → two keys (0 s where it stood, 1 s where it was put) → it plays; each next move / turn adds a
//      second; Esc before the drag makes nothing; "Done" / Esc after keeps what was made; the time line moved by hand ends it.
// The strip's Motion button to a made motion in a real editor: test/studio-no-presets.browser.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MotionLibrary } from '../src/shell/motion-library.ts';
import { MotionStore } from '../src/shell/motion-model.ts';
import { UndoStack } from '../src/shell/undo.ts';
import { createTimeline } from '../src/shell/timeline-wire.ts';
import type { TimelineActs, TimelineView } from '../src/shell/timeline-panel.ts';
import { offsetsAt, toClips } from '../src/shell/timeline-model.ts';
import { translate } from '../src/shell/i18n.ts';
import type { MotionClip, Pose } from '../src/contract.ts';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../src/shell');
const near = (a: number[] | null | undefined, b: number[], eps = 1e-6) => !!a && a.length === b.length && a.every((v, i) => Math.abs(v - b[i]!) < eps);

// ----- 1. the words -----
test('no kind\'s words on screen: the template keys are gone in both languages, nothing in the shell asks for them', () => {
  for (const lang of ['en', 'ja'] as const) for (const k of ['empty', 'pingpong', 'loop', 'once', 'spin']) {
    assert.equal(translate(lang, `tl.tpl.${k}`), `tl.tpl.${k}`, `${lang}: tl.tpl.${k} is gone`);
  }
  // The scene line went too (studio-ui-lead2, 2026-10-23: "Make a motion, New — I can't tell what either does"; linking makes a scene).
  assert.equal(translate('ja', 'tl.tpl.scene'), 'tl.tpl.scene');
  // The kinds' own words (the review's quote) nowhere in the tables but the repeat setting of ⋯.
  const i18n = readFileSync(join(SRC, 'i18n.ts'), 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l) && !/'tl\.repeat\./.test(l)).join('\n');
  for (const w of ['行ったり来たり', 'ぐるっと回る', 'その場で回る', "'Round'", "'Spin'", "'Back and forth'"]) assert.ok(!i18n.includes(w), `"${w}" is not a word on screen`);
  // No source picks a template any more (the clip menu, the strip, the card, ⌘K, the Library).
  for (const f of readdirSync(SRC).filter((n) => n.endsWith('.ts'))) {
    const code = readFileSync(join(SRC, f), 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    assert.doesNotMatch(code, /tl\.tpl\.|fromTemplate|TEMPLATES|makeFrom|new:(pingpong|loop|once|spin|empty|scene)/, f);
  }
  // The two ways in, in both languages.
  assert.equal(translate('ja', 'motion.tool.make'), '動きを作る');
  assert.equal(translate('en', 'motion.tool.make'), 'Make a motion');
  assert.equal(translate('ja', 'motion.tool.saved'), '保存した動きを使う');
  assert.equal(translate('en', 'motion.tool.saved'), 'Use a saved motion');
  assert.equal(translate('ja', 'tl.make.drag', { name: '木箱' }), '木箱 を、動いてほしい所までドラッグしてください（Esc でやめる）');
  assert.match(translate('en', 'tl.make.drag', { name: 'crate' }), /^Drag crate to where it should move \(Esc to cancel\)$/);
});

// ----- 2. a file made before -----
test('a file made before still plays: a back-and-forth motion, the older path and spin', () => {
  // A clip that goes back and forth (as the old "Back and forth" made it): there at 2 s, back at 4 s, there at 6 s.
  const pp: MotionClip = { name: 'Back and forth', len: 2, repeat: 'pingpong', keys: { p: [{ t: 0, v: [0, 0, 0], ease: 'linear' }, { t: 2, v: [3, 0, 0], ease: 'linear' }] } };
  assert.ok(near(offsetsAt(pp, 1).p, [1.5, 0, 0]));
  assert.ok(near(offsetsAt(pp, 3).p, [1.5, 0, 0]), 'on its way back');
  assert.ok(near(offsetsAt(pp, 4).p, [0, 0, 0]), 'home again');
  // The older shape (v0.1.13): a path with a speed, a spin.
  const old = toClips({ path: [[4, 0, 0]], speed: 2, repeat: 'pingpong' }, '3d')!.clips![0]!;
  assert.equal(old.repeat, 'pingpong');
  assert.ok(near(offsetsAt(old, 3).p, [2, 0, 0]), 'back half way at 3 s');
  const spin = toClips({ spin: Math.PI }, '3d')!.clips![0]!;
  assert.equal(spin.repeat, 'loop');
  assert.ok(near(offsetsAt(spin, 1).r, [0, Math.PI, 0]));
});

// ----- 3. make → drag → keys → play -----
function rig() {
  const places: Record<string, Pose> = { crate: { p: [0, 0, 0], r: 0, s: 1 }, barrel: { p: [5, 0, 0], r: 0, s: 1 } };
  const store = new MotionStore();
  const lib = new MotionLibrary();
  store.lib = lib;
  const undo = new UndoStack();
  let picked: string | null = 'crate';
  let acts!: TimelineActs;
  let view!: () => TimelineView;
  const stand = { el: { hidden: true } as HTMLElement, render() {}, place() {}, focusStarts() {} };
  const tl = createTimeline({
    store, lib, others: () => [], undo, send: () => {}, dim: () => '3d', usable: () => true, picked: () => picked,
    place: (k) => places[k], order: () => Object.keys(places), label: (k) => k, select: (k) => (picked = k), changed: () => {},
    layout: () => {}, numbers: () => {}, narrow: () => false, t: (k) => k,
  }, (v, a) => ((view = v), (acts = a), stand as never));
  return { tl, lib, undo, acts: () => acts, view: () => view(), pick: (k: string | null) => (picked = k) };
}
/** ▶ runs on frames: count them (a play started) without running them. */
function frames<T>(f: (n: () => number) => T): T {
  const keep = { raf: globalThis.requestAnimationFrame, caf: globalThis.cancelAnimationFrame };
  let n = 0;
  globalThis.requestAnimationFrame = (() => ++n) as never;
  globalThis.cancelAnimationFrame = (() => {}) as never;
  try {
    return f(() => n);
  } finally {
    globalThis.requestAnimationFrame = keep.raf;
    globalThis.cancelAnimationFrame = keep.caf;
  }
}
const at = (x: number, r = 0, s = 1): Pose => ({ p: [x, 0, 0], r, s });

test('make → drag: 0 s where it stood, 1 s where it was put, and it plays from 0 s at once', () => frames((n) => {
  const r = rig();
  r.tl.setAuto(false);
  r.tl.make('crate');
  assert.equal(r.tl.isOpen(), true, 'the timeline opens');
  assert.equal(r.tl.state().auto, true, 'making is moving: the auto key comes on');
  assert.equal(r.tl.state().time, 1);
  assert.equal(r.view().making, 'drag', 'the line: "drag it where it should move (Esc to cancel)"');
  assert.equal(r.tl.motionOf('crate'), null, 'nothing made by a look');
  // A live drag, then its end.
  r.tl.moved('crate', at(1), false, at(0));
  r.tl.moved('crate', at(2), true, at(0));
  const c = r.tl.motionOf('crate')!.clips![0]!;
  assert.deepEqual(c.keys.p!.map((k) => [k.t, k.v]), [[0, [0, 0, 0]], [1, [2, 0, 0]]], 'two keys');
  assert.deepEqual(c.when, { on: 'start' }, 'its first motion plays when the game starts');
  assert.equal(r.tl.state().playing, true, 'it plays to show it');
  assert.ok(n() > 0);
  assert.equal(r.view().making, 'more');
  assert.equal(r.view().made, 1, '"✓ 0–1 s · keep moving it to add a second"');
}));

test('making: each next move / turn adds a key one second after the last, and plays that second', () => frames(() => {
  const r = rig();
  r.tl.make('crate');
  r.tl.moved('crate', at(2), true, at(0));
  // The next move, grabbed while it plays (the play stops, the time goes to 2 s).
  r.tl.moved('crate', at(2, 0, 1), false, at(2));
  r.tl.moved('crate', at(4), true, at(2));
  let c = r.tl.motionOf('crate')!.clips![0]!;
  assert.deepEqual(c.keys.p!.map((k) => [k.t, k.v[0]]), [[0, 0], [1, 2], [2, 4]]);
  assert.equal(c.len, 2, 'the motion grew to hold it');
  assert.equal(r.tl.state().playing, true);
  // A turn: its own second (2 → 3 s), holding still until then.
  r.tl.moved('crate', at(4, Math.PI / 2), true, at(4));
  c = r.tl.motionOf('crate')!.clips![0]!;
  assert.deepEqual(c.keys.r!.map((k) => k.t), [0, 2, 3], 'the turn starts at the last key (2 s), not at 0 s');
  assert.ok(near(c.keys.r!.at(-1)!.v, [0, Math.PI / 2, 0]));
  assert.ok(near(offsetsAt(c, 2).r, [0, 0, 0]), 'no turn yet while it moves');
  assert.deepEqual(c.keys.p!.map((k) => k.t), [0, 1, 2], 'the position keys as they were');
}));

test('Esc before the drag: nothing made, the time line back at 0 s; Esc / Done after: what was made stays, the next move is a plain key', () => frames(() => {
  const r = rig();
  r.tl.make('crate');
  assert.equal(r.tl.onKey({ key: 'Escape', ctrl: false, meta: false, shift: false }), true, 'Esc is taken');
  assert.equal(r.view().making, null);
  assert.equal(r.tl.state().time, 0);
  assert.equal(r.tl.motionOf('crate'), null);
  assert.equal(r.undo.peekUndo(), null, 'nothing to undo');
  // Again, then Done after the first move.
  r.tl.make('crate');
  r.tl.moved('crate', at(2), true, at(0));
  r.acts().done!();
  assert.equal(r.view().making, null);
  assert.equal(r.tl.motionOf('crate')!.clips![0]!.keys.p!.length, 2, 'kept');
  // The time line where the person puts it: a move there is a key there (no second added).
  r.tl.setTime(0.5);
  r.tl.moved('crate', at(3), true, at(1));
  assert.deepEqual(r.tl.motionOf('crate')!.clips![0]!.keys.p!.map((k) => k.t), [0, 0.5, 1]);
}));

test('making ends when the time line is moved by hand, the timeline is folded or another object is shown', () => frames(() => {
  const r = rig();
  r.tl.make('crate');
  r.tl.moved('crate', at(2), true, at(0));
  r.acts().scrub(0.5, true);
  assert.equal(r.view().making, null, 'the ruler: the person takes the times from here');
  r.tl.make('crate');
  r.tl.setOpen(false);
  r.tl.setOpen(true);
  assert.equal(r.view().making, null, 'folded');
  r.tl.make('crate');
  r.pick('barrel');
  assert.equal(r.view().making, null, 'another object');
}));

test('the clip menu offers "+ Make a motion" (the same way) and a scene — no kinds', () => frames(() => {
  const r = rig();
  r.tl.make('crate');
  r.tl.moved('crate', at(2), true, at(0));
  r.acts().done!();
  r.acts().clip('new:make');
  assert.equal(r.view().making, 'drag');
  assert.equal(r.tl.state().time, 1);
  r.tl.moved('crate', at(0, 0, 2), true, at(2));
  const cs = r.tl.motionOf('crate')!.clips!;
  assert.deepEqual(cs.map((c) => c.name), ['Motion', 'Motion 2']);
  assert.deepEqual(Object.keys(cs[1]!.keys), ['p', 's'], 'its own keys: the move back and the size');
  assert.deepEqual(cs[1]!.when, { on: 'say' }, 'a second motion waits');
  // A kind's value from an old page does nothing.
  r.acts().clip('new:pingpong');
  assert.equal(r.tl.motionOf('crate')!.clips!.length, 2);
}));
