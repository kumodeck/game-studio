/**
 * Bounds, ray casts and "pick near a point" for three.js objects, without three's Raycaster (see math.js for why).
 *
 * pickNear rules (learned the hard way on real games — keep them unless a test shows a better order):
 *   candidates = objects the ray hits + objects whose on-screen box (8 projected corners of their world box) is
 *                within `radiusPx` of the pressed point
 *   order      = 1. visible before hidden. "Visible" = a ray through a point of the object's screen box (the point
 *                   nearest the press, pulled 1/4 toward the box centre) hits this object first. We do NOT compare
 *                   depths at the pressed point: tapping slightly beside a coin on a hill hits the hill in front of
 *                   the coin, and a depth test would wrongly call the coin hidden — the case we most want to win.
 *                2. score = distance from the press to the screen box (0 inside) + 0.25 × √(box area in px²).
 *                   Size matters because big things (ground, hills, buildings) contain the press point (distance 0)
 *                   and would always beat the small thing next to it. Big things are easy to pick elsewhere; small
 *                   things are not. e.g. a 30 px coin missed by 10 px (10 + 7.5) beats a 600×400 px hill (0 + 122).
 *                3. nearer to the camera first. At most 8 results.
 */

import { applyM4, applyM4Dir, invertM4, boxCorners, project, rayBox, rayTriangle, rayFromCamera, v } from './math.js';
import { isExcluded } from './keys.js';

const MAX_TRIS = 200000; // above this we use the box only: a click must never freeze the page

/** Visible meshes in a subtree (respecting `visible` and exclusions). */
export function meshesOf(object) {
  const out = [];
  const walk = (o) => {
    if (!o.visible || isExcluded(o)) return;
    if ((o.isMesh || o.isSkinnedMesh) && o.geometry) out.push(o);
    for (const c of o.children) walk(c);
  };
  walk(object);
  return out;
}

function localBox(mesh) {
  const g = mesh.geometry;
  if (!g.boundingBox && typeof g.computeBoundingBox === 'function') g.computeBoundingBox();
  const b = g.boundingBox;
  if (!b || !isFinite(b.min.x) || !isFinite(b.max.x)) return null;
  return [[b.min.x, b.min.y, b.min.z], [b.max.x, b.max.y, b.max.z]];
}

/** The 8 corners of each mesh's geometry box, in world space. Matrices must be current. */
export function worldCorners(object) {
  const pts = [];
  for (const m of meshesOf(object)) {
    const b = localBox(m);
    if (!b) continue;
    for (const c of boxCorners(b[0], b[1])) pts.push(applyM4(m.matrixWorld.elements, c));
  }
  return pts;
}

/** Axis-aligned world box of a subtree, { min, max } or null when nothing visible. */
export function worldBox(object) {
  const pts = worldCorners(object);
  if (!pts.length) return null;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const p of pts) for (let i = 0; i < 3; i++) (min[i] = Math.min(min[i], p[i])), (max[i] = Math.max(max[i], p[i]));
  return { min, max };
}

/**
 * Screen box of a subtree in ndc: [minX, minY, maxX, maxY], from the corners in front of the camera (null when all
 * are behind). Corners behind the camera are skipped — they would project mirrored.
 */
export function screenRect(object, viewProj) {
  let r = null;
  for (const p of worldCorners(object)) {
    const q = project(viewProj, p);
    if (q[3] <= 0) continue;
    if (!r) r = [q[0], q[1], q[0], q[1]];
    else (r[0] = Math.min(r[0], q[0])), (r[1] = Math.min(r[1], q[1])), (r[2] = Math.max(r[2], q[0])), (r[3] = Math.max(r[3], q[1]));
  }
  return r;
}

/** Nearest hit distance of a world ray against one mesh (triangles; box only for skinned / huge meshes). */
export function rayMesh(ray, mesh) {
  const b = localBox(mesh);
  if (!b) return null;
  const inv = invertM4(mesh.matrixWorld.elements);
  if (!inv) return null;
  const o = applyM4(inv, ray.o);
  const d = applyM4Dir(inv, ray.d); // not normalised: t stays comparable after mapping back to world
  if (rayBox({ o, d }, b[0], b[1]) === null) return null;
  const g = mesh.geometry;
  const pos = g.attributes && g.attributes.position;
  const toWorld = (t) => v.len(v.sub(applyM4(mesh.matrixWorld.elements, v.add(o, v.scale(d, t))), ray.o));
  if (mesh.isSkinnedMesh || !pos || g.morphAttributes?.position?.length) return toWorld(rayBox({ o, d }, b[0], b[1]));
  const index = g.index;
  const start = Math.max(0, g.drawRange?.start || 0);
  const total = index ? index.count : pos.count;
  const end = Math.min(total, start + (isFinite(g.drawRange?.count) ? g.drawRange.count : total));
  if ((end - start) / 3 > MAX_TRIS) return toWorld(rayBox({ o, d }, b[0], b[1]));
  let best = null;
  const P = (i) => [pos.getX(i), pos.getY(i), pos.getZ(i)];
  for (let i = start; i + 2 < end; i += 3) {
    const ia = index ? index.getX(i) : i;
    const ib = index ? index.getX(i + 1) : i + 1;
    const ic = index ? index.getX(i + 2) : i + 2;
    const t = rayTriangle(o, d, P(ia), P(ib), P(ic));
    if (t !== null && (best === null || t < best)) best = t;
  }
  return best === null ? null : toWorld(best);
}

/** Nearest hit of a ray against a whole subtree. */
export function rayObject(ray, object) {
  let best = null;
  for (const m of meshesOf(object)) {
    const t = rayMesh(ray, m);
    if (t !== null && (best === null || t < best)) best = t;
  }
  return best;
}

/**
 * cands: [{ key, object }]. camera: matrices current. size: [cssW, cssH] of the canvas.
 * Returns keys, best first (see the rules at the top of the file).
 */
export function pickNear(cands, camera, viewProj, ndcX, ndcY, radiusPx, size) {
  const [W, H] = size;
  const toPx = (nx, ny) => [((nx + 1) / 2) * W, ((1 - ny) / 2) * H];
  const [px, py] = toPx(ndcX, ndcY);
  const ray = rayFromCamera(camera, ndcX, ndcY);
  const hits = new Map();
  for (const c of cands) {
    const t = rayObject(ray, c.object);
    if (t !== null) hits.set(c, t);
  }
  const rows = [];
  for (const c of cands) {
    const r = screenRect(c.object, viewProj);
    if (!r) continue;
    const [x0, y1] = toPx(r[0], r[1]);
    const [x1, y0] = toPx(r[2], r[3]);
    const dx = px < x0 ? x0 - px : px > x1 ? px - x1 : 0;
    const dy = py < y0 ? y0 - py : py > y1 ? py - y1 : 0;
    const dist = hits.has(c) ? 0 : Math.hypot(dx, dy);
    if (!hits.has(c) && dist > radiusPx) continue;
    const area = Math.max(1, (x1 - x0) * (y1 - y0));
    rows.push({ c, rect: [x0, y0, x1, y1], score: dist + 0.25 * Math.sqrt(area), depth: hits.get(c) ?? Infinity });
  }
  if (!rows.length) return [];
  // Visibility: shoot a ray at the object's own screen box and see who is hit first.
  const firstHit = (nx, ny) => {
    const r2 = rayFromCamera(camera, nx, ny);
    let best = null;
    let who = null;
    for (const c of cands) {
      const t = rayObject(r2, c.object);
      if (t !== null && (best === null || t < best)) (best = t), (who = c);
    }
    return { who, t: best };
  };
  for (const row of rows) {
    const [x0, y0, x1, y1] = row.rect;
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const nx = Math.min(Math.max(px, x0), x1);
    const ny = Math.min(Math.max(py, y0), y1);
    const sx = nx + (cx - nx) * 0.25;
    const sy = ny + (cy - ny) * 0.25;
    let h = firstHit((sx / W) * 2 - 1, 1 - (sy / H) * 2);
    if (!h.who) h = firstHit((cx / W) * 2 - 1, 1 - (cy / H) * 2);
    row.visible = !h.who || h.who === row.c;
    if (row.depth === Infinity && h.who === row.c) row.depth = h.t;
  }
  rows.sort((a, b) => (a.visible !== b.visible ? (a.visible ? -1 : 1) : a.score !== b.score ? a.score - b.score : a.depth - b.depth));
  return rows.slice(0, 8).map((r) => r.c.key);
}
