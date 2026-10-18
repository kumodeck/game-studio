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
