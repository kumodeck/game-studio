// The AI's marks after its reload (shell/ai-marks.ts; decided 2026-11-05): what the game moves by itself and a write-back
// measured as the same look are not "moved by the AI"; the tag names the AI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aiMarksLabel, aiMarksOf } from '../src/shell/ai-marks.ts';
import { setAiName, translate } from '../src/shell/i18n.ts';
import type { Item, Pose } from '../src/contract.ts';

const pose = (p: number[], r = 0): Pose => ({ p, r, s: 1 });
const item = (key: string, p: number[], extra: Partial<Item> = {}): Item => ({ key, label: key, kinds: ['mesh'], rotatable: true, scalable: true, pose: pose(p), ...extra });

test('a ring the game spins and an orb it pulses are not "moved" after a Save the AI wrote into the code', () => {
  const before = new Map([['ring', pose([0, 1, -8], 0.4)], ['orb', { p: [0, 2, -12], r: 0, s: 1.1 }], ['gate', pose([0, 0, -4])]]);
  const items = [item('ring', [0, 1, -8], { held: 'game' }), { ...item('orb', [0, 2, -12]), pose: { p: [0, 2, -12], r: 0, s: 0.9 } }, item('gate', [0, 0, -4])];
  items[0]!.pose.r = 1.2;
  const r = aiMarksOf({ before, beforeCode: null, items, dim: '3d', heldBefore: new Set(['orb']) });
  assert.equal(r.marks.size, 0);
});

test('a layout written back with the same look is not marked; one the AI really moved is', () => {
  const before = new Map([['hex-1', pose([0, 0, -4])], ['hex-2', pose([0, 0, -8.6])], ['gate', pose([3, 0, 0])]]);
  const items = [item('hex-1', [0, 0, -4.004]), item('hex-2', [0, 0, -8.6]), item('gate', [5, 0, 0])];
  const r = aiMarksOf({ before, beforeCode: null, items, dim: '3d', sameLook: new Set(['hex-1', 'hex-2']) });
  assert.deepEqual([...r.marks.entries()], [['gate', 'moved']]);
});

test('new objects are still "added", even next to what the game moves', () => {
  const before = new Map([['ring', pose([0, 1, -8])]]);
  const r = aiMarksOf({ before, beforeCode: null, items: [item('ring', [0, 1, -9], { held: 'game' }), item('lighthouse', [4, 0, 0])], dim: '3d' });
  assert.deepEqual([...r.marks.entries()], [['lighthouse', 'added']]);
});

test('an unsaved move of the person shown at its code pose is not the AI moving it', () => {
  const before = new Map([['crate', pose([2, 0, 0])]]);
  const r = aiMarksOf({ before, beforeCode: new Map([['crate', pose([0, 0, 0])]]), items: [item('crate', [0, 0, 0])], dim: '3d' });
  assert.equal(r.marks.size, 0);
});

test('the tag says the AI\'s name, like the other lines', () => {
  setAiName('claude');
  const t = (k: string, v?: Record<string, string | number>) => translate('en', k, v);
  assert.equal(aiMarksLabel(new Map([['a', 'moved'], ['b', 'moved']]), t), 'Claude moved 2');
  assert.equal(aiMarksLabel(new Map([['a', 'added']]), t), 'Claude added 1');
  assert.equal(aiMarksLabel(new Map(), t), undefined);
  assert.equal(aiMarksLabel(new Map([['a', 'added']]), (k, v) => translate('ja', k, v)), 'Claude が足した 1 個');
  setAiName('any');
  assert.equal(aiMarksLabel(new Map([['a', 'added'], ['b', 'moved']]), t), 'Your AI changed 2');
});
