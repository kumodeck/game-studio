// The AI's question answered in the editor (src/shell/ai-ask.ts, hands-on test 2026-10-19): what the line
// shows under the question — its answers, the objects it is about, and now → after. No browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { askView, poseChange } from '../src/shell/ai-ask.ts';
import type { StudioStatus } from '../src/contract.ts';

const words = { turn: 'turn', size: 'size' };

test('poseChange: only what differs, position first; nothing differs = null', () => {
  // A road lifted 16 m by a stray drag (the hands-on test).
  assert.deepEqual(poseChange({ p: [0, 0, -40] }, { p: [0, 16, -40] }, '3d', words), { before: 'y 0', after: 'y 16' });
  assert.deepEqual(poseChange({ p: [2, 0, -10], r: 0 }, { p: [3.5, 0, -10], r: Math.PI / 2, s: 2 }, '3d', words),
    { before: 'x 2 · turn 0° · size 1×', after: 'x 3.5 · turn 90° · size 2×' });
  assert.equal(poseChange({ p: [1, 2, 3] }, { p: [1.001, 2, 3] }, '3d', words), null, 'rounding is not a change');
  assert.equal(poseChange(undefined, { p: [1, 2] }, '2d', words), null);
  assert.deepEqual(poseChange({ p: [10, 20] }, { p: [10, 80] }, '2d', words), { before: 'y 20', after: 'y 80' });
});

test('askView: the AI\'s own now → after wins; else the one object it named, from the editor', () => {
  const st = (o: Partial<StudioStatus>): StudioStatus => ({ version: 1, state: 'asking', note: 'Keep your spot anyway?', ...o });
  const poses = (k: string) => (k === 'pillar' ? { was: { p: [0, 0, -10] }, now: { p: [0, 0, -4] } } : {});
  assert.equal(askView(st({ state: 'working' }), poses, '3d', words), null, 'only a question');
  const own = askView(st({ about: ['pillar'], before: 'Moved by the game', after: 'Stays where you put it' }), poses, '3d', words)!;
  assert.deepEqual(own.compare, { before: 'Moved by the game', after: 'Stays where you put it' });
  const fromEditor = askView(st({ about: ['pillar'], choices: ['Undo it', 'Keep it'] }), poses, '3d', words)!;
  assert.deepEqual(fromEditor, { question: 'Keep your spot anyway?', choices: ['Undo it', 'Keep it'], about: ['pillar'], compare: { before: 'z -10', after: 'z -4' } });
  // Two objects: which one would the two lines be about? None shown (they are lit in the scene).
  assert.equal(askView(st({ about: ['pillar', 'road'] }), poses, '3d', words)!.compare, null);
  // A bare question still shows, with no buttons: the ask field answers it.
  assert.deepEqual(askView(st({}), poses, '3d', words), { question: 'Keep your spot anyway?', choices: [], about: [], compare: null });
});
