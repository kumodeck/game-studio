// The editor's levels (2026-10-22, "manage several levels"; CONTRACT.md §1.10). Pure logic,
// no DOM, so it is unit-tested (test/levels.test.ts); level-switch.ts draws it, main.ts wires it in.
//
// What it holds: the levels in the PERSON'S order, each with its world part of placement.json (objects / added /
// removed / order / motion — the same shapes the one-level file has at its top; `motion` joined in integrate3,
// 2026-10-22, because a motion's keys are that level's objects) and how many of its changes are not saved.
// The level being edited lives in main.ts's PlacementModel; the others wait here as files (`world`), and come back
// into a fresh model when the person switches to them. WHY a model per visit and not one model for all: every part
// of the PlacementModel (was / saved / copies / orders) is keyed by object key, and two levels share keys ("tree-1"
// in Meadow and in Summit are different trees). A fresh model per level keeps every rule the one-level editor has.
//
// What the game has (its code's levels, studio.levels → core/levels) and what the person did (copy, rename, reorder,
// delete) are kept apart, the way `was` and the pose are for an object: placement.json gets the person's list
// (`levels`) and — only when the two differ — the code's (`levelsWas`), so the AI sees what to change in the code.
//
// A game with ONE level, or one that never calls studio.levels(): `active` stays false and compose() returns the file
// as it is (the design's rule: nothing changes, not one byte).
import type { Dim, LevelInfo, PlacementFile, PlacementLevel } from '../contract.ts';

/** A level's world part: what placement.json has at its top for a game with one level. */
export type WorldPart = Pick<PlacementFile, 'objects' | 'added' | 'removed' | 'order' | 'motion'>;

export interface LevelEntry {
  id: string;
  /** The person's name for it; absent = the code's (or the id). */
  label?: string;
  /** The code's name (studio.levels' label), to show and to write as `labelWas` after a rename. */
  codeLabel?: string;
  /** Made in the editor: the code's level it is built from. */
  from?: string;
  world: WorldPart;
  /** Changes made in this level and not saved, while it is not the one being edited (see stash()). */
  dirty: number;
}

const emptyWorld = (): WorldPart => ({ objects: {} });

/** The world part of a file, deep-copied (only the fields it has). */
export function worldOf(f: Partial<PlacementFile> | PlacementLevel | null | undefined): WorldPart {
  const w: WorldPart = { objects: structuredClone(f?.objects || {}) };
  if (f?.added?.length) w.added = structuredClone(f.added);
  if (f?.removed?.length) w.removed = structuredClone(f.removed);
  if (f?.order?.length) w.order = structuredClone(f.order);
  if (f?.motion && Object.keys(f.motion).length) w.motion = structuredClone(f.motion);
  return w;
}

/** "Meadow 2" → "meadow-2": an id that fits a key (KEY_RE), lower case, at most 60 characters. */
export function slugOf(label: string): string {
  const s = label.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return s || 'level';
}

export class Levels {
  list: LevelEntry[] = [];
  /** The level being edited now ('' = none yet). */
  current = '';
  /** The code's levels in the code's order (null until the game or the file said). */
  code: string[] | null = null;
  /** The code's levels the person deleted (they wait in `levelsWas` for the AI). */
  deleted = new Set<string>();
  /** Copies, renames, moves and deletions not saved yet (each is one change on "Save · n"). */
  structDirty = 0;
  dim: Dim = '3d';
  /** True once the game has two levels or more (or the file already had levels): the switch shows, the file has `levels`. */
  active = false;

  /** The saved file, at the editor's start (before the game is on screen). */
  load(file: PlacementFile | null): void {
    this.list = [];
    this.deleted.clear();
    this.code = null;
    this.structDirty = 0;
    this.active = false;
    if (file?.dim) this.dim = file.dim;
    if (!file?.levels?.length) return;
    for (const l of file.levels) {
      const e: LevelEntry = { id: l.id, world: worldOf(l), dirty: 0 };
      // A code level keeps the code's name as `codeLabel` (the file's label, or its labelWas after a rename), so a
      // file read back writes the same bytes; a level made in the editor has only the person's name.
      if (l.from) {
        e.from = l.from;
        if (l.label) e.label = l.label;
      } else {
        const code = l.labelWas ?? l.label;
        if (code) e.codeLabel = code;
        if (l.labelWas && l.label) e.label = l.label;
      }
      this.list.push(e);
    }
    this.code = file.levelsWas ? file.levelsWas.slice() : this.list.filter((e) => !e.from).map((e) => e.id);
    for (const id of this.code) if (!this.has(id)) this.deleted.add(id);
    this.current = this.list[0]!.id;
    this.active = true;
  }

  has(id: string): boolean {
    return this.list.some((e) => e.id === id);
  }
  entry(id: string): LevelEntry | undefined {
    return this.list.find((e) => e.id === id);
  }
  index(id = this.current): number {
    return this.list.findIndex((e) => e.id === id);
  }
  /** What the person reads: their name, else the code's, else the id. */
  labelOf(id: string): string {
    const e = this.entry(id);
    return e?.label || e?.codeLabel || id;
  }
  /** The code's level the game builds for `id`: itself when the code has it, else the level it was copied from. */
  build(id: string): string {
    const e = this.entry(id);
    if (!e || !e.from || (this.code && this.code.includes(id))) return id;
    return e.from;
  }

  /**
   * The game said its levels (core/levels, every page). `world` = the file's top world part, which belongs to the
   * level on screen when the game had no levels in the file before. Returns true when the switch should be (re)drawn.
   */
  fromGame(levels: LevelInfo[], current: string, world?: WorldPart): boolean {
    const ids = levels.map((l) => l.id);
    if (!this.active && !this.list.length) {
      // One level: nothing changes (no switch, the file keeps its bytes).
      if (levels.length < 2) return false;
      this.list = levels.map((l) => ({ id: l.id, ...(l.label ? { codeLabel: l.label } : {}), world: emptyWorld(), dirty: 0 }));
      const e = this.entry(current);
      if (e && world) e.world = structuredClone(world);
    } else {
      // The code may have changed under the editor (the AI applied a copy, a delete, a new level): keep the person's
      // list, take what the code has now.
      this.list = this.list.filter((e) => ids.includes(e.id) || (e.from && ids.includes(e.from)));
      for (const l of levels) {
        const e = this.entry(l.id);
        if (e) {
          if (l.label) e.codeLabel = l.label;
          // A rename the AI has made in the code: the names agree now.
          if (e.label && e.label === l.label) delete e.label;
        } else if (!this.deleted.has(l.id)) this.list.push({ id: l.id, ...(l.label ? { codeLabel: l.label } : {}), world: emptyWorld(), dirty: 0 });
      }
      for (const id of [...this.deleted]) if (!ids.includes(id)) this.deleted.delete(id);
    }
    this.code = ids;
    this.active = true;
    if (this.has(current)) this.current = current;
    else if (!this.has(this.current)) this.current = this.list[0]?.id || '';
    return true;
  }

  /** The file a fresh PlacementModel restores for level `id` (its world part, the rest of `base`). */
  viewOf(id: string, base?: PlacementFile | null): PlacementFile {
    const w = this.entry(id)?.world || emptyWorld();
    const f: PlacementFile = { version: 1, tool: 'placement', dim: base?.dim || this.dim, space: 'local', ...structuredClone(w) };
    if (!f.objects) f.objects = {};
    return f;
  }

  /** Keep the level being left: its world part as the model has it now, and its unsaved count added to what it had. */
  stash(world: WorldPart, dirtyNow: number): void {
    const e = this.entry(this.current);
    if (!e) return;
    e.world = worldOf(world);
    e.dirty += dirtyNow;
  }

  /** Changes not saved that the live model does not count: every level's carried count and the list's own changes. */
  dirtyElsewhere(): number {
    return this.list.reduce((n, e) => n + e.dirty, 0) + this.structDirty;
  }

  markSaved(): void {
    for (const e of this.list) e.dirty = 0;
    this.structDirty = 0;
  }

  /**
   * placement.json as it is written: `file` is the one-level file the editor makes for the level on screen (world
   * part + ui); with levels, its world part goes into that level's entry and every level is listed.
   */
  compose(file: PlacementFile): PlacementFile {
    if (!this.active || !this.list.length) return file;
    const now = worldOf(file);
    const out: PlacementFile = { ...file, objects: {} };
    delete out.added;
    delete out.removed;
    delete out.order;
    delete out.motion;
    out.levels = this.list.map((e) => {
      const w = e.id === this.current ? now : e.world;
      const l: PlacementLevel = { id: e.id };
      const label = this.labelOf(e.id);
      if (label !== e.id) l.label = label;
      // Renamed in the editor: the code's name, for the AI to find (the id when the code gave no name).
      if (!e.from && e.label && e.label !== (e.codeLabel ?? e.id)) l.labelWas = e.codeLabel ?? e.id;
      if (e.from && !(this.code && this.code.includes(e.id))) l.from = e.from;
      if (w.objects && Object.keys(w.objects).length) l.objects = structuredClone(w.objects);
      if (w.added?.length) l.added = structuredClone(w.added);
      if (w.removed?.length) l.removed = structuredClone(w.removed);
      if (w.order?.length) l.order = structuredClone(w.order);
      if (w.motion && Object.keys(w.motion).length) l.motion = structuredClone(w.motion);
      return l;
    });
    // The code's order, only when the person's list says something else (an order, a copy, a delete, a rename).
    const code = this.code || [];
    const mine = out.levels.filter((l) => !l.from).map((l) => l.id);
    if (code.length && (mine.join('\n') !== code.join('\n') || out.levels.some((l) => l.from || l.labelWas))) out.levelsWas = code.slice();
    return out;
  }

  // ----- what the person does (each is one change until Save) -----

  /**
   * A new level copied from the one on screen (its world part = `world`, the live model's), right after it.
   * Named "<name> 2" (3, 4… if taken); its id follows the name. Returns the new id.
   */
  copy(world: WorldPart): string {
    const src = this.entry(this.current);
    if (!src) return '';
    const base = this.labelOf(src.id).replace(/\s+\d+$/, '');
    const taken = new Set([...this.list.map((e) => e.id), ...(this.code || []), ...this.deleted]);
    const names = new Set(this.list.map((e) => this.labelOf(e.id)));
    let n = 2;
    while (names.has(`${base} ${n}`) || taken.has(slugOf(`${base} ${n}`))) n++;
    const label = `${base} ${n}`;
    const e: LevelEntry = { id: slugOf(label), label, from: this.build(src.id), world: worldOf(world), dirty: 0 };
    this.list.splice(this.index() + 1, 0, e);
    this.structDirty++;
    return e.id;
  }

  /** A new name (trimmed, ≤ 120 characters); false = nothing changed. */
  rename(id: string, label: string): boolean {
    const e = this.entry(id);
    const v = label.trim().slice(0, 120);
    if (!e || !v || v === this.labelOf(id)) return false;
    e.label = v;
    this.structDirty++;
    return true;
  }

  /** One place up (-1) or down (+1); false at an end. */
  move(id: string, by: -1 | 1): boolean {
    const i = this.index(id), j = i + by;
    if (i < 0 || j < 0 || j >= this.list.length) return false;
    const [e] = this.list.splice(i, 1);
    this.list.splice(j, 0, e!);
    this.structDirty++;
    return true;
  }

  /** Delete a level (never the last one). Returns the level to show next when it was the one on screen, else ''. */
  remove(id: string): string | null {
    const i = this.index(id);
    if (i < 0 || this.list.length <= 1) return null;
    this.list.splice(i, 1);
    if (this.code?.includes(id)) this.deleted.add(id);
    this.structDirty++;
    if (id !== this.current) return '';
    return this.list[Math.min(i, this.list.length - 1)]!.id;
  }
}
