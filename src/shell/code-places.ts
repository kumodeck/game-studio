// What the person changed of the game's code layouts (studio-code-base, 2026-10-24; CONTRACT.md §1.12, §4.1 `places`):
// one level's `places`, as it is now and as last saved. Pure logic, no DOM (test/code-base-shell.test.ts).
//
// WHY its own store, next to the objects' poses (placement-model.ts): a layout is ONE thing however many objects it
// puts — turning its Gap moves all of them and is one change on Save · n, like a renamed object — and its knobs keep
// the code's number (`was`) the way a moved object keeps its `was`, for the AI to find on Save.
//
// The code's numbers come from the game's page (bridge code-lists.ts): when the AI has written a knob into the code
// (the file's v is now the code's v) or taken a knob out, that knob leaves the file without a word — not a change of
// the person's (decision 3 of the plan). The same for a code motion's knobs (MotionLibrary.settle).
import type { CodeKnob, CodePlaceInfo, KnobValue, PlacementPlace } from '../contract.ts';

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
/** The file's rounding of a knob (1e-4), so a number typed back to the code's is no change. */
export const roundKnob = (v: number) => {
  const r = Math.round(v * 10000) / 10000;
  return r === 0 ? 0 : r;
};

/**
 * Knobs after a turn: `set` (name → number) over `now`, each with the code's number as `was`; a knob back on the code's
 * number is left out (the file keeps only what differs from the code). undefined = none left.
 */
export function turnKnobs(now: Record<string, KnobValue> | undefined, set: Record<string, number>, code: Record<string, CodeKnob>): Record<string, KnobValue> | undefined {
  const out: Record<string, KnobValue> = structuredClone(now ?? {});
  for (const [n, v] of Object.entries(set)) {
    const was = code[n]?.v;
    if (was !== undefined && roundKnob(v) === roundKnob(was)) delete out[n];
    else out[n] = { v: roundKnob(v), ...(was !== undefined ? { was: roundKnob(was) } : {}) };
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * Knobs the code has caught up with (its number is the file's v) or no longer has: out. null = nothing to take out.
 */
export function settledKnobs(k: Record<string, KnobValue> | undefined, code: Record<string, CodeKnob> | undefined): Record<string, KnobValue> | undefined | null {
  if (!k || !code) return null;
  const out = Object.fromEntries(Object.entries(k).filter(([n, x]) => code[n] !== undefined && roundKnob(code[n]!.v) !== roundKnob(x.v)));
  if (Object.keys(out).length === Object.keys(k).length) return null;
  return Object.keys(out).length ? out : undefined;
}

/** An entry with nothing left in it is no entry. */
const tidy = (e: PlacementPlace | null | undefined): PlacementPlace | null => {
  if (!e) return null;
  const o = structuredClone(e);
  for (const k of Object.keys(o) as Array<keyof PlacementPlace>) {
    const v = o[k];
    if (v === undefined || (Array.isArray(v) && !v.length) || (v && typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length)) delete o[k];
  }
  return Object.keys(o).length ? o : null;
};

export class PlaceStore {
  private now = new Map<string, PlacementPlace>();
  private saved = new Map<string, PlacementPlace>();

  /** The file's (this level's) `places`, both as it is and as saved. */
  restore(places: Record<string, PlacementPlace> | undefined): void {
    this.now = new Map(Object.entries(structuredClone(places ?? {})).flatMap(([id, e]) => (tidy(e) ? [[id, tidy(e)!] as [string, PlacementPlace]] : [])));
    this.saved = new Map([...this.now].map(([k, v]) => [k, structuredClone(v)]));
  }

  get(id: string): PlacementPlace | null {
    const e = this.now.get(id);
    return e ? structuredClone(e) : null;
  }

  /** null (or an empty entry) = nothing changed for this layout. */
  set(id: string, e: PlacementPlace | null): void {
    const t = tidy(e);
    if (t) this.now.set(id, t);
    else this.now.delete(id);
  }

  ids(): string[] {
    return [...this.now.keys()];
  }

  /** Layouts that differ from the last save (each is one Save count). */
  changedIds(): string[] {
    const ids = new Set([...this.now.keys(), ...this.saved.keys()]);
    return [...ids].filter((id) => !same(this.now.get(id), this.saved.get(id)));
  }

  /** placement.json's `places` (ids in order: the file sorts them anyway), or undefined with none. */
  result(): Record<string, PlacementPlace> | undefined {
    if (!this.now.size) return undefined;
    return Object.fromEntries([...this.now].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => [k, structuredClone(v)]));
  }

  markSaved(): void {
    this.saved = new Map([...this.now].map(([k, v]) => [k, structuredClone(v)]));
  }

  /**
   * The game page's layouts (code-lists.ts): a knob the code has caught up with, or does not have any more, leaves
   * the file — in what is saved too, so it is not counted as the person's change. true = something left.
   */
  settle(list: CodePlaceInfo[]): boolean {
    let changed = false;
    for (const p of list) for (const m of [this.now, this.saved]) {
      const e = m.get(p.id);
      const k = settledKnobs(e?.knobs, p.knobs);
      if (!e || k === null) continue;
      const t = tidy({ ...e, knobs: k });
      if (t) m.set(p.id, t);
      else m.delete(p.id);
      changed = true;
    }
    return changed;
  }
}
