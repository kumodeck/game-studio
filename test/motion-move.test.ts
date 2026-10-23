// Making a motion on what the game moves (studio-motion-move, 2026-10-23; a try of v0.1.34 on NEON DASH: "I try to make a
// motion, but moving is limited?"). While a motion is recorded (studio:timeline/recording) a thing the game moves takes
// every tool as a point of the motion (hold.ts `meets`), and the line by the strip says the two motions add up when
// played (handles.ts gameNote). The real editor on test/neon-run: test/studio-motion-move.browser.mjs.
// Run: node --experimental-strip-types --no-warnings --test test/motion-move.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Item, Pose, StudioAdapter } from '../src/contract.ts';
import { createHoldState, holdItem, offWhy, withHold } from '../src/bridge/hold.ts';
import { gameNote } from '../src/bridge/handles.ts';

const item = (key: string, extra: Partial<Item> = {}): Item => ({ key, label: key, kinds: ['mesh'], rotatable: true, scalable: true, pose: { p: [0, 0, 0], r: 0, s: 1 }, ...extra });

test('holdItem while recording: what the game slides / turns takes every tool, no start spot, `meets` set', () => {
  const s = createHoldState();
  s.driven.set('pillar', { move: true, lift: false, turn: false, size: false });
  s.driven.set('ring', { move: false, lift: false, turn: true, size: false });
  const idle = holdItem(item('ring'), s, '3d');
  assert.equal(idle.rotatable, false);
  assert.equal(offWhy(idle, 'rotate'), 'game');
  assert.equal(holdItem(item('pillar'), s, '3d').startSpot, true);
  s.recording = true;
  for (const k of ['pillar', 'ring']) {
    const it = holdItem(item(k), s, '3d');
    assert.equal(it.held, 'game');
    assert.equal(it.meets, true);
    assert.equal(it.startSpot, undefined);
    for (const tool of ['move', 'lift', 'rotate', 'scale'] as const) assert.equal(offWhy(it, tool), null, `${k} ${tool}`);
  }
  // A rule's lock stays a lock (recording does not undo .studio/studio.json).
  assert.equal(holdItem(item('pillar', { movable: false }), s, '3d').movable, false);
  // Nothing the game moves: as it was.
  assert.deepEqual(holdItem(item('ship'), s, '3d'), item('ship'));
});

test('withHold while recording: a turn of the ring the game turns reaches the adapter', () => {
  const s = createHoldState();
  s.driven.set('ring', { move: false, lift: false, turn: true, size: false });
  let turned = 0;
  const pose: Pose = { p: [0, 0, 0], r: 0, s: 1 };
  const inner = { dim: '3d', list: () => [item('ring')], begin: () => [item('ring')], anchor: () => ({ pose, center: [0, 0] }),
    rotate: (_k: string, d: number) => ((turned += d), pose) } as unknown as StudioAdapter;
  const a = withHold(inner, s);
  a.list();
  a.rotate('ring', 0.5);
  assert.equal(turned, 0);
  s.recording = true;
  a.list();
  a.rotate('ring', 0.5);
  assert.equal(turned, 0.5);
});

test('gameNote while recording: the game moves it too, and the two add up when played — never "sets where it starts"', () => {
  assert.equal(gameNote('ja', ['move'], true), 'この物はゲームも動かしています。遊ぶと、ゲームの動きと重なります。');
  assert.equal(gameNote('ja', ['turn'], true), 'この物はゲームも回しています。遊ぶと、ゲームの動きと重なります。');
  assert.equal(gameNote('en', ['move'], true), 'Your game moves this too. When you play, its motion and this one add up.');
  assert.equal(gameNote('en', ['lift', 'turn', 'size'], true), 'Your game moves, turns and resizes this too. When you play, its motion and this one add up.');
  assert.equal(gameNote('en', [], true), '');
  for (const lang of ['ja', 'en'] as const) assert.doesNotMatch(gameNote(lang, ['move'], true), /スタート位置|where it starts/);
});
