// The motion's one line over the ask field and ✦ Ask's menu in the result's words (studio-motion-next-2, 2026-10-24; a hands-on
// review of v0.1.58). Without a browser:
//   1. the review's checks 1–4 on the line's inputs (timeline-wire noteIn → motion-note noteOf): a point dragged → the line;
//      the ease to Steady → still there; the timeline folded → still there; Save → gone. Repeat / When too, and the
//      motion's name ("… is made" for a new one, "… changed" for one that was saved);
//   2. ● Rec motion on → "Recording · press ● when you're done" (with the change, in place of ✦); the line's ● = Rec off;
//   3. another object picked (or none) → "Not saved: <motion>" (each Library motion once);
//   4. ✦ Ask's menu: three rows by what is wanted, each with its own grey example and its own draft; "Ask anything" gone;
//   5. the words: the result ("adjustable with numbers"), never "rule" / "knob" on what is pressed.
// On screen (both languages, dark): test/studio-motion-next-2.browser.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MotionLibrary } from '../src/shell/motion-library.ts';
import { MotionStore } from '../src/shell/motion-model.ts';
import { UndoStack } from '../src/shell/undo.ts';
import { createTimeline } from '../src/shell/timeline-wire.ts';
import { noteOf, type NoteIn } from '../src/shell/motion-note.ts';
import type { TimelineActs, TimelineView } from '../src/shell/timeline-panel.ts';
import type { MenuEntry, MenuItem } from '../src/shell/context-menu.ts';
import { translate } from '../src/shell/i18n.ts';
import type { Pose } from '../src/contract.ts';

function rig(ai = true) {
  const places: Record<string, Pose> = { lamp: { p: [0, 0, 0], r: 0, s: 1 }, crate: { p: [5, 0, 0], r: 0, s: 1 }, gate: { p: [9, 0, 0], r: 0, s: 1 } };
  const store = new MotionStore();
  const lib = new MotionLibrary();
  store.lib = lib;
  let picked: string | null = 'lamp';
  let acts!: TimelineActs;
  let view!: () => TimelineView;
  const asked: Array<{ key: string; name: string; draft?: string; rule?: boolean }> = [];
  let menu: MenuEntry[] | null = null;
  let notes = 0;
  const stand = { el: { hidden: true } as HTMLElement, render() {}, place() {}, focusStarts() {} };
  const tl = createTimeline({
    store, lib, others: () => [], undo: new UndoStack(), send: () => {}, dim: () => '3d', usable: () => true, picked: () => picked,
    place: (k) => places[k], order: () => Object.keys(places), label: (k) => k, select: (k) => (picked = k), changed: () => {},
    layout: () => {}, numbers: () => {}, narrow: () => false, t: (k) => k, note: () => void notes++,
    ...(ai ? {
      ask: (key: string, m: { name: string }, draft?: string) => void asked.push({ key, name: m.name, ...(draft ? { draft } : {}) }),
      toRule: (key: string, m: { name: string }) => void asked.push({ key, name: m.name, rule: true }),
      menu: (_at: HTMLElement, entries: MenuEntry[]) => void (menu = entries),
    } : {}),
  }, (v, a) => ((view = v), (acts = a), stand as never));
  const save = () => (store.markSaved(), lib.markSaved(), tl.saved());
  return { tl, store, lib, save, acts: () => acts, view: () => view(), asked, menu: () => menu, pick: (k: string | null) => (picked = k), notes: () => notes,
    note: () => noteOf(tl.noteIn()) };
}
/** ▶ runs on frames: none run here. */
function frames<T>(f: () => T): T {
  const keep = { raf: globalThis.requestAnimationFrame, caf: globalThis.cancelAnimationFrame };
  globalThis.requestAnimationFrame = (() => 1) as never;
  globalThis.cancelAnimationFrame = (() => {}) as never;
  try {
    return f();
  } finally {
    globalThis.requestAnimationFrame = keep.raf;
    globalThis.cancelAnimationFrame = keep.caf;
  }
}
const at = (x: number): Pose => ({ p: [x, 0, 0], r: 0, s: 1 });
/** lamp's motion made (Make a motion, two moves, Done) and saved, ● Rec motion off: "a motion that is already there". */
function saved(r: ReturnType<typeof rig>) {
  r.tl.make('lamp');
  r.tl.moved('lamp', at(2), true, at(0));
  r.tl.moved('lamp', at(4), true, at(2));
  r.acts().done!();
  r.acts().auto(false);
  r.save();
  return r.tl.motionOf('lamp')!.clips![0]!.name;
}

test('noteOf: the change on screen first, then another object\'s; ● recording in place of ✦; nothing → null', () => {
  const m = { key: 'lamp', label: 'lamp', name: 'lamp’s motion', made: false };
  const base: NoteIn = { here: null, rec: false, others: [] };
  assert.equal(noteOf(base), null);
  assert.deepEqual(noteOf({ ...base, here: { ...m, canRule: true } }), { change: { where: 'here', motion: { ...m, canRule: true }, more: 0 }, rec: false, rule: true });
  assert.equal(noteOf({ ...base, here: { ...m, canRule: true }, rec: true })!.rule, false, 'recording: finish first (the ● part, not ✦)');
  assert.deepEqual(noteOf({ ...base, rec: true }), { change: null, rec: true, rule: false });
  const o = { key: 'gate', label: 'gate', name: 'gate’s motion', made: true };
  assert.deepEqual(noteOf({ ...base, others: [o, m] })!.change, { where: 'elsewhere', motion: o, more: 1 });
  assert.equal(noteOf({ ...base, here: { ...m, canRule: false }, others: [o] })!.change!.where, 'here', 'the one on screen wins');
});

test('the review\'s checks 1–4: a point dragged → the line; Steady → still; folded → still; Save → gone', () => frames(() => {
  const r = rig();
  const name = saved(r);
  assert.equal(r.note(), null, 'saved, ● off: nothing to say');
  // 1. A point of the path dragged in the game (the bridge's timeline/point, live then its end).
  r.tl.onMessage({ type: 'studio:timeline/point', key: 'lamp', i: 1, v: [2, 1, 0], end: false } as never);
  r.tl.onMessage({ type: 'studio:timeline/point', key: 'lamp', i: 1, v: [2, 1, 0], end: true } as never);
  const n1 = r.note()!;
  assert.deepEqual(n1.change, { where: 'here', motion: { key: 'lamp', label: 'lamp', name, made: false, canRule: true }, more: 0 }, '"lamp’s motion changed · Save puts it in the game"');
  assert.equal(n1.rule, true, '· ✦ Make it adjustable with numbers');
  assert.ok(r.notes() > 0, 'the plate\'s redraws ask the shell to draw the line again');
  // 2. The ease of the picked keys to Steady (after a Save, so it is the ease that makes the change).
  r.save();
  assert.equal(r.note(), null);
  r.acts().pickKeys([{ key: 'lamp', ch: 'p', t: 1 }], false);
  r.acts().ease('linear');
  assert.equal(r.note()?.change?.where, 'here', 'the ease changed → the line');
  // 3. Folded: the plate is gone, the picked object's change is still said.
  r.tl.setOpen(false);
  assert.equal(r.note()?.change?.motion.name, name, 'folded: still there');
  assert.equal(r.note()?.rec, false, 'folded: nothing records');
  // 4. Save: gone.
  r.save();
  assert.equal(r.note(), null, 'saved: the line has done its job');
}));

test('Repeat and When are changes too; ⌘Z back to the saved motion → no line', () => frames(() => {
  const r = rig();
  saved(r);
  r.acts().repeat('loop');
  assert.equal(r.note()?.change?.where, 'here', 'Repeat (a Library motion change)');
  r.save();
  r.acts().setWhen?.([{ on: 'click' }] as never);
  assert.equal(r.note()?.change?.where, 'here', 'When (the attachment on the object)');
  r.save();
  r.acts().repeat('pingpong');
  assert.ok(r.note());
  r.acts().repeat('loop');
  assert.equal(r.note(), null, 'back as saved: no change to speak of');
}));

test('a new motion says "is made"; ● Rec motion on → recording, its ● turns it off', () => frames(() => {
  const r = rig();
  r.tl.make('lamp');
  assert.deepEqual(r.note(), { change: null, rec: true, rule: false }, 'making: "● Recording · press ● when you\'re done"');
  r.tl.moved('lamp', at(2), true, at(0));
  const n = r.note()!;
  assert.equal(n.change?.motion.made, true, '"lamp’s motion is made"');
  assert.equal(n.rec, true);
  assert.equal(n.rule, false, 'recording: no ✦ yet');
  r.tl.recOff();
  assert.equal(r.tl.state().auto, false, 'the line\'s ● = Rec motion off');
  assert.equal(r.view().making, null, 'making ends with it');
  assert.equal(r.note()!.rec, false);
  assert.equal(r.note()!.rule, true, 'now ✦ Make it adjustable with numbers');
  // A saved motion, ● on, nothing changed: recording only.
  r.save();
  r.acts().auto(true);
  assert.deepEqual(r.note(), { change: null, rec: true, rule: false });
}));

test('another object picked, or none: "Not saved: lamp’s motion" — each Library motion once, the name picks it', () => frames(() => {
  const r = rig();
  const name = saved(r);
  r.acts().repeat('loop');
  r.pick('crate');
  r.tl.render();
  const n = r.note()!;
  assert.deepEqual(n.change, { where: 'elsewhere', motion: { key: 'lamp', label: 'lamp', name, made: false }, more: 0 });
  assert.equal(n.rec, false, 'crate has no motion: nothing records');
  r.pick(null);
  r.tl.setOpen(false);
  assert.equal(r.note()?.change?.where, 'elsewhere', 'none picked, folded: still said');
  // The same Library motion on gate too: still one.
  r.pick('gate');
  r.tl.attach?.('gate', r.tl.motionOf('lamp')!.clips![0]!.use!);
  r.pick('crate');
  assert.equal(r.note()?.change?.more, 0, 'one Library motion, said once');
}));

test('✦ Ask\'s menu: three rows by what is wanted, each its own example and draft; "Ask anything" is gone', () => frames(() => {
  const r = rig();
  const name = saved(r);
  r.tl.setOpen(true);
  r.acts().askMenu!({} as HTMLElement);
  const rows = (r.menu() ?? []).filter((e): e is MenuItem => 'id' in e);
  assert.deepEqual(rows.map((e) => [e.id, e.label, e.sub, e.ai]), [
    ['tl-ask-rule', 'mnext2.toNumbersMenu', 'mnext2.toNumbersSub', true],
    ['tl-ask-fix', 'mnext2.fix', 'mnext2.fixSub', true],
    ['tl-ask-add', 'mnext2.add', 'mnext2.addSub', true],
  ]);
  rows[0]!.run();
  assert.deepEqual(r.asked.at(-1), { key: 'lamp', name, rule: true }, 'adjustable with numbers = the plate\'s ✦ Turn into a rule (its draft, to-code)');
  rows[1]!.run();
  assert.deepEqual(r.asked.at(-1), { key: 'lamp', name, draft: 'mnext2.fixDraft' });
  rows[2]!.run();
  assert.deepEqual(r.asked.at(-1), { key: 'lamp', name, draft: 'mnext2.addDraft' });
  // A motion of one point (no shape to make a rule of): the two others only.
  const one = rig();
  one.tl.make('lamp');
  one.tl.moved('lamp', at(2), true, at(0));
  one.acts().done!();
  one.tl.motionOf('lamp');
  one.acts().askMenu!({} as HTMLElement);
  assert.ok(((one.menu() ?? []).filter((e): e is MenuItem => 'id' in e)).every((e) => e.id !== 'tl-ask-free'));
}));

test('the words: the result on what is pressed, three different drafts, never "rule" / "knob" there', () => {
  const ja = (k: string, v: Record<string, string | number> = {}) => translate('ja', k, { ai: 'Claude', Ai: 'Claude', ...v });
  const en = (k: string, v: Record<string, string | number> = {}) => translate('en', k, { ai: 'Claude', Ai: 'Claude', ...v });
  // The review's words: the menu, and the line's example ("<the lamp>'s motion changed · Save puts it in the game · ✦ …").
  assert.equal(ja('mnext2.toNumbersMenu', { what: ja('mnext2.toNumbers') }), 'この動きを数字で調整できるようにする');
  assert.equal(ja('mnext2.toNumbersSub'), '速さ・大きさなど');
  assert.equal(ja('mnext2.fix'), 'この動きを直してもらう…');
  assert.equal(ja('mnext2.fixSub'), '例：もっとゆっくり・高く跳ねる');
  assert.equal(ja('mnext2.add'), '別の動きを足してもらう…');
  assert.equal(ja('mnext2.addSub'), '例：近づいたら回る');
  assert.equal(ja('mnext2.changed', { name: '街灯 5 の動き' }), '街灯 5 の動きを変えました');
  assert.equal(ja('mnext2.made', { name: '街灯 5 の動き' }), '街灯 5 の動きができました');
  assert.equal(ja('mnext2.save', { save: ja('btn.save') }), '保存するとゲームに入ります');
  assert.equal(ja('mnext2.line', { what: ja('mnext2.toNumbers') }), '数字で調整できるようにする');
  assert.equal(`${ja('mnext2.rec')} · ${ja('mnext2.recEnd', { dot: '●' })}`, '記録中 · 終わったら ● を押す');
  assert.equal(en('mnext2.toNumbersMenu', { what: en('mnext2.toNumbers') }), 'Make this motion adjustable with numbers');
  assert.equal(en('mnext2.line', { what: en('mnext2.toNumbers') }), 'Make it adjustable with numbers');
  // Three drafts, three different first words.
  for (const tr of [ja, en]) {
    const drafts = [tr('toRule.draft'), tr('mnext2.fixDraft'), tr('mnext2.addDraft')];
    assert.equal(new Set(drafts).size, 3, drafts.join(' | '));
  }
  // What is pressed says the result: no "rule" / "knob" (the other "rule" words wait for the call on the word).
  for (const k of ['mnext2.toNumbers', 'mnext2.toNumbersMenu', 'mnext2.toNumbersSub', 'mnext2.fix', 'mnext2.fixSub', 'mnext2.add', 'mnext2.addSub', 'mnext2.line',
    'mnext2.made', 'mnext2.changed', 'mnext2.save', 'mnext2.rec', 'mnext2.recEnd', 'mnext2.elsewhere', 'tl.askMenuTip']) {
    assert.doesNotMatch(ja(k, { what: ja('mnext2.toNumbers'), name: 'x', save: '保存', dot: '●' }), /ルール|つまみ|コード/, `ja ${k}`);
    assert.doesNotMatch(en(k, { what: en('mnext2.toNumbers'), name: 'x', save: 'Save', dot: '●' }), /\brule\b|\bknob|\bcode\b/i, `en ${k}`);
  }
});
