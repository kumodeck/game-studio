// Play after an AI change keeps the unsaved moves (a try of the editor, 2026-10-21, v0.1.7: "after asking the AI, Play showed
// only the AI's change; the objects I had moved were back, while the editor still showed them moved"), without a browser:
// what PlacementModel.notShown() does with a NEW page whose code the AI changed, and what the draft then tells Play
// (arrangeInPlay). The screen test is test/studio-play-after-ai.browser.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PlacementModel } from '../src/shell/placement-model.ts';
import { arrangeInPlay } from '../src/bridge/play-arrange.ts';
import type { Item, Pose, StudioAdapter } from '../src/contract.ts';

const item = (key: string, p: number[]): Item => ({ key, label: key, kinds: ['mesh'], rotatable: true, scalable: true, pose: { p, r: 0, s: 1 } });

/** One page of the game: the adapter Play's bridge sees (moves only). */
function page(start: Record<string, number[]>) {
  const poses = new Map(Object.entries(start).map(([k, p]) => [k, { p: p.slice(), r: 0, s: 1 } as Pose]));
  const a = {
    list: () => [...poses.entries()].map(([k, p]) => item(k, p.p)),
    setPose: (k: string, p: Pose) => (poses.has(k) ? (poses.set(k, { ...poses.get(k)!, ...p }), poses.get(k)!) : null),
  } as unknown as StudioAdapter;
  return { a, at: (k: string) => poses.get(k)!.p };
}

test('the AI changed another object: Play still shows the move (a game without the loader)', () => {
  const m = new PlacementModel();
  m.setItems([item('lighthouse', [-24, 0, -20]), item('boat', [5, 0, 5])], '3d');
  m.moved('lighthouse', { p: [-18, 0, -20], r: 0, s: 1 });
  // The AI's reload: the code is new (the boat's colour), the lighthouse at its code's place.
  const after = [item('lighthouse', [-24, 0, -20]), item('boat', [5, 0, 5])];
  const lost = m.notShown(after);
  assert.deepEqual(lost.poses.map((x) => x.key), ['lighthouse']);
  m.setItems(after, '3d');
  // Play: a third page, at the code's layout again, with the draft the editor writes before it.
  const play = page({ lighthouse: [-24, 0, -20], boat: [5, 0, 5] });
  assert.equal(arrangeInPlay(play.a, m.result() as never), 1);
  assert.deepEqual(play.at('lighthouse'), [-18, 0, -20]);
  assert.equal(m.dirty(), 1);
});

test('the AI moved the SAME object in the code: the person\'s move wins, and `was` is the new code\'s pose', () => {
  const m = new PlacementModel();
  m.setItems([item('lighthouse', [-24, 0, -20])], '3d');
  m.moved('lighthouse', { p: [-18, 0, -20], r: 0, s: 1 });
  const after = [item('lighthouse', [-24, 0, -12])];
  const lost = m.notShown(after);
  assert.deepEqual(lost.poses, [{ key: 'lighthouse', pose: { p: [-18, 0, -20], r: 0, s: 1, z: undefined } }]);
  assert.deepEqual(lost.code, ['lighthouse'], 'named as moved by the code (the AI\'s mark)');
  m.setItems(after, '3d');
  // Save tells the AI where the code has it now, so it can find it.
  const e = m.result().objects.lighthouse!;
  assert.deepEqual([e.p, e.was?.p], [[-18, 0, -20], [-24, 0, -12]]);
  assert.equal(m.original('lighthouse')!.p[2], -12, '⌘Z on the move goes to the AI\'s place');
  assert.equal(m.dirty(), 1);
  // Play: the page shows the new code's place = the draft's `was`: the move is put on it.
  const play = page({ lighthouse: [-24, 0, -12] });
  arrangeInPlay(play.a, m.result() as never);
  assert.deepEqual(play.at('lighthouse'), [-18, 0, -20]);
});

test('the AI moved an object the person did not touch: the AI\'s place, nothing to save', () => {
  const m = new PlacementModel();
  m.setItems([item('rock', [0, 0, 0]), item('lighthouse', [-24, 0, -20])], '3d');
  m.moved('lighthouse', { p: [-18, 0, -20], r: 0, s: 1 });
  const after = [item('rock', [3, 0, 0]), item('lighthouse', [-24, 0, -20])];
  const lost = m.notShown(after);
  assert.deepEqual(lost.poses.map((x) => x.key), ['lighthouse']);
  assert.deepEqual(lost.code, ['rock']);
  m.setItems(after, '3d');
  assert.deepEqual(m.pose('rock')!.p, [3, 0, 0], 'the card shows where the game has it');
  assert.equal(m.dirty(), 1, 'only the person\'s move counts');
  assert.equal(m.result().objects.rock, undefined);
});

test('a loader game already shows the move: nothing pushed, nothing named as the AI\'s', () => {
  const m = new PlacementModel();
  m.setItems([item('lighthouse', [-24, 0, -20])], '3d');
  m.moved('lighthouse', { p: [-18, 0, -20], r: 0, s: 1 });
  const lost = m.notShown([item('lighthouse', [-18, 0, -20])]);
  assert.deepEqual([lost.poses, lost.code], [[], []]);
  assert.equal(m.original('lighthouse')!.p[0], -24);
});

test('a saved move the code does not have yet, after the AI moved that object elsewhere: still the saved one', () => {
  const m = new PlacementModel();
  m.setItems([item('lighthouse', [-24, 0, -20])], '3d');
  m.moved('lighthouse', { p: [-18, 0, -20], r: 0, s: 1 });
  m.markSaved();
  const lost = m.notShown([item('lighthouse', [-30, 0, -20])]);
  assert.deepEqual(lost.poses.map((x) => x.pose.p), [[-18, 0, -20]]);
  m.setItems([item('lighthouse', [-30, 0, -20])], '3d');
  assert.equal(m.dirty(), 0, 'nothing new to save: the save already holds it');
});

test('the AI put the person\'s move into the code: nothing pushed, the move is the code\'s now', () => {
  const m = new PlacementModel();
  m.setItems([item('lighthouse', [-24, 0, -20])], '3d');
  m.moved('lighthouse', { p: [-18, 0, -20], r: 0, s: 1 });
  const lost = m.notShown([item('lighthouse', [-18, 0, -20])]);
  assert.deepEqual(lost.poses, []);
});

test('the AI made the moved object bigger: the person\'s place and the AI\'s size', () => {
  const m = new PlacementModel();
  m.setItems([item('lighthouse', [-24, 0, -20])], '3d');
  m.moved('lighthouse', { p: [-18, 0, -20], r: 0, s: 1 });
  const big = { ...item('lighthouse', [-24, 0, -20]), pose: { p: [-24, 0, -20], r: 0, s: 1.5 } };
  const lost = m.notShown([big]);
  assert.deepEqual(lost.poses, [{ key: 'lighthouse', pose: { p: [-18, 0, -20], r: 0, s: 1.5, z: undefined } }]);
  assert.deepEqual(lost.code, ['lighthouse']);
});

test('an object without a name (a path key) the code now shows elsewhere: left alone (another object may have its key now)', () => {
  const m = new PlacementModel();
  const u = (k: string, p: number[]): Item => ({ ...item(k, p), unstable: true });
  m.setItems([u('path:8', [1, 0, 0])], '3d');
  m.moved('path:8', { p: [2, 0, 0], r: 0, s: 1 });
  const lost = m.notShown([u('path:8', [9, 0, 9])]);
  assert.deepEqual([lost.poses, lost.code], [[], []]);
  assert.equal(m.original('path:8')!.p[0], 1);
});
