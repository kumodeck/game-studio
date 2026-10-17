// Copy, delete and several-at-once in the shell: pure helpers over the item
// list (no DOM), so they are unit-tested (test/edit-ops.test.ts).
import type { Item } from '../contract.ts';
import { hasLayer, type LayerOp } from './layers.ts';

/**
 * Key for a new copy of `from`: a readable name the AI can put in the code
 * as the object's name / studioKey. "crate-1" with crate-1…4 in the game →
 * "crate-5"; "tree" → "tree-2"; an unnamed object (path:…) → its kind
 * ("rock-2"). `taken` = every key in the game and every copy made so far
 * (also deleted ones, so redo never reuses a key).
 */
export function copyKey(from: string, taken: Set<string>, kind?: string): string {
  const clean = (s: string) => s.replace(/[^A-Za-z0-9_:#.\-/]/g, '_');
  let base = from.startsWith('path:') ? clean(kind || 'copy') : from.replace(/#\d+$/, '').replace(/[-_ .]?\d+$/, '');
  base = (base || 'copy').replace(/^path:/, '').slice(0, 70);
  for (let n = 2; n < 100000; n++) {
    const k = `${base}-${n}`;
    if (!taken.has(k)) return k;
  }
  return `${base}-${Date.now()}`;
}

/**
 * Draw-order moves for a whole selection (2D layers): the `z` to send for
 * each selected object, one after another, so that the selection moves as
 * one block and keeps its own inner order. Every z is the place among the
 * listed siblings at the moment it is applied (the adapter takes the object
 * out and puts it there), exactly like one object's layer buttons, so undo is
 * the same moves backwards.
 */
export function groupLayerMoves(items: Item[], keys: string[], op: LayerOp): Array<{ key: string; z: number }> {
  const out: Array<{ key: string; z: number }> = [];
  const chosen = new Set(keys);
  const layers = new Set(items.filter((i) => chosen.has(i.key) && hasLayer(i) && i.movable !== false).map((i) => i.layer!));
  for (const layer of layers) {
    const sib = items.filter((i) => hasLayer(i) && i.layer === layer);
    // Places can have gaps (objects the game rules hide still count): keep them as empty slots.
    const size = Math.max(...sib.map((i) => i.pose.z!)) + 1;
    const arr: Array<string | null> = new Array(size).fill(null);
    for (const i of sib) arr[i.pose.z!] = i.key;
    const mine = (k: string | null): k is string => !!k && chosen.has(k) && sib.some((i) => i.key === k && i.movable !== false && !i.backdrop);
    // Ground / background at the back stays there (layers.ts floorOf): nothing goes below `floor`.
    let floor = 0;
    for (let i = 0; i < arr.length; i++) {
      const it = arr[i] ? sib.find((s) => s.key === arr[i]) : null;
      if (it && !it.backdrop) break;
      if (it) floor = i + 1;
    }
    const move = (k: string, to: number) => {
      const at = arr.indexOf(k);
      if (at < 0 || at === to) return;
      arr.splice(at, 1);
      arr.splice(to, 0, k);
      out.push({ key: k, z: to });
    };
    const start = arr.join('\n');
    const mark = out.length;
    const backFirst = arr.filter(mine);
    if (op === 'toFront') for (const k of backFirst) move(k, arr.length - 1);
    else if (op === 'toBack') for (const k of backFirst.slice().reverse()) move(k, floor);
    else if (op === 'forward') {
      // Front-most first: each passes the next object in front of it that is not selected.
      for (const k of backFirst.slice().reverse()) {
        const at = arr.indexOf(k);
        let to = -1;
        for (let i = at + 1; i < arr.length; i++) if (arr[i] && !chosen.has(arr[i]!)) { to = i; break; }
        if (to >= 0) move(k, to);
      }
    } else {
      for (const k of backFirst) {
        const at = arr.indexOf(k);
        let to = -1;
        for (let i = at - 1; i >= floor; i--) if (arr[i] && !chosen.has(arr[i]!)) { to = i; break; }
        if (to >= 0) move(k, to);
      }
    }
    // Already there (the block was at the front and is sent to the front): no moves at all.
    if (arr.join('\n') === start) out.length = mark;
  }
  return out;
}

/** Can the selection still move in this direction? (for enabling the layer buttons) */
export function groupLayerPossible(items: Item[], keys: string[], op: LayerOp): boolean {
  return groupLayerMoves(items, keys, op).length > 0;
}

/** Keys of the objects shown together as "name ×N" (same group) as `key`, in list order. */
export function sameKind(items: Item[], key: string): string[] {
  const it = items.find((i) => i.key === key);
  if (!it || !it.group) return it ? [it.key] : [];
  return items.filter((i) => i.group === it.group).map((i) => i.key);
}
