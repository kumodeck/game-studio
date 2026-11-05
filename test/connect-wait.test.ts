// The bridge's wait for a game to connect (src/bridge/connect-wait.ts, decided 2026-11-05): a slow computer is waited
// for, a game with nothing for the editor is still told "not connected", and a late one still connects. No browser.
//
// Also: every message the editor page sends to the game page has a place that takes it (studio:place/choices was in
// none, so the four choices' 1–4 / Esc also switched the strip's tool and dropped the pick).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectStep, uiOnlyMayOpen, waitReason, FRAMES_TO_KNOW, LATE_MS, QUIET_MS, SURE_MS, type ConnectSeen } from '../src/bridge/connect-wait.ts';

const look = (o: Partial<ConnectSeen> = {}): ConnectSeen => ({ ms: 0, sinceLoad: 0, frames: 0, adapter: false, objects: false, ready: false, engine: false, ...o });

test('objects listed, or studio.ready(): the editor opens at once', () => {
  assert.equal(connectStep(look({ adapter: true, objects: true })), 'go');
  assert.equal(connectStep(look({ ready: true })), 'go');
});

test('a fast computer with no adapter: "not connected" after ~8 s, as before', () => {
  // 60 fps for 8 s = 480 frames.
  assert.equal(connectStep(look({ ms: 8000, sinceLoad: QUIET_MS, frames: 480 })), 'report');
  assert.equal(connectStep(look({ ms: 7000, sinceLoad: 7000, frames: 420 })), 'wait');
});

test('a slow computer: 8 s with few frames drawn is not enough', () => {
  // 3 fps: 24 frames in 8 s — the game has hardly run.
  assert.equal(connectStep(look({ ms: 8000, sinceLoad: 8000, frames: 24 })), 'wait');
  assert.equal(connectStep(look({ ms: 14_000, sinceLoad: 14_000, frames: FRAMES_TO_KNOW })), 'report');
});

test('the page still loading its files: the clock has not started', () => {
  assert.equal(connectStep(look({ ms: 20_000, sinceLoad: null, frames: 500 })), 'wait');
});

test('three.js on the page but no scene yet: waited for up to SURE_MS', () => {
  assert.equal(connectStep(look({ ms: 20_000, sinceLoad: 20_000, frames: 900, engine: true })), 'wait');
  assert.equal(connectStep(look({ ms: SURE_MS, sinceLoad: SURE_MS, frames: 900, engine: true })), 'report');
});

test('a game that never draws is still told, at SURE_MS', () => {
  assert.equal(connectStep(look({ ms: SURE_MS - 1, sinceLoad: SURE_MS, frames: 0 })), 'wait');
  assert.equal(connectStep(look({ ms: SURE_MS, sinceLoad: SURE_MS, frames: 0 })), 'report');
});

test('after the report the look goes on: a late game connects, else it stops at LATE_MS', () => {
  assert.equal(connectStep(look({ ms: 60_000, sinceLoad: 60_000, frames: 900 })), 'report');
  assert.equal(connectStep(look({ ms: 60_000, sinceLoad: 60_000, frames: 900, adapter: true, objects: true })), 'go');
  assert.equal(connectStep(look({ ms: LATE_MS, sinceLoad: LATE_MS, frames: 900 })), 'stop');
});

test('an adapter that lists nothing: the editor opens empty once the game ran a while (as before), not before', () => {
  assert.equal(connectStep(look({ ms: 8000, sinceLoad: 8000, frames: 10, adapter: true })), 'wait');
  assert.equal(connectStep(look({ ms: 8000, sinceLoad: 8000, frames: 480, adapter: true })), 'go');
  assert.equal(connectStep(look({ ms: SURE_MS, sinceLoad: SURE_MS, frames: 10, adapter: true })), 'go');
});

test('an HTML-only game opens with its UI after ~1 s — not while three.js is on the page or the page loads', () => {
  assert.equal(uiOnlyMayOpen(look({ ms: 900, sinceLoad: 900 })), true);
  assert.equal(uiOnlyMayOpen(look({ ms: 600, sinceLoad: 600 })), false);
  assert.equal(uiOnlyMayOpen(look({ ms: 900, sinceLoad: null })), false);
  assert.equal(uiOnlyMayOpen(look({ ms: 5000, sinceLoad: 5000, engine: true })), false);
  assert.equal(uiOnlyMayOpen(look({ ms: SURE_MS, sinceLoad: SURE_MS, engine: true })), true);
  assert.equal(uiOnlyMayOpen(look({ ms: 5000, sinceLoad: 5000, adapter: true })), false);
});

test('the wait reason says what is missing', () => {
  assert.equal(waitReason(look({ adapter: true })), 'no-objects');
  assert.equal(waitReason(look({ frames: 3 })), 'no-adapter');
  assert.equal(waitReason(look()), 'no-frame');
});

test('every editor-to-game message has a place in the game page that takes it', () => {
  const src = join(dirname(fileURLToPath(import.meta.url)), '../src');
  const read = (f: string) => readFileSync(join(src, f), 'utf8');
  const contract = read('contract.ts');
  const from = contract.indexOf('export type ShellToBridge =');
  const to = contract.indexOf('export type BridgeToShell =');
  const types = [...new Set([...contract.slice(from, to).matchAll(/type: '(studio:[a-z/-]+)'/g)].map((m) => m[1]!))];
  assert.ok(types.length > 40, `ShellToBridge types read (${types.length})`);
  // Taken by their own listener on the window (not editor.handle): Play / Edit in the same page, ▶ Play's ask and
  // pause, and the paused moment's values / checkpoints.
  const own: Record<string, string> = {
    'studio:core/play': 'bridge/bridge.ts',
    'studio:moment/ask': 'bridge/moment-values.ts',
    'studio:moment/set': 'bridge/moment-values.ts',
    'studio:moment/load': 'bridge/moment-load.ts',
    'studio:moment/save': 'bridge/moment-load.ts',
    // ● Clip records inside the game page with its own listener (merged with this guard 2026-11-05).
    'studio:clip/start': 'bridge/play-clip.ts',
    'studio:clip/stop': 'bridge/play-clip.ts',
  };
  const editor = read('bridge/editor.ts');
  for (const ty of types) {
    const file = own[ty] ?? (ty.startsWith('studio:play/') ? 'bridge/play-ask.ts' : 'bridge/editor.ts');
    assert.ok((file === 'bridge/editor.ts' ? editor : read(file)).includes(`'${ty}'`), `${ty} is taken in ${file}`);
  }
});
