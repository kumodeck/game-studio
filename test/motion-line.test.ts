// A motion starts as one line (studio-motion-line, 2026-10-23; a review of 10/22 "cluttered, hard to follow", 10/23 "none of
// it makes sense"). Without a browser (the real plate: test/studio-motion-line.browser.mjs):
//   1. one hand, one change: "Make a motion" + one drag = Save · 1 (it was 2: the object's motion and the Library motion
//      it made, counted apart) and ONE ⌘Z that takes both back (before, the Library motion stayed, Save · 1 after undo);
//   2. the line's "[1 s ▾]": the motion takes that long, its points scaled (0 → 1 s becomes 0 → 2 s);
//   3. the words: the sentence in both languages ({name} {len} {repeat} in each one's order); the first-time steps gone;
//   4. the plate's code: no ⋯ door, no first-time steps; "+ Link an object" on the row only with Fine-tune open.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MotionLibrary } from '../src/shell/motion-library.ts';
import { MotionStore } from '../src/shell/motion-model.ts';
import { UndoStack, type Change } from '../src/shell/undo.ts';
import { createTimeline } from '../src/shell/timeline-wire.ts';
import { libCounted, stretchClip } from '../src/shell/timeline-model.ts';
import type { TimelineActs, TimelineView } from '../src/shell/timeline-panel.ts';
import { translate } from '../src/shell/i18n.ts';
import type { MotionClip, Pose } from '../src/contract.ts';

// Making plays the part just made (▶ runs on the animation frame): none in node, none needed.
globalThis.requestAnimationFrame ??= (() => 0) as never;
globalThis.cancelAnimationFrame ??= (() => {}) as never;

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../src/shell');
const code = (f: string) => readFileSync(join(SRC, f), 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
const between = (s: string, from: string, to: string) => s.slice(s.indexOf(from), s.indexOf(to, s.indexOf(from)));

function rig() {
  const places: Record<string, Pose> = { gate: { p: [0, 0, 0], r: 0, s: 1 } };
  const store = new MotionStore();
  const lib = new MotionLibrary();
  store.lib = lib;
  const undo = new UndoStack();
  let acts!: TimelineActs;
  let view!: () => TimelineView;
  const stand = { el: { hidden: true } as HTMLElement, render() {}, place() {}, focusStarts() {} };
  const tl = createTimeline({
    store, lib, others: () => [], undo, send: () => {}, dim: () => '3d', usable: () => true, picked: () => 'gate',
    place: (k) => places[k], order: () => Object.keys(places), label: (k) => k, select: () => {}, changed: () => {},
    layout: () => {}, numbers: () => {}, narrow: () => false, t: (k, v) => (v?.name ? `${v.name}’s motion` : k),
  }, (v, a) => ((view = v), (acts = a), stand as never));
  // What main.ts counts on Save for motions (placementDirty): the objects' motions + the Library motions not told by them.
  const saveCount = () => store.changedKeys().length + libCounted(lib.changedNames(), store.changedKeys(), (k) => (store.get(k)?.clips ?? []).map((c) => c.use ?? c.name)).length;
  const undoOnce = () => {
    const e = undo.undo();
    for (const c of [...(e?.changes ?? [])].reverse()) tl.apply(c as Extract<Change, { kind: 'motion' | 'motion-lib' | 'motion-rename' }>, 'undo');
    return e;
  };
  return { tl, store, lib, undo, saveCount, undoOnce, acts: () => acts, view: () => view() };
}
const at = (y: number): Pose => ({ p: [0, y, 0], r: 0, s: 1 });

// ----- 1. one hand, one change -----
test('Make a motion + one drag = Save · 1 and one ⌘Z, which leaves nothing behind (the Library motion goes too)', () => {
  const r = rig();
  r.tl.make('gate');
  assert.equal(r.saveCount(), 0, 'nothing made by a look');
  // A drag: live poses, then the end.
  r.tl.moved('gate', at(0.7), false, at(0));
  r.tl.moved('gate', at(1.4), true, at(0));
  assert.deepEqual(r.tl.motionOf('gate')!.clips![0]!.keys.p!.map((k) => k.t), [0, 1], 'a point at 0 s and one at 1 s');
  assert.ok(r.lib.get('gate’s motion'), 'the motion is in the Library, named after the object');
  assert.equal(r.saveCount(), 1, 'Save · 1 (it was 2)');
  assert.equal(r.undo.size, 1, 'one undo step');
  r.undoOnce();
  assert.equal(r.tl.motionOf('gate'), null, '⌘Z: no motion on the gate');
  assert.equal(r.lib.get('gate’s motion'), null, '…and none left in the Library');
  assert.equal(r.saveCount(), 0, 'Save · 0 after one ⌘Z');
});

test('libCounted: a Library motion used by an object whose motion changed counts with it; one changed alone still counts', () => {
  const uses = (k: string) => ({ gate: ['gate’s motion'], ship: ['Hop'] } as Record<string, string[]>)[k] ?? [];
  assert.deepEqual(libCounted(['gate’s motion'], ['gate'], uses), []);
  assert.deepEqual(libCounted(['gate’s motion', 'Spin'], ['gate'], uses), ['Spin'], 'made in the Library: its own change');
  assert.deepEqual(libCounted(['Hop'], [], uses), ['Hop'], 'its points edited on the plate (the objects keep { use }): counts');
});

// ----- 2. the line's length -----
test('"[1 s ▾]" → 2 s: the motion takes 2 s, its points scaled; a scene keeps its points (length only)', () => {
  const c: MotionClip = { name: 'm', len: 1, repeat: 'once', keys: { p: [{ t: 0, v: [0, 0, 0] }, { t: 0.5, v: [0, 1, 0] }, { t: 1, v: [0, 0, 0] }], r: [{ t: 1, v: [0, 1, 0] }] } };
  const s = stretchClip(c, 2);
  assert.equal(s.len, 2);
  assert.deepEqual(s.keys.p!.map((k) => k.t), [0, 1, 2]);
  assert.deepEqual(s.keys.r!.map((k) => k.t), [2]);
  assert.deepEqual(s.keys.p![1]!.v, [0, 1, 0], 'where it goes is the same');
  assert.equal(stretchClip(c, 0).len, 0.1, 'at least 0.1 s');
  const r = rig();
  r.tl.make('gate');
  r.tl.moved('gate', at(1.4), true, at(0));
  r.acts().stretch!(2);
  const now = r.tl.motionOf('gate')!.clips![0]!;
  assert.equal(now.len, 2);
  assert.deepEqual(now.keys.p!.map((k) => k.t), [0, 2], 'the wire scales the points');
});

// ----- 3. the words -----
test('the sentence, in both languages: {name} {len} {repeat} in each one\'s order; the first-time steps are gone', () => {
  const v = { name: 'gate', len: '[1 s]', repeat: '[Once]' };
  assert.equal(translate('en', 'tl.line', v), 'gate moves [Once] in [1 s]');
  assert.equal(translate('ja', 'tl.line', v), 'gate が [1 s] で [Once] 動く');
  assert.equal(translate('ja', 'tl.lenOpt', { s: 1 }), '1 秒');
  assert.equal(translate('en', 'tl.lenOpt', { s: 1 }), '1 s');
  assert.equal(translate('ja', 'tl.more'), '細かく調整');
  assert.equal(translate('ja', 'tl.play'), '見る');
  for (const lang of ['en', 'ja'] as const) {
    for (const k of ['tl.lenOther', 'tl.on', 'tl.off']) assert.notEqual(translate(lang, k), k, `${lang}: ${k}`);
    for (const k of ['tl.coach.title', 'tl.coach.1', 'tl.coach.ok']) assert.equal(translate(lang, k), k, `${lang}: ${k} is gone`);
  }
});

// ----- 4. the plate's code -----
test('the plate: no ⋯ door and no first-time steps; Fine-tune is a sheet in the plate; the row\'s "+" only with it open', () => {
  const panel = code('timeline-panel.ts');
  assert.ok(!panel.includes('createMorePop(() => el.closest<HTMLElement>(\'.shell\') ?? document.body, t(\'tl.more\')'), 'no ⋯ popover');
  assert.ok(!panel.includes('tl-coach') && !panel.includes('coachDone'), 'no first-time steps');
  assert.ok(panel.includes("class: 'tl-fine'") && panel.includes("h('div', { class: 'tl-main' }, fineEl"), 'Fine-tune is in the plate, left of the rows');
  const rows = between(panel, 'function renderRows(', 'function allRow(');
  assert.match(rows, /act\.link && v\.fine \? linkBtn\(v\)/, '"+ Link an object" on the row only with Fine-tune open');
  const wire = code('timeline-wire.ts');
  assert.ok(!wire.includes('COACH'), 'the wire has no first-time steps');
  assert.ok(wire.includes("const FINE_SEEN = 'timeline-fine'"), 'Fine-tune is remembered in the prefs');
});
