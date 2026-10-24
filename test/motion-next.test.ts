// What to press after making a motion (studio-motion-next, 2026-10-24; a hands-on review: "after making a motion there are three things to press — ✦ Ask Claude, the box, Save — and I
// can't tell which is right"). Without a browser:
//   2. ✦ Turn into a rule on the line: a motion of points (two or more places) — not with one point, not without an AI;
//      pressed, it asks as the card's ✦ Turn into a rule… does (the motion's chip, the draft);
//   4. the words: "rule" on the plate's button (never "knob" on screen), and the receipt after the AI has it in.
// (1, the plate's next-step line, and 3, ✦ Ask's menu "rule / a new motion / anything", were replaced by studio-motion-next-2
// — the line over the ask field for as long as a change is not saved, and the menu in the result's words:
// test/motion-next-2.test.ts.)
// On screen (both languages, dark): test/studio-motion-next.browser.mjs, test/studio-motion-next-2.browser.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MotionLibrary } from '../src/shell/motion-library.ts';
import { MotionStore } from '../src/shell/motion-model.ts';
import { UndoStack } from '../src/shell/undo.ts';
import { createTimeline } from '../src/shell/timeline-wire.ts';
import type { TimelineActs, TimelineView } from '../src/shell/timeline-panel.ts';
import type { MenuEntry } from '../src/shell/context-menu.ts';
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

test('✦ Turn into a rule on the line: a motion of points; pressed, it asks like the card\'s', () => frames(() => {
  const r = rig();
  r.tl.make('lamp');
  r.tl.moved('lamp', at(2), true, at(0));
  r.acts().done!();
  assert.equal(r.view().canRule, true, 'two places: a rule can be made of it');
  r.acts().toRule!();
  assert.deepEqual(r.asked.at(-1), { key: 'lamp', name: r.tl.motionOf('lamp')!.clips![0]!.name, rule: true });
  // No AI (the web demo): no button, no menu.
  const off = rig(false);
  made(off);
  off.acts().done!();
  assert.equal(off.view().canRule, false);
  assert.equal(off.acts().toRule, undefined);
  assert.equal(off.acts().askMenu, undefined);
}));

test('the words: "rule" and "as a formula" (never "knob"), the receipt names what got in', () => {
  const vars = { ai: 'Claude', Ai: 'Claude', name: '街灯 5 の動き' };
  assert.equal(translate('ja', 'toRule.place', vars), 'Claudeに式で作り直してもらう');
  // "code" stays off the menu's tip; tl.ruleTip may say "the game's code" (studio-words-formula 10/25: the review's (c) tip says
  // what the AI rewrites — "a formula in the game's code").
  for (const k of ['tl.ruleTip', 'tl.askMenuTip']) {
    assert.doesNotMatch(translate('ja', k, vars), /つまみ|ルール化/, `ja ${k}`);
    assert.doesNotMatch(translate('en', k, vars), /\bknob/i, `en ${k}`);
  }
  assert.doesNotMatch(translate('ja', 'tl.askMenuTip', vars), /コード/);
  assert.doesNotMatch(translate('en', 'tl.askMenuTip', vars), /\bcode\b/i);
  assert.equal(translate('ja', 'tl.ruleTip', vars), 'Claudeがこの動きをゲームのコードの式に書き直します。見た目は同じで、半径や速さなどの欄がカードに出ます（送るのはあなた）');
  const t = (k: string, v?: Record<string, string | number>) => translate('ja', k, { ...vars, ...v });
  assert.equal(receipt({ phase: 'done', things: [{ kind: 'motion', name: '街灯 5 の動き' }], total: 1, vars, t })?.head, '保存しました: 街灯 5 の動き · ゲームに入りました');
  assert.equal(receipt({ phase: 'working', things: [{ kind: 'motion', name: '街灯 5 の動き' }], total: 1, vars, t })?.head, '保存しました: 街灯 5 の動き', 'pressed: the same first words');
});
