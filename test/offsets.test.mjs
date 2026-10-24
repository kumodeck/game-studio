// studio-offsets (2026-10-24): the loader's offsets — a rule's objects shifted as a rule (CONTRACT.md §1.12 "Offsets",
// §4.1 `places[id].offsets`). WHY: the CRYSTAL FIELD try that day — a lamp of a row dragged away from the road
// "did nothing and said nothing"; the answer is "however you move a rule's object, it stays a rule": every lamp 1 m
// further from the road, every other one, a little more each one — and a lamp the count adds gets it too.
// The lamps are written as CRYSTAL FIELD (and the real AI) write a road's two sides: ONE codePlace, `i % 2` the side.
// Run on the source and on the built loader (the copy games import).
//   node --test test/offsets.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The same stand-in for three.js objects as code-base.test.mjs (position / rotation / scale, children, userData).
const v3 = () => ({ x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } });
class O3 {
  constructor(name = '') {
    this.isObject3D = true;
    this.name = name;
    this.userData = {};
    this.children = [];
    this.parent = null;
    this.visible = true;
    this.position = v3();
    this.rotation = v3();
    this.scale = { ...v3(), x: 1, y: 1, z: 1, setScalar(s) { this.set(s, s, s); } };
  }
  add(o) {
    if (o.parent) o.parent.remove(o);
    o.parent = this;
    this.children.push(o);
  }
  remove(o) {
    this.children = this.children.filter((c) => c !== o);
    o.parent = null;
  }
}
const file3 = (places) => ({ version: 1, tool: 'placement', dim: '3d', space: 'local', objects: {}, ...(places ? { places } : {}) });
// + 0: -0 reads as 0 (deepEqual tells them apart).
const r2 = (v) => Math.round(v * 100) / 100 + 0;
const xs = (scene) => lamps(scene).map((o) => r2(o.position.x));
const lamps = (scene) => Array.from({ length: scene.children.length }, (_, i) => scene.children.find((c) => c.userData.studioKey === `lamp-row-${i + 1}`)).filter(Boolean);
const clear = () => {
  for (const s of ['game-studio.codeMotions', 'game-studio.codePlaces', 'game-studio.codeAvoids']) delete globalThis[Symbol.for(s)];
};
// CRYSTAL FIELD's lamps: Count (each side) and Gap, the distance from the road fixed in the code (5.6 m), `drag: { along: 'gap' }`.
const lampRow = (L, extra = {}) => L.codePlace('lamp-row', {
  name: '街灯',
  knobs: { n: { v: 5, label: '本数', unit: '', min: 1, max: 10, step: 1 }, gap: { v: 6, label: '間', unit: 'm', min: 2, max: 15 } },
  count: (k) => k.n * 2,
  make: () => new O3('lamp'),
  at: (i, k) => ({ p: [(i % 2 ? 1 : -1) * 5.6, 0, -6 - Math.floor(i / 2) * k.gap] }),
  drag: { along: 'gap' },
  ...extra,
});

for (const [name, file] of [['source', 'src/loader/studio-placement.js'], ['built', 'skills/arrange/bin/studio-placement.js']]) {
  const load = () => import(pathToFileURL(path.join(PKG, file)).href);

  test(`offsets (${name}): the frame of a road's two sides — rows, ranks from lamp 1's end, side away from the middle, the second row mirrored`, async () => {
    const L = await load();
    const spots = Array.from({ length: 10 }, (_, i) => [(i % 2 ? 1 : -1) * 5.6, 0, -6 - Math.floor(i / 2) * 6]);
    const f = L.offsetFrame(spots, 3, false);
    assert.ok(f, 'two parallel rows are a row frame');
    assert.deepEqual(f.map((x) => x.l), [0, 1, 0, 1, 0, 1, 0, 1, 0, 1], 'each side its own row (lamp 1 on row 0)');
    assert.deepEqual(f.map((x) => x.r), [0, 0, 1, 1, 2, 2, 3, 3, 4, 4], 'ranks counted along each row, not by number');
    assert.deepEqual(f[0].a.map(r2), [0, -1], 'along: away from lamp 1, into the road');
    assert.deepEqual(f[1].a.map(r2), [0, -1], 'along is the same for both rows (never mirrored)');
    assert.deepEqual(f[0].s.map(r2), [-1, 0], 'left row: side = further left');
    assert.deepEqual(f[1].s.map(r2), [1, 0], 'right row: side = further right (both leave the road)');
    assert.deepEqual([f[0].m, f[1].m], [false, true], 'the second row mirrors its turn');
    // One row away from the root's middle: side points away from it.
    const one = L.offsetFrame(Array.from({ length: 5 }, (_, i) => [-5.6, 0, -6 - i * 6]), 3, false);
    assert.deepEqual(one.map((x) => x.l), [0, 0, 0, 0, 0]);
    assert.deepEqual(one[0].s.map(r2), [-1, 0], 'one row: away from the origin (the road through it)');
    // Not a row: a scatter (at() read its random), two places, a ring.
    assert.equal(L.offsetFrame(spots, 3, true), null, 'a scatter is never a row');
    assert.equal(L.offsetFrame(spots.slice(0, 2), 3, false), null, 'two places: no frame (decision 13)');
    assert.equal(L.offsetFrame(Array.from({ length: 8 }, (_, i) => [Math.cos(i), 0, Math.sin(i)]), 3, false), null, 'a ring is not a row');
    assert.equal(L.offsetFrame([[0, 0, 0], [1, 0, 0], [0, 0, 1], [1, 0, 1]], 3, false), null, '2 + 2 could pair either way: no frame');
    // 2D: x, y.
    const f2 = L.offsetFrame(Array.from({ length: 6 }, (_, i) => [100 + i * 40, i % 2 ? 300 : 200]), 2, false);
    assert.deepEqual(f2.map((x) => x.r), [0, 0, 1, 1, 2, 2], '2D rows too');
  });

  test(`offsets (${name}): the four checks asked for — the whole row 1 m from the road, every other one, a fan, just one`, async () => {
    const L = await load();
    clear();
    lampRow(L);
    const scene = new O3('scene');
    await L.applyPlacement(scene, file3());
    assert.deepEqual(xs(scene), [-5.6, 5.6, -5.6, 5.6, -5.6, 5.6, -5.6, 5.6, -5.6, 5.6], 'the rule as written');
    // (1) the whole row 1 m away from the road: both sides.
    await L.applyPlacement(scene, file3({ 'lamp-row': { offsets: [{ way: 'side', how: 'same', v: 1 }] } }));
    assert.deepEqual(xs(scene), [-6.6, 6.6, -6.6, 6.6, -6.6, 6.6, -6.6, 6.6, -6.6, 6.6], 'same: every lamp 1 m further out, both sides');
    // (2) every other one (the second, fourth … of each side), the others where they were — nothing nearer the road.
    await L.applyPlacement(scene, file3({ 'lamp-row': { offsets: [{ way: 'side', how: 'zigzag', v: 1.5, odd: true }] } }));
    assert.deepEqual(xs(scene), [-5.6, 5.6, -7.1, 7.1, -5.6, 5.6, -7.1, 7.1, -5.6, 5.6], 'zigzag: rank 1 and 3 of each side out, no lamp toward the road');
    await L.applyPlacement(scene, file3({ 'lamp-row': { offsets: [{ way: 'side', how: 'zigzag', v: 1.5 }] } }));
    assert.deepEqual(xs(scene), [-7.1, 7.1, -5.6, 5.6, -7.1, 7.1, -5.6, 5.6, -7.1, 7.1], 'zigzag without odd: the even ranks');
    // (3) a fan: 0.8 m more each one further down the road.
    await L.applyPlacement(scene, file3({ 'lamp-row': { offsets: [{ way: 'side', how: 'ramp', v: 0.8 }] } }));
    assert.deepEqual(xs(scene), [-5.6, 5.6, -6.4, 6.4, -7.2, 7.2, -8, 8, -8.8, 8.8], 'ramp: v × rank, both sides');
    // (4) just one: a pin wins over every offset (and the others stay with the rule).
    await L.applyPlacement(scene, file3({ 'lamp-row': { offsets: [{ way: 'side', how: 'ramp', v: 0.8 }], pins: { 'lamp-row-5': { p: [-3, 0, -18] } } } }));
    assert.deepEqual(xs(scene), [-5.6, 5.6, -6.4, 6.4, -3, 7.2, -8, 8, -8.8, 8.8], 'the pinned lamp where the hand put it, the rest still a fan');
  });

  test(`offsets (${name}): the count turned up — the new lamps get the same shape (the rule stays the rule)`, async () => {
    const L = await load();
    clear();
    lampRow(L);
    const scene = new O3('scene');
    const offsets = [{ way: 'side', how: 'zigzag', v: 1.5, odd: true }, { way: 'side', how: 'ramp', v: 0.5 }];
    await L.applyPlacement(scene, file3({ 'lamp-row': { knobs: { n: { v: 6, was: 5 } }, offsets } }));
    const x = xs(scene);
    assert.equal(x.length, 12);
    assert.deepEqual(x.slice(10), [-5.6 - 0.5 * 5 - 1.5, 5.6 + 0.5 * 5 + 1.5].map(r2), 'lamp 11 and 12 (rank 5, odd): zigzag and ramp both');
    // The gap turned: the frame is the same rows, only further apart.
    await L.applyPlacement(scene, file3({ 'lamp-row': { knobs: { gap: { v: 4, was: 6 } }, offsets: [{ way: 'side', how: 'ramp', v: 1 }] } }));
    assert.deepEqual(xs(scene), [-5.6, 5.6, -6.6, 6.6, -7.6, 7.6, -8.6, 8.6, -9.6, 9.6]);
    assert.deepEqual(lamps(scene).map((o) => r2(o.position.z)), [-6, -6, -10, -10, -14, -14, -18, -18, -22, -22]);
  });

  test(`offsets (${name}): along, up, turn (mirrored) and size; several rows add up in any order`, async () => {
    const L = await load();
    clear();
    lampRow(L);
    const scene = new O3('scene');
    await L.applyPlacement(scene, file3({ 'lamp-row': { offsets: [
      { way: 'along', how: 'zigzag', v: -2, odd: true }, { way: 'up', how: 'same', v: 0.5 }, { way: 'turn', how: 'same', v: 30 }, { way: 'size', how: 'ramp', v: 1.1 },
    ] } }));
    const ls = lamps(scene);
    assert.deepEqual(ls.map((o) => r2(o.position.z)), [-6, -6, -10, -10, -18, -18, -22, -22, -30, -30], 'along zigzag: every other lamp 2 m back toward lamp 1');
    assert.ok(ls.every((o) => r2(o.position.y) === 0.5), 'up: every lamp 0.5 m up');
    assert.deepEqual(ls.slice(0, 2).map((o) => r2((o.rotation.y * 180) / Math.PI)), [30, -30], 'turn: the right side mirrored (both face the road the same way)');
    assert.deepEqual(ls.filter((_, i) => i % 2 === 0).map((o) => r2(o.scale.x)), [1, 1.1, 1.2, 1.3, 1.4], 'size ramp: 1 + (v − 1) × rank');
    const order = (o) => JSON.stringify(lamps(scene).map((l) => [l.position.x, l.position.y, l.position.z, l.rotation.y, l.scale.x].map(r2)), o);
    const a = order();
    await L.applyPlacement(scene, file3({ 'lamp-row': { offsets: [
      { way: 'size', how: 'ramp', v: 1.1 }, { way: 'turn', how: 'same', v: 30 }, { way: 'up', how: 'same', v: 0.5 }, { way: 'along', how: 'zigzag', v: -2, odd: true },
    ] } }));
    assert.equal(order(), a, 'the order of the rows does not matter');
  });

  test(`offsets (${name}): keep-out areas are tested where the offsets put them; hand placed ones never move`, async () => {
    const L = await load();
    clear();
    L.codeAvoid('ditch', { name: '溝', test: (p) => p[0] < -6 });
    lampRow(L, { avoid: ['ditch'] });
    const scene = new O3('scene');
    const r = await L.applyPlacement(scene, file3({ 'lamp-row': { offsets: [{ way: 'side', how: 'ramp', v: 0.8 }], pins: { 'lamp-row-9': { p: [-9, 0, -30] } } } }));
    assert.deepEqual(r.places['lamp-row'].skipped, ['lamp-row-3', 'lamp-row-5', 'lamp-row-7'], 'a row has nowhere else to go: the shifted lamps in the ditch are left out');
    assert.equal(r2(scene.children.find((o) => o.userData.studioKey === 'lamp-row-9').position.x), -9, 'the pin stays in the ditch (the hand wins)');
  });

  test(`offsets (${name}): not a row — a scatter keeps move / up / turn / size "same"; along, side, zigzag and ramp wait in the file`, async () => {
    const L = await load();
    clear();
    L.codePlace('crystal', { name: '結晶', count: 6, make: () => new O3('c'), at: (i, k, g) => ({ p: [-10 + g.rand() * 20, 1, -g.rand() * 30] }) });
    const scene = new O3('scene');
    await L.applyPlacement(scene, file3());
    const before = scene.children.map((o) => [o.position.x, o.position.y, o.position.z]);
    const p = globalThis[Symbol.for('game-studio.codePlaces')].get('crystal');
    assert.equal(p.frame, null, 'a scatter has no row frame');
    assert.equal(p.random, true);
    await L.applyPlacement(scene, file3({ crystal: { offsets: [{ way: 'move', how: 'same', v: [1.2, -0.5] }, { way: 'up', how: 'same', v: 0.3 }, { way: 'side', how: 'same', v: 4 }, { way: 'up', how: 'zigzag', v: 9 }] } }));
    scene.children.forEach((o, i) => {
      assert.equal(r2(o.position.x), r2(before[i][0] + 1.2));
      assert.equal(r2(o.position.y), 1.3);
      assert.equal(r2(o.position.z), r2(before[i][2] - 0.5));
    });
  });

  test(`offsets (${name}): the editor's look-up (codePose / codeSpot) sees the offsets; base and spots on the layout`, async () => {
    const L = await load();
    clear();
    lampRow(L);
    const scene = new O3('scene');
    await L.applyPlacement(scene, file3({ 'lamp-row': { offsets: [{ way: 'side', how: 'same', v: 1 }, { way: 'turn', how: 'same', v: 90 }] } }));
    const q = L.codePose('lamp-row', 1, { n: 5, gap: 4 });
    assert.deepEqual(q.p.map(r2), [6.6, 0, -6], 'number 2 with gap 4: shifted 1 m out');
    assert.equal(r2(q.r), r2(-Math.PI / 2), 'its turn mirrored');
    assert.deepEqual(L.codeSpot('lamp-row', 2, { n: 5, gap: 4 }).map(r2), [-6.6, 0, -10]);
    const p = globalThis[Symbol.for('game-studio.codePlaces')].get('lamp-row');
    assert.deepEqual(p.base[0], [-5.6, 0, -6], 'base: the formula alone');
    assert.deepEqual(p.spots[0].map(r2), [-6.6, 0, -6], 'spots: with the offsets (where "Reset to rule" puts it)');
  });

  test(`offsets (${name}): a bad offset is left out (said once); hand: true plays none; the rest of the file as before`, async () => {
    const L = await load();
    clear();
    lampRow(L);
    const scene = new O3('scene');
    const warns = [];
    const was = console.warn;
    console.warn = (...a) => warns.push(a.join(' '));
    try {
      await L.applyPlacement(scene, file3({ 'lamp-row': { offsets: [{ way: 'sideways', how: 'same', v: 1 }, { way: 'side', how: 'same', v: '1' }, { way: 'side', how: 'same', v: 2 }] } }));
    } finally {
      console.warn = was;
    }
    assert.deepEqual(xs(scene).slice(0, 2), [-7.6, 7.6], 'the good one plays');
    assert.ok(warns.some((w) => w.includes('an offset needs a way')), `said: ${warns.join(' | ')}`);
    await L.applyPlacement(scene, file3({ 'lamp-row': { hand: true, offsets: [{ way: 'side', how: 'same', v: 2 }], pins: { 'lamp-row-1': { p: [-1, 0, -6] } } } }));
    assert.deepEqual(xs(scene).slice(0, 2), [-1, 5.6], 'by hand: no offsets (the pins say everything)');
  });
}

test('offsets: placement.json keeps which way, how and how much — checked, rounded, ≤ 8, move only "same"', async () => {
  const { validateStudioFile } = await import('../src/schema/studio-files.mjs');
  const ok = validateStudioFile(file3({ 'lamp-row': { offsets: [{ way: 'side', how: 'zigzag', v: 1.500004, odd: true }, { way: 'turn', how: 'ramp', v: -12 }, { way: 'size', how: 'same', v: 1.2 }] }, crystal: { offsets: [{ way: 'move', how: 'same', v: [1.2, -0.5] }] } }));
  assert.equal(ok.ok, true, JSON.stringify(ok.errors));
  assert.deepEqual(ok.value.places['lamp-row'].offsets, [{ way: 'side', how: 'zigzag', v: 1.5, odd: true }, { way: 'turn', how: 'ramp', v: -12 }, { way: 'size', how: 'same', v: 1.2 }]);
  assert.deepEqual(ok.value.places.crystal.offsets, [{ way: 'move', how: 'same', v: [1.2, -0.5] }]);
  const bad = (offsets) => validateStudioFile(file3({ 'lamp-row': { offsets } }));
  assert.match(bad([{ way: 'sideways', how: 'same', v: 1 }]).errors.join(), /way: must be one of/);
  assert.match(bad([{ way: 'side', how: 'wobble', v: 1 }]).errors.join(), /how: must be one of/);
  assert.match(bad([{ way: 'move', how: 'zigzag', v: [1, 1] }]).errors.join(), /"same" only/);
  assert.match(bad([{ way: 'side', how: 'same', v: 1, odd: true }]).errors.join(), /only a zigzag has odd/);
  assert.match(bad([{ way: 'size', how: 'same', v: 0 }]).errors.join(), /between/);
  assert.match(bad(Array.from({ length: 9 }, () => ({ way: 'up', how: 'same', v: 1 }))).errors.join(), /at most 8/);
  // None: the entry is not written (the file keeps its bytes).
  const none = validateStudioFile(file3({ 'lamp-row': { offsets: [] } }));
  assert.equal(none.value.places, undefined);
});

test('offsets: --do place.set --offsets — checked, written to placement.json with no editor open, [] takes them off', async () => {
  const { readHandsInput, applyHandsToFile } = await import('../src/schema/hands.mjs');
  const { handsInput, handsFlagValue, HANDS_FLAG_FIELDS } = await import('../src/server/hands-cli.mjs');
  assert.ok(HANDS_FLAG_FIELDS.includes('offsets'), 'the CLI reads --offsets');
  const op = handsInput({ do: 'place.set', doFields: { id: 'lamp-row', offsets: handsFlagValue('offsets', '[{"way":"side","how":"zigzag","v":1.5,"odd":true}]') } });
  const r = readHandsInput(op);
  assert.ok(r.ok, JSON.stringify(r.errors));
  const a = applyHandsToFile(file3(), r.ops);
  assert.deepEqual(a.file.places['lamp-row'].offsets, [{ way: 'side', how: 'zigzag', v: 1.5, odd: true }]);
  assert.match(a.results[0].said, /offsets side zigzag 1\.5 \(odd\)/);
  const off = applyHandsToFile(a.file, readHandsInput({ do: 'place.set', id: 'lamp-row', offsets: [] }).ops);
  assert.equal(off.file.places?.['lamp-row']?.offsets, undefined, '[] takes them off');
  for (const [bad, why] of [[[{ way: 'left', how: 'same', v: 1 }], /"way" is one of/], [[{ way: 'move', how: 'ramp', v: [1, 0] }], /a move is "same"/], [[{ way: 'side', how: 'same', v: 1, odd: true }], /"odd": true is a zigzag/]]) {
    const x = readHandsInput({ do: 'place.set', id: 'lamp-row', offsets: bad });
    assert.equal(x.ok, false);
    assert.match(x.errors.join(), why);
  }
});
