// The line a person reads when the adapter self-check finds a problem (Ive review N1 / W1-5, 2026-10-17).
//
// Before: a yellow box "This game's adapter needs a fix" with the check's own details, e.g. "render() after
// setPose drew the same picture: set() may write a copy…" — words for the AI, shown to a person, on our own sample.
// Now: one grey line in plain words + "Your AI has the details."; the details go only to the AI (.studio/check.md).
// This test keeps code words out of those lines in both languages, and keeps the shell from showing the details.
// Run: node --experimental-strip-types --no-warnings --test test/check-words.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { translate } from '../src/shell/i18n.ts';
import { checkNoteText } from '../src/shell/check-note.ts';
import type { Lang, SelfCheckId } from '../src/contract.ts';

const IDS: SelfCheckId[] = ['adapter-found', 'has-objects', 'keys-valid', 'pose-roundtrip', 'screen-changes', 'anchor-follows', 'restored'];
const LANGS: Lang[] = ['en', 'ja'];
// Words of the adapter contract (src/contract.ts) and code marks. "Game Studio" is the product's name, not code.
const CODE = /render|setPose|set\(|\(\)|adapter|アダプ|つなぎ|anchor|bounds|\bkeys?\b|path:|list\(|`|\bnull\b|canvas|WebGL/i;

// As main.ts renderStatus writes it (checkNoteText: the check's words, then "Your AI has the details." unless they say it).
const shown = (lang: Lang, id: SelfCheckId) => checkNoteText(id, (k) => translate(lang, k));

test('every self-check line a person can see is in plain words (no render, setPose, set(), adapter…)', () => {
  for (const lang of LANGS) for (const id of IDS) {
    const line = shown(lang, id);
    assert.ok(!line.includes('check.') && !line.includes('status.'), `${lang} ${id}: missing string (${line})`);
    assert.doesNotMatch(line, CODE, `${lang} ${id}: "${line}"`);
  }
});

test('the moved-but-not-drawn line is the sentence decided 2026-11-07, one line, saying once what the AI has', () => {
  assert.equal(shown('en', 'screen-changes'), 'Things you move in the editor may not show in the game’s picture. Your AI has been told how to fix it.');
  // ja: the check's own sentence alone too (no shared ending after it).
  assert.equal(shown('ja', 'screen-changes'), translate('ja', 'check.screen-changes'));
  assert.ok(!shown('ja', 'screen-changes').includes(translate('ja', 'status.checkFail')));
  // The others keep the shared ending.
  assert.equal(shown('en', 'keys-valid'), `${translate('en', 'check.keys-valid')} ${translate('en', 'status.checkFail')}`);
  for (const lang of LANGS) for (const id of IDS) assert.ok(!shown(lang, id).includes('\n'), `${lang} ${id}: more than one line`);
});

test('the shell shows only that line: the check’s details (for the AI) are not put on screen', () => {
  const main = readFileSync(new URL('../src/shell/main.ts', import.meta.url), 'utf8');
  const at = main.indexOf('else if (check && !check.ok)');
  assert.ok(at > 0, 'the self-check branch of renderStatus() moved: update this test');
  const branch = main.slice(at, main.indexOf('status.hidden', at));
  assert.match(branch, /checkNoteText\(/, 'the line is made by checkNoteText (the decided 2026-11-07 ending)');
  assert.doesNotMatch(branch, /\.detail/, 'renderStatus() puts a check detail on screen');
  assert.match(branch, /line\('note'/, 'the self-check line is a grey note, not a warn box');
});
