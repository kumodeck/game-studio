// Snap to surfaces, the rules the bridge applies on top of the adapter's measures (3D; a request after a try of the editor, 2026-10-19: "in Unreal,
// an object moved up or down stops once when it meets the ground or another thing — I want to set things down
// exactly on the ground"). Pure: no DOM, no adapter, so test/snap.test.ts can say how each case ends.
//
// The three moves (adapters/three/surface.js finds the surfaces; the adapter does the move itself):
// - Height (the H tool, its drag): going down, the object's bottom stops on the first surface below it (the ground,
//   a pier's planks, a crate's lid). Pulling on past it by BREAK_PX (a mouse) / BREAK_PX_TOUCH (a finger) lets it go
//   through — under the water, into the ground — and the next surface down stops it again. Going up never stops (a
//   thing under a table is lifted out through it, as in the engines). `liftDetent` below.
// - PgDn (one step down): a step that would cross a surface ends on it; the next step from there goes through
//   (`stepDetent`). The step is the detent's "pull harder".
// - Move and Drop to floor (End) live in the adapter (adapter.js drag / drop): they need the ray casts every time.
// - Hold Ctrl or ⌥ / Alt while dragging: no snapping for as long as it is held (`freeHeld`). Blender's habit (its
//   manual: snapping is toggled "more temporarily by holding Ctrl"); ⌥ as well because Ctrl-click is the Mac's right
//   click and people reach for Option there. Pressed BEFORE the press, ⌥ still looks around (input.ts): it frees the
//   snap only once the drag is under way.
// WHY a detent (stop, then go on) and not a hard floor: things sometimes belong half in the ground (a post, a rock
// sunk in sand, a barrel floating low), and a floor you cannot pass would need a second key to get there.

/** Extra pull past a surface, in screen px, before the height drag lets go of it (a mouse; ~a fingertip for touch). */
export const BREAK_PX = 30;
export const BREAK_PX_TOUCH = 44;
/** Metres: closer than this counts as "on" the surface (the bottom sits on it; float noise on a 100 m scene stays under). */
export const ON_EPS = 0.005;

/** World heights of the object's bottom and of the highest surface under it (null: nothing below), as adapter.rest gives them. */
export interface Rest {
  bottom: number;
  below: number | null;
}

/** State kept for one height drag: the surface pulled through (null: none), so it does not catch again. */
export interface DetentState {
  through: number | null;
}

/**
 * The height drag's move, with the stop: `want` = the metres up (> 0) / down (< 0) the finger asks for now, from
 * where the object is; `k` = metres per screen px at the object (> 0). Returns the metres to move.
 * - want ≥ 0, or nothing below: as asked.
 * - the bottom already under the surface (sunk, or pulled through it before): as asked — the surface is not
 *   between the object and where it goes.
 * - the move would cross the surface: stop on it, until the finger is BREAK_PX past it; then let go (st.through)
 *   and move as asked.
 * - back above a surface it was pulled through: that surface catches again (st.through is cleared).
 */
export function liftDetent(r: Rest | null, want: number, k: number, st: DetentState, breakPx = BREAK_PX): number {
  if (!r) return want;
  if (st.through !== null && r.bottom > st.through + ON_EPS) st.through = null;
  if (want >= 0 || r.below === null) return want;
  const s = r.below;
  if (st.through !== null && s >= st.through - ON_EPS) return want;
  if (r.bottom < s - ON_EPS) return want;
  const land = s - r.bottom; // ≤ ~0: the move that sets the bottom on the surface
  if (want >= land) return want; // stays above it
  const pastPx = (land - want) / Math.max(1e-9, k);
  if (pastPx < breakPx) return land;
  st.through = s;
  return want;
}

/**
 * One PgDn step (`d` < 0 metres) with the stop: a step that would carry the bottom from above the surface to under
 * it ends on the surface; from on it (within ON_EPS) the step goes through. Up steps as asked.
 */
export function stepDetent(r: Rest | null, d: number): number {
  if (!r || r.below === null || d >= 0) return d;
  const s = r.below;
  if (r.bottom > s + ON_EPS && r.bottom + d < s) return s - r.bottom;
  return d;
}

/** Is the "no snapping" key held (Ctrl, or ⌥ / Alt)? Read from the pointer / key event. */
export const freeHeld = (e: { ctrlKey?: boolean; altKey?: boolean }): boolean => !!(e.ctrlKey || e.altKey);

/**
 * Several objects moved up / down together (a group's height drag, PgDn / End with several picked): the one that meets
 * its surface first decides — the smallest gap between a bottom and the surface under it, among those on or above
 * theirs. The group then stops as one piece, its arrangement kept. null: none has a surface under it.
 */
export function firstToTouch(rests: Array<Rest | null | undefined>): Rest | null {
  let best: Rest | null = null;
  for (const r of rests) {
    if (!r || r.below === null || r.bottom < r.below - ON_EPS) continue;
    if (!best || r.bottom - r.below < best.bottom - best.below!) best = r;
  }
  return best;
}
