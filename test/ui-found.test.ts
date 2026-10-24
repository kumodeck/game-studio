// The game's UI the editor sees but cannot select yet (studio-canvas-ui stage 2, 2026-10-24; bridge/ui-found.ts,
// CONTRACT.md §1.13 "Not delivered yet"): the pure parts — the lumps of a HUD canvas's drawing, the boxes that are one
// thing, the 9 places a press is named by — the request of ✦ "Make this UI editable" (intent ui-code: the place pressed,
// the frames, the picture; schema/handoff.mjs) and its `studio:` line for the AI (ai-watch.mjs).
// The game page and the editor (frames, the cross, the line, the chip, Scene | UI, one canvas = nothing) are
// test/studio-canvas-ui.browser.mjs --only missing.
// Run: node --experimental-strip-types --no-warnings --test test/ui-found.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { lumps, mergeRects, placeOf } from '../src/bridge/ui-found.ts';
import { normalizeRequestInput } from '../src/schema/handoff.mjs';
import { handoffLine } from '../src/server/ai-watch.mjs';

/** A grid from rows of '#' (drawn) and '.' (not). */
const grid = (rows: string[]) => ({ g: Uint8Array.from(rows.join('').split('').map((c) => (c === '#' ? 1 : 0))), w: rows[0]!.length, h: rows.length });

test('lumps: 8-neighbour drawn cells are one lump, apart cells are not', () => {
  const { g, w, h } = grid([
    '##....#',
    '.#....#',
    '..#....',
    '.......',
    '###..#.',
  ]);
  const boxes = lumps(g, w, h).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  // The diagonal chain top left is one lump; the right column one; the bottom bar one; the lone cell one.
  assert.deepEqual(boxes, [[0, 0, 3, 3], [6, 0, 7, 2], [0, 4, 3, 5], [5, 4, 6, 5]]);
});

test('lumps: nothing drawn, nothing found', () => {
  const { g, w, h } = grid(['....', '....']);
  assert.deepEqual(lumps(g, w, h), []);
});

test('mergeRects: touching boxes join; words on one line join; a box 12 px under another stays apart', () => {
  // "SCORE" and "12,480" without a box behind them: two lumps 10 px apart on one line → one.
  const words = mergeRects([{ x: 20, y: 20, w: 80, h: 24 }, { x: 110, y: 22, w: 90, h: 22 }]);
  assert.deepEqual(words, [{ x: 20, y: 20, w: 180, h: 24 }]);
  // The score's box and the health bar 12 px under it (the example's HUD): two things.
  const two = mergeRects([{ x: 16, y: 12, w: 232, h: 40 }, { x: 16, y: 64, w: 214, h: 16 }]);
  assert.equal(two.length, 2);
  // Overlapping: one.
  assert.equal(mergeRects([{ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 }]).length, 1);
  // Far on one line: two.
  assert.equal(mergeRects([{ x: 0, y: 0, w: 10, h: 10 }, { x: 40, y: 0, w: 10, h: 10 }]).length, 2);
});

test('placeOf: the nearest of the 9 places of the screen (thirds)', () => {
  assert.equal(placeOf(60, 700, 1280, 800), 'bottom-left');
  assert.equal(placeOf(640, 400, 1280, 800), 'center');
  assert.equal(placeOf(1200, 30, 1280, 800), 'top-right');
  assert.equal(placeOf(640, 790, 1280, 800), 'bottom');
});

const SHOT = 'data:image/jpeg;base64,' + 'A'.repeat(40);

test('the ui-code ask: the place pressed, the frames and the picture are kept; bad hints are dropped, a bad picture is refused', () => {
  const r = normalizeRequestInput({ kind: 'ask', text: 'Make this UI editable', lang: 'en', layer: 'ui', intent: 'ui-code', pressed: [64.4, 700.6],
    found: [{ box: [11, 659.2, 110, 130], from: 'hud-canvas' }, { box: [1, 2], from: 'hud-canvas' }, { box: [0, 0, 5, 5], from: 'guess' }], shot: SHOT });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.value.intent, 'ui-code');
  assert.deepEqual(r.value.pressed, [64, 701]);
  assert.deepEqual(r.value.found, [{ box: [11, 659, 110, 130], from: 'hud-canvas' }]);
  assert.equal(r.value.shot, SHOT);
  assert.equal(r.value.layer, 'ui');
  const bad = normalizeRequestInput({ kind: 'ask', text: 'Make this UI editable', intent: 'ui-code', shot: 'data:text/html;base64,AAAA' });
  assert.equal(bad.ok, false);
  // Another intent: none of it is kept (the place and the picture are only for ui-code).
  const other = normalizeRequestInput({ kind: 'ask', text: 'night', pressed: [1, 2], found: [{ box: [0, 0, 9, 9], from: 'left-out' }], shot: SHOT });
  assert.equal(other.ok, true);
  assert.equal(other.value.pressed, undefined);
  assert.equal(other.value.found, undefined);
  assert.equal(other.value.shot, undefined);
});

test('the ui-code ask\'s studio: line names what it is for, the place, the frames and the picture', () => {
  const line = handoffLine({ kind: 'ask', intent: 'ui-code', text: 'Make this UI editable', pressed: [64, 701], found: [{ box: [11, 659, 110, 130], from: 'hud-canvas' }],
    shot: '.studio/play/20261024-120000-000-ask-1a2b.jpg' }, '.studio/requests/r.json');
  assert.equal(line, 'studio: request ask .studio/requests/r.json "Make this UI editable" (make the canvas UI editable, pressed 64,701, 1 not selectable yet, picture .studio/play/20261024-120000-000-ask-1a2b.jpg)');
});
