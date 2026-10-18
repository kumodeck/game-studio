// Cheap checks for the example 2D adapters (no browser; the end-to-end run is
// test/adapters-2d.browser.mjs).
//
// The example games ship a copy of an adapter in .studio/adapter.js, exactly
// as a user's game would. These copies must not drift from the source in
// src/adapters/<engine>/adapter.js, or the examples stop testing what we ship.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENGINES = ['phaser', 'pixi', 'canvas', 'dom'];

test('example .studio/adapter.js files match their source adapter', () => {
  let checked = 0;
  for (const ex of readdirSync(join(ROOT, 'examples'))) {
    const engine = ENGINES.find((e) => ex.startsWith(`${e}-`));
    const copy = join(ROOT, 'examples', ex, '.studio/adapter.js');
    if (!engine || !existsSync(copy)) continue;
    const src = readFileSync(join(ROOT, 'src/adapters', engine, 'adapter.js'), 'utf8');
    assert.equal(readFileSync(copy, 'utf8'), src, `${ex}/.studio/adapter.js differs from src/adapters/${engine}/adapter.js`);
    checked++;
  }
  assert.ok(checked >= 6, `expected at least 6 example adapters, found ${checked}`);
  // Godot keeps its two halves in different places (exported page / project).
  const g = (f) => readFileSync(join(ROOT, f), 'utf8');
  assert.equal(g('examples/godot-garden/web/.studio/adapter.js'), g('src/adapters/godot/adapter.js'));
  assert.equal(g('examples/godot-garden/project/studio_bridge.gd'), g('src/adapters/godot/studio_bridge.gd'));
});

test('adapters are plain scripts that parse and only touch the studio global', () => {
  for (const engine of [...ENGINES, 'godot']) {
    const src = readFileSync(join(ROOT, 'src/adapters', engine, 'adapter.js'), 'utf8');
    // Loaded as a classic <script> before the game: no import/export allowed.
    assert.doesNotMatch(src, /^\s*(import|export)\s/m, `${engine}: must be a classic script`);
    assert.doesNotThrow(() => new Function(src), `${engine}: syntax`);
    assert.match(src, /register2D\(/, `${engine}: registers a 2D port`);
    // Without the studio (normal play) it must do nothing at all: no hooks
    // installed, no globals added.
    const win = {}, glob = {};
    new Function('window', 'globalThis', 'document', src)(win, glob, {});
    assert.deepEqual([Object.keys(win), Object.keys(glob)], [[], []], `${engine}: no-op without the studio`);
  }
});

// The plugin ships the examples next to SKILL.md (skills/arrange/adapters/), where SKILL §1-§2 tells the AI to copy
// one from. Dogfood 2026-10-17: the folder was missing from the plugin, so the AI searched the editor's code for ten
// minutes. `node scripts/build.mjs` writes the copies; they must be there and match the source.
test('the plugin ships every example adapter next to SKILL.md', () => {
  const g = (f) => readFileSync(join(ROOT, f), 'utf8');
  const shipped = [
    ['phaser/adapter.js', 'phaser.js'], ['pixi/adapter.js', 'pixi.js'], ['canvas/adapter.js', 'canvas.js'], ['dom/adapter.js', 'dom.js'],
    ['godot/adapter.js', 'godot/adapter.js'], ['godot/studio_bridge.gd', 'godot/studio_bridge.gd'],
  ];
  for (const [from, to] of shipped) {
    assert.equal(g(`skills/arrange/adapters/${to}`), g(`src/adapters/${from}`), `skills/arrange/adapters/${to} differs from src/adapters/${from} (run node scripts/build.mjs)`);
  }
  // Every adapter SKILL.md names is there.
  const skill = g('skills/arrange/SKILL.md');
  for (const m of skill.matchAll(/`adapters\/([a-z]+\.js)`/g)) assert.ok(existsSync(join(ROOT, 'skills/arrange/adapters', m[1])), `SKILL.md names adapters/${m[1]}`);
});
