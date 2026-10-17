// Copy, delete and several at once (CONTRACT.md §1.8), without a browser:
// the placement model's file, the copy keys, the group draw-order moves, the
// copy/delete layer with a stand-in adapter, and the group maths.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PlacementModel } from '../src/shell/placement-model.ts';
import { copyKey, groupLayerMoves, sameKind } from '../src/shell/edit-ops.ts';
import { withEdits } from '../src/core/edits.ts';
import { beginGroup, groupMove, groupPoses, groupRotate, groupScale } from '../src/bridge/group.ts';
import { validatePlacement } from '../src/schema/index.ts';
import { translate } from '../src/shell/i18n.ts';
import type { Anchor, Item, Pose, StudioAdapter } from '../src/contract.ts';

const item = (key: string, p: number[], extra: Partial<Item> = {}): Item => ({
  key, label: key, kinds: ['mesh'], rotatable: true, scalable: true, pose: { p, r: 0, s: 1 }, ...extra,
});

test('copy keys: readable, free, never reused', () => {
  const taken = new Set(['crate-1', 'crate-2', 'crate-3', 'crate-4', 'tree', 'tree#2', 'path:0/4']);
  assert.equal(copyKey('crate-1', taken), 'crate-5');
  assert.equal(copyKey('tree#2', taken), 'tree-2');
  assert.equal(copyKey('flower-by-rock', taken), 'flower-by-rock-2');
  assert.equal(copyKey('path:0/4', taken, 'rock'), 'rock-2');
  taken.add('crate-5');
  assert.equal(copyKey('crate-5', taken), 'crate-6');
});

test('model: a copy is one change, written to `added` with its own pose, not to objects', () => {
  const m = new PlacementModel();
  m.setItems([item('crate-1', [0, 0, 0]), item('lamp', [0, 0, -5])], '3d');
  m.addCopy('crate-5', 'crate-1', { p: [1.20004, 0, 0], r: 0, s: 1 });
  m.setItems([item('crate-1', [0, 0, 0]), item('lamp', [0, 0, -5]), item('crate-5', [1.2, 0, 0], { copyOf: 'crate-1' })], '3d');
  assert.equal(m.dirty(), 1);
  m.moved('crate-5', { p: [2, 0, 0], r: 0, s: 1 });
  assert.equal(m.dirty(), 1, 'moving a fresh copy is still the one change');
  const f = m.result();
  assert.deepEqual(f.objects, {});
  assert.deepEqual(f.added, [{ key: 'crate-5', from: 'crate-1', p: [2, 0, 0], r: 0, s: 1 }]);
  assert.ok(validatePlacement(f).ok);
  m.markSaved();
  assert.equal(m.dirty(), 0);
  m.remove('crate-5');
  assert.equal(m.dirty(), 1, 'deleting a saved copy is a change');
  assert.equal(m.result().added, undefined);
  m.unremove('crate-5');
  assert.equal(m.dirty(), 0, 'undo of that delete');
});

test('model: a deleted game object goes to `removed` with the pose the game gives it', () => {
  const m = new PlacementModel();
  m.setItems([item('barrel', [3, 0, -3]), item('lamp', [0, 0, -5])], '3d');
  m.moved('barrel', { p: [4, 0, -3], r: 0, s: 1 });
  m.remove('barrel');
  m.setItems([item('lamp', [0, 0, -5])], '3d');
  assert.equal(m.dirty(), 1, 'a moved-then-deleted object counts once, as deleted');
  const f = m.result();
  assert.deepEqual(f.objects, {}, 'no move entry for a deleted object');
  assert.deepEqual(f.removed, [{ key: 'barrel', was: { p: [3, 0, -3], r: 0, s: 1 } }]);
  assert.ok(validatePlacement(f).ok);
});

test('model: a copy of a deleted copy is written as a copy of what is left', () => {
  const m = new PlacementModel();
  m.setItems([item('a', [0, 0])], '2d');
  m.addCopy('a-2', 'a', { p: [10, 0] });
  m.addCopy('a-3', 'a-2', { p: [20, 0] });
  m.remove('a-2');
  assert.deepEqual(m.result().added?.map((x) => [x.key, x.from]), [['a-3', 'a']]);
});

test('model: reopening before the AI changed the code makes the copies and deletions again', () => {
  const m = new PlacementModel();
  m.restore({
    version: 1, tool: 'placement', dim: '3d', space: 'local', objects: {},
    added: [{ key: 'crate-5', from: 'crate-1', p: [2, 0, 0], r: 0, s: 1 }, { key: 'crate-6', from: 'crate-5', p: [4, 0, 0] }, { key: 'x-2', from: 'gone', p: [0, 0, 0] }],
    removed: [{ key: 'barrel', was: { p: [3, 0, -3], r: 0, s: 1 } }, { key: 'lamp', was: { p: [9, 9, 9] } }],
  });
  m.setItems([item('crate-1', [0, 0, 0]), item('barrel', [3, 0, -3]), item('lamp', [0, 0, -5])], '3d');
  const fe = m.takeFileEdits();
  assert.deepEqual(fe.copies.map((c) => c.key), ['crate-5', 'crate-6'], 'in file order, a copy of a copy after its original');
  assert.deepEqual(fe.removes, ['barrel'], 'the lamp is not where the deleted one was: not touched');
  assert.equal(m.dirty(), 0, 'what was saved is not unsaved');
  const f = m.result();
  assert.deepEqual(f.added?.map((a) => a.key), ['x-2', 'crate-5', 'crate-6'], 'a copy of something gone is kept');
  assert.deepEqual(f.removed?.map((r) => r.key), ['barrel']);
});

test('model: after the AI put them in the code, copies are plain objects and deletions are done', () => {
  const m = new PlacementModel();
  m.restore({
    version: 1, tool: 'placement', dim: '3d', space: 'local', objects: {},
    added: [{ key: 'crate-5', from: 'crate-1', p: [2, 0, 0] }],
    removed: [{ key: 'barrel' }],
  });
  m.setItems([item('crate-1', [0, 0, 0]), item('crate-5', [2, 0, 0])], '3d');
  assert.deepEqual(m.takeFileEdits(), { copies: [], removes: [] });
  assert.equal(m.dirty(), 0);
  const f = m.result();
  assert.equal(f.added, undefined);
  assert.equal(f.removed, undefined);
});

test('model: copies in a draw-order list do not count as a reorder', () => {
  const lay = (key: string, z: number, extra: Partial<Item> = {}) => item(key, [z, 0], { layer: 'stage', pose: { p: [z, 0], r: 0, s: 1, z }, ...extra });
  const m = new PlacementModel();
  m.setItems([lay('a', 0), lay('b', 1), lay('c', 2)], '2d');
  m.addCopy('b-2', 'b', { p: [5, 0], r: 0, s: 1 });
  m.setItems([lay('a', 0), lay('b', 1), lay('b-2', 2, { copyOf: 'b' }), lay('c', 3)], '2d');
  assert.equal(m.dirty(), 1);
  assert.equal(m.result().order, undefined, 'the copy sits right after its original: no order entry');
  // The person puts the copy at the back: now it is a reorder.
  m.setItems([lay('b-2', 0, { copyOf: 'b' }), lay('a', 1), lay('b', 2), lay('c', 3)], '2d');
  assert.deepEqual(m.result().order, [{ in: 'stage', keys: ['b-2', 'a', 'b', 'c'], was: ['a', 'b', 'c'] }]);
});

test('group draw order: the selection moves as one block and keeps its inner order', () => {
  const lay = (key: string, z: number) => item(key, [0, 0], { layer: 'stage', pose: { p: [0, 0], r: 0, s: 1, z } });
  const items = [lay('a', 0), lay('b', 1), lay('c', 2), lay('d', 3), lay('e', 4)];
  const run = (keys: string[], op: 'toFront' | 'toBack' | 'forward' | 'backward') => {
    const arr = items.slice().sort((x, y) => x.pose.z! - y.pose.z!).map((i) => i.key);
    for (const m of groupLayerMoves(items, keys, op)) {
      arr.splice(arr.indexOf(m.key), 1);
      arr.splice(m.z, 0, m.key);
    }
    return arr.join('');
  };
  assert.equal(run(['a', 'c'], 'toFront'), 'bdeac');
  assert.equal(run(['b', 'e'], 'toBack'), 'beacd');
  assert.equal(run(['a', 'b'], 'forward'), 'cabde', 'passes exactly one other object');
  assert.equal(run(['d', 'e'], 'backward'), 'abdec');
  assert.deepEqual(groupLayerMoves(items, ['d', 'e'], 'toFront'), [], 'already at the front');
  assert.deepEqual(sameKind([item('t1', [0], { group: 'tree' }), item('r', [0]), item('t2', [0], { group: 'tree' })], 't2'), ['t1', 't2']);
});

test('group draw order: the ground at the back stays there (play test 2026-10-16)', () => {
  const lay = (key: string, z: number, extra: Partial<Item> = {}) => item(key, [0, 0], { layer: 'stage', pose: { p: [0, 0], r: 0, s: 1, z }, ...extra });
  const items = [lay('g', 0, { backdrop: true }), lay('a', 1), lay('b', 2), lay('c', 3)];
  const run = (keys: string[], op: 'toFront' | 'toBack' | 'forward' | 'backward') => {
    const arr = items.slice().sort((x, y) => x.pose.z! - y.pose.z!).map((i) => i.key);
    for (const m of groupLayerMoves(items, keys, op)) {
      arr.splice(arr.indexOf(m.key), 1);
      arr.splice(m.z, 0, m.key);
    }
    return arr.join('');
  };
  assert.equal(run(['b', 'c'], 'toBack'), 'gbca');
  assert.equal(run(['a', 'b'], 'backward'), 'gabc', 'nothing passes behind the ground');
  assert.equal(run(['g', 'a'], 'toFront'), 'gbca', 'the ground itself does not move');
});

/** A tiny 2D adapter: objects are points with a 20 px box, screen = parent space (no clone/remove). */
function fakeAdapter(): StudioAdapter & { obj: Map<string, Pose> } {
  const obj = new Map<string, Pose>([['a', { p: [100, 100], r: 0, s: 1 }], ['b', { p: [200, 100], r: 0, s: 1 }]]);
  const grabs = new Map<string, number[]>();
  const anchor = (k: string): Anchor | null => {
    const p = obj.get(k);
    if (!p) return null;
    const s = (p.s as number) * 20;
    return { center: [p.p[0]!, p.p[1]!], rect: { x: p.p[0]! - s / 2, y: p.p[1]! - s / 2, w: s, h: s }, size: s, pose: structuredClone(p), visible: true };
  };
  const set = (k: string, p: Pose) => (obj.set(k, structuredClone({ p: p.p.slice(0, 2), r: p.r ?? 0, s: p.s ?? 1 })), structuredClone(obj.get(k)!));
  return {
    obj,
    kind: 'fake', dim: '2d',
    list: () => [...obj].map(([key, pose]) => item(key, pose.p, { pose: structuredClone(pose) })),
    begin() { return this.list(); },
    end() {},
    render() {},
    pickNear: (x, y, r) => [...obj.keys()].filter((k) => Math.hypot(obj.get(k)!.p[0]! - x, obj.get(k)!.p[1]! - y) <= r + 10),
    anchor,
    grab: (k, x, y) => (grabs.set(k, [x - obj.get(k)!.p[0]!, y - obj.get(k)!.p[1]!]), true),
    drag: (k, x, y) => set(k, { ...obj.get(k)!, p: [x - grabs.get(k)![0]!, y - grabs.get(k)![1]!] }),
    rotate: (k, d) => set(k, { ...obj.get(k)!, r: (obj.get(k)!.r ?? 0) + d }),
    scale: (k, f) => set(k, { ...obj.get(k)!, s: (obj.get(k)!.s as number) * f }),
    setPose: (k, p) => (obj.has(k) ? set(k, p) : null),
    capture: async () => ({ ok: false }),
    view: { pan() {}, zoom() {}, frameAll() {}, focus() {}, state: () => null },
    assetsOf: () => [],
  };
}

test('stand-ins: without clone()/remove() copies are ghosts and deletions shrink, all exact', () => {
  const raw = fakeAdapter();
  const e = withEdits(raw);
  assert.deepEqual(e.make('a-2', 'a'), { ghost: true });
  // The ghost moves on its own; the original stays exactly where it was.
  e.grab('a-2', 100, 100);
  e.drag('a-2', 130, 140);
  assert.deepEqual(e.anchor('a-2')!.pose.p, [130, 140]);
  assert.deepEqual(raw.obj.get('a')!.p, [100, 100]);
  assert.deepEqual(e.list().map((i) => [i.key, i.ghost ?? false, i.copyOf ?? null]), [['a', false, null], ['b', false, null], ['a-2', true, 'a']]);
  assert.equal(e.pickNear(130, 140, 5)[0], 'a-2', 'a stand-in is picked first (it is drawn on top)');
  // A copy of a stand-in is another stand-in of the same original.
  assert.deepEqual(e.make('a-3', 'a-2'), { ghost: true });
  assert.deepEqual(e.anchor('a-3')!.pose.p, [130, 140]);
  // Delete without remove(): shrunk out of sight and left out of the list; undo is exact.
  e.removeKeys(['b']);
  assert.equal(raw.obj.get('b')!.s, 1e-4);
  assert.ok(!e.list().some((i) => i.key === 'b'));
  assert.equal(e.anchor('b'), null);
  e.restoreKeys(['b']);
  assert.deepEqual(raw.obj.get('b'), { p: [200, 100], r: 0, s: 1 });
  // Deleting and bringing back a stand-in.
  e.removeKeys(['a-2']);
  assert.ok(!e.list().some((i) => i.key === 'a-2'));
  assert.deepEqual(e.make('a-2', 'a'), { ghost: true }, 'redo of the copy brings the same one back');
  assert.ok(e.list().some((i) => i.key === 'a-2'));
});

test('group (2D): move, turn and resize all from the start of the gesture', () => {
  const raw = fakeAdapter();
  const s = beginGroup(raw, ['a', 'b'], 'a')!;
  assert.deepEqual(s.center, [150, 100]);
  groupMove(raw, '2d', s, 10, 5);
  groupMove(raw, '2d', s, 20, 10); // absolute: the second call does not add to the first
  assert.deepEqual(groupPoses(raw, s, false).map((e) => e.pose.p), [[120, 110], [220, 110]]);
  groupRotate(raw, '2d', s, Math.PI / 2);
  const turned = groupPoses(raw, s, true);
  // Quarter turn clockwise around (150, 100): a (left) goes up, b (right) goes down.
  assert.deepEqual(turned.map((e) => e.pose.p.map(Math.round)), [[150, 50], [150, 150]]);
  assert.ok(turned.every((e) => Math.abs((e.pose.r ?? 0) - Math.PI / 2) < 1e-9));
  assert.deepEqual(turned[0]!.from!.p, [100, 100], '`from` is the start of the gesture');
  groupScale(raw, '2d', s, 2);
  // "Together" from the feet (the bottom middle of each box, 10 px under the pivot here): the feet spread ×2
  // and stay on the same line, so each pivot rises by the half box it grew.
  assert.deepEqual(groupPoses(raw, s, false).map((e) => [e.pose.p, e.pose.s]), [[[50, 90], 2], [[250, 90], 2]]);
  groupScale(raw, '2d', s, 2, 'inplace');
  assert.deepEqual(groupPoses(raw, s, false).map((e) => [e.pose.p, e.pose.s]), [[[100, 90], 2], [[200, 90], 2]], 'each in place: the feet stay put');
});

test('group (3D): resize together / each in place keeps the feet on the ground', () => {
  // Crates 1 m wide with their origin in the middle (foot = 0.5 m under it), one stacked on another.
  const obj = new Map<string, Pose>([['a', { p: [-1, 0.5, 0], r: 0, s: 1 }], ['b', { p: [1, 0.5, 0], r: 0, s: 1 }], ['c', { p: [1, 1.5, 0], r: 0, s: 1 }]]);
  const set = (k: string, p: Pose) => (obj.set(k, structuredClone(p)), structuredClone(p));
  const a3: StudioAdapter = {
    ...fakeAdapter(), dim: '3d', kind: 'fake3d',
    list: () => [...obj].map(([key, pose]) => item(key, pose.p, { pose: structuredClone(pose) })),
    anchor: (k) => ({ center: [0, 0], size: 10, pose: structuredClone(obj.get(k)!), visible: true }),
    setPose: (k, p) => set(k, p),
    scale: (k, f) => set(k, { ...obj.get(k)!, s: (obj.get(k)!.s as number) * f }),
    foot: (k) => {
      const p = obj.get(k)!;
      return [p.p[0]!, p.p[1]! - (p.s as number) / 2, p.p[2]!];
    },
  };
  const r = (v: number) => Math.round(v * 1000) / 1000 || 0;
  const s = beginGroup(a3, ['a', 'b', 'c'], 'a')!;
  groupScale(a3, '3d', s, 2, 'spread');
  // Feet x spread ×2 from the middle (0); heights from the lowest foot (0): c's foot 1 → 2, on top of b (2 m tall now).
  assert.deepEqual(['a', 'b', 'c'].map((k) => obj.get(k)!.p.map(r)), [[-2, 1, 0], [2, 1, 0], [2, 3, 0]]);
  assert.ok(['a', 'b', 'c'].every((k) => obj.get(k)!.s === 2));
  groupScale(a3, '3d', s, 2, 'inplace');
  // Each in place: every foot where it was (a and b on the ground, c on its old spot).
  assert.deepEqual(['a', 'b', 'c'].map((k) => a3.foot!(k)!.map(r)), [[-1, 0, 0], [1, 0, 0], [1, 1, 0]]);
});

test('group (3D): a turn moves the positions around the middle on the ground', () => {
  const obj = new Map<string, Pose>([['a', { p: [-1, 0, 0], r: 0, s: 1 }], ['b', { p: [1, 2, 0], r: 0, s: 1 }]]);
  const set = (k: string, p: Pose) => (obj.set(k, structuredClone(p)), structuredClone(p));
  const a3: StudioAdapter = {
    ...fakeAdapter(), dim: '3d', kind: 'fake3d',
    list: () => [...obj].map(([key, pose]) => item(key, pose.p, { pose: structuredClone(pose) })),
    anchor: (k) => ({ center: [0, 0], size: 10, pose: structuredClone(obj.get(k)!), visible: true }),
    setPose: (k, p) => set(k, p),
    // Like three.js seen from above: a clockwise screen turn lowers rotation.y.
    rotate: (k, d) => set(k, { ...obj.get(k)!, r: (obj.get(k)!.r ?? 0) - d }),
    scale: (k, f) => set(k, { ...obj.get(k)!, s: (obj.get(k)!.s as number) * f }),
  };
  const s = beginGroup(a3, ['a', 'b'], 'a')!;
  groupRotate(a3, '3d', s, Math.PI / 2);
  const r = (v: number) => Math.round(v * 1000) / 1000 || 0;
  // yaw −90°: (x, z) → (x cos + z sin, −x sin + z cos) with sin = −1 → (−z, x).
  assert.deepEqual(obj.get('a')!.p.map(r), [0, 0, -1]);
  assert.deepEqual(obj.get('b')!.p.map(r), [0, 2, 1], 'heights stay');
  assert.ok(Math.abs(obj.get('a')!.r! + Math.PI / 2) < 1e-9);
  groupScale(a3, '3d', s, 2);
  assert.deepEqual(obj.get('b')!.p.map(r), [2, 4, 0], 'heights scale from the lowest member');
});

test('every shell text key exists in English', () => {
  const dir = new URL('../src/shell/', import.meta.url).pathname;
  const missing: string[] = [];
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.ts'))) {
    const src = readFileSync(join(dir, f), 'utf8');
    for (const m of src.matchAll(/\bt\('([a-zA-Z][\w.-]*)'[,)]/g)) {
      if (translate('en', m[1]!) === m[1]) missing.push(`${f}: ${m[1]}`);
    }
  }
  assert.deepEqual(missing, []);
});
