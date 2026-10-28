// This moment's values (pause-edit stage 2, 2026-10-28; CONTRACT.md §1.14): the loader's codeMoment({ values }) and the
// game page's hands for it (src/bridge/moment-values.ts) — the values read (name, unit, min / max / step / round), a
// change kept inside min / max and on its step, a value with no set() shown only, and a get() that throws (or answers
// words) never stopping the list. The editor page's side (the moment's list, the knob, one frame drawn, ⌘Z, the AI's
// `--do moment.set`) is test/moment-shelf.test.ts, test/ai-hands-shell.test.ts and test/studio-pause.browser.mjs.
// Run: node --experimental-strip-types --no-warnings --test test/moment-values.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { codeMoment } from '../src/loader/studio-placement.js';
import { fitValue, momentEntries, readMoment, setValue, startMomentValues } from '../src/bridge/moment-values.ts';

const MOMENT = Symbol.for('game-studio.moment');
const g = globalThis as unknown as Record<string | symbol, unknown> & Window & typeof globalThis;
const fresh = () => {
  delete g[MOMENT];
};

/** The example's run, in plain code (examples/three-neon-boss: score, time left, health), delivered as the AI would. */
function game() {
  const s = { score: 12480.6, timeLeft: 18.4, hp: 3, wave: 'boss' };
  codeMoment({ values: {
    score: { name: 'Score', get: () => s.score, set: (v: number) => { s.score = v; }, round: 0 },
    timeLeft: { name: 'Time left', unit: 's', min: 0, get: () => s.timeLeft, set: (v: number) => { s.timeLeft = v; } },
    hp: { name: 'Health', min: 0, max: 5, step: 1, get: () => s.hp, set: (v: number) => { s.hp = v; } },
    wave: { name: 'Wave', get: () => s.wave },
  } });
  return s;
}

test('codeMoment: the values in order, with name, unit, min / max / step / round; no set = shown only', () => {
  fresh();
  game();
  const v = readMoment(g)!;
  assert.deepEqual(v.map((x) => x.id), ['score', 'timeLeft', 'hp', 'wave']);
  assert.deepEqual(v[0], { id: 'score', name: 'Score', v: 12480.6, unit: '', set: true, round: 0 });
  assert.deepEqual(v[1], { id: 'timeLeft', name: 'Time left', v: 18.4, unit: 's', min: 0, set: true });
  assert.deepEqual(v[2], { id: 'hp', name: 'Health', v: 3, unit: '', min: 0, max: 5, step: 1, set: true });
  // Words: shown as words, never changed (no knob for "boss").
  assert.deepEqual(v[3], { id: 'wave', name: 'Wave', v: null, text: 'boss', unit: '', set: false });
});

test('codeMoment: nothing on globalThis before it is called (a game without it: the moment\'s one line)', () => {
  fresh();
  assert.equal(readMoment(g), null);
  assert.equal(momentEntries(g), null);
});

test('codeMoment: a bad id or a value without get() is left out (said once); a second call replaces the same id only', () => {
  fresh();
  const warns: string[] = [];
  const was = console.warn;
  console.warn = (m: string) => warns.push(String(m));
  try {
    codeMoment({ values: { '9lives': { get: () => 9 }, 'no get': { name: 'X' }, lives: { name: 'Lives', get: () => 3 } } as never });
  } finally {
    console.warn = was;
  }
  assert.deepEqual(readMoment(g)!.map((x) => x.id), ['lives']);
  assert.equal(warns.length, 2);
  codeMoment({ values: { lives: { name: 'Lives', get: () => 2 }, coins: { name: 'Coins', get: () => 40 } } });
  assert.deepEqual(readMoment(g)!.map((x) => [x.id, x.v]), [['lives', 2], ['coins', 40]]);
  // A min over its max: the max is dropped (the editor would have no range to keep the value in).
  codeMoment({ values: { odd: { get: () => 1, min: 5, max: 1 } } });
  assert.equal(readMoment(g)!.find((x) => x.id === 'odd')!.max, undefined);
  // No values at all, or nothing: no throw.
  codeMoment(undefined as never);
  codeMoment({} as never);
});

// pause-light (2026-10-28): the paused picture's draw (the game's frame drawing without its update), read by the three.js
// adapter (paintMoment) from the same object as the values. The loader only keeps it.
test('codeMoment({ draw }): kept beside the values, replaced by a new one, taken away by null; the loader never calls it', () => {
  fresh();
  let calls = 0;
  const draw = () => { calls++; };
  codeMoment({ draw });
  const m = () => g[MOMENT] as { values: Map<string, unknown>; draw?: () => void };
  assert.equal(m().draw, draw);
  // A draw alone is no value: the moment's list says the one line, as a game without codeMoment values.
  assert.deepEqual(readMoment(g), []);
  game();
  assert.equal(m().draw, draw, 'values given later leave the draw');
  const draw2 = () => {};
  codeMoment({ draw: draw2 });
  assert.equal(m().draw, draw2);
  assert.equal(m().values.size, 4, 'a new draw leaves the values');
  const warns: string[] = [];
  const was = console.warn;
  console.warn = (w: string) => warns.push(String(w));
  try {
    codeMoment({ draw: 'composer' } as never);
  } finally {
    console.warn = was;
  }
  assert.equal(m().draw, draw2, 'not a function: kept as it was');
  assert.match(warns.join(' '), /draw must be a function/);
  codeMoment({ draw: null } as never);
  assert.equal('draw' in m(), false);
  assert.equal(calls, 0);
});

test('fitValue: on the step (from min), inside min / max, without float dust', () => {
  assert.equal(fitValue(7.4, { min: 0, max: 5, step: 1 }), 5);
  assert.equal(fitValue(-2, { min: 0 }), 0);
  assert.equal(fitValue(2.6, { min: 0, max: 5, step: 1 }), 3);
  assert.equal(fitValue(4, { min: 1, step: 2 }), 5);
  assert.equal(fitValue(0.1 + 0.2, {}), 0.3);
  assert.equal(fitValue(12345.678, {}), 12345.678);
  assert.equal(fitValue(-0, { step: 1 }), 0);
  assert.ok(!Object.is(fitValue(-0.2, { step: 1 }), -0));
});

test('setValue: set(v) inside the range and on the step; the value read back', () => {
  fresh();
  const s = game();
  assert.deepEqual(setValue(g, 'timeLeft', 5), { ok: true, v: 5 });
  assert.equal(s.timeLeft, 5);
  assert.deepEqual(setValue(g, 'timeLeft', -3), { ok: true, v: 0 });
  assert.deepEqual(setValue(g, 'hp', 9.7), { ok: true, v: 5 });
  assert.equal(s.hp, 5);
  assert.deepEqual(setValue(g, 'hp', 1.4), { ok: true, v: 1 });
});

test('setValue: the refusals say what to do (no codeMoment, an unknown id, shown only, not a number)', () => {
  fresh();
  assert.match((setValue(g, 'score', 1) as { error: string }).error, /the game has no codeMoment\(\)/);
  game();
  assert.equal((setValue(g, 'lives', 1) as { error: string }).error, 'the game\'s codeMoment() has no "lives" (it has: "score", "timeLeft", "hp", "wave")');
  assert.match((setValue(g, 'wave', 1) as { error: string }).error, /"wave" \(Wave\) is shown only: its codeMoment\(\) value has no set\(v\)/);
  assert.equal((setValue(g, 'score', '5') as { error: string }).error, '"v" must be a number');
  assert.equal((setValue(g, 'score', Number.NaN) as { error: string }).error, '"v" must be a number');
});

test('a get() that throws, or a set() that throws, never stops the list', () => {
  fresh();
  let hp = 3;
  codeMoment({ values: {
    boom: { name: 'Boom', get: () => { throw new Error('ship is undefined\n    at get (game.js:12)'); }, set: () => {} },
    hp: { name: 'Health', get: () => hp, set: () => { throw new Error('read only'); } },
    nothing: { name: 'Nothing', get: () => undefined },
  } });
  const v = readMoment(g)!;
  assert.deepEqual(v[0], { id: 'boom', name: 'Boom', v: null, unit: '', set: false, error: 'ship is undefined' });
  assert.equal(v[1]!.v, 3);
  assert.deepEqual(v[2], { id: 'nothing', name: 'Nothing', v: null, unit: '', set: false, text: '' });
  assert.equal((setValue(g, 'boom', 1) as { error: string }).error, '"boom" (Boom): its get() failed (ship is undefined)');
  assert.equal((setValue(g, 'hp', 1) as { error: string }).error, '"hp" (Health): its set(v) failed (read only)');
  assert.equal(hp, 3);
});

test('the game page answers moment/ask and moment/set — a change only while paused, then ONE frame drawn', () => {
  fresh();
  const s = game();
  const sent: unknown[] = [];
  const listeners: Array<(ev: MessageEvent) => void> = [];
  const parent = { postMessage: (m: unknown) => sent.push(m) };
  const win = { parent, addEventListener: (_: string, fn: (ev: MessageEvent) => void) => listeners.push(fn), [MOMENT]: g[MOMENT] } as unknown as Window & typeof globalThis;
  let paused = false;
  let drawn = 0;
  startMomentValues({ win, parentOrigin: 'http://studio', paused: () => paused, draw: () => drawn++ });
  const say = (data: unknown, origin = 'http://studio') => listeners.forEach((fn) => fn({ source: parent, origin, data } as unknown as MessageEvent));
  say({ type: 'studio:moment/ask' });
  assert.equal((sent.at(-1) as { values: unknown[] }).values.length, 4);
  // `settle` while playing: nothing drawn (only a paused moment's first ask draws its frame).
  say({ type: 'studio:moment/ask', settle: true });
  assert.equal(drawn, 0);
  // Playing (not paused): refused, nothing changed, nothing drawn.
  say({ type: 'studio:moment/set', id: 'timeLeft', v: 5, n: 1 });
  assert.deepEqual((sent.at(-1) as { set: unknown }).set, { id: 'timeLeft', n: 1, ok: false, error: 'the game is not paused' });
  assert.equal(s.timeLeft, 18.4);
  assert.equal(drawn, 0);
  paused = true;
  say({ type: 'studio:moment/set', id: 'timeLeft', v: 5, n: 2 });
  const r = sent.at(-1) as { values: Array<{ id: string; v: number }>; set: unknown };
  assert.deepEqual(r.set, { id: 'timeLeft', n: 2, ok: true, v: 5 });
  assert.equal(r.values.find((x) => x.id === 'timeLeft')!.v, 5);
  assert.equal(drawn, 1);
  // The moment came up (`settle`, paused): its frame drawn once before any change.
  say({ type: 'studio:moment/ask', settle: true });
  assert.equal(drawn, 2);
  // Another page's message, or not the parent: ignored.
  const n = sent.length;
  say({ type: 'studio:moment/ask' }, 'http://elsewhere');
  assert.equal(sent.length, n);
});
