// ▶ Play in the page on screen for the motions (studio-no-reload, 2026-10-22): shell/play-here.ts. With the game's
// loader's play hook (core/ready `motionHere`) every motion plays in the edit page; without it, those the editor's own
// runner plays (the start, a time, a key, another clip's end), and a clip that waits for the game opens a new page.
import test from 'node:test';
import assert from 'node:assert/strict';
import { motionsPlayHere } from '../src/shell/play-here.ts';

const clip = (when?: unknown, extra: Record<string, unknown> = {}) => ({ use: 'Hop', ...(when === undefined ? {} : { when }), ...extra });

test('no motion, or motions that start by themselves: here, with or without the hook', () => {
  for (const hook of [false, true]) {
    assert.equal(motionsPlayHere(undefined, hook), true);
    assert.equal(motionsPlayHere({}, hook), true);
    assert.equal(motionsPlayHere({ a: { clips: [clip(), clip({ on: 'time', after: 2 }), clip({ on: 'key', key: 'KeyE' }), clip({ on: 'after', use: 'Hop' })] } }, hook), true);
    // The timeline's own clip that starts at once, and the older path / spin.
    assert.equal(motionsPlayHere({ a: { clips: [{ name: 'm', start: true, keys: {} }] }, b: { path: [[1, 0, 0]] } }, hook), true);
  }
});

test('a clip that waits for the game: here only with the hook (was: a new Play page every time)', () => {
  for (const w of [{ on: 'click' }, { on: 'enter', box: [0, 0, 0, 1, 1, 1] }, { on: 'touch' }, { on: 'cue', cue: 'go' }, { on: 'say' }]) {
    const m = { a: { clips: [clip(w)] } };
    assert.equal(motionsPlayHere(m, true), true, `${w.on} with the hook`);
    assert.equal(motionsPlayHere(m, false), false, `${w.on} without it`);
  }
  // Words for the AI (a string `when`) and a timeline clip without `start`: the game's code starts them.
  assert.equal(motionsPlayHere({ a: { clips: [{ name: 'm', keys: {}, when: 'when the door opens' }] } }, false), false);
  assert.equal(motionsPlayHere({ a: { clips: [{ name: 'm', keys: {}, when: 'when the door opens' }] } }, true), true);
  // "E or a click": the click needs the game.
  assert.equal(motionsPlayHere({ a: { clips: [clip([{ on: 'key', key: 'KeyE' }, { on: 'click' }])] } }, false), false);
});
