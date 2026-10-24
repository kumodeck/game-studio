// studio-code-knobs (2026-10-24): the rule layout's knobs and drag, the rule motion's strip — without a browser.
// WHY: the two needs of that day, "fine-tune a procedural layout or a formula motion by hand and keep it a formula"
// and "fix a hand-placed one by hand, as coordinates". What is pinned here:
//   - the loader lays a layout out again in place (relayCodePlace): the same objects move, a new count makes / takes out
//   - a drag finds the knob: the value that brings the object nearest the finger, the edge where the rule cannot reach
//   - what a layout looks like (a line / a scatter) comes from running its rule
//   - the shell: one knob turn = one undo step and one Save count, a drag of one object with ⌥ = its pin, Place
//     individually (now "Convert to coordinates", studio-to-coords) = hand + every pin, and a layout's objects never
//     become `objects` entries of their own
//   - a rule motion's words come from its knobs, and a knob back on the code's number leaves the file
//   node --experimental-strip-types --no-warnings --test test/code-knobs.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { codeMotion, codePlace, applyPlacement, relayCodePlace, codeSpot } from '../src/loader/studio-placement.js';
import { findKnob, knobRange, dragKnob, knobText, placeNote } from '../src/bridge/code-place.ts';
import { kindOf } from '../src/bridge/code-lists.ts';
import { knobNumber, snapKnob, rangeOf } from '../src/shell/knob.ts';
import { ruleOf, ruleWords, ruleKnobsAfter } from '../src/shell/rule-motion.ts';
import { createCodePlaceWire } from '../src/shell/code-place-wire.ts';
import { PlacementModel } from '../src/shell/placement-model.ts';
import { UndoStack } from '../src/shell/undo.ts';
import { translate } from '../src/shell/i18n.ts';
import type { CodePlaceInfo, Item, PlacementPlace, Pose } from '../src/contract.ts';

// A small stand-in for three.js objects (what the loader touches), as test/code-base.test.mjs.
const v3 = () => ({ x: 0, y: 0, z: 0, set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; } });
class O3 {
  isObject3D = true;
  userData: Record<string, unknown> = {};
  children: O3[] = [];
  parent: O3 | null = null;
  visible = true;
  position = v3();
  rotation = v3();
  scale = { ...v3(), x: 1, y: 1, z: 1, setScalar(s: number) { this.set(s, s, s); } };
  name: string;
  constructor(name = '') {
    this.name = name;
  }
  add(o: O3) {
    o.parent?.remove(o);
    o.parent = this;
    this.children.push(o);
  }
  remove(o: O3) {
    this.children = this.children.filter((c) => c !== o);
    o.parent = null;
  }
}
const clear = () => {
  for (const s of ['game-studio.codeMotions', 'game-studio.codePlaces', 'game-studio.codeAvoids']) delete (globalThis as Record<symbol, unknown>)[Symbol.for(s)];
};
const file3 = (extra = {}) => ({ version: 1, tool: 'placement', dim: '3d', space: 'local', objects: {}, ...extra });
const hexRow = () => codePlace('hex', {
  name: 'hex',
  knobs: { n: { v: 4, label: 'Count', unit: '', min: 1, max: 8, step: 1 }, gap: { v: 6, label: 'Gap', unit: 'm', min: 2, max: 12 } },
  count: (k: Record<string, number>) => k.n,
  make: () => new O3('hex'),
  at: (i: number, k: Record<string, number>) => ({ p: [-2.4 + i * 1.6, 0.95, -4 - i * k.gap!] }),
  drag: 'gap',
});
const zs = (root: O3) => root.children.filter((c) => /^hex-/.test(c.name)).map((c) => Math.round(c.position.z * 100) / 100);

test('the loader lays a layout out again in place: the same objects move; a new count makes / takes out objects', async () => {
  clear();
  hexRow();
  const scene = new O3();
  await applyPlacement(scene, file3());
  const before = scene.children.filter((c) => /^hex-/.test(c.name));
  assert.deepEqual(zs(scene), [-4, -10, -16, -22]);
  const r = relayCodePlace('hex', { knobs: { gap: { v: 4, was: 6 } } });
  assert.deepEqual(r, { keys: ['hex-1', 'hex-2', 'hex-3', 'hex-4'], skipped: [] });
  assert.deepEqual(zs(scene), [-4, -8, -12, -16], 'Gap 4');
  assert.deepEqual(scene.children.filter((c) => /^hex-/.test(c.name)), before, 'the very same objects (no reload, no new ones)');
  // A pin: that one where the hand put it, the rest on the rule.
  relayCodePlace('hex', { knobs: { gap: { v: 4 } }, pins: { 'hex-3': { p: [9, 0, -9] } } });
  assert.deepEqual(zs(scene), [-4, -8, -9, -16]);
  // Count 6: two more made at the end, the four kept; back to 3: one taken out.
  relayCodePlace('hex', { knobs: { n: { v: 6 } } });
  assert.deepEqual(zs(scene), [-4, -10, -16, -22, -28, -34]);
  assert.ok(before.every((o) => scene.children.includes(o)));
  relayCodePlace('hex', { knobs: { n: { v: 3 } } });
  assert.deepEqual(zs(scene), [-4, -10, -16]);
  assert.equal(relayCodePlace('nope', {}), null, 'a layout the game does not have: nothing');
  // The formula's place for any knob value (what a drag searches over).
  assert.deepEqual((codeSpot('hex', 1, { n: 4, gap: 3 }) as number[]).map((v) => Math.round(v * 1000) / 1000), [-0.8, 0.95, -7]);
});

test('a drag finds the knob: the value that brings the object nearest the finger; past the rule, the edge', () => {
  // Number 2 of the row (i = 1): z = -4 - gap. The finger at z = -9 → gap 5.
  const spot = (gap: number) => [-0.8, 0.95, -4 - gap];
  assert.equal(Math.round(findKnob(spot, [-0.8, 0.95, -9], 2, 12)! * 1000) / 1000, 5);
  // Beside the row (x far off): the nearest the rule can bring it is the same z — it stops at the edge, a formula still.
  assert.equal(Math.round(findKnob(spot, [5, 0.95, -9], 2, 12)! * 1000) / 1000, 5);
  // Past the end of the range: the end.
  assert.equal(findKnob(spot, [-0.8, 0.95, -40], 2, 12), 12);
  assert.equal(findKnob(spot, [-0.8, 0.95, 10], 2, 12), 2);
  // A whole-number knob (a count) lands on a whole number.
  const n = (c: number) => [c * 2, 0, 0];
  assert.equal(findKnob(n, [6.7, 0, 0], 1, 8, true), 3);
  // The range of a knob written without one: ten times round it; the drag knob is the layout's own.
  assert.deepEqual(knobRange({ v: 6 }), [0, 66]);
  assert.deepEqual(knobRange({ v: 6, min: 2, max: 12 }), [2, 12]);
  assert.equal(dragKnob({ drag: 'gap', knobs: { gap: { v: 6, label: 'Gap', unit: 'm' } } }), 'gap');
  assert.equal(dragKnob({ drag: { move: 'gap' }, knobs: { gap: { v: 6, label: 'Gap', unit: 'm' } } }), 'gap');
  assert.equal(dragKnob({ drag: 'radius', knobs: { gap: { v: 6, label: 'Gap', unit: 'm' } } }), null, 'a knob it does not have: no knob drag');
  assert.equal(knobText(2.5029), '2.5');
  assert.equal(knobText(3.6, 1), '4');
});

test('what a layout looks like comes from its rule: a line, a scatter (it reads its random), or neither', () => {
  const line = { at: (i: number) => ({ p: [i, 0, -2 * i] }), knobs: {}, spots: [[0, 0, 0], [1, 0, -2], [2, 0, -4], [3, 0, -6]] };
  assert.equal(kindOf(line), 'line');
  const scatter = { at: (_i: number, _k: unknown, g: { rand: () => number }) => ({ p: [g.rand() * 10, 0, g.rand() * 10] }), knobs: {}, spots: [[1, 0, 2], [5, 0, 1], [3, 0, 8]] };
  assert.equal(kindOf(scatter), 'scatter');
  const ring = { at: (i: number) => ({ p: [Math.cos(i), 0, Math.sin(i)] }), knobs: {}, spots: [0, 1, 2, 3].map((i) => [Math.cos(i * 1.5), 0, Math.sin(i * 1.5)]) };
  assert.equal(kindOf(ring), null, 'a ring is not a line: the card says its name');
});

test('the knob part: its numbers, its range, a drag snapped to a hundredth of the range', () => {
  assert.equal(knobNumber(6), '6');
  assert.equal(knobNumber(2.456), '2.46');
  assert.equal(knobNumber(3.4, 1), '3');
  assert.deepEqual(rangeOf({ v: 2, min: 0.2, max: 6 }), [0.2, 6]);
  assert.equal(snapKnob(4.5129, { v: 6, min: 2, max: 12 }), 4.5);
  assert.equal(snapKnob(4.6, { v: 4, step: 1 }), 5);
});

test('a rule motion: its words from its knobs (the file\'s number over the code\'s), a knob back on the code\'s leaves the file', () => {
  clear();
  codeMotion('spiral', { name: 'Spiral', knobs: { radius: { v: 2, label: 'Radius', unit: 'm' }, lap: { v: 4, label: 'Lap', unit: 's' } }, at: () => ({ p: [0, 0, 0] }) });
  const t = (k: string, v?: Record<string, string | number>) => translate('en', k, v);
  const list = [{ code: 'spiral', name: 'Spiral', knobs: { radius: { v: 2, label: 'Radius', unit: 'm' }, lap: { v: 4, label: 'Lap', unit: 's' } }, round: 4, drag: 'radius' }];
  const r = ruleOf({ name: 'Spiral', len: 4, keys: {}, code: 'spiral', knobs: { radius: { v: 3, was: 2 } } }, list)!;
  assert.equal(ruleWords(t, r), 'Spiral · Radius 3 m · Lap 4 s');
  assert.equal(r.drag, 'radius');
  assert.deepEqual(ruleKnobsAfter(r, 'lap', 6), { radius: { v: 3, was: 2 }, lap: { v: 6, was: 4 } });
  assert.deepEqual(ruleKnobsAfter(r, 'radius', 2), null, 'both on the code\'s numbers: no knobs in the file');
  assert.equal(ruleOf({ name: 'Hop', len: 1, keys: {} }, list), null, 'a motion of points is not a rule');
  assert.equal(ruleOf({ name: 'Gone', len: 4, keys: {}, code: 'gone' }, list)!.missing, true, 'the game has no such rule');
  assert.equal(ruleOf({ name: 'Spiral', len: 4, keys: {}, code: 'spiral' }, null)!.loading, true, 'the page has not said yet: the name only');
  const ja = (k: string, v?: Record<string, string | number>) => translate('ja', k, v);
  assert.equal(`${ja('rule.motion')}: ${ruleWords(ja, ruleOf({ name: 'らせん', len: 4, keys: {}, code: 'spiral' }, [{ ...list[0]!, knobs: { radius: { v: 2, label: '半径', unit: 'm' }, lap: { v: 4, label: '1 周', unit: 's' } } }])!)}`,
    '動きのルール: らせん · 半径 2 m · 1 周 4 秒', 'the words chosen on 10/24');
});

/** The shell's end of a layout: the world model, undo, the wire, with the game page's list of one layout. */
function shell() {
  const model = new PlacementModel();
  const undo = new UndoStack();
  const sent: unknown[] = [];
  const told: string[] = [];
  let selected: string | null = 'hex-2';
  const info: CodePlaceInfo = { id: 'hex', name: 'hex', keys: ['hex-1', 'hex-2', 'hex-3', 'hex-4'], skipped: [], knobs: { n: { v: 4, label: 'Count', unit: '', step: 1 }, gap: { v: 6, label: 'Gap', unit: 'm', min: 2, max: 12 } }, drag: 'gap', avoid: [], kind: 'line' };
  const items: Item[] = info.keys.map((k, i) => ({ key: k, label: `hex ${i + 1}`, kinds: ['mesh'], pose: { p: [0, 0.95, -4 - 6 * i] }, movable: true, rotatable: true, scalable: true } as unknown as Item));
  items.push({ key: 'gate', label: 'gate', kinds: ['mesh'], pose: { p: [0, 0, -22] }, movable: true, rotatable: true, scalable: true } as unknown as Item);
  model.restore(null);
  model.setItems(items, '3d');
  const commit = (id: string, from: PlacementPlace | null, to: PlacementPlace | null) => {
    model.places.set(id, to);
    undo.push({ changes: [{ kind: 'code-place', key: id, from, to: model.places.get(id) }] });
  };
  const w = createCodePlaceWire({
    t: (k, v) => translate('en', k, v), list: () => [info], store: () => model.places, codePoses: (p) => model.codePoses(p), pose: (k) => model.pose(k), dim: () => '3d',
    send: (m) => sent.push(m), commit, changed: () => {}, told: (x) => told.push(x), selected: () => selected, group: () => [], editing: () => true,
    name: (k) => items.find((i) => i.key === k)?.label ?? k,
  });
  const undoOnce = () => {
    const e = undo.undo();
    for (const c of [...(e?.changes ?? [])].reverse()) if (c.kind === 'code-place') model.places.set(c.key, c.from);
  };
  return { model, undo, w, sent, told, undoOnce, pick: (k: string | null) => (selected = k) };
}

test('the shell: one knob turn is one undo step and one Save count; a layout\'s objects never become `objects` entries', () => {
  const s = shell();
  // A drag in the game turned Gap: live (no undo), then its end.
  s.w.knob({ id: 'hex', knob: 'gap', v: 5, end: false });
  s.w.knob({ id: 'hex', knob: 'gap', v: 4.5, end: false });
  assert.equal(s.undo.size, 0, 'live: no undo step yet');
  s.w.knob({ id: 'hex', knob: 'gap', v: 4, end: true });
  assert.equal(s.undo.size, 1);
  assert.deepEqual(s.model.places.get('hex'), { knobs: { gap: { v: 4, was: 6 } } });
  // The game laid them out again: where the rule puts them is not a move.
  s.w.poses([{ key: 'hex-2', pose: { p: [0, 0.95, -8] } }, { key: 'hex-3', pose: { p: [0, 0.95, -12] } }]);
  assert.equal(s.model.dirty(), 1, 'Save · 1 (the layout), not 3');
  assert.deepEqual(s.model.result().objects, {}, 'no hexagon in objects');
  assert.deepEqual(s.model.result().places, { hex: { knobs: { gap: { v: 4, was: 6 } } } });
  s.undoOnce();
  assert.equal(s.model.places.get('hex'), null, '⌘Z: the code\'s Gap again (nothing in the file)');
  assert.deepEqual(s.w.savedWords(), []);
  s.w.knob({ id: 'hex', knob: 'gap', v: 4, end: true });
  assert.deepEqual(s.w.savedWords(), ['hex Gap → 4 m'], 'the Save receipt says the rule\'s number');
});

test('the shell: ⌥-drag of one object = its pin (one undo step); Convert to coordinates = hand + every pin; a hand object as before', () => {
  const s = shell();
  assert.equal(s.w.moved('gate', { p: [1, 0, -22] }, true), false, 'a hand-placed object is not a layout\'s: as before');
  assert.equal(s.w.moved('hex-3', { p: [-3, 0.95, -12] }, false, true), true, 'live: taken, no undo');
  assert.equal(s.undo.size, 0);
  s.w.moved('hex-3', { p: [-3.1, 0.95, -12] }, true, true);
  assert.equal(s.undo.size, 1);
  assert.deepEqual(s.model.places.get('hex')?.pins, { 'hex-3': { p: [-3.1, 0.95, -12] } });
  assert.deepEqual(s.model.result().objects, {}, 'the pin is the layout\'s, not an object entry');
  // Place individually (the card's button; its card and words are the browser test's).
  s.pick('hex-1');
  s.w.individually('hex');
  const e = s.model.places.get('hex')!;
  assert.equal(e.hand, true);
  assert.deepEqual(Object.keys(e.pins!).sort(), ['hex-1', 'hex-2', 'hex-3', 'hex-4']);
  assert.equal(s.undo.size, 2);
  assert.match(s.told[0]!, /Placed hex 3 by hand/, 'the ⌥ one was told (studio-to-coords)');
  assert.match(s.told[1]!, /Converted the hex rule to coordinates/);
  assert.deepEqual(s.w.card('hex-2'), { els: [], numbers: true }, 'now an ordinary card (its own numbers)');
  assert.equal(s.w.listTag('hex-2'), null, 'and no Rule tag in the list');
  s.undoOnce();
  s.undoOnce();
  assert.equal(s.model.places.get('hex'), null, '⌘Z ⌘Z: none by hand');
});

test('the screen says "rule", never "code", for a rule motion or layout (the words chosen on 10/24)', async () => {
  const src = (await import('node:fs')).readFileSync(new URL('../src/shell/i18n.ts', import.meta.url), 'utf8');
  const keys = [...new Set([...src.matchAll(/'((?:rule|hands\.motion|hands\.place)\.[\w.%/]+)'/g)].map((m) => m[1]!))];
  assert.ok(keys.length > 30, `the rule words are in i18n.ts (${keys.length})`);
  const vars = { ai: 'Claude', Ai: 'Claude', obj: 'pillar', name: 'Spiral', what: 'Gap 4 m', n: 2, knob: 'Gap', v: '4 m', key: '⌘Z', text: 'x' };
  for (const k of keys) {
    assert.doesNotMatch(translate('en', k, vars), /\bcode\b/i, `en ${k}`);
    assert.doesNotMatch(translate('ja', k, vars), /コード/, `ja ${k}`);
  }
  // studio-to-coords (the request of 10/24): one button, the same words for a rule motion and a rule layout.
  assert.equal(translate('ja', 'rule.points'), '座標にする');
  assert.equal(translate('ja', 'rule.individually'), '座標にする');
  assert.equal(translate('en', 'rule.points'), 'Convert to coordinates');
  assert.equal(translate('en', 'rule.individually'), 'Convert to coordinates');
  assert.equal(translate('ja', 'rule.pointsDone', { name: 'らせん' }), 'らせんのルールを座標にしました');
  // studio-hand-marks (10/24): two words, "rule" and "placed by hand" (it was "Hand-placed" and its Japanese).
  assert.equal(translate('ja', 'rule.handTag'), '手で置いた');
  assert.equal(translate('ja', 'rule.reset'), 'ルールに戻す');
  assert.equal(translate('en', 'rule.missing'), 'No motion rule found');
  assert.equal(translate('ja', 'rule.disableTip'), '一時停止（動きは残る）');
});

test('the line under the strip: the words chosen on 10/24; shorter in a narrow window, no ⌥ with a finger', () => {
  assert.equal(placeNote('ja', '六角形', 4, '間', { narrow: false, touch: false }), '六角形 ×4（ルール）: 動かすと間が変わる · ⌥+ドラッグで 1 個だけ');
  assert.equal(placeNote('en', 'hex', 4, 'Gap', { narrow: false, touch: false }), 'hex ×4 (rule): Drag to adjust Gap · ⌥-drag to move one');
  assert.equal(placeNote('ja', '六角形', 4, '間', { narrow: true, touch: false }), '動かすと間が変わる · ⌥+ドラッグで 1 個だけ');
  assert.equal(placeNote('ja', '六角形', 4, '間', { narrow: true, touch: true }), '動かすと間が変わる');
  // studio-to-coords: no knob for that way = the rule keeps it (never "moving one places it individually" any more).
  assert.equal(placeNote('en', 'crystal', 12, null, { narrow: false, touch: false }), 'crystal ×12 (rule): Position is set by the rule · ⌥-drag to move one');
  assert.equal(placeNote('ja', '街灯', 12, ['間', '道からの距離'], { narrow: true, touch: false }), '動かすと間・道からの距離が変わる · ⌥+ドラッグで 1 個だけ');
  assert.equal(placeNote('ja', '街灯', 12, null, { narrow: true, touch: true, way: 'up' }), '高さはルールで決まっています');
});
