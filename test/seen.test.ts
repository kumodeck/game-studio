// Plan step 2 "the camera stays put" (2026-10-23): when a pick from the list may move the edit camera, and how far.
// bridge/seen.ts (both adapters) and the 3D adapter's focusSphere (the one case the camera jumps: the pick is not drawn).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { minPickPx, seenEnough, tooSmall } from '../src/bridge/seen.ts';
import { focusSphere } from '../src/adapters/three/focus.js';

// The free part of a 1024 × 744 game frame with the ask bar over its foot (neon-run at 1280 × 800).
const free = { x0: 0, y0: 0, x1: 1024, y1: 670 };

test('seen: the ship with its foot under the ask bar is seen (walk #3: it was "hidden" and the camera flew back)', () => {
  // Measured in neon-run at 1280 × 800: x 440, y 598, 144 × 220 — only its top (~70 px) above the ask bar.
  assert.equal(seenEnough({ x: 440, y: 598, w: 144, h: 220 }, free, 12), true);
});

test('seen: a small thing in the middle is seen; one off the frame or only a sliver of it is not', () => {
  assert.equal(seenEnough({ x: 458, y: 277, w: 26, h: 30 }, free, 12), true);
  assert.equal(seenEnough({ x: 1100, y: 277, w: 26, h: 30 }, free, 12), false);
  assert.equal(seenEnough({ x: 500, y: -40, w: 26, h: 30 }, free, 12), false, 'a few px at the top edge');
  assert.equal(seenEnough({ x: 500, y: 640, w: 100, h: 200 }, free, 12), false, '18 px of 200 above the bar');
});

test('seen: a point-sized box is seen when its middle is', () => {
  assert.equal(seenEnough({ x: 500, y: 300, w: 0, h: 0 }, free, 12), true);
  assert.equal(seenEnough({ x: 500, y: 700, w: 0, h: 0 }, free, 12), false);
});

test('seen: a ground bigger than the frame is seen when its middle is', () => {
  assert.equal(seenEnough({ x: -2000, y: 200, w: 5000, h: 3000 }, free, 12), false, 'middle far below, a sliver inside');
  assert.equal(seenEnough({ x: -2000, y: 100, w: 5000, h: 400 }, free, 12), true, 'middle inside');
});

test('too small: no step may leave the pick under 1/6 of the free part (or smaller than it already was)', () => {
  assert.equal(Math.round(minPickPx(free)), Math.round(670 / 6));
  assert.equal(tooSmall(220, 200, free), false, 'still bigger than 1/6');
  assert.equal(tooSmall(220, 60, free), true, 'the ship shrinking to a dot down the road');
  assert.equal(tooSmall(40, 40, free), false, 'a far tree that was small already may stay that size');
  assert.equal(tooSmall(40, 34, free), false, '… a little smaller as it leaves the stretched frame edge');
  assert.equal(tooSmall(40, 20, free), true, '… but not much smaller');
});

const box = (c: number[], half: number) => ({ min: c.map((v) => v - half), max: c.map((v) => v + half) });

test('focus: in a runner the ship is not framed with the whole road (never under 1/6 of the frame)', () => {
  // neon-run's shape: a small ship near the camera, hexagons and a gate far down the road, the road itself long.
  const ship = box([0, 0.6, 4], 0.5);
  const others = [box([-1.5, 0.8, -8], 0.8), box([1.2, 0.8, -12], 0.8), box([0, 1.5, -22], 2), box([0, 1, -16], 0.6)];
  const t = Math.hypot(1, 1, 1) * 0.5;
  const f = focusSphere(ship, others, [0, 0.6, 4]);
  assert.ok(f.radius <= t * 6 + 1e-9, `radius ${f.radius} ≤ 6 × ${t}`);
  assert.deepEqual(f.center, [0, 0.6, 4]);
});
