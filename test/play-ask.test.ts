// Ask while playing (CONTRACT.md §3.5, 2026-10-20): the request's shape (src/schema/handoff.mjs "play"), the line the
// AI gets on stdout, what of the console goes with it and which key opens the field (src/bridge/play-ask.ts), and the
// one line over the game (src/shell/play-ask.ts). No browser; test/studio-play-ask.browser.mjs drives the real thing.
// Run: node --experimental-strip-types --no-warnings --test test/play-ask.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRequestInput, HANDOFF_LIMITS, REQUEST_KINDS } from '../src/schema/handoff.mjs';
import { handoffLine } from '../src/server/ai-watch.mjs';
import { isAskKey, logText, near2D, pickLogs, LOG_ERRORS, LOG_TAIL, type LogEntry } from '../src/bridge/play-ask.ts';
import { playLine, playWords } from '../src/shell/play-ask.ts';
import { translate } from '../src/shell/i18n.ts';
import type { StudioStatus } from '../src/contract.ts';

const SHOT = 'data:image/jpeg;base64,' + Buffer.from('fake jpeg').toString('base64');

test('a "play" request: the words plus the moment, each part a hint that is dropped when odd', () => {
  assert.ok(REQUEST_KINDS.includes('play'));
  const r = normalizeRequestInput({
    kind: 'play', text: 'when I stop here\nthe character vanishes', lang: 'en', dim: '3d', shot: SHOT,
    view: { eye: [1.23456, 2, 3], target: [1, 2, -7] },
    near: [{ key: 'hero', label: 'Hero', d: 2.3456, screen: [0.5, 0.61234], pose: { p: [1, 0, 2] } }, { key: 'bad key!' }, { key: 'rock', screen: [9, 9] }],
    logs: [{ level: 'error', text: 'TypeError: x is undefined', ago: 1.234 }, { level: 'debug', text: 'tick' }, { level: 'warn', text: '' }],
    fullscreen: true, size: [1280, 800], objects: undefined,
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  const v = (r as { value: Record<string, unknown> }).value;
  assert.equal(v.text, 'when I stop here the character vanishes');
  assert.equal(v.shot, SHOT, 'the host turns it into a file');
  assert.deepEqual(v.view, { eye: [1.235, 2, 3], target: [1, 2, -7] });
  assert.deepEqual(v.near, [{ key: 'hero', label: 'Hero', d: 2.35, screen: [0.5, 0.612], pose: { p: [1, 0, 2] } }, { key: 'rock' }]);
  assert.deepEqual(v.logs, [{ level: 'error', text: 'TypeError: x is undefined', ago: 1.2 }, { level: 'log', text: 'tick' }]);
  assert.equal(v.fullscreen, true);
  assert.deepEqual(v.size, [1280, 800]);
});

test('a "play" request needs words; a picture that is not a JPEG / PNG data URL is refused', () => {
  assert.equal(normalizeRequestInput({ kind: 'play', text: '  ' }).ok, false);
  for (const shot of ['data:text/html;base64,PGgxPg==', 'https://example.com/a.jpg', 'data:image/jpeg;base64,<script>', 'data:image/png;base64,' + 'A'.repeat(HANDOFF_LIMITS.maxShot)]) {
    assert.equal(normalizeRequestInput({ kind: 'play', text: 'x', shot }).ok, false, shot.slice(0, 30));
  }
  // Without a picture (a game made of HTML has no canvas) it is still a request.
  assert.equal(normalizeRequestInput({ kind: 'play', text: 'the door does not open' }).ok, true);
  // The moment's fields belong to "play" only.
  const ask = normalizeRequestInput({ kind: 'ask', text: 'x', shot: SHOT, logs: [{ level: 'error', text: 'e' }] }) as { ok: true; value: Record<string, unknown> };
  assert.equal(ask.value.shot, undefined);
  assert.equal(ask.value.logs, undefined);
  // At most maxLogs lines (the last ones) and maxNear things.
  const many = normalizeRequestInput({ kind: 'play', text: 'x', logs: Array.from({ length: 50 }, (_, i) => ({ level: 'log', text: `l${i}` })),
    near: Array.from({ length: 30 }, (_, i) => ({ key: `o${i}` })) }) as { ok: true; value: { logs: Array<{ text: string }>; near: unknown[] } };
  assert.equal(many.value.logs.length, HANDOFF_LIMITS.maxLogs);
  assert.equal(many.value.logs[0]!.text, 'l20');
  assert.equal(many.value.near.length, HANDOFF_LIMITS.maxNear);
});

test('the stdout line says it was asked while playing, where the picture is and how many errors came with it', () => {
  const p = '.studio/requests/20261020-101500-000-play-ab12.json';
  assert.equal(handoffLine({ kind: 'play', text: 'the character vanished', shot: '.studio/play/20261020-101500-000-play-ab12.jpg',
    logs: [{ level: 'error', text: 'a' }, { level: 'warn', text: 'b' }, { level: 'error', text: 'c' }] }, p),
  `studio: request play ${p} "the character vanished" (while playing, picture .studio/play/20261020-101500-000-play-ab12.jpg, 2 errors)`);
  assert.equal(handoffLine({ kind: 'play', text: 'too dark' }, p), `studio: request play ${p} "too dark" (while playing)`);
});

test('the console: every error / warning there is room for plus the last lines, oldest first, with how long ago', () => {
  const all: LogEntry[] = [];
  all.push({ level: 'error', text: 'early error', t: 0 });
  for (let i = 0; i < 100; i++) all.push({ level: 'log', text: `frame ${i}`, t: 1000 + i * 10 });
  const got = pickLogs(all, 5000);
  assert.equal(got[0]!.text, 'early error', 'an error is not pushed out by a chatty game');
  assert.equal(got[0]!.ago, 5);
  assert.equal(got.length, 1 + LOG_TAIL);
  assert.equal(got.at(-1)!.text, 'frame 99');
  const errs: LogEntry[] = Array.from({ length: 40 }, (_, i) => ({ level: 'warn' as const, text: `w${i}`, t: i }));
  assert.equal(pickLogs(errs, 100).length, LOG_ERRORS);
  assert.equal(logText(['hit', { hp: 0 }, new Error('boom')]).startsWith('hit {"hp":0} Error: boom'), true);
  assert.ok(logText(['x'.repeat(1000)]).length <= 300);
});

test('the key is ` by its character (US: left of 1; Japanese keyboard: Shift+@), never with ⌘ / Ctrl / Alt, never while typing', () => {
  assert.equal(isAskKey({ key: '`' }, false), true);
  assert.equal(isAskKey({ key: '`' }, true), false, 'the game\'s own chat box keeps it');
  for (const k of ['/', 'Enter', 'r', 'R', '~', 'Escape']) assert.equal(isAskKey({ key: k }, false), false, k);
  assert.equal(isAskKey({ key: '`', metaKey: true }, false), false);
  assert.equal(isAskKey({ key: '`', isComposing: true }, false), false);
});

test('2D: what is on screen, nearest the middle first, with where it is in the picture', () => {
  const at: Record<string, [number, number]> = { a: [100, 100], b: [500, 400], c: [-50, 10], d: [520, 380] };
  const got = near2D([{ key: 'a' }, { key: 'b', label: 'Hero' }, { key: 'c' }, { key: 'd' }, { key: 'e' }], (k) => at[k] ?? null, 1000, 800);
  assert.deepEqual(got.map((g) => g.key), ['b', 'd', 'a']);
  assert.deepEqual(got[0], { key: 'b', label: 'Hero', screen: [0.5, 0.5] });
});

test('the line over the game: looking → fixing → fixed (Reload only when the files changed) or a question to answer there', () => {
  const t = (k: string, v?: Record<string, string | number>) => translate('en', k, v);
  const st = (o: Partial<StudioStatus>): StudioStatus => ({ version: 1, state: 'working', ...o } as StudioStatus);
  assert.equal(playLine({ phase: 'none', status: null, codeChanged: false, t }), null);
  assert.equal(playLine({ phase: 'sent', status: null, codeChanged: false, t, asked: 'the character vanished' })!.text, 'Your AI is looking');
  assert.equal(playLine({ phase: 'seen', status: null, codeChanged: false, t })!.state, 'looking');
  assert.deepEqual(playLine({ phase: 'working', status: st({ note: 'Fixing the fall check.' }), codeChanged: true, t }), { state: 'fixing', text: 'Fixing the fall check…' });
  const done = playLine({ phase: 'done', status: st({ state: 'done', note: 'The character no longer falls through the bridge' }), codeChanged: true, t })!;
  assert.equal(done.state, 'fixed');
  assert.equal(done.reload, true);
  assert.equal(playLine({ phase: 'done', status: st({ state: 'done' }), codeChanged: false, t })!.reload, false, 'nothing to load: no Reload');
  assert.equal(playLine({ phase: 'done', status: st({ state: 'done' }), codeChanged: undefined, t })!.reload, true, 'a host that cannot tell: offered');
  assert.equal(playLine({ phase: 'done', status: st({ state: 'done' }), codeChanged: true, t })!.text, 'Fixed');
  const q = playLine({ phase: 'asking', status: st({ state: 'asking', note: 'Should it respawn at the last checkpoint?', choices: ['Checkpoint', 'Start'] }), codeChanged: false, t })!;
  assert.deepEqual([q.state, q.text, q.choices], ['asking', 'Should it respawn at the last checkpoint?', ['Checkpoint', 'Start']]);
  assert.equal(playLine({ phase: 'away', status: null, codeChanged: false, t })!.state, 'kept');
  assert.equal(playLine({ phase: 'failed', status: st({ state: 'failed' }), codeChanged: false, t })!.text, 'Your AI stopped before finishing.');
});

test('the overlay\'s words exist in English and Japanese', () => {
  for (const lang of ['en', 'ja'] as const) {
    const w = playWords((k) => translate(lang, k));
    for (const [k, v] of Object.entries(w)) assert.ok(v && !v.startsWith('play.'), `${lang} ${k}`);
  }
  assert.notEqual(translate('ja', 'play.looking'), translate('en', 'play.looking'));
});
