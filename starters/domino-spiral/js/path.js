/**
 * The domino line as ONE path made from three control points — no domino is saved anywhere.
 *
 * WHY (decided 2026-11-06): the placement file keeps only what a person moves by hand. Saving 400 domino poses would
 * make every drag a 400-object change and the editor's list unreadable. Instead three named points are placed
 * (`head` = where the line starts and the ball hits, `bend` = how the lead-in curves, `center` = the middle of the
 * spiral), and the game lays the dominoes along the path they make every time they move. Drag the head and the whole
 * line follows, like pulling a rope.
 *
 * The path, start to end:
 *   head ──(curve)── bend ──(curve)── entry ── spiral, winding inward around `center`
 * The entry is the point where a straight line from the bend would just touch the spiral's outer ring, and the spiral
 * winds the way the line is already going (entry()), so the lead-in joins it without a kink wherever the points are.
 *
 * Plain numbers only (no three.js): the same file runs in the browser and in the unit tests (node).
 */

// The spiral's shape (metres). OUTER = the first ring's radius, INNER = where it ends, RING_GAP = the distance between
// two rings. 10 / 2.4 / 1.5 ≈ 5 turns and ≈ 200 m of line: about 400 dominoes at GAP 0.5 (decided 2026-11-06: "about
// 400" reads as a crowd in one picture and still runs at 60 fps on a laptop).
export const SPIRAL = { OUTER: 10, INNER: 2.4, RING_GAP: 1.5 };
// More than this and a long lead-in dragged across the floor would make the scene heavy; the rest is not laid.
export const MAX_DOMINOES = 700;

const hyp = Math.hypot;

/**
 * Point and direction of the spiral at turn angle φ (0 = the entry). `a0` = the entry's angle around the centre,
 * `dir` = +1 winding counter-clockwise seen from above (x right, z toward the viewer), −1 clockwise.
 */
function spiralAt(c, a0, dir, phi) {
  const k = SPIRAL.RING_GAP / (2 * Math.PI); // the radius shrinks by k per radian
  const r = SPIRAL.OUTER - k * phi;
  const a = a0 + dir * phi;
  const ca = Math.cos(a), sa = Math.sin(a);
  // d/dφ of (r cos a, r sin a), with da/dφ = dir
  const dx = -k * ca - dir * r * sa, dz = -k * sa + dir * r * ca;
  const l = hyp(dx, dz) || 1;
  return { x: c.x + r * ca, z: c.z + r * sa, tx: dx / l, tz: dz / l };
}

/**
 * Where and which way the lead-in joins the spiral: { a0, dir }. The joint is a point where a straight line from the
 * bend just touches the outer ring (two of them), and the spiral may wind either way from it (two ways): of those four,
 * the one that runs on most straight from the head → bend direction, and never back toward the bend.
 * WHY choose the winding too (2026-11-06): with one fixed winding, half the places a bend can be dragged to made the
 * line turn back on itself at the joint — a hairpin of 30°+ between two dominoes. Now the spiral winds the way the
 * line is already going. A bend inside the outer ring joins straight out from the centre.
 */
export function entry(head, bend, c) {
  const dx = bend.x - c.x, dz = bend.z - c.z;
  const d = hyp(dx, dz);
  const beta = Math.atan2(dz, dx);
  if (d <= SPIRAL.OUTER + 0.01) return { a0: beta, dir: 1 };
  const g = Math.acos(SPIRAL.OUTER / d);
  const hl = hyp(bend.x - head.x, bend.z - head.z) || 1;
  const ux = (bend.x - head.x) / hl, uz = (bend.z - head.z) / hl;
  let best = null;
  for (const dir of [1, -1]) {
    for (const a0 of [beta - g, beta + g]) {
      const e = spiralAt(c, a0, dir, 0);
      const el = hyp(e.x - bend.x, e.z - bend.z) || 1;
      const vx = (e.x - bend.x) / el, vz = (e.z - bend.z) / el;
      if (e.tx * vx + e.tz * vz <= 0) continue; // the spiral would run back toward the bend
      const score = ux * vx + uz * vz;
      if (!best || score > best.score) best = { a0, dir, score };
    }
  }
  return best ? { a0: best.a0, dir: best.dir } : { a0: beta - g, dir: 1 };
}

/** A cubic Hermite segment from p0 (tangent m0) to p1 (tangent m1), sampled into `out` (without its last point). */
function hermite(out, p0, m0, p1, m1, n) {
  for (let i = 0; i < n; i++) {
    const s = i / n, s2 = s * s, s3 = s2 * s;
    const h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s, h01 = -2 * s3 + 3 * s2, h11 = s3 - s2;
    out.push({ x: h00 * p0.x + h10 * m0.x + h01 * p1.x + h11 * m1.x, z: h00 * p0.z + h10 * m0.z + h01 * p1.z + h11 * m1.z });
  }
}

/** The whole path as a dense polyline [{ x, z }], ~5 cm apart or less. */
export function pathPoints(head, bend, center) {
  const { a0, dir } = entry(head, bend, center);
  const e = spiralAt(center, a0, dir, 0);
  const pts = [];
  const l1 = hyp(bend.x - head.x, bend.z - head.z), l2 = hyp(e.x - bend.x, e.z - bend.z);
  // Catmull-Rom-like tangents: at the bend, the direction from the head to the entry; at the entry, the spiral's own.
  // Each side of the bend takes its own segment's length as the tangent's size (one shared size, as first written,
  // looped the short side into a hairpin: a 32° turn between two dominoes, 2026-11-06), so the line keeps its
  // direction through the bend and bends smoothly on both sides.
  const db = hyp(e.x - head.x, e.z - head.z) || 1;
  const ub = { x: (e.x - head.x) / db, z: (e.z - head.z) / db };
  // At the head the line is free ("natural" end: no bending right at the head, m0 = (3·(bend − head) − m1) / 2), so a
  // bend dragged far to the side curves the whole first stretch evenly instead of folding at the bend.
  const m1 = { x: ub.x * l1, z: ub.z * l1 };
  hermite(pts, head, { x: (3 * (bend.x - head.x) - m1.x) / 2, z: (3 * (bend.z - head.z) - m1.z) / 2 }, bend, m1, Math.max(8, Math.ceil(l1 * 20)));
  hermite(pts, bend, { x: ub.x * l2, z: ub.z * l2 }, e, { x: e.tx * l2, z: e.tz * l2 }, Math.max(8, Math.ceil(l2 * 20)));
  const end = ((SPIRAL.OUTER - SPIRAL.INNER) * 2 * Math.PI) / SPIRAL.RING_GAP;
  // Steps in φ small enough that even the inner ring is sampled every ~5 cm.
  const dphi = 0.05 / SPIRAL.OUTER;
  for (let phi = 0; phi <= end; phi += Math.min(dphi * (SPIRAL.OUTER / Math.max(SPIRAL.INNER, SPIRAL.OUTER - (SPIRAL.RING_GAP / (2 * Math.PI)) * phi)), 0.05)) {
    pts.push(spiralAt(center, a0, dir, phi));
  }
  return pts;
}

/**
 * The dominoes along the path, one every `gap` metres of line: [{ x, z, yaw }] where yaw turns the domino's
 * forward (+z) onto the path's direction (three.js: rotation.y = yaw).
 */
export function layDominoes(head, bend, center, gap) {
  const pts = pathPoints(head, bend, center);
  const out = [];
  let want = 0; // arc length of the next domino
  let s = 0; // arc length at pts[i]
  for (let i = 1; i < pts.length && out.length < MAX_DOMINOES; i++) {
    const a = pts[i - 1], b = pts[i];
    const l = hyp(b.x - a.x, b.z - a.z);
    if (l < 1e-9) continue;
    while (want <= s + l && out.length < MAX_DOMINOES) {
      const f = (want - s) / l;
      out.push({ x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, yaw: Math.atan2(b.x - a.x, b.z - a.z) });
      want += gap;
    }
    s += l;
  }
  return out;
}
