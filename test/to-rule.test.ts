// ✦ Turn into a rule (studio-code-torule, 2026-10-24; the plan's step 4 — need 3: "turn what I placed / moved by hand into
// a close formula") without a browser. What is pinned here:
//   - the editor measures how close the rule came: a known shape is 0, a shifted object is off by just that much (which
//     one), a motion is compared at 64 places a round (which moment), its own repeat included
//   - the comparison is shown only while the swap stands (⌘Z it and it is gone) and is gone on Save
//   - the AI's `--do place.code --replace` / `motion.code --replace`: one ⌘Z, the editor's number in the AI's line and in
//     the person's ("Max deviation: lamp-3 (0.6 m)"), what was replaced handed on for the marks
//   - the request: `intent: 'to-code'` and the motion's points (the shape on screen, saved or not)
//   - the words: "rule", never "code" on screen (chosen on 10/24); the glossary's (Gemini's G7 / G13)
//   node --experimental-strip-types --no-warnings --test test/to-rule.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { MOTION_SAMPLES, RuleCompare, gapText, handPath, motionGap, placeGaps, type HandSpot } from '../src/shell/to-rule.ts';
import { createAiHands, type HandsDeps } from '../src/shell/ai-hands.ts';
import { createCodePlaceWire } from '../src/shell/code-place-wire.ts';
import { PlacementModel } from '../src/shell/placement-model.ts';
import { PlaceStore } from '../src/shell/code-places.ts';
import { UndoStack } from '../src/shell/undo.ts';
import { translate } from '../src/shell/i18n.ts';
import { normalizeRequestInput } from '../src/schema/handoff.mjs';
import type { CodeMotionInfo, CodePlaceInfo, Item, LibraryMotion, MotionKey, PlacementPlace, Pose, ShellToBridge } from '../src/contract.ts';

const unit = (u: string) => translate('en', `hands.unit.${u}`);
/** Six street lamps put by hand along a row 6 m apart, the third 0.6 m off to the side (the plan's picture n3-place). */
const LAMPS: HandSpot[] = [0, 1, 2, 3, 4, 5].map((i) => ({ key: `lamp-${i + 1}`, label: `lamp-${i + 1}`, p: [i === 2 ? -3.6 : -3, 0, -8 - 6 * i], n: i + 1 }));
const row = (n: number) => [-3, 0, -8 - 6 * (n - 1)];

test('a layout: a known shape is 0; the object that is off is named, by just that much; a missing number is not a pair', () => {
  const same = placeGaps(LAMPS.map((x) => ({ ...x, p: row(x.n) })), row);
  assert.equal(same.max!.d, 0);
  const g = placeGaps(LAMPS, row);
  assert.equal(g.max!.key, 'lamp-3');
  assert.equal(g.max!.n, 3);
  assert.ok(Math.abs(g.max!.d - 0.6) < 1e-9);
  assert.deepEqual(g.each.map((d) => Math.round(d! * 10) / 10), [0, 0, 0.6, 0, 0, 0]);
  // Height counts too (the whole distance): a lamp a metre up is as far off as a metre aside.
  assert.equal(placeGaps([{ key: 'a', label: 'a', p: [0, 1, 0], n: 1 }], () => [0, 0, 0]).max!.d, 1);
  // The rule came out with 5 (a keep-out area skipped one): the sixth has no partner, the rest still compared.
  const five = placeGaps(LAMPS, (n) => (n <= 5 ? row(n) : null));
  assert.equal(five.unmatched, 1);
  assert.equal(five.max!.key, 'lamp-3');
  assert.equal(placeGaps([], row).max, null);
});

test('a motion: compared at 64 places of one round of the rule; the moment it is farthest; its own repeat counts', () => {
  // A wave the person made by hand (9 points, a little shaky), against a sine of the same width: the shake is the gap.
  const hand = { len: 2, keys: Array.from({ length: 9 }, (_, i) => ({ t: i / 4, v: [Math.sin((i / 8) * 2 * Math.PI) * 1.5 + (i === 3 ? 0.12 : 0), 0, 0], ease: 'linear' as const })) };
  const wave = (t: number) => [Math.sin((t / 2) * 2 * Math.PI) * 1.5, 0, 0];
  const pts = Array.from({ length: MOTION_SAMPLES + 1 }, (_, i) => ({ t: (2 * i) / MOTION_SAMPLES, v: wave((2 * i) / MOTION_SAMPLES) }));
  const g = motionGap(hand, pts);
  assert.equal(g.was.length, MOTION_SAMPLES + 1);
  // The path goes through the points on a curve (the loader's), so the shake spreads a little round its point (0.75 s).
  assert.ok(Math.abs(g.max!.t - 0.75) <= 2 / MOTION_SAMPLES * 2 + 1e-9, `the shaky point (about 0.75 s): ${g.max!.t}`);
  assert.ok(g.max!.d > 0.11 && g.max!.d < 0.15, `about 0.12 m: ${g.max!.d}`);
  // Back and forth: 2 s there and back is a 4 s round — the rule's second half is compared with the way back.
  const there = { len: 2, repeat: 'pingpong' as const, keys: [{ t: 0, v: [0, 0, 0], ease: 'linear' as const }, { t: 2, v: [2, 0, 0], ease: 'linear' as const }] };
  const tri = Array.from({ length: MOTION_SAMPLES + 1 }, (_, i) => {
    const t = (4 * i) / MOTION_SAMPLES;
    return { t, v: [t <= 2 ? t : 4 - t, 0, 0] };
  });
  assert.ok(motionGap(there, tri).max!.d < 1e-9, 'there and back, the same');
  assert.equal(handPath(there, 4, 4).map((p) => p[0]).join(','), '0,1,2,1,0');
});

test('the gap as people read it: one decimal from 0.1 m, two below; whole pixels in 2D', () => {
  assert.equal(gapText(0.6, '3d', unit), '0.6 m');
  assert.equal(gapText(0.6249, '3d', unit), '0.6 m');
  assert.equal(gapText(0.042, '3d', unit), '0.04 m');
  assert.equal(gapText(2.14, '3d', unit), '2.1 m');
  assert.equal(gapText(12.4, '2d', unit), '12 px');
});

test('the comparison: only while the swap stands (⌘Z → gone, ⌘⇧Z → back), each level its own, gone on Save', () => {
  const c = new RuleCompare();
  c.setPlace('', 'lamp-row', LAMPS);
  const from = LAMPS.map((x) => x.key);
  assert.equal(c.place('', 'lamp-row', from).length, 6);
  assert.deepEqual(c.place('', 'lamp-row', undefined), [], '⌘Z took `from` away: nothing to compare');
  assert.equal(c.place('', 'lamp-row', from).length, 6, '⌘⇧Z: back');
  assert.deepEqual(c.place('night', 'lamp-row', from), [], 'another level: its own');
  c.setMotion('ship の動き', { len: 2, keys: [{ t: 0, v: [0, 0, 0] }, { t: 2, v: [1, 0, 0] }] }, { t: 1, d: 0.1 });
  assert.ok(c.motion('ship の動き', true));
  assert.equal(c.motion('ship の動き', false), null, 'points again (⌘Z): nothing to compare');
  c.rename('ship の動き', '船');
  assert.deepEqual(c.motionGapOf('船'), { t: 1, d: 0.1 });
  c.show = false;
  c.clear();
  assert.equal(c.any(), false, 'Save: gone');
  assert.equal(c.show, true, 'the switch is on again for the next one');
});

// ----- the AI's hands: --replace (shell/ai-hands.ts) -----
const ROW: CodePlaceInfo = { id: 'lamp-row', name: '街灯の列', keys: ['lamp-row-1', 'lamp-row-2', 'lamp-row-3', 'lamp-row-4', 'lamp-row-5', 'lamp-row-6'], skipped: [], avoid: [], drag: 'gap', kind: 'line',
  knobs: { n: { v: 6, label: '本数', unit: '', step: 1 }, gap: { v: 6, label: '間', unit: 'm', min: 2, max: 12 } } };
const WAVE: CodeMotionInfo = { code: 'wave', name: '波', round: 2, knobs: { w: { v: 1.5, label: '幅', unit: 'm' } } };

/** A small editor with six hand-placed lamps and a ship whose motion (its Japanese name) is points; the game lists `lamp-row` / `wave` once read again. */
function editor() {
  const undo = new UndoStack();
  const poses = new Map<string, Pose>(LAMPS.map((x) => [x.key, { p: x.p.slice() }]));
  poses.set('ship', { p: [2, 0.3, -11] });
  const items: Item[] = [...LAMPS.map((x) => x.key), 'ship'].map((key) => ({ key, label: key, kinds: ['mesh'], rotatable: true, scalable: true }) as Item);
  const lib = new Map<string, LibraryMotion>([['ship の動き', { name: 'ship の動き', len: 2, keys: { p: Array.from({ length: 9 }, (_, i) => ({ t: i / 4, v: [Math.sin((i / 8) * 2 * Math.PI) * 1.5 + (i === 3 ? 0.12 : 0), 0, 0], ease: 'linear' as const })) } }]]);
  const store = new PlaceStore();
  let listed = false;
  const lines: string[] = [];
  const swaps: unknown[] = [];
  const d: HandsDeps = {
    t: (k, v) => translate('ja', k, v), ready: () => true, playing: () => false, stopPlay: async () => undefined, toWorld: () => undefined, dim: () => '3d',
    item: (k) => items.find((i) => i.key === k), label: (k) => k, keys: () => items.map((i) => i.key), pose: (k) => poses.get(k), setPose: () => undefined,
    rename: () => true, duplicate: async () => null, remove: () => undefined, ground: async () => false,
    motionOf: () => ({ clips: [{ name: 'ship の動き', use: 'ship の動き', len: 2, keys: {} }] }), rawClips: () => [], lib: (n) => lib.get(n) ?? null, libNames: () => [...lib.keys()], usage: () => 1,
    attach: () => true, detach: () => undefined, deleteLib: () => undefined, renameLib: () => null,
    make: (_k, m, o) => {
      const was = lib.get(m.name) ?? null;
      if (was && !o.replace) return { error: 'taken' };
      lib.set(m.name, m);
      undo.push({ changes: [{ kind: 'motion-lib', key: m.name, from: was, to: m }] });
      return { name: m.name };
    },
    clipSet: () => true, libSet: () => true,
    codeMotions: () => (listed ? [WAVE] : []), codePlaces: () => (listed ? [ROW] : []), codeAvoids: () => [],
    // The AI wrote the rule: the game read again lists it and lays its lamps on the row (6 m apart).
    reloadGame: async () => {
      listed = true;
      ROW.keys.forEach((k, i) => poses.set(k, { p: row(i + 1) }));
      return true;
    },
    place: (id) => store.get(id), placeIds: () => store.ids(),
    setPlace: (id, e) => {
      const from = store.get(id);
      store.set(id, e);
      undo.push({ changes: [{ kind: 'code-place', key: id, from, to: store.get(id) }] });
    },
    ruleSamples: async (code, k, len, per) => (code === 'wave' ? Array.from({ length: per + 1 }, (_, i) => ({ t: (len * i) / per, v: [Math.sin(((len * i) / per / 2) * 2 * Math.PI) * k.w!, 0, 0] })) : null),
    swapped: (x) => void swaps.push(x),
    levels: { active: () => false, current: () => '', ids: () => [], label: () => '', add: async () => null, go: async () => false, rename: () => false, nameNew: () => false },
    save: async () => true, reload: () => undefined, list: () => ({}),
    undoBegin: () => undo.begin(), undoEnd: (w) => !!undo.end(w), done: (w) => void lines.push(w),
  };
  return { d, undo, store, lines, swaps, lib };
}

test('place.code --replace: where the hand lamps stood is read BEFORE the game is read again; the editor\'s measure in both lines; one ⌘Z', async () => {
  const e = editor();
  const r = await createAiHands(e.d).run({ id: '1', by: 'claude', ops: [{ do: 'place.code', id: 'lamp-row', replace: LAMPS.map((x) => x.key) }] });
  assert.ok(r.results[0]!.ok, r.results[0]!.error);
  assert.match(r.results[0]!.said!, /the largest gap is lamp-3 ↔ lamp-row-3, 0\.6 m \(6 of 6 compared\)$/);
  assert.equal(e.lines[0], 'Claude が 6 個をルールの並べ方「街灯の列」にしました（6 個 · 本数 6, 間 6 m）· 最大のずれ: lamp-3（0.6 m）');
  assert.deepEqual(e.store.get('lamp-row'), { from: LAMPS.map((x) => x.key) });
  assert.equal(e.undo.size, 1, 'one ⌘Z brings the hand lamps back');
  const s = e.swaps[0] as { kind: string; id: string; spots: HandSpot[]; gap: { key: string; n: number } };
  assert.equal(s.kind, 'place');
  assert.deepEqual(s.spots.map((x) => [x.key, x.n]), LAMPS.map((x) => [x.key, x.n]));
  assert.deepEqual(s.spots[2]!.p, [-3.6, 0, -20], 'the hand\'s place, not the rule\'s');
  assert.equal(s.gap.key, 'lamp-3');
});

test('motion.code --replace: the points it had are compared with the rule at 64 places; the moment and the gap in both lines', async () => {
  const e = editor();
  const r = await createAiHands(e.d).run({ id: '1', by: 'claude', ops: [{ do: 'motion.code', code: 'wave', name: 'ship の動き', replace: true }] });
  assert.ok(r.results[0]!.ok, r.results[0]!.error);
  assert.match(r.results[0]!.said!, /^turned "ship の動き" into the code motion "ship の動き" \(codeMotion\('wave'\)\); the editor measured how close it is: the largest gap is 0\.1\d? m at 0\.8 s of a 2 s round \(65 places against the 9 points it had\)$/);
  assert.match(e.lines[0]!, /^Claude が「ship の動き」を動きのルールにしました · 最大のずれ 0\.1 m（0\.8 秒）$/);
  assert.equal(e.lib.get('ship の動き')!.code, 'wave', 'the same name, now the rule');
  const s = e.swaps[0] as { kind: string; name: string; hand: { keys: MotionKey[] } };
  assert.equal(s.kind, 'motion');
  assert.equal(s.hand.keys.length, 9);
  assert.equal(e.undo.size, 1);
});

test('the guide: the hand objects a layout replaced go with its rings (orange marks), not when switched off; the card says the largest gap', () => {
  const model = new PlacementModel();
  const info: CodePlaceInfo = { ...ROW };
  const items = [...LAMPS.map((x) => ({ key: x.key, label: x.label, pose: { p: x.p } })), ...ROW.keys.map((k, i) => ({ key: k, label: `街灯 ${i + 1}`, pose: { p: row(i + 1) } }))]
    .map((x) => ({ ...x, kinds: ['mesh'], movable: true, rotatable: true, scalable: true }) as unknown as Item);
  model.restore(null);
  model.setItems(items, '3d');
  model.places.set('lamp-row', { from: LAMPS.map((x) => x.key) });
  const sent: ShellToBridge[] = [];
  let on = true;
  const w = createCodePlaceWire({
    t: (k, v) => translate('ja', k, v), list: () => [info], store: () => model.places, codePoses: (p) => model.codePoses(p), pose: (k) => model.pose(k), dim: () => '3d',
    send: (m) => sent.push(m), commit: () => undefined, changed: () => undefined, told: () => undefined, selected: () => 'lamp-row-3', group: () => [], editing: () => true,
    compare: (id) => (id === 'lamp-row' ? LAMPS : []), compareOn: () => on, setCompareOn: (x) => (on = x),
  });
  w.guide(true);
  const g = sent.at(-1) as Extract<ShellToBridge, { type: 'studio:place/guide' }>;
  assert.deepEqual(g.compare?.['lamp-row']?.was[2], [-3.6, 0, -20]);
  assert.equal(g.compare?.['lamp-row']?.names[2], 'lamp-3');
  on = false;
  w.guide();
  assert.equal((sent.at(-1) as typeof g).compare, undefined, 'switched off: no orange marks');
});

test('the request: intent "to-code" on an ask (dropped elsewhere), a motion\'s points kept for it', () => {
  const ask = normalizeRequestInput({ kind: 'ask', text: '近いルールにして', intent: 'to-code', objects: [{ key: 'lamp-1', pose: { p: [-3, 0, -8] } }],
    motions: [{ name: 'ship の動き', len: 2, on: [{ key: 'ship' }], keys: { p: [{ t: 0, v: [0, 0, 0] }, { t: 1, v: [1.5, 0, 0], ease: 'linear' }, { t: 'x', v: [1] }] } }] });
  assert.ok(ask.ok);
  const v = (ask as { value: Record<string, unknown> }).value as { intent?: string; motions?: Array<{ keys?: { p: unknown[] } }>; objects?: Array<{ pose?: unknown }> };
  assert.equal(v.intent, 'to-code');
  assert.deepEqual(v.motions![0]!.keys, { p: [{ t: 0, v: [0, 0, 0] }, { t: 1, v: [1.5, 0, 0], ease: 'linear' }] }, 'a bad point dropped, never an error');
  assert.deepEqual(v.objects![0]!.pose, { p: [-3, 0, -8] });
  const other = normalizeRequestInput({ kind: 'ask', text: 'x', intent: 'make-it-so' });
  assert.equal((other as { value: { intent?: string } }).value.intent, undefined, 'an unknown intent is left out (the words still go)');
  const name = normalizeRequestInput({ kind: 'name', text: '', intent: 'to-code', objects: [{ key: 'a' }] });
  assert.equal((name as { value: { intent?: string } }).value.intent, undefined, 'only an ask');
});

test('the words: "rule", never "code" on screen; the glossary\'s (chosen on 10/24, Gemini G7 / G13)', () => {
  const vars = { ai: 'Claude', Ai: 'Claude', name: 'lamp', n: 6, what: '6', obj: 'lamp-3', gap: '0.6 m', t: '1.2' };
  for (const k of ['toRule.place', 'toRule.placeTip', 'toRule.motion', 'toRule.draft', 'toRule.compare', 'toRule.compareMotion', 'toRule.compareTip', 'toRule.maxPlace', 'toRule.maxMotion', 'toRule.atTime', 'hands.place.toRule', 'hands.motion.toRule', 'hands.motion.toRuleSame']) {
    assert.doesNotMatch(translate('en', k, vars), /\bcode\b/i, `en ${k}`);
    assert.doesNotMatch(translate('ja', k, vars), /コード/, `ja ${k}`);
  }
  assert.equal(translate('ja', 'toRule.place'), 'ルール化する', 'the ✦ is the spark icon before it');
  assert.equal(translate('ja', 'toRule.motion'), 'ルール化する…');
  assert.equal(translate('en', 'toRule.place'), 'Turn into a rule');
  assert.equal(translate('ja', 'toRule.compare'), '元の配置と比べる');
  assert.equal(translate('en', 'toRule.compare'), 'Compare with original');
  assert.equal(translate('ja', 'toRule.maxPlace', vars), '最大のずれ: lamp-3（0.6 m）');
  assert.equal(translate('en', 'toRule.maxPlace', vars), 'Max deviation: lamp-3 (0.6 m)');
});
