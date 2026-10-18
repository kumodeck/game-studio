/**
 * Bounds, ray casts and "pick near a point" for three.js objects, without three's Raycaster (see math.js for why).
 *
 * pickNear rules (learned the hard way on real games — keep them unless a test shows a better order):
 *   candidates = objects the ray hits + objects one of whose shapes is within `radiusPx` of the pressed point (a
 *                ring of rays around the press hits it; only tried when the on-screen box — 8 projected corners of
 *                the world box — is that near). A box alone is not enough (a web demo try 2026-10-18, "clicking an empty
 *                spot doesn't deselect"): Lantern Cove's lighthouse has a long light beam, so its box covered half
 *                the sky, and a click on the empty sky picked the lighthouse again instead of dropping it.
 *   order      = 1. visible before hidden. "Visible" = a ray through a point of the object's screen box (the point
 *                   nearest the press, pulled 1/4 toward the box centre) hits this object first. We do NOT compare
 *                   depths at the pressed point: tapping slightly beside a coin on a hill hits the hill in front of
 *                   the coin, and a depth test would wrongly call the coin hidden — the case we most want to win.
 *                2. score = distance from the press to the screen box (0 inside) + 0.25 × √(box area in px²).
 *                   Size matters because big things (ground, hills, buildings) contain the press point (distance 0)
 *                   and would always beat the small thing next to it. Big things are easy to pick elsewhere; small
 *                   things are not. e.g. a 30 px coin missed by 10 px (10 + 7.5) beats a 600×400 px hill (0 + 122).
 *                   For an object the ray hits, the box is that of the mesh under the finger (a lighthouse's tower,
 *                   not the tower + its wide light beam), so a finger ON a thin tall thing keeps it.
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

/** w (distance in front of the camera) where screenShare() cuts box edges that run behind the camera. */
const NEAR_W = 1e-3;

/**
 * Share (0–1) of the canvas covered by the object's on-screen box, for "is this the ground?" (bridge/input.ts:
 * a tap on a huge object is a tap on nothing, a drag on it looks around). Box edges that run behind the camera are
 * cut just in front of it, and the box is clipped to the canvas. WHY not screenRect (2026-10-18): it skips corners
 * behind the camera, so a ground plane that runs on under the camera came out as its far strip only (a farm's
 * 60 m field seen from 9 m up: ~25 % of the screen instead of ~90 %), and a tap on the grass picked the ground.
 * Every pair of corners is cut, not only the 12 edges: the box is convex, so each crossing point is inside it.
 */
export function screenShare(object, viewProj) {
  let r = null;
  const add = (q) => {
    const x = Math.min(1, Math.max(-1, q[0])), y = Math.min(1, Math.max(-1, q[1]));
    if (!r) r = [x, y, x, y];
    else (r[0] = Math.min(r[0], x)), (r[1] = Math.min(r[1], y)), (r[2] = Math.max(r[2], x)), (r[3] = Math.max(r[3], y));
  };
  for (const m of meshesOf(object)) {
    const b = localBox(m);
    if (!b) continue;
    const ps = boxCorners(b[0], b[1]).map((c) => applyM4(m.matrixWorld.elements, c));
    const qs = ps.map((p) => project(viewProj, p));
    for (const q of qs) if (q[3] > NEAR_W) add(q);
    for (let i = 0; i < ps.length; i++) {
      for (let j = i + 1; j < ps.length; j++) {
        const wi = qs[i][3], wj = qs[j][3];
        if ((wi > NEAR_W) === (wj > NEAR_W)) continue;
        // w is linear along the segment in world space: cut where it equals NEAR_W.
        const t = (wi - NEAR_W) / (wi - wj);
        add(project(viewProj, v.add(ps[i], v.scale(v.sub(ps[j], ps[i]), t))));
      }
    }
  }
  return r ? ((r[2] - r[0]) * (r[3] - r[1])) / 4 : 0;
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
  return rayObjectHit(ray, object)?.t ?? null;
}

/** Nearest hit of a ray against a whole subtree, with the mesh it hit: { t, mesh } or null. */
export function rayObjectHit(ray, object) {
  let best = null;
  for (const m of meshesOf(object)) {
    const t = rayMesh(ray, m);
    if (t !== null && (best === null || t < best.t)) best = { t, mesh: m };
  }
  return best;
}

/** Screen box of ONE mesh's own geometry box (not its children), in ndc like screenRect, or null. */
function meshScreenRect(mesh, viewProj) {
  const b = localBox(mesh);
  if (!b) return null;
  let r = null;
  for (const c of boxCorners(b[0], b[1])) {
    const q = project(viewProj, applyM4(mesh.matrixWorld.elements, c));
    if (q[3] <= 0) continue;
    if (!r) r = [q[0], q[1], q[0], q[1]];
    else (r[0] = Math.min(r[0], q[0])), (r[1] = Math.min(r[1], q[1])), (r[2] = Math.max(r[2], q[0])), (r[3] = Math.max(r[3], q[1]));
  }
  return r;
}

/** Ring fractions of the radius and rays per ring for nearMiss(): 3 × 12 = 36 rays at most, only for an object
 *  whose box is near the press but which the press itself missed. 12 directions = 30° apart, so a 3 px lamp post
 *  12 px away is still crossed by the outer ring's horizontal ray. */
const RINGS = [1 / 3, 2 / 3, 1];
const RAYS_PER_RING = 12;

/** Distance in px (the smallest ring) at which a ray around (px, py) hits `object`, or null when none within radiusPx. */
function nearMiss(camera, object, px, py, radiusPx, W, H) {
  if (!(radiusPx > 0)) return null;
  for (const f of RINGS) {
    const r = radiusPx * f;
    // Each ring turned by half a step against the one before, so the rays do not line up.
    const turn = (RINGS.indexOf(f) % 2) * (Math.PI / RAYS_PER_RING);
    for (let i = 0; i < RAYS_PER_RING; i++) {
      const a = turn + (i * 2 * Math.PI) / RAYS_PER_RING;
      const x = px + Math.cos(a) * r;
      const y = py + Math.sin(a) * r;
      if (rayObject(rayFromCamera(camera, (x / W) * 2 - 1, 1 - (y / H) * 2), object) !== null) return r;
    }
  }
  return null;
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
  const hitMesh = new Map();
  for (const c of cands) {
    const h = rayObjectHit(ray, c.object);
    if (h) hits.set(c, h.t), hitMesh.set(c, h.mesh);
  }
  const rows = [];
  for (const c of cands) {
    const r = screenRect(c.object, viewProj);
    if (!r) continue;
    const [x0, y1] = toPx(r[0], r[1]);
    const [x1, y0] = toPx(r[2], r[3]);
    const dx = px < x0 ? x0 - px : px > x1 ? px - x1 : 0;
    const dy = py < y0 ? y0 - py : py > y1 ? py - y1 : 0;
    let dist = hits.has(c) ? 0 : Math.hypot(dx, dy);
    if (!hits.has(c)) {
      if (dist > radiusPx) continue;
      // Near the box is not near the object (see the rules at the top): one of its shapes must be within the radius.
      const near = nearMiss(camera, c.object, px, py, radiusPx, W, H);
      if (near === null) continue;
      dist = Math.max(dist, near);
    }
    // Under the finger, the size is the PART the ray hit, not the whole object (W1 merge, 2026-10-17): Lantern Cove's
    // lighthouse has a light beam, so its whole box is 200×420 px on a phone (score 73) while the tower under the
    // finger is ~45×170; a pine mostly off the screen's edge 20 px away (87×111, score 44) took the tap. A hill's part
    // under the finger is still the hill (big), so the coin beside it still wins (rule 2).
    const hm = hitMesh.get(c);
    const mr = hm ? meshScreenRect(hm, viewProj) : null;
    const [mx0, my1] = mr ? toPx(mr[0], mr[1]) : [x0, y1];
    const [mx1, my0] = mr ? toPx(mr[2], mr[3]) : [x1, y0];
    const area = Math.max(1, (mx1 - mx0) * (my1 - my0));
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
