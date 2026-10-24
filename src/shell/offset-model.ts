// Offsets of a rule layout (studio-offsets, 2026-10-24; CONTRACT.md §1.12 "Offsets", the plan's decisions 1–8 and 12–13
// of the plan). Pure logic, no DOM: the game page's drag (bridge/code-place.ts) and the
// editor's four choices, card rows and key steps (code-place-wire.ts, offset-choices.ts) do the same sums.
//
// WHY (the CRYSTAL FIELD try of 10/24): a lamp of a row dragged away from the road "did nothing and said
// nothing" — the code had no knob that way. "A rule's objects stay a rule however they are moved": a drag the code has no
// knob for becomes an OFFSET of the whole rule — which way, how and how much ({ way, how, v }, like a knob's { v, was }),
// never a place per object (a lamp the count adds would not get it, as a pin does not).
//
// The loader does the shifting (loader/studio-placement.js offsetAt). This adds a drag to the list:
//   a drag of the object of rank r0, `d` that way  →  same: v += d · zigzag: v += d on the rows with r0's parity
//   (odd = r0 is odd) · ramp: v += d / r0 (the nearest, rank 0, cannot start a ramp) · size: × instead of +.
// The same way and how are ONE row (a second sideways "All the same" adds to it — decision 6), and the row turned goes
// last: the next drag that way turns the row chosen last (decision 8). The order does not change the result.
import type { OffsetHow, OffsetWay, PlaceOffset, Pose } from '../contract.ts';

/** A rule's object in the offsets' frame (the loader's offsetFrame, as code-lists.ts sends it). */
export interface FrameRow {
  line: number;
  rank: number;
  along: [number, number];
  side: [number, number];
  mirror?: true;
}
/** A drag's amount: `d` is the offset's own number (m / px, °, a size factor; move: the ground [x, z] or 2D [x, y]). */
export type OffsetAmount = { way: Exclude<OffsetWay, 'move'>; d: number } | { way: 'move'; d: [number, number] };

/** A rule's rows at most (decision 6; placement.json refuses a ninth — schema LIMITS.maxOffsets). */
export const MAX_OFFSETS = 8;
/** The file's rounding (1e-4, like a knob), -0 as 0. */
export const round4 = (v: number) => Math.round(v * 10000) / 10000 + 0;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const sizeOf = (s: number | number[] | undefined) => (typeof s === 'number' ? Math.abs(s) || 1 : Array.isArray(s) && s.length ? s.reduce((a, b) => a + Math.abs(b), 0) / s.length || 1 : 1);

/** Does a row of this way and how do nothing (back to 0, or ×1)? */
function empty(o: PlaceOffset): boolean {
  if (o.way === 'move') return Math.abs(o.v[0]) < 1e-4 && Math.abs(o.v[1]) < 1e-4;
  return o.way === 'size' ? Math.abs(o.v - 1) < 1e-4 : Math.abs(o.v) < 1e-4;
}

/** Is `o` the row a drag of rank `rank` that way, this how, goes into (a zigzag's row is its parity's)? */
export function sameRow(o: PlaceOffset, way: OffsetWay, how: OffsetHow, rank: number): boolean {
  if (o.way !== way || o.how !== how) return false;
  return how !== 'zigzag' || !!(o as { odd?: true }).odd === (rank % 2 === 1);
}

/** Does this row move the object of rank `rank` (a zigzag of the other parity, a ramp at rank 0: no)? */
export function movesRank(o: PlaceOffset, rank: number): boolean {
  if (o.how === 'zigzag') return !!(o as { odd?: true }).odd === (rank % 2 === 1);
  return o.how !== 'ramp' || rank > 0;
}

/** The row of `way` chosen last (the end of the list), or null: a drag that way turns it next (decision 8). */
export function lastOf(offs: PlaceOffset[] | undefined, way: OffsetWay): PlaceOffset | null {
  for (let i = (offs?.length ?? 0) - 1; i >= 0; i--) if (offs![i]!.way === way) return offs![i]!;
  return null;
}

/**
 * The offsets after a drag of the object of rank `rank` by `a` (its way's number), kept as `how`: merged into the same
 * row, or a new one, which then goes last; a row back to nothing is taken out. null = `how` cannot say this drag (a
 * ramp from the nearest one: decision 5, "ramps start from the nearest"; move is "same" only).
 */
export function addOffset(offs: PlaceOffset[] | undefined, a: OffsetAmount, how: OffsetHow, rank: number): PlaceOffset[] | null {
  if (how === 'ramp' && rank < 1) return null;
  if (a.way === 'move' && how !== 'same') return null;
  const list = (offs ?? []).map((o) => structuredClone(o));
  const at = list.findIndex((o) => sameRow(o, a.way, how, rank));
  const old = at >= 0 ? list.splice(at, 1)[0]! : null;
  let row: PlaceOffset;
  if (a.way === 'move') {
    const v = (old?.v as [number, number] | undefined) ?? [0, 0];
    row = { way: 'move', how: 'same', v: [round4(v[0] + a.d[0]), round4(v[1] + a.d[1])] };
  } else {
    const was = old ? (old.v as number) : a.way === 'size' ? 1 : 0;
    let v: number;
    if (a.way === 'size') {
      // × a factor: the ramp's 1 + (v − 1) × rank for this one, times the drag's factor, then back to its v.
      v = how === 'ramp' ? 1 + ((1 + (was - 1) * rank) * a.d - 1) / rank : was * a.d;
    } else v = was + (how === 'ramp' ? a.d / rank : a.d);
    row = { way: a.way, how, v: round4(v), ...(how === 'zigzag' && rank % 2 === 1 ? { odd: true as const } : {}) };
  }
  // A ninth row would not save: the drag cannot make it (the line says "Up to 8 offsets · ✦ to fold them into the rule").
  if (!old && list.length >= MAX_OFFSETS) return null;
  if (!empty(row)) list.push(row);
  return list;
}

/** Would `a` as `how` need a new row on a rule that has MAX_OFFSETS already? */
export const offsetsFull = (offs: PlaceOffset[] | undefined, a: OffsetAmount, how: OffsetHow, rank: number) =>
  (offs?.length ?? 0) >= MAX_OFFSETS && !(offs ?? []).some((o) => sameRow(o, a.way, how, rank));

/**
 * How far a drag of `tool` from `from` to `to` went in the offsets' terms: Move of a row = along or side (whichever is
 * bigger, unless `way` is given), in the frame of the object dragged (`row`); Move of what is not a row = the ground
 * [x, z] (2D [x, y]); Height = up; Turn = ° round the up axis (mirrored on a row's second line, so the row's v turns the
 * dragged one as dragged); Size = the factor. `n` = 3 (3D) or 2.
 */
export function dragAmount(tool: 'move' | 'lift' | 'rotate' | 'scale', row: FrameRow | null, from: Pose, to: Pose, n: 2 | 3, way?: OffsetWay): OffsetAmount {
  if (tool === 'lift') return { way: 'up', d: (to.p[1] ?? 0) - (from.p[1] ?? 0) };
  if (tool === 'rotate') return { way: 'turn', d: ((row?.mirror ? -1 : 1) * wrap((to.r ?? 0) - (from.r ?? 0)) * 180) / Math.PI };
  if (tool === 'scale') return { way: 'size', d: sizeOf(to.s) / sizeOf(from.s) };
  const z = n === 3 ? 2 : 1;
  const dx = (to.p[0] ?? 0) - (from.p[0] ?? 0), dz = (to.p[z] ?? 0) - (from.p[z] ?? 0);
  if (!row || way === 'move') return { way: 'move', d: [dx, dz] };
  const da = dx * row.along[0] + dz * row.along[1];
  const ds = dx * row.side[0] + dz * row.side[1];
  const w = way === 'along' || way === 'side' ? way : Math.abs(da) >= Math.abs(ds) ? 'along' : 'side';
  return { way: w, d: w === 'along' ? da : ds };
}

/** The amount on a grid a hand can hit (a drag's live number): 3D 0.1 m, 2D 1 px, 1°, ×0.01. */
export function snapAmount(a: OffsetAmount, n: 2 | 3): OffsetAmount {
  const q = n === 3 ? 0.1 : 1;
  const s = (v: number, step: number) => round4(Math.round(v / step) * step);
  if (a.way === 'move') return { way: 'move', d: [s(a.d[0], q), s(a.d[1], q)] };
  return { way: a.way, d: s(a.d, a.way === 'turn' ? 1 : a.way === 'size' ? 0.01 : q) };
}

/** Is a drag's amount nothing (it did not go that way)? */
export const noAmount = (a: OffsetAmount) => (a.way === 'move' ? Math.abs(a.d[0]) < 1e-4 && Math.abs(a.d[1]) < 1e-4 : a.way === 'size' ? Math.abs(a.d - 1) < 1e-4 : Math.abs(a.d) < 1e-4);

/**
 * The offset this row adds to the object of rank `rank`, in its way's number (the card's dot picture and `--do list`):
 * same → v; zigzag → v or 0; ramp → v × rank (size: 1 + (v − 1) × rank).
 */
export function rowAt(o: PlaceOffset, rank: number): number | [number, number] {
  if (o.way === 'move') return o.v;
  if (o.how === 'zigzag') return movesRank(o, rank) ? o.v : o.way === 'size' ? 1 : 0;
  if (o.how === 'ramp') return o.way === 'size' ? 1 + (o.v - 1) * rank : o.v * rank;
  return o.v;
}
