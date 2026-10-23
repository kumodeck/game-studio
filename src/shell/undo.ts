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
import { LIMITS, type LibraryMotion, type Motion, type Pose } from '../contract.ts';

export type Change =
  | { kind: 'pose'; key: string; from: Pose; to: Pose }
  /** A copy was made: undo deletes it again, redo brings it back at `pose`. */
  | { kind: 'add'; key: string; from: string; pose: Pose }
  /** An object was deleted: undo puts it back. */
  | { kind: 'remove'; key: string }
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
  | { kind: 'name'; key: string; from: string | null; to: string | null };

export interface UndoEntry {
  changes: Change[];
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
