// The path's shape (studio-timeline-2, 2026-10-22; CONTRACT.md §1.9.2): a point's two handles, a corner, and a key put
// in the middle of the path. Pure logic on one clip's position keys (MotionKey[]); no DOM: test/timeline-2.test.ts.
//
// Asked for in the second stage: "Bézier handles on the path's points (the smallest graph editor), a point
// that makes a corner" and "click the path (or K) to put a key at that moment". How it reads in the file:
//   - a point with no `in` / `out` is smooth: the curve through the points (Catmull-Rom), as in stage 1 — every
//     motion made before stays exactly as it was;
//   - a handle dragged once writes both of that point's handles (`in` towards the key before, `out` towards the key
//     after, offsets from the point), so the span on each side is a Bézier curve (the loader's trackAt);
//   - both 0 = a corner (the path comes straight in and goes straight out).
// WHY the smooth curve's handles are a sixth of the way between the neighbours (handlesOf, in the loader): that is the
// Bézier form of the same Catmull-Rom curve, so the first grab of a handle starts where the path already is (no jump).
// WHY handles only on the position: the path is what people shape; a curve for angle / size over time is a graph
// editor's job (a window of its own, stage 3), and those keep their three eases.
import type { MotionKey } from '../contract.ts';
import { handlesOf, trackAt } from '../loader/studio-placement.js';

export type Side = 'in' | 'out';
/** A point as the head's "Point ▾" names it. */
export type PointKind = 'smooth' | 'corner' | 'custom';

const len = (v: number[]) => Math.hypot(...v);
const zero = (v: number[] | null | undefined) => !v || len(v) < 1e-9;
const r4 = (x: number) => Math.round(x * 10000) / 10000;

/** Key `i`'s two handles as drawn (its own, or the smooth curve's); null at the path's ends. */
export function handles(ks: MotionKey[], i: number): { in: number[] | null; out: number[] | null } {
  return handlesOf(ks, i) as { in: number[] | null; out: number[] | null };
}

export function pointKind(k: MotionKey): PointKind {
  if (!k.in && !k.out) return 'smooth';
  return zero(k.in) && zero(k.out) ? 'corner' : 'custom';
}

/**
 * Key `i` with its `side` handle at `h`. The other side lines up (pointing the opposite way, keeping its own length —
 * Blender's "Aligned", Figma's "mirror angle"), or keeps where it is with `alone` (Alt: the path breaks there). A side
 * that was 0 (a corner pulled out) takes the dragged one's length, so the point turns smooth-looking, not lopsided.
 */
export function bend(ks: MotionKey[], i: number, side: Side, h: number[], alone = false): MotionKey[] {
  const out = ks.map((k) => structuredClone(k));
  const k = out[i];
  if (!k) return out;
  const now = handles(ks, i);
  const other: Side = side === 'in' ? 'out' : 'in';
  const o = now[other];
  k[side] = h.map(r4);
  if (o) {
    if (alone || zero(h)) k[other] = o.map(r4);
    else {
      const l = zero(o) ? len(h) : len(o);
      k[other] = h.map((x) => r4((-x / len(h)) * l));
    }
  }
  return out;
}

/** Key `i` made a corner, made smooth again, or (custom) left as it is. */
export function setKind(ks: MotionKey[], i: number, kind: PointKind): MotionKey[] {
  const out = ks.map((k) => structuredClone(k));
  const k = out[i];
  if (!k || kind === 'custom') return out;
  delete k.in;
  delete k.out;
  if (kind === 'corner') {
    const zeros = k.v.map(() => 0);
    if (i > 0) k.in = zeros.slice();
    if (i < out.length - 1) k.out = zeros.slice();
    // A corner at an end with nothing to hold (a path of one point) is just a point.
    if (!k.in && !k.out) k.in = zeros.slice();
  }
  return out;
}

/** Double-click: a corner becomes smooth, anything else becomes a corner. */
export const toggleCorner = (ks: MotionKey[], i: number) => setKind(ks, i, ks[i] && pointKind(ks[i]!) === 'corner' ? 'smooth' : 'corner');

/**
 * A position key put at `t` on the path (the line clicked, or K), where the path is then — so the shape stays. In a
 * span bent by hand (a handle on either end) the span is cut there in two (de Casteljau), and both ends' handles are
 * written as they are, so neither the bend nor the spans beyond change. Between smooth points the new point is smooth
 * too (the curve through the points moves a hair: it now passes through one more). Its ease is the span's. Returns
 * the keys and the new key's index; a key already at `t` is left (index of it).
 */
export function insertAt(ks: MotionKey[], t: number): { keys: MotionKey[]; i: number } {
  const at = ks.findIndex((k) => Math.abs(k.t - t) < 0.0005);
  if (at >= 0) return { keys: ks, i: at };
  const out = ks.map((k) => structuredClone(k));
  const v = (trackAt(ks, t, true) as number[] | null) ?? ks[0]?.v.slice() ?? [];
  const j = out.findIndex((k) => k.t > t);
  const i = j < 0 ? out.length : j;
  const a = out[i - 1], b = out[i];
  const key: MotionKey = { t: r4(t), v: v.map(r4), ease: a?.ease ?? 'ease' };
  if (a && b && (a.out || b.in) && (a.ease ?? 'ease') !== 'step') {
    // The span's own parameter at t (the ease shapes time, not the curve): f where the curve is at t.
    let f = (t - a.t) / (b.t - a.t);
    if ((a.ease ?? 'ease') === 'ease') f = f * f * (3 - 2 * f);
    const ha = handles(ks, i - 1), hb = handles(ks, i);
    const P0 = a.v, P1 = a.v.map((x, n) => x + ha.out![n]!), P2 = b.v.map((x, n) => x + hb.in![n]!), P3 = b.v;
    const mix = (p: number[], q: number[]) => p.map((x, n) => x + (q[n]! - x) * f);
    const P01 = mix(P0, P1), P12 = mix(P1, P2), P23 = mix(P2, P3), P012 = mix(P01, P12), P123 = mix(P12, P23), M = mix(P012, P123);
    // Both ends keep both handles as drawn now (else a smooth side would follow the new neighbour and move).
    a.in = ha.in?.map(r4);
    a.out = P01.map((x, n) => r4(x - P0[n]!));
    b.in = P23.map((x, n) => r4(x - P3[n]!));
    b.out = hb.out?.map(r4);
    if (!a.in) delete a.in;
    if (!b.out) delete b.out;
    key.v = M.map(r4);
    key.in = P012.map((x, n) => r4(x - M[n]!));
    key.out = P123.map((x, n) => r4(x - M[n]!));
  }
  out.splice(i, 0, key);
  return { keys: out, i };
}
