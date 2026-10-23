// When does a pick from the list move the edit camera, and how far may it go? Pure maths on screen rectangles, so
// test/seen.test.ts can check the rules without a browser. Used by editor.ts (focusIfHidden / panIntoMiddle).
//
// WHY (plan step 2 "the camera stays put", 2026-10-23, first-run walk #3): in a runner (test/neon-run) picking the ship
// from the list sent the camera ~29 m back and the whole game became a dot, and it never came back. The ship was ON
// screen — only its foot and the row of handles under it were below the ask bar — but the old rule ("the whole box AND
// the handle row inside the free part of the frame") called it hidden, and the slide that followed was a pan "up the
// screen" from a near-level view (pitch ≈ 11°), which carries the ground tens of metres towards the camera.
// Two rules now:
// 1. seenEnough: an object the person can already see does not move the camera. "Can see" = at least a fifth of its
//    box is inside the free part of the frame (the ship: its top above the ask bar); a ground bigger than the frame:
//    its middle is.
// 2. tooSmall: when the camera does have to move, no step may leave the pick smaller than 1/6 of the free part's short
//    side (or than it was, if it was smaller already) — the slide stops there instead of pulling back down the road.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The part of the frame no floating panel covers (editor.ts freeArea). */
export interface Area {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * 0.2 = a fifth of the box inside the free part is "seen". Measured: the ship in neon-run at 1280 × 800 (its box
 * 144 × 220 px, the top ~60 px of it above the ask bar = 27 %) must count as seen (the plan: picking ship / gate /
 * hex-1 from the list leaves the camera where it is). 0.5 would call it hidden again; 0 = any pixel (a thing poking
 * in at the edge would never be brought in).
 */
export const SEEN_SHARE = 0.2;
/** 6 = the pick never shrinks below 1/6 of the free part's short side (the plan's number). */
export const MIN_PART = 6;

/** Is the object (its screen box) already seen in the free part? `margin` px in from the edges. */
export function seenEnough(r: Rect, f: Area, margin = 0): boolean {
  const g = { x0: f.x0 + margin, y0: f.y0 + margin, x1: f.x1 - margin, y1: f.y1 - margin };
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  const middleIn = cx >= g.x0 && cx <= g.x1 && cy >= g.y0 && cy <= g.y1;
  const area = r.w * r.h;
  // A point-sized box (a far coin): its middle inside is all there is to see.
  if (!(area > 1)) return middleIn;
  // Bigger than the free part (a ground, a sky): what is inside can be most of the frame and still a small share of
  // the box, so its middle inside is enough.
  if (middleIn && (r.w >= g.x1 - g.x0 || r.h >= g.y1 - g.y0)) return true;
  const iw = Math.max(0, Math.min(r.x + r.w, g.x1) - Math.max(r.x, g.x0));
  const ih = Math.max(0, Math.min(r.y + r.h, g.y1) - Math.max(r.y, g.y0));
  return (iw * ih) / area >= SEEN_SHARE;
}

/** The smallest a pick may get on screen while the camera slides to it (px, its box's longer side). */
export function minPickPx(f: Area): number {
  return Math.min(f.x1 - f.x0, f.y1 - f.y0) / MIN_PART;
}

/**
 * Would this step leave the pick too small? `before` = its size when the slide started, `after` = after the step
 * (px, longer side). Smaller than 1/6 already at the start (a far tree): it may not get smaller than that.
 */
export function tooSmall(before: number, after: number, f: Area): boolean {
  const floor = Math.min(before, minPickPx(f));
  // 0.75 = a quarter of give. A sideways pan in 3D changes the size a little by itself: a thing at the frame's edge is
  // drawn stretched by the perspective and shrinks as it comes to the middle (measured in neon-run: the ship turned out
  // to the right, 71 px, refused at 0.98 and the slide stopped at the edge). What this guards against is far bigger:
  // the walk-#3 slide shrank the ship ~3×.
  return after < floor * 0.75;
}
