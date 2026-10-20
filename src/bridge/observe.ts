// Watch the game play for a moment when editing starts, to find what it moves by itself (Item.held 'game').
//
// WHY (a hands-on try of 2026-10-19, item 5): "the pillars of this game flow toward you every frame and are put
// back far away, at a random place each time. So if I move one in the editor and save, that place is not kept."
// Nothing told them. Asked for: "before editing starts, run the game a little, find the objects whose position the
// game changes by itself, and say so on them" — this file is the finding; hold.ts holds them; the card says why.
//
// How: the editor freezes the game after its first frame (core/time.ts). Right after the edit view is up, the
// editor lets the game's own frames run for WATCH_MS (its draws stay held by the adapter, so the picture does not
// jump), freezes it again, compares every listed pose, and puts the moved objects back where the first frame had
// them (setPose, exact) — the scene the person edits is still the game's first picture.
// WHY not before the edit view: the first picture would then not be the game's first frame any more, and every
// test and reload that opens on it would move. WHY 0.6 s: a runner at 20 m/s moves a pillar 12 m, a slow bobbing
// coin a few cm; a game that only moves things after a key press or a timer is not caught (nothing to say then).
import type { Dim, Item, Pose } from '../contract.ts';
import type { Driven } from './hold.ts';

export const WATCH_MS = 600;

/** Smallest change that counts: 1 mm / 0.5 px, about 0.06°, 0.1 % of the size. Below that is float noise. */
const EPS = { p3: 1e-3, p2: 0.5, r: 1e-3, s: 1e-3 };

const scaleOf = (p: Pose) => (Array.isArray(p.s) ? p.s : [p.s ?? 1, p.s ?? 1, p.s ?? 1]);
const turnOf = (p: Pose) => [p.r ?? 0, ...(p.t ?? [0, 0])];
const angleGap = (a: number, b: number) => {
  const d = Math.abs((((a - b) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI));
  return Math.min(d, 2 * Math.PI - d);
};

/** What changed for each key listed both times. Objects that came or went in between are left out. */
export function drivenBetween(before: Item[], after: Item[], dim: Dim): Map<string, Driven> {
  const was = new Map(before.map((i) => [i.key, i.pose] as const));
  const out = new Map<string, Driven>();
  for (const it of after) {
    const a = was.get(it.key);
    const b = it.pose;
    if (!a || !b) continue;
    const eps = dim === '3d' ? EPS.p3 : EPS.p2;
    const gap = (i: number) => Math.abs((a.p[i] ?? 0) - (b.p[i] ?? a.p[i] ?? 0)) > eps;
    // 3D: across the ground (x, z) apart from the height (y): a boat that bobs keeps the place it is given.
    const move = dim === '3d' ? gap(0) || gap(2) : gap(0) || gap(1);
    const lift = dim === '3d' && gap(1);
    const ta = turnOf(a), tb = turnOf(b);
    const turn = ta.some((v, i) => angleGap(v, tb[i]!) > EPS.r);
    const sa = scaleOf(a), sb = scaleOf(b);
    const size = sa.some((v, i) => Math.abs(v - sb[i]!) > EPS.s * Math.max(1, Math.abs(v)));
    if (move || lift || turn || size) out.set(it.key, { move, lift, turn, size });
  }
  return out;
}
