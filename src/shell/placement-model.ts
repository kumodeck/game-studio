// What the placement tool remembers: each object's original pose (`was`),
// current pose, and last saved pose. Pure logic, no DOM, so it is unit-tested.
//
// Opening the studio again after a save continues from the saved file: the
// saved poses are re-applied to the game (whose code may not read
// placement.json yet), and `was` stays the pose the game code itself
// produces, which is what the AI searches for in the code.
//
// Draw order (2D layers) is tracked per sibling list, not per object: moving
// one object to the front shifts the z of the others, but it is ONE change
// (one Save count, one `order` entry in placement.json listing the whole
// list back → front, which is what the AI needs to rewrite the code).
//
// Copies and deletions (CONTRACT.md §1.8) are kept apart from moves: a copy
// is written once to `added` (with its own pose, never to `objects`), a
// deleted game object once to `removed` (with the pose the game gives it, so
// the AI finds it in the code). Each is one Save count. Reopening before the
// AI has changed the code makes the same copies and deletions again; after
// the AI has done it, the copy is simply a game object under the same key.
import { LIMITS, type Dim, type Item, type PlacementAdded, type PlacementEntry, type PlacementFile, type PlacementOrder, type PlacementRemoved, type Pose } from '../contract.ts';
import { hasLayer, orderOfLayer } from './layers.ts';

function roundTo(v: number, step: number): number {
  return Math.round(v / step) * step;
}

/** Round a pose to the file's precision (1 mm or 0.1 px, 1e-4 rad). */
export function roundPose(p: Pose, dim: Dim): Pose {
  const step = dim === '3d' ? LIMITS.step3d : LIMITS.step2d;
  const fix = (v: number, s: number) => Number(roundTo(v, s).toFixed(6));
  const out: Pose = { p: p.p.map((v) => fix(v, step)) };
  if (p.r !== undefined) out.r = fix(p.r, LIMITS.stepAngle);
  if (p.s !== undefined) out.s = Array.isArray(p.s) ? p.s.map((v) => fix(v, 0.0001)) : fix(p.s, 0.0001);
  // 3D tilt (rotation.x, rotation.z): only when the object was tipped (see Pose.t).
  if (p.t !== undefined && dim === '3d') out.t = [fix(p.t[0], LIMITS.stepAngle), fix(p.t[1], LIMITS.stepAngle)];
  return out;
}

/**
 * Two angles (already rounded) are the same turn: compared around the circle, not as numbers.
 *
 * WHY (90° bug, 2026-10-17): turning a 3D object past 90° about the up axis makes three.js write the same
 * rotation as x = ±π, y = π − θ, z = ±π. π rounds to 3.1416 in the file, which is a hair MORE than π, so the
 * adapter reads it back wrapped into (−π, π] as −3.14159 — the same turn, a different number. Comparing the
 * rounded JSON made every reopen of such a save show "Save · 1" with nothing changed.
 */
function sameAngle(a: number | undefined, b: number | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  const TAU = Math.PI * 2;
  const d = Math.abs((((a - b) % TAU) + TAU) % TAU);
  // Half a rounding step: values one step apart (a real nudge) still differ.
  return Math.min(d, TAU - d) < LIMITS.stepAngle / 2;
}

export function samePose(a: Pose | undefined, b: Pose | undefined, dim: Dim): boolean {
  if (!a || !b) return a === b;
  const x = roundPose(a, dim), y = roundPose(b, dim);
  if (JSON.stringify(x.p) !== JSON.stringify(y.p) || JSON.stringify(x.s) !== JSON.stringify(y.s)) return false;
  if (!sameAngle(x.r, y.r)) return false;
  if (!x.t || !y.t) return !x.t === !y.t;
  return sameAngle(x.t[0], y.t[0]) && sameAngle(x.t[1], y.t[1]);
}

/** Keys of `now` outside a longest common subsequence with `was` (the moved ones). n ≤ 500, O(n²). */
function outOfOrder(was: string[], now: string[]): string[] {
  const n = was.length, m = now.length;
  const L: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i]![j] = was[i] === now[j] ? L[i + 1]![j + 1]! + 1 : Math.max(L[i + 1]![j]!, L[i]![j + 1]!);
  const keep = new Set<string>();
  for (let i = 0, j = 0; i < n && j < m;) {
    if (was[i] === now[j]) {
      keep.add(now[j]!);
      i++;
      j++;
    } else if (L[i + 1]![j]! >= L[i]![j + 1]!) i++;
    else j++;
  }
  return now.filter((k) => !keep.has(k));
}

export class PlacementModel {
  dim: Dim = '3d';
  private was = new Map<string, Pose>();
  private current = new Map<string, Pose>();
  private saved = new Map<string, Pose>();
  private meta = new Map<string, { label: string; unstable?: boolean }>();
  /** Entries of the loaded file whose key the game does not have (kept on save). */
  private orphans = new Map<string, PlacementEntry>();
  private fileEntries = new Map<string, PlacementEntry>();
  // Draw order: the game's own order (`was`), the last saved one, and the
  // file's orders (re-applied once when the game first lists that layer).
  private items: Item[] = [];
  private wasOrder = new Map<string, string[]>();
  private savedOrder = new Map<string, string[]>();
  private fileOrders = new Map<string, PlacementOrder>();
  private orderApplied = new Set<string>();
  // Copies: every copy made (key → what it is a copy of, kept after it is
  // deleted so undo can bring it back), the ones that exist now, in the order
  // they were made, and what the last save held.
  private copyFrom = new Map<string, string>();
  private copyOrder: string[] = [];
  private live = new Set<string>();
  private savedCopies = new Map<string, Pose>();
  // Game objects the person deleted (copies are not counted here).
  private removed = new Set<string>();
  private savedRemoved = new Set<string>();
  private removedMeta = new Map<string, PlacementRemoved>();
  // The file's copies and deletions, worked out once when the game first lists its objects.
  private fileAdded: PlacementAdded[] = [];
  private fileRemoved: PlacementRemoved[] = [];
  private fileEditsDone = false;
  private fileEdits: { copies: Array<{ key: string; from: string; pose: Pose }>; removes: string[] } = { copies: [], removes: [] };
  /** File copies that could not be made (their original is gone): kept on save, like orphans. */
  private orphanAdded: PlacementAdded[] = [];

  /** Load the saved file (before the game reports its items). */
  restore(file: PlacementFile | null): void {
    this.fileEntries.clear();
    this.fileOrders.clear();
    this.fileAdded = [];
    this.fileRemoved = [];
    if (!file || !file.objects) return;
    if (file.dim) this.dim = file.dim;
    for (const [k, e] of Object.entries(file.objects)) this.fileEntries.set(k, e);
    for (const o of file.order || []) this.fileOrders.set(o.in, o);
    this.fileAdded = (file.added || []).map((a) => structuredClone(a));
    this.fileRemoved = (file.removed || []).map((r) => structuredClone(r));
  }

  /**
   * Copies and deletions of the saved file that the game does not show yet
   * (the AI has not put them in the code): the shell asks the bridge to make
   * them again, once, after the first setItems().
   */
  takeFileEdits(): { copies: Array<{ key: string; from: string; pose: Pose }>; removes: string[] } {
    const e = this.fileEdits;
    this.fileEdits = { copies: [], removes: [] };
    return e;
  }

  private applyFileEdits(items: Item[]): void {
    if (this.fileEditsDone || !items.length) return;
    this.fileEditsDone = true;
    const byKey = new Map(items.map((i) => [i.key, i]));
    const exists = new Set(byKey.keys());
    for (const a of this.fileAdded) {
      // Already in the game (the AI added it under this key): an ordinary object now.
      if (exists.has(a.key) && !byKey.get(a.key)?.copyOf) continue;
      if (!exists.has(a.from)) {
        this.orphanAdded.push(a);
        continue;
      }
      const pose: Pose = { p: a.p.slice() };
      if (a.r !== undefined) pose.r = a.r;
      if (a.s !== undefined) pose.s = a.s;
      this.addCopy(a.key, a.from, pose, a.label);
      this.savedCopies.set(a.key, roundPose(pose, this.dim));
      this.fileEdits.copies.push({ key: a.key, from: a.from, pose });
      exists.add(a.key);
    }
    for (const r of this.fileRemoved) {
      const it = byKey.get(r.key);
      // Gone from the game: the AI took it out. Still there, looking as the
      // game draws it: delete it again. (A different object that now has
      // this key — a tree path that shifted — does not match `was`: kept.)
      if (!it || it.copyOf) continue;
      if (r.label && r.label !== it.label) continue;
      if (r.was && !samePose(r.was, { ...it.pose, z: undefined }, this.dim)) continue;
      this.remove(r.key);
      this.removedMeta.set(r.key, structuredClone(r));
      this.savedRemoved.add(r.key);
      this.fileEdits.removes.push(r.key);
    }
  }

  // ----- copies and deletions -----

  /** A copy now exists (made by the bridge, redo, or the saved file). */
  addCopy(key: string, from: string, pose: Pose, label?: string): void {
    this.copyFrom.set(key, from);
    if (!this.copyOrder.includes(key)) this.copyOrder.push(key);
    this.live.add(key);
    this.current.set(key, structuredClone(pose));
    if (!this.meta.has(key)) this.meta.set(key, { label: label || key });
  }

  /** Keys that are not in the list but must not be reused: every copy made (deleted ones too) and deleted objects. */
  copiesEver(): string[] {
    return [...this.copyFrom.keys(), ...this.removed, ...this.fileAdded.map((a) => a.key)];
  }

  isCopy(key: string): boolean {
    return this.copyFrom.has(key);
  }
  copyOf(key: string): string | undefined {
    return this.copyFrom.get(key);
  }
  isRemoved(key: string): boolean {
    return this.removed.has(key) || (this.copyFrom.has(key) && !this.live.has(key));
  }

  /** Deleted (a copy: it no longer exists; a game object: listed in `removed`). */
  remove(key: string): void {
    if (this.copyFrom.has(key)) {
      this.live.delete(key);
      return;
    }
    if (!this.removed.has(key)) {
      this.removed.add(key);
      const m = this.meta.get(key);
      const was = this.was.get(key);
      const e: PlacementRemoved = { key };
      if (m?.label && m.label !== key) e.label = m.label;
      if (was) e.was = roundPose(was, this.dim);
      if (m?.unstable || key.startsWith('path:')) e.unstable = true;
      if (!this.removedMeta.has(key)) this.removedMeta.set(key, e);
    }
  }

  /** Undo of remove(). */
  unremove(key: string): void {
    if (this.copyFrom.has(key)) this.live.add(key);
    else this.removed.delete(key);
  }

  /** What a copy is written as a copy of: skips copies that were deleted since (A → A2 → A3, A2 deleted: A3 is a copy of A). */
  private liveFrom(key: string): string {
    let f = this.copyFrom.get(key)!;
    for (let i = 0; i < 50 && this.copyFrom.has(f) && !this.live.has(f); i++) f = this.copyFrom.get(f)!;
    return f;
  }

  /**
   * The game reported its objects. Returns poses the shell must push back to
   * the game so it shows the last saved arrangement.
   */
  setItems(items: Item[], dim: Dim): Array<{ key: string; pose: Pose }> {
    this.dim = dim;
    const apply: Array<{ key: string; pose: Pose }> = [];
    const seen = new Set<string>();
    for (const it of items) {
      seen.add(it.key);
      // Copies keep the label the shell gave them; the game's label for the
      // others (the AI reads it to find the object).
      if (!this.copyFrom.has(it.key) || !this.meta.has(it.key)) this.meta.set(it.key, { label: it.label, unstable: it.unstable });
      if (!this.was.has(it.key)) {
        const fromFile = this.fileEntries.get(it.key);
        // `was` from the file wins: the game may already apply placement.json,
        // in which case its current pose is the saved one, not the original.
        this.was.set(it.key, fromFile?.was ? { ...fromFile.was } : { ...it.pose });
        if (fromFile) {
          const savedPose: Pose = { p: fromFile.p.slice(), r: fromFile.r ?? it.pose.r, s: fromFile.s ?? it.pose.s };
          // Tilt: the file's, else the game's own (an older file never says "flat").
          const tilt = fromFile.t ?? it.pose.t;
          if (tilt) savedPose.t = [tilt[0], tilt[1]];
          this.saved.set(it.key, savedPose);
          this.current.set(it.key, savedPose);
          if (!samePose(savedPose, it.pose, dim)) apply.push({ key: it.key, pose: savedPose });
          continue;
        }
        this.saved.set(it.key, { ...it.pose });
      }
      if (!this.current.has(it.key)) this.current.set(it.key, { ...it.pose });
    }
    // z of every object can change when ANOTHER object is reordered: always
    // take the adapter's latest.
    for (const it of items) {
      const cur = this.current.get(it.key);
      if (cur && typeof it.pose.z === 'number') this.current.set(it.key, { ...cur, z: it.pose.z });
    }
    this.applyFileEdits(items);
    this.orphans.clear();
    for (const [k, e] of this.fileEntries) if (!seen.has(k) && !this.removed.has(k)) this.orphans.set(k, e);
    this.items = items.map((it) => ({ ...it, pose: this.current.get(it.key) || it.pose }));
    for (const layer of this.layers()) {
      if (this.wasOrder.has(layer)) continue;
      const now = orderOfLayer(this.items, layer);
      const f = this.fileOrders.get(layer);
      // Same rule as `was` above: the file's `was` wins (the game may already
      // apply the saved order).
      this.wasOrder.set(layer, f?.was ? f.was.filter((k) => now.includes(k)) : now);
      this.savedOrder.set(layer, f ? f.keys.filter((k) => now.includes(k)) : now);
      if (f && !this.orderApplied.has(layer)) {
        this.orderApplied.add(layer);
        apply.push(...this.orderMoves(layer, f.keys));
      }
    }
    return apply;
  }

  /**
   * Poses (z only changes) that turn the current order of `layer` into
   * `want` (back → front). Applied one after another: putting the i-th key at
   * the i-th lowest place, from the back, leaves the earlier ones in place.
   */
  private orderMoves(layer: string, want: string[]): Array<{ key: string; pose: Pose }> {
    const now = this.items.filter((i) => hasLayer(i) && i.layer === layer);
    const keys = want.filter((k) => now.some((i) => i.key === k));
    if (keys.join('\n') === orderOfLayer(now, layer).filter((k) => keys.includes(k)).join('\n')) return [];
    const slots = now.filter((i) => keys.includes(i.key)).map((i) => i.pose.z!).sort((a, b) => a - b);
    return keys.map((k, i) => ({ key: k, pose: { ...this.current.get(k)!, z: slots[i]! } }));
  }

  moved(key: string, pose: Pose): void {
    // Moves from handles carry no z (the order did not change): keep it.
    const old = this.current.get(key);
    this.current.set(key, pose.z === undefined && old?.z !== undefined ? { ...pose, z: old.z } : pose);
    const it = this.items.find((i) => i.key === key);
    if (it) it.pose = this.current.get(key)!;
  }

  /** Sibling lists the game reported (2D adapters with draw order only). */
  layers(): string[] {
    return [...new Set(this.items.filter(hasLayer).map((i) => i.layer!))];
  }

  /** Current order of one list, back → front. */
  order(layer: string): string[] {
    return orderOfLayer(this.items, layer);
  }

  /**
   * Lists whose order changed since the save. Only the objects that are in
   * both are compared: a copy or a deletion changes the list too, but it is
   * already counted once as itself.
   */
  private orderDirty(): string[] {
    return this.layers().filter((l) => {
      const now = this.order(l);
      const saved = this.savedOrder.get(l) || [];
      const a = now.filter((k) => saved.includes(k));
      const b = saved.filter((k) => now.includes(k));
      return a.join('\n') !== b.join('\n');
    });
  }

  /**
   * The order a list would have if the person had only copied and deleted:
   * the game's own order, deleted objects left out, each copy right after
   * what it was copied from (that is where adapters put copies, and how the
   * skill tells the AI to add them). Only a list that differs from this was
   * really reordered and goes to `order`.
   */
  private expectedOrder(layer: string): string[] {
    const keys = (this.wasOrder.get(layer) || []).filter((k) => !this.removed.has(k));
    const inLayer = new Set(this.items.filter((i) => i.layer === layer).map((i) => i.key));
    for (const c of this.copyOrder) {
      if (!this.live.has(c) || !inLayer.has(c) || keys.includes(c)) continue;
      const f = this.liveFrom(c);
      // After the original and after any copies already placed after it.
      let at = keys.indexOf(f);
      if (at < 0) {
        keys.push(c);
        continue;
      }
      while (at + 1 < keys.length && this.copyFrom.has(keys[at + 1]!) && this.liveFrom(keys[at + 1]!) === f) at++;
      keys.splice(at + 1, 0, c);
    }
    return keys;
  }

  pose(key: string): Pose | undefined {
    return this.current.get(key);
  }

  /** Unsaved changes: moved objects, copies, deletions and reordered lists, one each. */
  dirty(): number {
    let n = 0;
    for (const [k, p] of this.current) {
      if (this.copyFrom.has(k) || this.removed.has(k)) continue;
      if (!samePose(p, this.saved.get(k), this.dim)) n++;
    }
    for (const k of this.live) {
      const saved = this.savedCopies.get(k);
      if (saved === undefined || !samePose(saved, this.current.get(k), this.dim)) n++;
    }
    for (const k of this.savedCopies.keys()) if (!this.live.has(k)) n++;
    for (const k of this.removed) if (!this.savedRemoved.has(k)) n++;
    for (const k of this.savedRemoved) if (!this.removed.has(k)) n++;
    return n + this.orderDirty().length;
  }

  /**
   * The objects behind dirty(), by key: moved since the last save, copies
   * new or moved since then (deletions have no row to mark; a reordered list counts for
   * each object whose place changed). The list draws a dot on these rows.
   */
  changedKeys(): Set<string> {
    const out = new Set<string>();
    for (const [k, p] of this.current) {
      if (this.copyFrom.has(k) || this.removed.has(k)) continue;
      if (!samePose(p, this.saved.get(k), this.dim)) out.add(k);
    }
    for (const k of this.live) {
      const saved = this.savedCopies.get(k);
      if (saved === undefined || !samePose(saved, this.current.get(k), this.dim)) out.add(k);
    }
    for (const layer of this.layers()) {
      // Same comparison as orderDirty(): only objects in both lists.
      const saved = this.savedOrder.get(layer) || [];
      const now = this.order(layer).filter((k) => saved.includes(k));
      const was = saved.filter((k) => now.includes(k));
      // Bringing one object to the front shifts every other one by a place;
      // only the one that was moved should get the dot. The objects that kept
      // their order relative to each other are the longest common run of the
      // two lists; the rest are the moved ones.
      if (now.join('\n') !== was.join('\n')) for (const k of outOfOrder(was, now)) out.add(k);
    }
    return out;
  }

  /** placement.json content: every object that differs from its original, plus orphans. */
  result(): PlacementFile {
    const objects: Record<string, PlacementEntry> = {};
    for (const [k, e] of this.orphans) objects[k] = e;
    for (const [k, p] of this.current) {
      if (this.copyFrom.has(k) || this.removed.has(k)) continue;
      const was = this.was.get(k);
      if (samePose(p, was, this.dim)) continue;
      const m = this.meta.get(k);
      const e: PlacementEntry = { ...roundPose(p, this.dim) };
      if (was) e.was = roundPose(was, this.dim);
      if (m?.label && m.label !== k) e.label = m.label;
      if (m?.unstable) e.unstable = true;
      objects[k] = e;
    }
    const file: PlacementFile = { version: 1, tool: 'placement', dim: this.dim, space: 'local', objects };
    const order: PlacementOrder[] = [];
    // Lists of the file the game does not show now: kept, like orphans.
    for (const [layer, o] of this.fileOrders) if (!this.layers().includes(layer)) order.push(o);
    for (const layer of this.layers()) {
      const keys = this.order(layer);
      const was = this.wasOrder.get(layer) || [];
      if (keys.length && keys.join('\n') !== was.join('\n') && keys.join('\n') !== this.expectedOrder(layer).join('\n')) order.push({ in: layer, keys, was });
    }
    if (order.length) file.order = order;
    const added: PlacementAdded[] = [...this.orphanAdded];
    for (const k of this.copyOrder) {
      if (!this.live.has(k)) continue;
      const a: PlacementAdded = { key: k, from: this.liveFrom(k), ...roundPose(this.current.get(k)!, this.dim) };
      const label = this.meta.get(k)?.label;
      if (label && label !== k) a.label = label;
      added.push(a);
    }
    if (added.length) file.added = added;
    const removed = [...this.removed].sort().map((k) => this.removedMeta.get(k) || { key: k });
    if (removed.length) file.removed = removed;
    return file;
  }

  markSaved(): void {
    for (const [k, p] of this.current) this.saved.set(k, { ...p });
    this.savedCopies.clear();
    for (const k of this.live) this.savedCopies.set(k, roundPose(this.current.get(k)!, this.dim));
    this.savedRemoved = new Set(this.removed);
    for (const layer of this.layers()) this.savedOrder.set(layer, this.order(layer));
  }
}
