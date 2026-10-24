// studio-code-keepout (2026-10-24): a rule layout's keep-out areas — without a browser. Need 4 of that day:
// "when things are placed procedurally I want to mark where they must not go — sometimes as coordinates, sometimes as
// code". What is pinned here (the plan's step 3, "how to check"):
//   - the list's rows (boxes, then the code's own conditions, then the file's) and what each change writes: off = `{ code,
//     off: true }`, back on = no entry, × = the row out, a knob = `{ v, was }`, a box drawn / moved, "Also for"
//   - the shell: a box drawn is ONE undo step and one Save count, whatever the drag's steps; Esc keeps nothing; the AI's
//     row is lit; the request carries the layout and its areas
//   - the loader with a box: the layout's objects step out, what a hand put (a pin) stays, a place it cannot find is
//     `skipped`
//   - the painting: the cells painted are exactly where the condition's own test says "not here" (a grid on the ground),
//     a shape's edge, the road's edge as two long lines
//   - the words: "rule", never "code"; the words chosen on 10/24 ("+ Draw a box", "✦ Describe with text", in both languages)
//   node --experimental-strip-types --no-warnings --test test/keep-out.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPlacement, codeAvoid, codePlace, relayCodePlace } from '../src/loader/studio-placement.js';
import { addBox, canRemove, changedRows, copyRowTo, knobRow, nextBoxName, removeRow, rowsOf, setBox, switchRow, inBox } from '../src/shell/keep-out-model.ts';
import { boxCorners, edgesOf, outlineOf, runsOf, sampleGrid, shapeOf, MAX_CELLS } from '../src/bridge/keep-out-paint.ts';
import { createKeepOutWire } from '../src/shell/keep-out-wire.ts';
import { PlacementModel } from '../src/shell/placement-model.ts';
import { UndoStack } from '../src/shell/undo.ts';
import { translate } from '../src/shell/i18n.ts';
import type { CodeAvoidInfo, CodePlaceInfo, PlacementPlace } from '../src/contract.ts';

// ----- the list's rows and what each change writes -----

test('the rows: boxes first (in the order drawn), then the code\'s own conditions, then the ones the file added', () => {
  const e: PlacementPlace = { avoid: [{ code: 'near-player' }, { box: { p: [1, 0, 2], size: [2, 3, 2] }, name: 'Box 1' }, { code: 'road', off: true }, { box: { p: [5, 0, 5], size: [1, 1, 1] } }] };
  const rows = rowsOf(['road', 'lava'], e);
  assert.deepEqual(rows.map((r) => (r.kind === 'box' ? `box ${r.n} ${r.name} @${r.i}` : `${r.code} ${r.inCode ? 'code' : 'file'} @${r.i}${r.off ? ' off' : ''}`)),
    ['box 1 Box 1 @1', 'box 2 null @3', 'road code @2 off', 'lava code @-1', 'near-player file @0']);
  assert.deepEqual(rowsOf(['road'], null).map((r) => r.kind === 'code' && r.code), ['road'], 'no file entry: the code\'s own, on');
});

test('off / on: the code\'s own condition off = { code, off: true }; back on with nothing changed = no entry at all', () => {
  const road = rowsOf(['road'], null)[0]!;
  const off = switchRow(null, road, false);
  assert.deepEqual(off, { avoid: [{ code: 'road', off: true }] });
  const on = switchRow(off, rowsOf(['road'], off)[0]!, true);
  assert.deepEqual(on, {}, 'the file keeps only what the person changed');
  // A box off and on keeps its name and place.
  const b = addBox(null, { p: [0, 0, 0], size: [2, 2, 2] }, 'Box 1');
  const bOff = switchRow(b, rowsOf([], b)[0]!, false);
  assert.deepEqual(bOff.avoid, [{ box: { p: [0, 0, 0], size: [2, 2, 2] }, name: 'Box 1', off: true }]);
  assert.deepEqual(switchRow(bOff, rowsOf([], bOff)[0]!, true).avoid, [{ box: { p: [0, 0, 0], size: [2, 2, 2] }, name: 'Box 1' }]);
});

test('×: a box or a condition the file added goes; the code\'s own conditions have no × (they are switched off)', () => {
  const e: PlacementPlace = { avoid: [{ box: { p: [0, 0, 0], size: [1, 1, 1] }, name: 'Box 1' }, { code: 'near-player' }], knobs: { n: { v: 6, was: 12 } } };
  const rows = rowsOf(['road'], e);
  assert.deepEqual(rows.map(canRemove), [true, false, true]);
  assert.deepEqual(removeRow(e, rows[0]!), { avoid: [{ code: 'near-player' }], knobs: { n: { v: 6, was: 12 } } });
  assert.deepEqual(removeRow(e, rows[2]!).avoid, [{ box: { p: [0, 0, 0], size: [1, 1, 1] }, name: 'Box 1' }]);
  assert.deepEqual(removeRow(e, rows[1]!), e, 'the code\'s own: unchanged');
});

test('a condition\'s knob: { v, was } with the code\'s number; back on the code\'s number = no knob (and no entry for the code\'s own)', () => {
  const code = { r: { v: 5, label: 'Distance', unit: 'm' } };
  const added = { avoid: [{ code: 'near-player' }] } as PlacementPlace;
  const six = knobRow(added, rowsOf([], added)[0]!, 'r', 6, code);
  assert.deepEqual(six, { avoid: [{ code: 'near-player', knobs: { r: { v: 6, was: 5 } } }] });
  assert.deepEqual(knobRow(six, rowsOf([], six)[0]!, 'r', 5, code), { avoid: [{ code: 'near-player' }] }, 'added by the file: it stays, without the knob');
  const own = knobRow(null, rowsOf(['near-player'], null)[0]!, 'r', 7, code);
  assert.deepEqual(own, { avoid: [{ code: 'near-player', knobs: { r: { v: 7, was: 5 } } }] });
  assert.deepEqual(knobRow(own, rowsOf(['near-player'], own)[0]!, 'r', 5, code), {}, 'the code\'s own, back on its number: nothing in the file');
});

test('a box drawn, moved; its name the first free "Box n"; "Also for" another layout; the rows the AI changed', () => {
  const name = (n: number) => `Box ${n}`;
  let e = addBox(null, { p: [1, 0, 1], size: [2, 3, 2] }, nextBoxName(null, name));
  e = addBox(e, { p: [4, 0, 4], size: [2, 3, 2] }, nextBoxName(e, name));
  assert.deepEqual(e.avoid?.map((a) => ('name' in a ? a.name : '')), ['Box 1', 'Box 2']);
  const less = removeRow(e, rowsOf([], e)[0]!);
  assert.equal(nextBoxName(less, name), 'Box 1', 'a box taken out leaves its number free');
  assert.deepEqual(setBox(e, 1, { p: [9, 0, 9], size: [1, 3, 1] }).avoid?.[1], { box: { p: [9, 0, 9], size: [1, 3, 1] }, name: 'Box 2' });
  // Also for "coin": the box as it is; a condition the coins' code names already, on: nothing to add.
  const coin = copyRowTo(null, ['road'], rowsOf([], e)[0]!);
  assert.deepEqual(coin, { avoid: [{ box: { p: [1, 0, 1], size: [2, 3, 2] }, name: 'Box 1' }] });
  assert.equal(copyRowTo(coin, ['road'], rowsOf([], coin)[0]!), null, 'the same box twice: no');
  assert.equal(copyRowTo(null, ['road'], rowsOf(['road'], null)[0]!), null);
  assert.deepEqual(copyRowTo(null, [], rowsOf(['near-player'], { avoid: [{ code: 'near-player', knobs: { r: { v: 6, was: 5 } } }] })[0]!), { avoid: [{ code: 'near-player', knobs: { r: { v: 6, was: 5 } } }] });
  // The AI's place.avoid: the row it added (and one it changed) light up; the rest not.
  const before: PlacementPlace = { avoid: [{ box: { p: [1, 0, 1], size: [2, 3, 2] }, name: 'Box 1' }] };
  const after: PlacementPlace = { avoid: [{ box: { p: [1, 0, 1], size: [2, 3, 2] }, name: 'Box 1' }, { code: 'near-player' }] };
  assert.deepEqual(changedRows(['road'], before, after), ['code:near-player']);
});

// ----- the shell: undo steps, Save count, Esc, the request -----

function shell() {
  const model = new PlacementModel();
  const undo = new UndoStack();
  const sent: Array<Record<string, unknown>> = [];
  const told: string[] = [];
  const info: CodePlaceInfo = { id: 'crystal', name: 'crystal', keys: Array.from({ length: 12 }, (_, i) => `crystal-${i + 1}`), skipped: [], knobs: { n: { v: 12, label: 'Count', unit: '', step: 1 } }, avoid: ['road'], kind: 'scatter' };
  const avoids: CodeAvoidInfo[] = [{ code: 'road', name: 'On the road', knobs: {} }, { code: 'near-player', name: 'From the player', after: 'within', knobs: { r: { v: 5, label: 'Distance', unit: 'm', min: 1, max: 20 } }, show: true }];
  model.restore(null);
  model.setItems(info.keys.map((k) => ({ key: k, label: k, kinds: ['mesh'], pose: { p: [0, 1, 0] }, movable: true, rotatable: true, scalable: true }) as never), '3d');
  const commit = (id: string, from: PlacementPlace | null, to: PlacementPlace | null) => {
    model.places.set(id, to);
    undo.push({ changes: [{ kind: 'code-place', key: id, from, to: model.places.get(id) }] });
  };
  const w = createKeepOutWire({
    t: (k, v) => translate('en', k, v), list: () => [info], avoids: () => avoids, store: () => model.places, send: (m) => sent.push(m as never), commit,
    layout: (ids) => sent.push({ type: 'layout', ids }), changed: () => {}, told: (x) => told.push(x), selected: () => 'crystal-1', editing: () => true, menu: () => {},
  });
  const undoOnce = () => {
    const e = undo.undo();
    for (const c of [...(e?.changes ?? [])].reverse()) if (c.kind === 'code-place') model.places.set(c.key, c.from);
  };
  return { model, undo, w, sent, told, undoOnce, info };
}

test('the shell: a box drawn is ONE undo step and one Save count, whatever its steps; its line says how many moved out', () => {
  const s = shell();
  s.w.sync(true);
  assert.deepEqual(s.sent.at(-1), { type: 'studio:place/avoid', id: 'crystal', entry: null, draw: false });
  // Live steps of the drag: no undo step, the draft follows (the card shows "Box 1 (drawing)").
  s.w.box({ id: 'crystal', i: -1, p: [1, 0, 1], size: [1, 3, 1], end: false });
  s.w.box({ id: 'crystal', i: -1, p: [1.5, 0, 1.5], size: [2, 3, 2], end: false });
  assert.equal(s.undo.size, 0);
  assert.equal(s.model.places.get('crystal')?.avoid?.length, 1, 'one box, not one per step');
  s.w.box({ id: 'crystal', i: -1, p: [2, 0, 2], size: [3, 3, 3], end: true, out: 2 });
  assert.equal(s.undo.size, 1);
  assert.deepEqual(s.model.places.get('crystal'), { avoid: [{ box: { p: [2, 0, 2], size: [3, 3, 3] }, name: 'Box 1' }] });
  assert.equal(s.model.dirty(), 1, 'Save · 1');
  assert.equal(s.told.at(-1), 'Added “Box 1” to crystal’s keep-out areas (2 moved out)');
  // Its corner dragged: one more step; ⌘Z twice: nothing in the file.
  s.w.box({ id: 'crystal', i: 0, p: [2, 0, 2], size: [5, 3, 3], end: false });
  s.w.box({ id: 'crystal', i: 0, p: [3, 0, 2], size: [5, 3, 3], end: true });
  assert.equal(s.undo.size, 2);
  assert.deepEqual(s.model.places.get('crystal')?.avoid, [{ box: { p: [3, 0, 2], size: [5, 3, 3] }, name: 'Box 1' }]);
  s.undoOnce();
  s.undoOnce();
  assert.equal(s.model.places.get('crystal'), null);
  assert.equal(s.model.dirty(), 0);
});

test('the shell: Esc in the middle of a box keeps nothing; + Draw a box stops after one box; the ◇ and the card\'s knob', () => {
  const s = shell();
  s.w.box({ id: 'crystal', i: -1, p: [1, 0, 1], size: [1, 3, 1], end: false });
  s.w.box({ id: 'crystal', i: -1, p: [1, 0, 1], size: [1, 3, 1], end: true, cancel: true });
  assert.equal(s.undo.size, 0);
  assert.equal(s.model.places.get('crystal'), null);
  // The AI adds "From the player"; its ◇ dragged 5 → 6: live (laid out each step), then one undo step.
  const before = s.model.places.get('crystal');
  s.model.places.set('crystal', { avoid: [{ code: 'near-player' }] });
  s.w.aiChanged('crystal', before, s.model.places.get('crystal'));
  s.w.knob({ id: 'crystal', code: 'near-player', knob: 'r', v: 5.5, end: false });
  assert.deepEqual(s.sent.at(-1), { type: 'layout', ids: ['crystal'] }, 'the game lays it out with the number as it goes');
  s.w.knob({ id: 'crystal', code: 'near-player', knob: 'r', v: 6, end: true });
  assert.equal(s.undo.size, 1);
  assert.deepEqual(s.model.places.get('crystal'), { avoid: [{ code: 'near-player', knobs: { r: { v: 6, was: 5 } } }] });
  // The request (✦ Describe with text): the layout, its areas as they are, the knob's number now.
  assert.deepEqual(s.w.request('crystal'), {
    id: 'crystal', name: 'crystal', n: 12, knobs: { n: 12 },
    avoid: [{ code: 'road', name: 'On the road' }, { code: 'near-player', name: 'From the player 6 m within', knobs: { r: 6 } }],
  });
  assert.equal(s.w.chip('crystal'), 'crystal ×12');
  // Draw on, a box, off by itself.
  s.w.box({ id: 'crystal', i: -1, p: [1, 0, 1], size: [2, 3, 2], end: true, out: 0 });
  assert.equal(s.w.drawing(), null);
  assert.equal(s.told.at(-1), 'Added “Box 1” to crystal’s keep-out areas');
});

// ----- the loader with a box: out of the box, pins stay, skipped -----

class O3 {
  isObject3D = true;
  userData: Record<string, unknown> = {};
  children: O3[] = [];
  parent: O3 | null = null;
  visible = true;
  position = { x: 0, y: 0, z: 0, set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; } };
  rotation = { x: 0, y: 0, z: 0, set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; } };
  scale = { x: 1, y: 1, z: 1, set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; }, setScalar(v: number) { this.set(v, v, v); } };
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
  for (const k of ['game-studio.codeMotions', 'game-studio.codePlaces', 'game-studio.codeAvoids']) delete (globalThis as Record<symbol, unknown>)[Symbol.for(k)];
};

test('the loader with a box: the layout\'s objects step out of it; one put by hand stays in it; no room left = skipped', async () => {
  clear();
  codePlace('crystal', { name: 'crystal', knobs: {}, count: 12, make: () => new O3('c'), at: (_i: number, _k: unknown, g: { rand(): number }) => ({ p: [-12 + g.rand() * 24, 1.1, 4 - g.rand() * 34] }), avoid: ['road'] });
  codeAvoid('road', { name: 'On the road', test: (p: number[]) => Math.abs(p[0]!) < 5 });
  const scene = new O3();
  await applyPlacement(scene, { version: 1, tool: 'placement', dim: '3d', space: 'local', objects: {} });
  const where = () => scene.children.filter((c) => c.name.startsWith('crystal-')).map((c) => [c.position.x, c.position.y, c.position.z]);
  assert.ok(where().every((q) => Math.abs(q[0]!) >= 5), 'none on the road');
  const box = { p: [where()[0]![0]!, 0, where()[0]![2]!], size: [3, 3, 3] };
  const r = relayCodePlace('crystal', { avoid: [{ box, name: 'Box 1' }], pins: { 'crystal-5': { p: [box.p[0]!, 1.1, box.p[2]!] } } });
  assert.deepEqual(r?.skipped, []);
  const now = where();
  const c5 = scene.children.find((c) => c.name === 'crystal-5')!;
  assert.ok(now.filter((_, i) => i !== 4).every((q) => !inBox(q, box, 3)), 'every rule-placed crystal out of the box');
  assert.deepEqual([c5.position.x, c5.position.z], [box.p[0], box.p[2]], 'the one put by hand stays in it (the hand wins)');
  // A box over (almost) the whole field: most have no place.
  const all = relayCodePlace('crystal', { avoid: [{ box: { p: [0, 0, -14], size: [26, 10, 34] } }] });
  assert.ok(all!.skipped.length > 0 && all!.keys.length + all!.skipped.length === 12, `skipped ${all!.skipped.length}`);
  clear();
});

// ----- the painting: the cells are the condition's own answer -----

test('the painting: every cell painted is where the test says "not here", every other cell not (a grid on the ground)', () => {
  const road = (q: number[]) => Math.abs(q[0]!) < 3.5;
  const g = sampleGrid(road, { a0: -10, a1: 10, b0: -20, b1: 0 }, 0.5, 1, 3);
  assert.equal(g.nx * g.nz, 40 * 40);
  for (let iz = 0; iz < g.nz; iz++) for (let ix = 0; ix < g.nx; ix++) {
    const a = g.a0 + (ix + 0.5) * g.step, b = g.b0 + (iz + 0.5) * g.step;
    assert.equal(!!g.cells[iz * g.nx + ix], road([a, 1, b]), `cell ${ix},${iz}`);
  }
  // One run a row (the road), its edge two long lines (not 0.5 m steps).
  assert.equal(runsOf(g).length, 40);
  const edges = edgesOf(g);
  assert.equal(edges.length, 2);
  assert.deepEqual(edges.map(([u, v]) => [u[0], v[0], v[1] - u[1]]), [[-3.5, -3.5, 20], [3.5, 3.5, 20]]);
  // A test that throws paints nothing; a wide view gets a coarser grid, never more than MAX_CELLS.
  assert.equal(sampleGrid(() => { throw new Error('x'); }, { a0: 0, a1: 4, b0: 0, b1: 4 }, 0.5, 0, 3).cells.reduce((s, v) => s + v, 0), 0);
  const wide = sampleGrid(road, { a0: -500, a1: 500, b0: -500, b1: 500 }, 0.5, 0, 3);
  assert.ok(wide.nx * wide.nz <= MAX_CELLS && wide.step > 0.5);
  // 2D: every 8 px over x and y.
  const g2 = sampleGrid((q) => q[1]! > 100, { a0: 0, a1: 64, b0: 0, b1: 200 }, 8, 0, 2);
  assert.equal(g2.cells[0], 0);
  assert.equal(g2.cells[(g2.nz - 1) * g2.nx], 1);
});

test('a shape (codeAvoid show): circle / box / polygon; its edge; a box\'s floor corners as the loader reads a box', () => {
  assert.deepEqual(shapeOf({ circle: { p: [0, 0, -4], r: 5 } }, 3), { kind: 'circle', p: [0, 0, -4], r: 5 });
  assert.equal(shapeOf({ circle: { p: [0, 0, -4], r: -1 } }, 3), null);
  assert.equal(shapeOf(null, 3), null);
  assert.deepEqual(shapeOf({ poly: [[0, 0], [1, 0], [1, 1]] }, 3)?.kind, 'poly');
  const ring = outlineOf({ kind: 'circle', p: [0, 0, -4], r: 5 }, 3, 0, 48);
  assert.equal(ring.length, 49);
  assert.ok(ring.every((q) => Math.abs(Math.hypot(q[0]!, q[2]! + 4) - 5) < 1e-9));
  const c = boxCorners({ p: [1, 0, 2], size: [2, 3, 4] }, 3);
  assert.deepEqual(c, [[0, 0, 0], [2, 0, 0], [2, 0, 4], [0, 0, 4]]);
  assert.ok(c.every((q) => inBox(q, { p: [1, 0, 2], size: [2, 3, 4] }, 3)), 'the corners are in the box (as the loader reads it)');
  assert.deepEqual(boxCorners({ p: [10, 20], size: [4, 2] }, 2), [[8, 19], [12, 19], [12, 21], [8, 21]]);
});

// ----- the words -----

test('the words: "rule", never "code"; the words chosen on 10/24', () => {
  const vars = { ai: 'Claude', Ai: 'Claude', name: 'crystal', what: 'Box 1', n: 2, all: 12 };
  for (const lang of ['en', 'ja'] as const) {
    for (const k of ['keepout.title', 'keepout.titleTip', 'keepout.draw', 'keepout.drawTip', 'keepout.describe', 'keepout.describeTip', 'keepout.rule', 'keepout.ruleTip', 'keepout.hand', 'keepout.handTip',
      'keepout.added', 'keepout.addedOut', 'keepout.skipped', 'keepout.inside', 'keepout.insideTip', 'keepout.missing', 'keepout.alsoFor', 'keepout.alsoDone', 'keepout.chip', 'keepout.askPh', 'place.boxName']) {
      const s = translate(lang, k, vars);
      assert.doesNotMatch(s, lang === 'en' ? /\bcode\b/i : /コード/, `${lang} ${k}: ${s}`);
      assert.notEqual(s, k, `${lang} ${k} is in the table`);
    }
  }
  assert.equal(translate('ja', 'keepout.title'), '置かない所');
  assert.equal(translate('ja', 'keepout.draw'), '＋ 四角を描く');
  assert.equal(translate('ja', 'keepout.describe'), '✦ 言葉で指定');
  assert.equal(translate('en', 'keepout.draw'), '+ Draw a box');
  assert.equal(translate('en', 'keepout.describe'), '✦ Describe with text');
  assert.equal(translate('ja', 'keepout.skipped', { n: 1, all: 12 }), '12 個のうち 1 個は置ける所がありません');
  assert.equal(translate('en', 'keepout.skipped', { n: 1, all: 12 }), '1 of 12 has no place to go');
  assert.equal(translate('en', 'keepout.skipped', { n: 3, all: 12 }), '3 of 12 have no place to go');
  assert.equal(translate('ja', 'keepout.addedOut', { name: 'crystal', what: '四角 1', n: 2 }), 'crystalの置かない所に「四角 1」を足しました（2 個が外へ）');
  assert.equal(translate('ja', 'keepout.inside'), '置かない所の中です');
});
