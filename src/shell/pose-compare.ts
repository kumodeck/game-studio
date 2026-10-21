// Pose rounding and comparison: the file's precision (1 mm or 0.1 px, 1e-4 rad) and "the same pose".
// Split out of placement-model.ts (2026-10-21) so the game page's ▶ Play code (bridge/play-arrange.ts) compares
// poses exactly as the editor does without bundling the whole model into studio-edit.js (it added 37 KB).
import { LIMITS, type Dim, type Pose } from '../contract.ts';

function roundTo(v: number, step: number): number {
  return Math.round(v / step) * step;
}

/** Round a pose to the file's precision (1 mm or 0.1 px, 1e-4 rad). */
export function roundPose(p: Pose, dim: Dim): Pose {
  const step = dim === '3d' ? LIMITS.step3d : LIMITS.step2d;
  const fix = (v: number, s: number) => Number(roundTo(v, s).toFixed(6));
  const out: Pose = { p: p.p.map((v) => fix(v, step)) };
  if (p.r !== undefined) out.r = fix(p.r, LIMITS.stepAngle);
  if (p.s !== undefined) out.s = Array.isArray(p.s) ? p.s.map((v) => fix(v, 0.0001)) : fix(p.s, 0.0001);
  // 3D tilt (rotation.x, rotation.z): only when the object was tipped (see Pose.t).
  if (p.t !== undefined && dim === '3d') out.t = [fix(p.t[0], LIMITS.stepAngle), fix(p.t[1], LIMITS.stepAngle)];
  return out;
}

/**
 * Two angles (already rounded) are the same turn: compared around the circle, not as numbers.
 *
 * WHY (90° bug, 2026-10-17): turning a 3D object past 90° about the up axis makes three.js write the same
 * rotation as x = ±π, y = π − θ, z = ±π. π rounds to 3.1416 in the file, which is a hair MORE than π, so the
 * adapter reads it back wrapped into (−π, π] as −3.14159 — the same turn, a different number. Comparing the
 * rounded JSON made every reopen of such a save show "Save · 1" with nothing changed.
 */
function sameAngle(a: number | undefined, b: number | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  const TAU = Math.PI * 2;
  const d = Math.abs((((a - b) % TAU) + TAU) % TAU);
  // Half a rounding step: values one step apart (a real nudge) still differ.
  return Math.min(d, TAU - d) < LIMITS.stepAngle / 2;
}

export function samePose(a: Pose | undefined, b: Pose | undefined, dim: Dim): boolean {
  if (!a || !b) return a === b;
  const x = roundPose(a, dim), y = roundPose(b, dim);
  if (JSON.stringify(x.p) !== JSON.stringify(y.p) || JSON.stringify(x.s) !== JSON.stringify(y.s)) return false;
  if (!sameAngle(x.r, y.r)) return false;
  if (!x.t || !y.t) return !x.t === !y.t;
  return sameAngle(x.t[0], y.t[0]) && sameAngle(x.t[1], y.t[1]);
}
