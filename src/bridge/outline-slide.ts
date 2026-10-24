// The pick's outline, slid instead of measured again (studio-fix-0146, 2026-10-24). Pure, so it is unit-tested
// (test/outline-slide.test.ts); input.ts shapeOf uses it.
//
// The outline's shape (adapter.silhouette: three renders of the game and a read-back) was measured on every frame a
// picked object moved, and handles.ts ring() drew the ring again on every frame. A thing that only slides keeps its
// shape on screen, so the last one is moved by the boxes' shift instead. (Looked at for x-motion-0145's ▶ at ~20
// frames a second with a pick; that one's main cause was the timeline path's toScreen, adapters/three/index.ts.)

/**
 * How boxes moved from `was` to `now` (the same objects in the same order): the shift of their middles, and `sized` =
 * every box kept its size and moved by that same shift (within 1.5 px), so a shape measured on `was` is still right
 * when slid by it (input.ts shapeOf). null = not the same number of boxes.
 */
export function slideOf(was: Array<{ x: number; y: number; w: number; h: number }>, now: Array<{ x: number; y: number; w: number; h: number }>): { dx: number; dy: number; sized: boolean } | null {
  if (!was.length || was.length !== now.length) return null;
  const mid = (r: { x: number; y: number; w: number; h: number }) => [r.x + r.w / 2, r.y + r.h / 2] as const;
  const [ax, ay] = mid(was[0]!), [bx, by] = mid(now[0]!);
  const dx = bx - ax, dy = by - ay;
  const tol = 1.5;
  const sized = now.every((r, i) => {
    const w = was[i]!;
    const [px, py] = mid(w), [qx, qy] = mid(r);
    return Math.abs(r.w - w.w) <= tol && Math.abs(r.h - w.h) <= tol && Math.abs(qx - px - dx) <= tol && Math.abs(qy - py - dy) <= tol;
  });
  return { dx, dy, sized };
}
