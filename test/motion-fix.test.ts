// studio-motion-fix (decided 2026-11-05): the small fixes of a first-time walk of the rule layouts and motions, without
// a browser — the step that folds the lines before it (△1), a drag at the object's scale and its end said (△2), the
// time tags of many points (△5), the ask chip that says what (△10).
//   node --experimental-strip-types --no-warnings --test test/motion-fix.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UndoStack } from '../src/shell/undo.ts';
import { nearScale } from '../src/bridge/code-place.ts';
import { chipFamily } from '../src/shell/placement-panel.ts';
import type { Pose } from '../src/contract.ts';

test('△1: every step recorded is told (the shell folds the lines about the step before); grouped AI steps say so', () => {
  const u = new UndoStack();
  const told: boolean[] = [];
  u.onPush = (g) => void told.push(g);
  u.push({ changes: [{ kind: 'pose', key: 'a', from: { p: [0, 0, 0] }, to: { p: [1, 0, 0] } }] } as never);
  u.push({ changes: [{ kind: 'pose', key: 'a', from: { p: [1, 0, 0] }, to: { p: [1, 0, 0] } }] } as never);
  u.begin();
  u.push({ changes: [{ kind: 'pose', key: 'b', from: { p: [0, 0, 0] }, to: { p: [2, 0, 0] } }] } as never);
  u.end('x');
  assert.deepEqual(told, [false, true], 'a step that changed nothing is not told');
});

test('△2: a knob drag reads the finger at the object\'s scale — never further than the ground under it', () => {
  // A camera looking down the road: 1 m at z = -10 is 10 px, at z = -2 it is 40 px (a stand-in projection).
  const toScreen = (p: number[]): [number, number] => [640 + p[0]! * 400 / -(p[2]! - 30), 400 - 4000 / -(p[2]! - 30)];
  const start: Pose = { p: [0, 0, -10] };
  // Away from the camera: the ground under the finger runs off fast; at the object's scale it goes less far.
  const far = nearScale({ toScreen }, start, { p: [0, 0, -30] }, 3);
  assert.ok(far.p[2]! > -30 && far.p[2]! < -10, `away: ${far.p[2]}`);
  // Toward the camera: the ground under the finger is the closer, and kept.
  const near = nearScale({ toScreen }, start, { p: [0, 0, -6] }, 3);
  assert.deepEqual(near.p, [0, 0, -6]);
  // 2D, or an adapter that cannot say where a point is: unchanged.
  assert.deepEqual(nearScale({}, start, { p: [0, 0, -30] }, 3).p, [0, 0, -30]);
  assert.deepEqual(nearScale({ toScreen }, { p: [0, 0] }, { p: [5, 5] }, 2).p, [5, 5]);
});

test('△2: the chip says when the knob stopped at its end', async () => {
  const { PLACE_WORDS } = await import('../src/bridge/code-place.ts');
  assert.equal(PLACE_WORDS.en.lo, ' · smallest');
  assert.equal(PLACE_WORDS.en.hi, ' · largest');
  assert.ok(PLACE_WORDS.ja.lo && PLACE_WORDS.ja.hi);
});

test('△10: several of one kind read "lamp ×6"; a mix reads "6 objects"', async () => {
  const { translate } = await import('../src/shell/i18n.ts');
  assert.equal(chipFamily(['lamp-1', 'lamp-2', 'lamp-6']), 'lamp');
  assert.equal(chipFamily(['Street lamps 2', 'Street lamps 10']), 'Street lamps');
  assert.equal(chipFamily(['lamp-1', 'gate']), null);
  assert.equal(translate('en', 'ask.chipNamed', { name: 'lamp', n: 6 }), 'lamp ×6');
  assert.equal(translate('en', 'ask.chipN', { n: 6 }), '6 objects');
  assert.equal(translate('ja', 'ask.chipN', { n: 6 }), '6 個');
});
