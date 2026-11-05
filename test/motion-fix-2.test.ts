// studio-motion-fix-2 (decided 2026-11-05): the two left from the first-time walk of the rule layouts and motions —
// one line, not three, after the AI turned a motion into a rule (△4), and a phone's way to move just one object of a
// rule (△9: "Move just this one" in the long-press menu; its next drag is what ⌥-drag is on a PC).
//   node --experimental-strip-types --no-warnings --test test/motion-fix-2.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { noteOf, noteUnderReply, noteUnderWords, type NoteIn } from '../src/shell/motion-note.ts';
import { onceNote, placeNote, PLACE_WORDS } from '../src/bridge/code-place.ts';
import { translate } from '../src/shell/i18n.ts';

const createT = (lang: 'en' | 'ja') => (key: string, vars?: Record<string, string | number>) => translate(lang, key, vars);

const ship = { key: 'ship', label: 'ship', name: 'Ship motion', made: false };
const here: NoteIn = { here: { ...ship, canRule: false }, rec: false, others: [] };

test('△4: the AI\'s finished reply carries the note of the motion it changed — and only then', () => {
  const reply = { done: true, told: true, gone: false };
  assert.equal(noteUnderReply(noteOf(here), reply), true, 'the reply of a --do, the motion on screen changed: one line');
  // The reply faded (or was put away): the note is its own line again.
  assert.equal(noteUnderReply(noteOf(here), { ...reply, gone: true }), false);
  // The AI did nothing in the editor in this reply (no --do): a motion the person changed keeps its own line.
  assert.equal(noteUnderReply(noteOf(here), { ...reply, told: false }), false);
  // Not done yet (working, asking…): nothing to carry it.
  assert.equal(noteUnderReply(noteOf(here), { ...reply, done: false }), false);
  // Another object's motion ("Not saved: …", the name picks it): its own line, with its button.
  assert.equal(noteUnderReply(noteOf({ here: null, rec: false, others: [ship] }), reply), false);
  // Rec motion on: that line has the button that turns it off — never folded away.
  assert.equal(noteUnderReply(noteOf({ ...here, rec: true }), reply), false);
  assert.equal(noteUnderReply(noteOf({ here: null, rec: false, others: [] }), reply), false, 'no note at all');
});

test('△4: under the reply, the note says the step left in plain words, in both languages', () => {
  const en = createT('en');
  const ja = createT('ja');
  assert.equal(noteUnderWords(en), 'Save puts it in the game');
  assert.equal(noteUnderWords(ja), ja('mnext2.save', { save: ja('btn.save') }));
  assert.notEqual(noteUnderWords(ja), noteUnderWords(en), 'its own words, not the English');
});

test('△9: after "Move just this one", the line under the strip says what the next drag does', () => {
  assert.equal(onceNote('en', 'hex', 4, false), 'hex ×4 (rule): Next drag moves just this one · the rest stay on the rule');
  assert.equal(onceNote('en', 'hex', 4, true), 'Next drag moves just this one · the rest stay on the rule', 'narrow: no name, as placeNote');
  assert.equal(onceNote('ja', 'hex', 4, false), PLACE_WORDS.ja.head('hex', 4) + PLACE_WORDS.ja.once);
  assert.notEqual(PLACE_WORDS.ja.once, PLACE_WORDS.en.once);
  // The ordinary line on a phone has no ⌥ part (a phone has no ⌥): the menu row is the way there.
  assert.ok(!placeNote('en', 'hex', 4, ['Gap'], { narrow: false, touch: true }).includes('⌥'));
  for (const lang of Object.keys(PLACE_WORDS) as Array<keyof typeof PLACE_WORDS>) assert.ok(PLACE_WORDS[lang].once, `${lang} has the words`);
});

test('△9: the menu row has its words in both languages', () => {
  assert.equal(createT('en')('rule.moveOne'), 'Move just this one');
  const ja = createT('ja')('rule.moveOne');
  assert.ok(ja && ja !== 'rule.moveOne' && ja !== 'Move just this one', `ja: ${ja}`);
});
