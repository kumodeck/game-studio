// After the AI fixed something asked from a paused moment (pause-ask stage 3, 2026-11-02; src/shell/moment-try.ts): the
// reply's buttons, its second row (the files), which pause is the Try's, the words, and the status's `files`.
// The screen: test/studio-pause.browser.mjs (moment: ▶ Try from, Before / After, ↶ Undo).
// Run: node --experimental-strip-types --no-warnings --test test/moment-try.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { filesRow, isTryPause, replyActions, tryPauseVerdict, tryWords } from '../src/shell/moment-try.ts';
import { translate } from '../src/shell/i18n.ts';
import { normalizeStatus } from '../src/schema/handoff.mjs';

test('the reply of a paused ask: ▶ Try · Before / After · ↶ Undo when the moment is kept and the code changed', () => {
  assert.deepEqual(replyActions({ paused: true, back: true, changed: true, canUndo: true }), ['try', 'compare', 'undo']);
  assert.deepEqual(replyActions({ paused: true, back: true, changed: true, canUndo: false }), ['try', 'compare']);
  // A host that kept no moment (older): the old Reload (leave the moment, play from the start).
  assert.deepEqual(replyActions({ paused: true, back: false, changed: true, canUndo: true }), ['reload', 'undo']);
  // An answer that changed no code: nothing to try. Not paused: Edit's own line.
  assert.deepEqual(replyActions({ paused: true, back: true, changed: false, canUndo: true }), []);
  assert.deepEqual(replyActions({ paused: false, back: true, changed: true, canUndo: true }), []);
});

test('the second row: the files the AI touched, two named then +N; else what it said before', () => {
  assert.equal(filesRow(['src/boss.js'], '1 change'), 'src/boss.js');
  assert.equal(filesRow(['src/boss.js', 'game.js', 'src/hud.js', 'src/x.js'], ''), 'src/boss.js · game.js +2');
  assert.equal(filesRow(undefined, '1 change'), '1 change');
  assert.equal(filesRow([], ''), '');
});

test('the Try\'s pause is the one at the ask\'s second (within a few frames), not a P pressed on the way there', () => {
  assert.equal(isTryPause(5.02, 5.02), true);
  assert.equal(isTryPause(5.04, 5.02), true);
  assert.equal(isTryPause(2.1, 5.02), false);
  assert.equal(isTryPause(Number.NaN, 5.02), false);
});

test('the words: English and Japanese, the time in them, the "same time, new run" line for a game without save / load', () => {
  const v = { ai: 'Claude', Ai: 'Claude', t: '0:05.02' };
  assert.equal(translate('en', 'try.btn', v), 'Try from 0:05.02');
  assert.equal(translate('en', 'try.opened', v), 'New code · same moment, 0:05.02');
  // fix ✕3: short enough for a phone's flash (two lines at most), "mid-run" (fix △8).
  assert.equal(translate('en', 'try.sameRun', v), 'Same time, new run · 0:05.02. This game couldn’t start mid-run yet.');
  assert.equal(translate('en', 'try.openedOut', { ...v, name: 'the boss' }), 'New code · same moment, 0:05.02. Already out: the boss, so your change shows from the next one.');
  assert.equal(translate('en', 'cmp.resumeSee'), 'Resume to see it');
  assert.equal(translate('en', 'cmp.btn'), 'Before / After');
  assert.equal(translate('en', 'cmp.keep'), 'Keep · Resume');
  assert.equal(translate('en', 'cmp.undo', v), 'Undo Claude’s change');
  for (const k of ['try.btn', 'try.tip', 'try.opened', 'try.sameRun', 'try.gone', 'try.failed', 'cmp.btn', 'cmp.tip', 'cmp.title', 'cmp.before', 'cmp.after', 'cmp.beforeSub',
    'cmp.afterSub', 'cmp.afterSameRun', 'cmp.opening', 'cmp.undo', 'cmp.keep', 'cmp.close', 'moment.undo', 'moment.undoTip', 'moment.undone', 'gets.kept', 'gets.keptWhole',
    'gets.keptTime', 'gets.keptNone', 'gets.errors', 'gets.keptTimeTitle', 'gets.keptNoneTitle', 'gets.kind.mine', 'gets.fromMade', 'gets.spotGround', 'gets.spot', 'gets.areaEmpty',
    'gets.spotSub', 'try.openedOut', 'try.openedStay', 'cmp.out', 'cmp.stay', 'cmp.resumeSee', 'try.sameRunBehind', 'try.sameRunAhead', 'cmp.behind', 'cmp.ahead']) {
    const en = translate('en', k, { ...v, n: 1, name: 'the boss', s: '2.1' });
    const ja = translate('ja', k, { ...v, n: 1, name: 'the boss', s: '2.1' });
    assert.ok(en && en !== k, `en ${k}`);
    assert.ok(ja && ja !== k && ja !== en, `ja ${k}`);
    // VOICE.md rule 5: curly apostrophes on screen.
    assert.doesNotMatch(en, /'/, k);
  }
});

test('fix ✕2 (plan A): a whole moment says what was already out — the AI\'s --already first, then the made object asked about', () => {
  assert.deepEqual(tryWords(false, 'the boss', 'boss'), { flash: 'try.sameRun' }, 'a new run made everything with the new code: nothing to say');
  assert.deepEqual(tryWords(true, 'the boss', 'boss'), { flash: 'try.openedOut', note: 'cmp.out', name: 'the boss' });
  assert.deepEqual(tryWords(true, undefined, 'boss'), { flash: 'try.openedOut', note: 'cmp.out', name: 'boss' });
  assert.deepEqual(tryWords(true, '  ', undefined), { flash: 'try.openedStay', note: 'cmp.stay' });
});

test('fix △7: a new run that loaded slower (or faster) than the asking one says how far off the game may be', () => {
  assert.deepEqual(tryWords(false, undefined, undefined, 0.2), { flash: 'try.sameRun' }, 'a frame or two: nothing to say');
  assert.deepEqual(tryWords(false, undefined, undefined, 2.14), { flash: 'try.sameRunBehind', note: 'cmp.behind', s: '2.1' });
  assert.deepEqual(tryWords(false, undefined, undefined, -0.5), { flash: 'try.sameRunAhead', note: 'cmp.ahead', s: '0.5' });
  assert.equal(tryWords(true, undefined, 'boss', 3).flash, 'try.openedOut', 'a saved moment opens exactly: no drift');
  assert.equal(translate('en', 'try.sameRunBehind', { t: '0:05.40', s: '2.1' }), 'Same time, new run · 0:05.40. This run loaded slower: the game may be 2.1 s behind.');
});

test('the status keeps what was already out (--already): one short line', () => {
  assert.equal(normalizeStatus({ state: 'done', already: '  the boss\n' })!.already, 'the boss');
  assert.equal(normalizeStatus({ state: 'done', already: 'x'.repeat(200) })!.already!.length <= 60, true);
  assert.equal('already' in normalizeStatus({ state: 'done' })!, false);
});

test('the status keeps the files the AI touched (--files): paths inside the game folder, the first five', () => {
  const st = normalizeStatus({ state: 'done', note: 'The boss now comes in on the left', files: ['src/boss.js', '/etc/passwd', 'a.js', 'b.js', 'c.js', 'd.js', 'e.js', 'src/boss.js'] });
  assert.deepEqual(st!.files, ['src/boss.js', 'a.js', 'b.js', 'c.js', 'd.js']);
  assert.equal('files' in normalizeStatus({ state: 'done', files: 'src/boss.js' })!, false);
});

test('the Try\'s pause is judged on the exact held second, not on the editor\'s estimate (fixed 2026-11-06)', () => {
  // The estimate (the clock last heard, run on) is late by the paused picture's time on a busy machine: 0.52 s seen at
  // 20× slower. Not the Try's yet: wait for the game's own second (play/time right after the pause).
  assert.equal(tryPauseVerdict({ time: 6.544, exact: false }, 6.022), 'wait');
  assert.equal(tryPauseVerdict({ time: 6.022, exact: true }, 6.022), 'try');
  // An estimate already within a frame or so is a match (it only runs late, never early).
  assert.equal(tryPauseVerdict({ time: 4.63, exact: false }, 4.557), 'try');
  // A pause of the person's own (P before a new run got there): no, once the exact second says so.
  assert.equal(tryPauseVerdict({ time: 2.1, exact: true }, 6.022), 'not');
});
