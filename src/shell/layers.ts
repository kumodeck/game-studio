// Draw order (2D layers) in the shell: which object is in front of which.
// Pure functions over the item list (no DOM), so they are unit-tested.
//
// The adapter reports, per object, `layer` (the sibling list it is drawn in,
// usually its parent) and `pose.z` (its place among the LISTED objects of that
// list, 0 = back). Changing the order is one setPose with a new z, so undo,
// redo and the Save count reuse the pose machinery.
//
// WHY every target is "the z of another listed sibling" and never z ± 1: the
// adapter's ranks can have gaps (objects hidden by the game's rules are still
// counted), and moving to a sibling's z puts the object just past that
// sibling in the direction of travel. So "forward" always passes exactly one
// thing the person can see.
//
// Ground / background (Item.backdrop, play test 2026-10-16): "to back"
// once put a rock behind the ground, where it vanished. The backdrops at the
// back of a list stay there: they have no targets of their own, and nothing
// else goes behind them ("to back" = just in front of the ground).
import type { Item } from '../contract.ts';

export type LayerOp = 'toFront' | 'forward' | 'backward' | 'toBack';

/** True when the adapter can change the draw order of this object. */
export const hasLayer = (it: Item | undefined): it is Item & { layer: string } =>
  !!it && typeof it.layer === 'string' && typeof it.pose.z === 'number';

/** Listed objects drawn in the same list as `key`, back → front. */
export function siblingsOf(items: Item[], key: string): Item[] {
  const it = items.find((i) => i.key === key);
  if (!hasLayer(it)) return [];
  return items.filter((i) => hasLayer(i) && i.layer === it.layer).sort((a, b) => a.pose.z! - b.pose.z!);
}

/**
 * How many siblings (back → front list) are ground / background kept at the
 * back: the lowest place anything else may take.
 */
export function floorOf(sib: Item[]): number {
  let n = 0;
  while (n < sib.length && sib[n]!.backdrop) n++;
  return n;
}

/** The z to send for a button/shortcut, or null when the object is already there (or is the ground). */
export function layerTarget(items: Item[], key: string, op: LayerOp): number | null {
  const sib = siblingsOf(items, key);
  const i = sib.findIndex((s) => s.key === key);
  if (i < 0 || sib.length < 2 || sib[i]!.backdrop) return null;
  const floor = floorOf(sib);
  const to = op === 'toFront' ? sib.length - 1 : op === 'toBack' ? floor : op === 'forward' ? i + 1 : i - 1;
  if (to < floor || to >= sib.length || to === i) return null;
  return sib[to]!.pose.z!;
}

/**
 * The z to send after a drag in the list. `frontIndex` = where the object was
 * dropped among its siblings as the list shows them (front first, 0 = top),
 * counted with the dragged object taken out.
 */
export function dropTarget(items: Item[], key: string, frontIndex: number): number | null {
  const sib = siblingsOf(items, key);
  const i = sib.findIndex((s) => s.key === key);
  if (i < 0 || sib[i]!.backdrop) return null;
  const n = sib.length;
  // Front-first position k ↔ back-first rank n-1-k; dropped below the ground = just in front of it.
  const rank = Math.max(floorOf(sib), n - 1 - Math.max(0, Math.min(n - 1, Math.round(frontIndex))));
  return rank === i ? null : sib[rank]!.pose.z!;
}

/** Keys of one list, back → front (what placement.json `order[].keys` holds). */
export function orderOfLayer(items: Item[], layer: string): string[] {
  return items.filter((i) => hasLayer(i) && i.layer === layer).sort((a, b) => a.pose.z! - b.pose.z!).map((i) => i.key);
}

export interface LayerRow {
  item: Item;
  /** Nesting depth: objects drawn inside a listed object (a container) are indented under it. */
  depth: number;
}
export interface LayerBlock {
  /** The list id; shown as a heading only when there is more than one top-level list. */
  layer: string;
  rows: LayerRow[];
}

/**
 * The object list in draw order, front on top. Lists drawn inside a listed
 * object (Pixi: sprites in a container) are shown right under that object,
 * indented. Objects without a layer are not included (the caller shows them
 * after, as before).
 */
export function layerBlocks(items: Item[]): LayerBlock[] {
  const layered = items.filter(hasLayer);
  const keys = new Set(items.map((i) => i.key));
  const byLayer = new Map<string, Item[]>();
  for (const it of layered) {
    const arr = byLayer.get(it.layer!) || [];
    arr.push(it);
    byLayer.set(it.layer!, arr);
  }
  for (const arr of byLayer.values()) arr.sort((a, b) => b.pose.z! - a.pose.z!);
  const done = new Set<string>();
  const walk = (layer: string, depth: number, rows: LayerRow[]) => {
    if (done.has(layer)) return; // a malformed adapter could report a cycle
    done.add(layer);
    for (const it of byLayer.get(layer) || []) {
      rows.push({ item: it, depth });
      if (byLayer.has(it.key)) walk(it.key, depth + 1, rows);
    }
  };
  const blocks: LayerBlock[] = [];
  for (const layer of byLayer.keys()) {
    if (keys.has(layer)) continue; // drawn inside a listed object: shown under it
    const rows: LayerRow[] = [];
    walk(layer, 0, rows);
    blocks.push({ layer, rows });
  }
  // Lists whose parent object is listed but never reached (cycles): still show them.
  for (const layer of byLayer.keys()) {
    if (done.has(layer)) continue;
    const rows: LayerRow[] = [];
    walk(layer, 0, rows);
    blocks.push({ layer, rows });
  }
  return blocks;
}
