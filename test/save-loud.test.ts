// Save, loud (a try of the editor, 2026-10-21, B and C — src/shell/save-loud.ts), and ONE Save (a try of v0.1.9, same day:
// "why are there two buttons that do the same thing?"), without a browser:
//   C  the Save bounces once when a change first appears (never again for the next changes, not after Play, not with
//      reduced motion); its orange is shell.css's --you (read here from the CSS, so no new orange creeps in)
//   B  one Save beside ▶ Play while something is not saved — in Edit and in Play, every width, the word "Save";
//      nothing when nothing changed. The strip over the game while playing went the same day: ▶ Play asks first,
//      "Save and play / Try without saving" (test/unsaved-guard.test.ts, test/studio-play-choice.browser.mjs)
// The screen tests are test/studio-save-fab.browser.mjs (the one Save on every layout) and test/save-loud.browser.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bounces, saveLoud } from '../src/shell/save-loud.ts';
import { translate } from '../src/shell/i18n.ts';

const css = readFileSync(new URL('../src/shell/shell.css', import.meta.url), 'utf8');

test('B: nothing changed → no Save anywhere', () => {
  for (const playing of [false, true]) assert.deepEqual(saveLoud({ n: 0, playing }), { top: false });
});

test('B: a change → the one Save beside Play, in Edit and in Play; no strip over the game any more', () => {
  for (const playing of [false, true]) for (const n of [1, 3]) assert.deepEqual(saveLoud({ n, playing }), { top: true });
  assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ''), /\.play-unsaved\b/, 'the strip\'s rules are gone');
  for (const lang of ['en', 'ja'] as const) assert.equal(translate(lang, 'play.unsaved'), 'play.unsaved', `${lang}: the strip's words are gone`);
});

test('one Save: there is no second Save to show (no save-fab, no "Save to game")', () => {
  assert.deepEqual(Object.keys(saveLoud({ n: 1, playing: false })), ['top']);
  // Rules only (the comments keep the history of the corner Save).
  assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ''), /\.save-fab\b|--fab-room|--fab-bottom/);
  for (const lang of ['en', 'ja'] as const) assert.equal(translate(lang, 'save.fab'), 'save.fab', `${lang}: the "Save to game" words are gone`);
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
  assert.equal(translate('ja', 'btn.save'), '保存');
  assert.equal(translate('en', 'btn.save'), 'Save');
});

test('C: the Save presses are filled with --you (KUMO orange), white words; no new orange', () => {
  assert.match(css, /--studio-accent: #ff6b1a;/);
  // A rule's whole body (rules here run over several lines).
  const rule = (sel: string) => css.slice(css.indexOf(sel), css.indexOf('}', css.indexOf(sel)));
  assert.match(rule('\n.top-actions > button.top-save {'), /background: var\(--you\); color: var\(--you-fg\)/);
  // "Save and play" in ▶ Play's window is that same Save, then Play (unsaved-guard.ts kind 'play').
  assert.match(css, /\.unsaved-guard\[data-kind="play"\] button\.primary \{[^}]*background: var\(--you\); color: var\(--you-fg\)/);
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
