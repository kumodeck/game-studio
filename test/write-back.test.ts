// The code is the truth (studio-writeback, 2026-10-24; a request that day: "Is what the code says then hard-coded again by the
// JSON? The code has to be the truth."): on Save the AI writes a layout's changes into its codePlace / codeAvoid and
// sends `place.code --fold`; the editor takes them out of placement.json without a change of the person's (not on ⌘Z,
// not on Save · n), reads the game again and measures every object against where it stood. Without a browser:
//   node --experimental-strip-types --no-warnings --test test/write-back.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyHandsToFile, handsFoldEntry, readHandsFold, readHandsInput } from '../src/schema/hands.mjs';
import { PlaceStore, gone, mergeBack } from '../src/shell/code-places.ts';
import { UndoStack } from '../src/shell/undo.ts';
import { foldGaps, foldSaid } from '../src/shell/write-back.ts';
import { createAiHands, type HandsDeps } from '../src/shell/ai-hands.ts';
import { translate } from '../src/shell/i18n.ts';
import type { CodePlaceInfo, PlacementPlace, Pose } from '../src/contract.ts';

const ENTRY: PlacementPlace = {
  knobs: { gap: { v: 4, was: 6 } },
  offsets: [{ way: 'side', how: 'same', v: 1 }, { way: 'side', how: 'zigzag', v: 1.5, odd: true }, { way: 'up', how: 'same', v: 0.5 }],
  pins: { 'lamp-row-5': { p: [-7.6, 0, -23] } },
  avoid: [{ box: { p: [-8, 0, -17], size: [3, 2, 5] }, name: 'Box 1' }, { code: 'road', off: true }],
};

test('--fold reads one part, a list or words with commas; anything else is a loud answer', () => {
  assert.deepEqual(readHandsFold('side'), { parts: ['side'] });
  assert.deepEqual(readHandsFold('side, pins'), { parts: ['side', 'pins'] });
  assert.deepEqual(readHandsFold(['offsets', 'pins', 'offsets']), { parts: ['offsets', 'pins'] });
  assert.match(readHandsFold('sideways').error!, /one or more of along, side, up, turn, size, move, offsets, pins, avoid, knobs, from, all/);
  const ok = readHandsInput({ do: 'place.code', id: 'lamp-row', fold: 'side' });
  assert.deepEqual(ok, { ok: true, ops: [{ do: 'place.code', id: 'lamp-row', fold: ['side'] }] });
  const both = readHandsInput({ do: 'place.code', id: 'lamp-row', fold: 'all', replace: ['lamp-1'] });
  assert.equal(both.ok, false);
});

test('a fold takes out only what it names: a way\'s offsets, all offsets, the pins (and hand), the areas, all', () => {
  assert.deepEqual(handsFoldEntry(ENTRY, ['side'])?.offsets, [{ way: 'up', how: 'same', v: 0.5 }]);
  assert.equal(handsFoldEntry(ENTRY, ['offsets'])?.offsets, undefined);
  const p = handsFoldEntry({ ...ENTRY, hand: true }, ['pins'])!;
  assert.equal(p.pins, undefined);
  assert.equal(p.hand, undefined);
  assert.deepEqual(handsFoldEntry(ENTRY, ['offsets', 'pins', 'avoid']), { knobs: { gap: { v: 4, was: 6 } } });
  assert.equal(handsFoldEntry(ENTRY, ['all']), null);
  assert.equal(handsFoldEntry({ offsets: [{ way: 'side', how: 'same', v: 1 }] }, ['side']), null, 'nothing left = no entry');
});

test('no editor open: --fold takes the parts out of placement.json (nothing to measure)', () => {
  const file = { version: 1, tool: 'placement', dim: '3d', space: 'local', objects: {}, places: { 'lamp-row': structuredClone(ENTRY) } };
  const r = applyHandsToFile(file, [{ do: 'place.code', id: 'lamp-row', fold: ['offsets', 'pins', 'avoid', 'knobs'] }], { dim: '3d' });
  assert.equal(r.results[0]!.ok, true);
  assert.equal(r.file.places, undefined, 'the layout\'s entry and `places` are gone');
  assert.match(r.results[0]!.said!, /took the offsets and the objects placed by hand and the keep-out areas and the knobs of codePlace\('lamp-row'\) out of placement\.json — your code has them now/);
  const none = applyHandsToFile(r.file, [{ do: 'place.code', id: 'lamp-row', fold: ['side'] }], { dim: '3d' });
  assert.match(none.results[0]!.said!, /\(the file had none of them\)/);
});

test('PlaceStore.fold: out of the file and of what is saved — no Save count; unfold brings them back (Undo AI change)', () => {
  const st = new PlaceStore();
  st.restore({ 'lamp-row': structuredClone(ENTRY) });
  // The person drags once more after Save: one unsaved change of that layout.
  st.set('lamp-row', { ...structuredClone(ENTRY), offsets: [...ENTRY.offsets!, { way: 'turn', how: 'same', v: 15 }] });
  assert.deepEqual(st.changedIds(), ['lamp-row']);
  const back = st.fold('lamp-row', ['side', 'pins', 'avoid'])!;
  assert.deepEqual(st.get('lamp-row'), { knobs: { gap: { v: 4, was: 6 } }, offsets: [{ way: 'up', how: 'same', v: 0.5 }, { way: 'turn', how: 'same', v: 15 }] });
  assert.deepEqual(st.changedIds(), ['lamp-row'], 'still the one unsaved change (the turn) — the fold is not one');
  assert.deepEqual(back.saved?.offsets, [{ way: 'side', how: 'same', v: 1 }, { way: 'side', how: 'zigzag', v: 1.5, odd: true }]);
  assert.deepEqual(back.saved?.pins, ENTRY.pins);
  assert.equal(st.fold('lamp-row', ['side']), null, 'nothing of it left: null');
  st.unfold('lamp-row', back);
  assert.deepEqual(st.get('lamp-row')!.pins, ENTRY.pins);
  assert.equal(st.get('lamp-row')!.offsets!.length, 4, 'the two rows that left are back, the up and the turn kept');
  assert.deepEqual(st.changedIds(), ['lamp-row']);
  // A fold of everything after a Save: nothing to save.
  const s2 = new PlaceStore();
  s2.restore({ 'lamp-row': structuredClone(ENTRY) });
  s2.fold('lamp-row', ['all']);
  assert.equal(s2.result(), undefined);
  assert.deepEqual(s2.changedIds(), []);
});

test('gone / mergeBack: what left, back in without taking what the layout has now', () => {
  const g = gone(ENTRY, handsFoldEntry(ENTRY, ['side', 'avoid']) as PlacementPlace);
  assert.deepEqual(g, { offsets: ENTRY.offsets!.slice(0, 2), avoid: ENTRY.avoid });
  assert.deepEqual(mergeBack({ pins: { 'lamp-row-5': { p: [0, 0, 0] } } }, { pins: { 'lamp-row-5': { p: [1, 1, 1] }, 'lamp-row-2': { p: [2, 0, 0] } } }).pins,
    { 'lamp-row-5': { p: [0, 0, 0] }, 'lamp-row-2': { p: [2, 0, 0] } }, 'the person\'s pin since wins');
});

test('UndoStack.rebase: a written-back offset leaves the history, so ⌘Z / ⇧⌘Z cannot put it on top of the code\'s', () => {
  const u = new UndoStack();
  u.push({ changes: [{ kind: 'code-place', key: 'lamp-row', from: null, to: { offsets: [{ way: 'side', how: 'same', v: 1 }] } }] });
  u.push({ changes: [{ kind: 'code-place', key: 'lamp-row', from: { offsets: [{ way: 'side', how: 'same', v: 1 }] }, to: { offsets: [{ way: 'side', how: 'same', v: 1 }], knobs: { gap: { v: 4, was: 6 } } } }] });
  u.rebase('lamp-row', (e) => (e ? (handsFoldEntry(e, ['side']) as PlacementPlace | null) : null));
  const last = u.undo()!.changes[0] as { from: PlacementPlace | null; to: PlacementPlace | null };
  assert.equal(last.from, null);
  assert.deepEqual(last.to, { knobs: { gap: { v: 4, was: 6 } } });
  const first = u.undo()!.changes[0] as { from: PlacementPlace | null; to: PlacementPlace | null };
  assert.deepEqual([first.from, first.to], [null, null], 'the drag\'s step changes nothing now (the code holds it)');
});

test('foldGaps: the same look within 1 cm; the farthest off, a turn, a size; one gone, one taken out into its own object', () => {
  const before = [{ key: 'a', label: 'Lamp 1', pose: { p: [0, 0, 0], r: 0, s: 1 } }, { key: 'b', label: 'Lamp 2', pose: { p: [0, 0, 4], r: 0, s: 1 } }];
  const same = foldGaps(before, (k) => ({ a: { p: [0.004, 0, 0], r: 0.001, s: 1.001 }, b: { p: [0, 0, 4.009] } } as Record<string, Pose>)[k], '3d');
  assert.deepEqual(same, { max: null, gone: [] });
  assert.match(foldSaid('lamp-row', same, '3d'), /all within 1 cm — the look is the same/);
  const off = foldGaps(before, (k) => ({ a: { p: [0.4, 0, 0] }, b: { p: [0, 0, 4], r: 0.5 } } as Record<string, Pose>)[k], '3d');
  assert.equal(off.max!.key, 'a');
  assert.equal(off.max!.what, 'p');
  assert.match(foldSaid('lamp-row', off, '3d'), /the farthest off is a, 0\.4 m \(it stood at \[0, 0, 0\], now \[0\.4, 0, 0\]\) — fix codePlace\('lamp-row'\)/);
  const turned = foldGaps(before, (k) => ({ a: { p: [0, 0, 0], r: 0.5 }, b: { p: [0, 0, 4], s: 1.2 } } as Record<string, Pose>)[k], '3d');
  assert.equal(turned.max!.what, 'r', 'a place gap first, then a turn, then a size');
  assert.equal(Math.round(turned.max!.d), 29);
  // b is no longer the rule's, but an object of its own stands where it stood (a pin taken out into its own object).
  const out = foldGaps(before, (k) => (k === 'a' ? { p: [0, 0, 0] } : undefined), '3d', [{ p: [0, 0, 4.002] }]);
  assert.deepEqual(out, { max: null, gone: [] });
  const lost = foldGaps(before, (k) => (k === 'a' ? { p: [0, 0, 0] } : undefined), '3d');
  assert.deepEqual(lost.gone.map((x) => x.key), ['b']);
  assert.match(foldSaid('lamp-row', lost, '3d'), /b is gone/);
  // 2D: a pixel.
  assert.equal(foldGaps([{ key: 'a', label: 'A', pose: { p: [10, 10] } }], () => ({ p: [10.8, 10] }), '2d').max, null);
});

// The editor's end: place.code --fold with stand-ins (a lamp row of two lamps, a store, a game "read again").
const LAMPS: CodePlaceInfo = { id: 'lamp-row', name: '街灯', keys: ['lamp-row-1', 'lamp-row-2'], skipped: [], avoid: [], kind: 'lines',
  knobs: { n: { v: 2, label: '本数', unit: '', step: 1 } } };

function foldEditor(o: { after: Record<string, Pose>; knobs?: CodePlaceInfo['knobs'] }) {
  const store = new PlaceStore();
  store.restore({ 'lamp-row': { offsets: [{ way: 'side', how: 'same', v: 1 }] } });
  const undo = new UndoStack();
  let poses: Record<string, Pose> = { 'lamp-row-1': { p: [-5.5, 0, -8] }, 'lamp-row-2': { p: [5.5, 0, -8] } };
  let info = LAMPS;
  const lines: string[] = [];
  const lit: string[][] = [];
  let reloads = 0;
  const d = {
    t: (k: string, v?: Record<string, string | number>) => translate('ja', k, v),
    ready: () => true, playing: () => false, stopPlay: async () => undefined, toWorld: () => undefined, dim: () => '3d',
    item: (k: string) => (k in poses ? { key: k, label: k, kinds: ['mesh'] } : undefined),
    label: (k: string) => (k === 'lamp-row-1' ? '街灯 1' : k === 'lamp-row-2' ? '街灯 2' : k),
    keys: () => Object.keys(poses),
    pose: (k: string) => poses[k],
    codeMotions: () => [], codeAvoids: () => [],
    codePlaces: () => [info],
    reloadGame: async () => {
      reloads++;
      poses = o.after;
      info = { ...LAMPS, knobs: o.knobs ?? LAMPS.knobs };
      return true;
    },
    place: (id: string) => store.get(id),
    placeIds: () => store.ids(),
    setPlace: () => undefined,
    fold: (id: string, parts: string[]) => {
      const back = store.fold(id, parts);
      if (back) undo.rebase(id, (e) => (e ? (handsFoldEntry(e, parts) as PlacementPlace | null) : null));
      return !!back;
    },
    knobAdded: (_id: string, names: string[]) => void lit.push(names),
    undoBegin: () => undo.begin(),
    undoEnd: (w: string) => !!undo.end(w),
    done: (w: string, can: boolean) => void lines.push(can ? w : `${w} (no undo)`),
  } as unknown as HandsDeps;
  return { d, store, lines, lit, reloads: () => reloads };
}

test('place.code --fold: the offsets leave the file, the game is read again, the same look is said to the AI only', async () => {
  const e = foldEditor({ after: { 'lamp-row-1': { p: [-5.5, 0, -8] }, 'lamp-row-2': { p: [5.505, 0, -8] } } });
  const r = await createAiHands(e.d).run({ id: '1', by: 'claude', ops: [{ do: 'place.code', id: 'lamp-row', fold: 'side' }] });
  assert.ok(r.results[0]!.ok, r.results[0]!.error);
  assert.equal(e.reloads(), 1);
  assert.equal(e.store.get('lamp-row'), null);
  assert.deepEqual(e.store.changedIds(), [], 'no Save count');
  assert.equal(r.results[0]!.said, "read the game again and took the side offsets of codePlace('lamp-row') out of placement.json — your code has them now; the editor measured every object before and after: all within 1 cm — the look is the same");
  assert.deepEqual(e.lines, ['Claude が「街灯」の変更をルールに書き込みました (no undo)'], 'not on ⌘Z: the editor cannot take the code back');
});

test('place.code --fold that came out off: the farthest one in both lines; place.code again after the fix measures against the same before', async () => {
  const e = foldEditor({ after: { 'lamp-row-1': { p: [-4.5, 0, -8] }, 'lamp-row-2': { p: [5.5, 0, -8] } } });
  const hands = createAiHands(e.d);
  const r = await hands.run({ id: '1', by: 'claude', ops: [{ do: 'place.code', id: 'lamp-row', fold: 'side' }] });
  assert.match(r.results[0]!.said!, /the farthest off is lamp-row-1, 1 m \(it stood at \[-5\.5, 0, -8\], now \[-4\.5, 0, -8\]\)/);
  assert.match(e.lines[0]!, /いちばんずれた所: 街灯 1（1 m）/);
  // The AI fixes its rule; the page has it right now.
  (e.d as unknown as { pose: (k: string) => Pose }).pose = (k) => ({ 'lamp-row-1': { p: [-5.5, 0, -8] }, 'lamp-row-2': { p: [5.5, 0, -8] } } as Record<string, Pose>)[k]!;
  const again = await hands.run({ id: '2', by: 'claude', ops: [{ do: 'place.code', id: 'lamp-row' }] });
  assert.match(again.results[0]!.said!, /all within 1 cm — the look is the same/);
  assert.equal(e.lines.at(-1), 'Claude が「街灯」の変更をルールに書き込みました (no undo)');
});

test('✦ Write into the rule: the knob the AI added lights on the card and the line names it', async () => {
  const e = foldEditor({ after: { 'lamp-row-1': { p: [-5.5, 0, -8] }, 'lamp-row-2': { p: [5.5, 0, -8] } },
    knobs: { ...LAMPS.knobs, side: { v: 5.5, label: '道からの距離', unit: 'm' } } });
  const r = await createAiHands(e.d).run({ id: '1', by: 'claude', ops: [{ do: 'place.code', id: 'lamp-row', fold: ['side'] }] });
  assert.ok(r.results[0]!.ok);
  assert.deepEqual(e.lit, [['side']]);
  assert.equal(e.lines[0], 'Claude が「街灯」に「道からの距離」を足しました（今は 5.5 m） (no undo)');
});

// The card's side (code-place-wire.ts): ✦ Write into the rule carries the way, the offsets and the ranks; Add jitter /
// Shuffle from the ⋯ (studio-writeback; the third pattern asked for that day, "a little, by a fixed random amount").
import { createCodePlaceWire } from '../src/shell/code-place-wire.ts';
import { PlacementModel } from '../src/shell/placement-model.ts';
import { lastOf, addOffset, jitterRow } from '../src/shell/offset-model.ts';
import type { Item } from '../src/contract.ts';

function card(o: { rows?: boolean } = {}) {
  const model = new PlacementModel();
  const undo = new UndoStack();
  const told: string[] = [];
  const asked: Array<[string, string, string]> = [];
  const info: CodePlaceInfo = { id: 'lamp-row', name: 'Street lamps', keys: ['lamp-row-1', 'lamp-row-2', 'lamp-row-3', 'lamp-row-4'], skipped: [], avoid: [], kind: 'lines',
    knobs: { gap: { v: 6, label: 'Gap', unit: 'm' } }, drag: 'gap',
    ...(o.rows !== false ? { rows: [0, 1, 2, 3].map((i) => ({ line: i % 2, rank: Math.floor(i / 2), along: [0, -1] as [number, number], side: [i % 2 ? 1 : -1, 0] as [number, number], ...(i % 2 ? { mirror: true as const } : {}), offset: [i % 2 ? 1 : -1, 0, 0] })) } : {}) };
  const items = info.keys.map((k, i) => ({ key: k, label: `Street lamps ${i + 1}`, kinds: ['mesh'], pose: { p: [(i % 2 ? 1 : -1) * 6.6, 0, -6 - 6 * Math.floor(i / 2)] }, movable: true, rotatable: true, scalable: true } as unknown as Item));
  model.restore(null);
  model.setItems(items, '3d');
  model.places.restore({ 'lamp-row': { offsets: [{ way: 'side', how: 'same', v: 1 }] } });
  const w = createCodePlaceWire({
    t: (k, v) => translate('en', k, { ai: 'Claude', ...v }), list: () => [info], store: () => model.places, codePoses: (p) => model.codePoses(p), pose: (k) => model.pose(k), dim: () => '3d',
    send: () => {}, changed: () => {}, selected: () => 'lamp-row-3', group: () => [], editing: () => true,
    commit: (id, from, to) => {
      model.places.set(id, to);
      undo.push({ changes: [{ kind: 'code-place', key: id, from, to: model.places.get(id) }] });
    },
    told: (text) => void told.push(text), name: (k) => items.find((i) => i.key === k)?.label ?? k,
    ask: () => {}, askRule: (id, way, draft) => void asked.push([id, way, draft]), seed: () => 4242,
  });
  return { model, undo, w, told, asked, info };
}

test('✦ Write into the rule: the request carries the way, every offset and each object\'s row / rank; the chips say it', () => {
  const c = card();
  const ra = c.w.ruleAsk('lamp-row', 'side')!;
  assert.equal(ra.chip, 'Street lamps (rule)');
  assert.equal(ra.tag, 'Sideways · All the same 1 m');
  assert.deepEqual(ra.place.way, 'side');
  assert.deepEqual(ra.place.offsets, [{ way: 'side', how: 'same', v: 1 }]);
  assert.deepEqual(ra.place.objects![1], { key: 'lamp-row-2', line: 1, rank: 0, offset: [1, 0, 0] });
  assert.equal(c.w.ruleAsk('lamp', 'side'), null);
  assert.equal(translate('ja', 'offset.toKnob'), '数字で調整できるようにする', 'the screen never says つまみ for the rule\'s numbers (studio-words-rule: the result)');
  assert.equal(translate('en', 'offset.toKnob'), 'Make it adjustable with numbers');
  assert.equal(translate('ja', 'offset.draft', { name: '街灯', way: '横' }), '街灯の横のずらしを、数字で調整できるようにして');
});

test('Add jitter from the card\'s ⋯: one ⌘Z, the way\'s own row with its seed, said in a line; not twice, not past eight', () => {
  const c = card();
  const rows = c.w.rows('lamp-row-3');
  assert.deepEqual(rows.map((r) => r.label), ['Add jitter (Sideways)', 'Add jitter (Turn)', 'Add jitter (Size)', 'Convert to coordinates']);
  rows[0]!.run();
  assert.deepEqual(c.model.places.get('lamp-row')!.offsets, [{ way: 'side', how: 'same', v: 1 }, { way: 'side', how: 'jitter', v: 0.3, seed: 4242 }]);
  assert.equal(c.undo.size, 1);
  assert.equal(c.told.at(-1), 'Added Sideways jitter to Street lamps');
  assert.deepEqual(c.w.rows('lamp-row-3').map((r) => r.id), ['rule-jitter-turn', 'rule-jitter-size', 'rule-individually'], 'a way that has one: not offered again');
  // Not a row (a scatter): on the ground instead of sideways.
  const s = card({ rows: false });
  assert.equal(s.w.rows('lamp-row-1')[0]!.label, 'Add jitter (Position)');
  // A drag never turns a jitter row (its number is the card's): the next sideways drag goes into All the same.
  const offs = c.model.places.get('lamp-row')!.offsets!;
  assert.equal(lastOf(offs, 'side')!.how, 'same');
  assert.equal(addOffset(offs, { way: 'side', d: 1 }, 'jitter', 0), null);
  assert.deepEqual(jitterRow('size', true, 3.7), { way: 'size', how: 'jitter', v: 1.1, seed: 3 });
  assert.deepEqual(jitterRow('move', false, 1), { way: 'move', how: 'jitter', v: [12, 12], seed: 1 });
});
