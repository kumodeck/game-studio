// The one table of shortcuts (src/shell/keymap.ts) against the places that read the keys: the tooltips, ⌘K and the
// ? sheet print the table, and main.ts `shortcut()` / bridge/input.ts act on keys — they must say the same
// (basics pass, 2026-10-18).
// Run: node --experimental-strip-types --no-warnings --test test/keymap.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { KEYMAP, keyOf, keysOf, keyText, tipText } from '../src/shell/keymap.ts';
import { translate } from '../src/shell/i18n.ts';
import { TOOL_KEYS, TOOL_NUMBERS, toolFromKey } from '../src/bridge/handles.ts';
import { keyStep } from '../src/core/keys.ts';

test('Mac and Windows spellings of the basic keys', () => {
  assert.equal(keyOf('undo', true), '⌘Z');
  assert.equal(keyOf('undo', false), 'Ctrl+Z');
  assert.deepEqual(keysOf('redo', true), ['⇧⌘Z', '⌘Y']);
  assert.deepEqual(keysOf('redo', false), ['Ctrl+Y', 'Ctrl+Shift+Z']);
  assert.equal(keyOf('remove', true), '⌫');
  assert.deepEqual(keysOf('remove', false), ['Delete', 'Backspace']);
  assert.equal(keyOf('duplicate', false), 'Ctrl+D');
  assert.equal(keyOf('copy', true), '⌘C');
  assert.equal(keyOf('paste', false), 'Ctrl+V');
  assert.equal(keyOf('selectAll', true), '⌘A');
  assert.equal(keyOf('save', false), 'Ctrl+S');
  assert.equal(keyOf('home', false), 'Shift+F');
  assert.equal(keyOf('toFront', false), 'Ctrl+Shift+]');
  assert.equal(keyText('⇧ ←↑↓→', false), 'Shift ←↑↓→');
  assert.equal(keyOf('nope', true), '');
});

test('the tooltip line: name, two spaces, key', () => {
  assert.equal(tipText('Undo: move lighthouse', '⌘Z'), 'Undo: move lighthouse  ⌘Z');
  assert.equal(tipText('Close', ''), 'Close');
});

test('every shortcut has a name in English and Japanese', () => {
  for (const k of KEYMAP) {
    const key = k.label || `keys.${k.id}`;
    for (const lang of ['en', 'ja'] as const) {
      const s = translate(lang, key);
      assert.ok(s && s !== key, `${lang}: ${key}`);
    }
  }
  for (const g of ['edit', 'tools', 'view', 'layers']) assert.notEqual(translate('ja', `keys.group.${g}`), `keys.group.${g}`);
});

test('no single key does two things', () => {
  const seen = new Map<string, string>();
  for (const k of KEYMAP) for (const key of k.keys) {
    // Esc is one key in three steps (menu → tool → selection), listed twice on purpose.
    if (key === 'Esc') continue;
    assert.ok(!seen.has(key), `${key}: ${seen.get(key)} and ${k.id}`);
    seen.set(key, k.id);
  }
});

test('the tool keys in the table are the ones the game frame reads (M/H/T/S and 1–4, not W/E/R)', () => {
  for (const tool of ['move', 'lift', 'rotate', 'scale'] as const) {
    const d = KEYMAP.find((k) => k.id === tool)!;
    assert.deepEqual(d.keys, [TOOL_KEYS[tool], TOOL_NUMBERS[tool]]);
    assert.equal(toolFromKey(TOOL_NUMBERS[tool]), tool);
    assert.equal(toolFromKey(TOOL_KEYS[tool].toLowerCase()), tool);
  }
  assert.equal(toolFromKey('w'), null);
  // E and Q still turn by 15° (that is why W/E/R are not the tools here).
  assert.equal(keyStep('e', false, '3d')?.op, 'rotate');
  assert.equal(keyStep('q', false, '2d')?.op, 'rotate');
});

test('main.ts reads the keys the table lists (⌘C, ⌘V, ?, 1–4) and keeps fields to themselves', () => {
  const main = readFileSync(new URL('../src/shell/main.ts', import.meta.url), 'utf8');
  for (const want of ["mod && k === 'c'", "mod && k === 'v'", "k === '?'", "mod && k === 'z'", "mod && k === 'y'", "mod && k === 'd'", "mod && k === 'a'", "'delete' || k === 'backspace'"]) {
    assert.ok(main.includes(want), `shortcut() has ${want}`);
  }
  assert.match(main, /STRIP_NUMBERS: Record<string, StripTool> = \{ '1': 'move', '2': 'lift', '3': 'rotate', '4': 'scale' \}/);
  // While typing only ⌘S and ⌘K get through.
  assert.match(main, /if \(k !== 's' && k !== 'k'\) return;/);
});

// Fly (camera-wasd, 2026-10-18): one row for W A S D with the rule under it (the ⌘K row uses the same words), and the
// places that read the keys: the game frame by KeyboardEvent.code (input.ts), the editor page the same (main.ts).
test('the fly row: WASD in 3D only, its rule in both languages, read where the keys are read', () => {
  const d = KEYMAP.find((k) => k.id === 'fly')!;
  assert.deepEqual(d.keys, ['WASD']);
  assert.equal(d.dim, '3d');
  assert.equal(d.note, 'keys.fly.note');
  assert.match(translate('en', 'keys.fly.note'), /right mouse button/);
  assert.match(translate('ja', 'keys.fly.note'), /右ボタン/);
  const input = readFileSync(new URL('../src/bridge/input.ts', import.meta.url), 'utf8');
  const main = readFileSync(new URL('../src/shell/main.ts', import.meta.url), 'utf8');
  for (const src of [input, main]) assert.ok(src.includes("{ KeyW: 'w', KeyA: 'a', KeyS: 's', KeyD: 'd', KeyE: 'e', KeyQ: 'q' }"), 'fly keys by code');
  // ⌘K: the row's words are the sheet's note (the rule is written once).
  assert.ok(main.includes("`${t('keys.fly.note')} ${t('pal.fly.words')}`"));
  // S stays the Size tool, E / Q still turn (flying with a pick needs the right button).
  assert.equal(toolFromKey('s'), 'scale');
  assert.equal(keyStep('e', false, '3d')?.op, 'rotate');
});
