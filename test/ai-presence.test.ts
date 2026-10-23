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
