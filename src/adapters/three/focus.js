/**
 * Where the edit camera looks when an object is picked from the list (view.focus) or when the whole
 * scene is shown (view.frameAll). Pure maths on world boxes { min: [x,y,z], max: [x,y,z] }, so it
 * can be tested without WebGL.
 *
 * WHY (UI/UX review 2026-10-16, journey and simplicity reviews): focus used to frame a sphere of
 * max(radius × 2.2, 1.5 m) around the object. A barrel then filled the screen (nothing around it was
 * visible, so the person could not judge where to put it) and a big ground plane sent the camera far
 * out. Placing is about the object AND its surroundings: frame the object plus its nearest
 * neighbours, never more than the scene itself.
 */

/** Centre and radius of a box. */
export function sphereOf(b) {
  const c = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
  const r = Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]) / 2;
  return { c, r };
}

/**
 * The scene's extent: the union of all boxes, leaving out "backdrop" boxes (sky domes, seas, huge
 * grounds) that are more than 20× the typical object's size. The same rule frameAll always used.
 * @returns {{ c: number[], r: number, typical: number } | null}
 */
export function sceneSphere(boxes) {
  if (!boxes.length) return null;
  const radii = boxes.map((b) => sphereOf(b).r).sort((a, b) => a - b);
  const typical = radii[Math.floor(radii.length / 2)] || 1;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const b of boxes) {
    const r = sphereOf(b).r;
    if (boxes.length > 2 && r > typical * 20) continue;
    // A flat thing much bigger than the rest is a ground or a floor: the play area is what stands on it.
    // (Rebrand 2026-10-16: the yard of the three-crates sample was framed from so far that each crate
    // was a few pixels; the ground was 19× a crate, just under the 20× rule above.)
    const flat = b.max[1] - b.min[1] < 0.05 * Math.max(b.max[0] - b.min[0], b.max[2] - b.min[2]);
    if (boxes.length > 2 && flat && r > typical * 6) continue;
    for (let i = 0; i < 3; i++) (min[i] = Math.min(min[i], b.min[i])), (max[i] = Math.max(max[i], b.max[i]));
  }
  if (!Number.isFinite(min[0])) return null;
  const s = sphereOf({ min, max });
  return { c: s.c, r: s.r, typical };
}

/**
 * The sphere to frame when `target` is picked.
 * - at least 1.6× the object (it never fills the screen) and 2× a typical object (a tiny coin
 *   still shows what is next to it);
 * - widened to reach its second-nearest neighbour ("a little of what is around"), but not beyond
 *   4× the object / 6× a typical object (one lone tree far away must not pull the camera out);
 * - never more than the scene (+10 %): a ground plane or a wall shows the play area, centred on
 *   the scene, instead of the camera flying out to the plane's far edges.
 *
 * @param {{ min: number[], max: number[] }} target  world box of the picked object
 * @param {Array<{ min: number[], max: number[] }>} others  world boxes of the other listed objects
 * @param {number[]} pivot  where the object's handles are (its origin): the default centre
 * @returns {{ center: number[], radius: number }}
 */
export function focusSphere(target, others, pivot) {
  const t = sphereOf(target);
  const scene = sceneSphere([target, ...others]);
  const typical = scene ? scene.typical : t.r;
  let radius = Math.max(t.r * 1.6, typical * 2);
  const reach = others
    .map((b) => {
      const o = sphereOf(b);
      return Math.hypot(o.c[0] - t.c[0], o.c[1] - t.c[1], o.c[2] - t.c[2]) + o.r;
    })
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (reach.length) {
    const second = reach[Math.min(1, reach.length - 1)];
    radius = Math.max(radius, Math.min(second * 1.1, Math.max(t.r * 4, typical * 6)));
  }
  let center = pivot.slice();
  if (scene && radius > scene.r * 1.1) {
    radius = scene.r * 1.1;
    // Bigger than the scene itself (the ground): look at the scene, not at the plane's origin.
    if (t.r >= scene.r) center = scene.c.slice();
  }
  return { center, radius: Math.max(radius, 0.5) };
}
