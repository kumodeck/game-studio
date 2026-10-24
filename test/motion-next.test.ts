// What to press after making a motion (studio-motion-next, 2026-10-24; a hands-on review: "after making a motion there are three things to press — ✦ Ask Claude, the box, Save — and I
// can't tell which is right"). Without a browser:
//   1. the next step: Done (or Esc) after making, or ● Rec motion turned off with a motion → the plate's next-step line
//      names the motion; it goes on Save, another object, making again, ● Rec motion on, ✦ Turn into a rule;
//   2. ✦ Turn into a rule on the line: a motion of points (two or more places) — not with one point, not without an AI;
//      pressed, it asks as the card's ✦ Turn into a rule… does (the motion's chip, the draft);
//   3. ✦ Ask AI is a menu: Turn this motion into a rule / Make a new motion for me / Ask anything — each a draft only;
//   4. the words: "rule" (never "knob" on screen), "Save puts it in the game", and the receipt after the AI has it in.
// On screen (both languages, dark): test/studio-motion-next.browser.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MotionLibrary } from '../src/shell/motion-library.ts';
import { MotionStore } from '../src/shell/motion-model.ts';
import { UndoStack } from '../src/shell/undo.ts';
import { createTimeline } from '../src/shell/timeline-wire.ts';
import type { TimelineActs, TimelineView } from '../src/shell/timeline-panel.ts';
import type { MenuEntry, MenuItem } from '../src/shell/context-menu.ts';
import { translate } from '../src/shell/i18n.ts';
import { receipt } from '../src/shell/save-receipt.ts';
import type { Pose } from '../src/contract.ts';

function rig(ai = true) {
  const places: Record<string, Pose> = { lamp: { p: [0, 0, 0], r: 0, s: 1 }, crate: { p: [5, 0, 0], r: 0, s: 1 } };
  const store = new MotionStore();
  const lib = new MotionLibrary();
  store.lib = lib;
  let picked: string | null = 'lamp';
  let acts!: TimelineActs;
  let view!: () => TimelineView;
  const asked: Array<{ key: string; name: string; draft?: string; rule?: boolean }> = [];
  let menu: MenuEntry[] | null = null;
  const stand = { el: { hidden: true } as HTMLElement, render() {}, place() {}, focusStarts() {} };
  const tl = createTimeline({
    store, lib, others: () => [], undo: new UndoStack(), send: () => {}, dim: () => '3d', usable: () => true, picked: () => picked,
    place: (k) => places[k], order: () => Object.keys(places), label: (k) => k, select: (k) => (picked = k), changed: () => {},
    layout: () => {}, numbers: () => {}, narrow: () => false, t: (k) => k,
    ...(ai ? {
      ask: (key: string, m: { name: string }, draft?: string) => void asked.push({ key, name: m.name, ...(draft ? { draft } : {}) }),
      toRule: (key: string, m: { name: string }) => void asked.push({ key, name: m.name, rule: true }),
      menu: (_at: HTMLElement, entries: MenuEntry[]) => void (menu = entries),
    } : {}),
  }, (v, a) => ((view = v), (acts = a), stand as never));
  return { tl, acts: () => acts, view: () => view(), asked, menu: () => menu, pick: (k: string | null) => (picked = k) };
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
/** Make lamp's motion: Make a motion, two moves (0 s, 1 s, 2 s). */
function made(r: ReturnType<typeof rig>) {
  r.tl.make('lamp');
  r.tl.moved('lamp', at(2), true, at(0));
  r.tl.moved('lamp', at(4), true, at(2));
}

test('Done after making: the next step names the motion; Save, another object, making again end it', () => frames(() => {
  const r = rig();
  made(r);
  assert.equal(r.view().next, null, 'not while making (the line is the step then)');
  r.acts().done!();
  const name = r.tl.motionOf('lamp')!.clips![0]!.name;
  assert.deepEqual(r.view().next, { name }, 'Done: "✓ lamp’s motion is made · Save puts it in the game · ✦ …"');
  r.tl.saved();
  assert.equal(r.view().next, null, 'Save: it has done its job');
  // Esc ends making as Done does.
  r.tl.make('lamp');
  r.tl.moved('lamp', at(6), true, at(4));
  assert.equal(r.tl.onKey({ key: 'Escape', ctrl: false, meta: false, shift: false }), true);
  assert.ok(r.view().next, 'Esc after a move: made, so the next step');
  // Another object: gone (and not back when lamp is picked again).
  r.pick('crate');
  r.tl.refresh();
  assert.equal(r.view().next, null);
  r.pick('lamp');
  assert.equal(r.view().next, null);
  // Making again: gone until it is done.
  r.acts().done?.();
  r.tl.make('lamp');
  assert.equal(r.view().next, null);
}));

test('Esc right after "Make a motion" (nothing made): no next step', () => frames(() => {
  const r = rig();
  r.tl.make('lamp');
  r.tl.onKey({ key: 'Escape', ctrl: false, meta: false, shift: false });
  assert.equal(r.view().next, null);
}));

test('● Rec motion off with a motion on the plate: the next step; on again: gone; off with no motion: nothing', () => frames(() => {
  const r = rig();
  made(r);
  r.acts().done!();
  r.tl.saved();
  r.acts().auto(true);
  assert.equal(r.view().next, null);
  r.acts().auto(false);
  assert.ok(r.view().next, 'off = "I am done making it"');
  r.acts().auto(true);
  assert.equal(r.view().next, null, 'on again: making more');
  r.pick('crate');
  r.acts().auto(false);
  assert.equal(r.view().next, null, 'crate has no motion: nothing to say');
  // Off while making: making ends there (the review's "when ● Rec motion is turned off").
  r.pick('lamp');
  r.tl.make('lamp');
  r.tl.moved('lamp', at(6), true, at(4));
  assert.equal(r.view().making, 'more');
  r.acts().auto(false);
  assert.equal(r.view().making, null);
  assert.ok(r.view().next, 'the next step at once');
}));

test('✦ Turn into a rule on the line: a motion of points; pressed, it asks like the card\'s, and the next step goes', () => frames(() => {
  const r = rig();
  r.tl.make('lamp');
  r.tl.moved('lamp', at(2), true, at(0));
  r.acts().done!();
  assert.equal(r.view().canRule, true, 'two places: a rule can be made of it');
  r.acts().toRule!();
  assert.deepEqual(r.asked.at(-1), { key: 'lamp', name: r.tl.motionOf('lamp')!.clips![0]!.name, rule: true });
  assert.equal(r.view().next, null, 'pressed: the next step has done its job');
  // No AI (the web demo): no button, no menu.
  const off = rig(false);
  made(off);
  off.acts().done!();
  assert.equal(off.view().canRule, false);
  assert.equal(off.acts().toRule, undefined);
  assert.equal(off.acts().askMenu, undefined);
}));

test('✦ Ask AI is a menu by what is asked: rule / a new motion / anything — each a draft with this motion\'s chip', () => frames(() => {
  const r = rig();
  made(r);
  r.acts().done!();
  r.acts().askMenu!({} as HTMLElement);
  const rows = (r.menu() ?? []).filter((e): e is MenuItem => 'id' in e);
  assert.deepEqual(rows.map((e) => [e.id, e.label, e.ai]), [['tl-ask-rule', 'tl.askMenu.rule', true], ['tl-ask-new', 'tl.askMenu.new', true], ['tl-ask-free', 'tl.askMenu.free', true]]);
  const name = r.tl.motionOf('lamp')!.clips![0]!.name;
  rows[0]!.run();
  assert.deepEqual(r.asked.at(-1), { key: 'lamp', name, rule: true });
  rows[1]!.run();
  assert.deepEqual(r.asked.at(-1), { key: 'lamp', name, draft: 'tl.askMenu.newDraft' });
  rows[2]!.run();
  assert.deepEqual(r.asked.at(-1), { key: 'lamp', name }, 'anything: the box with the chip, no draft');
}));

test('the words: "rule" and "with numbers" (never "knob"), Save puts it in the game, the receipt names what got in', () => {
  const vars = { ai: 'Claude', Ai: 'Claude', name: '街灯 5 の動き' };
  assert.equal(translate('ja', 'tl.next.made', vars), '街灯 5 の動きができました · 保存するとゲームに入ります');
  assert.equal(translate('ja', 'tl.next.rule'), 'ルールにすると、数字で調整できます');
  assert.equal(translate('en', 'tl.next.made', { name: 'Street lamp 5’s motion' }), 'Street lamp 5’s motion is made · Save puts it in the game');
  assert.equal(translate('ja', 'toRule.place'), 'ルールにする');
  assert.equal(translate('ja', 'tl.askMenu.rule'), 'この動きをルールにする');
  assert.equal(translate('ja', 'tl.askMenu.new'), '新しい動きを作ってもらう');
  assert.equal(translate('ja', 'tl.askMenu.free'), '自由に頼む');
  for (const k of ['tl.next.made', 'tl.next.rule', 'tl.ruleTip', 'tl.askMenuTip', 'tl.askMenu.rule', 'tl.askMenu.new', 'tl.askMenu.free', 'tl.askMenu.newDraft']) {
    assert.doesNotMatch(translate('ja', k, vars), /つまみ|ルール化|コード/, `ja ${k}`);
    assert.doesNotMatch(translate('en', k, vars), /\bknob|\bcode\b/i, `en ${k}`);
  }
  const t = (k: string, v?: Record<string, string | number>) => translate('ja', k, { ...vars, ...v });
  assert.equal(receipt({ phase: 'done', things: [{ kind: 'motion', name: '街灯 5 の動き' }], total: 1, vars, t })?.head, '保存しました: 街灯 5 の動き · ゲームに入りました');
  assert.equal(receipt({ phase: 'working', things: [{ kind: 'motion', name: '街灯 5 の動き' }], total: 1, vars, t })?.head, '保存しました: 街灯 5 の動き', 'pressed: the same first words');
});
