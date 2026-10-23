// The Library's shelf (studio-library-shelf, 2026-10-23; the UI plan’s step 5):
//   #2 one way of counting — the left column, All and the grid's headings say the same number (the walk found "Library 9"
//      next to "All 11" over "9 objects": the motions were counted in one place and not the other);
//   #4 "✦ Make with AI" says before the press that it needs a sign-in and money, or how much is left.
// The screen side (headings, the detail's words, the button in the page) is test/studio-library-shelf.browser.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shelfCounts } from '../src/tools/library/panel.ts';
import { aiOpenLabel } from '../src/tools/library/ai-make.ts';

test('one count: Neon Run (9 objects with hex ×4, 2 motions, no assets) is 11 everywhere', () => {
  const n = shelfCounts([], { n: 9, shelf: '3d' }, 2);
  // All = objects + motions + assets: the headings "Objects · 9", "Motions · 2", "Assets · 0" add up to it.
  assert.equal(n.all, 11);
  assert.equal(n.all, 9 + 2 + 0);
  assert.equal(n['3d'], 9);
  assert.equal(n.motion, 2);
  assert.equal(n['2d'] + n.sound + n.other, 0);
});

test('one count: files go on their own shelves and into All once each', () => {
  const files = [{ type: 'model' as const }, { type: 'model' as const }, { type: 'image' as const }, { type: 'sound' as const }, { type: 'font' as const }];
  const n = shelfCounts(files, { n: 4, shelf: '3d' }, 1);
  assert.equal(n.all, 4 + 1 + 5);
  assert.equal(n['3d'], 4 + 2);
  assert.equal(n['2d'], 1);
  assert.equal(n.sound, 1);
  assert.equal(n.other, 1);
  // Without objects (the dev harness): the files alone.
  assert.equal(shelfCounts(files, null, 0).all, 5);
});

test('"Make with AI" says what it needs before the press', () => {
  assert.equal(aiOpenLabel('en', null), 'Make with AI');
  assert.equal(aiOpenLabel('en', { signedIn: false }), 'Make with AI · sign-in · paid');
  assert.equal(aiOpenLabel('ja', { signedIn: false }), 'AI で作る · サインイン · 有料');
  assert.equal(aiOpenLabel('en', { signedIn: true, balanceCents: 420 }), 'Make with AI · $4.20 left');
  assert.equal(aiOpenLabel('ja', { signedIn: true, balanceCents: 420 }), 'AI で作る · 残り $4.20');
  // Signed in but the balance couldn't be read: no made-up number.
  assert.equal(aiOpenLabel('en', { signedIn: true }), 'Make with AI');
});
