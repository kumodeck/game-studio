// The shelf of samples and its guide, without a browser (decided 2026-11-06): the three tries a card shows, the words
// to ask in each language, and how the guide moves on from what the editor shows.
//   node --experimental-strip-types --no-warnings --test test/shelf.test.ts
// The screen itself: test/studio-shelf-screen.browser.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shelfSteps, pauseSeconds } from '../src/shell/shelf.ts';
import { nextStep, moreKey } from '../src/shell/shelf-tour.ts';
import { askWords, moveWords, blurbWords, shelfText } from '../src/shell/shelf-strings.ts';

test('the three tries: Move → Play, then press P → ● Clip, with the sample\'s own words', () => {
  const s = shelfSteps('en', { id: 'big-swell', try: { move: 'duck_1', moveName: { en: 'duck', ja: 'アヒル' }, pauseAt: 7.6, ask: { en: 'Make the waves twice as tall.' } } });
  assert.deepEqual(s.map((x) => x.head), ['Move', 'Play, then press P', '● Clip']);
  assert.equal(s[0].text, 'Drag the duck. It stays where you put it, even while it plays.');
  // pauseAt is the game's clock (7.6 s); the top bar reads 0:07 then, so the card says 7.
  assert.equal(s[1].text, 'at about 7 s. Ask for a change right there:');
  const ja = shelfSteps('ja', { id: 'big-swell', try: { move: 'duck_1', moveName: { en: 'duck', ja: 'アヒル' }, pauseAt: 7.6 } });
  assert.match(ja[0].text, /^アヒル（duck） をドラッグ。/, 'the English name too: the editor lists things by it');
  assert.match(ja[1].text, /^7 秒ごろ。/);
  assert.equal(s[1].ask, 'Make the waves twice as tall.');
  assert.equal(s[2].rec, true);
  // A sample without try (or with only some of it) still gets all three, in plain words.
  const bare = shelfSteps('en', { id: 'x', try: null });
  assert.equal(bare[0].text, 'Drag anything in the game. It stays where you put it, even while it plays.');
  assert.equal(bare[1].text, 'when something good happens.');
  assert.equal(bare[1].ask, null);
});

test('the sample\'s own words in the screen\'s language, English when it has none (no stand-ins)', () => {
  assert.equal(askWords('ja', { en: 'Make the waves twice as tall.', ja: 'X' }), 'X');
  assert.equal(askWords('ja', { en: 'Go.' }), 'Go.', 'no Japanese: English');
  assert.equal(askWords('en', { ja: 'X' }), '', 'English screen, no English words: nothing (never another language)');
  assert.equal(moveWords('en', { move: 'lighthouse_1', moveName: { en: 'lighthouse' } }), 'lighthouse');
  assert.equal(moveWords('ja', { move: 'lighthouse_1', moveName: { en: 'lighthouse', ja: '灯台' } }), '灯台（lighthouse）');
  assert.equal(moveWords('ja', { move: 'gate', moveName: { en: 'gate' } }), 'gate', 'no Japanese name: the English one');
  assert.equal(moveWords('en', { move: 'gate' }), 'gate', 'an older server without moveName: the name as it is');
  assert.equal(blurbWords('ja', { blurb: 'A sea.', blurbs: { ja: '海。' } }), '海。');
  assert.equal(blurbWords('ja', { blurb: 'A sea.' }), 'A sea.');
  assert.equal(blurbWords('en', { blurb: 'A sea.', blurbs: { ja: '海。' } }), 'A sea.');
});

test('the second to pause at, as the editor\'s top bar shows it (pauseAt is the game\'s clock)', () => {
  assert.equal(pauseSeconds(7.6), '7', 'Big Swell: the bar reads 0:07.01 when the game reads 7.6');
  assert.equal(pauseSeconds(4.6), '4');
  assert.equal(pauseSeconds(3), '2');
  assert.equal(pauseSeconds(0.2), '0');
});

test('every shelf word has Japanese (the screen is English and Japanese)', () => {
  const keys = ['title', 'lead', 'own', 'own.how', 'crumb', 'coming', 'playing', 'back', 'open', 'opening', 'openFailed', 'hasGame',
    'step.move', 'step.move.with', 'step.move.any', 'step.move.more', 'step.pause', 'step.pause.at', 'step.pause.any', 'step.pause.more',
    'step.clip.more', 'tour.head', 'tour.move', 'tour.moveAny', 'tour.moveMore', 'tour.next', 'tour.play', 'tour.playAny', 'tour.playMore', 'tour.playMoreMark',
    'tour.clip', 'tour.clipMore', 'tour.done', 'tour.skip', 'tour.key', 'try.ask', 'try.askTip', 'ask.quote'] as const;
  for (const k of keys) assert.notEqual(shelfText('ja', k), shelfText('en', k), `${k} has Japanese`);
  assert.equal(shelfText('en', 'open', { title: 'Big Swell' }), 'Open Big Swell');
  assert.equal(shelfText('en', 'tour.head', { title: 'Big Swell', n: 1, all: 3 }), 'Try Big Swell · 1 of 3');
});

test('the guide moves on from what the editor shows, never back', () => {
  const none = { changed: false, playing: false, paused: false };
  assert.equal(nextStep(1, none), 1);
  assert.equal(nextStep(1, { ...none, changed: true }), 2, 'a change made = Move done');
  assert.equal(nextStep(1, { ...none, playing: true }), 2, 'playing skips ahead to Play');
  assert.equal(nextStep(1, { ...none, playing: true, paused: true }), 3, 'already paused: straight to ● Clip');
  assert.equal(nextStep(2, { ...none, playing: true }), 2, 'playing is not paused yet');
  assert.equal(nextStep(2, { ...none, playing: true, paused: true }), 3);
  assert.equal(nextStep(3, none), 3, 'Edit after pausing does not ask to pause again');
});

test('a sample whose ask says "here" (try.mark): the Play card says to point with ◎ Mark first, in en and ja', () => {
  assert.equal(moreKey(2, { mark: true }), 'tour.playMoreMark');
  assert.equal(moreKey(2, {}), 'tour.playMore');
  assert.equal(moreKey(2, null), 'tour.playMore');
  assert.equal(moreKey(1, { mark: true }), 'tour.moveMore', 'only the Play card');
  assert.equal(moreKey(3, { mark: true }), 'tour.clipMore');
  assert.match(shelfText('en', 'tour.playMoreMark'), /◎ Mark/);
  assert.match(shelfText('ja', 'tour.playMoreMark'), /◎ 印/);
});
