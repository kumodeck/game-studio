// The strip's Turn button dragged (one object, or several turning together): how far each pointer step turns.
//
// Why this file (decided 2026-11-06, a first-run walk of v0.1.82): in 3D a straight drag of the Turn button did not turn
// the object at all — the chip stayed at "Turn 0°" — while the same drag in 2D turned it. Two causes, both fixed here:
//
// 1. The 15° snap was applied to EACH pointer step. A step of a slow drag turns ~1–3°, the object's angle then sat
//    within ±3° of the 15° step it started on, and the snap put it straight back — every step. Only a fast arc (7°+ per
//    step) ever got out. Now the snap is applied to the gesture's TOTAL: the drag adds up unsnapped, and the object goes
//    to the nearest 15° only when that total lands within ±3° of one (Shift: never).
// 2. The turn was measured only as the angle around the object's middle. 3D's strip sits under the object; a straight
//    pull sideways from there, or one that heads away from the middle, changes that angle very little. In 3D the
//    horizontal travel also counts now (TURN_PER_PX, the same rate as a drag with the Turn tool chosen): each step takes
//    whichever of the two turns more, so the old arc (around the middle) works exactly as before and a straight pull turns
//    too. Pulling right under the middle turns the way an arc there would (clockwise seen from above the strip), so the
//    two never fight.
// 2D keeps the angle only (its strip sits over the object and an arc is what people do there; it already turned).

/** 15° steps. */
export const TURN_SNAP = (15 * Math.PI) / 180;
/** Within ±3° of a step the total lands on it. */
export const TURN_SNAP_WINDOW = (3 * Math.PI) / 180;

/** One drag's running state (the bridge keeps it in the gesture's data). */
export interface TurnDrag {
  /** The screen turn the pointer asked for so far (radians, unsnapped). */
  total: number;
  /** The screen turn given to the object so far (total with the snap). */
  applied: number;
}

/**
 * This step's screen turn from the two readings: `arc` = the change of the pointer's angle around the object's middle
 * (radians), `dx` = the horizontal travel of this step (px). `perPx` 0 = the arc only (2D). `below` = the pointer is
 * under the middle (screen y down), where a pull to the right turns the negative way (as an arc there does).
 */
export function turnPick(arc: number, dx: number, perPx: number, below: boolean): number {
  if (!perPx) return arc;
  const straight = (below ? -1 : 1) * dx * perPx;
  return Math.abs(straight) > Math.abs(arc) ? straight : arc;
}

/**
 * Add one step `d` (screen radians) to the drag and say how much to turn the object now. `snap`: snapping is on (no
 * Shift, an axis the editor knows "straight" for); `r0` = the object's own angle when the drag began; `sign` = how the
 * object's angle follows the screen turn (+1 / −1; 0 = not known yet: no snap until it is).
 */
export function turnStep(s: TurnDrag, d: number, o: { snap: boolean; r0: number; sign: number }): number {
  s.total += d;
  let want = s.total;
  if (o.snap && o.sign) {
    const raw = o.r0 + o.sign * s.total;
    const target = Math.round(raw / TURN_SNAP) * TURN_SNAP;
    const off = target - raw;
    if (Math.abs(off) <= TURN_SNAP_WINDOW) want = s.total + off * o.sign;
  }
  const dd = want - s.applied;
  s.applied = want;
  return dd;
}
