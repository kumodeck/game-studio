// Placement model and undo stack: the shell's bookkeeping, without a browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PlacementModel, roundPose } from '../src/shell/placement-model.ts';
import { UndoStack, poseChange, type Change, type UndoEntry } from '../src/shell/undo.ts';
import type { Item } from '../src/contract.ts';

const item = (key: string, p: number[], extra: Partial<Item> = {}): Item => ({
  key, label: key, kinds: ['mesh'], rotatable: true, scalable: true, pose: { p, r: 0, s: 1 }, ...extra,
});

test('only moved objects are written, with `was`', () => {
  const m = new PlacementModel();
  assert.deepEqual(m.setItems([item('tree', [2, 0, -4.1]), item('rock', [0, 0, 0])], '3d'), []);
  assert.equal(m.dirty(), 0);
  m.moved('tree', { p: [3.25004, 0, -4.1], r: 1.57079, s: 1 });
  assert.equal(m.dirty(), 1);
  const f = m.result();
  assert.deepEqual(Object.keys(f.objects), ['tree']);
  assert.deepEqual(f.objects.tree, { p: [3.25, 0, -4.1], r: 1.5708, s: 1, was: { p: [2, 0, -4.1], r: 0, s: 1 } });
  m.markSaved();
  assert.equal(m.dirty(), 0);
});

test('moving back to the original removes the entry', () => {
  const m = new PlacementModel();
  m.setItems([item('a', [1, 1])], '2d');
  m.moved('a', { p: [5, 1], r: 0, s: 1 });
  m.moved('a', { p: [1.02, 1], r: 0, s: 1 });
  assert.deepEqual(m.result().objects, {});
});

test('reopening re-applies the saved file and keeps `was` and orphans', () => {
  const m = new PlacementModel();
  m.restore({ version: 1, tool: 'placement', dim: '3d', space: 'local', objects: {
    tree: { p: [3, 0, 0], r: 0, s: 1, was: { p: [2, 0, 0], r: 0, s: 1 } },
    gone: { p: [9, 9, 9], was: { p: [0, 0, 0] } },
  } });
  const apply = m.setItems([item('tree', [2, 0, 0])], '3d');
  assert.deepEqual(apply, [{ key: 'tree', pose: { p: [3, 0, 0], r: 0, s: 1 } }]);
  assert.equal(m.dirty(), 0, 'the saved arrangement is not unsaved');
  const f = m.result();
  assert.deepEqual(f.objects.tree?.was, { p: [2, 0, 0], r: 0, s: 1 });
  assert.ok(f.objects.gone, 'entries for objects the game no longer has are kept');
});

test('game already applying placement.json: no push back, was from file', () => {
  const m = new PlacementModel();
  m.restore({ version: 1, tool: 'placement', dim: '3d', space: 'local', objects: { tree: { p: [3, 0, 0], was: { p: [2, 0, 0] } } } });
  assert.deepEqual(m.setItems([item('tree', [3, 0, 0])], '3d'), []);
  assert.deepEqual(m.result().objects.tree?.was, { p: [2, 0, 0] });
});

test('roundPose: 1 mm / 0.1 px / 1e-4 rad', () => {
  assert.deepEqual(roundPose({ p: [1.23456, 0.0004, -2], r: 0.123456, s: 1.00004 }, '3d'), { p: [1.235, 0, -2], r: 0.1235, s: 1 });
  assert.deepEqual(roundPose({ p: [10.04, 3.06] }, '2d'), { p: [10, 3.1] });
});

test('undo stack: one entry per gesture, redo cleared by new gesture, limit', () => {
  const u = new UndoStack(3);
  const P = (x: number) => ({ p: [x, 0] });
  assert.equal(u.push(poseChange('a', P(0), P(0))), false, 'no-op gestures are not recorded');
  for (let i = 0; i < 5; i++) u.push(poseChange('a', P(i), P(i + 1)));
  assert.equal(u.size, 3);
  const first = (e: UndoEntry | null) => e?.changes[0] as Extract<Change, { kind: 'pose' }> | undefined;
  assert.deepEqual(first(u.undo())?.from, P(4));
  assert.deepEqual(first(u.redo())?.to, P(5));
  u.undo();
  u.push(poseChange('b', P(0), P(1)));
  assert.equal(u.canRedo, false);
  // One entry for a whole action: a group move with one object that did not move keeps the others.
  assert.equal(u.push({ changes: [{ kind: 'pose', key: 'a', from: P(1), to: P(1) }, { kind: 'pose', key: 'b', from: P(1), to: P(2) }, { kind: 'add', key: 'c', from: 'b', pose: P(3) }] }), true);
  assert.deepEqual(u.undo()?.changes.map((c) => c.key), ['b', 'c']);
});

// ----- draw order (2D layers) -----
const layered = (key: string, z: number, layer = 'stage') => item(key, [z * 10, 0], { layer, pose: { p: [z * 10, 0], r: 0, s: 1, z } });

test('draw order: one reorder = one Save count and one `order` entry, back → front', () => {
  const m = new PlacementModel();
  m.setItems([layered('bg-tree', 0), layered('house', 1), layered('rock', 2)], '2d');
  assert.equal(m.dirty(), 0);
  // The house goes to the back; the adapter re-lists everyone with new z.
  m.moved('house', { p: [10, 0], r: 0, s: 1, z: 0 });
  m.setItems([layered('bg-tree', 1), item('house', [10, 0], { layer: 'stage', pose: { p: [10, 0], r: 0, s: 1, z: 0 } }), layered('rock', 2)], '2d');
  assert.equal(m.dirty(), 1, 'the order of one list changed: one unsaved change');
  const f = m.result();
  assert.deepEqual(f.objects, {}, 'z is never written per object');
  assert.deepEqual(f.order, [{ in: 'stage', keys: ['house', 'bg-tree', 'rock'], was: ['bg-tree', 'house', 'rock'] }]);
  m.markSaved();
  assert.equal(m.dirty(), 0);
  // A handle move without z keeps the object's place in the order.
  m.moved('rock', { p: [99, 0], r: 0, s: 1 });
  assert.equal(m.pose('rock')!.z, 2);
});

test('draw order: reopening re-applies the saved order from the back', () => {
  const m = new PlacementModel();
  m.restore({ version: 1, tool: 'placement', dim: '2d', space: 'local', objects: {},
    order: [{ in: 'stage', keys: ['c', 'a', 'b'], was: ['a', 'b', 'c'] }] });
  const apply = m.setItems([layered('a', 0), layered('b', 1), layered('c', 2)], '2d');
  assert.deepEqual(apply.map((a) => [a.key, a.pose.z]), [['c', 0], ['a', 1], ['b', 2]]);
  // The game then lists the new order: nothing unsaved, `was` kept from the file.
  assert.deepEqual(m.setItems([layered('c', 0), layered('a', 1), layered('b', 2)], '2d'), []);
  assert.equal(m.dirty(), 0);
  assert.deepEqual(m.result().order, [{ in: 'stage', keys: ['c', 'a', 'b'], was: ['a', 'b', 'c'] }]);
});

test('changedKeys: the rows behind the Save count (moved, and only the reordered one)', () => {
  const m = new PlacementModel();
  m.setItems([layered('bg-tree', 0), layered('house', 1), layered('rock', 2), layered('fence', 3)], '2d');
  assert.deepEqual([...m.changedKeys()], []);
  m.moved('rock', { p: [5, 5], r: 0, s: 1 });
  assert.deepEqual([...m.changedKeys()], ['rock']);
  m.markSaved();
  // The fence goes to the back: every other object shifts one place, but only the fence was moved.
  m.setItems([layered('bg-tree', 1), layered('house', 2), { ...layered('rock', 3), pose: { p: [5, 5], r: 0, s: 1, z: 3 } }, layered('fence', 0)], '2d');
  assert.deepEqual([...m.changedKeys()], ['fence']);
  m.markSaved();
  assert.deepEqual([...m.changedKeys()], []);
});

test('undo stack: peek names the next step without taking it', () => {
  const u = new UndoStack();
  assert.equal(u.peekUndo(), null);
  u.push(poseChange('a', { p: [0, 0] }, { p: [1, 0] }));
  assert.equal(u.peekUndo()!.changes[0]!.key, 'a');
  assert.equal(u.peekRedo(), null);
  u.undo();
  assert.equal(u.peekUndo(), null);
  assert.equal(u.peekRedo()!.changes[0]!.key, 'a');
});
