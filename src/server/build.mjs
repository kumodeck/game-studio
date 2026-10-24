// Build: bundle the local server into skills/arrange/bin/studio.mjs (one file, no dependencies)
// and copy the loader to skills/arrange/bin/studio-placement.js (comments stripped, < 5 KB).
//
//   node src/server/build.mjs
//
// WHY a tiny hand-written bundler instead of esbuild/rollup: the shipped file must run with plain
// Node and the project adds no dependencies. Our own modules follow simple rules that make
// concatenation safe, and the build checks them instead of trusting them:
// - imports are at the top, one statement each, relative ('./x.mjs') or Node built-ins ('node:x');
// - top-level declarations start at column 0 and have unique names across all bundled modules;
// - no default exports, no re-exports, no dynamic import.
// Built-in imports are merged (two modules importing `promises as fs` share one binding).
// embedded.mjs is replaced by string constants (see that file).

import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '../..'); // oss/game-studio
const OUT_DIR = path.join(PKG, 'skills/arrange/bin');
// 6 KB (was 5): the loader also makes the editor's copies and deletions since the polish pass (2026-10-16).
// 9 KB since UI stage 1 (2026-10-19): it also places the HTML UI (`ui`, ~2.6 KB with the size correction that keeps
// a resized element's middle; the 6 KB one was at 5.7 KB). It is copied into every game, so it stays small; the
// limit keeps it from growing by accident.
// 12 KB since motion-gui (2026-10-22): it also runs the motions made in the editor (`motion`, ~2.7 KB: the path maths
// shared with the editor, the check of each entry and a frame loop); it went from 8.3 KB to 10.9 KB.
// 16 KB since the timeline (studio-timeline, 2026-10-22): clips and their keys (clipAt / trackAt: repeat, ease, the
// curve through the points), playMotion / clipOf for a game's cues, one frame loop for every object; 11.5 → 14.7 KB.
// 24 KB since motion triggers (studio-motion-triggers, 2026-10-22): when a motion starts and stops (motionRunner: the
// game's start, a time, a key, a click on the object, another motion's end, an area, a touch, a named cue; N rounds,
// a cue to stop), the Library's motions (`motions`, used by name) and the click test with the game's own camera.
// 28 KB since UI stages 2–3 (studio-ui-edit-2, 2026-10-22): the card's text / size / colours / a button's state colours
// (`ui.<key>.set`: one style sheet, the text part shared with the editor) and the theme's CSS variables; 23.0 → 26.2 KB.
// 28 KB since the timeline's second stage (studio-timeline-2, 2026-10-22): the path's handles (a Bézier span where a
// handle was bent, handlesOf shared with the editor), `when` as a list ("E or a click") and scene motions (`tracks`:
// several objects in one motion, started together); 23.5 → 24.9 KB (over the 24 KB line).
// 29 KB since Play in the editor's own page for every motion (studio-no-reload, 2026-10-22): the play hook (start /
// stop the draft's motions in the edit page, so ▶ Play never opens the game again for a clip that waits); 27.6 → 28.1 KB.
// 42 KB since code motions, code layouts and keep-out areas (studio-code-base, 2026-10-24: "a motion made by maths, not
// points — what then?" and the four user needs): codeMotion / codePlace / codeAvoid, the knobs, placing a layout with its
// pins and keep-out areas (tries again with a seeded random, skips a row), hiding what a layout replaced; 28.7 → 39.4 KB.
// Most of it is the layout's own rules, which no game can do without once it has a codePlace.
// 48 KB since offsets (studio-offsets, 2026-10-24: "a lamp dragged away from the road did nothing" — a rule's objects
// shifted as a rule: the row frame of one or two rows, ranks, mirrored turns, same / zigzag / ramp, before the keep-out
// areas); 40.9 → 46.2 KB. A game with a codePlace needs it as much as the rule itself.
// 56 KB since the UI drawn in the canvas (studio-canvas-ui, 2026-10-24: "edit the UI drawn INSIDE the canvas as UI"):
// codeUi() and its handle (box / look / value / hit / state, the 9 places it is measured from, the file's `from` / `at`
// read at draw time); 46.8 → 54.1 KB. Every game that draws its HUD in a canvas needs all of it.
// 64 KB since the canvas UI's stage 3 (studio-canvas-ui-3, 2026-10-24: Phaser / Pixi UI kept as objects, the canvas
// UI's theme): onChange and its pokes, `size` as the engine's object, codeTheme() and var(--x) looks; 54.1 → 58.7 KB.
// A Phaser or Pixi game's HUD cannot be edited without onChange, and a canvas UI's theme without codeTheme.
const LOADER_LIMIT = 64 * 1024;

const IMPORT_RE = /^import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"];?[ \t]*$/gm;
const DECL_RE = /^(?:export\s+)?(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm;

export function build() {
  const loader = minifyLoader(readFileSync(path.join(PKG, 'src/loader/studio-placement.js'), 'utf8'));
  if (Buffer.byteLength(loader) >= LOADER_LIMIT) throw new Error(`studio-placement.js is ${Buffer.byteLength(loader)} bytes (limit ${LOADER_LIMIT})`);

  const embedded = {
    'host.js': readFileSync(path.join(HERE, 'local-host.client.js'), 'utf8'),
    'fallback.html': readFileSync(path.join(HERE, 'fallback.html'), 'utf8'),
    'studio-placement.js': loader,
  };
  const server = bundle(path.join(HERE, 'cli.mjs'), {
    [path.join(HERE, 'embedded.mjs')]:
      `const EMBEDDED_FILES = ${JSON.stringify(embedded)};\nfunction embedded(name) {\n  return EMBEDDED_FILES[name];\n}\n`,
  });

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(path.join(OUT_DIR, 'studio.mjs'), server);
  writeFileSync(path.join(OUT_DIR, 'studio-placement.js'), loader);
  const copies = syncLoaderCopies(loader);
  return { studio: server.length, loader: Buffer.byteLength(loader), copies };
}

/**
 * Refresh the loader copy inside every starter and example that ships one (starters/<id>/studio-placement.js,
 * examples/<id>/studio-placement.js). Only folders that already have the file get it; none is added.
 *
 * WHY: those games import their own copy so they also run outside the editor. The starters were made with the
 * loader of the day and kept it after the polish pass taught the loader to show the editor's copies and
 * deletions, so a starter opened on its own lost every copy (speed pass, 2026-10-17). Copying at build time
 * means a loader change can never leave a stale copy behind again; test/first-run.test.mjs checks the same.
 */
function syncLoaderCopies(loader) {
  const changed = [];
  for (const dir of ['starters', 'examples']) {
    const base = path.join(PKG, dir);
    if (!existsSync(base)) continue;
    for (const id of readdirSync(base)) {
      const file = path.join(base, id, 'studio-placement.js');
      if (!existsSync(file) || readFileSync(file, 'utf8') === loader) continue;
      writeFileSync(file, loader);
      changed.push(`${dir}/${id}`);
    }
  }
  return changed;
}

function bundle(entry, replacements) {
  const order = [];
  const seen = new Set();
  const builtins = new Map(); // module -> Map(local -> imported spec text)
  const bodies = new Map();

  function visit(file) {
    if (seen.has(file)) return;
    seen.add(file);
    if (replacements[file] !== undefined) {
      bodies.set(file, replacements[file]);
      order.push(file);
      return;
    }
    const src = readFileSync(file, 'utf8');
    const deps = [];
    const body = src.replace(IMPORT_RE, (_, what, from) => {
      if (from.startsWith('.')) deps.push(path.resolve(path.dirname(file), from));
      else if (from.startsWith('node:')) addBuiltin(builtins, from, what, file);
      else throw new Error(`${file}: only relative and node: imports can be bundled (${from})`);
      return '';
    });
    // Comment lines are skipped: JSDoc types like `import('node:fs').Stats` are not imports.
    const code = body.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l));
    if (code.some((l) => /^[ \t]*import\s/.test(l) || /\bimport\(/.test(l))) throw new Error(`${file}: an import was not recognised`);
    if (/^export\s+(default|\{|\*)/m.test(body)) throw new Error(`${file}: default exports and re-exports cannot be bundled`);
    for (const d of deps) visit(d);
    bodies.set(file, body.replace(/^export\s+(?=(async\s+)?(function|const|let|var|class)\b)/gm, ''));
    order.push(file);
  }
  visit(entry);

  const names = new Map();
  for (const f of order) {
    for (const m of bodies.get(f).matchAll(DECL_RE)) {
      if (names.has(m[1])) throw new Error(`top-level name "${m[1]}" is declared in both ${names.get(m[1])} and ${f}`);
      names.set(m[1], f);
    }
  }
  const importLines = [...builtins].map(([mod, locals]) => {
    const def = [...locals].filter(([, spec]) => spec === 'default').map(([l]) => l);
    const named = [...locals].filter(([, spec]) => spec !== 'default').map(([l, spec]) => (spec === l ? l : `${spec} as ${l}`));
    const parts = [...def, ...(named.length ? [`{ ${named.join(', ')} }`] : [])];
    return `import ${parts.join(', ')} from '${mod}';`;
  });

  const header = `#!/usr/bin/env node
// KUMODeck Game Studio: local studio server. Generated by src/server/build.mjs; edit the sources in
// src/server and src/schema, not this file. MIT License. No dependencies; no network access other
// than serving the game folder to your browser.
`;
  return (
    header +
    importLines.join('\n') +
    '\n' +
    order.map((f) => `\n// ---- ${path.relative(PKG, f)} ----\n` + bodies.get(f).replace(/^\n+/, '')).join('')
  );
}

function addBuiltin(builtins, mod, what, file) {
  if (!builtins.has(mod)) builtins.set(mod, new Map());
  const locals = builtins.get(mod);
  const add = (local, spec) => {
    for (const [m, l] of builtins) if (m !== mod && l.has(local)) throw new Error(`${file}: "${local}" imported from both ${m} and ${mod}`);
    if (locals.has(local) && locals.get(local) !== spec) throw new Error(`${file}: "${local}" means two different imports`);
    locals.set(local, spec);
  };
  const t = what.trim();
  const braces = /\{([\s\S]*)\}/.exec(t);
  const def = t.replace(/\{[\s\S]*\}/, '').replace(/,/g, '').trim();
  if (def) {
    if (def.startsWith('*')) throw new Error(`${file}: namespace imports are not supported`);
    add(def, 'default');
  }
  if (braces) {
    for (const part of braces[1].split(',').map((s) => s.trim()).filter(Boolean)) {
      const [spec, local] = part.split(/\s+as\s+/);
      add((local || spec).trim(), spec.trim());
    }
  }
}

// Strip comments and indentation. Safe for the loader because it has no "//" or "/*" inside strings
// or regexes (the build output is also run by the loader tests, which would catch a broken strip).
function minifyLoader(src) {
  const body = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => l.replace(/\s+\/\/ .*$/, '').trim())
    .filter((l) => l && !l.startsWith('//'))
    .join('\n');
  return `// KUMODeck Game Studio placement loader (MIT). Applies placement.json to a three.js Scene or PixiJS stage.\n${body}\n`;
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === self) {
  const r = build();
  process.stdout.write(`built skills/arrange/bin/studio.mjs (${r.studio} bytes), studio-placement.js (${r.loader} bytes)\n`);
  if (r.copies.length) process.stdout.write(`refreshed the loader copy in ${r.copies.join(', ')}\n`);
}
