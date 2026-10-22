// The chat box's motion (studio-motion-panel, src/shell/motion-ask.ts): what "Ask AI" on a motion remembers, and when it lets go.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMotionAsk } from '../src/shell/motion-ask.ts';

test('a motion asked about stays while the same object shows it', () => {
  let picked: string | null = 'crate';
  const shown = new Map([['crate', 'Hop']]);
  const ask = createMotionAsk({ picked: () => picked, shown: (k) => shown.get(k) ?? null });
  assert.equal(ask.now(), null);
  ask.set('crate', { name: 'Hop', use: 'Hop' });
  assert.deepEqual(ask.now(), { key: 'crate', name: 'Hop', use: 'Hop' });
  // After a send nothing changes: the next words are about it too ("slower").
  assert.equal(ask.now()?.name, 'Hop');
  picked = 'tree';
  assert.equal(ask.now(), null, 'another object picked: the chip forgets the motion');
  picked = 'crate';
  assert.equal(ask.now(), null, 'and does not come back by itself');
});

test('the plate switched to another motion: the chip lets go', () => {
  const shown = new Map([['crate', 'Hop']]);
  const ask = createMotionAsk({ picked: () => 'crate', shown: (k) => shown.get(k) ?? null });
  ask.set('crate', { name: 'Hop', use: 'Hop' });
  shown.set('crate', 'Spin');
  assert.equal(ask.now(), null);
  ask.set('crate', { name: 'Spin', use: 'Spin' });
  ask.clear();
  assert.equal(ask.now(), null);
});
