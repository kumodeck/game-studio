// What a moved object now sits inside (decided 2026-11-06, a first-run walk of v0.1.82): a far rock dragged 120 px went
// 9.6 m and ended inside the sea arch, and nothing on screen said so — from far away one pixel is metres, and the eye
// cannot tell depth. The bridge draws the pick's outline red and names what it overlaps while the drag lasts.
//
// The rule, on world boxes (pick.js worldBox):
// - both boxes shrink by INSET of their own size on every side first, so things that only touch (a barrel standing on
//   the pier, two crates side by side, a box's empty corners) do not count — only a real push into the other;
// - an object that spreads much wider than the moved one (BIG × its floor area, x × z: a hill, an island, the sea) is
//   what things stand on or in, not something to bump into: never counted (the moved one may be over it, or in its box,
//   as a matter of course). Floor area, not volume: the first try used volume, and Lantern Cove's sea arch (a tall bow,
//   ~15× the small rock's volume but ~8× its floor) counted as ground — the rock dragged into it stayed orange;
// - the moved object's own parents and children are never counted (the caller leaves them out).
// Plain numbers in, keys out: test/walk2-scene.test.ts reads it without three.js.

/** Share of a box's size taken off every side before comparing (0.15 = the middle 70 % of each axis). */
export const INSET = 0.15;
/** Another object this many times the moved one's floor area (x × z) or more is ground to it, never an overlap. */
export const BIG = 12;

const floor = (b) => Math.max(1e-9, (b.max[0] - b.min[0]) * (b.max[2] - b.min[2]));
const shrink = (b) => {
  const min = [], max = [];
  for (let i = 0; i < 3; i++) {
    const d = (b.max[i] - b.min[i]) * INSET;
    min.push(b.min[i] + d);
    max.push(b.max[i] - d);
  }
  return { min, max };
};

/**
 * @param {{ min: number[], max: number[] }} box  the moved object's world box
 * @param {Array<{ key: string, box: { min: number[], max: number[] } | null }>} others
 * @returns {string[]} the keys it overlaps, most overlapped first (at most 3)
 */
export function overlapKeys(box, others) {
  if (!box) return [];
  const a = shrink(box);
  const mine = floor(box);
  const out = [];
  for (const o of others) {
    if (!o.box || floor(o.box) >= mine * BIG) continue;
    const b = shrink(o.box);
    let v = 1;
    for (let i = 0; i < 3 && v > 0; i++) v *= Math.max(0, Math.min(a.max[i], b.max[i]) - Math.max(a.min[i], b.min[i]));
    if (v > 0) out.push({ key: o.key, v });
  }
  return out.sort((x, y) => y.v - x.v).slice(0, 3).map((x) => x.key);
}
