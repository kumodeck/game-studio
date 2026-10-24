// studio-hand-marks (2026-10-24; the hand-marks plan) without a browser. A play-test note of that day on v0.1.53: "I can't tell which ones I placed by hand; nothing happens when one
// leaves its rule; rule / row / manual / hand name one thing; the orange frame looks like a warning; I can't put them all
// back". What is pinned here:
//   - the game page spreads a ring only for a pin it did not have (not the file's first ones, not a layout converted to
//     coordinates)
//   - "All back to rule": every pin of the layout off, one ⌘Z, one Save count, told with how many
//   - the guide sends the whole draft's places with nothing picked (the small hand tags), none when not editing, and
//     lights the ones placed by hand the mouse is on
//   - two words: "rule" and "placed by hand" — the retired ones gone from what the rule's and the hand's strings say
//
//   node --experimental-strip-types --no-warnings --test test/hand-marks.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { freshPins, PLACE_WORDS } from '../src/bridge/code-place.ts';
import { createCodePlaceWire } from '../src/shell/code-place-wire.ts';
import { PlacementModel } from '../src/shell/placement-model.ts';
import { UndoStack } from '../src/shell/undo.ts';
import { translate } from '../src/shell/i18n.ts';
import type { CodePlaceInfo, Item, PlacementPlace, ShellToBridge } from '../src/contract.ts';

test('the ring spreads only for a pin the page did not have', () => {
  const was: Record<string, PlacementPlace> = { crystal: { pins: { 'crystal-2': { p: [1, 0, 1] } } } };
  assert.deepEqual(freshPins(was, { crystal: { pins: { 'crystal-2': { p: [2, 0, 1] }, 'crystal-7': { p: [0, 0, 0] } } } }), ['crystal-7'], 'a moved pin is not new');
  assert.deepEqual(freshPins(was, {}), [], 'pins taken off: nothing spreads');
  assert.deepEqual(freshPins({}, { crystal: { hand: true, pins: { 'crystal-1': { p: [0, 0, 0] } } } }), [], 'converted to coordinates: not "placed by hand"');
  assert.deepEqual(freshPins({ crystal: { hand: true, pins: { 'crystal-1': { p: [0, 0, 0] } } } }, { crystal: { pins: { 'crystal-1': { p: [0, 0, 0] } } } }), ['crystal-1'], 'back from coordinates with a pin kept: it is placed by hand now');
});

/** The shell's end of twelve crystals scattered by a rule (the CRYSTAL FIELD of the play test), with what it tells and sends. */
function shell(picked: string | null = 'crystal-1', editing = true) {
  const model = new PlacementModel();
  const undo = new UndoStack();
  const sent: ShellToBridge[] = [];
  const told: Array<{ text: string; undo: boolean; hand: boolean }> = [];
  const lit: Array<string[] | null> = [];
  const keys = Array.from({ length: 12 }, (_, i) => `crystal-${i + 1}`);
  const info: CodePlaceInfo = { id: 'crystal', name: 'crystal', keys, skipped: [], knobs: { n: { v: 12, label: 'Count', unit: '', step: 1 } }, avoid: [], kind: 'scatter' };
  const items: Item[] = keys.map((k, i) => ({ key: k, label: `crystal ${i + 1}`, kinds: ['mesh'], pose: { p: [i, 1.1, -i] }, movable: true, rotatable: true, scalable: true } as unknown as Item));
  model.restore(null);
  model.setItems(items, '3d');
  const commit = (id: string, from: PlacementPlace | null, to: PlacementPlace | null) => {
    model.places.set(id, to);
    undo.push({ changes: [{ kind: 'code-place', key: id, from, to: model.places.get(id) }] });
  };
  let hoverKeys: string[] = [];
  const w = createCodePlaceWire({
    t: (k, v) => translate('ja', k, { ai: 'Claude', ...v }), list: () => [info], store: () => model.places, codePoses: (p) => model.codePoses(p), pose: (k) => model.pose(k), dim: () => '3d',
    send: (m) => sent.push(m), commit, changed: () => {}, selected: () => picked, group: () => [], editing: () => editing,
    told: (text, _a, u = true, hand = false) => told.push({ text, undo: u, hand }),
    name: (k) => items.find((i) => i.key === k)?.label ?? k, light: (ks) => lit.push(ks),
  });
  const hover = (ks: string[]) => ((hoverKeys = ks), w.hover(ks));
  void hoverKeys;
  return { model, undo, w, sent, told, lit, hover };
}

test('"All back to rule": every pin of the layout off in one ⌘Z, told with how many; none = nothing', () => {
  const s = shell();
  s.w.moved('crystal-3', { p: [9, 1.1, 2] }, true, true, 'move');
  s.w.moved('crystal-8', { p: [-9, 1.1, 2] }, true, true, 'move');
  assert.deepEqual(s.w.handKeys('crystal'), ['crystal-3', 'crystal-8']);
  assert.equal(s.told.at(-1)!.text, 'crystal 8 を手で置きました（ほかはルールのまま）');
  assert.equal(s.told.at(-1)!.hand, true, 'the hand\'s line (sand, the hand, the undo key last)');
  // Saved with the two (Save · 0), then all of them back: one change to save.
  s.model.places.markSaved();
  const n = s.undo.size;
  assert.equal(s.w.unpinAll('crystal'), true);
  assert.equal(s.model.places.get('crystal'), null, 'no pins left (and no empty entry)');
  assert.equal(s.undo.size, n + 1, 'one ⌘Z');
  assert.deepEqual(s.model.places.changedIds(), ['crystal'], 'one Save count');
  assert.equal(s.told.at(-1)!.text, 'crystalの手で置いた物 2 個を元の位置に戻しました');
  assert.equal(s.told.at(-1)!.hand, false);
  assert.equal(s.w.unpinAll('crystal'), false, 'none placed by hand: nothing to do');
  assert.equal(s.undo.size, n + 1);
  assert.deepEqual(s.w.handKeys('crystal'), []);
});

test('the guide: the whole draft\'s places with nothing picked (the small hand tags), none when not editing; lit = the hand ones the mouse is on', () => {
  const s = shell(null);
  s.w.moved('crystal-3', { p: [9, 1.1, 2] }, true, true, 'move');
  s.w.guide(true);
  const g = s.sent.filter((m) => m.type === 'studio:place/guide').at(-1) as Extract<ShellToBridge, { type: 'studio:place/guide' }>;
  assert.deepEqual(g.ids, [], 'nothing picked: no layout\'s rings');
  assert.deepEqual(Object.keys(g.places?.crystal?.pins ?? {}), ['crystal-3'], 'but the pins, for the small hand tags');
  s.hover(['crystal-3', 'crystal-4']);
  const h = s.sent.filter((m) => m.type === 'studio:place/guide').at(-1) as Extract<ShellToBridge, { type: 'studio:place/guide' }>;
  assert.deepEqual(h.lit, ['crystal-3'], 'only the one placed by hand is lit');
  const off = shell(null, false);
  off.w.moved('crystal-3', { p: [9, 1.1, 2] }, true, true, 'move');
  off.w.guide(true);
  for (const m of off.sent.filter((x) => x.type === 'studio:place/guide')) assert.equal('places' in m, false, 'not editing: no places (the page keeps its own)');
});

test('the list: the hand one\'s tag and its way back; "Back to rule" from the list is one ⌘Z', () => {
  const s = shell();
  s.w.moved('crystal-5', { p: [9, 1.1, 2] }, true, true, 'move');
  const tag = s.w.listTag('crystal-5')!;
  assert.equal(tag.tag, 'ルール');
  assert.equal(tag.hand?.tag, '手で置いた');
  assert.equal(tag.hand?.reset, '元の位置に戻す');
  assert.equal(s.w.listTag('crystal-6')!.hand, undefined);
  tag.hand!.run();
  assert.deepEqual(s.w.handKeys('crystal'), []);
});

// The play test's 3: "rule", "row", "manual", "hand" named one thing. Two words now (the hand-marks plan §6).
const I18N = readFileSync(new URL('../src/shell/i18n.ts', import.meta.url), 'utf8');
const keysIn = (part: string) => [...part.matchAll(/^\s*'([\w.-]+)': ['"`]/gm)].map((m) => m[1]!);
const ruleKeys = keysIn(I18N.slice(I18N.indexOf('const en = {'), I18N.indexOf('type Key'))).filter((k) => /^(rule\.|keepout\.|hands\.place\.)/.test(k));
const vars = { ai: 'Claude', Ai: 'Claude', obj: 'crystal 9', name: 'crystal', what: 'x', n: 2, all: 12, key: '⌘Z', gap: '0.6 m', kind: 'x', v: '4 m', knob: 'Gap', draft: 'x', min: 1, max: 2, g: 1, a: 15 };

test('two words: "rule" and "placed by hand" — the retired ones are gone from the rule\'s and the hand\'s strings', () => {
  assert.ok(ruleKeys.length > 60, `${ruleKeys.length} strings`);
  for (const k of ruleKeys) {
    assert.doesNotMatch(translate('ja', k, vars), /手置き|手動|並べ方|並び/, `ja ${k}`);
    assert.doesNotMatch(translate('en', k, vars), /Hand-placed|Manually|Reset to rule|manual position/i, `en ${k}`);
  }
  for (const lang of ['ja', 'en'] as const) {
    const w = PLACE_WORDS[lang];
    const all = [w.head('crystal', 12), w.pinned('crystal'), w.hand, ...Object.values(w.fixed)].join(' / ');
    assert.doesNotMatch(all, /手置き|並び|Hand-placed/, `the game page's words (${lang})`);
  }
  // The table of the hand-marks plan §6.
  assert.equal(translate('ja', 'rule.reset'), '元の位置に戻す');
  assert.equal(translate('ja', 'rule.handTag'), '手で置いた');
  assert.equal(translate('ja', 'rule.hands', { n: 2 }), '手で置いた物 2 個');
  assert.equal(translate('ja', 'rule.handsAll'), '全部元の位置に戻す');
  assert.equal(translate('ja', 'rule.layout'), 'ルール');
  assert.equal(translate('ja', 'keepout.hand'), '手で描いた');
  assert.equal(translate('ja', 'rule.pinnedDone', { obj: 'クリスタル 9' }), 'クリスタル 9 を手で置きました（ほかはルールのまま）');
  assert.equal(translate('en', 'rule.reset'), 'Revert');
  assert.equal(translate('en', 'rule.handTag'), 'By hand');
  assert.equal(translate('en', 'rule.hands', { n: 2 }), '2 placed by hand');
  assert.equal(translate('en', 'rule.handsAll'), 'Revert all');
  assert.equal(translate('en', 'keepout.hand'), 'Drawn by hand');
  assert.equal(translate('en', 'rule.handsDone', { n: 1, name: 'crystal' }), 'Reverted 1 object of crystal placed by hand');
  assert.equal(translate('en', 'rule.handsDone', { n: 2, name: 'crystal' }), 'Reverted all 2 objects of crystal placed by hand');
});

test('colour: sand for the hand in both themes; the hand\'s state is never orange (orange = the pick and Save)', () => {
  const css = readFileSync(new URL('../src/shell/shell.css', import.meta.url), 'utf8');
  assert.match(css, /--studio-hand: #d8bf8f; --studio-hand-text: #ead6b0; --studio-hand-soft: rgba\(216, 191, 143, \.13\);/);
  assert.equal((css.match(/--studio-hand: /g) ?? []).length, 2, 'dark and light');
  for (const sel of ['.rule-pinned {', '.hand-tag {', '.toast.hand {', '.rule-hands-n {']) {
    const rule = css.slice(css.indexOf(sel), css.indexOf('}', css.indexOf(sel)));
    assert.doesNotMatch(rule, /--you|#ff6b1a|255, 107, 26/, sel);
  }
  assert.doesNotMatch(css, /\.card:has\(\.rule-pinned\) \.f-cells \.num input \{ color: var\(--you-text\)/, 'the numbers stay white');
});
