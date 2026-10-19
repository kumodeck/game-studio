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

// Camera up / down (play test 2026-10-18: "I can't raise the camera"): rise moves the camera and the point it turns
// round straight up together, so the direction (yaw, pitch) and the distance stay; pan never changed the height.
test('rise moves the camera straight up and down, looking the same way', () => {
  const gc = fakeCamera([0, 4, 20], [0, 1, 0]);
  const view = createEditView(gc);
  view.fromCamera(gc, [0, 0, 0]);
  view.apply(1.6);
  const s0 = view.state();
  const at0 = view.camera.at.slice();
  view.rise(0.5);
  view.apply(1.6);
  const s1 = view.state();
  assert.equal(s1.yaw, s0.yaw, 'yaw changed');
  assert.equal(s1.pitch, s0.pitch, 'pitch changed');
  assert.equal(s1.distance, s0.distance, 'distance changed');
  const up = view.camera.at[1] - at0[1];
  assert.ok(up > 1, `the camera went up by only ${up}`);
  assert.ok(Math.abs(view.camera.at[0] - at0[0]) < 1e-9 && Math.abs(view.camera.at[2] - at0[2]) < 1e-9, 'the camera moved sideways');
  assert.ok(Math.abs(s1.target[1] - s0.target[1] - up) < 1e-9, 'the target did not go up with the camera');
  view.rise(-0.5);
  assert.ok(Math.abs(view.state().target[1] - s0.target[1]) < 1e-9, 'down by the same amount did not come back');
  view.pan(0.2, 0.3, 1.6);
  assert.ok(Math.abs(view.state().target[1] - s0.target[1]) < 1e-9, 'pan changed the height');
  view.rise(1e6);
  assert.ok(view.state().target[1] <= Math.max(60, 8 * 20) + 1e-9, 'rise is not bounded');
});

// Fly (WASD, camera-wasd 2026-10-18: "anyone who has used a 3D game engine moves the camera with WASD too"): fly moves
// the camera and its turning point together — forward along the line of sight, right level, up straight up — at a
// speed taken from the scene, so a small room and a big harbour feel the same; look turns where the camera stands.
const eyeOf = (view) => (view.apply(1.6), view.camera.at.slice());
const lookOf = (view) => norm(sub(view.camera.looking, view.camera.at));

test('fly: W follows the line of sight, D goes level to the right, E straight up, the view keeps its direction', () => {
  const gc = fakeCamera([0, 6, 20], [0, 1, 0]);
  const view = createEditView(gc);
  view.fromCamera(gc, [0, 0, 0]);
  const s0 = view.state();
  const e0 = eyeOf(view);
  const dir = lookOf(view);
  view.fly(0, 0, 1);
  const e1 = eyeOf(view);
  const moved = sub(e1, e0);
  const len = Math.hypot(...moved);
  assert.ok(len > 0.1, `W moved ${len}`);
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(moved[i] / len - dir[i]) < 1e-9, `W went ${moved}, the view looks ${dir}`);
  for (const k of ['yaw', 'pitch', 'distance']) assert.equal(view.state()[k], s0[k], `W changed ${k}`);
  view.fly(0, 0, -1);
  const back = eyeOf(view);
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(back[i] - e0[i]) < 1e-9, 'S did not come back to the same place');
  view.fly(1, 0, 0);
  const right = sub(eyeOf(view), e0);
  assert.ok(right[0] > 0.1 && Math.abs(right[1]) < 1e-9 && Math.abs(right[2]) < 1e-9, `D went ${right} (yaw 0 looks at -z: right is +x)`);
  view.fly(-1, 1, 0);
  const up = sub(eyeOf(view), e0);
  assert.ok(up[1] > 0.1 && Math.abs(up[0]) < 1e-9 && Math.abs(up[2]) < 1e-9, `E went ${up}`);
});

test('fly: the speed follows the scene — the same share of the view per second in a small and a big scene', () => {
  const share = (k) => {
    const gc = fakeCamera([0, 6 * k, 20 * k], [0, k, 0]);
    const view = createEditView(gc);
    view.set({ radius: 15 * k });
    view.fromCamera(gc, [0, 0, 0]);
    const e0 = eyeOf(view);
    view.fly(1, 0, 0);
    return Math.hypot(...sub(eyeOf(view), e0)) / view.state().distance;
  };
  const small = share(0.1), big = share(10);
  assert.ok(small > 0.2 && small < 2, `one second moves ${small} of the distance`);
  assert.ok(Math.abs(small - big) < 1e-9, `small scene ${small}, big scene ${big}`);
});

test('fly up / down keeps rise’s bound (sideways is free, as pan)', () => {
  const gc = fakeCamera([0, 4, 20], [0, 1, 0]);
  const view = createEditView(gc);
  view.fromCamera(gc, [0, 0, 0]);
  view.fly(0, 1e6, 0);
  assert.ok(view.state().target[1] <= Math.max(60, 8 * 20) + 1e-9, 'fly up is not bounded');
  view.fly(1e3, 0, 0);
  assert.ok(view.state().target[0] > 100, 'fly sideways is bounded');
});

test('look turns where the camera stands (right-drag while flying), orbit turns round the point in front', () => {
  const gc = fakeCamera([0, 6, 20], [0, 1, 0]);
  const view = createEditView(gc);
  view.fromCamera(gc, [0, 0, 0]);
  const e0 = eyeOf(view);
  const d0 = lookOf(view);
  view.look(0.1, 0.05);
  const e1 = eyeOf(view);
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(e1[i] - e0[i]) < 1e-9, `look moved the camera ${e0} → ${e1}`);
  const d1 = lookOf(view);
  assert.ok(d1[0] > d0[0] + 0.05, `dragging right did not turn right (${d0} → ${d1})`);
  view.look(0, -10);
  assert.ok(view.state().pitch >= (-20 * Math.PI) / 180 - 1e-9, 'look went under orbit’s floor');
  view.orbit(0.1, 0);
  assert.ok(Math.hypot(...sub(eyeOf(view), e1)) > 0.1, 'orbit should move the camera round the point in front');
});
