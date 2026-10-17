// Asset listing for the library tool (contract 3: listAssets() -> AssetFile[]).
//
// Two sources are combined here, on the server, because only the server can read the folder:
// 1. Files in the folder that look like game assets (images, models, sounds, atlases, fonts).
// 2. Which code files mention each asset ("refsInCode"). The library uses this to mark an asset as
//    "unused" (no code mentions it and the game did not load it) or "only in code".
// The third source (what the game actually loaded at runtime) is recorded in the browser by the
// edit script; it is not the server's job.
//
// Matching is by text, not by parsing: a code file "refers" to an asset if it contains the asset's
// path relative to the folder, its path relative to that code file, or its file name between quotes
// or after a slash. Games build paths in many ways (base URL + name, loader.setPath(...)), so the
// file-name match catches most of them; false positives only make an asset look used, which is the
// safe direction (we never suggest deleting a file that some code might name).

import { promises as fs } from 'node:fs';
import path from 'node:path';

const TYPES = {
  image: ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.avif'],
  model: ['.glb', '.gltf', '.fbx', '.obj'],
  audio: ['.mp3', '.ogg', '.wav', '.m4a'],
  font: ['.woff2', '.woff', '.ttf', '.otf'],
};
const TYPE_OF = new Map(Object.entries(TYPES).flatMap(([t, exts]) => exts.map((e) => [e, t])));
const CODE_EXT = new Set(['.html', '.htm', '.js', '.mjs', '.cjs', '.css', '.json']);
// Folders that are never part of the game's own assets: dependencies, VCS data, build output.
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'out', 'coverage']);
const IGNORE_FILES = new Set(['placement.json', 'library.json', 'package.json', 'package-lock.json', 'tsconfig.json']);

const MAX_FILES = 5000;
const MAX_DEPTH = 12;
const MAX_CODE_BYTES = 2 * 1024 * 1024; // per code file; bigger files are minified bundles or data
const MAX_CODE_TOTAL = 32 * 1024 * 1024;
// String literals in code that look like asset file names (used for "missing" references).
const LITERAL_RE = /["'`]([^"'`\s<>]{1,300}?\.(?:png|jpe?g|webp|gif|svg|avif|glb|gltf|fbx|obj|mp3|ogg|wav|m4a|woff2?|ttf|otf))(?:[?#][^"'`\s]*)?["'`]/gi;

/**
 * @returns {Promise<{ assets: Array<{ path: string, size: number, type: string, refsInCode: string[] }>,
 *                     missing: Array<{ ref: string, in: string[] }>, truncated: boolean }>}
 */
export async function listAssets(rootReal) {
  const files = [];
  let truncated = false;
  async function walk(dir, depth) {
    if (depth > MAX_DEPTH) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : 1));
    for (const e of entries) {
      if (files.length >= MAX_FILES) {
        truncated = true;
        return;
      }
      if (e.name.startsWith('.')) continue;
      const abs = path.join(dir, e.name);
      // Symlinks are skipped while listing (they may point outside the folder); the server refuses
      // to serve outside targets anyway.
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) await walk(abs, depth + 1);
      } else if (e.isFile()) {
        files.push(path.relative(rootReal, abs).split(path.sep).join('/'));
      }
    }
  }
  await walk(rootReal, 0);

  // Read code files once.
  const code = [];
  let total = 0;
  for (const rel of files) {
    const ext = path.extname(rel).toLowerCase();
    if (!CODE_EXT.has(ext) || IGNORE_FILES.has(path.basename(rel))) continue;
    const abs = path.join(rootReal, rel);
    const st = await fs.stat(abs);
    if (st.size > MAX_CODE_BYTES || total + st.size > MAX_CODE_TOTAL) continue;
    total += st.size;
    code.push({ rel, text: await fs.readFile(abs, 'utf8') });
  }

  const assets = [];
  for (const rel of files) {
    const ext = path.extname(rel).toLowerCase();
    if (IGNORE_FILES.has(path.basename(rel))) continue;
    let type = TYPE_OF.get(ext);
    if (!type && ext === '.json') {
      // A JSON file is an asset only when it is a sprite atlas (TexturePacker / PixiJS / Phaser
      // style: "frames" plus "meta"). Other JSON is data or config, which is code's business.
      const c = code.find((x) => x.rel === rel);
      if (c && /"frames"\s*:/.test(c.text) && /"meta"\s*:/.test(c.text)) type = 'atlas';
    }
    if (!type) continue;
    const st = await fs.stat(path.join(rootReal, rel));
    const refsInCode = code.filter((c) => c.rel !== rel && mentions(c, rel)).map((c) => c.rel);
    assets.push({ path: rel, size: st.size, type, refsInCode });
  }

  // References to asset-like names that match no file: "missing" in the library.
  const have = new Set(files);
  const haveNames = new Set(files.map((f) => path.posix.basename(f)));
  const missing = new Map();
  for (const c of code) {
    for (const m of c.text.matchAll(LITERAL_RE)) {
      const ref = m[1];
      if (/^(https?:|data:|blob:|\/\/)/i.test(ref)) continue;
      // A name built at run time (`assets/${k}.svg`, 'tree' + n + '.png' cut at a quote, globs) is
      // not a file name we can check: counting it as "missing" only confuses the person.
      if (/[${}*+]/.test(ref)) continue;
      const fromCode = path.posix.normalize(path.posix.join(path.posix.dirname(c.rel), ref.replace(/^\.\//, '')));
      const fromRoot = ref.replace(/^\.?\//, '');
      if (have.has(fromCode) || have.has(fromRoot) || haveNames.has(path.posix.basename(ref))) continue;
      if (!missing.has(ref)) missing.set(ref, new Set());
      missing.get(ref).add(c.rel);
    }
  }
  return {
    assets,
    missing: [...missing].map(([ref, set]) => ({ ref, in: [...set].sort() })).sort((a, b) => (a.ref < b.ref ? -1 : 1)),
    truncated,
  };
}

function mentions(codeFile, assetRel) {
  const { text, rel } = codeFile;
  if (text.includes(assetRel)) return true;
  const relToCode = path.posix.relative(path.posix.dirname(rel), assetRel);
  if (relToCode !== assetRel && text.includes(relToCode)) return true;
  const name = path.posix.basename(assetRel);
  const re = new RegExp(`(^|[\\/'"\`(\\s])${escapeRe(name)}(?=['"\`)?#\\s]|$)`, 'm');
  return re.test(text);
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
