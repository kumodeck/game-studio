// AI feel (2026-10-16): what the AI line says (ai-flow.ts), when the game reloads by itself, and
// when typing in the ask field opens the ⌘K list (palette.ts). No browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aiBusy, aiPhase, reloadDecision, QUIET_MS, NUDGE_MS, type AiFlowState } from '../src/shell/ai-flow.ts';
import { suggests, type PaletteSection } from '../src/shell/palette.ts';

const ID = '20261016-153012-482-ask-9f3c';
const LATER = '20261016-153013-000-ask-0001';
const base = (o: Partial<AiFlowState> = {}): AiFlowState => ({
  now: 10_000, offline: false, pending: { kind: 'ask', id: ID, at: 9_000, sent: 9_000, text: 'Add three lighthouses' },
  status: null, statusTime: null, openedAt: 1_000, watching: false, reloading: false, after: null, ...o,
});

test('nobody watching: "away" at once, not after 20 s', () => {
  assert.equal(aiPhase(base({ now: 9_100 })), 'away');
  assert.equal(aiBusy('away'), false, 'no light when nobody will answer');
});

test('a watch is running: sent → seen (the watch printed it) → the agent\'s own states', () => {
  assert.equal(aiPhase(base({ watching: true })), 'sent');
  assert.equal(aiPhase(base({ watching: true, seen: ID })), 'seen');
  assert.equal(aiPhase(base({ watching: false, seen: LATER })), 'seen', 'a later id printed = this one was printed too');
  const st = (state: 'received' | 'working' | 'done' | 'failed') => base({ watching: true, status: { state, request: ID } as never, statusTime: 9_500 });
  assert.equal(aiPhase(st('received')), 'received');
  assert.equal(aiPhase(st('working')), 'working');
  assert.equal(aiPhase(st('done')), 'done');
  assert.equal(aiPhase({ ...st('done'), reloading: true }), 'updating');
  for (const p of ['sent', 'seen', 'received', 'working', 'updating'] as const) assert.equal(aiBusy(p), true, p);
  for (const p of ['done', 'failed', 'none', 'undone'] as const) assert.equal(aiBusy(p), false, p);
});

test('hosts that cannot tell (watching undefined) and the offline demo keep the old line', () => {
  assert.equal(aiPhase(base({ watching: undefined, now: 9_000 + NUDGE_MS - 1 })), 'waiting');
  assert.equal(aiPhase(base({ watching: undefined, now: 9_000 + NUDGE_MS + 1 })), 'nudge');
  assert.equal(aiPhase(base({ offline: true, watching: undefined, now: 99_000 })), 'waiting');
});

test('an old "done" from before the page opened is not news; Undo / Redo win over everything', () => {
  assert.equal(aiPhase(base({ pending: null, status: { state: 'done' } as never, statusTime: 500 })), 'none');
  assert.equal(aiPhase(base({ pending: null, status: { state: 'done' } as never, statusTime: 5_000 })), 'done');
  assert.equal(aiPhase(base({ after: 'undone' })), 'undone');
});

test('reload: only when the files changed; at once when the AI is done; waits while it works', () => {
  const r = (o: Partial<Parameters<typeof reloadDecision>[0]>) =>
    reloadDecision({ code: 'b', loadedCode: 'a', stableMs: 0, phase: 'none', playing: false, reloading: false, ...o });
  assert.equal(r({ code: 'a' }), 'no');
  assert.equal(r({ loadedCode: undefined }), 'no', 'nothing to compare with yet');
  assert.equal(r({ phase: 'done' }), 'now');
  assert.equal(r({ phase: 'working', stableMs: 3000 }), 'wait', 'the AI may write several files');
  // Real Claude run 10/17: 20-40 s of quiet while it shoots the game (--shot) and fixes it. Not a reason to reload.
  assert.equal(r({ phase: 'working', stableMs: 45_000 }), 'wait', 'looking at the game between writes');
  assert.equal(r({ phase: 'received', stableMs: 45_000 }), 'wait');
  assert.equal(r({ phase: 'seen', stableMs: 45_000 }), 'wait');
  assert.equal(r({ phase: 'failed' }), 'now');
  assert.equal(r({ phase: 'working', stableMs: QUIET_MS }), 'now', 'an AI that forgot "done"');
  assert.equal(r({ phase: 'none', stableMs: 0 }), 'wait', 'just changed: one more poll');
  assert.equal(r({ phase: 'none', stableMs: 2000 }), 'now', 'edited by hand, then quiet');
  assert.equal(r({ phase: 'done', playing: true }), 'no');
  assert.equal(r({ phase: 'done', reloading: true }), 'no');
});

test('typing opens the list only when a word names an action or an object', () => {
  const rows: Array<{ section: PaletteSection; label: string; words?: string }> = [
    { section: 'ask', label: 'Make it night' },
    { section: 'ask', label: 'Add 3 more of crate in a row' },
    { section: 'actions', label: 'Undo', words: 'undo back' },
    { section: 'actions', label: 'Play the game' },
    { section: 'objects', label: 'lighthouse' },
  ];
  assert.equal(suggests('', rows), false, 'pressing the field opens nothing');
  assert.equal(suggests('Ma', rows), false, 'two letters say nothing yet');
  assert.equal(suggests('Make', rows), false, 'the AI examples are not suggestions');
  assert.equal(suggests('Add three lighthouses around the island', rows), false, 'a sentence is for the AI');
  assert.equal(suggests('undo', rows), true);
  assert.equal(suggests('play', rows), true);
  assert.equal(suggests('lightho', rows), true, 'an object by name');
  assert.equal(suggests('ndo', rows), false, 'inside a word only: no');
  const ja = [{ section: 'actions' as PaletteSection, label: '素材を開く' }];
  assert.equal(suggests('素材', ja), true, 'two Japanese characters are a word');
  assert.equal(suggests('素', ja), false);
});
