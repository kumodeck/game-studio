#!/usr/bin/env node
// Make the starters' asset files (starters/<id>/assets/*) from code.
//
//   node scripts/make-starter-assets.mjs [--only lantern-cove,firefly-ruins] [--check]
//
// WHY (2026-10-17): both starters drew everything in code and had no files, so the web demo's Assets panel said
// "No assets yet…" and the part of the editor that lists, shows and swaps files could not be tried. Each starter now
// loads a handful of real files. They are made here, not downloaded: pictures and the glTF in a headless browser
// (scripts/starter-art/<id>.js, Canvas 2D and three.js), sounds in Node (scripts/starter-art/sounds.mjs, encoded
// with ffmpeg). Seeded randomness everywhere, so running this again rewrites the same pictures and sounds.
// The files are committed; the games never run this. --check only compares and exits 1 when a file would change.
//
// Needs: a headless Chrome (test/adapters-2d/cdp.mjs finds one), ffmpeg with libmp3lame, and three.js
// 0.186.1 from jsDelivr (taken from the web demo's cache when it is there).
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, newPage } from '../test/adapters-2d/cdp.mjs';
import { sounds } from './starter-art/sounds.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : ['lantern-cove', 'firefly-ruins'];
const CHECK = args.includes('--check');

// The page the painters run in: the same three.js the starter uses (lantern-cove/index.html's import map).
const PAGE = `<!doctype html><meta charset="utf-8"><script type="importmap">${JSON.stringify({ imports: {
  three: 'https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.module.min.js',
  'three/addons/': 'https://cdn.jsdelivr.net/npm/three@0.186.1/examples/jsm/',
} })}</script><body></body>`;
const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript' };
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path === '/') return res.writeHead(200, { 'content-type': 'text/html' }).end(PAGE);
  // Only the painters are served: nothing else of the package is reachable from the page.
  const file = join(ROOT, 'scripts/starter-art', path.replace(/^\/art\//, ''));
  if (!path.startsWith('/art/') || !file.startsWith(join(ROOT, 'scripts/starter-art')) || !existsSync(file)) return res.writeHead(404).end();
  res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' }).end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const files = {}; // starter id → { 'assets/x': Buffer }
const browser = await launch();
try {
  const page = await newPage(browser, { width: 800, height: 600, cdnCache: join(tmpdir(), 'game-studio-web-demo-cache/cdn.jsdelivr.net/npm') });
  await page.goto(`${base}/`);
  for (const id of only) {
    const out = await page.eval(`import('/art/${id}.js').then((m) => m.make())`);
    files[id] = Object.fromEntries(Object.entries(out).map(([k, b64]) => [k, Buffer.from(b64, 'base64')]));
  }
  const errors = page.logs.filter((l) => l.startsWith('exception') || l.startsWith('error'));
  if (errors.length) throw new Error(errors.join('\n'));
} finally {
  await browser.close();
  server.close();
}
for (const [id, list] of Object.entries(sounds())) if (only.includes(id)) Object.assign(files[id], list);

let changed = 0;
for (const [id, list] of Object.entries(files)) {
  let total = 0;
  for (const [rel, buf] of Object.entries(list)) {
    const to = join(ROOT, 'starters', id, rel);
    total += buf.length;
    const same = existsSync(to) && readFileSync(to).equals(buf);
    if (!same) changed++;
    console.log(`${same ? '  ' : CHECK ? '✗ ' : '→ '}${id}/${rel}  ${(buf.length / 1024).toFixed(1)} KB`);
    if (!same && !CHECK) {
      mkdirSync(dirname(to), { recursive: true });
      writeFileSync(to, buf);
    }
  }
  console.log(`  ${id}: ${Object.keys(list).length} files, ${(total / 1024).toFixed(0)} KB`);
}
if (CHECK && changed) {
  console.error(`${changed} file(s) differ from what the code makes: run node scripts/make-starter-assets.mjs`);
  process.exit(1);
}
