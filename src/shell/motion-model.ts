// What the editor remembers about motions (motion-gui, 2026-10-22; CONTRACT.md §4.1 `motion`): each object's motion
// now, and what the last save held. Pure logic, no DOM: unit-tested in test/motion.test.ts.
//
// WHY a store of its own and not more fields on PlacementModel: a motion is not a pose. It has its own "changed since
// the save" (one Save count per object whose motion changed), its own undo change, and it is written to its own
// part of placement.json. PlacementModel holds one of these and calls it from restore / result / dirty / markSaved,
// so the pose logic there is untouched (other members of the team change that file the same week).
//
// Also here: the card's words for a motion ("kind"), the default speeds, and the "+" that adds a point — small pure
// helpers the card (motion-row.ts) and the tests share.
import type { Dim, Motion, MotionRepeat } from '../contract.ts';

/** What the card's menu offers: none, the three path kinds, and spin. */
export type MotionKind = 'none' | MotionRepeat | 'spin';

/** The first speed of a new path: a walk (3D, 1.5 m/s) or 120 px/s (2D). Spin: 90° a second (a quarter turn). */
export const DEFAULT_SPEED: Record<Dim, number> = { '3d': 1.5, '2d': 120 };
export const DEFAULT_SPIN = Math.PI / 2;

/** The card's kind for a motion: its path's repeat, else spin, else none. A motion with both shows its path. */
export function kindOf(m: Motion | null | undefined): MotionKind {
  if (!m) return 'none';
  if (m.path?.length) return m.repeat ?? 'pingpong';
  return m.spin ? 'spin' : 'none';
}

/**
 * The motion after the card's menu chose `kind`. Keeps what can be kept: the path when switching between back and
 * forth / loop / once (the person's points are not thrown away), the spin when a path kind is chosen on a spinning
 * object. A path kind with no path yet gets `path: []` — the bridge picks the first points in sight (motion/show
 * `seed`) — or `fallback` points when there is no game to ask. null = no motion.
 */
export function withKind(m: Motion | null | undefined, kind: MotionKind, dim: Dim, fallback: number[][] = []): Motion | null {
  if (kind === 'none') return null;
  if (kind === 'spin') return { spin: m?.spin || DEFAULT_SPIN };
  const out: Motion = { path: m?.path?.length ? m.path.map((p) => p.slice()) : fallback.map((p) => p.slice()), speed: m?.speed ?? DEFAULT_SPEED[dim], repeat: kind };
  if (m?.spin) out.spin = m.spin;
  return out;
}

/**
 * The first points of a new path when the game cannot say what is in sight: 3 m (3D) / 150 px (2D) to the right; a
 * loop gets a square (right, then away / down the screen, then back). The bridge's seed replaces them with points
 * that are on screen.
 */
export function fallbackPath(kind: MotionKind, dim: Dim): number[][] {
  const d = dim === '3d' ? 3 : 150;
  const right = dim === '3d' ? [d, 0, 0] : [d, 0];
  if (kind !== 'loop') return [right];
  return dim === '3d' ? [right, [d, 0, -d], [0, 0, -d]] : [right, [d, d], [0, d]];
}

/**
 * The "+" on the card: one more point. A loop gets it in the middle of its closing side (last point → start), so the
 * round grows a corner where it is easiest to drag; a back-and-forth / once path is carried on past its end by half
 * its last side (or by the first point's offset again, for a one-point path).
 */
export function addPoint(m: Motion): Motion {
  const path = (m.path || []).map((p) => p.slice());
  if (!path.length) return m;
  const last = path[path.length - 1]!;
  const prev = path.length > 1 ? path[path.length - 2]! : last.map(() => 0);
  const next = m.repeat === 'loop' ? last.map((v) => v / 2) : last.map((v, i) => v + (v - prev[i]!) / 2);
  if (path.length >= 32) return m;
  return { ...m, path: [...path, next.map((v) => Math.round(v * 1000) / 1000)] };
}

/** The "−": the last point goes (a path keeps at least one). */
export function dropPoint(m: Motion): Motion {
  const path = m.path || [];
  if (path.length <= 1) return m;
  return { ...m, path: path.slice(0, -1).map((p) => p.slice()) };
}

/** Same motion (the file's rounding: 1 mm / 1e-4 rad), so a drag that ends where it began is not a change. */
export function sameMotion(a: Motion | null | undefined, b: Motion | null | undefined): boolean {
  return JSON.stringify(roundMotion(a)) === JSON.stringify(roundMotion(b));
}

/** A motion as the file writes it (rounded, fields in one order), or null for none / an empty path with no spin. */
export function roundMotion(m: Motion | null | undefined, dim: Dim = '3d'): Motion | null {
  if (!m) return null;
  const step = dim === '3d' ? 1000 : 10;
  const r = (v: number, s: number) => {
    const x = Math.round(v * s) / s;
    return x === 0 ? 0 : x;
  };
  const out: Motion = {};
  if (m.path?.length) {
    out.path = m.path.map((p) => p.map((v) => r(v, step)));
    if (m.speed !== undefined) out.speed = r(m.speed, step);
    if (m.repeat !== undefined) out.repeat = m.repeat;
  }
  if (m.spin) out.spin = r(m.spin, 10000);
  return out.path || out.spin ? out : null;
}

export class MotionStore {
  private now = new Map<string, Motion>();
  private saved = new Map<string, Motion>();

  /** The saved file's motions (before the game lists its objects): they are what the editor starts from. */
  restore(file: Record<string, Motion> | undefined): void {
    this.now.clear();
    this.saved.clear();
    for (const [k, m] of Object.entries(file || {})) {
      this.now.set(k, structuredClone(m));
      this.saved.set(k, structuredClone(m));
    }
  }

  get(key: string): Motion | null {
    const m = this.now.get(key);
    return m ? structuredClone(m) : null;
  }

  /** null = no motion. An empty path waiting for the bridge's seed is kept (and written to no file until it has points). */
  set(key: string, m: Motion | null): void {
    if (m) this.now.set(key, structuredClone(m));
    else this.now.delete(key);
  }

  /** Keys whose motion differs from the last save (each is one Save count and a dot on its row). */
  changedKeys(): string[] {
    const keys = new Set([...this.now.keys(), ...this.saved.keys()]);
    return [...keys].filter((k) => !sameMotion(this.now.get(k), this.saved.get(k)));
  }

  /**
   * The `motion` part of placement.json: every motion with points or a spin, rounded. `gone` = keys that are not in
   * the scene any more (deleted): their motion is left out (the schema refuses a deleted key that moves).
   */
  result(dim: Dim, gone: (key: string) => boolean): Record<string, Motion> | undefined {
    const out: Record<string, Motion> = {};
    for (const [k, m] of this.now) {
      if (gone(k)) continue;
      const r = roundMotion(m, dim);
      if (r) out[k] = r;
    }
    return Object.keys(out).length ? out : undefined;
  }

  markSaved(): void {
    this.saved = new Map([...this.now].map(([k, m]) => [k, structuredClone(m)]));
  }
}
