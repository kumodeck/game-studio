/**
 * The edit camera: a camera of our own, separate from the game's, orbiting a target point
 * (like the scene view of a game engine). The game camera is never moved, so ending the edit needs no restore.
 *
 * state = { target: [x,y,z], distance, yaw, pitch }
 *   yaw   = angle around the vertical axis (0 = camera on +z looking toward -z, three's default view direction)
 *   pitch = angle above the horizon, kept within 8°..85° (never exactly top-down: yaw would become undefined, and
 *           never below the horizon: you would be looking at the underside of the ground). Exception: the opening
 *           view copies the game's camera (fromCamera), which is often lower — a harbour seen from 4 m over the
 *           water is 2° — so the floor drops to that pitch (never below -20°): orbiting can come back down to the
 *           player's eye line, but not under it.
 *
 * Gestures use fractions of the canvas, not pixels, so they feel the same on a phone and a 4K screen:
 *   orbit(dx, dy): full width = half a turn, full height = 90°; dragging down looks more from above
 *   pan(dx, dy):   the ground under the finger follows the finger (horizontally; the target height never changes)
 *   rise(dy):      camera up (dy > 0) or down, straight up: the target and the camera move together, so the direction
 *                  never changes; dy = 1 is one view height at the target (the scene slides down the screen by its
 *                  full height). The one way to change height — pan keeps it, orbit turns round it, zoom slides along
 *                  the line of sight (camera up / down, play test 2026-10-18: "I can't raise the camera; it's needed").
 *   fly(r, u, f):  WASD — the camera and its turning point together, scaled to the scene; W / S level (see fly)
 *   look(dx, dy):  turn where the camera stands (right-drag while flying); orbit turns round the point in front
 *   zoom(f, x, y): f > 1 moves closer; the point under (x, y) stays under the cursor (the camera slides along the line
 *                  through that point — exact for perspective)
 */

import { rayFromCamera, rayPlaneY, v } from './math.js';

const DEG = Math.PI / 180;
export const PITCH_MIN = 8 * DEG;
export const PITCH_MAX = 85 * DEG;
/** Fly speed (WASD): 0.8 of the distance to the turning point per second (see fly) — the first value (2026-10-18), about
 * a screen's depth a second; tune it here after people try it. Shift (the bridge) = ×3, as engines' "fast". */
export const FLY_PER_S = 0.8;

export function createEditView(gameCamera) {
  // clone() keeps the game's camera type and three version (we cannot `new` a class we did not import).
  // We keep only the lens; position and orientation are ours.
  const cam = gameCamera.clone(false);
  cam.name = 'studio-edit-camera';
  cam.userData = { studio: false };
  // The game's own lens when it is a usual one, so the opening picture is the player's picture (polish pass
  // 2026-10-16). Before: clamped to 45..70°, so a 42° game camera came out wider than the game.
  if (cam.isPerspectiveCamera) cam.fov = Math.max(30, Math.min(75, gameCamera.fov || 50));
  const st = { target: [0, 0, 0], distance: 10, yaw: 0, pitch: 50 * DEG, radius: 10, floor: PITCH_MIN };
  const orthoBase = cam.isOrthographicCamera ? { zoom: cam.zoom || 1, height: cam.top - cam.bottom } : null;

  function apply(aspect) {
    const cp = Math.cos(st.pitch);
    const pos = [st.target[0] + st.distance * cp * Math.sin(st.yaw), st.target[1] + st.distance * Math.sin(st.pitch), st.target[2] + st.distance * cp * Math.cos(st.yaw)];
    cam.position.set(pos[0], pos[1], pos[2]);
    cam.up.set(0, 1, 0);
    cam.lookAt(st.target[0], st.target[1], st.target[2]);
    // near/far follow the zoom: a fixed near would clip close-ups, a fixed far would clip "frame all" on big maps
    cam.near = Math.max(0.01, st.distance / 500);
    cam.far = Math.max(1000, (st.distance + st.radius * 4) * 4);
    if (aspect && cam.isPerspectiveCamera) cam.aspect = aspect;
    if (orthoBase) {
      // ortho: "distance" maps to zoom so the same gestures work
      cam.zoom = orthoBase.zoom * (orthoBase.height / Math.max(1e-6, 2 * st.distance * Math.tan(25 * DEG)));
      if (aspect) {
        const h = (cam.top - cam.bottom) / 2;
        cam.left = -h * aspect;
        cam.right = h * aspect;
      }
    }
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
  }

  function clampPitch() {
    st.pitch = Math.min(PITCH_MAX, Math.max(st.floor, st.pitch));
  }
  function clampDistance() {
    // 0.3 m lets you inspect a small prop; 8× the scene radius is "far enough to see everything, small"
    st.distance = Math.min(Math.max(0.3, st.distance), Math.max(60, st.radius * 8));
  }
  /** Where the camera stands (apply()'s position, from the state, so it is right before the next apply too). */
  function eyeOf() {
    const cp = Math.cos(st.pitch);
    return [st.target[0] + st.distance * cp * Math.sin(st.yaw), st.target[1] + st.distance * Math.sin(st.pitch), st.target[2] + st.distance * cp * Math.cos(st.yaw)];
  }
  function viewHeight() {
    return cam.isPerspectiveCamera ? 2 * st.distance * Math.tan((cam.fov * DEG) / 2) : 2 * st.distance * Math.tan(25 * DEG);
  }

  return {
    camera: cam,
    apply,
    state: () => ({ target: st.target.slice(), distance: st.distance, yaw: st.yaw, pitch: st.pitch }),
    set(s) {
      if (s.target) st.target = s.target.slice();
      if (s.distance) st.distance = s.distance;
      if (s.yaw != null) st.yaw = s.yaw;
      if (s.pitch != null) st.pitch = s.pitch;
      if (s.radius) st.radius = s.radius;
      clampPitch();
      clampDistance();
    },
    orbit(dx, dy) {
      st.yaw -= dx * Math.PI;
      st.pitch += dy * (Math.PI / 2);
      clampPitch();
    },
    pan(dx, dy, aspect) {
      const h = viewHeight();
      const w = h * (aspect || 1);
      const right = [Math.cos(st.yaw), 0, -Math.sin(st.yaw)];
      const fwd = [-Math.sin(st.yaw), 0, -Math.cos(st.yaw)]; // horizontal, from the camera toward the target
      const k = 1 / Math.max(0.15, Math.sin(st.pitch)); // a screen-height of drag covers more ground when looking flat
      st.target = v.add(st.target, v.add(v.scale(right, -dx * w), v.scale(fwd, dy * h * k)));
    },
    rise(dy) {
      // Bound like the distance: far enough to look down on the whole scene, never a camera lost kilometres away.
      // Before 2026-10-18 the target's height was fixed by the opening view / frame (no way to change it at all).
      const lim = Math.max(60, st.radius * 8);
      st.target[1] = Math.min(lim, Math.max(-lim, st.target[1] + dy * viewHeight()));
    },
    /**
     * Fly (WASD, camera-wasd pass 2026-10-18: "anyone who has used a 3D game engine moves the camera with WASD too"):
     * move the camera and the point it turns round together by `right` / `up` / `fwd`, each in seconds of travel at
     * the normal speed (the bridge passes the frame's dt; Shift multiplies it).
     * fwd is LEVEL (wasd-level pass 2026-10-19, from a try of the editor: "W/S as level forward / back looks better"): along the
     * ground the way the camera faces, so looking down at the harbour W glides over it at the same height instead of
     * diving into the water. The height changes only with up (E / Q, straight up / down — the same as rise). This is
     * Blender's Walk with gravity and Godot's "Fully Axis-Locked" freelook; Unreal / Unity / Godot's default fly
     * follows the line of sight instead (which is what this did on 2026-10-18 — we chose level because an editor
     * camera here mostly looks down on a level, and diving lost the scene).
     * right is level too (as before). Looking straight down never happens (pitch ≤ 85°), so the level direction is
     * always defined by yaw.
     * Speed: FLY_PER_S of the distance to the turning point, kept within 0.25–2 scene radii — the view crosses
     * about the same share of the screen per second in a small room and on Lantern Cove, slows down close to a
     * small prop, and never crawls (or races) when zoomed very far in (or out). The same speed level or not: W at a
     * steep look-down moves a full step over the ground (the old look-along W moved only cos(pitch) of it).
     * The height keeps rise's bound; sideways has none, as pan (engines let you fly anywhere, under the ground too).
     */
    fly(right, up, fwd) {
      const sp = FLY_PER_S * Math.min(Math.max(st.distance, st.radius * 0.25), st.radius * 2);
      const ahead = [-Math.sin(st.yaw), 0, -Math.cos(st.yaw)]; // level, the way the camera faces (as pan's fwd)
      const side = [Math.cos(st.yaw), 0, -Math.sin(st.yaw)];
      st.target = v.add(st.target, v.scale(v.add(v.add(v.scale(side, right), [0, up, 0]), v.scale(ahead, fwd)), sp));
      const lim = Math.max(60, st.radius * 8);
      st.target[1] = Math.min(lim, Math.max(-lim, st.target[1]));
    },
    /**
     * Turn the view where the camera stands (a fly-through look: right-drag while flying, as engines do), instead of
     * turning round the point in front (orbit). Same signs and sensitivity as orbit: right = turn right, up = look up;
     * the pitch keeps orbit's limits, so a later orbit never jumps.
     */
    look(dx, dy) {
      const eye = eyeOf();
      st.yaw -= dx * Math.PI;
      st.pitch += dy * (Math.PI / 2);
      clampPitch();
      const cp = Math.cos(st.pitch);
      st.target = v.sub(eye, v.scale([cp * Math.sin(st.yaw), Math.sin(st.pitch), cp * Math.cos(st.yaw)], st.distance));
    },
    zoom(factor, ndcX = 0, ndcY = 0) {
      const f = Math.min(5, Math.max(0.2, factor));
      const before = st.distance;
      st.distance /= f;
      clampDistance();
      const k = 1 - st.distance / before; // fraction of the way toward the pointed point
      if (k === 0) return;
      const p = rayPlaneY(rayFromCamera(cam, ndcX, ndcY), st.target[1]);
      if (p && v.len(v.sub(p, st.target)) < st.radius * 20 + 100) st.target = v.add(st.target, v.scale(v.sub(p, st.target), k));
    },
    /**
     * Stand exactly where `gameCamera` stands, looking where it looks (the opening view: the first picture of the
     * editor is the player's picture). The orbit point is on the line of sight, as far as the middle of the scene
     * (`center`), so a drag turns around the scene, not around the camera. Assumes a camera without roll (lookAt
     * with +y up, as almost every game camera is); a rolled camera opens level.
     */
    fromCamera(gameCamera, center) {
      gameCamera.updateMatrixWorld(true);
      const e = gameCamera.matrixWorld.elements;
      const pos = [e[12], e[13], e[14]];
      const len = Math.hypot(e[8], e[9], e[10]) || 1;
      const dir = [-e[8] / len, -e[9] / len, -e[10] / len]; // a camera looks along its local -z
      let d;
      if (orthoBase) d = orthoBase.height / (2 * Math.tan(25 * DEG)); // the distance that gives the game's own zoom
      else {
        d = center ? v.dot(v.sub(center, pos), dir) : 0;
        if (!(d > 1)) d = Math.max(1, st.radius);
      }
      st.pitch = Math.asin(Math.max(-1, Math.min(1, -dir[1])));
      st.floor = Math.max(-20 * DEG, Math.min(PITCH_MIN, st.pitch));
      st.yaw = Math.hypot(dir[0], dir[2]) < 1e-6 ? st.yaw : Math.atan2(-dir[0], -dir[2]);
      st.distance = d;
      st.radius = Math.max(st.radius, d / 4);
      st.target = v.add(pos, v.scale(dir, d));
      clampPitch();
      // No clampDistance(): the game camera may be farther out than the editor's own limit; the next zoom clamps.
    },
    /** Look at a sphere (centre, radius) from the current yaw at the given pitch. */
    frame(center, radius, pitch = 50 * DEG) {
      const r = Math.max(radius, 0.25);
      st.radius = Math.max(st.radius, r);
      st.target = center.slice();
      st.pitch = pitch;
      const half = cam.isPerspectiveCamera ? (Math.min(cam.fov, cam.fov * (cam.aspect || 1)) * DEG) / 2 : 25 * DEG;
      st.distance = (r / Math.sin(half)) * 1.05;
      clampPitch();
      clampDistance();
    }
  };
}

/** Yaw (our convention) of the direction a camera looks in, so the edit view starts facing the way the player did. */
export function yawOfCamera(camera) {
  const e = camera.matrixWorld.elements;
  // camera looks along its local -z: world direction = -(third column)
  const dx = -e[8];
  const dz = -e[10];
  if (Math.hypot(dx, dz) < 1e-6) return 0;
  return Math.atan2(-dx, -dz);
}
