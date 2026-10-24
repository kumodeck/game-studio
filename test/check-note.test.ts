// The self-check line at the top of the list (studio-blank-level, 2026-10-23; src/shell/check-note.ts). A hands-on
// try on NEON DASH showed "Moving things may not show in this game yet. Your AI has the details." — "I don't know what
// that means": the check had moved something the game itself puts back every frame. Those are not shown any more.
// Run: node --experimental-strip-types --no-warnings --test test/check-note.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkNoteId } from '../src/shell/check-note.ts';
import type { SelfCheckResult } from '../src/contract.ts';

const failed = (sample: string, ...ids: SelfCheckResult['checks'][number]['id'][]): SelfCheckResult => ({
  ok: false, kind: 'three', sample,
  checks: [{ id: 'adapter-found', ok: true }, { id: 'has-objects', ok: true }, ...ids.map((id) => ({ id, ok: false }))],
});

test('a real fault on an object the game leaves alone still shows its line', () => {
  assert.equal(checkNoteId(failed('gate', 'screen-changes'), [{ key: 'gate' }]), 'screen-changes');
  assert.equal(checkNoteId({ ...failed('gate'), ok: true }, [{ key: 'gate' }]), null);
  assert.equal(checkNoteId(null, []), null);
});

test('no line when the move test hit what the game moves, the ground / sky, or a hidden object', () => {
  assert.equal(checkNoteId(failed('hex-1', 'screen-changes'), [{ key: 'hex-1', held: 'game' }]), null, 'the game slides it every frame');
  assert.equal(checkNoteId(failed('sky', 'screen-changes', 'anchor-follows'), [{ key: 'sky', backdrop: true, held: 'ground' }]), null, 'the sky');
  assert.equal(checkNoteId(failed('path:12', 'screen-changes'), [{ key: 'road', backdrop: true }]), null, 'gone from the list (a blank level hid it)');
});

test('a check that does not move anything is still shown then', () => {
  assert.equal(checkNoteId(failed('hex-1', 'keys-valid', 'screen-changes'), [{ key: 'hex-1', held: 'game' }]), 'keys-valid');
});

// studio-fix-0146 (2026-10-24): a New level on Lantern Cove (its sea is not listed) has nothing in its list, and the
// top said "Nothing in this game can be selected yet" over the Library's "Not in this level". The level is empty, not the game.
test('a blank level with nothing listed does not say the game has nothing to select', () => {
  const none: SelfCheckResult = { ok: false, kind: 'three', checks: [{ id: 'adapter-found', ok: true }, { id: 'has-objects', ok: false }] };
  assert.equal(checkNoteId(none, [], true), null, 'a blank level');
  assert.equal(checkNoteId(none, []), 'has-objects', 'an ordinary page still says it');
});
