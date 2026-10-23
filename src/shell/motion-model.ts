// What the editor remembers about motions (motion-gui, 2026-10-22; the timeline's clips since studio-timeline the same
// day; CONTRACT.md §4.1 `motion`): each object's motion now, and what the last save held. Pure logic, no DOM:
// unit-tested in test/timeline.test.ts.
//
// WHY a store of its own and not more fields on PlacementModel: a motion is not a pose. It has its own "changed since
// the save" (one Save count per object whose motion changed), its own undo change, and it is written to its own
// part of placement.json. PlacementModel holds one of these and calls it from restore / result / dirty / markSaved,
// so the pose logic there is untouched (other members of the team change that file the same week).
//
// The file's older shape (v0.1.13: path / speed / repeat / spin) is turned into one clip when the file is read
// (timeline-model.ts toClips), for the saved copy too: opening an old file is not a change; the next Save writes clips.
//
// Since studio-motion-triggers (2026-10-22) an object's clips are ATTACHMENTS: `{ use, when, until }` naming a Library
// motion (motion-library.ts holds its len / repeat / keys). A clip that still holds keys of its own (an older file) is
// turned into a Library motion when the file is read, for the saved copy too (opening is not a change).
import type { Dim, LibraryMotion, Motion, MotionClip, MotionUntil, MotionWhen } from '../contract.ts';
import { whenOf } from '../loader/studio-placement.js';
import { motionLibrary, type MotionLibrary } from './motion-library.ts';
import { CHANNELS, toClips } from './timeline-model.ts';

/** An attachment as the file writes it: rounded, fields in one order (name only when it differs from use). */
function roundWhen(w: MotionWhen, r: (v: number, s: number) => number, step: number): MotionWhen {
  const x = structuredClone(w);
  if (x.on === 'time') x.after = r(x.after, 1000);
  if (x.on === 'enter') x.area = { p: x.area.p.map((v) => r(v, step)), size: x.area.size.map((v) => r(Math.abs(v), step)) };
  if (x.on === 'say') {
    const say = x.say?.trim().slice(0, 200);
    return say ? { on: 'say', say } : { on: 'say' };
  }
  return x;
}
function roundUntil(u: MotionUntil | undefined): MotionUntil | undefined {
  if (!u) return undefined;
  const x: MotionUntil = {};
  if (u.times) x.times = Math.max(1, Math.round(u.times));
  if (u.cue) x.cue = u.cue;
  if (u.then === 'reset') x.then = 'reset';
  return x.times || x.cue || x.then ? x : undefined;
}

/** A Library motion as the file writes it (the same rounding as a clip's keys; a scene motion: each object's track). */
export function roundLib(m: LibraryMotion, dim: Dim = '3d'): LibraryMotion {
  const one = (keys: MotionClip['keys']) => roundMotion({ clips: [{ ...m, start: undefined, when: undefined, keys: keys ?? {} }] }, dim)!.clips![0]!;
  const c = one(m.keys);
  const head = { name: c.name, len: c.len, ...(c.repeat ? { repeat: c.repeat } : {}) };
  if (!m.tracks) return { ...head, keys: c.keys };
  // The file has `tracks` instead of `keys` (LibraryMotion.keys stays {} in the editor; the cast leaves it out).
  // …and the rows' order with them (studio-ui-lead2): the file sorts object keys, the array keeps the person's order.
  return { ...head, tracks: Object.fromEntries(Object.entries(m.tracks).map(([k, ks]) => [k, one(ks).keys])), ...(m.order?.length ? { order: m.order.slice() } : {}) } as LibraryMotion;
}

/** Same motion (the file's rounding), so a drag that ends where it began is not a change. */
export function sameMotion(a: Motion | null | undefined, b: Motion | null | undefined): boolean {
  return JSON.stringify(roundMotion(a)) === JSON.stringify(roundMotion(b));
}

/**
 * A motion as the file writes it (rounded: 1 mm / 0.1 px, 1e-4 rad and size, 1 ms; fields in one order), or null for
 * none. Clips keep only the channels that have keys; a clip with no key at all is still written (a named motion the
 * person made and has not filled yet is theirs).
 */
export function roundMotion(m: Motion | null | undefined, dim: Dim = '3d'): Motion | null {
  if (!m) return null;
  const step = dim === '3d' ? 1000 : 10;
  const r = (v: number, s: number) => {
    const x = Math.round(v * s) / s;
    return x === 0 ? 0 : x;
  };
  if (m.clips?.length) {
    const clips = m.clips.map((c) => {
      if (c.use) {
        // An attachment (studio-motion-triggers): which Library motion, and when it starts / stops.
        const until = roundUntil(c.until);
        // `when`: one, or a list of 2–4 (studio-timeline-2: "E or a click"); a list of one is written as itself.
        const ws = Array.isArray(c.when) ? c.when.filter((w) => w && typeof w.on === 'string') : [];
        return {
          ...(c.name && c.name !== c.use ? { name: c.name } : {}),
          use: c.use,
          when: ws.length > 1 ? ws.slice(0, 4).map((w) => roundWhen(w, r, step)) : roundWhen(whenOf(c) as MotionWhen, r, step),
          ...(until ? { until } : {}),
        } as MotionClip;
      }
      // Fields in the file's order: name, len, repeat, start, when, keys (keys last: the long part).
      const keys: MotionClip['keys'] = {};
      for (const ch of CHANNELS) {
        const ks = c.keys?.[ch];
        if (!ks?.length) continue;
        const s = ch === 'p' ? step : 10000;
        // The path's handles (studio-timeline-2) only on position keys, rounded like the point itself.
        keys[ch] = ks.map((k) => ({ t: r(k.t, 1000), v: k.v.map((v) => r(v, s)), ...(k.ease && k.ease !== 'ease' ? { ease: k.ease } : {}),
          ...(ch === 'p' && k.in ? { in: k.in.map((v) => r(v, s)) } : {}), ...(ch === 'p' && k.out ? { out: k.out.map((v) => r(v, s)) } : {}) }));
      }
      return {
        name: c.name,
        len: r(c.len, 1000),
        ...(c.repeat && c.repeat !== 'once' ? { repeat: c.repeat } : {}),
        ...(c.start ? { start: true } : {}),
        ...(!c.start && typeof c.when === 'string' && c.when.trim() ? { when: c.when.trim().slice(0, 200) } : {}),
        ...(!c.start && c.when && typeof c.when === 'object' ? { when: Array.isArray(c.when) ? c.when.map((w) => roundWhen(w, r, step)) : roundWhen(c.when, r, step) } : {}),
        ...(roundUntil(c.until) ? { until: roundUntil(c.until) } : {}),
        keys,
      };
    });
    return { clips };
  }
  // The older shape (a file the editor could not turn into clips is kept as it was).
  const out: Motion = {};
  if (m.path?.length) {
    out.path = m.path.map((p) => p.map((v) => r(v, step)));
    if (m.speed !== undefined) out.speed = r(m.speed, step);
    if (m.repeat !== undefined) out.repeat = m.repeat;
  }
  if (m.spin) out.spin = r(m.spin, 10000);
  return out.path || out.spin ? out : null;
}

/**
 * An object's motion with every clip as an attachment: a clip with keys of its own becomes a Library motion (adopt) and
 * the clip names it. Its `when`: studio-timeline's `start: true` → the game starts, its words → `say`.
 */
export function attachAll(m: Motion, lib: MotionLibrary): Motion {
  if (!m.clips?.length) return m;
  return {
    clips: m.clips.map((c) => {
      if (c.use) return { ...c, keys: {} } as MotionClip;
      const use = lib.adopt(c, true);
      const out = { name: c.name, use, len: c.len, when: whenOf(c) as MotionWhen, keys: {} } as MotionClip;
      if (c.until) out.until = c.until;
      return out;
    }),
  };
}

/**
 * A level's motions as a file part, every clip an attachment (the levels waiting in levels.ts, read once when the file
 * opens: their old clips become Library motions now, so a save writes them in the new shape even if never visited).
 */
export function attachWorld(motion: Record<string, Motion> | undefined, lib: MotionLibrary, dim: Dim): Record<string, Motion> | undefined {
  if (!motion) return motion;
  const out: Record<string, Motion> = {};
  for (const [k, raw] of Object.entries(motion)) {
    const c = toClips(raw, dim);
    const r = roundMotion(c ? attachAll(c, lib) : raw, dim);
    if (r) out[k] = r;
  }
  return out;
}

export class MotionStore {
  private now = new Map<string, Motion>();
  private saved = new Map<string, Motion>();
  /** The world's dim, for reading the older shape (2D spins are one angle). Set by PlacementModel. */
  dim: Dim = '3d';
  /** The Library's motions the clips use (the page's one; tests give their own). */
  lib: MotionLibrary = motionLibrary;

  /** The saved file's motions (before the game lists its objects): they are what the editor starts from. */
  restore(file: Record<string, Motion> | undefined): void {
    this.now.clear();
    this.saved.clear();
    for (const [k, raw] of Object.entries(file || {})) {
      const c = toClips(raw, this.dim);
      const m = c ? attachAll(c, this.lib) : raw;
      this.now.set(k, structuredClone(m));
      this.saved.set(k, structuredClone(m));
    }
  }

  get(key: string): Motion | null {
    const m = this.now.get(key);
    return m ? structuredClone(m) : null;
  }

  /** Every key that has a motion now. */
  keys(): string[] {
    return [...this.now.keys()];
  }

  /** null = no motion. */
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
   * The `motion` part of placement.json: every motion, rounded. `gone` = keys that are not in the scene any more
   * (deleted): their motion is left out (the schema refuses a deleted key that moves).
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
