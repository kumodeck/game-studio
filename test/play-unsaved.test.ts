// Play without Save keeps the unsaved changes (a try of the editor, 2026-10-21), without a browser:
//   - PlacementModel.notShown(): what a NEW page of the game (Play → Edit, the AI's reload) does not show
//   - arrangeInPlay(): the editor's draft put on the page while playing (bridge/play-arrange.ts)
// The screen test with real games is test/studio-play-unsaved.browser.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PlacementModel } from '../src/shell/placement-model.ts';
import { arrangeInPlay } from '../src/bridge/play-arrange.ts';
import type { Item, Pose, StudioAdapter } from '../src/contract.ts';

const item = (key: string, p: number[], extra: Partial<Item> = {}): Item => ({
  key, label: key, kinds: ['mesh'], rotatable: true, scalable: true, pose: { p, r: 0, s: 1 }, ...extra,
});

test('notShown: a page at the code\'s layout gets the moves back, saved or not', () => {
  const m = new PlacementModel();
  m.setItems([item('lighthouse', [-24, 0, -20]), item('rock', [0, 0, 0])], '3d');
  m.moved('lighthouse', { p: [-18, 0, -20], r: 0, s: 1 });
  // Play → Edit on a game that does not read placement.json: the code's layout again.
  const lost = m.notShown([item('lighthouse', [-24, 0, -20]), item('rock', [0, 0, 0])]);
  assert.deepEqual(lost.poses, [{ key: 'lighthouse', pose: { p: [-18, 0, -20], r: 0, s: 1, z: undefined } }]);
  assert.deepEqual(lost.copies, []);
  assert.deepEqual(lost.removes, []);
  // The count stays: nothing was saved.
  m.setItems([item('lighthouse', [-24, 0, -20]), item('rock', [0, 0, 0])], '3d');
  assert.equal(m.dirty(), 1);
});

test('notShown: a page that already shows the move (its loader read the draft) gets nothing', () => {
  const m = new PlacementModel();
  m.setItems([item('lighthouse', [-24, 0, -20])], '3d');
  m.moved('lighthouse', { p: [-18, 0, -20], r: 0, s: 1 });
  assert.deepEqual(m.notShown([item('lighthouse', [-18, 0, -20])]).poses, []);
});

test('notShown: an object the AI moved in the code is the AI\'s (not pushed back)', () => {
  const m = new PlacementModel();
  m.setItems([item('boat', [0, 0, 0])], '3d');
  m.moved('boat', { p: [4, 0, 0], r: 0, s: 1 });
  // The AI's reload: the code now puts the boat at 7 (neither the old code's 0 nor the editor's 4).
  assert.deepEqual(m.notShown([item('boat', [7, 0, 0])]).poses, []);
});

test('notShown: copies the page lacks and deletions it still shows', () => {
  const m = new PlacementModel();
  m.setItems([item('lantern', [10, 10]), item('banner', [50, 50])], '2d');
  m.addCopy('lantern-2', 'lantern', { p: [30, 10], r: 0, s: 1 });
  m.remove('banner');
  const lost = m.notShown([item('lantern', [10, 10]), item('banner', [50, 50])]);
  assert.deepEqual(lost.copies, [{ key: 'lantern-2', from: 'lantern', pose: { p: [30, 10], r: 0, s: 1, z: undefined } }]);
  assert.deepEqual(lost.removes, ['banner']);
  // A page that has them (its loader made the copy and hid the deletion): nothing.
  const none = m.notShown([item('lantern', [10, 10]), item('lantern-2', [30, 10], { copyOf: 'lantern' })]);
  assert.deepEqual([none.copies, none.removes], [[], []]);
});

test('notShown: the first list after opening is setItems\' own (nothing here)', () => {
  const m = new PlacementModel();
  const lost = m.notShown([item('a', [0, 0])]);
  assert.deepEqual(lost, { poses: [], copies: [], removes: [] });
});

test('notShown: a reordered list shown in the code\'s order again', () => {
  const m = new PlacementModel();
  const z = (key: string, zz: number) => ({ ...item(key, [0, 0], { layer: 'stage' }), pose: { p: [0, 0], r: 0, s: 1, z: zz } });
  m.setItems([z('a', 0), z('b', 1), z('c', 2)], '2d');
  // a to the front.
  m.moved('a', { p: [0, 0], r: 0, s: 1, z: 2 });
  m.moved('b', { p: [0, 0], r: 0, s: 1, z: 0 });
  m.moved('c', { p: [0, 0], r: 0, s: 1, z: 1 });
  const lost = m.notShown([z('a', 0), z('b', 1), z('c', 2)]);
  const zs = Object.fromEntries(lost.poses.map((x) => [x.key, x.pose.z]));
  assert.deepEqual(zs, { b: 0, c: 1, a: 2 });
});

/** A small adapter over a map of poses, with copy and delete. */
function fakeAdapter(start: Record<string, Pose>, layer?: string) {
  const poses = new Map(Object.entries(start).map(([k, p]) => [k, structuredClone(p)]));
  const gone = new Set<string>();
  const set: string[] = [];
  const a = {
    list: () => [...poses.entries()].filter(([k]) => !gone.has(k)).map(([k, p]) => item(k, p.p, { pose: structuredClone(p), ...(layer ? { layer } : {}) })),
    setPose: (k: string, p: Pose) => {
      if (!poses.has(k)) return null;
      set.push(k);
      poses.set(k, { ...poses.get(k)!, ...p });
      return poses.get(k)!;
    },
    clone: (from: string, k: string) => (poses.set(k, structuredClone(poses.get(from)!)), true),
    remove: (k: string) => (gone.add(k), true),
  } as unknown as StudioAdapter;
  return { a, poses, gone, set };
}

test('arrangeInPlay: moves an object that stands where its code puts it', () => {
  const f = fakeAdapter({ lighthouse: { p: [-24, 0, -20], r: 0, s: 1 }, rock: { p: [1, 0, 0], r: 0, s: 1 } });
  const n = arrangeInPlay(f.a, { dim: '3d', objects: { lighthouse: { p: [-18, 0, -20], r: 0, s: 1, was: { p: [-24, 0, -20], r: 0, s: 1 } } } });
  assert.equal(n, 1);
  assert.deepEqual(f.poses.get('lighthouse')!.p, [-18, 0, -20]);
  assert.deepEqual(f.poses.get('rock')!.p, [1, 0, 0]);
});

test('arrangeInPlay: twice is once (a game whose loader read the same draft)', () => {
  const f = fakeAdapter({ lighthouse: { p: [-18, 0, -20], r: 0, s: 1 } });
  const file = { dim: '3d', objects: { lighthouse: { p: [-18, 0, -20], r: 0, s: 1, was: { p: [-24, 0, -20], r: 0, s: 1 } } } };
  assert.equal(arrangeInPlay(f.a, file), 0);
  assert.deepEqual(f.set, []);
});

test('arrangeInPlay: an object the game moved itself (physics, the waves) is left alone', () => {
  const f = fakeAdapter({ crate: { p: [0, -3, 0], r: 0, s: 1 } });
  arrangeInPlay(f.a, { dim: '3d', objects: { crate: { p: [5, 2, 0], was: { p: [0, 2, 0] } } } });
  assert.deepEqual(f.poses.get('crate')!.p, [0, -3, 0]);
});

test('arrangeInPlay: copies and deletions, as before', () => {
  const f = fakeAdapter({ lantern: { p: [10, 10], r: 0, s: 1 }, banner: { p: [50, 50], r: 0, s: 1 } });
  const n = arrangeInPlay(f.a, { dim: '2d', objects: {}, added: [{ key: 'lantern-2', from: 'lantern', p: [30, 10] }], removed: [{ key: 'banner', was: { p: [50, 50] } }] });
  assert.equal(n, 2);
  assert.deepEqual(f.poses.get('lantern-2')!.p, [30, 10]);
  assert.ok(f.gone.has('banner'));
});

test('arrangeInPlay: a list still in the code\'s order gets the editor\'s', () => {
  const f = fakeAdapter({ a: { p: [0, 0], z: 0 }, b: { p: [0, 0], z: 1 }, c: { p: [0, 0], z: 2 } }, 'stage');
  arrangeInPlay(f.a, { dim: '2d', objects: {}, order: [{ in: 'stage', keys: ['b', 'c', 'a'], was: ['a', 'b', 'c'] }] });
  assert.deepEqual(['a', 'b', 'c'].map((k) => f.poses.get(k)!.z), [2, 0, 1]);
});

test('arrangeInPlay: a broken file changes nothing', () => {
  const f = fakeAdapter({ a: { p: [0, 0, 0] } });
  for (const bad of [null, { objects: { a: { p: 'x', was: { p: [0, 0, 0] } } } }, { objects: { a: { p: [1, 2, 3] } } }, { added: [{ key: 1 }] }]) {
    assert.equal(arrangeInPlay(f.a, bad as never), 0);
  }
  assert.deepEqual(f.poses.get('a')!.p, [0, 0, 0]);
});
