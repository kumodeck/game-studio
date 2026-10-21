// The bottom folded to one row (src/shell/sheet-fold.ts, 2026-10-21: "the bottom menu has to be able to be minimised").
// The screen itself is test/studio-side-sheet.browser.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FOLD_DRAG, FOLD_KEY, barPress, gripEnd, readFold, writeFold } from '../src/shell/sheet-fold.ts';

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};

test('the fold is kept in this browser; no storage, or storage that throws, starts unfolded', () => {
  const s = memory();
  assert.equal(readFold(s), false);
  writeFold(s, true);
  assert.equal(s.m.get(FOLD_KEY), '1');
  assert.equal(readFold(s), true);
  writeFold(s, false);
  assert.equal(readFold(s), false);
  const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  assert.equal(readFold(broken), false);
  assert.doesNotThrow(() => writeFold(broken, true));
  assert.equal(readFold(null), false);
});

test('the bar\'s left button: ▴ unfolds, ▾ (the list or the card up) folds the whole bottom, the list icon opens the list', () => {
  assert.equal(barPress({ fold: true, open: false }), 'unfold');
  assert.equal(barPress({ fold: false, open: true }), 'fold');
  assert.equal(barPress({ fold: false, open: false }), 'open');
});

test('the grip: a press folds; a pull down past the low sheet folds; a pull up stays tall; down to the low sheet is low', () => {
  assert.equal(gripEnd({ moved: false, fromH: 300, dy: 0, nowH: 300 }), 'fold');
  // Low sheet 300: dragged down 40 (CSS holds it at 300).
  assert.equal(gripEnd({ moved: true, fromH: 300, dy: -FOLD_DRAG - 8, nowH: 300 }), 'fold');
  // A hand that slipped 10 down is not a fold.
  assert.equal(gripEnd({ moved: true, fromH: 300, dy: -10, nowH: 300 }), 'low');
  assert.equal(gripEnd({ moved: true, fromH: 300, dy: 200, nowH: 500 }), 'tall');
  // Tall 500 dragged back down to the low sheet (300): low; further down by the fold's distance: fold.
  assert.equal(gripEnd({ moved: true, fromH: 500, dy: -205, nowH: 300 }), 'low');
  assert.equal(gripEnd({ moved: true, fromH: 500, dy: -240, nowH: 300 }), 'fold');
});
