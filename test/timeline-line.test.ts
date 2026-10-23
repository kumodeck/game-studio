// The timeline's line, readable (studio-ui-lead, 2026-10-23). A hands-on try of v0.1.26 at 1800 px: "not one thing on the
// timeline's line is readable" — ▶ 0:00.0 / 1.0 s ● Auto key [Mo… ▾] [✓ "Blue…" attached] When does it move? [Custom ▾] ▷
// Point [Sm… ▾] Keys [Ea… ▾] ⋯. Without a browser (the real line: test/studio-timeline-line.browser.mjs):
//   1. the words: the picked keys' row says what it is and what each menu does, in both languages — no "Point" / "Keys"
//      (nor their Japanese) as a label; "✓ attached" and "moves from 0 s to {t} s" are gone;
//   2. the line's CSS: nothing on it shrinks to "…" (no ellipsis, no px cap on its menus), it wraps instead;
//   3. the plate's code: the line draws no motion menu, no Point / Keys, no "attached" chip; the motion's menu is in ⋯;
//      the picked keys' row has the ease, the path point and Delete;
//   4. the wire: the Delete button removes the picked keys as the Delete key does (one undo step).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MotionLibrary } from '../src/shell/motion-library.ts';
import { MotionStore } from '../src/shell/motion-model.ts';
import { UndoStack } from '../src/shell/undo.ts';
import { createTimeline } from '../src/shell/timeline-wire.ts';
import type { TimelineActs, TimelineView } from '../src/shell/timeline-panel.ts';
import { translate } from '../src/shell/i18n.ts';
import type { Pose } from '../src/contract.ts';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../src/shell');
const read = (f: string) => readFileSync(join(SRC, f), 'utf8');
/** A source without its comments (the words of a design note are not the words on screen). */
const code = (f: string) => read(f).split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
/** The part of a source between two markers. */
const between = (s: string, from: string, to: string) => s.slice(s.indexOf(from), s.indexOf(to, s.indexOf(from)));

// ----- 1. the words -----
test('the picked keys\' row and the line say what they are, in both languages; the maker\'s chips are gone', () => {
  for (const lang of ['en', 'ja'] as const) {
    const t = (k: string, v?: Record<string, string | number>) => translate(lang, k, v);
    // The row: "Keys picked · 2", then a label for each menu that says what it does.
    assert.match(t('tl.sel', { n: 2 }), /2/);
    assert.notEqual(t('tl.sel', { n: 2 }), 'tl.sel');
    assert.ok(!['Keys', 'キー', 'Point', '点'].includes(t('tl.ease')) && !['Keys', 'キー', 'Point', '点'].includes(t('tl.point')), `${lang}: labels that say something (${t('tl.ease')} / ${t('tl.point')})`);
    for (const k of ['tl.ease.ease', 'tl.ease.linear', 'tl.ease.step', 'tl.point.smooth', 'tl.point.corner', 'tl.point.custom', 'tl.sel.delete', 'tl.sel.deleteTip', 'tl.whenAsk', 'tl.clip', 'tl.moreTip']) {
      assert.notEqual(t(k), k, `${lang}: ${k} exists`);
    }
    // Gone: "✓ “Hop” attached" (the row and the card say the name) and "{name} moves from 0 s to {t} s" (after Done the
    // line asks "When does it move?"). The making step stays.
    assert.equal(t('tl.attached'), 'tl.attached', `${lang}: tl.attached is gone`);
    assert.equal(t('tl.made'), 'tl.made', `${lang}: tl.made is gone`);
    assert.notEqual(t('tl.made.more'), 'tl.made.more');
  }
  // The words themselves (to be read by Gemini: the report lists them).
  assert.equal(translate('ja', 'tl.ease'), '次のキーまで');
  assert.equal(translate('ja', 'tl.ease.ease'), 'ゆっくり出て、ゆっくり着く');
  assert.equal(translate('ja', 'tl.point'), '道の曲がり方');
  assert.equal(translate('ja', 'tl.point.smooth'), 'なめらかに');
  assert.equal(translate('ja', 'tl.sel', { n: 1 }), '選んだキー · 1');
  assert.equal(translate('en', 'tl.ease'), 'To the next key');
  assert.equal(translate('en', 'tl.ease.ease'), 'Eases in and out');
  assert.equal(translate('en', 'tl.point'), 'Path turns');
  assert.equal(translate('en', 'tl.sel', { n: 1 }), 'Keys picked · 1');
});

// ----- 2. the CSS -----
test('nothing on the line may shrink to "…": no ellipsis and no px cap on the head\'s menus; the line wraps', () => {
  const css = read('shell.css');
  const headRules = css.split('\n').filter((l) => /\.tl-head|\.tl-pick select|\.tl-first|\.tl-made|\.tl-sel/.test(l) && !/^\s*\/\*|\.tl-more /.test(l));
  assert.ok(headRules.length > 5, 'the rules are there');
  for (const l of headRules) {
    assert.doesNotMatch(l, /text-overflow:\s*ellipsis/, `no ellipsis on the line: ${l.trim().slice(0, 80)}`);
    assert.doesNotMatch(l, /\.tl-head[^{]*select[^{]*\{[^}]*max-width:\s*\d+px/, `no px cap on a menu of the line: ${l.trim().slice(0, 80)}`);
  }
  assert.match(css, /\.tl-head \{[^}]*flex-wrap: wrap/, 'the line wraps');
  assert.doesNotMatch(css, /\.timeline:not\(\.narrow\) \.tl-head \{[^}]*nowrap/, 'PC no longer forces one line (the panel measures instead)');
  assert.doesNotMatch(css, /\n\.tl-attached \{/, 'the "attached" chip\'s rule is gone');
  // The picked keys' row and its parts exist, and a label wraps together with its menu.
  assert.match(css, /\.tl-sel \{[^}]*flex-wrap: wrap/);
  assert.match(css, /\.tl-sel-group \{[^}]*white-space: nowrap/);
  // Only in ⋯ may a (very long) motion name end in "…".
  assert.match(css, /\.tl-more \.tl-pick select \{[^}]*text-overflow: ellipsis/);
});

// ----- 3. the plate's code -----
test('the line is ▶ · time · ● · when · ⋯ ✦ ⌄; the motion menu is in ⋯; Point / Keys / Delete are the picked keys\' row', () => {
  const panel = code('timeline-panel.ts');
  const head = between(panel, 'function renderHead(', 'const field = ');
  for (const part of ['tl-clip', 'tl-point', 'tl-ease', 'tl-attached', 'tl-scene']) assert.ok(!head.includes(`'${part}'`), `renderHead draws no ${part}`);
  assert.ok(head.includes('whenItems(v)') && head.includes("'tl-more'") && head.includes("'tl-ask'") && head.includes("'tl-fold'"), 'the line: when, ⋯, ✦, ⌄');
  const when = between(panel, 'function whenItems(', 'function renderMore(');
  assert.ok(!when.includes('tl-attached') && !when.includes("'tl.attached'") && !when.includes("'tl.made'"), 'no "✓ attached" / "✓ moves from" chip');
  assert.ok(when.includes("t('tl.whenAsk')") && when.includes("'tl-made'") && when.includes("'tl-done'"), '"When does it move?" always; the making step with Done');
  const more = between(panel, 'function renderMore(', 'function fresh(');
  assert.ok(more.includes('clipMenu(v)') && more.includes("'tl-more-clip'"), '⋯ has the motion menu first');
  const sel = between(panel, 'function renderSel(', 'function clipMenu(');
  for (const part of ['tl-sel-n', 'tl-ease', 'tl-point', 'tl-sel-del']) assert.ok(sel.includes(`'${part}'`), `the picked keys' row has ${part}`);
  assert.ok(sel.includes('act.deleteKeys'), 'Delete is the wire\'s deleteKeys');
  // The row's "when" chip only with every motion shown (the line says the picked one's).
  assert.match(panel, /!rw \|\| tightNow \|\| v\.scene \|\| !v\.all\) return null/);
  // The line is measured: wrapped (⌄ below ▶) = the narrow order.
  assert.match(panel, /fold\(\)\.offsetTop > play\(\)\.offsetTop/);
});

// ----- 4. the wire: Delete as a button -----
function rig() {
  const places: Record<string, Pose> = { crate: { p: [0, 0, 0], r: 0, s: 1 } };
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
  return { tl, undo, acts: () => acts, view: () => view() };
}
const at = (x: number): Pose => ({ p: [x, 0, 0], r: 0, s: 1 });

test('the picked keys\' Delete button removes them as the Delete key does, in one undo step', () => {
  const r = rig();
  r.tl.setOpen(true);
  r.tl.setTime(2);
  r.tl.moved('crate', at(3), true, at(0));
  assert.deepEqual(r.tl.motionOf('crate')!.clips![0]!.keys.p!.map((k) => k.t), [0, 2]);
  r.acts().pickKeys([{ key: 'crate', ch: 'p', t: 2 }], false);
  assert.equal(r.view().ease, 'ease', 'the picked key\'s ease (the row shows while keys are picked)');
  assert.equal(typeof r.acts().deleteKeys, 'function', 'the wire gives the button');
  const steps = r.undo.size;
  r.acts().deleteKeys!();
  assert.deepEqual(r.tl.motionOf('crate')!.clips![0]!.keys.p!.map((k) => k.t), [0], 'the 2 s key is gone');
  assert.equal(r.view().ease, null, 'nothing picked: the row goes');
  assert.equal(r.undo.size, steps + 1, 'one undo step');
});
