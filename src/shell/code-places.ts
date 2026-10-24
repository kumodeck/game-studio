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
import { handsFoldEntry } from '../schema/hands.mjs';

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

/** What a fold took out of a layout's entry, as it was (now, and as saved); null = nothing there. */
export interface Folded {
  now: PlacementPlace | null;
  saved: PlacementPlace | null;
}

/** The parts of `e` that `t` (e folded) no longer has: rows, pins, knobs, areas, hand-placed objects replaced. */
export function gone(e: PlacementPlace, t: PlacementPlace | null): PlacementPlace {
  const out: PlacementPlace = {};
  const keep = t ?? {};
  const offs = (e.offsets ?? []).filter((o) => !(keep.offsets ?? []).some((x) => same(x, o)));
  if (offs.length) out.offsets = offs;
  for (const k of ['knobs', 'pins'] as const) {
    const left = Object.fromEntries(Object.entries(e[k] ?? {}).filter(([n]) => !(keep[k] && n in keep[k]!)));
    if (Object.keys(left).length) (out as Record<string, unknown>)[k] = left;
  }
  if (e.hand && !keep.hand) out.hand = true;
  const av = (e.avoid ?? []).filter((a) => !(keep.avoid ?? []).some((x) => same(x, a)));
  if (av.length) out.avoid = av;
  const fr = (e.from ?? []).filter((k) => !(keep.from ?? []).includes(k));
  if (fr.length) out.from = fr;
  return out;
}

/** `part` (what a fold took out) back into `cur`: what `cur` has of the same name stays (the person's since). */
export function mergeBack(cur: PlacementPlace | null, part: PlacementPlace): PlacementPlace {
  const o: PlacementPlace = structuredClone(cur ?? {});
  if (part.offsets?.length) o.offsets = [...(o.offsets ?? []), ...part.offsets.filter((x) => !(o.offsets ?? []).some((y) => same(x, y)))].slice(0, 8);
  if (part.knobs) o.knobs = { ...part.knobs, ...(o.knobs ?? {}) };
  if (part.pins) o.pins = { ...part.pins, ...(o.pins ?? {}) };
  if (part.hand) o.hand = true;
  if (part.avoid?.length) o.avoid = [...(o.avoid ?? []), ...part.avoid.filter((x) => !(o.avoid ?? []).some((y) => same(x, y)))];
  if (part.from?.length) o.from = [...new Set([...(o.from ?? []), ...part.from])];
  return o;
}

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
   * What the AI wrote into the code leaves the file (studio-writeback, 2026-10-24; the AI's `place.code --fold`, schema
   * hands.mjs handsFoldEntry): in what is saved too, like a settled knob, so it is no change of the person's (Save · n
   * stays as it was). Returns what left each (`now`, `saved`: only the parts taken out), for "Undo AI change" to bring
   * back, or null when neither had any of it.
   */
  fold(id: string, parts: string[]): Folded | null {
    const out: Folded = { now: null, saved: null };
    let changed = false;
    for (const [m, side] of [[this.now, 'now'], [this.saved, 'saved']] as const) {
      const e = m.get(id);
      if (!e) continue;
      const t = tidy(handsFoldEntry(e, parts) as PlacementPlace | null);
      if (same(t, e)) continue;
      out[side] = gone(e, t);
      if (t) m.set(id, t);
      else m.delete(id);
      changed = true;
    }
    return changed ? out : null;
  }

  /**
   * "Undo AI change" after a write-back (studio-writeback): the code is back as it was, so what left the file comes
   * back into it — merged with what the layout has now (a change the person made since stays), in what is saved too.
   */
  unfold(id: string, back: Folded): void {
    for (const [m, part] of [[this.now, back.now], [this.saved, back.saved]] as const) {
      if (!part) continue;
      const t = tidy(mergeBack(m.get(id) ?? null, part));
      if (t) m.set(id, t);
      else m.delete(id);
    }
  }

  /**
   * The game page's layouts (code-lists.ts): a knob the code has caught up with, or does not have any more, leaves
   * the file — in what is saved too, so it is not counted as the person's change. true = something left.
   */
  settle(list: CodePlaceInfo[], left?: (id: string, f: Folded) => void): boolean {
    let changed = false;
    for (const p of list) {
      const f: Folded = { now: null, saved: null };
      for (const [m, side] of [[this.now, 'now'], [this.saved, 'saved']] as const) {
        const e = m.get(p.id);
        const k = settledKnobs(e?.knobs, p.knobs);
        if (!e || k === null) continue;
        const t = tidy({ ...e, knobs: k });
        f[side] = gone(e, t);
        if (t) m.set(p.id, t);
        else m.delete(p.id);
        changed = true;
      }
      // studio-writeback: the knobs that left, for "Undo AI change" (the code's old number comes back, so must they).
      if (f.now || f.saved) left?.(p.id, f);
    }
    return changed;
  }
}
