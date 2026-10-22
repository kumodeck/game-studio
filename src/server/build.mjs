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
const LOADER_LIMIT = 12 * 1024;

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
