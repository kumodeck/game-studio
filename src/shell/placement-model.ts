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
import { type Dim, type Item, type PlacementAdded, type PlacementEntry, type PlacementFile, type PlacementOrder, type PlacementRemoved, type Pose } from '../contract.ts';
import { hasLayer, orderOfLayer } from './layers.ts';
import { roundPose, samePose } from './pose-compare.ts';
import { MotionStore } from './motion-model.ts';

// The pose rounding and comparison live in pose-compare.ts (2026-10-21) so the game page's Play code
// (bridge/play-arrange.ts) can use them without the whole model; re-exported here for the shell and the tests.
export { roundPose, samePose } from './pose-compare.ts';

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

/**
 * The person's pose over a new code's, part by part (play-after-ai, 2026-10-21): only what the hand changed since `was`
 * wins — the position (as a whole: one drag), the turn, the size, the tilt. The rest is the new code's. So the AI making
 * an object bigger keeps its size when the person had only dragged it, and the person's drag keeps its place.
 */
function handOver(cur: Pose, was: Pose, code: Pose, dim: Dim): Pose {
  const same = (a: Partial<Pose>, b: Partial<Pose>) => samePose({ p: [0], ...a } as Pose, { p: [0], ...b } as Pose, dim);
  const out: Pose = structuredClone({ ...code, z: undefined });
  if (!same({ p: cur.p }, { p: was.p })) out.p = cur.p.slice();
  if (!same({ r: cur.r }, { r: was.r })) out.r = cur.r;
  if (!same({ s: cur.s }, { s: was.s })) out.s = Array.isArray(cur.s) ? cur.s.slice() : cur.s;
  if (!same({ t: cur.t }, { t: was.t })) {
    if (cur.t) out.t = [cur.t[0], cur.t[1]];
    else delete out.t;
  }
  return out;
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
  /**
   * How objects move by themselves (motion-gui, 2026-10-22): its own store (motion-model.ts), read and written with the
   * rest of the file. Each object whose motion changed is one Save count and a dot on its row.
   */
  readonly motion = new MotionStore();

  /** Load the saved file (before the game reports its items). */
  restore(file: PlacementFile | null): void {
    this.fileEntries.clear();
    this.fileOrders.clear();
    this.fileAdded = [];
    this.fileRemoved = [];
    this.motion.restore(file?.motion);
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
   * A NEW page of the game (Play → Edit, a reload) listed its objects: what of the arrangement on screen before it does
   * not show. Call BEFORE setItems() with the new page's raw list; the shell pushes the result to the page.
   *
   * WHY (a try of the editor, 2026-10-21, "I moved things, pressed Play without Save, and everything was reset"): the saved poses
   * were pushed only once, on the first list after opening (setItems' `apply`). A game that does not read
   * placement.json itself (a game the AI made, before "add the loader") came back from Play — or from the AI's reload
   * — at its code's layout while the card and "Save · 1" still said "moved". Now the page gets the editor's
   * arrangement back, saved or not.
   *
   * Only what the page shows AS ITS CODE MAKES IT: an object at `was` (the code's own pose) that the person put
   * elsewhere, a copy the page does not have, a deleted object it still has, a list in the code's order that the person
   * reordered. A game whose loader applied the draft already shows it (nothing to do).
   *
   * An object the page shows at neither `was` nor the editor's pose: the code puts it somewhere new (the AI's change,
   * a game that places things itself). Its `was` becomes that new pose (so Save tells the AI where the code has it,
   * Play's bridge finds it at the draft's `was`, ⌘Z on the move goes to the AI's place) and its key is in `code`
   * (the AI's violet mark). Then (decided 2026-10-21, "Play after the AI showed only the AI's change"):
   *   - the person moved it (saved or not; a saved move the code does not have yet is still theirs) → the PERSON'S
   *     pose wins for what their hand changed (handOver: the place, the turn, the size, the tilt) and is pushed back.
   *     A hand move in the editor is the newest thing they said about that object, and Play and the editor must show
   *     the same; ⌘Z on the move shows the AI's place (the new `was`), the violet mark says the AI changed it;
   *   - not touched → the AI's pose becomes the editor's (the card and the list follow the game).
   * Before (v0.1.7) such an object was left at the AI's pose on screen while the model kept the person's, so the card
   * said one place and the game showed another — and its `was` stayed the old code's, which Play's bridge never found.
   */
  notShown(items: Item[]): {
    poses: Array<{ key: string; pose: Pose }>;
    copies: Array<{ key: string; from: string; pose: Pose }>;
    removes: string[];
    /** Objects the new code puts somewhere new (not at `was`, not at the editor's pose). */
    code: string[];
  } {
    const out = { poses: [] as Array<{ key: string; pose: Pose }>, copies: [] as Array<{ key: string; from: string; pose: Pose }>, removes: [] as string[], code: [] as string[] };
    // Nothing known yet (the first list after opening): setItems' own `apply` does that one.
    if (!this.was.size) return out;
    const flat = (p: Pose): Pose => ({ ...p, z: undefined });
    const byKey = new Map(items.map((i) => [i.key, i]));
    for (const it of items) {
      if (this.copyFrom.has(it.key)) continue;
      if (this.removed.has(it.key)) {
        out.removes.push(it.key);
        continue;
      }
      const cur = this.current.get(it.key), was = this.was.get(it.key);
      if (!cur || !was) continue;
      const at = flat(it.pose);
      if (samePose(at, flat(was), this.dim)) {
        // z stays the page's: the draw order is put back below, as a whole list.
        if (!samePose(flat(cur), flat(was), this.dim)) out.poses.push({ key: it.key, pose: flat(cur) });
        continue;
      }
      // Already as the editor has it (a loader read the draft; the AI put the move in the code): nothing to do.
      if (samePose(at, flat(cur), this.dim)) continue;
      // An object without a name (`path:…` key) is found by its place in the tree, which the AI's change shifts
      // (path:8 → path:11): another object may now have this key, so nothing goes to it (as before 2026-10-21).
      if (it.unstable || it.key.startsWith('path:')) continue;
      // The code puts it somewhere new (see above).
      out.code.push(it.key);
      const saved = this.saved.get(it.key);
      const handMoved = !samePose(flat(cur), flat(was), this.dim);
      const savedMove = !!saved && !samePose(flat(saved), flat(was), this.dim);
      this.was.set(it.key, { ...it.pose });
      if (!savedMove) this.saved.set(it.key, { ...it.pose });
      const want = handMoved ? handOver(cur, was, it.pose, this.dim) : null;
      if (want && !samePose(want, at, this.dim)) out.poses.push({ key: it.key, pose: want });
      else this.current.set(it.key, { ...it.pose });
    }
    for (const k of this.copyOrder) {
      if (!this.live.has(k) || byKey.has(k)) continue;
      const from = this.liveFrom(k);
      // Made from something the new page does not have (the AI took it out): nothing to copy.
      if (!byKey.has(from)) continue;
      out.copies.push({ key: k, from, pose: flat(this.current.get(k)!) });
    }
    // Draw order (2D): a list the person reordered that the page shows in the code's order again.
    for (const layer of this.layers()) {
      const want = this.order(layer);
      const was = this.wasOrder.get(layer) || [];
      const raw = items.filter((i) => hasLayer(i) && i.layer === layer);
      const now = orderOfLayer(raw, layer);
      const keys = want.filter((k) => now.includes(k));
      if (keys.join('\n') === now.filter((k) => keys.includes(k)).join('\n')) continue;
      if (now.filter((k) => was.includes(k)).join('\n') !== was.filter((k) => now.includes(k)).join('\n')) continue;
      const slots = raw.filter((i) => keys.includes(i.key)).map((i) => i.pose.z!).sort((a, b) => a - b);
      keys.forEach((k, i) => {
        const p = out.poses.find((x) => x.key === k);
        const base = p?.pose ?? { ...(byKey.get(k)!.pose) };
        if (p) p.pose = { ...base, z: slots[i]! };
        else out.poses.push({ key: k, pose: { ...base, z: slots[i]! } });
      });
    }
    return out;
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

  /** The pose of the last save (else the game's own): what "check before saving" compares with (safe-save.ts). */
  savedPose(key: string): Pose | undefined {
    return this.saved.get(key);
  }

  /** The pose the game's own code gives it (`was`): the "now" side of the AI's question about a moved object (ai-ask.ts). */
  original(key: string): Pose | undefined {
    return this.was.get(key);
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
    return n + this.orderDirty().length + this.motion.changedKeys().length;
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
    for (const k of this.motion.changedKeys()) out.add(k);
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
    const motion = this.motion.result(this.dim, (k) => this.isRemoved(k));
    if (motion) file.motion = motion;
    return file;
  }

  markSaved(): void {
    for (const [k, p] of this.current) this.saved.set(k, { ...p });
    this.savedCopies.clear();
    for (const k of this.live) this.savedCopies.set(k, roundPose(this.current.get(k)!, this.dim));
    this.savedRemoved = new Set(this.removed);
    for (const layer of this.layers()) this.savedOrder.set(layer, this.order(layer));
    this.motion.markSaved();
  }
}
