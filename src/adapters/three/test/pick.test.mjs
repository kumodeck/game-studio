// pickNear (pick.js) on plain stand-ins for three objects: which object a press picks.
// Added after the wave 1 merge (2026-10-17): on a phone, a tap ON Lantern Cove's lighthouse picked a pine mostly off
// the screen's edge, because the lighthouse's box (tower + its wide light beam) counted as a big object.
// Run: node --test src/adapters/three/test/pick.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pickNear } from '../pick.js';

// An orthographic camera at the origin looking down −z: 400×400 px for 20×20 world units (20 px per unit).
const HW = 10;
const ID = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const PROJ = [1 / HW, 0, 0, 0, 0, 1 / HW, 0, 0, 0, 0, -2 / 99.9, 0, 0, 0, -100.1 / 99.9, 1];
const camera = { projectionMatrix: { elements: PROJ }, matrixWorld: { elements: ID } };
const SIZE = [400, 400];
/** A box mesh (no position attribute: rays use its box). */
const box = (min, max) => ({ isMesh: true, visible: true, children: [], matrixWorld: { elements: ID }, geometry: { boundingBox: { min: { x: min[0], y: min[1], z: min[2] }, max: { x: max[0], y: max[1], z: max[2] } } } });
const group = (...children) => ({ visible: true, children, matrixWorld: { elements: ID } });
const at = (x, y) => [x / HW, y / HW]; // world x, y → ndc

test('a tap on a thin tower with a wide light beam picks the tower, not the small thing 20 px beside it', () => {
  // Tower 40×160 px; its beam 200×10 px at the top makes the whole box 200×160 px.
  const lighthouse = group(box([-1, -4, -11], [1, 4, -9]), box([-1, 3.5, -10.2], [9, 4, -9.8]));
  // A small pine (24×40 px) whose right edge is 20 px left of the press.
  const pine = group(box([-2.4, -2, -10], [-1.2, 0, -8]));
  const cands = [{ key: 'pine-3', object: pine }, { key: 'lighthouse', object: lighthouse }];
  const keys = pickNear(cands, camera, PROJ, ...at(-0.2, 0), 28, SIZE);
  assert.equal(keys[0], 'lighthouse', keys.join(' '));
  assert.ok(keys.includes('pine-3'), 'the pine stays a candidate (a second tap on the same spot reaches it)');
});

test('a tap just beside a small coin on a big hill still picks the coin', () => {
  const hill = group(box([-9, -9, -12], [9, 2, -10])); // 360×220 px, one mesh
  const coin = group(box([0, 2.5, -9], [1.5, 4, -8])); // 30×30 px, standing on the hill
  const cands = [{ key: 'hill', object: hill }, { key: 'coin', object: coin }];
  // 10 px below the coin, on the hill.
  const keys = pickNear(cands, camera, PROJ, ...at(0.75, 2), 28, SIZE);
  assert.equal(keys[0], 'coin', keys.join(' '));
});

test('a tap on a lantern standing on a ground that runs on under the camera picks the lantern, not the ground', () => {
  // glow-camera pass 2026-10-20: a perspective camera (90°, square) at the origin looking down −z, standing over a
  // 400 m ground that runs on behind it. pickNear's box of the ground used to drop the corners behind the camera:
  // only its far strip was left, a band ~0 px high, so the ground "was tiny" and beat the lantern under the finger.
  const near = 0.1, far = 1000;
  const persp = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0];
  const cam = { projectionMatrix: { elements: persp }, matrixWorld: { elements: ID } };
  const ground = group(box([-200, -2.01, -200], [200, -2, 200]));
  const lantern = group(box([-0.3, -2, -10.3], [0.3, -0.5, -9.7]));
  const cands = [{ key: 'ground', object: ground }, { key: 'lantern', object: lantern }];
  // On the lantern's middle: x = 0, y = −1.25 at 10 m → ndc (0, −0.125).
  const keys = pickNear(cands, cam, persp, 0, -0.125, 0, SIZE);
  assert.equal(keys[0], 'lantern', keys.join(' '));
  // Beside it, on the grass: the ground (the only thing there).
  assert.deepEqual(pickNear(cands, cam, persp, 0.5, -0.5, 0, SIZE), ['ground']);
});
