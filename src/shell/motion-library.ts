// The Library's motions (studio-motion-triggers, 2026-10-22; CONTRACT.md §4.1 `motions`): named motions that are assets
// of their own, used by objects by name. Pure logic, no DOM: unit-tested in test/motion-triggers.test.ts.
//
// A request (2026-10-22): "Treat a motion as one of the assets: then a creator ties motions to objects and asks the AI 'play this
// motion when …'". So a motion (len / repeat / keys) no longer belongs to one object: an object's clip says which motion
// it uses (`use`) and when it starts / stops (`when` / `until`). Unity has the same split: the AnimationClip asset, and
// the Animator's transitions that say when it plays.
//
// WHY one store for the whole file, not one per level like MotionStore: a level's objects are that level's, but a motion
// is an asset any level's object may use ("Bob" on a buoy in Meadow and in Cave). It sits at the top of placement.json
// next to `levels` and survives a switch of level (main.ts keeps one of these; PlacementModel makes a new MotionStore
// per level).
//
// Reading a file made before this (studio-timeline: each object's clips hold their own keys) turns every such clip into
// a Library motion (adopt): a clip with the same name and the same keys as one already here is the same motion; the same
// name with other keys becomes "Open 2". It is done for the saved copy too, so opening an old file is not a change.
import type { LibraryMotion, Motion, MotionClip, PlacementFile } from '../contract.ts';

/**
 * A Library motion as the file writes it (fields in one order; repeat 'once' left out: the default). A scene motion
 * (studio-timeline-2: `tracks`, several objects' keys) keeps `keys` empty in the editor.
 */
export function libOf(c: Pick<MotionClip, 'name' | 'len' | 'repeat' | 'keys'> & { tracks?: LibraryMotion['tracks']; order?: string[] }): LibraryMotion {
  // `order` (studio-ui-lead2: the rows' order) only with tracks, and only the keys that are tracks.
  const order = c.tracks && c.order ? c.order.filter((k, i, a) => k in c.tracks! && a.indexOf(k) === i) : null;
  return { name: c.name, len: c.len, ...(c.repeat && c.repeat !== 'once' ? { repeat: c.repeat } : {}), keys: c.tracks ? {} : structuredClone(c.keys ?? {}),
    ...(c.tracks ? { tracks: structuredClone(c.tracks) } : {}), ...(order?.length ? { order } : {}) };
}

// The order is part of the motion (a reorder is a change to save — studio-ui-lead2).
const sig = (m: LibraryMotion) => JSON.stringify([m.len, m.repeat ?? 'once', m.keys, m.tracks ?? null, m.order ?? null]);

export class MotionLibrary {
  private now = new Map<string, LibraryMotion>();
  private saved = new Map<string, LibraryMotion>();

  /**
   * The file's `motions`, then every clip with keys of its own anywhere in it (the top `motion` and each level's) as a
   * Library motion — both as it is now and as saved. MotionStore.restore later asks adopt() for the same clips and gets
   * the same names back.
   */
  restore(file: Partial<PlacementFile> | null | undefined): void {
    this.now.clear();
    this.saved.clear();
    for (const m of file?.motions ?? []) if (m && typeof m.name === 'string' && !this.now.has(m.name)) this.now.set(m.name, libOf(m));
    const worlds = [file?.motion, ...(file?.levels ?? []).map((l) => l.motion)];
    for (const w of worlds) for (const m of Object.values(w ?? {})) for (const c of (m as Motion)?.clips ?? []) if (!c.use && c.keys) this.adopt(c);
    this.saved = new Map([...this.now].map(([k, v]) => [k, structuredClone(v)]));
  }

  /**
   * The Library motion for a clip with keys of its own: the one with this name and these keys, or a new one (named
   * "Open 2" when "Open" is taken by other keys). New ones count as saved when `asSaved` (a file being read).
   */
  adopt(c: MotionClip, asSaved = false): string {
    const m = libOf(c);
    const same = this.now.get(c.name);
    if (same && sig(same) === sig(m)) return c.name;
    for (const [name, x] of this.now) if (name.startsWith(`${c.name} `) && sig(x) === sig(m)) return name;
    const name = this.free(c.name);
    m.name = name;
    this.now.set(name, m);
    if (asSaved) this.saved.set(name, structuredClone(m));
    return name;
  }

  /** "Hop", or "Hop 2", "Hop 3"… — a name no Library motion has. */
  free(base: string): string {
    const b = base.trim().slice(0, 40) || 'Motion';
    if (!this.now.has(b)) return b;
    for (let i = 2; ; i++) if (!this.now.has(`${b} ${i}`)) return `${b} ${i}`;
  }

  get(name: string): LibraryMotion | null {
    const m = this.now.get(name);
    return m ? structuredClone(m) : null;
  }

  has(name: string): boolean {
    return this.now.has(name);
  }

  /** Every motion, in the order they were made (the Library's tiles). */
  list(): LibraryMotion[] {
    return [...this.now.values()].map((m) => structuredClone(m));
  }

  /** null = gone from the Library. A new one goes at the end. */
  set(name: string, m: LibraryMotion | null): void {
    if (m) this.now.set(name, { ...libOf(m), name });
    else this.now.delete(name);
  }

  /** A new name, keeping its place in the list. false = taken or not there. */
  rename(from: string, to: string): boolean {
    if (!this.now.has(from) || this.now.has(to) || !to.trim()) return false;
    this.now = new Map([...this.now].map(([k, v]) => (k === from ? [to, { ...v, name: to }] : [k, v])));
    return true;
  }

  /** Motions that differ from the last save (each is one Save count). */
  changedNames(): string[] {
    const names = new Set([...this.now.keys(), ...this.saved.keys()]);
    return [...names].filter((n) => {
      const a = this.now.get(n), b = this.saved.get(n);
      return !a || !b || sig(a) !== sig(b);
    });
  }

  /** placement.json's `motions`, or undefined with none. `round` = the file's rounding (motion-model roundMotion). */
  result(round: (m: LibraryMotion) => LibraryMotion = (m) => m): LibraryMotion[] | undefined {
    // A scene motion left with no object (the last one taken out) is not written: the file's check wants 1–16.
    const out = [...this.now.values()].filter((m) => !m.tracks || Object.keys(m.tracks).length).map((m) => round(structuredClone(m)));
    return out.length ? out : undefined;
  }

  markSaved(): void {
    this.saved = new Map([...this.now].map(([k, v]) => [k, structuredClone(v)]));
  }
}

/** The page's one Library of motions (one game open at a time). Tests make their own. */
export const motionLibrary = new MotionLibrary();
