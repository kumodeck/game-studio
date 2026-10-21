/**
 * Surfaces to set things on: ray casts against the scene's own meshes (the ground, a pier's planks, a crate's lid),
 * for the "snap to surfaces" moves (a request after a try of the editor, 2026-10-19: "in Unreal, an object moved up or down stops once when it
 * meets the ground or another thing — I want to set things down exactly on the ground; that feature is needed").
 * adapter.js uses it for three things: the height drag stops on the first surface below (bridge/snap.ts holds the
 * rule), a move keeps the object standing on whatever is under it, and "Drop to floor" (End) sets it on the surface
 * below. No three.js import (as pick.js): plain arrays, the scene's own matrices.
 *
 * What counts as a surface:
 * - every visible mesh in the scene, listed or not (a ground the game marks userData.studio = false, a ground the
 *   editor holds still — the "safe edit" pass — are still floors: they only cannot be moved);
 * - but not: the moving objects themselves and their children (`skip`), skinned meshes (their positions are the bind
 *   pose, not what is drawn), instanced / batched meshes (one geometry drawn in many places), lines, points, sprites,
 *   wireframes, and see-through light effects — additive blending, transparent with no depth write, or nearly clear
 *   (Lantern Cove's lighthouse beam is two additive cards: a barrel must not land on a ray of light). Water drawn as a
 *   transparent plane that writes depth (Lantern Cove's sea) does count: a barrel set on the sea sits on the water.
 * - Only the side of a face that looks at the ray (a FrontSide face hit from behind is the inside of a solid, e.g. a
 *   ray that starts inside a pier post), and for "something to stand on" only faces turned up: normal y ≥ `minUp`
 *   (0.5 = slopes up to 60°; a wall is not a floor).
 *
 * Speed: Lantern Cove's terrain is 106 k triangles, and the move asks once per pointer move. Each mesh's triangles
 * are copied into world space once and sorted into a grid of xz cells (meshes of GRID_MIN_TRIS or more); a vertical
 * ray reads one cell, a slanted one the cells under its path. The copy is kept until the mesh, its geometry or its
 * matrix changes (WeakMap per mesh), so a dragged crate is re-copied while it moves (small) and the terrain never is.
 */
import { applyM4, boxCorners, rayBox, rayTriangle, v } from './math.js';

/** Meshes with at least this many triangles get a grid; smaller ones are tested whole (a crate: 12). */
const GRID_MIN_TRIS = 2000;
/** Most cells per side of a grid (64² = 4096 cells; ~26 triangles per cell for the terrain). */
const GRID_MAX = 64;
/** Rays that would visit more cells than this (a ray grazing a huge sea) test the whole mesh instead. */
const MAX_STEPS = 512;

const FRONT = 0;
const BACK = 1;
const ADDITIVE = 2; // THREE.AdditiveBlending

/** Can this material be stood on? (see the header: light effects and wireframes cannot). */
function solidMaterial(m) {
  if (!m || m.visible === false || m.wireframe) return false;
  if (m.blending === ADDITIVE) return false;
  if (m.transparent && (m.depthWrite === false || (typeof m.opacity === 'number' && m.opacity < 0.3))) return false;
  return true;
}

/**
 * The world box of the parts of `object` that could stand on something — its solid meshes, as surfaceMeshes() counts
 * them (no light effects, wireframes, lines…) — or null when it has none. The snapping moves measure the foot from it.
 * WHY not the whole box (review 3 of 2026-10-20): Lantern Cove's lighthouse box held its two 28 m light beams, so the
 * "bottom middle" foot was nowhere under the tower and the five rays of surfaceBelow() looked at hills 14 m away;
 * dragged 20 px it jumped 8 m.
 */
export function solidBox(object) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let any = false;
  const walk = (o) => {
    if (!o.visible) return;
    if (o.isMesh && o.geometry && o.geometry.attributes && o.geometry.attributes.position) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const g = o.geometry;
      if (!g.boundingBox && typeof g.computeBoundingBox === 'function') g.computeBoundingBox();
      const b = g.boundingBox;
      if (mats.some(solidMaterial) && b && isFinite(b.min.x) && isFinite(b.max.x)) {
        for (const c of boxCorners([b.min.x, b.min.y, b.min.z], [b.max.x, b.max.y, b.max.z])) {
          const p = applyM4(o.matrixWorld.elements, c);
          for (let i = 0; i < 3; i++) (min[i] = Math.min(min[i], p[i])), (max[i] = Math.max(max[i], p[i]));
        }
        any = true;
      }
    }
    for (const c of o.children) walk(c);
  };
  walk(object);
  return any ? { min, max } : null;
}

/**
 * The meshes things can be set on, minus `skip` (a Set of Object3D: their whole subtrees are left out).
 * @returns {object[]} meshes, matrices as they are now (call scene.updateMatrixWorld first)
 */
export function surfaceMeshes(scene, skip) {
  const out = [];
  const walk = (o) => {
    if (!o.visible || (skip && skip.has(o))) return;
    if (o.isMesh && !o.isSkinnedMesh && !o.isInstancedMesh && !o.isBatchedMesh && o.geometry && o.geometry.attributes && o.geometry.attributes.position) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      if (mats.some(solidMaterial)) out.push(o);
    }
    for (const c of o.children) walk(c);
  };
  walk(scene);
  return out;
}

/** Side of a mesh's (first) material: 0 front, 1 back, 2 double. */
function sideOf(mesh) {
  const m = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  return m && typeof m.side === 'number' ? m.side : FRONT;
}

/** The world-space triangles (and grid) of one mesh, cached while nothing about it changes. */
const cache = new WeakMap();
function sameMatrix(a, b) {
  for (let i = 0; i < 16; i++) if (a[i] !== b[i]) return false;
  return true;
}
function trianglesOf(mesh) {
  const g = mesh.geometry;
  const pos = g.attributes.position;
  const index = g.index;
  const e = mesh.matrixWorld.elements;
  const c = cache.get(mesh);
  if (c && c.geo === g && c.pv === pos.version && c.iv === (index ? index.version : -1) && sameMatrix(c.m, e)) return c;
  const start = Math.max(0, (g.drawRange && g.drawRange.start) || 0);
  const total = index ? index.count : pos.count;
  const end = Math.min(total, start + (g.drawRange && isFinite(g.drawRange.count) ? g.drawRange.count : total));
  const n = Math.max(0, Math.floor((end - start) / 3));
  const tri = new Float64Array(n * 9);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let t = 0; t < n; t++) {
    for (let k = 0; k < 3; k++) {
      const i = start + t * 3 + k;
      const vi = index ? index.getX(i) : i;
      const x = pos.getX(vi), y = pos.getY(vi), z = pos.getZ(vi);
      const w = e[3] * x + e[7] * y + e[11] * z + e[15] || 1;
      const wx = (e[0] * x + e[4] * y + e[8] * z + e[12]) / w;
      const wy = (e[1] * x + e[5] * y + e[9] * z + e[13]) / w;
      const wz = (e[2] * x + e[6] * y + e[10] * z + e[14]) / w;
      const o = t * 9 + k * 3;
      tri[o] = wx; tri[o + 1] = wy; tri[o + 2] = wz;
      if (wx < min[0]) min[0] = wx; if (wx > max[0]) max[0] = wx;
      if (wy < min[1]) min[1] = wy; if (wy > max[1]) max[1] = wy;
      if (wz < min[2]) min[2] = wz; if (wz > max[2]) max[2] = wz;
    }
  }
  const out = { geo: g, pv: pos.version, iv: index ? index.version : -1, m: e.slice(), tri, n, min, max, grid: null };
  if (n >= GRID_MIN_TRIS && isFinite(min[0])) out.grid = buildGrid(out);
  cache.set(mesh, out);
  return out;
}

/** xz grid: each cell lists the triangles whose xz box overlaps it. */
function buildGrid(T) {
  const N = Math.max(1, Math.min(GRID_MAX, Math.ceil(Math.sqrt(T.n / 8))));
  const sx = Math.max(1e-9, (T.max[0] - T.min[0]) / N);
  const sz = Math.max(1e-9, (T.max[2] - T.min[2]) / N);
  const cells = Array.from({ length: N * N }, () => []);
  const cx = (x) => Math.min(N - 1, Math.max(0, Math.floor((x - T.min[0]) / sx)));
  const cz = (z) => Math.min(N - 1, Math.max(0, Math.floor((z - T.min[2]) / sz)));
  for (let t = 0; t < T.n; t++) {
    const o = t * 9;
    const x0 = cx(Math.min(T.tri[o], T.tri[o + 3], T.tri[o + 6])), x1 = cx(Math.max(T.tri[o], T.tri[o + 3], T.tri[o + 6]));
    const z0 = cz(Math.min(T.tri[o + 2], T.tri[o + 5], T.tri[o + 8])), z1 = cz(Math.max(T.tri[o + 2], T.tri[o + 5], T.tri[o + 8]));
    for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) cells[j * N + i].push(t);
  }
  return { N, sx, sz, cells, cx, cz };
}

/** Triangle indices to test for this ray (all of them without a grid; else the cells under its path). */
function candidates(T, ray) {
  if (!T.grid) return null;
  const G = T.grid;
  const span = rayBox(ray, T.min, T.max);
  if (span === null) return [];
  const h = Math.hypot(ray.d[0], ray.d[2]);
  const at = (t) => [ray.o[0] + ray.d[0] * t, ray.o[2] + ray.d[2] * t];
  const seen = new Set();
  const add = (p) => seen.add(G.cz(p[1]) * G.N + G.cx(p[0]));
  if (h < 1e-6) add(at(span));
  else {
    // Where the ray leaves the box: the far crossing of the xz slab (the ray box test only gives the near one).
    let t1 = Infinity;
    for (const i of [0, 2]) {
      if (Math.abs(ray.d[i]) < 1e-12) continue;
      const a = (T.min[i] - ray.o[i]) / ray.d[i], b = (T.max[i] - ray.o[i]) / ray.d[i];
      t1 = Math.min(t1, Math.max(a, b));
    }
    if (ray.d[1] < -1e-12) t1 = Math.min(t1, (T.min[1] - ray.o[1]) / ray.d[1]);
    else if (ray.d[1] > 1e-12) t1 = Math.min(t1, (T.max[1] - ray.o[1]) / ray.d[1]);
    const step = (0.5 * Math.min(G.sx, G.sz)) / h;
    if (!isFinite(t1) || (t1 - span) / step > MAX_STEPS) return null;
    for (let t = span; t <= t1 + step; t += step) add(at(Math.min(t, t1)));
  }
  const out = new Set();
  for (const c of seen) for (const t of G.cells[c]) out.add(t);
  return out;
}

/**
 * The nearest surface the ray meets: { t, point, normal } (normal turned toward the ray), or null.
 * `ray` = { o, d } with d of length 1 (t is then metres). `minUp`: only faces whose normal y is at least this
 * (0.5 = something to stand on; -1 = any face, a wall too). `maxT`: ignore hits farther than this.
 */
export function castSurface(ray, meshes, { minUp = 0.5, maxT = Infinity } = {}) {
  let best = null;
  const a = [0, 0, 0], b = [0, 0, 0], c = [0, 0, 0];
  for (const mesh of meshes) {
    const T = trianglesOf(mesh);
    if (!T.n || rayBox(ray, T.min, T.max) === null) continue;
    const side = sideOf(mesh);
    const list = candidates(T, ray);
    const test = (t) => {
      const o = t * 9;
      a[0] = T.tri[o]; a[1] = T.tri[o + 1]; a[2] = T.tri[o + 2];
      b[0] = T.tri[o + 3]; b[1] = T.tri[o + 4]; b[2] = T.tri[o + 5];
      c[0] = T.tri[o + 6]; c[1] = T.tri[o + 7]; c[2] = T.tri[o + 8];
      const d = rayTriangle(ray.o, ray.d, a, b, c);
      if (d === null || d > maxT || (best && d >= best.t)) return;
      let n = v.cross(v.sub(b, a), v.sub(c, a));
      const len = v.len(n);
      if (!(len > 0)) return;
      n = v.scale(n, 1 / len);
      const facing = v.dot(n, ray.d) < 0; // the front of the face looks at the ray
      if (facing ? side === BACK : side === FRONT) return; // the hidden side of a one-sided face
      if (!facing) n = v.scale(n, -1);
      if (n[1] < minUp) return;
      best = { t: d, point: v.add(ray.o, v.scale(ray.d, d)), normal: n, mesh };
    };
    if (list) for (const t of list) test(t);
    else for (let t = 0; t < T.n; t++) test(t);
  }
  return best;
}

/**
 * Every surface the ray meets (as castSurface: the same faces count), nearest first. adapter.js's move looks down
 * through all of them for the highest it may step onto (a pine's crown above the hill is skipped, the hill is not).
 */
export function castSurfaceAll(ray, meshes, opts) {
  const out = [];
  let hit;
  let r = ray;
  // castSurface again from just past each hit (1e-4 m: a face shared by two triangles is not met twice): few hits per
  // ray (2–4 in Lantern Cove), and castSurface's tests stay the one rule. `t` from the ray's own origin.
  for (let n = 0; n < 16 && (hit = castSurface(r, meshes, opts)); n++) {
    out.push({ ...hit, t: v.len(v.sub(hit.point, ray.o)) });
    r = { o: v.add(hit.point, v.scale(ray.d, 1e-4)), d: ray.d };
  }
  return out;
}

/**
 * The highest surface under a box, looking down from `fromY` (world; adapter.js: the top of the box): five vertical rays, the box's middle and four
 * points halfway to its corners. The highest hit wins: an object half over a pier's edge rests on the pier, and on a
 * slope it rests on the uphill side instead of sinking into it. null = nothing below.
 */
export function surfaceBelow(box, fromY, meshes) {
  const hit = surfaceBelowHit(box, fromY, meshes);
  return hit ? hit.y : null;
}

/** surfaceBelow with the mesh that holds the object up: { y, mesh } or null. */
export function surfaceBelowHit(box, fromY, meshes) {
  const cx = (box.min[0] + box.max[0]) / 2, cz = (box.min[2] + box.max[2]) / 2;
  const hx = (box.max[0] - box.min[0]) / 4, hz = (box.max[2] - box.min[2]) / 4;
  let top = null;
  for (const [x, z] of [[cx, cz], [cx - hx, cz - hz], [cx + hx, cz - hz], [cx - hx, cz + hz], [cx + hx, cz + hz]]) {
    const hit = castSurface({ o: [x, fromY, z], d: [0, -1, 0] }, meshes, { minUp: 0.5 });
    if (hit && (top === null || hit.point[1] > top.y)) top = { y: hit.point[1], mesh: hit.mesh };
  }
  return top;
}
