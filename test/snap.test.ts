// Snap to surfaces (a request after a try of the editor, 2026-10-19: "in Unreal, an object moved up or down stops once when it meets the ground or
// another thing"): the bridge's rules (src/bridge/snap.ts), the surfaces the three.js adapter finds
// (src/adapters/three/surface.js) on plain fake meshes, and the keys / rows that reach them.
// Run: node --experimental-strip-types --no-warnings --test test/snap.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { BREAK_PX, firstToTouch, freeHeld, liftDetent, stepDetent, type DetentState } from '../src/bridge/snap.ts';
import { castSurface, castSurfaceAll, solidBox, surfaceBelow, surfaceMeshes } from '../src/adapters/three/surface.js';
import { keyStep } from '../src/core/keys.ts';
import { KEYMAP, keysOf } from '../src/shell/keymap.ts';
import { contextRows, type CtxFacts } from '../src/shell/context-rows.ts';
import { translate } from '../src/shell/i18n.ts';

// ---------------------------------------------------------------- the height drag's stop
const k = 0.01; // metres per px

test('going down, the bottom stops on the surface below (the ground)', () => {
  const st: DetentState = { through: null };
  // Bottom 0.5 m above the ground (y 0); the finger asks for 0.7 m down: it lands on the ground, not under it.
  assert.equal(liftDetent({ bottom: 0.5, below: 0 }, -0.7, k, st), -0.5);
  // Resting on it, pulled 0.2 m (20 px) further: still held.
  assert.equal(liftDetent({ bottom: 0, below: 0 }, -0.2, k, st), 0);
  assert.equal(st.through, null);
});

test('pulling on past it by BREAK_PX lets it through; the next surface catches it again', () => {
  const st: DetentState = { through: null };
  const past = -(BREAK_PX + 1) * k;
  assert.equal(liftDetent({ bottom: 1.11, below: 1.11 }, past, k, st), past); // through the pier's planks
  assert.equal(st.through, 1.11);
  // Under the planks now (its top still above them, so the measure from its top still sees them): no catch again.
  assert.equal(liftDetent({ bottom: 0.8, below: 1.11 }, -0.1, k, st), -0.1);
  // The sea below catches it.
  assert.equal(liftDetent({ bottom: 0.3, below: 0 }, -0.5, k, st), -0.3);
  // Back above the planks: they catch again.
  assert.equal(liftDetent({ bottom: 1.3, below: 1.11 }, -0.4, k, st), 1.11 - 1.3);
  assert.equal(st.through, null);
});

test('up, nothing below, or already sunk in it: moves as asked', () => {
  const st: DetentState = { through: null };
  assert.equal(liftDetent({ bottom: 0, below: 0 }, 0.3, k, st), 0.3);
  assert.equal(liftDetent({ bottom: 2, below: null }, -3, k, st), -3);
  assert.equal(liftDetent({ bottom: -0.15, below: 0 }, -0.2, k, st), -0.2); // a post sunk 15 cm
  assert.equal(liftDetent(null, -1, k, st), -1);
});

test('a finger gets a longer pull than a mouse', () => {
  const st: DetentState = { through: null };
  assert.equal(liftDetent({ bottom: 0, below: 0 }, -0.4, k, st, 44), 0);
  assert.equal(liftDetent({ bottom: 0, below: 0 }, -0.4, k, st, BREAK_PX), -0.4);
});

test('PgDn: a step ends on the surface, the next one goes through', () => {
  assert.equal(stepDetent({ bottom: 0.05, below: 0 }, -0.1), -0.05);
  assert.equal(stepDetent({ bottom: 0, below: 0 }, -0.1), -0.1);
  assert.equal(stepDetent({ bottom: 0.5, below: 0 }, -0.1), -0.1);
  assert.equal(stepDetent({ bottom: 0.05, below: 0 }, 0.1), 0.1);
});

test('several together: the one nearest its surface decides', () => {
  const r = firstToTouch([{ bottom: 2, below: 0 }, { bottom: 1.3, below: 1.11 }, { bottom: -1, below: 0 }, null]);
  assert.deepEqual(r, { bottom: 1.3, below: 1.11 });
  assert.equal(firstToTouch([{ bottom: 1, below: null }]), null);
});

test('Ctrl or ⌥ held frees the drag', () => {
  assert.equal(freeHeld({ ctrlKey: true }), true);
  assert.equal(freeHeld({ altKey: true }), true);
  assert.equal(freeHeld({}), false);
});

// ---------------------------------------------------------------- the surfaces (fake three.js meshes)
type V3 = [number, number, number];
const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
/** A mesh of triangles (world = local), with three.js's field names. */
function mesh(tris: V3[][], material: Record<string, unknown> = {}) {
  const flat = tris.flat();
  return {
    isMesh: true, visible: true, children: [] as unknown[], material: { side: 0, ...material },
    matrixWorld: { elements: I.slice() },
    geometry: { index: null, drawRange: { start: 0, count: Infinity }, attributes: { position: { count: flat.length, version: 0, getX: (i: number) => flat[i]![0], getY: (i: number) => flat[i]![1], getZ: (i: number) => flat[i]![2] } } },
  };
}
/** A horizontal square at height y, facing up (counter-clockwise seen from above). */
const square = (x0: number, z0: number, x1: number, z1: number, y: number): V3[][] => [
  [[x0, y, z0], [x0, y, z1], [x1, y, z1]],
  [[x0, y, z0], [x1, y, z1], [x1, y, z0]],
];
/** A ground of many triangles (so it gets a grid), at y = 0 over ±50 m. */
function bigGround() {
  const tris: V3[][] = [];
  for (let i = 0; i < 40; i++) for (let j = 0; j < 40; j++) tris.push(...square(-50 + i * 2.5, -50 + j * 2.5, -47.5 + i * 2.5, -47.5 + j * 2.5, 0));
  return mesh(tris);
}
const ground = bigGround();
const pier = mesh([...square(10, -1, 20, 1, 1.11), ...square(10, -1, 20, 1, 0.99).map((t) => [t[0]!, t[2]!, t[1]!] as V3[])]); // planks: top up, underside down
const beam = mesh(square(-5, -5, 5, 5, 3), { transparent: true, depthWrite: false, blending: 2 });
const barrel = mesh(square(12, -0.4, 13, 0.4, 2));
const scene = { visible: true, children: [ground, pier, beam, barrel] };

test('the surfaces: every visible mesh but the moving ones and light effects', () => {
  const all = surfaceMeshes(scene, new Set([barrel]));
  assert.ok(all.includes(ground) && all.includes(pier));
  assert.ok(!all.includes(barrel), 'the moving object is not its own floor');
  assert.ok(!all.includes(beam), 'an additive light beam is not a floor');
});

test('looking down: the pier top where it is, the ground elsewhere, never the underside', () => {
  const ms = surfaceMeshes(scene, new Set([barrel]));
  const down = (x: number, y: number, z: number) => castSurface({ o: [x, y, z], d: [0, -1, 0] }, ms)?.point[1] ?? null;
  assert.ok(Math.abs(down(15, 5, 0)! - 1.11) < 1e-9);
  assert.ok(Math.abs(down(0, 5, 0)! - 0) < 1e-9);
  // From under the planks (a barrel pulled through): their underside faces down — the ground is found.
  assert.ok(Math.abs(down(15, 1.05, 0)! - 0) < 1e-9);
});

test('a box half over the pier edge rests on the pier (the highest of five rays)', () => {
  const ms = surfaceMeshes(scene, new Set([barrel]));
  const top = surfaceBelow({ min: [9.4, 2, -0.4], max: [10.4, 3, 0.4] }, 2.5, ms);
  assert.ok(Math.abs(top - 1.11) < 1e-9);
  assert.equal(surfaceBelow({ min: [80, 2, 80], max: [81, 3, 81] }, 2.5, ms), null);
});

test('a slanted ray (the camera through the foot) meets the first face; walls are told apart', () => {
  const wall = mesh([[[30, 0, -5], [30, 5, -5], [30, 0, 5]], [[30, 5, -5], [30, 5, 5], [30, 0, 5]]], { side: 2 });
  const ms = [ground, wall];
  const d = [1, -0.2, 0].map((x) => x / Math.hypot(1, 0.2)) as V3;
  const any = castSurface({ o: [20, 3, 0], d }, ms, { minUp: -1 });
  assert.ok(any && Math.abs(any.point[0] - 30) < 1e-9 && any.normal[1] < 0.5, 'hits the wall first');
  const floor = castSurface({ o: [20, 3, 0], d: [0.6, -0.8, 0] }, ms, { minUp: 0.5 });
  assert.ok(floor && Math.abs(floor.point[1]) < 1e-9 && floor.normal[1] > 0.99);
});

test('the foot box leaves light effects out (review 3: the lighthouse box held its 28 m beams)', () => {
  // A tower 2 m wide, 10 m high, with an additive beam card reaching 28 m out at the top.
  const box = (min: V3, max: V3) => ({ min: { x: min[0], y: min[1], z: min[2] }, max: { x: max[0], y: max[1], z: max[2] } });
  const tower = { ...mesh(square(-1, -1, 1, 1, 0)), geometry: { ...mesh([]).geometry, boundingBox: box([-1, 0, -1], [1, 10, 1]) } };
  const card = { ...mesh([], { transparent: true, depthWrite: false, blending: 2 }), geometry: { ...mesh([]).geometry, boundingBox: box([0, 9, -2], [28, 11, 2]) } };
  const lighthouse = { visible: true, children: [tower, card] };
  const b = solidBox(lighthouse)!;
  assert.deepEqual([b.min, b.max], [[-1, 0, -1], [1, 10, 1]], 'the beam is not in the foot box');
  assert.equal(solidBox({ visible: true, children: [card] }), null, 'only a glow: no foot box (adapter falls back to the whole box)');
});

test('every surface along a ray, nearest first (castSurfaceAll: the move looks down through them)', () => {
  const ms = surfaceMeshes(scene, new Set([barrel]));
  const all = castSurfaceAll({ o: [15.3, 5, 0.4], d: [0, -1, 0] }, ms);
  assert.deepEqual(all.map((h: { point: number[] }) => Math.round(h.point[1] * 100) / 100), [1.11, 0], 'the planks, then the ground under them (not their underside)');
});

// ---------------------------------------------------------------- keys and rows
test('End drops (3D only); the sheet lists End and the snap-free keys', () => {
  assert.deepEqual(keyStep('End', false, '3d'), { op: 'drop' });
  assert.equal(keyStep('End', false, '2d'), null);
  assert.deepEqual(keysOf('drop', false), ['End']);
  assert.deepEqual(keysOf('free', true), ['⌃', '⌥']);
  assert.deepEqual(keysOf('free', false), ['Ctrl', 'Alt']);
  for (const id of ['drop', 'free']) assert.equal(KEYMAP.find((x) => x.id === id)?.dim, '3d');
  assert.equal(translate('en', 'keys.drop'), 'Drop to floor');
  assert.equal(translate('ja', 'keys.drop'), '床に落とす');
  assert.notEqual(translate('ja', 'keys.free.note'), 'keys.free.note');
});

const facts = (o: Partial<CtxFacts> = {}): CtxFacts => ({
  dim: '3d', offline: false, editing: true, picked: 1, movable: 1, unnamed: 0, anyPicked: true, items: 5, clip: 0, canUndo: false, canRedo: false, ...o,
});
const ids = (f: CtxFacts) => contextRows('object', f).map((r) => ('sep' in r ? '|' : r.id));

test('the object menu has Drop to floor in 3D, next to the Library row; a phone shows it only when it can act', () => {
  assert.ok(ids(facts({ droppable: 1 })).join(' ').includes('drop showInLibrary'));
  assert.ok(!ids(facts()).includes('drop'), 'no drop without the adapter (2D)');
  const locked = contextRows('object', facts({ droppable: 0 })).find((r) => !('sep' in r) && r.id === 'drop');
  assert.ok(locked && !('sep' in locked) && locked.disabled);
  assert.ok(ids(facts({ droppable: 1, compact: true })).includes('drop'));
  assert.ok(!ids(facts({ droppable: 0, compact: true })).includes('drop'));
});
