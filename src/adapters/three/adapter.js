/**
 * The three.js adapter: the StudioAdapter interface (CONTRACT.md, promise 1) for any game written with plain three.js.
 *
 *   import { whenThreeReady } from './adapter.js';
 *   const adapter = await whenThreeReady();   // resolves once the game has a scene, a renderer and a camera
 *   adapter.begin(); adapter.list(); adapter.pickNear(x, y, 12); adapter.grab(key, x, y); adapter.drag(key, x, y); …
 *
 * Requires boot.js to have run before the game (it discovers the scene/renderer and holds the game's frames).
 *
 * Coordinates: every x/y argument is NDC of the game canvas (-1..1, +y up), so the bridge converts pointer events once.
 * Pose = { p: [x, y, z] (local to the parent, metres), r: rotation.y (radians, (-π, π]), s: number | [x, y, z] }.
 * Every mutating call returns the new Pose (or null for an unknown key), so the shell can keep its undo history.
 */

import { collectCandidates } from './keys.js';
import { project, rayFromCamera, rayPlaneY, viewProjOf, wrapAngle } from './math.js';
import { pickNear as pickNearImpl, screenRect, screenShare, worldBox } from './pick.js';
import { createEditView, yawOfCamera } from './camera.js';
import { captureObject } from './capture.js';
import { assetsOf as assetsOfImpl } from './assets.js';
import { focusSphere, sceneSphere } from './focus.js';

const DEG = Math.PI / 180;
const S_MIN = 0.01;
const S_MAX = 1000;

function bootState() {
  const b = globalThis.__studioThree;
  if (!b) throw new Error('studio: boot.js did not run before the game (it must be the first script in <head>)');
  return b;
}

/** Pick the scene the player looks at: the one rendered with a camera, with the most objects. */
function mainScene(boot) {
  let best = null;
  let bestN = -1;
  for (const s of boot.scenes) {
    // a scene counts once it was rendered with a camera, or the game handed us its camera via studio.ready({ camera })
    if (!boot.lastCamera.has(s) && !boot.readyCamera) continue;
    let n = 0;
    s.traverse(() => n++);
    if (n > bestN) (best = s), (bestN = n);
  }
  return best;
}

/** Resolves with an adapter once the game has rendered a scene at least once (or attach() was called). */
export function whenThreeReady({ timeoutMs = 20000 } = {}) {
  const boot = bootState();
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    const tick = () => {
      const scene = mainScene(boot);
      const renderer = boot.renderers.find((r) => r.domElement && r.domElement.isConnected) || boot.renderers[0];
      if (scene && renderer) return resolve(createThreeAdapter({ scene, renderer }));
      if (performance.now() - t0 > timeoutMs) return reject(new Error('studio: no three.js scene was rendered'));
      setTimeout(tick, 50);
    };
    tick();
  });
}

export function createThreeAdapter({ scene, renderer, camera }) {
  const boot = bootState();
  const nativeRender = renderer.__studioRender || renderer.render;
  const gameCamera = () => boot.lastCamera.get(scene) || camera || boot.readyCamera;
  let editing = false;
  let view = null;
  let dirty = true;
  let loopGen = 0; // each begin() starts a new paint loop; an old loop sees a stale generation and stops
  let lastCount = -1;
  let cands = [];
  let byKey = new Map();
  const grabs = new Map();
  const listeners = new Set();
  const restoreDom = [];
  // Objects taken out with remove() (CONTRACT.md §1.8): key → the object and its own `visible`.
  // They stay in the scene graph, hidden, so the keys of the others (name#2, path:…) never shift.
  const removed = new Map();
  let guard = null;
  let origBefore = null;
  // The opening view (polish pass 2026-10-16). `atHome` = the edit camera still stands where the game camera stood
  // (nothing moved it since view.home()); the first pick from there glides to an angle made for editing (settle).
  // `glide` = the running glide's generation (0 = none); any look-around gesture stops it where it is.
  let atHome = false;
  let glide = 0;
  let fogRef = 10;
  const leaveHome = () => { atHome = false; glide = 0; };
  /**
   * Move the edit camera from view state `from` to `to` in 0.6 s (ease in-out), starting at `from`. Any look-around
   * gesture (leaveHome / a new glide) stops it where it is. `done` runs at the end. `stop()` true ends it early (the
   * glide home stops once the person moved the view: atHome went false).
   */
  function glideTo(from, to, done, stop) {
    view.set(from);
    const gen = ++glide;
    const t0 = performance.now();
    const MS = 600;
    const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    const lerp = (a, b, k) => a + (b - a) * k;
    // The short way round (yaw is unbounded after orbiting: 350° → 10° turns 20°, not 340°).
    const yawTo = from.yaw + Math.atan2(Math.sin(to.yaw - from.yaw), Math.cos(to.yaw - from.yaw));
    const step = () => {
      if (gen !== glide || !editing || (stop && stop())) return;
      const t = Math.min(1, (performance.now() - t0) / MS);
      const k = ease(t);
      view.set({
        target: [0, 1, 2].map((i) => lerp(from.target[i], to.target[i], k)),
        // distance on a log scale: a 45 m → 8 m move feels even all the way, not fast then crawling
        distance: Math.exp(lerp(Math.log(from.distance), Math.log(to.distance), k)),
        pitch: lerp(from.pitch, to.pitch, k),
        yaw: lerp(from.yaw, yawTo, k)
      });
      touch();
      if (t < 1) boot.nativeRAF(step);
      else {
        glide = 0;
        if (done) try { done(); } catch (e) { console.warn(e); }
      }
    };
    boot.nativeRAF(step);
  }

  // ---------------------------------------------------------------- helpers
  const canvas = renderer.domElement;
  const cssSize = () => {
    const r = canvas.getBoundingClientRect();
    return [r.width || canvas.width, r.height || canvas.height];
  };
  const aspect = () => {
    const [w, h] = cssSize();
    return w / Math.max(1, h);
  };
  function syncView() {
    if (view) view.apply(aspect());
    scene.updateMatrixWorld(true);
  }
  function refresh() {
    cands = collectCandidates(scene).filter((c) => !removed.has(c.key));
    byKey = new Map(cands.map((c) => [c.key, c]));
    return cands;
  }
  function objectOf(key) {
    let c = byKey.get(key);
    if (!c || !isInScene(c.object)) c = (refresh(), byKey.get(key));
    return c ? c.object : null;
  }
  function isInScene(o) {
    for (let p = o; p; p = p.parent) if (p === scene) return true;
    return false;
  }
  function rotatable(o) {
    return !(o.userData && o.userData.studioRotate === false);
  }
  function scalable(o) {
    return !(o.userData && o.userData.studioScale === false);
  }
  // Tilt (rotation.x / .z) in a pose: `t` is reported whenever the object is tilted at all (absolute values, so a
  // game that already applies a saved tilt at start reads back the same `t`, and a ground the game lays flat with
  // rotation.x = -90° just reports it). A pose WITHOUT `t` leaves the object's x / z as they are — a placement.json
  // written before tilting existed never flattens that ground — except for objects the editor tipped in this
  // session: those go back to the tilt they had when first seen (undo of a tip).
  const baseTilt = new WeakMap();
  const tippedHere = new WeakSet();
  const tiltOf = (o) => {
    if (!baseTilt.has(o)) baseTilt.set(o, [o.rotation.x, o.rotation.z]);
    return baseTilt.get(o);
  };
  let turnPivot = null;
  function poseOf(o) {
    const s = o.scale;
    const uniform = s.x === s.y && s.y === s.z;
    const pose = { p: [o.position.x, o.position.y, o.position.z], r: wrapAngle(o.rotation.y), s: uniform ? s.x : [s.x, s.y, s.z] };
    tiltOf(o);
    if (Math.abs(wrapAngle(o.rotation.x)) > 1e-5 || Math.abs(wrapAngle(o.rotation.z)) > 1e-5) pose.t = [wrapAngle(o.rotation.x), wrapAngle(o.rotation.z)];
    return pose;
  }
  function worldOrigin(o) {
    const e = o.matrixWorld.elements;
    return [e[12], e[13], e[14]];
  }
  /** The rotation axis point: the object's origin (x, z) at the middle height of its world box. */
  function pivotOf(o) {
    const w = worldOrigin(o);
    const b = worldBox(o);
    return b ? [w[0], (b.min[1] + b.max[1]) / 2, w[2]] : w;
  }
  /** Put the object's world origin at `world` (parent transforms respected). */
  function setWorldPosition(o, world) {
    const vec = o.position.clone();
    vec.set(world[0], world[1], world[2]);
    if (o.parent) {
      o.parent.updateWorldMatrix(true, false);
      o.parent.worldToLocal(vec);
    }
    o.position.copy(vec);
    o.updateMatrixWorld(true);
  }
  function kindsOf(o) {
    const loaded = boot.urlOf.has(o) || boot.guessOf.has(o) || (o.geometry && (boot.urlOf.has(o.geometry) || boot.guessOf.has(o.geometry)));
    if (loaded) return ['model', 'object'];
    if (o.isMesh && o.geometry && o.geometry.type) return [o.geometry.type.replace(/(Buffer)?Geometry$/, '').toLowerCase() || 'mesh', 'object'];
    return ['group', 'object'];
  }
  function groupOf(c) {
    const o = c.object;
    if (c.source === 'name' || c.source === 'mark') return String(c.label).replace(/([#._\- ]?\d+)$/, '') || c.label;
    let m = null;
    o.traverse((x) => { if (!m && x.isMesh) m = x; });
    if (!m) return undefined;
    const mat = Array.isArray(m.material) ? m.material[0] : m.material;
    return `shape:${m.geometry.uuid.slice(0, 8)}:${mat ? mat.uuid.slice(0, 8) : ''}`;
  }
  function item(c) {
    const o = c.object;
    const pose = poseOf(o);
    return {
      key: c.key,
      label: c.label,
      kinds: kindsOf(o),
      group: groupOf(c),
      unstable: c.unstable || undefined,
      rotatable: rotatable(o),
      scalable: scalable(o),
      pos: pose.p,
      yaw: pose.r,
      scale: pose.s,
      pose
    };
  }
  // A game render we skipped while holding, or a file that finished loading, may have changed what is on screen.
  boot.on((type) => { if (editing && (type === 'game-render-skipped' || type === 'load')) dirty = true; });
  const emit = (type, detail) => listeners.forEach((fn) => { try { fn(type, detail); } catch (e) { console.warn(e); } });
  const touch = () => { dirty = true; };

  // ---------------------------------------------------------------- drawing while editing
  function draw() {
    syncView();
    const saved = { autoClear: renderer.autoClear, target: renderer.getRenderTarget ? renderer.getRenderTarget() : null };
    // Fog is tuned for the game camera (close to the player). The edit camera is usually much farther away, and the
    // whole map would sink into fog colour. Push the fog out by the edit distance for our own frames only.
    // Only the distance BEYOND the opening view's (the game camera's) counts (polish pass 2026-10-16): the opening
    // view is the player's own picture, haze included; before, a 45 m opening distance thinned a harbour's dusk haze
    // to a fifth and the opening looked flat. `fogRef` = 10 m when the view did not start from the game camera.
    const fog = scene.fog;
    const fogSaved = fog ? { near: fog.near, far: fog.far, density: fog.density } : null;
    if (fog) {
      const d = view.state().distance;
      if (fog.isFog) (fog.near += Math.max(0, d - fogRef)), (fog.far += Math.max(0, d - fogRef));
      else if (fog.isFogExp2) fog.density = fog.density * Math.min(1, fogRef / Math.max(1, d));
    }
    boot.selfRender++;
    try {
      if (renderer.setRenderTarget) renderer.setRenderTarget(null);
      renderer.autoClear = true;
      const [w, h] = cssSize();
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, w, h);
      if (renderer.shadowMap) renderer.shadowMap.needsUpdate = true;
      nativeRender.call(renderer, scene, view.camera);
    } finally {
      boot.selfRender--;
      if (fog && fogSaved) {
        if (fog.isFog) (fog.near = fogSaved.near), (fog.far = fogSaved.far);
        else if (fog.isFogExp2) fog.density = fogSaved.density;
      }
      renderer.autoClear = saved.autoClear;
      if (renderer.setRenderTarget && saved.target) renderer.setRenderTarget(saved.target);
    }
  }
  let beat = 0;
  function loop(gen) {
    if (!editing || gen !== loopGen) return;
    boot.nativeRAF(() => loop(gen));
    // Heartbeat: models that finish loading while we edit change the scene without telling us.
    if (++beat % 15 === 0) {
      let n = 0;
      scene.traverse(() => n++);
      if (n !== lastCount) {
        lastCount = n;
        dirty = true;
        emit('list');
      }
    }
    if (dirty) {
      dirty = false;
      draw();
      emit('frame');
    }
  }

  /** Hide the game's own DOM (HUD, menus, touch sticks) next to the canvas while editing — it would cover objects. */
  function hideOverlays() {
    for (let el = canvas; el && el.parentElement; el = el.parentElement) {
      for (const sib of el.parentElement.children) {
        if (sib === el || sib.hasAttribute('data-studio-keep') || /^(SCRIPT|STYLE|LINK|TEMPLATE)$/.test(sib.tagName)) continue;
        restoreDom.push([sib, sib.style.getPropertyValue('visibility'), sib.style.getPropertyPriority('visibility')]);
        sib.style.setProperty('visibility', 'hidden', 'important');
      }
      if (el.parentElement === document.body) break;
    }
  }
  function showOverlays() {
    for (const [el, val, prio] of restoreDom.splice(0)) {
      if (val) el.style.setProperty('visibility', val, prio);
      else el.style.removeProperty('visibility');
    }
  }

  // ---------------------------------------------------------------- the adapter
  const adapter = {
    kind: 'three',
    dim: '3d',
    get editing() { return editing; },
    get scene() { return scene; },
    get renderer() { return renderer; },

    list() {
      scene.updateMatrixWorld(true);
      return refresh().map(item);
    },

    begin() {
      if (editing) return adapter.list();
      if (!boot.held) boot.hold('begin');
      editing = true;
      const gc = gameCamera();
      gc.updateMatrixWorld(true);
      view = createEditView(gc);
      view.set({ yaw: yawOfCamera(gc) });
      hideOverlays();
      // Keep our framing even if the game's scene.onBeforeRender moves "the camera" it is given (follow cams do).
      origBefore = scene.onBeforeRender;
      guard = function (r, s, cam, ...rest) {
        if (origBefore) origBefore.call(this, r, s, cam, ...rest);
        if (cam === view.camera) view.apply(aspect());
      };
      scene.onBeforeRender = guard;
      addEventListener('resize', touch);
      adapter.view.home();
      dirty = true;
      const gen = ++loopGen;
      boot.nativeRAF(() => loop(gen));
      draw();
      return adapter.list();
    },

    end() {
      if (!editing) return;
      editing = false;
      loopGen++;
      removeEventListener('resize', touch);
      if (scene.onBeforeRender === guard) scene.onBeforeRender = origBefore;
      showOverlays();
      grabs.clear();
      boot.release();
    },

    pickNear(ndcX, ndcY, radiusPx = 12) {
      if (!view) return [];
      syncView();
      refresh();
      return pickNearImpl(cands, view.camera, viewProjOf(view.camera), ndcX, ndcY, radiusPx, cssSize());
    },

    /** Share (0–1) of the canvas the object's on-screen box covers, edges behind the camera included (pick.js screenShare). */
    coverage(key) {
      const o = objectOf(key);
      if (!o || !view) return null;
      syncView();
      return screenShare(o, viewProjOf(view.camera));
    },

    anchor(key) {
      const o = objectOf(key);
      if (!o || !view) return null;
      syncView();
      const box = worldBox(o);
      if (!box) return null;
      const vp = viewProjOf(view.camera);
      const pivot = pivotOf(o);
      const c = project(vp, pivot);
      const [w, h] = cssSize();
      const cr = canvas.getBoundingClientRect();
      const toPx = (nx, ny) => [cr.left + ((nx + 1) / 2) * w, cr.top + ((1 - ny) / 2) * h];
      const front = c[3] > 0;
      const up = project(vp, [pivot[0], pivot[1] + 1, pivot[2]]);
      const e = view.camera.matrixWorld.elements; // camera right = first column
      const side = project(vp, [pivot[0] + e[0], pivot[1] + e[1], pivot[2] + e[2]]);
      const pxPerM = Math.abs(((side[0] - c[0]) / 2) * w);
      // Seen from straight above, 1 m up is 0 px on screen; floor it so the height handle never feels stuck.
      const liftPx = front ? Math.max(Math.abs(((up[1] - c[1]) / 2) * h), pxPerM * 0.5) : 0;
      const rect = screenRect(o, vp);
      const onScreen = front && Math.abs(c[0]) <= 1 && Math.abs(c[1]) <= 1;
      return {
        center: [c[0], c[1]],
        centerPx: toPx(c[0], c[1]),
        front,
        onScreen,
        rect,
        rectPx: rect ? [...toPx(rect[0], rect[3]), ...toPx(rect[2], rect[1])] : null,
        liftPx,
        size: [w, h],
        pose: poseOf(o),
        rotatable: rotatable(o),
        scalable: scalable(o)
      };
    },

    /** Start a move: the press point is caught on the horizontal plane at the pivot height; drag() keeps that offset. */
    grab(key, ndcX, ndcY) {
      const o = objectOf(key);
      if (!o || !view) return false;
      syncView();
      const pivot = pivotOf(o);
      const hit = rayPlaneY(rayFromCamera(view.camera, ndcX, ndcY), pivot[1]);
      if (!hit) return false;
      grabs.set(key, { y: pivot[1], off: [hit[0] - pivot[0], hit[2] - pivot[2]] });
      return true;
    },

    drag(key, ndcX, ndcY) {
      const o = objectOf(key);
      if (!o || !view) return null;
      if (!grabs.has(key) && !adapter.grab(key, ndcX, ndcY)) return poseOf(o);
      syncView();
      const g = grabs.get(key);
      const hit = rayPlaneY(rayFromCamera(view.camera, ndcX, ndcY), g.y);
      if (!hit) return poseOf(o); // pointing at the sky: keep the object where it is
      const w = worldOrigin(o);
      setWorldPosition(o, [hit[0] - g.off[0], w[1], hit[2] - g.off[1]]);
      touch();
      return poseOf(o);
    },

    release(key) {
      grabs.delete(key);
    },

    rotate(key, d) {
      const o = objectOf(key);
      if (!o) return null;
      if (rotatable(o) && isFinite(d)) o.rotation.y = wrapAngle(o.rotation.y + d);
      touch();
      return poseOf(o);
    },

    /**
     * Turn around one WORLD axis (y turn, x tip forward / back, z tip sideways) through the middle of the object's
     * world box. WHY the box middle: models often have their origin at one end (a lamp at its foot, a door at its
     * hinge); turned around that point they swung through a wide arc and left the place they were put. The middle
     * is measured once per gesture (calls on the same object less than 0.4 s apart reuse it): measured again at
     * every step, a long object's box middle wanders as it turns and the turn drifts.
     * `d` is the finger's turn on screen, clockwise positive (as rotate()); the sign follows the axis as the edit
     * camera sees it: an axis pointing away from the camera turns clockwise for a positive angle (right-hand rule).
     */
    turn(key, d, axis = 'y') {
      const o = objectOf(key);
      if (!o) return null;
      if (!rotatable(o) || !Number.isFinite(d) || !view) return poseOf(o);
      tiltOf(o);
      tippedHere.add(o);
      scene.updateMatrixWorld(true);
      const now = performance.now();
      let c;
      if (turnPivot && turnPivot.o === o && now - turnPivot.at < 400) c = turnPivot.c;
      else {
        const b = worldBox(o);
        c = b ? [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2] : worldOrigin(o);
      }
      turnPivot = { o, c, at: now };
      const A = axis === 'x' ? [1, 0, 0] : axis === 'z' ? [0, 0, 1] : [0, 1, 0];
      const e = view.camera.matrixWorld.elements;
      const dot = -(A[0] * e[8] + A[1] * e[9] + A[2] * e[10]); // axis · camera forward (the camera looks along its -z)
      const theta = (Math.abs(dot) < 0.15 ? -1 : Math.sign(dot)) * d;
      // Three's own classes from the object itself (this file imports nothing from three).
      const axisV = o.position.clone().set(A[0], A[1], A[2]);
      const qw = o.quaternion.clone().setFromAxisAngle(axisV, theta);
      const pq = o.quaternion.clone();
      if (o.parent) o.parent.getWorldQuaternion(pq);
      else pq.set(0, 0, 0, 1);
      // The same turn written in the parent's space: pq⁻¹ · qw · pq.
      const ql = pq.clone().invert().multiply(qw).multiply(pq);
      o.quaternion.premultiply(ql);
      const cv = o.position.clone().set(c[0], c[1], c[2]);
      const wp = o.getWorldPosition(o.position.clone());
      const moved = wp.sub(cv).applyQuaternion(qw).add(cv);
      if (o.parent) o.parent.worldToLocal(moved);
      o.position.copy(moved);
      o.updateMatrixWorld(true);
      grabs.delete(key);
      touch();
      return poseOf(o);
    },

    /** The bottom middle of the object's world box, in its parent's space (the space of pose.p). */
    foot(key) {
      const o = objectOf(key);
      if (!o) return null;
      scene.updateMatrixWorld(true);
      const b = worldBox(o);
      if (!b) return null;
      const v = o.position.clone().set((b.min[0] + b.max[0]) / 2, b.min[1], (b.min[2] + b.max[2]) / 2);
      if (o.parent) o.parent.worldToLocal(v);
      return [v.x, v.y, v.z];
    },

    scale(key, factor) {
      const o = objectOf(key);
      if (!o) return null;
      if (scalable(o) && isFinite(factor) && factor > 0) {
        const s = o.scale;
        const f = Math.min(S_MAX / Math.max(s.x, s.y, s.z), Math.max(S_MIN / Math.min(s.x, s.y, s.z), factor));
        s.set(s.x * f, s.y * f, s.z * f);
      }
      touch();
      return poseOf(o);
    },

    nudgeY(key, dy) {
      const o = objectOf(key);
      if (!o) return null;
      if (isFinite(dy) && dy !== 0) {
        scene.updateMatrixWorld(true);
        const w = worldOrigin(o);
        setWorldPosition(o, [w[0], w[1] + dy, w[2]]);
        grabs.delete(key); // the pivot height changed; the next drag re-grabs on the new plane
      }
      touch();
      return poseOf(o);
    },

    /** Absolute pose (undo / redo / loading a placement). Exact: no accumulation of relative moves. */
    setPose(key, pose) {
      const o = objectOf(key);
      if (!o || !pose || !Array.isArray(pose.p) || pose.p.length !== 3 || !pose.p.every(Number.isFinite)) return null;
      o.position.set(pose.p[0], pose.p[1], pose.p[2]);
      if (Number.isFinite(pose.r) && rotatable(o)) o.rotation.y = pose.r;
      if (rotatable(o)) {
        const base = tiltOf(o);
        const t = Array.isArray(pose.t) && pose.t.length === 2 && pose.t.every(Number.isFinite) ? pose.t : tippedHere.has(o) ? base : null;
        if (t) {
          o.rotation.x = t[0];
          o.rotation.z = t[1];
        }
      }
      if (Number.isFinite(pose.s) && pose.s > 0) o.scale.set(pose.s, pose.s, pose.s);
      else if (Array.isArray(pose.s) && pose.s.length === 3 && pose.s.every((x) => Number.isFinite(x) && x > 0)) o.scale.set(pose.s[0], pose.s[1], pose.s[2]);
      o.updateMatrixWorld(true);
      grabs.delete(key);
      touch();
      return poseOf(o);
    },

    /**
     * The on-screen shape of these objects (CONTRACT.md: silhouette), for the editor's selection outline.
     *
     * WHY a matte of the real frame, not a copy of the mesh drawn a little bigger behind it (an "inverted hull"): a
     * hull only works for closed shapes; on an open mesh such as a barrel without a bottom the inside shows through
     * and the whole object turns into a filled blob (found while drawing the rebrand mock, 2026-10-16). Here the
     * objects are drawn alone with the edit camera, once on black and once on white; the difference is the coverage,
     * whatever the object's colours (a black lamp post on black would vanish with a single picture). Only the
     * objects' screen box is copied out. Then the normal frame is drawn again in the same task, so the matte is never
     * on screen. Three renders, but only when the selection or the view changed (the bridge caches it).
     */
    silhouette(keys) {
      if (!view || !editing) return null;
      const objs = keys.map(objectOf).filter(Boolean);
      if (!objs.length) return null;
      syncView();
      scene.updateMatrixWorld(true);
      const vp = viewProjOf(view.camera);
      let r = null;
      for (const o of objs) {
        const q = screenRect(o, vp);
        if (!q) continue;
        if (!r) r = q.slice();
        else (r[0] = Math.min(r[0], q[0])), (r[1] = Math.min(r[1], q[1])), (r[2] = Math.max(r[2], q[2])), (r[3] = Math.max(r[3], q[3]));
      }
      if (!r) return null;
      const cr = canvas.getBoundingClientRect();
      if (!(cr.width > 0 && cr.height > 0)) return null;
      const pr = canvas.width / cr.width;
      const pad = Math.ceil(6 * pr); // room for the outline outside the shape
      const W = canvas.width, H = canvas.height;
      const sx = Math.max(0, Math.floor(((r[0] + 1) / 2) * W) - pad);
      const sy = Math.max(0, Math.floor(((1 - r[3]) / 2) * H) - pad);
      const ex = Math.min(W, Math.ceil(((r[2] + 1) / 2) * W) + pad);
      const ey = Math.min(H, Math.ceil(((1 - r[1]) / 2) * H) + pad);
      const sw = ex - sx, sh = ey - sy;
      if (sw < 2 || sh < 2) return null;
      // Everything that is not one of the objects (or an ancestor of one) is hidden, lights stay.
      const keep = new Set();
      for (const o of objs) for (let n = o; n; n = n.parent) keep.add(n);
      const hidden = [];
      for (const n of keep) {
        if (!n.parent) continue;
        for (const sib of n.parent.children) {
          if (keep.has(sib) || sib.isLight || !sib.visible) continue;
          hidden.push(sib);
          sib.visible = false;
        }
      }
      const clear = { isColor: true, r: 0, g: 0, b: 0, copy(c) { this.r = c.r; this.g = c.g; this.b = c.b; return this; } };
      if (renderer.getClearColor) renderer.getClearColor(clear);
      const saved = { before: scene.onBeforeRender, after: scene.onAfterRender, background: scene.background, clearAlpha: renderer.getClearAlpha ? renderer.getClearAlpha() : 1,
        autoClear: renderer.autoClear, target: renderer.getRenderTarget ? renderer.getRenderTarget() : null };
      scene.onBeforeRender = () => {};
      scene.onAfterRender = () => {};
      const shoot = (white) => {
        scene.background = null;
        renderer.setClearColor(white ? 0xffffff : 0x000000, 1);
        if (renderer.setRenderTarget) renderer.setRenderTarget(null);
        renderer.autoClear = true;
        const [w, h] = cssSize();
        renderer.setScissorTest(false);
        renderer.setViewport(0, 0, w, h);
        nativeRender.call(renderer, scene, view.camera);
        const c = document.createElement('canvas');
        c.width = sw;
        c.height = sh;
        const g = c.getContext('2d', { willReadFrequently: true });
        g.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
        return { c, g };
      };
      let mask = null;
      boot.selfRender++;
      try {
        if (renderer.setClearColor) {
          const onBlack = shoot(false);
          const onWhite = shoot(true);
          const b = onBlack.g.getImageData(0, 0, sw, sh);
          const w = onWhite.g.getImageData(0, 0, sw, sh).data;
          const d = b.data;
          for (let i = 0; i < d.length; i += 4) {
            const gap = (w[i] - d[i] + w[i + 1] - d[i + 1] + w[i + 2] - d[i + 2]) / 3;
            d[i] = d[i + 1] = d[i + 2] = 255;
            // A little threshold: soft edges count, the faint fringe of anti-aliasing does not.
            d[i + 3] = gap < 230 ? 255 : 0;
          }
          onBlack.g.putImageData(b, 0, 0);
          mask = onBlack.c;
        }
      } finally {
        boot.selfRender--;
        scene.onBeforeRender = saved.before;
        scene.onAfterRender = saved.after;
        scene.background = saved.background;
        if (renderer.setClearColor) renderer.setClearColor(clear, saved.clearAlpha);
        renderer.autoClear = saved.autoClear;
        if (renderer.setRenderTarget && saved.target) renderer.setRenderTarget(saved.target);
        for (const n of hidden) n.visible = true;
      }
      draw();
      if (!mask) return null;
      return { x: cr.left + sx / pr, y: cr.top + sy / pr, w: sw / pr, h: sh / pr, mask };
    },

    async capture(key, { size = 128 } = {}) {
      const o = objectOf(key);
      if (!o) return { ok: false };
      const res = captureObject({ renderer, scene, render: nativeRender, boot, baseCamera: view ? view.camera : gameCamera(), yaw: view ? view.state().yaw : 0.6 }, o, size);
      touch();
      if (editing) draw(); // the corner we drew into must not stay on screen until the next frame
      return res;
    },

    assetsOf(key) {
      const o = objectOf(key);
      return o ? assetsOfImpl(o, boot, document.baseURI) : [];
    },

    /**
     * Copy (CONTRACT.md §1.8): a clone of the object (meshes share geometry and materials) added to the same parent,
     * at the same pose, listed under `newKey` through userData.studioKey. Marks inside the clone are dropped so its
     * parts do not take keys like "wheel#2". Skinned meshes need SkeletonUtils.clone and are refused (stand-in).
     */
    clone(key, newKey) {
      const o = objectOf(key);
      if (!o || !o.parent || typeof o.clone !== 'function') return false;
      let skinned = false;
      o.traverse((x) => { if (x.isSkinnedMesh) skinned = true; });
      if (skinned) return false;
      const c = o.clone(true);
      c.traverse((x) => { if (x !== c && x.userData) delete x.userData.studioKey; });
      c.userData = { ...(c.userData || {}), studioKey: newKey };
      // Asset links (assets.js) follow the original's model URL, so the library still knows the file.
      if (boot.urlOf.has(o) && !boot.urlOf.has(c)) boot.urlOf.set(c, boot.urlOf.get(o));
      o.parent.add(c);
      c.updateMatrixWorld(true);
      refresh();
      touch();
      return byKey.has(newKey);
    },

    /** Delete (CONTRACT.md §1.8): hidden and left out of the list; putBack() undoes it exactly. */
    remove(key) {
      const o = objectOf(key);
      if (!o) return false;
      removed.set(key, { o, visible: o.visible });
      o.visible = false;
      grabs.delete(key);
      refresh();
      touch();
      return true;
    },

    putBack(key) {
      const r = removed.get(key);
      if (!r) return false;
      removed.delete(key);
      r.o.visible = r.visible;
      refresh();
      touch();
      return true;
    },

    /** The Object3D behind a key (for tests and the placement loader). */
    objectOf,

    /** 'list' when the scene changed size while editing, 'frame' after each editor repaint. Returns an unsubscribe. */
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    view: {
      orbit(dx, dy) { if (!view) return null; leaveHome(); view.orbit(dx, dy); touch(); return view.state(); },
      pan(dx, dy) { if (!view) return null; leaveHome(); syncView(); view.pan(dx, dy, aspect()); touch(); return view.state(); },
      zoom(factor, ndcX = 0, ndcY = 0) { if (!view) return null; leaveHome(); syncView(); view.zoom(factor, ndcX, ndcY); touch(); return view.state(); },
      /**
       * The opening view: exactly the player's camera (position, direction, lens), so the first picture of the
       * editor is the game's own picture — the light, the water, the composition the game was made with.
       * WHY (polish pass 2026-10-16): the editor used to open on frameAll — the whole map from 50° above. A dusk
       * harbour made to be seen from 4 m over the water became a small dark map. The aim: "as
       * beautiful as the game the moment it opens". Editing from a 2° angle is hard, so the first pick glides up
       * (settle). F (frameAll) still shows everything.
       */
      home(opts) {
        if (!view) return null;
        const gc = gameCamera();
        scene.updateMatrixWorld(true);
        const sph = sceneSphere(refresh().map((c) => worldBox(c.object)).filter(Boolean));
        if (!gc) return adapter.view.frameAll();
        const from = view.state();
        if (sph) view.set({ radius: sph.r });
        view.fromCamera(gc, sph ? sph.c : null);
        fogRef = Math.max(10, view.state().distance);
        atHome = true;
        glide = 0;
        // "Back to the opening view" (⌘K, ⇧F; speed pass 2026-10-17): glide there in 0.6 s, the same move as the
        // first pick's glide but the other way, so the person sees where they came from. Opening the editor jumps.
        if (opts && opts.glide) glideTo(from, view.state(), null, () => !atHome);
        touch();
        return view.state();
      },
      /**
       * After a pick: when the view is still the opening (the game camera, often almost level with the ground),
       * glide in 0.6 s to the object seen from above at an angle made for dragging (30°, a phone 40°), the object
       * and its nearest neighbours in frame (the same framing as focus). Returns false (and does nothing) once the
       * person has looked around, zoomed or framed: from then on the view is theirs and a pick never moves it.
       * `done` runs when the glide ends (the bridge then slides the object clear of its panels).
       */
      settle(key, done) {
        if (!view || !atHome) return false;
        const o = objectOf(key);
        if (!o) return false;
        scene.updateMatrixWorld(true);
        const b = worldBox(o);
        if (!b) return false;
        atHome = false;
        const others = refresh().filter((c) => c.object !== o).map((c) => worldBox(c.object)).filter(Boolean);
        const f = focusSphere(b, others, pivotOf(o));
        const from = view.state();
        const [w, h] = cssSize();
        view.frame(f.center, f.radius, (h > w ? 40 : 30) * DEG);
        glideTo(from, view.state(), done);
        return true;
      },
      /**
       * Put the edit camera back where state() said it was (the shell keeps it across reloads: after Save, Play,
       * the AI's change). A kept opening view (`home: true`) is still the opening view: the first pick after the
       * reload glides as it would have (and the haze stays the game's).
       */
      restore(s) {
        if (!view || !s || typeof s !== 'object') return null;
        const fin = (x) => typeof x === 'number' && Number.isFinite(x);
        if (!Array.isArray(s.target) || s.target.length !== 3 || !s.target.every(fin) || !fin(s.distance) || !(s.distance > 0) || !fin(s.yaw) || !fin(s.pitch)) return null;
        leaveHome();
        if (s.home === true) {
          // The opening pitch may be under the usual 8° floor: set the floor from the game camera again first.
          const gc = gameCamera();
          if (gc) view.fromCamera(gc, null);
          atHome = true;
          fogRef = Math.max(10, s.distance);
        }
        view.set({ target: s.target, distance: s.distance, yaw: s.yaw, pitch: s.pitch });
        touch();
        return adapter.view.state();
      },
      /** True while the view is still the opening one (the game camera's). */
      get atHome() { return atHome; },
      frameAll() {
        if (!view) return null;
        leaveHome();
        scene.updateMatrixWorld(true);
        // Sky domes, seas and huge grounds would make everything else tiny: sceneSphere leaves out boxes far bigger than the typical one.
        const sph = sceneSphere(refresh().map((c) => worldBox(c.object)).filter(Boolean));
        if (!sph) return view.state();
        // A tall screen (a phone) looks down a little more: at 50° the top half of a portrait view was sky.
        const [w, h] = cssSize();
        view.frame(sph.c, sph.r, (h > w ? 62 : 50) * DEG);
        touch();
        return view.state();
      },
      focus(key) {
        const o = objectOf(key);
        if (!o || !view) return null;
        scene.updateMatrixWorld(true);
        const b = worldBox(o);
        if (!b) return view.state();
        // The object and a little of what is around it (focus.js): before, max(r × 2.2, 1.5 m) filled the screen with a barrel.
        const others = refresh().filter((c) => c.object !== o).map((c) => worldBox(c.object)).filter(Boolean);
        const f = focusSphere(b, others, pivotOf(o));
        leaveHome();
        // Below the usual 8° floor (only the opening view goes there) focus lifts to the editing angle; otherwise
        // the person's own pitch stays.
        const pitch = view.state().pitch;
        view.frame(f.center, f.radius, pitch < 8 * DEG ? 30 * DEG : pitch);
        touch();
        return view.state();
      },
      state() { return view ? (atHome ? { ...view.state(), home: true } : view.state()) : null; },
      /** The editor's own camera (for drawing selection marks in the game frame). */
      get camera() { return view ? view.camera : null; }
    }
  };
  return adapter;
}
