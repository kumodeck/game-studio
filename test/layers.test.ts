// Draw order (2D layers) helpers of the shell: targets for the buttons and
// the list drag, and the list shown front-first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dropTarget, layerBlocks, layerTarget } from '../src/shell/layers.ts';
import type { Item } from '../src/contract.ts';
import { backdropRun } from '../src/core/port2d.ts';

const it = (key: string, z: number, layer = 'stage'): Item => ({
  key, label: key, kinds: ['sprite'], rotatable: true, scalable: true, layer, pose: { p: [0, 0], r: 0, s: 1, z },
});

test('buttons move past exactly one visible sibling, even with gaps in z', () => {
  // z 1 is an object hidden by the game's rules: still counted by the adapter.
  const items = [it('a', 0), it('b', 2), it('c', 3), it('post', 0, 'fence')];
  assert.equal(layerTarget(items, 'a', 'forward'), 2);
  assert.equal(layerTarget(items, 'a', 'toFront'), 3);
  assert.equal(layerTarget(items, 'c', 'backward'), 2);
  assert.equal(layerTarget(items, 'c', 'toBack'), 0);
  assert.equal(layerTarget(items, 'c', 'forward'), null, 'already in front');
  assert.equal(layerTarget(items, 'post', 'forward'), null, 'alone in its list');
  assert.equal(layerTarget([{ ...it('x', 0), layer: undefined }], 'x', 'forward'), null, 'no layer (3D)');
});

test('list drop: front-first index → z of the sibling at that place', () => {
  const items = [it('a', 0), it('b', 1), it('c', 2)]; // shown as c, b, a
  assert.equal(dropTarget(items, 'a', 0), 2, 'a dropped on top = in front');
  assert.equal(dropTarget(items, 'c', 2), 0, 'c dropped at the bottom = at the back');
  assert.equal(dropTarget(items, 'b', 1), null, 'dropped where it was');
});

test('blocks: front on top, children of a listed container indented under it', () => {
  const items = [it('ground', 0), it('house', 1), it('fence', 2), it('post-1', 0, 'fence'), it('post-2', 1, 'fence'), { ...it('hud', 0), layer: undefined }];
  const b = layerBlocks(items);
  assert.equal(b.length, 1);
  assert.deepEqual(b[0]!.rows.map((r) => `${'-'.repeat(r.depth)}${r.item.key}`), ['fence', '-post-2', '-post-1', 'house', 'ground']);
});

test('ground / background at the back stays there: "to back" stops just in front of it (play test 2026-10-16)', () => {
  const g = { ...it('ground', 0), backdrop: true };
  const items = [g, it('house', 1), it('rock', 2), it('tree', 3)];
  assert.equal(layerTarget(items, 'rock', 'toBack'), 1, 'to back = just in front of the ground');
  assert.equal(layerTarget(items, 'house', 'toBack'), null, 'already right in front of the ground');
  assert.equal(layerTarget(items, 'house', 'backward'), null, 'never behind the ground');
  assert.equal(layerTarget(items, 'rock', 'backward'), 1);
  for (const op of ['toFront', 'forward', 'backward', 'toBack'] as const) assert.equal(layerTarget(items, 'ground', op), null, `ground ${op}`);
  assert.equal(dropTarget(items, 'tree', 3), 1, 'dropped below the ground = just in front of it');
  assert.equal(dropTarget(items, 'ground', 0), null, 'the ground is not dragged');
});

test('backdropRun: ground / background = the unbroken run at the back that is named so or as wide as the game', () => {
  const W = 800;
  assert.deepEqual(backdropRun([{ key: 'path:1', label: 'graphics (no name)', w: 800 }, { key: 'house', w: 120 }, { key: 'cloud', w: 790 }], W), ['path:1'], 'wide at the back; a wide cloud in the middle is not');
  assert.deepEqual(backdropRun([{ key: 'sky', label: 'sky', w: 300 }, { key: 'ground', label: '地面', w: 300 }, { key: 'rock', w: 40 }], W), ['sky', 'ground']);
  assert.deepEqual(backdropRun([{ key: 'house', w: 120 }, { key: 'ground', label: 'ground', w: 800 }], W), [], 'not at the very back: the person put it there');
  assert.deepEqual(backdropRun([{ key: 'far', w: 900 }, { key: 'near', w: 900 }], W), [], 'everything wide (parallax strips): all reorderable');
  assert.deepEqual(backdropRun([{ key: 'playground-sign', label: 'playground sign', w: 60 }, { key: 'x', w: 10 }], W), [], 'a word inside another word does not count');
});
