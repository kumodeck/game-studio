// What each kind of step loses (src/shell/unsaved-guard.ts lostBy; a try of the editor, 2026-10-21: "when edits would be lost, show a
// modal" — and only then). The window itself and every step: test/studio-unsaved-guard.browser.mjs.
// Run: node --experimental-strip-types --no-warnings --test test/unsaved-guard.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { lostBy, playAsks } from '../src/shell/unsaved-guard.ts';
import { DEMO_TEXT } from '../src/hosts/browser/text.ts';
import { translate } from '../src/shell/i18n.ts';

test('nothing unsaved: no step asks', () => {
  for (const offline of [false, true]) for (const op of ['leave', 'reload'] as const) assert.equal(lostBy(op, { offline, kept: 0, tools: 0 }), 0);
});

test('a new game page (Play, Reload, the AI\'s reload) keeps the draft: only game tool data counts', () => {
  assert.equal(lostBy('reload', { offline: false, kept: 3, tools: 0 }), 0);
  assert.equal(lostBy('reload', { offline: false, kept: 3, tools: 2 }), 2);
  assert.equal(lostBy('reload', { offline: true, kept: 3, tools: 1 }), 1);
});

test('leaving the local studio loses the Save itself (the AI is never handed the changes)', () => {
  assert.equal(lostBy('leave', { offline: false, kept: 3, tools: 0 }), 3);
  assert.equal(lostBy('leave', { offline: false, kept: 3, tools: 2 }), 5);
});

test('leaving the web demo loses nothing kept in the browser (its draft is its save)', () => {
  assert.equal(lostBy('leave', { offline: true, kept: 3, tools: 0 }), 0);
  assert.equal(lostBy('leave', { offline: true, kept: 3, tools: 1 }), 1);
});

test('the words: one sentence with the number, English first, Japanese too', () => {
  assert.equal(translate('en', 'guard.title', { n: 1 }), 'You have 1 unsaved change');
  assert.equal(translate('en', 'guard.title', { n: 3 }), 'You have 3 unsaved changes');
  assert.equal(translate('ja', 'guard.title', { n: 3 }), '保存していない変更が 3 個あります');
  assert.deepEqual(['guard.save', 'guard.discard', 'guard.cancel'].map((k) => translate('en', k)), ['Save and continue', 'Don’t save', 'Cancel']);
  assert.deepEqual(['guard.save', 'guard.discard', 'guard.cancel'].map((k) => translate('ja', k)), ['保存して続ける', '保存せずに続ける', 'やめる']);
});

// ▶ Play with changes not saved asks first (a try of the editor, 2026-10-21: "let them choose with buttons — save, or
// try without saving"). The window, each answer and P: test/studio-play-choice.browser.mjs.
test('Play asks only going into Play, and only with something not saved', () => {
  assert.equal(playAsks(0, false), false, 'nothing changed: straight to Play');
  assert.equal(playAsks(1, false), true);
  assert.equal(playAsks(3, false), true);
  assert.equal(playAsks(3, true), false, 'Edit from Play never asks');
});

test('Play\'s window: the same title, a second line, Save and play · Try without saving · Cancel', () => {
  assert.equal(translate('ja', 'guard.title', { n: 2 }), '保存していない変更が 2 個あります');
  assert.equal(translate('en', 'guard.title', { n: 2 }), 'You have 2 unsaved changes');
  assert.equal(translate('ja', 'guard.playWhy'), '保存すると AI がゲームのコードに入れます。');
  assert.equal(translate('en', 'guard.playWhy'), 'Save, and your AI puts the changes in the game’s code.');
  assert.deepEqual(['guard.playSave', 'guard.playTry', 'guard.cancel'].map((k) => translate('ja', k)), ['保存して遊ぶ', '保存せずに試す', 'やめる']);
  assert.deepEqual(['guard.playSave', 'guard.playTry', 'guard.cancel'].map((k) => translate('en', k)), ['Save and play', 'Try without saving', 'Cancel']);
  // A game tool's data is lost by Try (it lives in the game page only): said, with the number.
  assert.equal(translate('en', 'guard.playTools', { n: 1 }), '1 change in a game tool is lost if you don’t save.');
  assert.equal(translate('ja', 'guard.playTools', { n: 2 }), 'ゲームの道具の変更 2 個は、保存しないと消えます。');
  // The web demo has no AI: its Save keeps the changes in this browser, and the second line says that.
  assert.match(DEMO_TEXT.en['guard.playWhy'], /this browser/);
  assert.match(DEMO_TEXT.ja['guard.playWhy'], /このブラウザ/);
});
