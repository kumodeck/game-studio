// Five open questions answered with the recommended choice (decided 2026-11-07), and the shelf's 8 px. Without a browser:
//   1. the one line when the editor opens is "Grab anything. Tell {ai} the rest." (the AI's own name in it, both languages);
//      a motion made by dragging goes there and back (test/no-presets.test.ts checks the made clip's repeat);
//   2. the moved-but-not-drawn line (test/check-words.test.ts);
//   4. canvas UI: the AI asks once the first time it looks, and makes all of it movable on a yes (SKILL.md), never
//      without asking;
//   5. a checkpoint keeps what was moved and set in the paused moment, and the name field says so (both languages);
//   the shelf: a card is a flex column from its top, so a card with a short blurb has no gap over its picture.
// Run: node --experimental-strip-types --no-warnings --test test/decided-1107.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setAiName, translate } from '../src/shell/i18n.ts';
import { SHELF_CSS } from '../src/shell/shelf-css.ts';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

test('the opening line says what the tool is: grab anything, tell your AI the rest (with its own name)', () => {
  assert.equal(translate('en', 'intro.line', { ai: 'Claude' }), 'Grab anything. Tell Claude the rest.');
  assert.equal(translate('en', 'intro.line', { ai: 'Codex' }), 'Grab anything. Tell Codex the rest.');
  try {
    setAiName('any');
    assert.equal(translate('en', 'intro.line'), 'Grab anything. Tell your AI the rest.');
    // ja: one sentence each for "grab" and "the rest", the AI's name in the second one.
    const ja = translate('ja', 'intro.line', { ai: 'Claude ' });
    assert.ok(ja.includes('Claude '), ja);
    assert.equal(ja.split('。').filter(Boolean).length, 2, `two sentences: ${ja}`);
  } finally {
    setAiName('any');
  }
  // The old how-to line is gone from both tables.
  for (const lang of ['en', 'ja'] as const) assert.doesNotMatch(translate(lang, 'intro.line', { ai: 'Claude' }), /Save|puts it in your code/);
});

test('canvas UI: SKILL.md asks once and waits for a yes (or the ✦ ask), then all of it at once', () => {
  const skill = read('../skills/arrange/SKILL.md');
  const at = skill.indexOf('- **A UI drawn in the canvas**');
  assert.ok(at > 0, 'the canvas UI bullet of §1 moved: update this test');
  const bullet = skill.slice(at, skill.indexOf('\n- ', at + 10));
  assert.match(bullet, /\*\*ask once\*\*/);
  assert.match(bullet, /only\s+on a yes/);
  assert.match(bullet, /all of it at once/);
  assert.match(bullet, /Decided on 2026-11-07/);
  assert.doesNotMatch(bullet, /without asking/, 'never "make it editable without asking" any more');
  assert.doesNotMatch(skill, /the first time you look at a game with such a UI, without asking/, '§4 "Deliver it" follows §1');
});

test('a checkpoint keeps what was moved and set in this moment, and the field says so', () => {
  assert.equal(translate('en', 'checkpoint.keepsMoved'), 'What you moved and set in this moment is kept too.');
  assert.notEqual(translate('ja', 'checkpoint.keepsMoved'), 'checkpoint.keepsMoved');
  const main = read('../src/shell/main.ts');
  assert.match(main, /note: t\('checkpoint\.keepsMoved'\)/, 'the name field under ⚑ carries the line');
  assert.match(main, /△12, decided 2026-11-07/);
});

test('the shelf: a card is a column from its top (no gap over a picture when a row has a longer blurb)', () => {
  const rule = SHELF_CSS.match(/\.samples-page button\.samples-card \{([^}]*)\}/)?.[1] ?? '';
  assert.match(rule, /display: flex/);
  assert.match(rule, /flex-direction: column/);
  assert.match(rule, /justify-content: flex-start/);
  assert.match(rule, /gap: 0/, 'no button gap between the picture and the words');
  // The picture keeps its 16:10 and never shrinks in the column.
  assert.match(SHELF_CSS, /\.samples-pic \{[^}]*flex: none/);
});
