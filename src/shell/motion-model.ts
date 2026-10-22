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
import type { Dim, Motion, MotionClip } from '../contract.ts';
import { CHANNELS, toClips } from './timeline-model.ts';

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
      // Fields in the file's order: name, len, repeat, start, when, keys (keys last: the long part).
      const keys: MotionClip['keys'] = {};
      for (const ch of CHANNELS) {
        const ks = c.keys?.[ch];
        if (!ks?.length) continue;
        const s = ch === 'p' ? step : 10000;
        keys[ch] = ks.map((k) => ({ t: r(k.t, 1000), v: k.v.map((v) => r(v, s)), ...(k.ease && k.ease !== 'ease' ? { ease: k.ease } : {}) }));
      }
      return {
        name: c.name,
        len: r(c.len, 1000),
        ...(c.repeat && c.repeat !== 'once' ? { repeat: c.repeat } : {}),
        ...(c.start ? { start: true } : {}),
        ...(!c.start && c.when?.trim() ? { when: c.when.trim().slice(0, 200) } : {}),
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

export class MotionStore {
  private now = new Map<string, Motion>();
  private saved = new Map<string, Motion>();
  /** The world's dim, for reading the older shape (2D spins are one angle). Set by PlacementModel. */
  dim: Dim = '3d';

  /** The saved file's motions (before the game lists its objects): they are what the editor starts from. */
  restore(file: Record<string, Motion> | undefined): void {
    this.now.clear();
    this.saved.clear();
    for (const [k, raw] of Object.entries(file || {})) {
      const m = toClips(raw, this.dim) ?? raw;
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
