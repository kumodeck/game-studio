// pause-ask stage 2 (2026-11-02; src/shell/moment-marks.ts, moment-gets.ts):
// ◎ Mark on the paused frame and what the request carries. The screen: test/studio-pause.browser.mjs (moment).
// Run: node --experimental-strip-types --no-warnings --test test/moment-marks.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { markBox, markChip, markFromPress, markNumber, renumber, MARKS_MAX } from '../src/shell/moment-marks.ts';
import { getsRows, orderMarked } from '../src/shell/moment-gets.ts';
import { translate } from '../src/shell/i18n.ts';
import { normalizeRequestInput, HANDOFF_LIMITS } from '../src/schema/handoff.mjs';
import { handoffLine } from '../src/server/ai-watch.mjs';
import type { MomentMark } from '../src/contract.ts';

test('a press: a click (or a small wobble) is a point where it was pressed; a drag is an area, ordered, inside the frame', () => {
  assert.deepEqual(markFromPress(400, 300, 403, 302, 1000, 600), { kind: 'point', screen: [0.4, 0.5] });
  assert.deepEqual(markFromPress(600, 400, 300, 100, 1000, 500), { kind: 'area', screen: [0.3, 0.2, 0.6, 0.8] }, 'dragged up-left: still top-left first');
  assert.deepEqual(markFromPress(900, 100, 1200, -50, 1000, 500), { kind: 'area', screen: [0.9, 0, 1, 0.2] }, 'past the edge: kept on the frame');
  assert.equal(markFromPress(1, 1, 2, 2, 0, 0), null);
});

test('numbers: ① ② … on the chips and pins, closing up after a delete', () => {
  assert.equal(markNumber(1), '①');
  assert.equal(markNumber(9), '⑨');
  const ms: MomentMark[] = [{ n: 1, kind: 'point', screen: [0, 0] }, { n: 2, kind: 'area', screen: [0, 0, 1, 1] }, { n: 3, kind: 'point', screen: [1, 1] }];
  assert.deepEqual(renumber(ms.filter((m) => m.n !== 2)).map((m) => m.n), [1, 2]);
  const words = { here: translate('en', 'mark.here'), area: translate('en', 'mark.area') };
  assert.equal(markChip(ms[0]!, words), '① here');
  assert.equal(markChip(ms[1]!, words), '② area');
  assert.equal(markChip(ms[0]!, { here: translate('ja', 'mark.here'), area: translate('ja', 'mark.area') }), '① ここ');
  assert.deepEqual(markBox({ n: 1, kind: 'area', screen: [0.25, 0.1, 0.75, 0.6] }), { left: 25, top: 10, width: 50, height: 50 });
  assert.equal(MARKS_MAX, HANDOFF_LIMITS.maxMarks, 'the editor stops where the host would cut');
});

test('the request json: marks, the marked picture, objects with kind / from, time, level, this moment\'s numbers', () => {
  const shot = 'data:image/jpeg;base64,/9j/4AAQ';
  const r = normalizeRequestInput({ kind: 'play', text: 'Bring the boss in from here', paused: true, shot, shotMarked: shot,
    marks: [
      { n: 1, kind: 'point', screen: [0.3612, 0.4201], world: [-8.123, 0, -21.456], key: 'gate' },
      { n: 2, kind: 'area', screen: [0.3, 0.3, 0.5, 0.6], keys: ['gate', 'hex-2', 'bad key!'] },
      { n: 3, kind: 'point', screen: [3, 0.5] }, // off the frame: dropped
      { n: 4, kind: 'area', screen: [0.1, 0.2] }, // an area needs 4 numbers: dropped
    ],
    objects: [{ key: 'boss', kind: 'made', from: { file: 'src/boss.js', line: 42 } }, { key: 'gate', kind: 'nope', from: { file: '../etc/passwd', line: 1 } }],
    time: 5.0234, level: 'level-1', moment: { score: 13097, timeLeft: 24.8567, name: 'Ann' } });
  assert.ok(r.ok, JSON.stringify(r));
  const v = r.value as Record<string, unknown>;
  assert.deepEqual(v.marks, [
    { n: 1, kind: 'point', screen: [0.361, 0.42], world: [-8.12, 0, -21.46], key: 'gate' },
    { n: 2, kind: 'area', screen: [0.3, 0.3, 0.5, 0.6], keys: ['gate', 'hex-2'] },
  ]);
  assert.equal(v.shotMarked, shot, 'kept as a data URL here; the host writes it to <id>-marked.jpg');
  assert.deepEqual(v.objects, [{ key: 'boss', kind: 'made', from: { file: 'src/boss.js', line: 42 } }, { key: 'gate' }], 'a bad kind / a path out of the folder: dropped, never an error');
  assert.equal(v.time, 5.02);
  assert.equal(v.level, 'level-1');
  assert.deepEqual(v.moment, { score: 13097, timeLeft: 24.857 }, 'numbers only');
  // Not a picture: refused (the host writes it to a file).
  assert.equal(normalizeRequestInput({ kind: 'play', text: 'x', paused: true, shotMarked: 'data:text/html;base64,PGgxPg==' }).ok, false);
  // Only paused requests carry them (asked while playing has no marks).
  const playing = normalizeRequestInput({ kind: 'play', text: 'x', marks: [{ n: 1, kind: 'point', screen: [0.5, 0.5] }], objects: [{ key: 'boss', kind: 'made' }] });
  assert.ok(playing.ok);
  assert.equal((playing.value as Record<string, unknown>).marks, undefined);
  assert.deepEqual((playing.value as Record<string, unknown>).objects, [{ key: 'boss' }]);
  // An "ask" from Edit: none of it.
  const ask = normalizeRequestInput({ kind: 'ask', text: 'x', marks: [{ n: 1, kind: 'point', screen: [0.5, 0.5] }], time: 3 });
  assert.equal((ask.value as Record<string, unknown>).marks, undefined);
  assert.equal((ask.value as Record<string, unknown>).time, undefined);
});

test('the AI\'s line names the marks and the marked picture', () => {
  const line = handoffLine({ kind: 'play', text: 'here', paused: true, chat: '20261102-120000-000-play-abcd', shot: '.studio/play/x.jpg', shotMarked: '.studio/play/x-marked.jpg',
    marks: [{ n: 1, kind: 'point', screen: [0.5, 0.5] }] }, '.studio/requests/x.json');
  assert.match(line, /picture \.studio\/play\/x\.jpg, 1 mark, marked picture \.studio\/play\/x-marked\.jpg/);
});

test('what Claude gets: four rows, always — the frame, what the words are about and its code place, the numbers, this moment kept', () => {
  const t = (k: string, v?: Record<string, string | number>) => translate('en', k, { ai: 'Claude', Ai: 'Claude', ...(v ?? {}) });
  const rows = getsRows({ at: '0:05.02', marks: [{ n: 1, kind: 'point', screen: [0.4, 0.4] }], objects: [{ name: 'boss', kind: 'made', from: { file: 'src/boss.js', line: 42 } }],
    values: ['Score 13,097', 'Time left 24.86 s'], level: 'level-1', near: 3, errors: 1, logs: 4 }, t);
  assert.equal(rows.length, 4);
  assert.equal(rows[0]!.title, 'This frame at 0:05.02, with your marks ①');
  assert.equal(rows[0]!.sub, 'As the player saw it, and a copy with your marks drawn on');
  assert.equal(rows[1]!.title, 'boss · made by the game');
  assert.equal(rows[1]!.code, 'src/boss.js:42');
  // What the game made: the line that makes it (fix △8: "From" said from what?).
  assert.equal(rows[1]!.sub, 'Made at');
  assert.equal(rows[2]!.title, 'Score 13,097 · Time left 24.86 s');
  // The console's errors go with the numbers since stage 3 (the 4th row is the kept moment).
  assert.equal(rows[2]!.sub, 'Level: level-1 · 3 things near the player · 1 error in the console');
  // fix △3: the title says what is kept (it said "This moment, kept" over "The time only…").
  assert.equal(rows[3]!.title, 'Kept to replay from 0:05.02');
  assert.equal(rows[3]!.sub, 'To try the fix from here, with the new code');
  // Nothing selected, nothing marked, no codeMoment, no errors: the rows still say what goes.
  const bare = getsRows({ at: '0:01.00', marks: [], objects: [], values: [], near: 0, errors: 0, logs: 0 }, t);
  assert.deepEqual(bare.map((r) => r.title), ['This frame at 0:01.00', 'Nothing selected or marked', 'Game time 0:01.00', 'Kept to replay from 0:01.00']);
  assert.equal(bare[2]!.sub, 'Where the player is looking');
  // pause-ask stage 3: a game without save / load keeps the time only (decided 2026-11-02: the AI adds them with the fix).
  const timeOnly = getsRows({ at: '0:01.00', marks: [], objects: [], values: [], near: 0, errors: 0, logs: 0, kept: 'time' }, t)[3]!;
  assert.equal(timeOnly.title, 'Time only: 0:01.00');
  assert.equal(timeOnly.sub, 'This game can’t start mid-run yet. Claude adds that with its fix.');
  const demo = getsRows({ at: '0:01.00', marks: [], objects: [], values: [], near: 0, errors: 0, logs: 0, kept: 'none' }, t)[3]!;
  assert.equal(demo.title, 'Not kept in the demo');
  // VOICE.md rule 5: curly apostrophes on screen.
  for (const k of ['gets.title', 'mark.hint', 'mark.tip', 'gets.nothingSub', 'moment.shotOpen', 'gets.keptTime', 'try.sameRun', 'cmp.keep']) assert.doesNotMatch(translate('en', k), /'/, k);
});

test('fix △1: in the scene / moved by you / the code line of what was placed', () => {
  const t = (k: string, v?: Record<string, string | number>) => translate('en', k, { ai: 'Claude', Ai: 'Claude', ...(v ?? {}) });
  const base = { at: '0:07.37', marks: [], values: [], near: 0, errors: 0, logs: 0 };
  const road = getsRows({ ...base, objects: [{ name: 'road', kind: 'placed', from: { file: 'game.js', line: 49 } }] }, t)[1]!;
  assert.equal(road.title, 'road · in the scene', 'the game shipped the road: not "placed by you"');
  assert.equal(road.sub, 'Code:');
  assert.equal(road.code, 'game.js:49');
  assert.equal(getsRows({ ...base, objects: [{ name: 'gate', kind: 'placed', mine: true }] }, t)[1]!.title, 'gate · moved by you');
});

test('fix △1: what the game made first, then what it moves, then what stands in the scene; selected first; the page order kept', () => {
  const kinds: Record<string, 'placed' | 'moves' | 'made'> = { road: 'placed', edge: 'placed', 'edge#2': 'placed', boss: 'made', drone: 'made', 'drone#2': 'made', ship: 'moves' };
  // The walk's circle round the boss: the page gave the road first (now nearest the middle first; here as it came).
  assert.deepEqual(orderMarked([], ['road', 'edge', 'edge#2', 'boss', 'drone', 'drone#2'], (k) => kinds[k]), ['boss', 'drone', 'drone#2', 'road', 'edge', 'edge#2']);
  assert.deepEqual(orderMarked(['gate'], ['ship', 'road', 'boss', 'gate', 'boss'], (k) => kinds[k]), ['gate', 'boss', 'ship', 'road'], 'selected stays first; each key once');
  assert.deepEqual(orderMarked([], ['x', 'boss'], () => undefined), ['x', 'boss'], 'unknown kinds keep the page order');
});

test('fix △2: a mark with nothing under it is still named — a spot on the ground, with where it is', () => {
  const t = (k: string, v?: Record<string, string | number>) => translate('en', k, { ai: 'Claude', Ai: 'Claude', ...(v ?? {}) });
  const base = { at: '0:05.40', objects: [], values: [], near: 0, errors: 0, logs: 0 };
  const ground = getsRows({ ...base, marks: [{ n: 1, kind: 'point', screen: [0.4, 0.5], world: [-4.73, 0, -10.81] }] }, t)[1]!;
  assert.equal(ground.title, '① a spot on the ground');
  assert.equal(ground.sub, 'x \u22124.7, z \u221210.8');
  const flat = getsRows({ ...base, marks: [{ n: 1, kind: 'point', screen: [0.4, 0.5], world: [120, 340] }, { n: 2, kind: 'area', screen: [0, 0, 0.2, 0.2] }] }, t)[1]!;
  assert.equal(flat.title, '① a spot in the frame +1 more');
  assert.equal(flat.sub, 'x 120.0, y 340.0');
  const area = getsRows({ ...base, marks: [{ n: 1, kind: 'area', screen: [0, 0, 0.2, 0.2] }] }, t)[1]!;
  assert.equal(area.title, '① an area of the frame');
  assert.equal(area.sub, 'Where you marked it in the picture');
  assert.notEqual(ground.title, t('gets.nothing'));
});
