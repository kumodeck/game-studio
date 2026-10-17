// Moving, turning and resizing several selected objects together
// (CONTRACT.md §1.8). Used by the handles (input.ts) and the keyboard /
// button steps (editor.ts).
//
// Every call works from the poses at the START of the gesture (absolute, not
// step by step), so a long drag never drifts and the end result is exactly
// "start + the total movement". The adapter (with the game rules) does all
// the engine maths; this file only decides where each member should go.
//
// WHY two ways:
// - 2D: in SCREEN space. Members can sit in different parents (a fence post
//   inside a scaled container next to a tree on the stage); moving each by
//   the same screen distance with grab()/drag() keeps them visually together
//   whatever their parents do.
// - 3D: in the PARENT space of the objects (the ground plane, metres). On a
//   perspective screen the same pixel distance is a different distance on the
//   ground for near and far objects, so the first member is moved with the
//   handle and the others get the same move in metres. Turning goes around the
//   middle of the group on the ground (vertical axis), as a turntable would.
import type { Anchor, GroupScaleMode, Item, Pose, StudioAdapter } from '../contract.ts';

export interface GroupSession {
  keys: string[];
  /** The member the handles follow (moved first in 3D). */
  primary: string;
  from: Map<string, Pose>;
  /** Screen pivot of each member at the start. */
  at: Map<string, [number, number]>;
  /** Screen middle of the selection at the start (2D turn / resize centre). */
  center: [number, number];
  /** 3D: middle of the members on the ground (x, z) and the lowest height. */
  ground: [number, number];
  minY: number;
  items: Map<string, Item>;
  /**
   * Each member's foot at the start: the bottom middle of what it looks like.
   * 3D: in parent space (adapter.foot); 2D: on screen (the bottom middle of
   * its screen box). Resizing keeps these on the ground (see groupScale).
   */
  feet: Map<string, number[]>;
  /** The middle of the feet (3D: x / z middle and the lowest foot; 2D: screen x middle and the lowest bottom). */
  footMid: number[] | null;
}

const wrap = (a: number) => {
  let r = a % (2 * Math.PI);
  if (r <= -Math.PI) r += 2 * Math.PI;
  if (r > Math.PI) r -= 2 * Math.PI;
  return r;
};
const clone = (p: Pose): Pose => structuredClone(p);

/** One rectangle around every member (viewport px), and its middle; null when none is on screen. */
export function groupAnchor(adapter: StudioAdapter, keys: string[], primary: string): Anchor | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  let visible = false;
  let pose: Pose | null = null;
  for (const k of keys) {
    const a = adapter.anchor(k);
    if (!a) continue;
    if (k === primary) pose = a.pose;
    pose = pose || a.pose;
    visible = visible || a.visible;
    const r = a.rect || { x: a.center[0] - a.size / 2, y: a.center[1] - a.size / 2, w: a.size, h: a.size };
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w);
    y1 = Math.max(y1, r.y + r.h);
  }
  if (!pose || !Number.isFinite(x0)) return null;
  return { center: [(x0 + x1) / 2, (y0 + y1) / 2], rect: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, size: Math.max(x1 - x0, y1 - y0), pose, visible };
}

export function beginGroup(adapter: StudioAdapter, keys: string[], primary: string): GroupSession | null {
  const items = new Map(adapter.list().map((i) => [i.key, i]));
  const live = keys.filter((k) => items.has(k));
  if (!live.length) return null;
  const s: GroupSession = {
    keys: live,
    primary: live.includes(primary) ? primary : live[0]!,
    from: new Map(),
    at: new Map(),
    center: [0, 0],
    ground: [0, 0],
    minY: 0,
    items,
    feet: new Map(),
    footMid: null,
  };
  let gx0 = Infinity, gz0 = Infinity, gx1 = -Infinity, gz1 = -Infinity;
  let minY = Infinity;
  for (const k of live) {
    const a = adapter.anchor(k);
    const pose = a?.pose ?? items.get(k)!.pose;
    s.from.set(k, clone(pose));
    if (a) s.at.set(k, [a.center[0], a.center[1]]);
    const [x = 0, y = 0, z = 0] = pose.p;
    gx0 = Math.min(gx0, x);
    gx1 = Math.max(gx1, x);
    gz0 = Math.min(gz0, z);
    gz1 = Math.max(gz1, z);
    minY = Math.min(minY, y);
  }
  s.ground = [(gx0 + gx1) / 2, (gz0 + gz1) / 2];
  s.minY = Number.isFinite(minY) ? minY : 0;
  const ga = groupAnchor(adapter, live, s.primary);
  s.center = ga ? ga.center : [0, 0];
  for (const k of live) {
    const f = footOf(adapter, k);
    if (f) s.feet.set(k, f);
  }
  const fs = [...s.feet.values()];
  if (fs.length) {
    if (adapter.dim === '3d') {
      const xs = fs.map((f) => f[0]!), zs = fs.map((f) => f[2]!);
      s.footMid = [(Math.min(...xs) + Math.max(...xs)) / 2, Math.min(...fs.map((f) => f[1]!)), (Math.min(...zs) + Math.max(...zs)) / 2];
    } else {
      const xs = fs.map((f) => f[0]!);
      s.footMid = [(Math.min(...xs) + Math.max(...xs)) / 2, Math.max(...fs.map((f) => f[1]!))];
    }
  }
  return s;
}

/** A member's foot now: 3D parent space (adapter.foot), 2D the bottom middle of its screen box. */
function footOf(adapter: StudioAdapter, k: string): number[] | null {
  if (adapter.dim === '3d') return adapter.foot ? adapter.foot(k) : null;
  const r = adapter.anchor(k)?.rect;
  return r ? [r.x + r.w / 2, r.y + r.h] : null;
}

const movable = (s: GroupSession, k: string) => s.items.get(k)?.movable !== false;
const rotatable = (s: GroupSession, k: string) => !!s.items.get(k)?.rotatable;
const scalable = (s: GroupSession, k: string) => !!s.items.get(k)?.scalable;

/** Back to the start pose (the first thing every absolute step does). */
const reset = (adapter: StudioAdapter, s: GroupSession, k: string) => adapter.setPose(k, s.from.get(k)!);

/** Put a member's pivot at screen point (x, y) (2D), starting from its start pose. */
function screenPlace(adapter: StudioAdapter, s: GroupSession, k: string, x: number, y: number) {
  const at = s.at.get(k);
  if (!at || !movable(s, k)) return;
  if (adapter.grab(k, at[0], at[1])) adapter.drag(k, x, y);
}

/** Everyone moved by (dx, dy) screen px from where the gesture started. */
export function groupMove(adapter: StudioAdapter, dim: '2d' | '3d', s: GroupSession, dx: number, dy: number): void {
  if (dim === '2d') {
    for (const k of s.keys) {
      reset(adapter, s, k);
      const at = s.at.get(k);
      if (at) screenPlace(adapter, s, k, at[0] + dx, at[1] + dy);
    }
    return;
  }
  // 3D: the first movable member follows the handle; the others copy its move in metres.
  const lead = movable(s, s.primary) ? s.primary : s.keys.find((k) => movable(s, k));
  if (!lead) return;
  reset(adapter, s, lead);
  const at = s.at.get(lead);
  if (!at || !adapter.grab(lead, at[0], at[1])) return;
  const moved = adapter.drag(lead, at[0] + dx, at[1] + dy);
  const f = s.from.get(lead)!;
  const delta = moved.p.map((v, i) => v - (f.p[i] ?? 0));
  groupShift(adapter, s, delta, lead);
}

/** Everyone (but `skip`) moved by `delta` in parent space from the start. */
export function groupShift(adapter: StudioAdapter, s: GroupSession, delta: number[], skip?: string): void {
  for (const k of s.keys) {
    if (k === skip) continue;
    const f = s.from.get(k)!;
    adapter.setPose(k, movable(s, k) ? { ...clone(f), p: f.p.map((v, i) => v + (delta[i] ?? 0)) } : f);
  }
}

/**
 * Turn the whole group by `d` radians as seen on screen (clockwise positive,
 * the same sign as `rotate()`), around its middle.
 */
export function groupRotate(adapter: StudioAdapter, dim: '2d' | '3d', s: GroupSession, d: number): void {
  if (dim === '2d') {
    const [cx, cy] = s.center;
    const c = Math.cos(d), n = Math.sin(d);
    for (const k of s.keys) {
      reset(adapter, s, k);
      const at = s.at.get(k);
      if (at) {
        const rx = at[0] - cx, ry = at[1] - cy;
        // Screen y points down, so this matrix turns clockwise for d > 0.
        screenPlace(adapter, s, k, cx + c * rx - n * ry, cy + n * rx + c * ry);
      }
      if (rotatable(s, k)) adapter.rotate(k, d);
    }
    return;
  }
  // 3D: how much the objects' own yaw changes for this screen turn, measured
  // on one member (the edit camera decides the sign), then the positions turn
  // the same amount around the middle of the group.
  let yaw = -d;
  for (const k of s.keys) {
    if (!rotatable(s, k)) continue;
    reset(adapter, s, k);
    const r0 = s.from.get(k)!.r ?? 0;
    yaw = wrap((adapter.rotate(k, d).r ?? r0) - r0);
    break;
  }
  const [gx, gz] = s.ground;
  const c = Math.cos(yaw), n = Math.sin(yaw);
  for (const k of s.keys) {
    const f = s.from.get(k)!;
    const [x = 0, y = 0, z = 0] = f.p;
    const rx = x - gx, rz = z - gz;
    // three.js rotation.y: (x, z) → (x cos + z sin, −x sin + z cos).
    const p = movable(s, k) ? [gx + rx * c + rz * n, y, gz - rx * n + rz * c] : f.p.slice();
    adapter.setPose(k, { ...clone(f), p });
    if (rotatable(s, k)) adapter.rotate(k, d);
  }
}

/**
 * Resize the whole group by `f` (> 0). Two ways (the size button's choice,
 * 2026-10-16; idea from the play tests of another placement editor):
 *   - `spread` ("together"): the gaps between the objects grow too, as if the
 *     whole arrangement were one picture being enlarged;
 *   - `inplace` ("each in place"): every object grows where it stands and the
 *     gaps stay.
 * Both keep each object's FOOT (the bottom middle of what it looks like) as
 * the fixed point, not its origin: an origin in the middle of a crate sank it
 * into the ground, and objects whose origins all sit at one point (built
 * where they are drawn) did not spread at all. Without a way to find feet
 * (a 3D adapter with no foot()), the old way: around the group's middle.
 */
export function groupScale(adapter: StudioAdapter, dim: '2d' | '3d', s: GroupSession, f: number, mode: GroupScaleMode = 'spread'): void {
  if (!(f > 0)) return;
  const mid = s.footMid;
  if (mid && s.feet.size) {
    for (const k of s.keys) {
      reset(adapter, s, k);
      const foot0 = s.feet.get(k);
      if (scalable(s, k)) adapter.scale(k, f);
      if (!foot0 || !movable(s, k)) continue;
      const now = footOf(adapter, k);
      if (!now) continue;
      // Where the foot should be: the same spot, or pushed out from the middle of the feet (heights too, so a
      // crate stacked on another stays on top of it as both grow).
      const target = mode === 'spread' ? foot0.map((v, i) => mid[i]! + f * (v - mid[i]!)) : foot0;
      if (dim === '3d') {
        const cur = adapter.anchor(k)?.pose ?? s.from.get(k)!;
        adapter.setPose(k, { ...clone(cur), p: cur.p.map((v, i) => v + (target[i]! - now[i]!)) });
      } else {
        const a = adapter.anchor(k);
        if (a && adapter.grab(k, a.center[0], a.center[1])) adapter.drag(k, a.center[0] + target[0]! - now[0]!, a.center[1] + target[1]! - now[1]!);
      }
    }
    return;
  }
  if (dim === '2d') {
    const [cx, cy] = s.center;
    for (const k of s.keys) {
      reset(adapter, s, k);
      const at = s.at.get(k);
      if (at && mode === 'spread') screenPlace(adapter, s, k, cx + f * (at[0] - cx), cy + f * (at[1] - cy));
      if (scalable(s, k)) adapter.scale(k, f);
    }
    return;
  }
  const [gx, gz] = s.ground;
  for (const k of s.keys) {
    const p0 = s.from.get(k)!;
    const [x = 0, y = 0, z = 0] = p0.p;
    const p = movable(s, k) && mode === 'spread' ? [gx + f * (x - gx), s.minY + f * (y - s.minY), gz + f * (z - gz)] : p0.p.slice();
    adapter.setPose(k, { ...clone(p0), p });
    if (scalable(s, k)) adapter.scale(k, f);
  }
}

/** 3D: raise / lower every member that may move up and down, by `dy` (incremental). */
export function groupLift(adapter: StudioAdapter, s: GroupSession, dy: number): void {
  if (!adapter.nudgeY) return;
  for (const k of s.keys) if (movable(s, k) && s.items.get(k)?.liftable !== false) adapter.nudgeY(k, dy);
}

/** Current poses of the members (after a step), with `from` when asked for. */
export function groupPoses(adapter: StudioAdapter, s: GroupSession, withFrom: boolean): Array<{ key: string; pose: Pose; from?: Pose }> {
  const out: Array<{ key: string; pose: Pose; from?: Pose }> = [];
  for (const k of s.keys) {
    const pose = adapter.anchor(k)?.pose ?? s.from.get(k)!;
    out.push(withFrom ? { key: k, pose, from: s.from.get(k)! } : { key: k, pose });
  }
  return out;
}
