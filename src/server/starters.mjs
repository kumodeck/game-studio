// Starters: a sample game copied into a folder that has none, so `/arrange` in an empty folder
// opens a world to play with instead of "no index.html" (2026-10-16, "first 5 minutes").
//
// The shape (the contract between this module and whoever makes the starters):
//   starters/<id>/index.html     runs as-is (no build; engines from a CDN are fine)
//   starters/<id>/starter.json   { "title", "dim": "3d" | "2d", "blurb", "thumb", "order" }
//   starters/<id>/thumb.png      16:10, 640x400 (for a picker; not copied into the game)
// This module only reads that shape. It never writes anywhere except the folder it fills.
//
// WHY the agent picks by dimension ("3d" / "2d") and not by id: the person is asked one question
// ("Start from a sample? 3D or 2D") and should not have to know names. The lowest `order` of that
// dimension wins; an id still works for whoever wants a particular one.
//
// WHY a fallback to examples/three-crates and examples/pixi-garden: the starters ship in a
// separate wave and could be missing (an older checkout, a trimmed install). Those two examples are
// the editor's own test games — plain, but they run without a build and the editor knows them
// (pixi-garden carries its .studio/adapter.js). An empty folder must never end in "nothing happens".

import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';

const DIMS = ['3d', '2d'];
// Files that describe the starter (for a picker or a reader of this repo), not the game.
const STARTER_ONLY = new Set(['starter.json', 'thumb.png', 'README.md']);
// Never copied from anywhere in a starter: tooling, the editor's hand-off notes (only the adapter,
// the game's settings and tools under .studio/ belong to a game).
const NEVER = new Set(['.git', 'node_modules', '.DS_Store']);
const STUDIO_NOTES = /^(requests|shot|view-check|status\.json|.*\.md|.*\.log)$/;

const FALLBACK = [
  { id: 'three-crates', dim: '3d', title: 'Crates', blurb: 'A small three.js yard of crates, barrels and trees.' },
  { id: 'pixi-garden', dim: '2d', title: 'Garden', blurb: 'A PixiJS garden of flowers, rocks and bushes.' },
];

/**
 * Folders that may hold starters, nearest first. `here` is the folder of the running script:
 * skills/arrange/bin when bundled (plugin root three levels up), src/server from the sources.
 */
export function starterRoots(here) {
  return [path.resolve(here, '../../../starters'), path.resolve(here, '../../starters')];
}
export function exampleRoots(here) {
  return [path.resolve(here, '../../../examples'), path.resolve(here, '../../examples')];
}

/**
 * Every usable starter in `dir`, sorted 3d first, then by `order`, then id. A folder without
 * index.html or with a broken starter.json is skipped (one bad starter never hides the others).
 */
export async function readStarters(dir) {
  const names = await fs.readdir(dir).catch(() => []);
  const out = [];
  for (const id of names) {
    if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(id)) continue;
    const at = path.join(dir, id);
    if (!existsSync(path.join(at, 'index.html'))) continue;
    let meta;
    try {
      meta = JSON.parse(await fs.readFile(path.join(at, 'starter.json'), 'utf8'));
    } catch {
      continue;
    }
    if (!meta || !DIMS.includes(meta.dim)) continue;
    out.push({
      id,
      dim: meta.dim,
      title: typeof meta.title === 'string' && meta.title.trim() ? meta.title.trim().slice(0, 60) : id,
      blurb: typeof meta.blurb === 'string' ? meta.blurb.trim().slice(0, 200) : '',
      order: Number.isFinite(meta.order) ? meta.order : 99,
      thumb: typeof meta.thumb === 'string' && existsSync(path.join(at, meta.thumb)) ? path.join(at, meta.thumb) : null,
      dir: at,
    });
  }
  return out.sort((a, b) => DIMS.indexOf(a.dim) - DIMS.indexOf(b.dim) || a.order - b.order || a.id.localeCompare(b.id));
}

/**
 * The starters to offer: the first folder of `roots` that has any, else the two examples
 * (marked `fallback: true`). `starterDir` (the --starters-dir option) replaces the roots.
 */
export async function findStarters(here, starterDir) {
  for (const r of starterDir ? [starterDir] : starterRoots(here)) {
    const list = await readStarters(r);
    if (list.length) return list;
  }
  for (const r of exampleRoots(here)) {
    const list = FALLBACK.filter((f) => existsSync(path.join(r, f.id, 'index.html')))
      .map((f, i) => ({ ...f, order: i + 1, thumb: null, dir: path.join(r, f.id), fallback: true }));
    if (list.length) return list;
  }
  return [];
}

/** "3d" / "2d" = the first of that dimension; anything else = that id. */
export function pickStarter(list, want) {
  const w = String(want || '').toLowerCase();
  return DIMS.includes(w) ? list.find((s) => s.dim === w) || null : list.find((s) => s.id === w) || null;
}

/** Relative paths of the files a starter puts into a game (sorted). */
export async function starterFiles(src) {
  const out = [];
  async function walk(rel) {
    const entries = await fs.readdir(path.join(src, rel), { withFileTypes: true });
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (NEVER.has(e.name)) continue;
      if (!rel && STARTER_ONLY.has(e.name)) continue;
      if (rel === '.studio' && STUDIO_NOTES.test(e.name)) continue;
      // Links are skipped: a starter is plain files, and a link could point out of the folder.
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) await walk(r);
      else if (e.isFile()) out.push(r);
    }
  }
  await walk('');
  return out.sort();
}

/**
 * Copy a starter into `dest` (created when missing). Nothing is ever overwritten: when any file is
 * already there, nothing is copied and `conflicts` lists them. Returns { files, conflicts }.
 */
export async function copyStarter(starter, dest) {
  const files = await starterFiles(starter.dir);
  const conflicts = files.filter((f) => existsSync(path.join(dest, f)));
  if (conflicts.length) return { files: [], conflicts };
  for (const f of files) {
    const to = path.join(dest, f);
    await fs.mkdir(path.dirname(to), { recursive: true });
    // COPYFILE_EXCL: a file that appeared since the check above is still never overwritten.
    await fs.copyFile(path.join(starter.dir, f), to, 1);
  }
  return { files, conflicts: [] };
}

/** The one stdout line for a folder without a game: what to ask, and the exact next command. */
export function noGameLine(root, list) {
  const offer = DIMS.map((d) => list.find((s) => s.dim === d)).filter(Boolean)
    .map((s) => `--starter ${s.dim} (${s.title})`).join(' or ');
  return offer
    ? `studio: no-game ${root} - ask once "Start from a sample? 3D or 2D", then run again with ${offer}`
    : `studio: no-game ${root} - no index.html and no samples to start from`;
}
