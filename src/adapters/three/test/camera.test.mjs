// The opening view (camera.js fromCamera, polish pass 2026-10-16): the edit camera stands exactly where the game's
// camera stands and looks the same way, even when that is almost level with the ground (below the usual 8° floor),
// and orbiting can come back down to that eye line but not under it.
// Run: node --test src/adapters/three/test/camera.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createEditView, PITCH_MIN } from '../camera.js';

const sub = (a, b) => a.map((x, i) => x - b[i]);
const norm = (a) => { const l = Math.hypot(...a); return a.map((x) => x / l); };

/** A stand-in for a three camera: only what camera.js reads (clone, fov, matrixWorld) and writes. */
function fakeCamera(pos, look, fov = 42) {
  const z = norm(sub(pos, look)); // a camera's local +z points backwards
  const cam = {
    isPerspectiveCamera: true,
    fov,
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
  return cam;
}

test('the opening view is the game camera: same place, same direction, same lens', () => {
  const pos = [8, 4.2, 35], look = [-1, 2.6, -14];
  const gc = fakeCamera(pos, look, 42);
  const view = createEditView(gc);
  view.fromCamera(gc, [-2, 2, -12]);
  view.apply(1.6);
  const cam = view.camera;
  assert.equal(cam.fov, 42, 'the game lens is kept (it used to become 45°)');
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(cam.at[i] - pos[i]) < 1e-6, `position ${cam.at} vs ${pos}`);
  const want = norm(sub(look, pos));
  const got = norm(sub(cam.looking, cam.at));
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(want[i] - got[i]) < 1e-6, `direction ${got} vs ${want}`);
  const s = view.state();
  assert.ok(s.pitch < PITCH_MIN, 'a near-level game camera stays near level');
  // The orbit point is on the line of sight, as far as the middle of the scene.
  assert.ok(s.distance > 40 && s.distance < 60, `orbit distance ${s.distance}`);
});

test('orbiting can come back down to the eye line, never under it', () => {
  const gc = fakeCamera([0, 2, 20], [0, 1.5, 0]);
  const view = createEditView(gc);
  view.fromCamera(gc, [0, 0, 0]);
  const p0 = view.state().pitch;
  view.orbit(0, -0.5); // drag up = flatter
  assert.ok(Math.abs(view.state().pitch - p0) < 1e-9, 'went under the opening eye line');
  view.orbit(0, 0.4);
  assert.ok(view.state().pitch > p0 + 0.5, 'could not look from higher');
  view.orbit(0, -1);
  assert.ok(Math.abs(view.state().pitch - p0) < 1e-9, 'did not come back down to the eye line');
});

test('a camera looking up stays a camera looking up, but never more than 20° under the horizon', () => {
  const gc = fakeCamera([0, 1, 10], [0, 30, 0]);
  const view = createEditView(gc);
  view.fromCamera(gc, [0, 0, 0]);
  assert.ok(Math.abs(view.state().pitch + (20 * Math.PI) / 180) < 1e-9);
});
