#!/usr/bin/env node
// Build KUMODeck Game Studio with nothing but Node (>= 22.13).
//
//   node scripts/build.mjs          # build once
//   node scripts/build.mjs --watch  # rebuild when src/ changes
//
// Outputs go where the plugin ships them (the local server serves
// skills/arrange/bin/studio-ui/ at /__studio/):
//   studio-ui/studio-edit.js    classic script injected into the game page (bridge + core + built-in adapters)
//   studio-ui/index.html        the editor page around the game
//   studio-ui/studio-shell.js, studio-ui/shell.css
// then runs src/server/build.mjs, which writes bin/studio.mjs (the local server)
// and bin/studio-placement.js (the loader games import).
//
// The built files are committed: people install the plugin straight from git
// and run it with plain Node, with no build step on their machine.
import { copyFileSync, existsSync, mkdirSync, readFileSync, watch, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { bundle } from './bundle.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const DIST = join(ROOT, 'skills/arrange/bin/studio-ui');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const BANNER = `/* KUMODeck Game Studio ${pkg.version} — MIT License — built file, edit src/ instead */`;

const TARGETS = [
  { entry: 'bridge/main.ts', out: 'studio-edit.js', format: 'iife' },
  { entry: 'shell/local.ts', out: 'studio-shell.js', format: 'iife', copy: [['shell/index.html', 'index.html'], ['shell/shell.css', 'shell.css']] },
];

async function buildOnce() {
  const t0 = Date.now();
  let built = 0;
  for (const t of TARGETS) {
    const entry = join(SRC, t.entry);
    if (!existsSync(entry)) {
      console.log(`  skip ${t.out} (no src/${t.entry} yet)`);
      continue;
    }
    const banner = BANNER;
    const { code, files } = bundle(entry, { format: t.format, banner });
    const out = join(DIST, t.out);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, code);
    for (const [from, to] of t.copy || []) {
      const src = join(SRC, from);
      if (existsSync(src)) copyFileSync(src, join(DIST, to));
    }
    built++;
    console.log(`  ${t.out}  ${(code.length / 1024).toFixed(1)} KB  (${files.length} modules)`);
  }
  // The example adapters next to SKILL.md (skills/arrange/adapters/), where SKILL §1-§2 tells the AI to copy one
  // from. WHY (dogfood 2026-10-17): the plugin shipped without this folder; SKILL said "copy adapters/phaser.js",
  // the AI found nothing there, searched the editor's code and spent ten minutes before the first URL.
  const shipped = shipAdapters();
  console.log(`  ../../adapters/  ${shipped} file(s)`);
  built += shipped;
  // The local server and the loader have their own small build (plain .mjs, no types).
  const server = join(SRC, 'server/build.mjs');
  if (existsSync(server)) {
    const { build } = await import(pathToFileURL(server).href + `?t=${Date.now()}`);
    const r = build();
    console.log(`  ../studio.mjs  ${(r.studio / 1024).toFixed(1)} KB, ../studio-placement.js  ${(r.loader / 1024).toFixed(1)} KB`);
    if (r.copies?.length) console.log(`  refreshed the loader copy in ${r.copies.join(', ')}`);
    built += 2;
  }
  console.log(`built ${built} file(s) in ${Date.now() - t0} ms`);
}

/** src/adapters/<engine>/… → skills/arrange/adapters/<engine>.js (Godot keeps its two halves in a folder). */
const SHIPPED_ADAPTERS = [
  ['phaser/adapter.js', 'phaser.js'],
  ['pixi/adapter.js', 'pixi.js'],
  ['canvas/adapter.js', 'canvas.js'],
  ['dom/adapter.js', 'dom.js'],
  ['godot/adapter.js', 'godot/adapter.js'],
  ['godot/studio_bridge.gd', 'godot/studio_bridge.gd'],
];
function shipAdapters() {
  const out = join(ROOT, 'skills/arrange/adapters');
  for (const [from, to] of SHIPPED_ADAPTERS) {
    mkdirSync(dirname(join(out, to)), { recursive: true });
    copyFileSync(join(SRC, 'adapters', from), join(out, to));
  }
  return SHIPPED_ADAPTERS.length;
}

try {
  await buildOnce();
} catch (e) {
  console.error(e.message);
  if (!process.argv.includes('--watch')) process.exit(1);
}

if (process.argv.includes('--watch')) {
  let timer = null;
  watch(SRC, { recursive: true }, () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      buildOnce().catch((e) => console.error(e.message));
    }, 80);
  });
  console.log('watching src/ …');
}
