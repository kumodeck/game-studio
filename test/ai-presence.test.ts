// Is the AI there, said before typing (ai-presence.ts, a hands-on review 2026-10-23). No browser.
// The rule under every case: a wrong green is worse than none, so the green states and "away" each need proof.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aiPresence, aiNameKey, presenceSure, AWAY_AFTER_MS, HERE_STATUS_MS, type PresenceState } from '../src/shell/ai-presence.ts';

const NOW = 1_000_000;
const base = (o: Partial<PresenceState> = {}): PresenceState => ({
  now: NOW, watching: false, agent: 'claude', phase: 'none', statusTime: null, lastWatching: null, visibleSince: 0, ...o,
});

test('a fresh heartbeat is "watching", whoever the AI is', () => {
  assert.equal(aiPresence(base({ watching: true })), 'watching');
  assert.equal(aiPresence(base({ watching: true, agent: undefined })), 'watching');
  assert.equal(aiPresence(base({ watching: true, agent: 'codex' })), 'watching', 'a Codex with a watch running');
  assert.equal(presenceSure('watching'), true);
});

test('the AI holding a request right now is "working" even with no heartbeat (a turn the plugin woke it into)', () => {
  for (const phase of ['seen', 'received', 'working', 'updating', 'asking'] as const) assert.equal(aiPresence(base({ phase })), 'working', phase);
  assert.equal(aiPresence(base({ statusTime: NOW - HERE_STATUS_MS + 1 })), 'working', 'it just wrote its status');
  assert.equal(aiPresence(base({ statusTime: NOW - 1000, phase: 'done' })), 'watching', 'its "done" just now: here, not working');
  assert.equal(aiPresence(base({ statusTime: NOW - HERE_STATUS_MS })), 'unsure', 'an older status proves nothing');
  assert.equal(presenceSure('working'), true);
});

test('"away" only for Claude, seen watching in this page, gone for a minute while the page was visible', () => {
  assert.equal(aiPresence(base({ lastWatching: NOW - AWAY_AFTER_MS })), 'away');
  assert.equal(aiPresence(base({ lastWatching: NOW - AWAY_AFTER_MS + 1 })), 'unsure', 'a watch restarting / a turn ending is seconds');
  assert.equal(aiPresence(base({ lastWatching: null })), 'unsure', 'never seen: Claude may be open without the plugin');
  assert.equal(aiPresence(base({ lastWatching: NOW - 10 * AWAY_AFTER_MS, visibleSince: NOW - 1000 })), 'unsure', 'just back from a hidden tab');
  assert.equal(aiPresence(base({ agent: undefined, lastWatching: NOW - 10 * AWAY_AFTER_MS })), 'unsure');
  assert.equal(aiPresence(base({ watching: undefined, lastWatching: NOW - 10 * AWAY_AFTER_MS })), 'unsure', 'a host that cannot tell');
  for (const p of ['away', 'unsure', 'look'] as const) assert.equal(presenceSure(p), false, p);
});

test('Codex without a watch: its rule ("type look"), never "not sure" and never "away"', () => {
  assert.equal(aiPresence(base({ agent: 'codex' })), 'look');
  assert.equal(aiPresence(base({ agent: 'codex', lastWatching: NOW - 10 * AWAY_AFTER_MS })), 'look');
});

test('the AI\'s name: Claude, Codex, or "your AI"', () => {
  assert.equal(aiNameKey('claude'), 'claude');
  assert.equal(aiNameKey('codex'), 'codex');
  assert.equal(aiNameKey(undefined), 'any');
});

// First-screen fix (decided 2026-11-06): "unsure" is a quiet dot until the person types; never-seen reads "not … yet".
import { presenceKey, presenceQuiet } from '../src/shell/ai-presence.ts';

test('"unsure" is a quiet dot until there is text in the field or a note was sent; every other state keeps its words', () => {
  assert.equal(presenceQuiet('unsure', false, 'none'), true, 'opening the editor: no "Not sure" over the game');
  assert.equal(presenceQuiet('unsure', true, 'none'), false, 'starting to ask: now it matters');
  for (const ph of ['nudge', 'away', 'waiting'] as const) assert.equal(presenceQuiet('unsure', false, ph), false, `a note kept (${ph}): "How to open" is the next step`);
  for (const p of ['watching', 'working', 'look', 'away'] as const) assert.equal(presenceQuiet(p, false, 'none'), false, p);
});

test('the words: "isn\'t watching yet" only when this host can tell and the AI was never seen in this page', () => {
  assert.equal(presenceKey('unsure', false, null), 'ai.p.notYet');
  assert.equal(presenceKey('unsure', undefined, null), 'ai.p.unsure', 'a host that cannot tell');
  assert.equal(presenceKey('unsure', false, NOW - 1000), 'ai.p.unsure', 'the grace after a heartbeat stopped');
  assert.equal(presenceKey('away', false, NOW - 10 * AWAY_AFTER_MS), 'ai.p.away');
  assert.equal(presenceKey('watching', true, NOW), 'ai.p.watching');
});

// The heartbeat outlived the status, then stopped (decided 2026-11-06): the status no longer stands in for it.
test('a fresh "done" is not "watching" once the heartbeat seen after it has stopped: the grace\'s "not sure"', () => {
  const done = { phase: 'done' as const, statusTime: NOW - 12_000, statusSeen: NOW - 11_000 };
  // Claude closed right after its reply: the page saw the heartbeat after the "done", and now it is gone.
  assert.equal(aiPresence(base({ ...done, lastWatching: NOW - 8000 })), 'unsure', 'closed after the done: no green');
  assert.equal(aiPresence(base({ ...done, phase: 'none', lastWatching: NOW - 8000 })), 'unsure', 'the line faded: still not "working"');
  // The plugin's hook exited to wake Claude: no heartbeat during the turn, so the status is the proof (2026-11-05 rule).
  assert.equal(aiPresence(base({ ...done, lastWatching: NOW - 30_000 })), 'watching', 'heartbeat last seen before the status');
  assert.equal(aiPresence(base({ ...done, lastWatching: null })), 'watching', 'never a heartbeat in this page');
  assert.equal(aiPresence(base({ ...done, statusSeen: null, lastWatching: NOW - 8000 })), 'watching', 'without statusSeen: the old rule');
  // Still at work: the request itself says so, whatever the heartbeat did.
  assert.equal(aiPresence(base({ ...done, phase: 'working', lastWatching: NOW - 8000 })), 'working');
  // A heartbeat again is "watching", and the minute after it went is "away" as before.
  assert.equal(aiPresence(base({ ...done, watching: true, lastWatching: NOW })), 'watching');
  assert.equal(aiPresence(base({ ...done, statusTime: NOW - 70_000, statusSeen: NOW - 69_000, lastWatching: NOW - AWAY_AFTER_MS })), 'away');
});
