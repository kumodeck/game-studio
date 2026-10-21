// Save, loud (a try of the editor, 2026-10-21, B and C — src/shell/save-loud.ts), without a browser:
//   C  the Save in the game bounces once when a change first appears (never again for the next changes, not after Play,
//      not with reduced motion); its orange is shell.css's --you (read here from the CSS, so no new orange creeps in)
//   B  "Save to game" beside ▶ Play while something is not saved (short "Save" on narrow screens), and a strip over the
//      game while playing; × hides the strip only; Save takes everything away; nothing when nothing changed
// The screen test (and the photos) is test/save-loud.browser.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bounces, saveLoud } from '../src/shell/save-loud.ts';
import { translate } from '../src/shell/i18n.ts';

const css = readFileSync(new URL('../src/shell/shell.css', import.meta.url), 'utf8');

test('B: nothing changed → no Save anywhere', () => {
  for (const playing of [false, true]) for (const narrow of [false, true]) {
    assert.deepEqual(saveLoud({ n: 0, playing, stripHidden: false, narrow }), { fab: false, top: null, strip: false });
  }
});

test('B: a change in Edit → the Save in the game and "Save to game" beside Play; no strip', () => {
  assert.deepEqual(saveLoud({ n: 1, playing: false, stripHidden: false, narrow: false }), { fab: true, top: 'long', strip: false });
  assert.deepEqual(saveLoud({ n: 3, playing: false, stripHidden: false, narrow: true }), { fab: true, top: 'short', strip: false });
});

test('B: playing with a change → the strip and Save beside Play (the one in the game steps away with the rest)', () => {
  assert.deepEqual(saveLoud({ n: 2, playing: true, stripHidden: false, narrow: false }), { fab: false, top: 'long', strip: true });
  // × hides the strip, Save beside Play stays.
  assert.deepEqual(saveLoud({ n: 2, playing: true, stripHidden: true, narrow: true }), { fab: false, top: 'short', strip: false });
});

test('C: one bounce, when a change first appears', () => {
  assert.equal(bounces(0, 1, false, false), true);
  assert.equal(bounces(1, 2, false, false), false, 'not on the next change');
  assert.equal(bounces(3, 3, false, false), false, 'not back from Play with the same changes');
  assert.equal(bounces(0, 1, true, false), false, 'not while playing');
  assert.equal(bounces(0, 1, false, true), false, 'not with reduced motion');
  // A sequence as a person makes it: move, move, Save, move → two bounces (one per "first change since nothing").
  let prev = 0, n = 0;
  for (const next of [1, 2, 3, 0, 1, 2]) n += bounces(prev, (prev = next), false, false) ? 1 : 0;
  assert.equal(n, 2);
});

test('B: the words', () => {
  assert.equal(translate('ja', 'play.unsaved', { n: 1 }), 'この変更はまだゲームに入っていません');
  assert.equal(translate('ja', 'play.unsaved', { n: 3 }), 'この変更はまだゲームに入っていません');
  assert.equal(translate('en', 'play.unsaved', { n: 1 }), 'This change isn’t in the game yet');
  assert.equal(translate('en', 'play.unsaved', { n: 3 }), 'These changes aren’t in the game yet');
  assert.equal(translate('ja', 'save.fab'), '保存してゲームへ');
  assert.equal(translate('ja', 'btn.save'), '保存');
  assert.match(translate('ja', 'play.unsavedHide'), /^隠す/);
});

test('C: the Save presses are filled with --you (KUMO orange), white words; no new orange', () => {
  assert.match(css, /--studio-accent: #ff6b1a;/);
  // A rule's whole body (rules here run over several lines).
  const rule = (sel: string) => css.slice(css.indexOf(sel), css.indexOf('}', css.indexOf(sel)));
  assert.match(rule('\n.save-fab {'), /background: var\(--you\); color: var\(--you-fg\)/);
  assert.match(rule('\n.top-actions > button.top-save {'), /background: var\(--you\); color: var\(--you-fg\)/);
  assert.match(css, /\.play-unsaved \.play-unsaved-save \{[^}]*background: var\(--you\); color: var\(--you-fg\)/);
  // Every hex colour in the stylesheet that is orange-ish is the one --you.
  const oranges = [...css.matchAll(/#([0-9a-f]{6})\b/gi)].map((m) => m[1].toLowerCase()).filter((h) => {
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
    return r > 200 && g > 80 && g < 160 && b < 80;   // (red, g ≤ 80: Delete — not an orange)
  });
  assert.deepEqual([...new Set(oranges)], ['ff6b1a']);
  // The bounce is a one-off script animation (main.ts), not a CSS rule that could run again or loop.
  assert.doesNotMatch(css, /data-bump|studio-bump/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \*, \*::before \{ animation: none !important;/);
});
