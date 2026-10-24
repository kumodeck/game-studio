// Undo/redo history for placement: one entry per finished gesture or action.
//
// Entries hold absolute poses (from/to), not deltas, so undo is exact even
// if the adapter rounds or clamps, and replaying never drifts.
//
// One entry can hold several changes (CONTRACT.md §1.8): moving a selection
// of five objects, copying three, deleting two, or bringing a group to the
// front is ONE press of Undo. Changes are applied in order on redo and in
// reverse order on undo (a group's draw-order moves only undo exactly
// backwards, each one being "take it out, put it at that place").
import { LIMITS, type LibraryMotion, type Motion, type PlacementPlace, type Pose } from '../contract.ts';

export type Change =
  | { kind: 'pose'; key: string; from: Pose; to: Pose }
  /** A copy was made: undo deletes it again, redo brings it back at `pose`. */
  | { kind: 'add'; key: string; from: string; pose: Pose }
  /** An object was deleted: undo puts it back. */
  | { kind: 'remove'; key: string }
  /**
   * A game object that was not in this level put in it from the Library (studio-fix-0146, 2026-10-24: a New level
   * hides everything but the ground; its Library lists those things as "Not in this level"). The inverse of 'remove':
   * undo takes it out of the level again, redo puts it back.
   */
  | { kind: 'place'; key: string }
  /** Its motion changed (motion-gui, 2026-10-22): the card's menu, speed, + / −, or a path point dragged. null = none. */
  | { kind: 'motion'; key: string; from: Motion | null; to: Motion | null }
  /** A Library motion made, changed or deleted (studio-motion-triggers, 2026-10-22): `key` is its name. null = none. */
  | { kind: 'motion-lib'; key: string; from: LibraryMotion | null; to: LibraryMotion | null }
  /** A Library motion renamed (`key` = its new name), with every clip that uses it. */
  | { kind: 'motion-rename'; key: string; from: string; to: string }
  /**
   * UI stage 3 (2026-10-22, ui-style-model.ts): one field of a UI element's look changed on the card — `path` 'text',
   * 'fontSize', 'color', 'background' or a state's '@hover.color'… null = the game's own value.
   */
  | { kind: 'ui-set'; key: string; path: string; from: string | number | null; to: string | number | null }
  /** UI stage 3: a theme variable (`key` = its name, "--accent"). null = the game's own value. */
  | { kind: 'ui-theme'; key: string; from: string | null; to: string | null }
  /** Renamed in place (studio-uniforms, 2026-10-23: Rename, F2): the person's name before / after. null = the game's own. */
  | { kind: 'name'; key: string; from: string | null; to: string | null }
  /**
   * A code layout's changes (studio-code-base, 2026-10-24; code-places.ts): `key` is the codePlace id, from / to its
   * whole entry in `places` (knobs, pins, by hand, keep-out areas, what it replaced). null = nothing changed.
   */
  | { kind: 'code-place'; key: string; from: PlacementPlace | null; to: PlacementPlace | null };

export interface UndoEntry {
  changes: Change[];
  /**
   * The AI did it (studio-ai-hands, 2026-10-24; ai-hands.ts): what it did in the person's words ("Claude took “Row” off
   * Blue pillar"), for the Undo tooltip — so ⌘Z says whose change it takes back. Absent = the person's own step.
   */
  ai?: string;
  /**
   * UI stage 1: 'ui' = a step on the game's UI layer (absent = the world). One history for both layers; undoing a
   * step of the other layer switches to it first, so what goes back is seen (as Figma does across pages).
   */
  layer?: 'ui';
}

/** The common case: one object moved. */
export const poseChange = (key: string, from: Pose, to: Pose): UndoEntry => ({ changes: [{ kind: 'pose', key, from, to }] });

export class UndoStack {
  private done: UndoEntry[] = [];
  private undone: UndoEntry[] = [];
  private readonly limit: number;
  /**
   * An open group (begin() … end()): every push goes into ONE entry, so one ⌘Z takes back all of it. studio-ai-hands
   * (2026-10-24): the AI's `--do` with three ops (take Row off, make Spiral, put it on) is one change of the AI's, like
   * a drag of five picked objects is one of the person's. `pushed` = the entry is in `done` already (its first change).
   */
  private group: { entry: UndoEntry; pushed: boolean } | null = null;

  /** The layer a step belongs to when push() is not told (the shell sets it: the layer being edited). */
  layerNow: () => 'ui' | undefined = () => undefined;

  constructor(limit: number = LIMITS.undoSteps) {
    this.limit = limit;
  }

  /** Record a finished gesture. No-op when nothing changed. Clears redo. */
  push(e: UndoEntry): boolean {
    // A change from a value to the same value is nothing (every kind with a `to`: poses, motions, looks, the theme).
    const changes = e.changes.filter((c) => !('to' in c) || JSON.stringify(c.from) !== JSON.stringify(c.to));
    if (!changes.length) return false;
    if (this.group) {
      if (!this.group.pushed) {
        this.done.push(this.group.entry);
        this.group.pushed = true;
        if (this.done.length > this.limit) this.done.splice(0, this.done.length - this.limit);
      }
      this.group.entry.changes.push(...changes);
      this.undone.length = 0;
      return true;
    }
    const layer = e.layer ?? this.layerNow();
    this.done.push(layer ? { changes, layer } : { changes });
    if (this.done.length > this.limit) this.done.splice(0, this.done.length - this.limit);
    this.undone.length = 0;
    return true;
  }

  /** The entry to revert (apply its changes backwards), or null. */
  undo(): UndoEntry | null {
    const e = this.done.pop();
    if (!e) return null;
    this.undone.push(e);
    return e;
  }

  /** The entry to re-apply (apply its changes in order), or null. */
  redo(): UndoEntry | null {
    const e = this.undone.pop();
    if (!e) return null;
    this.done.push(e);
    return e;
  }

  /**
   * The last step's change of a code layout now ends at `to` instead (studio-offsets, 2026-10-24: the four choices
   * under a rule drag — All the same / Zigzag / Ramp / Just this one — swap what the drag did IN THE SAME ⌘Z; decision
   * 1: choosing again adds no step). false = the last step is not that layout's (then the caller pushes a new one).
   */
  retarget(key: string, to: PlacementPlace | null): boolean {
    const c = this.done[this.done.length - 1]?.changes.find((x) => x.kind === 'code-place' && x.key === key) as Extract<Change, { kind: 'code-place' }> | undefined;
    if (!c) return false;
    c.to = to ? structuredClone(to) : null;
    this.undone.length = 0;
    return true;
  }

  /**
   * Every step's change of code layout `key`, both ways, through `fn` (studio-writeback, 2026-10-24): what the AI wrote
   * into the code left the file (`place.code --fold`), so it leaves the history too — an offset is added on top of the
   * rule, and a ⌘Z / ⇧⌘Z that put it back in the file would shift the rule twice (the code has it now). A step left with
   * nothing to change stays (its ⌘Z just changes nothing): the steps around it keep their places.
   */
  rebase(key: string, fn: (e: PlacementPlace | null) => PlacementPlace | null): void {
    for (const e of [...this.done, ...this.undone, ...(this.group ? [this.group.entry] : [])]) {
      for (const c of e.changes) {
        if (c.kind !== 'code-place' || c.key !== key) continue;
        c.from = fn(c.from);
        c.to = fn(c.to);
      }
    }
  }

  /** What Undo / Redo would change next, without changing it (their tooltips name it). */
  peekUndo(): UndoEntry | null {
    return this.done[this.done.length - 1] ?? null;
  }
  peekRedo(): UndoEntry | null {
    return this.undone[this.undone.length - 1] ?? null;
  }

  /** Forget every step (levels, 2026-10-22: a new level on screen starts its own history). */
  clear(): void {
    this.done.length = 0;
    this.undone.length = 0;
    // An open group starts again on the new level (its steps there are the group's; the old level's went with it).
    if (this.group) this.group = { entry: { changes: [] }, pushed: false };
  }

  /** Open a group: every push until end() is one entry (one ⌘Z). A group already open stays the one. */
  begin(): void {
    if (!this.group) this.group = { entry: { changes: [] }, pushed: false };
  }

  /** Close the group; `ai` = the words for its Undo tooltip. Returns its entry, or null when nothing was pushed. */
  end(ai?: string): UndoEntry | null {
    const g = this.group;
    this.group = null;
    if (!g || !g.pushed) return null;
    if (ai) g.entry.ai = ai;
    return g.entry;
  }

  get canUndo(): boolean {
    return this.done.length > 0;
  }
  get canRedo(): boolean {
    return this.undone.length > 0;
  }
  get size(): number {
    return this.done.length;
  }
}

/**
 * The one motion several objects' motion changes share (a linked motion — a scene — changed: its length, its "when",
 * a second trigger), by its name; null when they do not share one. studio-fix-0142 (2026-10-24, first-run check ⑭):
 * adding a second trigger to gate's motion (the ship linked into it) read "Undo: change 2 objects’s motion" (and the
 * Japanese had a stray space) — wrong English, and "2 objects" for what the person saw as one motion. With this, the
 * tooltip names the motion: "Undo: change gate’s motion" (i18n undo.motionNamed).
 */
export function sharedMotion(changes: Change[]): string | null {
  const uses = (m: Motion | null) => new Set((m?.clips ?? []).filter((c) => c.scene && c.use).map((c) => c.use!));
  let common: Set<string> | null = null;
  for (const c of changes) {
    if (c.kind !== 'motion') continue;
    const here = new Set([...uses(c.from), ...uses(c.to)]);
    common = common ? new Set([...common].filter((u) => here.has(u))) : here;
  }
  return common && common.size === 1 ? [...common][0]! : null;
}
