// pause-ask stage 1 (2026-11-02; src/shell/moment-ask.ts): the way in
// to asking from the paused moment — the field shown (the web demo too, decided 2026-11-02), the cursor put in it only when it
// takes nothing from the person, the picture's time, and the words. The screen: test/studio-pause.browser.mjs (moment,
// momentdemo).
// Run: node --experimental-strip-types --no-warnings --test test/moment-ask.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { askFieldShown, momentAskOffline, momentFocusOk, shotTimeOnClock } from '../src/shell/moment-ask.ts';
import { translate } from '../src/shell/i18n.ts';
import { DEMO_TEXT } from '../src/hosts/browser/text.ts';

test('the field: always with an AI; in the web demo only while paused (Q1 = show it)', () => {
  assert.equal(askFieldShown({ offline: false, moment: false }), true, 'Edit with an AI');
  assert.equal(askFieldShown({ offline: false, moment: true }), true, 'paused with an AI');
  assert.equal(askFieldShown({ offline: true, moment: false }), false, 'the demo\'s Edit keeps its empty foot (2026-10-18)');
  assert.equal(askFieldShown({ offline: true, moment: true }), true, 'the demo\'s paused moment shows the field');
});

test('a send: to the AI, except from the demo\'s paused field (nothing sent there)', () => {
  assert.equal(momentAskOffline({ offline: true, moment: true }), true);
  assert.equal(momentAskOffline({ offline: false, moment: true }), false, 'a real host sends the paused request');
  assert.equal(momentAskOffline({ offline: true, moment: false }), false, 'the demo\'s Edit: the field is not there');
});

test('the cursor goes in the field at the pause only when it takes nothing from the person', () => {
  const pc = { touch: false, overlay: false };
  assert.equal(momentFocusOk({ ...pc, active: null }), true, 'nothing focused');
  assert.equal(momentFocusOk({ ...pc, active: { tag: 'IFRAME' } }), true, 'the game had the keys (P paused it)');
  assert.equal(momentFocusOk({ ...pc, active: { tag: 'BUTTON' } }), true, '❚❚ pressed');
  assert.equal(momentFocusOk({ ...pc, active: { tag: 'INPUT', askField: true } }), true, 'already in the field');
  assert.equal(momentFocusOk({ ...pc, active: { tag: 'INPUT' } }), false, 'a rename / a number on the card / ⚑\'s name');
  assert.equal(momentFocusOk({ ...pc, active: { tag: 'TEXTAREA' } }), false);
  assert.equal(momentFocusOk({ ...pc, active: { tag: 'DIV', editable: true } }), false, 'contenteditable');
  assert.equal(momentFocusOk({ touch: false, overlay: true, active: null }), false, '⌘K / the keys sheet open');
  assert.equal(momentFocusOk({ touch: true, overlay: false, active: null }), false, 'a phone: no keyboard over the frame');
});

test('the picture\'s time: estimated, then the held clock\'s first word; a Next frame leaves it', () => {
  const est = { time: 5.0, exact: false };
  assert.equal(shotTimeOnClock(est, { t: 5.03, running: true }), est, 'still running: the estimate stays');
  const exact = shotTimeOnClock(est, { t: 5.02, running: false });
  assert.deepEqual(exact, { time: 5.02, exact: true }, 'held: the exact time');
  assert.equal(shotTimeOnClock(exact, { t: 5.04, running: false }), exact, 'a Next frame: the picture is still the pause\'s');
  assert.equal(shotTimeOnClock(null, { t: 1, running: false }), null, 'no moment');
});

test('the words: the picture\'s tip names the AI; the demo says only where it stopped, and why nothing is sent', () => {
  assert.equal(translate('en', 'moment.shotTip', { t: '0:05.02', ai: 'Claude', Ai: 'Claude' }), 'Paused at 0:05.02. Claude gets this frame with your words.');
  assert.match(translate('ja', 'moment.shotTip', { t: '0:05.02', ai: 'Claude' }), /^0:05\.02 で止めた 1 コマです。.*Claudeに届きます。$/);
  assert.equal(translate('en', 'moment.offlineAsk'), 'This demo isn’t connected to an AI. Open your game with Claude Code or Codex to ask.');
  assert.match(translate('ja', 'moment.offlineAsk'), /試し版では AI にはつながっていません。Claude Code や Codex/);
  // The demo's table replaces the tip (no AI gets the frame there); the shell's table keeps its own.
  assert.equal(DEMO_TEXT.en['moment.shotTip'], 'Paused at {t}');
  assert.equal(DEMO_TEXT.ja['moment.shotTip'], '{t} で止めた 1 コマ');
  // VOICE.md rule 5: curly apostrophes on screen.
  assert.doesNotMatch(translate('en', 'moment.offlineAsk'), /'/);
});

// pause-ask stage 2, fix 1 (2026-11-02): P → P goes on playing. The cursor the pause put in the field doesn't take the
// game's and the editor's keys until the person types or clicks the field.
import { askPhShort, momentKeyPasses } from '../src/shell/moment-ask.ts';

test('P → P: while the cursor came by itself and nothing is typed, the keys are the game\'s and the editor\'s', () => {
  const auto = { auto: true, empty: true, mod: false };
  assert.equal(momentKeyPasses({ ...auto, key: 'p' }), true, 'P resumes (not a "p" in the field)');
  assert.equal(momentKeyPasses({ ...auto, key: '.' }), true, '. steps a frame');
  assert.equal(momentKeyPasses({ ...auto, key: 'Escape' }), true);
  assert.equal(momentKeyPasses({ ...auto, key: 'n' }), true, 'N marks');
  assert.equal(momentKeyPasses({ ...auto, key: 'b' }), true, 'any letter goes to the editor first; the ones it does not take are typed');
  for (const k of ['Backspace', 'Delete', 'Enter', 'Tab', ' ']) assert.equal(momentKeyPasses({ ...auto, key: k }), false, `${JSON.stringify(k)} stays the field's (it would act on the scene)`);
  assert.equal(momentKeyPasses({ ...auto, key: 'z', mod: true }), false, '⌘ keys: the field\'s own rule (main.ts)');
});

test('…and from the first letter typed, or a click in the field, everything is a letter', () => {
  assert.equal(momentKeyPasses({ auto: true, empty: false, mod: false, key: 'p' }), false, 'words in the field: "p" is a letter');
  assert.equal(momentKeyPasses({ auto: false, empty: true, mod: false, key: 'p' }), false, 'the person clicked the field: a letter');
  assert.equal(momentKeyPasses({ auto: false, empty: true, mod: false, key: '.' }), false);
});

test('fix 2: a narrow field gets the short words whole, not the long ones cut', () => {
  assert.equal(askPhShort({ phone: true, room: 0, need: 0 }), true, 'a phone');
  assert.equal(askPhShort({ phone: false, room: 500, need: 210 }), false, 'PC: the whole words fit');
  assert.equal(askPhShort({ phone: false, room: 170, need: 210 }), true, 'a narrow side window');
  assert.equal(askPhShort({ phone: false, room: 0, need: 210 }), false, 'not measured yet: the layout decides');
  assert.equal(translate('en', 'moment.askPhShort', { ai: 'Claude' }), 'Ask Claude…');
  assert.equal(translate('ja', 'moment.askPhShort', { ai: 'Claude' }), 'Claudeに頼む…');
});
