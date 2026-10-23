// studio-fix-0142 (2026-10-24): what the fourth hands-on check of the editor left, the parts that can be checked
// without a browser. ⑫ (a nudge with the plate open made a motion) is in timeline.test.ts and timeline-line.test.ts;
// the screen parts (⑬ ⑮ J1 ① ④) were checked in a headless browser with the hands-on walk.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sharedMotion, type Change } from '../src/shell/undo.ts';
import { translate } from '../src/shell/i18n.ts';

const scene = (name: string) => ({ clips: [{ name, use: name, scene: true, len: 1, repeat: 'once' as const, keys: {} }] });

test('⑭ a linked motion changed on two objects is named by the motion, not "2 objects’s motion"', () => {
  const changes: Change[] = [
    { kind: 'motion-lib', key: 'gate’s motion', from: null, to: null },
    { kind: 'motion', key: 'gate', from: scene('gate’s motion'), to: scene('gate’s motion') },
    { kind: 'motion', key: 'ship', from: scene('gate’s motion'), to: scene('gate’s motion') },
  ];
  assert.equal(sharedMotion(changes), 'gate’s motion');
  // Two objects with motions of their own: nothing shared.
  assert.equal(sharedMotion([
    { kind: 'motion', key: 'gate', from: null, to: { clips: [{ name: 'A', len: 1, repeat: 'once', keys: {} }] } },
    { kind: 'motion', key: 'ship', from: null, to: { clips: [{ name: 'B', len: 1, repeat: 'once', keys: {} }] } },
  ]), null);
  const en = (k: string, v: Record<string, string | number>) => translate('en', k, v);
  const ja = (k: string, v: Record<string, string | number>) => translate('ja', k, v);
  assert.equal(en('undo.motionNamed', { name: 'gate’s motion' }), 'change gate’s motion');
  assert.equal(ja('undo.motionNamed', { name: 'gate の動き' }), 'gate の動きを変更');
  assert.equal(en('undo.motionN', { n: 2 }), 'change the motion of 2 objects');
  assert.equal(ja('undo.motionN', { n: 2 }), '2 個の動きを変更');
});
