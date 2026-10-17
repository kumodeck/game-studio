/**
 * Small vector / matrix helpers on plain arrays and three's column-major `matrix.elements`.
 *
 * Why not use three's own Raycaster / Box3 / Vector3: the adapter must not bundle a copy of three (it would be a
 * different version than the game's, with its own class identities), and the game's three is a module we cannot
 * import by name (it may be bundled, renamed, or behind an import map). Instances we touch (object.position,
 * camera.matrixWorld) still come from the game's three; anything we compute ourselves lives here.
 */

export const v = {
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  norm: (a) => {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  }
};

/** Transform point [x,y,z] by a 4x4 column-major matrix (elements array). */
export function applyM4(e, p) {
  const [x, y, z] = p;
  const w = e[3] * x + e[7] * y + e[11] * z + e[15] || 1;
  return [(e[0] * x + e[4] * y + e[8] * z + e[12]) / w, (e[1] * x + e[5] * y + e[9] * z + e[13]) / w, (e[2] * x + e[6] * y + e[10] * z + e[14]) / w];
}

/** Transform a direction (no translation). */
export function applyM4Dir(e, d) {
  const [x, y, z] = d;
  return [e[0] * x + e[4] * y + e[8] * z, e[1] * x + e[5] * y + e[9] * z, e[2] * x + e[6] * y + e[10] * z];
}

/** Multiply two column-major 4x4 matrices: a × b. */
export function mulM4(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return o;
}

/** Inverse of a column-major 4x4 matrix (null when singular, e.g. scale 0). */
export function invertM4(m) {
  const [n11, n21, n31, n41, n12, n22, n32, n42, n13, n23, n33, n43, n14, n24, n34, n44] = m;
  const t11 = n23 * n34 * n42 - n24 * n33 * n42 + n24 * n32 * n43 - n22 * n34 * n43 - n23 * n32 * n44 + n22 * n33 * n44;
  const t12 = n14 * n33 * n42 - n13 * n34 * n42 - n14 * n32 * n43 + n12 * n34 * n43 + n13 * n32 * n44 - n12 * n33 * n44;
  const t13 = n13 * n24 * n42 - n14 * n23 * n42 + n14 * n22 * n43 - n12 * n24 * n43 - n13 * n22 * n44 + n12 * n23 * n44;
  const t14 = n14 * n23 * n32 - n13 * n24 * n32 - n14 * n22 * n33 + n12 * n24 * n33 + n13 * n22 * n34 - n12 * n23 * n34;
  const det = n11 * t11 + n21 * t12 + n31 * t13 + n41 * t14;
  if (!det) return null;
  const d = 1 / det;
  return [
    t11 * d,
    (n24 * n33 * n41 - n23 * n34 * n41 - n24 * n31 * n43 + n21 * n34 * n43 + n23 * n31 * n44 - n21 * n33 * n44) * d,
    (n22 * n34 * n41 - n24 * n32 * n41 + n24 * n31 * n42 - n21 * n34 * n42 - n22 * n31 * n44 + n21 * n32 * n44) * d,
    (n23 * n32 * n41 - n22 * n33 * n41 - n23 * n31 * n42 + n21 * n33 * n42 + n22 * n31 * n43 - n21 * n32 * n43) * d,
    t12 * d,
    (n13 * n34 * n41 - n14 * n33 * n41 + n14 * n31 * n43 - n11 * n34 * n43 - n13 * n31 * n44 + n11 * n33 * n44) * d,
    (n14 * n32 * n41 - n12 * n34 * n41 - n14 * n31 * n42 + n11 * n34 * n42 + n12 * n31 * n44 - n11 * n32 * n44) * d,
    (n12 * n33 * n41 - n13 * n32 * n41 + n13 * n31 * n42 - n11 * n33 * n42 - n12 * n31 * n43 + n11 * n32 * n43) * d,
    t13 * d,
    (n14 * n23 * n41 - n13 * n24 * n41 - n14 * n21 * n43 + n11 * n24 * n43 + n13 * n21 * n44 - n11 * n23 * n44) * d,
    (n12 * n24 * n41 - n14 * n22 * n41 + n14 * n21 * n42 - n11 * n24 * n42 - n12 * n21 * n44 + n11 * n22 * n44) * d,
    (n13 * n22 * n41 - n12 * n23 * n41 - n13 * n21 * n42 + n11 * n23 * n42 + n12 * n21 * n43 - n11 * n22 * n43) * d,
    t14 * d,
    (n13 * n24 * n31 - n14 * n23 * n31 + n14 * n21 * n33 - n11 * n24 * n33 - n13 * n21 * n34 + n11 * n23 * n34) * d,
    (n14 * n22 * n31 - n12 * n24 * n31 - n14 * n21 * n32 + n11 * n24 * n32 + n12 * n21 * n34 - n11 * n22 * n34) * d,
    (n12 * n23 * n31 - n13 * n22 * n31 + n13 * n21 * n32 - n11 * n23 * n32 - n12 * n21 * n33 + n11 * n22 * n33) * d
  ];
}

/**
 * Project a world point with a camera (projection × view). Returns [ndcX, ndcY, ndcZ, clipW]; clipW <= 0 means the
 * point is behind the camera (its ndc is meaningless).
 */
export function project(viewProj, p) {
  const e = viewProj;
  const [x, y, z] = p;
  const cx = e[0] * x + e[4] * y + e[8] * z + e[12];
  const cy = e[1] * x + e[5] * y + e[9] * z + e[13];
  const cz = e[2] * x + e[6] * y + e[10] * z + e[14];
  const cw = e[3] * x + e[7] * y + e[11] * z + e[15];
  return [cx / cw, cy / cw, cz / cw, cw];
}

/** projection × matrixWorldInverse of a three camera whose matrices are up to date. */
export function viewProjOf(camera) {
  return mulM4(camera.projectionMatrix.elements, camera.matrixWorldInverse.elements);
}

/** World-space ray through an ndc point: { o: origin, d: unit direction }. Works for perspective and orthographic. */
export function rayFromCamera(camera, ndcX, ndcY) {
  const projInv = camera.projectionMatrixInverse ? camera.projectionMatrixInverse.elements : invertM4(camera.projectionMatrix.elements);
  const world = camera.matrixWorld.elements;
  const near = applyM4(world, applyM4(projInv, [ndcX, ndcY, -1]));
  const far = applyM4(world, applyM4(projInv, [ndcX, ndcY, 1]));
  return { o: near, d: v.norm(v.sub(far, near)) };
}

/** Where a ray meets the horizontal plane y = h (null when parallel or behind). */
export function rayPlaneY(ray, h) {
  if (Math.abs(ray.d[1]) < 1e-9) return null;
  const t = (h - ray.o[1]) / ray.d[1];
  if (t < 0) return null;
  return v.add(ray.o, v.scale(ray.d, t));
}

/** Slab test: distance along the ray to an axis-aligned box, or null. min/max are [x,y,z]. */
export function rayBox(ray, min, max) {
  let t0 = -Infinity;
  let t1 = Infinity;
  for (let i = 0; i < 3; i++) {
    const inv = 1 / ray.d[i];
    let a = (min[i] - ray.o[i]) * inv;
    let b = (max[i] - ray.o[i]) * inv;
    if (a > b) [a, b] = [b, a];
    if (a > t0) t0 = a;
    if (b < t1) t1 = b;
    if (t0 > t1) return null;
  }
  if (t1 < 0) return null;
  return Math.max(t0, 0);
}

/** Möller–Trumbore, double sided. Returns distance along the ray or null. */
export function rayTriangle(o, d, a, b, c) {
  const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const p = v.cross(d, e2);
  const det = v.dot(e1, p);
  if (Math.abs(det) < 1e-12) return null;
  const inv = 1 / det;
  const s = [o[0] - a[0], o[1] - a[1], o[2] - a[2]];
  const u = v.dot(s, p) * inv;
  if (u < 0 || u > 1) return null;
  const q = v.cross(s, e1);
  const w = v.dot(d, q) * inv;
  if (w < 0 || u + w > 1) return null;
  const t = v.dot(e2, q) * inv;
  return t > 1e-9 ? t : null;
}

/** The 8 corners of a box. */
export function boxCorners(min, max) {
  const out = [];
  for (let i = 0; i < 8; i++) out.push([i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2]]);
  return out;
}

/** Angle into (-π, π]. */
export function wrapAngle(a) {
  let r = a % (Math.PI * 2);
  if (r <= -Math.PI) r += Math.PI * 2;
  if (r > Math.PI) r -= Math.PI * 2;
  return r;
}
