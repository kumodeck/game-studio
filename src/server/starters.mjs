// Starters: a sample game copied into a folder that has none, so `/arrange` in an empty folder
// opens a world to play with instead of "no index.html" (2026-10-16, "first 5 minutes").
//
// The shape (the contract between this module and whoever makes the starters):
//   starters/<id>/index.html     runs as-is (no build; engines from a CDN are fine)
//   starters/<id>/starter.json   { "title", "dim": "3d" | "2d", "blurb", "thumb", "order", "try"? }
//   starters/<id>/thumb.png      16:10, 640x400 (for the shelf; not copied into the game)
//   starters/<id>/strings.json   optional, the words in other languages (not copied into the game):
//                                { "ja": { "blurb", "try": { "ask", "move" } } }
// This module only reads that shape. It never writes anywhere except the folder it fills.
//
// `try` (optional, decided 2026-11-06): the three things to try in this sample, shown on the editor's shelf and in
// the one-card guide after it opens: { "move": "<placement name>", "pauseAt": 7.6, "ask": { "en": "…" }, "mark"? }.
// `"mark": true` = the ask says "here": the guide's Play card adds "press ◎ Mark and point" (a hint, never forced).
// `pauseAt` is the GAME's clock (seconds since its page started), not the editor's top-bar clock: the shell turns it
// into the second the person sees (shelf.ts pauseSeconds).
//
// strings.json (decided 2026-11-06): starter.json is English only, because the package keeps non-English text in
// translation files only (the export check refuses other scripts in it). The shelf merges each language of
// strings.json into what it sends: `try.ask.<lang>`, `try.moveName.<lang>` and `blurbs.<lang>`. For a starter that is
// `from` an example, that example's strings.json is read, then the starter's own over it (same rule as starter.json).
//
// A starter can also stand for a game kept elsewhere in this package (decided 2026-11-06, Neon Run): its
// starter.json says { "from": "examples/<id>", ...fields to change }. The game is read from there (no second copy
// to keep in step), with that folder's own starter.json under the fields given here. Only examples/<id> of this
// package is accepted, so a starter can never point out of it.
//
// WHY the editor's shelf and not a question (decided 2026-11-06): with six samples, "3D or 2D?" in words cannot
// show what they are. In a folder without a game the editor now opens on its shelf of moving pictures and copies
// the one the person picks (server.mjs api/shelf). `--starter 3d | 2d | <id>` stays for scripts and tests: the
// lowest `order` of that dimension wins, an id names one.
//
// WHY a fallback to examples/three-crates and examples/pixi-garden: the starters ship in a
// separate wave and could be missing (an older checkout, a trimmed install). Those two examples are
// the editor's own test games — plain, but they run without a build and the editor knows them
// (pixi-garden carries its .studio/adapter.js). An empty folder must never end in "nothing happens".

import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';

const DIMS = ['3d', '2d'];
// Files that describe the starter (for a picker or a reader of this repo), not the game.
// strings.json (decided 2026-11-06, the sample shelf): the starter's words in other languages. It is for the shelf, so
// it is not copied into a game either.
const STARTER_ONLY = new Set(['starter.json', 'thumb.png', 'README.md', 'strings.json']);
// The languages strings.json may add (the shell's languages besides English).
const LANGS = ['ja'];
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
  const readJson = async (at, name) => {
    try {
      const m = JSON.parse(await fs.readFile(path.join(at, name), 'utf8'));
      return m && typeof m === 'object' && !Array.isArray(m) ? m : null;
    } catch {
      return null;
    }
  };
  const readMeta = (at) => readJson(at, 'starter.json');
  for (const id of names) {
    if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(id)) continue;
    let at = path.join(dir, id);
    let meta = await readMeta(at);
    if (!meta) continue;
    // The starter's own strings.json (read before `at` may move to examples/<id>; it wins over the example's).
    const ownWords = await readJson(at, 'strings.json');
    let words = ownWords;
    // { "from": "examples/<id>" }: the game lives there; its own starter.json first, this one's fields over it.
    if (meta.from !== undefined) {
      const m = /^examples\/([a-z0-9][a-z0-9-]{0,39})$/.exec(String(meta.from));
      if (!m) continue;
      at = path.join(dir, '..', 'examples', m[1]);
      const { from: _from, ...over } = meta;
      meta = { ...((await readMeta(at)) || {}), ...over };
      words = mergeWords(await readJson(at, 'strings.json'), ownWords);
    }
    if (!existsSync(path.join(at, 'index.html'))) continue;
    if (!DIMS.includes(meta.dim)) continue;
    out.push({
      id,
      dim: meta.dim,
      title: typeof meta.title === 'string' && meta.title.trim() ? meta.title.trim().slice(0, 60) : id,
      blurb: typeof meta.blurb === 'string' ? meta.blurb.trim().slice(0, 200) : '',
      order: Number.isFinite(meta.order) ? meta.order : 99,
      thumb: typeof meta.thumb === 'string' && existsSync(path.join(at, meta.thumb)) ? path.join(at, meta.thumb) : null,
      try: readTry(withWords(meta.try, words)),
      ...blurbsOf(words),
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

/**
 * A starter's `try`, cleaned (it is shown on the shelf and in the guide): null when there is none to show. Each part
 * is optional; a sample that has only `ask` still gets its "Try asking" words. Unknown languages are dropped.
 */
export function readTry(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const out = {};
  if (typeof v.move === 'string' && v.move.trim()) out.move = v.move.trim().slice(0, 80);
  if (Number.isFinite(v.pauseAt) && v.pauseAt >= 0 && v.pauseAt <= 600) out.pauseAt = Math.round(v.pauseAt * 100) / 100;
  const ask = {};
  for (const l of ['en', ...LANGS]) if (v.ask && typeof v.ask[l] === 'string' && v.ask[l].trim()) ask[l] = v.ask[l].trim().slice(0, 140);
  if (Object.keys(ask).length) out.ask = ask;
  // `mark: true` (decided 2026-11-06, Marble Rain): the ask points at a spot ("Add a spinning paddle here."), so the
  // guide's second card says to press ◎ Mark and point before asking. Only a hint: the ask goes without a mark too.
  if (v.mark === true) out.mark = true;
  // What the guide calls the thing to move, per language ("Drag the duck"): `move` is a placement name the game gives
  // (it may read "lighthouse_1"), so English defaults to that name made readable; other languages come from strings.json.
  if (out.move) {
    const name = { en: readableName(out.move) };
    for (const l of LANGS) if (v.moveName && typeof v.moveName[l] === 'string' && v.moveName[l].trim()) name[l] = v.moveName[l].trim().slice(0, 60);
    out.moveName = name;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * "lighthouse_1" → "lighthouse", "rope_bridge" → "rope bridge": a placement name as a person reads it. The number a
 * game adds to tell copies apart is dropped (the guide says "the lighthouse", whichever copy is dragged).
 */
export function readableName(name) {
  // Every trailing number group goes, not only the last (decided 2026-11-06, Marble Rain): a grid of copies is named
  // by row and column ("pin-1-2"), and the guide said "Drag the pin 1" — a number that means nothing to the person.
  const n = String(name).replace(/(?:[_\-\s]*\d+)+$/, '').replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
  return (n || String(name)).toLowerCase();
}

/** strings.json of an example, then the starter's own over it, one language at a time (null when neither has any). */
export function mergeWords(base, over) {
  if (!base) return over || null;
  if (!over) return base;
  const out = { ...base };
  for (const l of LANGS) {
    if (!over[l]) continue;
    out[l] = { ...(base[l] || {}), ...over[l], try: { ...(base[l]?.try || {}), ...(over[l].try || {}) } };
  }
  return out;
}

/** starter.json's `try` with the other languages of strings.json put in (`ask.<lang>`, `moveName.<lang>`). */
export function withWords(t, words) {
  if (!t || typeof t !== 'object' || Array.isArray(t)) return t;
  const ask = { ...(t.ask && typeof t.ask === 'object' ? t.ask : {}) };
  const moveName = {};
  for (const l of LANGS) {
    const w = words?.[l]?.try;
    if (typeof w?.ask === 'string') ask[l] = w.ask;
    if (typeof w?.move === 'string') moveName[l] = w.move;
  }
  return { ...t, ask, moveName };
}

/** { blurbs: { ja: "…" } } from strings.json (the card's line in the screen's language), or nothing. */
export function blurbsOf(words) {
  const out = {};
  for (const l of LANGS) if (typeof words?.[l]?.blurb === 'string' && words[l].blurb.trim()) out[l] = words[l].blurb.trim().slice(0, 200);
  return Object.keys(out).length ? { blurbs: out } : {};
}

/**
 * Samples planned for the shelf but not in this copy yet (decided 2026-11-06: the shelf shows six, the ones still
 * being made as "Coming"). Only shown while no starter of that id is found: once a starter folder with the id is
 * there, it takes the card. Their words are English like every starter.json (the shelf shows titles as they are).
 * Remove a line once its starter is in starters/ (Big Swell's went on 2026-11-06).
 */
export const COMING = [
  { id: 'domino-spiral', dim: '3d', title: 'Domino Spiral', order: 3, blurb: '400 glowing dominoes in a spiral. Bend the line by hand, then knock the first one.' },
  { id: 'marble-rain', dim: '2d', title: 'Marble Rain', order: 4, blurb: 'Hundreds of marbles pour through pegs. Move a peg and they land somewhere else.' },
];

/**
 * The shelf (the editor's first screen in a folder without a game): every starter in `order`, then id, with the
 * planned ones not here yet as `coming: true`. Not 3d first like readStarters: the shelf is one row of six, in the
 * order chosen for it (decided 2026-11-06), not grouped by dimension.
 */
export function shelfList(list, o = {}) {
  const have = new Set(list.map((s) => s.id));
  // No "Coming" cards for the fallback examples or for samples taken from elsewhere (--starters-dir: tests, a branch).
  const coming = o.coming === false || list.some((s) => s.fallback) ? [] : COMING.filter((c) => !have.has(c.id)).map((c) => ({ ...c, thumb: null, try: null, coming: true }));
  return [...list, ...coming].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
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

/**
 * The one stdout line for a folder without a game. `shelf` (the editor is opening): the person picks a sample on the
 * editor's shelf, so the agent asks nothing (decided 2026-11-06; it used to ask "3D or 2D?" and run --starter). Without
 * `shelf` (a check that needs a game, e.g. --check-view): what to run instead.
 */
export function noGameLine(root, list, o = {}) {
  if (!list.length) return `studio: no-game ${root} - no index.html and no samples to start from`;
  return o.shelf
    ? `studio: no-game ${root} - the editor opens on its shelf of samples: don't ask which one, the person picks one there and it is copied into this folder`
    : `studio: no-game ${root} - nothing to check yet: start the editor without this option, and the person picks a sample on its shelf`;
}
