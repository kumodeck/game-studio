// What the card changed on the game's UI, and the theme (UI stage 3, studio-ui-edit-2, 2026-10-22;
// CONTRACT.md §1.11, §4.1). Pure, no DOM, so it is unit-tested (test/ui-edit-2.test.ts).
//
// WHY its own store and not PlacementModel: a pose is one value per key with a `was` from the game, and every rule
// of PlacementModel (copies, order, levels) is about poses. A look is a handful of named fields per key — the text,
// its size and colour, the fill, a button's state colours — each changed on its own, each with the game's own
// value. Kept by "path": 'text' | 'fontSize' | 'color' | 'background' | '@hover.color' | '@active.background' …,
// and written to placement.json as `ui.<key>.set` / `setWas` (nested for the states) and `theme`.
//
// Like the poses: the current values, the last saved ones (what "Save · N" counts against), and the game's own
// (`was`: from the file's setWas first — the game may already show the saved look through the loader — else what
// the bridge read before the first change). A value back at the game's own is no change: not written, not counted.
import type { PlacementFile, PlacementThemeEntry, UiState, UiStyleSet } from '../contract.ts';

export type UiPath = string;
type Val = string | number;
const STATES: UiState[] = ['hover', 'active', 'disabled'];

/** placement.json's nested shape → paths ("@hover": { color } → "@hover.color"). */
export function pathsOf(set: UiStyleSet | undefined): Map<UiPath, Val> {
  const out = new Map<UiPath, Val>();
  if (!set) return out;
  for (const n of ['text', 'fontSize', 'color', 'background'] as const) if (set[n] !== undefined) out.set(n, set[n]!);
  for (const st of STATES) {
    const o = set[`@${st}`];
    if (o) for (const n of ['color', 'background'] as const) if (o[n] !== undefined) out.set(`@${st}.${n}`, o[n]!);
  }
  return out;
}

/** Paths → placement.json's nested shape. */
export function setOf(m: Map<UiPath, Val>): UiStyleSet {
  const out: Record<string, unknown> = {};
  for (const [p, v] of m) {
    if (p.startsWith('@')) {
      const [st, n] = p.split('.') as [string, string];
      const o = (out[st] as Record<string, unknown>) || {};
      o[n] = v;
      out[st] = o;
    } else out[p] = v;
  }
  return out as UiStyleSet;
}

/** Colours compared the way CSS means them ("#FFF" = "#ffffff"); text exactly; sizes to 0.1 px. */
export function sameVal(a: Val | undefined, b: Val | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  if (typeof a === 'number' || typeof b === 'number') return Math.abs(Number(a) - Number(b)) < 0.05;
  // Only colours are folded ("#FFF" = "#ffffff", "RGB(…)" = "rgb(…)"): a text "A" is not "a".
  const colour = (s: string) => /^(#|rgba?\(|hsla?\()/i.test(s.trim());
  if (!colour(a) || !colour(b)) return a === b;
  const hex = (s: string) => {
    const t = s.trim().toLowerCase().replace(/\s+/g, '');
    return /^#[0-9a-f]{3}$/.test(t) ? '#' + [...t.slice(1)].map((c) => c + c).join('') : t;
  };
  return hex(a) === hex(b);
}

// The same rules as the validator (src/schema/studio-files.mjs readUiSet / readTheme): a value the card would let through
// but the file would refuse must never reach the model — the whole Save would fail on it.
const COLOR_RE = /^(#[0-9a-fA-F]{3,8}|(rgb|rgba|hsl|hsla)\([0-9.,%\s/+-]{1,60}\)|[a-zA-Z]{3,30})$/;
const THEME_VALUE_RE = /^[^;{}<>\\\u0000-\u001f\u007f]{1,200}$/;

/** Can this value be saved for this field? (text ≤ 200, a size 1–500 px, a CSS colour.) */
export function validLook(path: UiPath, v: Val): boolean {
  const name = path.startsWith('@') ? path.split('.')[1] : path;
  if (name === 'text') return typeof v === 'string' && v.length <= 200;
  if (name === 'fontSize') return typeof v === 'number' && v >= 1 && v <= 500;
  if (name === 'color' || name === 'background') return typeof v === 'string' && v.length <= 64 && COLOR_RE.test(v.trim());
  return false;
}
/** Can this be saved as a theme variable's value? (`color`: also a CSS colour.) */
export function validTheme(v: string, type?: 'color' | 'font'): boolean {
  return THEME_VALUE_RE.test(v.trim()) && (type !== 'color' || COLOR_RE.test(v.trim()));
}

export class UiStyleModel {
  private cur = new Map<string, Map<UiPath, Val>>();
  private saved = new Map<string, Map<UiPath, Val>>();
  private was = new Map<string, Map<UiPath, Val>>();
  private themeCur = new Map<string, string>();
  private themeSaved = new Map<string, string>();
  private themeWas = new Map<string, string>();

  /** The saved file's looks (`ui.<key>.set` / `setWas`) and theme, as the current and saved values. */
  restore(file: PlacementFile | null): void {
    this.cur.clear();
    this.saved.clear();
    this.was.clear();
    this.themeCur.clear();
    this.themeSaved.clear();
    this.themeWas.clear();
    for (const [k, e] of Object.entries(file?.ui || {})) {
      const set = pathsOf(e.set);
      if (!set.size) continue;
      this.cur.set(k, new Map(set));
      this.saved.set(k, new Map(set));
      const w = pathsOf(e.setWas);
      if (w.size) this.was.set(k, w);
    }
    for (const [n, e] of Object.entries(file?.theme || {})) {
      this.themeCur.set(n, e.v);
      this.themeSaved.set(n, e.v);
      if (e.was !== undefined) this.themeWas.set(n, e.was);
    }
  }

  /** The person's value (undefined = the game's own). */
  value(key: string, path: UiPath): Val | undefined {
    return this.cur.get(key)?.get(path);
  }
  /** The game's own value, when known (the file's setWas, else what the bridge read). */
  wasOf(key: string, path: UiPath): Val | undefined {
    return this.was.get(key)?.get(path);
  }
  /** What the bridge read as the game's own (ui/props `was`): kept for the paths the file does not already say. */
  noteWas(key: string, set: UiStyleSet): void {
    const m = this.was.get(key) || new Map<UiPath, Val>();
    for (const [p, v] of pathsOf(set)) if (!m.has(p)) m.set(p, v);
    if (m.size) this.was.set(key, m);
  }
  /** Change one field; null (or the game's own value) = back to the game's. */
  set(key: string, path: UiPath, v: Val | null): void {
    const m = this.cur.get(key) || new Map<UiPath, Val>();
    if (v === null || sameVal(v, this.wasOf(key, path))) m.delete(path);
    else m.set(path, v);
    if (m.size) this.cur.set(key, m);
    else this.cur.delete(key);
  }

  theme(name: string): string | undefined {
    return this.themeCur.get(name);
  }
  themeWasOf(name: string): string | undefined {
    return this.themeWas.get(name);
  }
  noteThemeWas(name: string, v: string): void {
    if (!this.themeWas.has(name)) this.themeWas.set(name, v);
  }
  setTheme(name: string, v: string | null): void {
    if (v === null || sameVal(v, this.themeWas.get(name))) this.themeCur.delete(name);
    else this.themeCur.set(name, v);
  }

  private keyDirty(k: string): boolean {
    const a = this.cur.get(k) || new Map(), b = this.saved.get(k) || new Map();
    if (a.size !== b.size) return true;
    for (const [p, v] of a) if (!sameVal(v, b.get(p))) return true;
    return false;
  }
  private themeDirty(): string[] {
    const out: string[] = [];
    for (const n of new Set([...this.themeCur.keys(), ...this.themeSaved.keys()])) if (!sameVal(this.themeCur.get(n), this.themeSaved.get(n))) out.push(n);
    return out;
  }
  /** Unsaved changes: one per element whose look changed, one per theme variable. */
  dirty(): number {
    return this.changedKeys().size + this.themeDirty().length;
  }
  /** The elements whose look changed since the last save (a dot on their row). */
  changedKeys(): Set<string> {
    const out = new Set<string>();
    for (const k of new Set([...this.cur.keys(), ...this.saved.keys()])) if (this.keyDirty(k)) out.add(k);
    return out;
  }
  markSaved(): void {
    this.saved = new Map([...this.cur].map(([k, m]) => [k, new Map(m)]));
    this.themeSaved = new Map(this.themeCur);
  }

  /** placement.json `ui.<key>` additions: `set` and (what is known of) `setWas`, for every element with a change. */
  entries(): Record<string, { set: UiStyleSet; setWas?: UiStyleSet }> {
    const out: Record<string, { set: UiStyleSet; setWas?: UiStyleSet }> = {};
    for (const [k, m] of this.cur) {
      if (!m.size) continue;
      const w = new Map<UiPath, Val>();
      for (const p of m.keys()) {
        const v = this.wasOf(k, p);
        if (v !== undefined) w.set(p, v);
      }
      out[k] = w.size ? { set: setOf(m), setWas: setOf(w) } : { set: setOf(m) };
    }
    return out;
  }
  /** placement.json `theme`, or undefined when no variable differs from the game's. */
  themeResult(): Record<string, PlacementThemeEntry> | undefined {
    if (!this.themeCur.size) return undefined;
    const out: Record<string, PlacementThemeEntry> = {};
    for (const [n, v] of this.themeCur) {
      const w = this.themeWas.get(n);
      out[n] = w !== undefined ? { v, was: w } : { v };
    }
    return out;
  }
  /** Every value the editor shows over the game's, to give the page again when editing starts (a reload, the AI's change). */
  replay(): { sets: Array<{ key: string; path: UiPath; value: Val }>; theme: Array<{ name: string; value: string }> } {
    const sets: Array<{ key: string; path: UiPath; value: Val }> = [];
    for (const [key, m] of this.cur) for (const [path, value] of m) sets.push({ key, path, value });
    return { sets, theme: [...this.themeCur].map(([name, value]) => ({ name, value })) };
  }
}
