// Pause while playing (2026-10-22, CONTRACT.md §3.5.1): the game's clock (src/core/play-clock.ts), the
// pause key (src/bridge/play-pause.ts), the chat's rules (src/bridge/play-chat.ts), the request's new parts
// (src/schema/handoff.mjs), the AI's line and the talk's file (src/server/play-chat.mjs). No browser:
// test/studio-pause.browser.mjs drives the real thing.
// Run: node --experimental-strip-types --no-warnings --test test/pause.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeClock } from '../src/core/play-clock.ts';
import { isPauseKey } from '../src/bridge/play-pause.ts';
import { chatOnLine, historyOf, HISTORY_MAX, type ChatModel } from '../src/bridge/play-chat.ts';
import { normalizeRequestInput, HANDOFF_LIMITS } from '../src/schema/handoff.mjs';
import { handoffLine } from '../src/server/ai-watch.mjs';
import { chatIdOf, chatWithTurn } from '../src/server/play-chat.mjs';
import { chatReplyFor } from './ai-feel/fake-agent.mjs';
import { translate } from '../src/shell/i18n.ts';
import { playWords } from '../src/shell/play-ask.ts';

test('the clock: a pause takes no time, before or after', () => {
  let real = 1000;
  const c = makeClock(() => real);
  assert.equal(c.at(real), 1000);
  c.stop();
  real = 61_000; // a minute paused
  assert.equal(c.at(real), 1000, 'while stopped, time stays at the moment it stopped');
  assert.equal(c.stopped, true);
  c.go();
  assert.equal(c.skipped, 60_000);
  assert.equal(c.at(real), 1000, 'right after Resume: where it stopped, not a minute later');
  real += 16;
  assert.equal(c.at(real), 1016, 'then one ordinary frame');
  c.go(); // twice: nothing
  assert.equal(c.skipped, 60_000);
  c.stop();
  c.stop(); // twice: the first moment counts
  real += 500;
  c.go();
  assert.equal(c.skipped, 60_500);
  // A frame timestamp from before the pause that arrives during it never reads later than the pause.
  c.stop();
  assert.ok(c.at(real + 100) <= c.at(real));
});

test('P pauses: by the character or the key, never with a modifier or while typing', () => {
  assert.equal(isPauseKey({ key: 'p' }, false), true);
  assert.equal(isPauseKey({ key: 'P' }, false), true);
  assert.equal(isPauseKey({ key: '\u305b', code: 'KeyP' }, false), true, 'kana input: the P key still pauses');
  assert.equal(isPauseKey({ key: 'p', metaKey: true }, false), false, '⌘P is print');
  assert.equal(isPauseKey({ key: 'p', ctrlKey: true }, false), false);
  assert.equal(isPauseKey({ key: 'p' }, true), false, 'typing in the game’s own field');
  assert.equal(isPauseKey({ key: 'p', isComposing: true }, false), false);
  assert.equal(isPauseKey({ key: 'o', code: 'KeyO' }, false), false);
});

test('the chat: a finished line is a new reply only after a message was kept', () => {
  let m: ChatModel = { turns: [{ who: 'you', text: 'why do I fall here?' }], awaiting: false, live: null };
  // Before play/sent: the editor may still show the last request's reply. Not a new turn.
  m = chatOnLine(m, { state: 'fixed', text: 'old reply' });
  assert.equal(m.turns.length, 1);
  m = { ...m, awaiting: true };
  m = chatOnLine(m, { state: 'looking', text: 'Your AI is looking' });
  assert.equal(m.live?.text, 'Your AI is looking');
  m = chatOnLine(m, { state: 'fixing', text: 'Looking at this moment…' });
  assert.equal(m.live?.state, 'fixing');
  m = chatOnLine(m, { state: 'fixed', text: 'The ledge has no floor there.', more: 'More in Claude' });
  assert.equal(m.turns.length, 2);
  assert.deepEqual(m.turns[1], { who: 'ai', text: 'The ledge has no floor there.', state: 'fixed', more: 'More in Claude' });
  assert.equal(m.awaiting, false);
  assert.equal(m.live, null);
  // The same reply again, now with Reload (the files settled): the reply is updated, not repeated.
  m = chatOnLine(m, { state: 'fixed', text: 'The ledge has no floor there.', reload: true, more: 'More in Claude' });
  assert.equal(m.turns.length, 2);
  assert.equal(m.turns[1]!.reload, true);
  // A question: its choices come with it.
  m = chatOnLine({ ...m, turns: [...m.turns, { who: 'you', text: 'fix it' }], awaiting: true }, { state: 'asking', text: 'Higher jump or a floor?', choices: ['Jump', 'Floor'] });
  assert.deepEqual(m.turns[3], { who: 'ai', text: 'Higher jump or a floor?', state: 'asking', choices: ['Jump', 'Floor'] });
  // Nothing (a new game page): the "looking" row goes, the talk stays.
  m = chatOnLine({ ...m, live: { state: 'looking', text: 'x' } }, null);
  assert.equal(m.live, null);
  assert.equal(m.turns.length, 4);
});

test('the talk so far: the last 12 turns, each one line of at most 300 characters', () => {
  const turns = Array.from({ length: 20 }, (_, i) => ({ who: (i % 2 ? 'ai' : 'you') as 'you' | 'ai', text: `turn ${i} ` + 'x'.repeat(i === 19 ? 400 : 0) }));
  const h = historyOf(turns);
  assert.equal(h.length, HISTORY_MAX);
  assert.equal(h[0]!.text, 'turn 8 ');
  assert.equal(h[11]!.text.length, 300);
  assert.ok(h[11]!.text.endsWith('…'));
});

test('a paused "play" request: paused, chat and history are kept; a bad chat id is dropped, the words still go', () => {
  const first = normalizeRequestInput({ kind: 'play', text: 'why do I fall here?', lang: 'en', paused: true });
  assert.ok(first.ok);
  assert.equal(first.value.paused, true);
  assert.equal(first.value.chat, undefined);
  const next = normalizeRequestInput({
    kind: 'play', text: 'can you fix it?', lang: 'en', paused: true, chat: '20261022-101500-123-play-ab12',
    history: [{ who: 'you', text: 'why do I fall\nhere?' }, { who: 'ai', text: 'No floor there.' }, { who: 'them', text: 'x' }, { who: 'ai', text: '' }],
  });
  assert.ok(next.ok);
  assert.equal(next.value.chat, '20261022-101500-123-play-ab12');
  assert.deepEqual(next.value.history, [{ who: 'you', text: 'why do I fall here?' }, { who: 'ai', text: 'No floor there.' }]);
  const bad = normalizeRequestInput({ kind: 'play', text: 'hi', paused: true, chat: '../../etc/passwd', history: 'no' });
  assert.ok(bad.ok);
  assert.equal(bad.value.chat, undefined);
  assert.equal(bad.value.history, undefined);
  // Not paused: chat / history are not a "play" request's business.
  const plain = normalizeRequestInput({ kind: 'play', text: 'hi', chat: '20261022-101500-123-play-ab12', history: [{ who: 'you', text: 'x' }] });
  assert.ok(plain.ok);
  assert.equal(plain.value.chat, undefined);
  assert.equal(plain.value.paused, undefined);
  const long = normalizeRequestInput({ kind: 'play', text: 'hi', paused: true, history: Array.from({ length: 30 }, () => ({ who: 'you', text: 'y' })) });
  assert.ok(long.ok);
  assert.equal(long.value.history.length, HANDOFF_LIMITS.maxHistory);
});

test('the AI\'s line: "paused, chat <file>" instead of "while playing"', () => {
  const first = handoffLine({ kind: 'play', text: 'why?', paused: true, shot: '.studio/play/20261022-101500-123-play-ab12.jpg' }, '.studio/requests/20261022-101500-123-play-ab12.json');
  assert.equal(first, 'studio: request play .studio/requests/20261022-101500-123-play-ab12.json "why?" (paused, chat .studio/chat/20261022-101500-123-play-ab12.json, picture .studio/play/20261022-101500-123-play-ab12.jpg)');
  const next = handoffLine({ kind: 'play', text: 'fix it', paused: true, chat: '20261022-101500-123-play-ab12' }, '.studio/requests/20261022-101530-000-play-cd34.json');
  assert.match(next, /\(paused, chat \.studio\/chat\/20261022-101500-123-play-ab12\.json\)$/);
  // Not paused: as before.
  assert.match(handoffLine({ kind: 'play', text: 'x' }, '.studio/requests/r.json'), /\(while playing\)$/);
});

test('the talk\'s file: the first message makes it with the moment, each turn is added once', () => {
  const id = '20261022-101500-123-play-ab12';
  assert.equal(chatIdOf({ kind: 'play', paused: true, id }), id);
  assert.equal(chatIdOf({ kind: 'play', paused: true, id: 'x', chat: id }), id);
  assert.equal(chatIdOf({ kind: 'play', id }), null);
  assert.equal(chatIdOf({ kind: 'ask', paused: true, id }), null);
  assert.equal(chatIdOf(null), null);
  const you = { who: 'you', text: 'why?', at: '2026-10-22T10:15:00.123Z', request: id };
  let f = chatWithTurn(null, id, you, { shot: '.studio/play/x.jpg', near: [{ key: 'pad' }], text: 'not kept', kind: 'play' });
  let c = JSON.parse(f);
  assert.equal(c.version, 1);
  assert.equal(c.id, id);
  assert.equal(c.shot, '.studio/play/x.jpg');
  assert.deepEqual(c.near, [{ key: 'pad' }]);
  assert.equal(c.text, undefined);
  assert.deepEqual(c.turns, [you]);
  const ai = { who: 'ai', text: 'No floor.', at: '2026-10-22T10:15:05.000Z', request: id, state: 'done', changed: 0 };
  f = chatWithTurn(f, id, ai);
  f = chatWithTurn(f, id, ai); // the same status written twice
  c = JSON.parse(f);
  assert.equal(c.turns.length, 2);
  assert.equal(c.shot, '.studio/play/x.jpg', 'the moment stays');
  // A broken file, or another talk's: a new talk.
  assert.equal(JSON.parse(chatWithTurn('{oops', id, you)).turns.length, 1);
  assert.equal(JSON.parse(chatWithTurn(JSON.stringify({ id: 'other', turns: [ai] }), id, you)).turns.length, 1);
});

test('the stand-in AI answers a paused message with what was near, then with the talk so far', () => {
  assert.match(chatReplyFor({ near: [{ key: 'pad', label: 'Glowing pad' }] }), /Nearest you is "Glowing pad"/);
  assert.match(chatReplyFor({ history: [{ who: 'you', text: 'a' }, { who: 'ai', text: 'b' }] }), /^\(Following our 2 earlier messages\)/);
  assert.match(chatReplyFor({ lang: 'ja', near: [{ key: 'pad' }] }), /いちばん近いのは「pad」/);
});

test('the overlay has every word of the pause, in both languages', () => {
  for (const lang of ['en', 'ja'] as const) {
    const w = playWords((k) => translate(lang, k));
    for (const k of ['pauseTip', 'paused', 'resume', 'resumeTip', 'sees', 'seesError', 'seesErrors', 'chatPlaceholder', 'chatEmpty', 'send']) {
      assert.ok(w[k] && w[k] !== `play.${k}`, `${lang} play.${k}`);
    }
    assert.ok(w.seesErrors!.includes('#'));
  }
});

// ----- stage 2: moving things while paused (src/bridge/play-move.ts) -----
import { momentWhy, poseWords, samePose } from '../src/bridge/play-move.ts';

test('moving while paused: what can go in the layout, and what is the game\'s for this moment only', () => {
  const start = new Map([
    ['crate', { p: [1, 0, 2], r: 0 }],
    ['boat', { p: [5, 0, 5], r: 0.5 }],
    ['pine', { p: [0, 0, 0], r: 0 }],
    ['spun', { p: [3, 0, 3], r: 0 }],
  ]);
  const mine = new Map<string, { p: number[]; r?: number }>();
  const moving = new Set(['spun']);
  // Where Play started: still.
  assert.equal(momentWhy('crate', { p: [1, 0, 2], r: 0 }, start, mine, moving, '3d'), null);
  // Float noise is not motion (observe.ts' smallest change).
  assert.equal(momentWhy('crate', { p: [1 + 1e-5, 0, 2], r: 0 }, start, mine, moving, '3d'), null);
  // The game sailed it: this moment only.
  assert.equal(momentWhy('boat', { p: [7, 0, 4], r: 0.5 }, start, mine, moving, '3d'), 'game');
  // Bobbing (height) or turning only is the game's too: its place now is mid-motion.
  assert.equal(momentWhy('boat', { p: [5, 0.2, 5], r: 0.5 }, start, mine, moving, '3d'), 'game');
  assert.equal(momentWhy('pine', { p: [0, 0, 0], r: 0.1 }, start, mine, moving, '3d'), 'game');
  // Made by the game since Play started (an enemy, a bullet).
  assert.equal(momentWhy('bullet#3', { p: [0, 1, 0] }, start, mine, moving, '3d'), 'new');
  // A motion from the editor's draft moves it.
  assert.equal(momentWhy('spun', { p: [3, 0, 3], r: 0 }, start, mine, moving, '3d'), 'motion');
  // The person moved the crate in an earlier pause: that place is theirs, not the game's.
  mine.set('crate', { p: [4, 0, 2], r: 0 });
  assert.equal(momentWhy('crate', { p: [4, 0, 2], r: 0 }, start, mine, moving, '3d'), null);
  // 2D: half a pixel is noise, more is motion.
  const s2 = new Map([['urn', { p: [100, 200] }]]);
  assert.equal(momentWhy('urn', { p: [100.2, 200] }, s2, new Map(), new Set(), '2d'), null);
  assert.equal(momentWhy('urn', { p: [104, 200] }, s2, new Map(), new Set(), '2d'), 'game');
});

test('moving while paused: the card\'s numbers and "the same place"', () => {
  assert.equal(poseWords({ p: [8.46, 0, 9.6] }, '3d'), 'X 8.5 · Y 0.0 · Z 9.6');
  assert.equal(poseWords({ p: [120.4, 39.6] }, '2d'), 'X 120 · Y 40');
  assert.equal(poseWords({ p: [2.5, -0.01, 10.6] }, '3d'), 'X 2.5 · Y 0.0 · Z 10.6', 'no "-0.0"');
  assert.equal(samePose({ p: [1, 2, 3], r: 0 }, { p: [1, 2, 3], r: 0 }, '3d'), true);
  assert.equal(samePose({ p: [1, 2, 3], r: 0 }, { p: [1.5, 2, 3], r: 0 }, '3d'), false);
  assert.equal(samePose({ p: [1, 2, 3], s: 1 }, { p: [1, 2, 3], s: 1.2 }, '3d'), false);
  assert.equal(samePose(undefined, undefined, '3d'), true);
  assert.equal(samePose({ p: [1, 2, 3] }, undefined, '3d'), false);
});

test('moving while paused: its words, in both languages', () => {
  for (const lang of ['en', 'ja'] as const) {
    const w = playWords((k) => translate(lang, k));
    for (const k of ['move', 'moveTip', 'talk', 'talkTip', 'movePick', 'moveHow', 'moveOnly', 'moveMoment', 'moveMomentWhy', 'moveIn', 'toLayout', 'toLayoutTip', 'putBack', 'putBackTip']) {
      assert.ok(w[k] && w[k] !== `play.${k}`, `${lang} play.${k}`);
    }
  }
});
