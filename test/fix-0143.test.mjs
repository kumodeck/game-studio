// studio-fix-0143 (⑨ B of the first-run check, a review of 2026-10-24): with the timeline plate up, an object picked from
// the list is shown without the camera pulling back — the plate folds to its line, and the view at most slides across
// the picture (camera.js slide). This checks the slide itself: nothing gets nearer or farther, so every size stays.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createEditView } from '../src/adapters/three/camera.js';

const sub = (a, b) => a.map((x, i) => x - b[i]);
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
const norm = (a) => { const l = Math.hypot(...a); return a.map((x) => x / l); };

/** A stand-in for a three camera (only what camera.js reads and writes), as src/adapters/three/test/camera.test.mjs. */
function fakeCamera(pos, look, fov = 42) {
  const z = norm(sub(pos, look));
  return {
    isPerspectiveCamera: true, fov,
    matrixWorld: { elements: [1, 0, 0, 0, 0, 1, 0, 0, z[0], z[1], z[2], 0, pos[0], pos[1], pos[2], 1] },
    updateMatrixWorld() {},
    clone() {
      const c = { isPerspectiveCamera: true, fov, userData: {}, at: null, looking: null };
      c.position = { set: (x, y, zz) => (c.at = [x, y, zz]) };
      c.up = { set() {} };
      c.lookAt = (x, y, zz) => (c.looking = [x, y, zz]);
      c.updateProjectionMatrix = () => {};
      c.updateMatrixWorld = () => {};
      return c;
    },
  };
}
/** Depth of `p` along the line of sight (what a perspective picture divides by: the same depth = the same size). */
function depth(view, p) {
  view.apply(1.6);
  const eye = view.camera.at, dir = norm(sub(view.camera.looking, eye));
  return dot(sub(p, eye), dir);
}

test('slide: up / down and sideways keep the depth of every point (sizes stay), turn and distance stay', () => {
  // Near-level and turned, like neon's runner (pitch ≈ 11°): where pan(0, dy) pulled the ship 144 → 47 px.
  const gc = fakeCamera([3, 2.4, 14], [0, 0.6, -6]);
  const view = createEditView(gc);
  view.fromCamera(gc, [0, 0.6, -6]);
  const s0 = view.state();
  const pts = [[0, 0, 8], [2, 1, -3], [-4, 0, -20]];
  const d0 = pts.map((p) => depth(view, p));
  const e0 = (view.apply(1.6), view.camera.at.slice());
  view.slide(0, 0.3, 1.6);
  const d1 = pts.map((p) => depth(view, p));
  for (let i = 0; i < pts.length; i++) assert.ok(Math.abs(d1[i] - d0[i]) < 1e-9, `up / down changed a depth ${d0[i]} → ${d1[i]}`);
  for (const k of ['yaw', 'pitch', 'distance']) assert.equal(view.state()[k], s0[k], `slide changed ${k}`);
  const e1 = (view.apply(1.6), view.camera.at.slice());
  assert.ok(e1[1] > e0[1], 'dy > 0 did not move the camera up (the scene goes down the screen)');
  view.slide(0.2, 0, 1.6);
  const d2 = pts.map((p) => depth(view, p));
  for (let i = 0; i < pts.length; i++) assert.ok(Math.abs(d2[i] - d0[i]) < 1e-9, `sideways changed a depth ${d0[i]} → ${d2[i]}`);
  view.slide(-0.2, -0.3, 1.6);
  const back = view.state().target;
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(back[i] - s0.target[i]) < 1e-9, 'the same slide back did not come back');
});

test('pan up / down (what a list pick did before) does change the depth — the pull back slide avoids', () => {
  const gc = fakeCamera([3, 2.4, 14], [0, 0.6, -6]);
  const view = createEditView(gc);
  view.fromCamera(gc, [0, 0.6, -6]);
  const p = [0, 0, 8];
  const d0 = depth(view, p);
  view.pan(0, -0.3, 1.6);
  assert.ok(Math.abs(depth(view, p) - d0) > 1, 'pan kept the depth: this test no longer shows why slide exists');
});
