// studio-code-base (2026-10-24): the loader's code motions, code layouts and keep-out areas (CONTRACT.md §1.9.4,
// §1.12). WHY: "sometimes a motion is made by maths, not by points — what then?", and the four user needs of the same
// day: tune a procedural layout or a formula motion by hand and keep it a formula, keep-out areas for a procedural
// layout. The formula is the game's code (codePlace / codeMotion / codeAvoid); placement.json holds only what the person
// changed. Run on the source and on the built loader (the copy games import).
//   node --test test/code-base.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// A small stand-in for three.js objects: what the loader touches (position / rotation / scale, children, userData).
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
// PixiJS's: a container with addChild / removeChild, label, one rotation number, x / y.
const v2 = () => ({ x: 0, y: 0, set(x, y) { this.x = x; this.y = y; } });
class P2 {
  constructor(label = '') {
    this.label = label;
    this.children = [];
    this.parent = null;
    this.visible = true;
    this.position = v2();
    this.rotation = 0;
    this.scale = { ...v2(), x: 1, y: 1 };
  }
  addChild(o) {
    o.parent = this;
    this.children.push(o);
  }
  removeChild(o) {
    this.children = this.children.filter((c) => c !== o);
    o.parent = null;
  }
}
const file3 = (extra = {}) => ({ version: 1, tool: 'placement', dim: '3d', space: 'local', objects: {}, ...extra });
const at3 = (o) => [o.position.x, o.position.y, o.position.z].map((v) => Math.round(v * 1000) / 1000);
const byKey = (root, k) => root.children.find((c) => c.userData?.studioKey === k || c.studioKey === k);
const clear = () => {
  for (const s of ['game-studio.codeMotions', 'game-studio.codePlaces', 'game-studio.codeAvoids']) delete globalThis[Symbol.for(s)];
};
const hexRow = (L, extra = {}) => L.codePlace('hex', {
  name: '六角形の列',
  knobs: { n: { v: 4, label: '個数', unit: '', step: 1 }, gap: { v: 6, label: '間', unit: 'm', min: 2, max: 12 } },
  count: (k) => k.n,
  make: () => new O3('hex'),
  at: (i, k) => ({ p: [[-2.5, 2, -1, 3][i % 4], 0.95, -11 - i * k.gap], r: [Math.PI / 2, 0, 0] }),
  drag: 'gap',
  ...extra,
});

for (const [name, file] of [['source', 'src/loader/studio-placement.js'], ['built', 'skills/arrange/bin/studio-placement.js']]) {
  const load = () => import(pathToFileURL(path.join(PKG, file)).href);

  test(`loader (${name}): codePlace puts make(i) at at(i, k) as hex-1 … with or without a file`, async () => {
    const L = await load();
    clear();
    hexRow(L);
    const scene = new O3();
    const r = await L.applyPlacement(scene, file3());
    assert.deepEqual(r.places, { hex: { keys: ['hex-1', 'hex-2', 'hex-3', 'hex-4'], skipped: [] } });
    assert.deepEqual(at3(byKey(scene, 'hex-2')), [2, 0.95, -17]);
    assert.equal(byKey(scene, 'hex-2').name, 'hex-2', 'named by its key (the editor finds it by the mark too)');
    assert.equal(Math.round(byKey(scene, 'hex-1').rotation.x * 1000) / 1000, 1.571, 'r = [x, y, z]');
    // No placement.json yet (404): the code's layout is still there — it is the game's own.
    const was = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: false });
    try {
      const s2 = new O3();
      const r2 = await L.applyPlacement(s2, './placement.json');
      assert.equal(r2.places.hex.keys.length, 4);
    } finally {
      globalThis.fetch = was;
    }
    // Again (a level built again): the earlier objects are taken out, never doubled; the same places.
    const r3 = await L.applyPlacement(scene, file3());
    assert.equal(scene.children.filter((c) => /^hex-/.test(c.name)).length, 4);
    assert.deepEqual(r3.places.hex.keys, ['hex-1', 'hex-2', 'hex-3', 'hex-4']);
  });

  test(`loader (${name}): the file's knob v wins over the code's; pins win last; hand = every object by hand`, async () => {
    const L = await load();
    clear();
    hexRow(L);
    const scene = new O3();
    await L.applyPlacement(scene, file3({ places: { hex: { knobs: { gap: { v: 4, was: 6 }, n: { v: 5, was: 4 } }, pins: { 'hex-3': { p: [-3.1, 0.95, -19] } } } } }));
    assert.deepEqual(at3(byKey(scene, 'hex-2')), [2, 0.95, -15], 'gap 4 from the file');
    assert.deepEqual(at3(byKey(scene, 'hex-3')), [-3.1, 0.95, -19], 'the pin over the formula');
    assert.ok(byKey(scene, 'hex-5'), 'n 5 from the file');
    assert.equal(Math.round(byKey(scene, 'hex-3').rotation.x * 1000) / 1000, 1.571, 'a pin with p alone keeps the formula\'s angle');
    // A pin of an object the count no longer makes is kept in the file but not used.
    const s2 = new O3();
    const r2 = await L.applyPlacement(s2, file3({ places: { hex: { knobs: { n: { v: 2 } }, pins: { 'hex-3': { p: [0, 0, 0] } } } } }));
    assert.deepEqual(r2.places.hex.keys, ['hex-1', 'hex-2']);
    // hand: every object at its pin; keep-out areas do not move what a hand put.
    L.codeAvoid('everywhere', { name: 'どこにも', test: () => true });
    hexRow(L, { avoid: ['everywhere'] });
    const s3 = new O3();
    const pins = Object.fromEntries([1, 2, 3, 4].map((i) => [`hex-${i}`, { p: [i, 0, -i] }]));
    const r3 = await L.applyPlacement(s3, file3({ places: { hex: { hand: true, pins } } }));
    assert.deepEqual(r3.places.hex.skipped, []);
    assert.deepEqual(at3(byKey(s3, 'hex-4')), [4, 0, -4]);
  });

  test(`loader (${name}): keep-out areas — a code condition, a box, off; a scatter tries again, a row is skipped`, async () => {
    const L = await load();
    clear();
    L.codeAvoid('road', { name: '道の上', test: (p) => Math.abs(p[0]) < 3.5 });
    L.codeAvoid('near-player', { name: 'プレイヤーから', after: '以内', knobs: { r: { v: 5, label: '距離', unit: 'm' } }, test: (p, k, g) => Math.hypot(p[0] - g.player[0], p[2] - g.player[2]) < k.r });
    // A scatter: rand() picks the place, the same every load for the same number and try.
    L.codePlace('crystal', { name: '結晶', count: 12, make: () => new O3('crystal'), at: (i, k, g) => ({ p: [g.rand() * 40 - 20, 0, g.rand() * -40] }), avoid: ['road'] });
    const player = new O3('player');
    player.position.set(0, 0, -20);
    const scene = new O3();
    scene.add(player);
    const r = await L.applyPlacement(scene, file3({ places: { crystal: { avoid: [{ code: 'near-player', knobs: { r: { v: 8, was: 5 } } }, { box: { p: [10, 0, -10], size: [6, 2, 6] }, name: '箱 1' }] } } }));
    const placed = r.places.crystal.keys.map((k) => at3(byKey(scene, k)));
    assert.ok(placed.length >= 10, `most of them find a place (${placed.length} of 12)`);
    for (const q of placed) {
      assert.ok(Math.abs(q[0]) >= 3.5, `not on the road: ${q}`);
      assert.ok(Math.hypot(q[0], q[2] + 20) >= 8, `not within 8 m of the player (the file's knob): ${q}`);
      assert.ok(!(Math.abs(q[0] - 10) <= 3 && Math.abs(q[2] + 10) <= 3), `not in the box: ${q}`);
    }
    // The same places when the game loads again (rand is seeded by id, number and try).
    const s2 = new O3();
    s2.add(player);
    const r2 = await L.applyPlacement(s2, file3({ places: { crystal: { avoid: [{ code: 'near-player', knobs: { r: { v: 8 } } }, { box: { p: [10, 0, -10], size: [6, 2, 6] } }] } } }));
    assert.deepEqual(r2.places.crystal.keys.map((k) => at3(byKey(s2, k))), placed);
    // The road switched off in the file: crystals may stand on it again.
    const s3 = new O3();
    const r3 = await L.applyPlacement(s3, file3({ places: { crystal: { avoid: [{ code: 'road', off: true }] } } }));
    assert.equal(r3.places.crystal.keys.length, 12);
    assert.ok(r3.places.crystal.keys.some((k) => Math.abs(byKey(s3, k).position.x) < 3.5));
    // A row has nowhere else to go: the ones on the road are skipped, at once (the same place on every try).
    let calls = 0;
    clear();
    L.codeAvoid('road', { name: '道の上', test: (p) => Math.abs(p[0]) < 3.5 });
    L.codePlace('lamp', { name: '街灯', count: 5, make: () => new O3('lamp'), at: (i) => (calls++, { p: [[-6, 0, 6, -2, 8][i], 0, -i * 6] }), avoid: ['road'] });
    const s4 = new O3();
    const r4 = await L.applyPlacement(s4, file3());
    assert.deepEqual(r4.places.lamp, { keys: ['lamp-1', 'lamp-3', 'lamp-5'], skipped: ['lamp-2', 'lamp-4'] });
    assert.ok(calls <= 7, `a row is asked twice at most for a refused place (${calls} calls)`);
  });

  test(`loader (${name}): from hides the hand-placed objects a layout replaced (even with the layout's own keys)`, async () => {
    const L = await load();
    clear();
    const scene = new O3();
    const hand = [1, 2].map((i) => {
      const o = new O3(`lamp-${i}`);
      scene.add(o);
      return o;
    });
    L.codePlace('lamp', { name: '街灯', count: 2, make: () => new O3('lamp'), at: (i) => ({ p: [-4, 0, -i * 6] }) });
    await L.applyPlacement(scene, file3({ places: { lamp: { from: ['lamp-1', 'lamp-2'] } } }));
    assert.deepEqual(hand.map((o) => o.visible), [false, false], 'the hand lamps are hidden');
    assert.deepEqual(['lamp-1', 'lamp-2'].map((k) => byKey(scene, k).visible), [true, true], 'the code\'s lamps are not');
  });

  test(`loader (${name}): PixiJS — a layout on the stage, labels and keys, 2D boxes`, async () => {
    const L = await load();
    clear();
    L.codePlace('coin', { name: 'コイン', knobs: { gap: { v: 40, label: '間', unit: 'px' } }, count: 4, make: () => new P2('coin'), at: (i, k) => ({ p: [100 + i * k.gap, 200], r: 0.5 }) });
    const stage = new P2();
    const r = await L.applyPlacement(stage, { version: 1, tool: 'placement', dim: '2d', objects: {}, places: { coin: { avoid: [{ box: { p: [180, 200], size: [10, 10] } }] } } });
    assert.deepEqual(r.places.coin, { keys: ['coin-1', 'coin-2', 'coin-4'], skipped: ['coin-3'] });
    const c2 = stage.children.find((c) => c.studioKey === 'coin-2');
    assert.deepEqual([c2.position.x, c2.position.y, c2.rotation, c2.label], [140, 200, 0.5, 'coin-2']);
  });

  test(`loader (${name}): codeMotion — a code clip plays at(t, k) with the file's knobs; off clips never play`, async () => {
    const L = await load();
    clear();
    L.codeMotion('spiral', {
      name: '螺旋',
      knobs: { radius: { v: 2, label: '半径', unit: 'm' }, turn: { v: 4, label: '1 周', unit: 's' } },
      round: (k) => 2 * k.turn,
      at: (t, k) => {
        const a = (t / k.turn) * 2 * Math.PI;
        return { p: [k.radius * Math.cos(a) - k.radius, t, k.radius * Math.sin(a)], r: a };
      },
    });
    const lib = [{ name: '螺旋', code: 'spiral', knobs: { radius: { v: 3, was: 2 } } }];
    const c = L.resolveClip({ use: '螺旋', when: { on: 'start' } }, lib, 'pillar');
    assert.equal(c.code, 'spiral');
    const a = L.clipAt(c, 1);
    assert.deepEqual(a.p.map((v) => Math.round(v * 1000) / 1000), [-3, 1, 3], 'radius 3 from the file, a quarter turn at 1 s');
    assert.deepEqual(a.r.map((v) => Math.round(v * 1000) / 1000), [0, 1.571, 0], 'a number r is the turn round y (3D)');
    assert.equal(L.codeRound(c), 8, 'round from the code with the knobs');
    // until: 2 rounds (16 s), then it stays; a clip switched off never starts.
    const run = L.motionRunner([{ key: 'pillar', clips: [{ ...c, until: { times: 2 } }] }, { key: 'orb', clips: [{ ...L.resolveClip({ use: '螺旋', off: true }, lib, 'orb') }] }]);
    run.fire({ on: 'start' }, 0);
    assert.ok(run.step(1000).has('pillar'));
    assert.ok(!run.step(1000).has('orb'), 'off: not played');
    run.step(17000);
    assert.equal(run.playing().size, 0, 'stopped after 2 rounds');
    // A code motion the page has no codeMotion() for stays where it is (said once, never thrown).
    const lost = L.resolveClip({ use: 'Wave' }, [{ name: 'Wave', code: 'wave' }], 'x');
    assert.deepEqual(L.clipAt(lost, 1), { p: null, r: null, s: null, done: false });
    // The lists the editor reads in the game's page.
    const list = globalThis[Symbol.for('game-studio.codeMotions')];
    assert.deepEqual(Object.keys(list.get('spiral').knobs), ['radius', 'turn']);
  });

  test(`loader (${name}): a file without code layouts or motions: the report as before`, async () => {
    const L = await load();
    clear();
    const scene = new O3();
    const tree = new O3('tree');
    scene.add(tree);
    const r = await L.applyPlacement(scene, file3({ objects: { tree: { p: [1, 0, 2] } } }));
    assert.deepEqual(r, { applied: ['tree'], missing: [], unstable: [], skipped: [] });
  });
}
