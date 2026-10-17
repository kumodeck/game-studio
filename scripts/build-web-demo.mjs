#!/usr/bin/env node
// Build the browser-only web demo of Game Studio into ONE static folder.
//
//   node scripts/build-web-demo.mjs --out <dir> [--cache <dir>]
//
// Why (decided 2026-10-16, step 1 of 2): open a URL on KUMODeck
// hosting from any device and try the editor on sample games. The folder is
// published like any other game: plain files, relative paths only, no
// external CDN, no server code. Saves stay in the visitor's browser
// (src/hosts/browser); no AI is connected.
//
// Output:
//   index.html, strings.js      sample list (src/hosts/browser/index.html) and its words
//   thumbs/<id>.png             each starter's thumb.png, for the list
//   studio/index.html           the editor page (src/shell/index.html, with the demo entry)
//   studio/studio-web.js        shell + browser host (entry src/hosts/browser/main.ts)
//   studio/shell.css, demo.css
//   studio/games.json           the samples: title, 2D/3D, asset table (made here with the
//                               local server's own listAssets(), so the Library matches it)
//   __studio/studio-edit.js     the edit script (bridge), injected first in each game page
//   __studio/game-placement.js  answers the game's fetch('./placement.json') from the browser's save
//   __studio/<id>/adapter.js    the sample's .studio/adapter.js (or empty)
//   __studio/<id>/tools.js      the sample's .studio/tools.js (or empty)
//   games/<id>/…                the starter's files (what `--starter` copies); HTML pages get the tags above
//                               and their import map pointed at vendor/
//   vendor/<pkg>@<ver>/…        the CDN modules the samples import, copied (only the files used)
//
// WHY `__studio/` for the studio's own scripts: the edit script's load log skips any
// /__studio/ path (core/loads.ts), so they are not listed as game assets.
// WHY copy the CDN modules: the brief says no external CDN (the demo must keep working
// if jsDelivr is slow or blocked). They are fetched once and kept in --cache
// (default: <tmp>/game-studio-web-demo-cache), so later builds work offline.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle } from './bundle.mjs';
import { injectEditScript } from '../src/server/files.mjs';
import { listAssets } from '../src/server/assets.mjs';
import { readStarters, starterFiles } from '../src/server/starters.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const BANNER = `/* KUMODeck Game Studio ${pkg.version} (web demo) — MIT License — built file, edit src/ instead */`;

// The samples = the starters (starters/<id>/starter.json), 3D first, the same list and the same
// files the local studio offers to an empty folder (src/server/starters.mjs).
// WHY (2026-10-17): the first demo used the editor's test games (examples/three-crates,
// pixi-garden); the demo is tried on phones, and the starters are what a newcomer meets first. Read with the local studio's own readStarters()/starterFiles(), so the demo
// gets exactly what `--starter` copies (no starter.json / thumb.png / README.md in the game).
const SAMPLES = await readStarters(join(ROOT, 'starters'));
if (SAMPLES.length < 2) throw new Error(`expected the two starters in starters/, found ${SAMPLES.map((s) => s.id).join(', ') || 'none'}`);
const CDN = /^https:\/\/cdn\.jsdelivr\.net\/npm\/((?:@[^/]+\/)?[^/@]+@[^/]+)\/(.*)$/;

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const OUT = arg('--out') ? resolve(arg('--out')) : null;
if (!OUT) {
  console.error('usage: node scripts/build-web-demo.mjs --out <dir> [--cache <dir>]');
  process.exit(2);
}
const CACHE = resolve(arg('--cache', join(tmpdir(), 'game-studio-web-demo-cache')));

// Refuse to wipe something that is not ours: an existing, non-empty folder must be an earlier demo build.
if (existsSync(OUT) && readdirSync(OUT).length && !existsSync(join(OUT, 'studio/games.json'))) {
  console.error(`${OUT} is not empty and is not an earlier web demo build; choose another --out`);
  process.exit(2);
}
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const write = (rel, text) => {
  const f = join(OUT, rel);
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, text);
};

// ---- 1. the editor and the edit script ----
write('__studio/studio-edit.js', bundle(join(SRC, 'bridge/main.ts'), { format: 'iife', banner: BANNER }).code);
write('__studio/game-placement.js', readFileSync(join(SRC, 'hosts/browser/game-placement.js'), 'utf8'));
write('studio/studio-web.js', bundle(join(SRC, 'hosts/browser/main.ts'), { format: 'iife', banner: BANNER }).code);
write('studio/shell.css', readFileSync(join(SRC, 'shell/shell.css'), 'utf8'));
write('studio/demo.css', readFileSync(join(SRC, 'hosts/browser/demo.css'), 'utf8'));
const shellHtml = readFileSync(join(SRC, 'shell/index.html'), 'utf8')
  .replace('<link rel="stylesheet" href="shell.css" />', '<link rel="stylesheet" href="shell.css" />\n  <link rel="stylesheet" href="demo.css" />')
  .replace('<script src="studio-shell.js"></script>', '<script src="studio-web.js"></script>');
if (!shellHtml.includes('studio-web.js') || !shellHtml.includes('demo.css')) throw new Error('src/shell/index.html changed: update build-web-demo.mjs');
write('studio/index.html', shellHtml);
write('index.html', readFileSync(join(SRC, 'hosts/browser/index.html'), 'utf8'));
write('strings.js', readFileSync(join(SRC, 'hosts/browser/strings.js'), 'utf8'));

// ---- 2. the samples ----
const vendorWanted = new Set(); // CDN URLs to copy
const games = [];
for (const s of SAMPLES) {
  const from = s.dir;
  const to = join(OUT, 'games', s.id);
  for (const rel of await starterFiles(from)) {
    // .studio/ is the editor's (adapter.js, tools.js, studio.json): served from __studio/ below, not as game files.
    if (rel.startsWith('.studio/')) continue;
    mkdirSync(dirname(join(to, rel)), { recursive: true });
    cpSync(join(from, rel), join(to, rel));
  }
  // The picture for the sample list. Kept outside games/<id>/ so the Library does not list it as a game asset.
  if (s.thumb) cpSync(s.thumb, join(OUT, 'thumbs', `${s.id}.png`));
  const adapter = join(from, '.studio/adapter.js');
  const tools = join(from, '.studio/tools.js');
  write(`__studio/${s.id}/adapter.js`, existsSync(adapter) ? readFileSync(adapter, 'utf8') : '/* no .studio/adapter.js in this sample */\n');
  write(`__studio/${s.id}/tools.js`, existsSync(tools) ? readFileSync(tools, 'utf8') : '/* no .studio/tools.js in this sample */\n');

  const title = s.title;
  const importMap = {};
  for (const rel of walk(to)) {
    if (!/\.html?$/i.test(rel)) continue;
    const depth = rel.split('/').length - 1; // pages in sub-folders need more ../
    const up = '../'.repeat(2 + depth);
    let html = readFileSync(join(to, rel), 'utf8');
    // Point the import map's CDN URLs at the copies in vendor/.
    html = html.replace(/<script type="importmap">([\s\S]*?)<\/script>/i, (_, json) => {
      const map = JSON.parse(json);
      for (const [k, v] of Object.entries(map.imports || {})) {
        const c = CDN.exec(v);
        if (!c) continue;
        importMap[k] = v;
        if (!v.endsWith('/')) vendorWanted.add(v);
        map.imports[k] = `${up}vendor/${c[1]}/${c[2]}`;
      }
      return `<script type="importmap">\n    ${JSON.stringify(map)}\n  </script>`;
    });
    if (/https?:\/\/cdn\./.test(html)) throw new Error(`${s.id}/${rel} still loads from a CDN`);
    html = injectEditScript(html, `${up}__studio/studio-edit.js`, `${up}__studio/${s.id}/adapter.js`, `${up}__studio/${s.id}/tools.js`);
    // Before the edit script: the game's fetch('./placement.json') is answered from the browser's save.
    const editTag = `<script src="${up}__studio/studio-edit.js" data-studio-edit></script>`;
    if (!html.includes(editTag)) throw new Error('injectEditScript changed: update build-web-demo.mjs');
    html = html.replace(editTag, `<script src="${up}__studio/game-placement.js" data-game="${s.id}"></script>` + editTag);
    writeFileSync(join(to, rel), html);
  }
  // Bare imports of the sample's own modules that go through a prefix entry ("three/addons/…").
  for (const rel of walk(to)) {
    if (!/\.m?js$/.test(rel)) continue;
    for (const spec of importsOf(readFileSync(join(to, rel), 'utf8'))) {
      if (spec.startsWith('.') || spec.startsWith('/')) continue;
      const hit = Object.keys(importMap).filter((k) => k.endsWith('/') && spec.startsWith(k)).sort((a, b) => b.length - a.length)[0];
      if (hit) vendorWanted.add(importMap[hit] + spec.slice(hit.length));
      else if (!importMap[spec]) throw new Error(`${s.id}/${rel}: import "${spec}" is not in the import map`);
    }
  }

  const { assets, missing } = await listAssets(to);
  const cfgFile = join(from, '.studio/studio.json');
  let config = null;
  try {
    config = existsSync(cfgFile) ? JSON.parse(readFileSync(cfgFile, 'utf8')) : null;
  } catch {
    config = null;
  }
  games.push({
    id: s.id, title, dim: s.dim, entry: 'index.html',
    // For the sample list (index.html): the starter's own English line, and its picture.
    blurb: s.blurb, thumb: s.thumb ? `thumbs/${s.id}.png` : null,
    assets: assets.map((a) => ({ path: a.path, size: a.size, type: a.type === 'audio' ? 'sound' : a.type, refsInCode: a.refsInCode })),
    missing: missing.map((m) => ({ path: m.ref, refsInCode: m.in })),
    config,
  });
}
write('studio/games.json', JSON.stringify({ version: 1, games }, null, 2) + '\n');

// ---- 3. the CDN modules, with every module they import ----
const done = new Set();
const queue = [...vendorWanted];
while (queue.length) {
  const url = queue.shift();
  if (done.has(url)) continue;
  done.add(url);
  const c = CDN.exec(url);
  if (!c) throw new Error(`not a jsDelivr npm URL: ${url}`);
  const text = await fetchCached(url);
  write(`vendor/${c[1]}/${c[2]}`, text);
  for (const spec of importsOf(text)) {
    if (spec.startsWith('.')) queue.push(new URL(spec, url).href);
    else if (/^https?:/.test(spec)) throw new Error(`${url} imports ${spec} (absolute URL)`);
    // Bare specifiers ("three") resolve through the page's import map: already listed.
  }
}

// ---- 4. a note for whoever opens the folder ----
write('README.md', `# Game Studio — web demo (built folder)

Built by \`oss/game-studio/scripts/build-web-demo.mjs\` (Game Studio ${pkg.version}). Do not edit: rebuild.

Static files only, relative paths, no CDN. Serve the folder as it is (KUMODeck hosting,
\`python3 -m http.server\`) and open \`index.html\`. The editor keeps everything in the
visitor's browser (IndexedDB) and is not connected to an AI.

- \`index.html\` — the sample list
- \`studio/\` — the editor (\`?game=<id>\`), \`games.json\` lists the samples
- \`thumbs/\` — the pictures on the sample list
- \`games/\` — the samples (${SAMPLES.map((s) => s.id).join(', ')})
- \`__studio/\` — the edit script and each sample's adapter
- \`vendor/\` — three.js / PixiJS modules the samples import
`);

let files = 0;
let bytes = 0;
for (const rel of walk(OUT)) {
  files++;
  bytes += statSync(join(OUT, rel)).size;
}
console.log(`web demo: ${OUT}\n  ${files} files, ${(bytes / 1024 / 1024).toFixed(2)} MB (vendor: ${done.size} module(s))`);

// ---------------------------------------------------------------------------

function walk(dir, base = dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, base));
    else out.push(relative(base, p).split('\\').join('/'));
  }
  return out;
}

/** Module specifiers of static and literal dynamic imports/exports (good enough for these modules; the build fails loudly on a miss). */
function importsOf(code) {
  const out = new Set();
  const re = /\b(?:import|export)\s*(?:[\w*{}\s,$]+?\s*from\s*)?["']([^"'\n]+)["']|\bimport\s*\(\s*["']([^"'\n]+)["']\s*\)/g;
  for (const m of code.matchAll(re)) out.add(m[1] || m[2]);
  return [...out];
}

async function fetchCached(url) {
  const file = join(CACHE, url.replace(/^https:\/\//, '').replace(/[?#].*$/, ''));
  if (existsSync(file)) return readFileSync(file, 'utf8');
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  const text = await r.text();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
  return text;
}
