// The pick's outline while an object moves (studio-fix-0146, 2026-10-24; src/bridge/outline-slide.ts, handles.ts ring()).
// x-motion-0145: ▶ on the timeline with an object picked ran at about 20 frames a second (57 with nothing picked), as
// the outline's shape was measured (three renders) and its ring drawn again on every frame.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { slideOf } from '../src/bridge/outline-slide.ts';

const box = (x: number, y: number, w = 40, h = 60) => ({ x, y, w, h });

test('a box that only slid: the old shape is used again, moved by the shift', () => {
  assert.deepEqual(slideOf([box(100, 200)], [box(130, 190)]), { dx: 30, dy: -10, sized: true });
  // Rounding of the box (a far object's box wobbles by a pixel): still the same shape.
  assert.equal(slideOf([box(100, 200)], [box(130.4, 190, 41, 59)])!.sized, true);
});

test('a box that changed size (a turn, a scale, nearer the camera) is measured again', () => {
  const s = slideOf([box(100, 200)], [box(130, 190, 52, 60)])!;
  assert.equal(s.sized, false);
  // The shift of the middles still slides the old shape until the new one is measured (no outline left behind).
  assert.equal(s.dx, 36);
});

test('several picked: all must slide together, or the shape is measured again', () => {
  assert.equal(slideOf([box(0, 0), box(200, 0)], [box(10, 5), box(210, 5)])!.sized, true);
  assert.equal(slideOf([box(0, 0), box(200, 0)], [box(10, 5), box(240, 5)])!.sized, false, 'one of them moved on its own');
  assert.equal(slideOf([box(0, 0)], [box(0, 0), box(10, 10)]), null, 'another number of boxes');
  assert.equal(slideOf([], []), null);
});

test('▶ with a pick: the path asks the camera alone, the ring is not drawn again for the same mask', () => {
  // The main cause of x-motion-0145's ~20 frames a second: the timeline path's 100+ toScreen calls a frame each ran
  // camera.updateMatrixWorld(true), which updates the game's AudioListener on the camera too (Web Audio ramps).
  const three = readFileSync(new URL('../src/adapters/three/index.ts', import.meta.url), 'utf8');
  const toScreen = three.slice(three.indexOf('toScreen(p) {'), three.indexOf('toScreen(p) {') + 900);
  assert.match(toScreen, /cam\.updateWorldMatrix\(true, false\)/, 'toScreen updates the camera, not its children');
  const handles = readFileSync(new URL('../src/bridge/handles.ts', import.meta.url), 'utf8');
  assert.match(handles, /was\.mask === o\.mask/, 'ring() skips a mask it already drew');
  const input = readFileSync(new URL('../src/bridge/input.ts', import.meta.url), 'utf8');
  assert.match(input, /slideOf\(c\.rects, rects\)/, 'shapeOf slides the last shape');
});
