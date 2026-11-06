// A first-run walk of v0.1.82 (decided 2026-11-06): the scene fixes that can be read without a browser — what a moved
// object overlaps (adapters/three/overlap.js), Esc while playing (bridge/play-pause.ts isLeaveKey) and the new words.
// The turn drag has its own file (turn-drag.test.ts); the note over the field is in motion-next-2.test.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { overlapKeys, BIG } from '../src/adapters/three/overlap.js';
import { isLeaveKey, isPauseKey } from '../src/bridge/play-pause.ts';
import { translate } from '../src/shell/i18n.ts';
import { READOUT_WORDS } from '../src/bridge/handles.ts';

const box = (x: number, y: number, z: number, w: number, h = w, d = w) => ({ min: [x, y, z], max: [x + w, y + h, z + d] });

test('overlap: a rock pushed into the arch counts; one that only touches, or stands on the pier, does not', () => {
  const rock = box(0, 0, 0, 2, 4, 2);
  const arch = box(1, 0, 0, 4, 6, 3); // half the rock inside it
  const beside = box(2, 0, 0, 2, 4, 2); // side by side, faces touching
  const pier = box(-3, -1, -1, 8, 1, 4); // under the rock's foot, as wide as it
  assert.deepEqual(overlapKeys(rock, [{ key: 'arch', box: arch }, { key: 'crate', box: beside }, { key: 'pier', box: pier }]), ['arch']);
});

test('overlap: an island many times its size is ground to it; no box, nothing', () => {
  const rock = box(0, 0, 0, 1);
  const island = box(-10, -2, -10, 20, 3, 20);
  assert.ok((20 * 20) / 1 >= BIG);
  assert.deepEqual(overlapKeys(rock, [{ key: 'island', box: island }, { key: 'ghost', box: null }]), []);
  assert.deepEqual(overlapKeys(null, [{ key: 'island', box: island }]), []);
});

test('overlap: a tall arch much bigger than the rock still counts (its floor is not many times the rock\'s)', () => {
  // Lantern Cove: sea-stack-small (4.4 × 10 × 4.4 m) dragged under the sea arch (~18 × 18.5 × 9 m): ~15× the volume.
  const rock = box(-2.2, -4, -2.2, 4.4, 10, 4.4);
  const arch = box(-9, -6, -4.5, 18, 18.5, 9);
  assert.deepEqual(overlapKeys(rock, [{ key: 'sea-arch', box: arch }]), ['sea-arch']);
});

test('overlap: the most overlapped first, three at most', () => {
  const me = box(0, 0, 0, 4);
  const others = [0.5, 1, 1.5, 2].map((x, i) => ({ key: `o${i}`, box: box(x, 0, 0, 4) }));
  assert.deepEqual(overlapKeys(me, others), ['o0', 'o1', 'o2']);
});

test('Esc while playing: plain Esc only — not with a modifier, held down, typing or composing; P stays pause', () => {
  assert.equal(isLeaveKey({ key: 'Escape' }, false), true);
  assert.equal(isLeaveKey({ key: 'Escape' }, true), false, 'the game\'s own text field keeps its Esc');
  assert.equal(isLeaveKey({ key: 'Escape', repeat: true }, false), false);
  for (const m of ['ctrlKey', 'metaKey', 'altKey', 'shiftKey', 'isComposing']) assert.equal(isLeaveKey({ key: 'Escape', [m]: true }, false), false, m);
  assert.equal(isLeaveKey({ key: 'p' }, false), false);
  assert.equal(isPauseKey({ key: 'Escape' }, false), false);
});

test('the new words, English and Japanese', () => {
  for (const k of ['tl.when.noMotion', 'play.escGame']) {
    for (const lang of ['en', 'ja'] as const) assert.notEqual(translate(lang, k), k, `${lang} ${k}`);
    assert.notEqual(translate('ja', k), translate('en', k), `ja ${k} is its own`);
  }
  // The line no longer promises a motion from a plain move (the walk's ✕2).
  assert.doesNotMatch(translate('en', 'tl.when.noMotion'), /makes its motion/);
  assert.equal(READOUT_WORDS.en.inside.replace('{name}', 'sea-arch'), 'In sea-arch');
  assert.match(READOUT_WORDS.ja.inside, /\{name\}/);
});
