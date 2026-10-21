// Finding the person's own game when the folder has no index.html (hands-on report 2026-10-21, "own game").
//
// WHY: someone made NEON ORB as `neon-orb.html`, pasted the install line, and the AI said "it isn't called
// index.html, so the editor can't find it; here is a sample game instead". Then, asked again, it copied the game
// into a new folder as index.html and opened the copy (saving there never changed their game). Both came from the
// editor only knowing `index.html`. Now, with no index.html and no --entry, the editor looks for the game's page
// itself, whatever it is called, and opens THAT file: nothing is renamed, copied or created.
//
// How a page is judged (score; >= GAME_MIN is "a game"):
//   +5  an engine: three / phaser / pixi / babylon / p5 / kaboom / kaplay / excalibur / playcanvas / melonjs
//       (an import, a CDN script, or THREE. / PIXI. / new Phaser.Game), or a Godot web export (new Engine()
//   +2  a canvas (<canvas>, createElement('canvas'), getContext()
//   +2  a game loop (requestAnimationFrame)
//   +1  keys or pointer input (keydown / pointerdown / mousedown / touchstart)
//   -6  a page that is plainly not the game: readme / license / changelog / about / privacy / terms / coverage /
//       report in its name, a *.test.html, or a docs generator's <meta name="generator">
// The page's own inline scripts and the local scripts it loads (and what those import, two levels) are read too,
// so `<script src="main.js">` with all the game in main.js counts the same as a single-file game.
// WHY a score and not "the only .html": a game folder often has an about.html or an exported README next to the
// game; those must never win. WHY GAME_MIN = 4: canvas + loop alone (a hand-written canvas game) is a game; a page
// with only a <canvas> (a chart demo) or only keyboard handlers is not.
//
// Ties: shallower first (the game is usually at the top), then a name with "game" or "index" in it, then a-z.
// A page that loads .ts / .tsx / .jsx / .vue straight from the HTML cannot run without its build (Vite source):
// it is only picked when nothing runnable is there, and then `needsBuild` says so.

import { promises as fs } from 'node:fs';
import path from 'node:path';

export const GAME_MIN = 4;
// Folders never looked in: tooling, the editor's own notes, tests and reports. Hidden folders are skipped too.
const FG_SKIP_DIRS = new Set(['node_modules', 'bower_components', 'vendor', 'test', 'tests', '__tests__', 'spec', 'e2e', 'coverage', 'playwright-report', 'test-results']);
const FG_MAX_DEPTH = 4; // the folder itself = 0; dist/index.html = 1
const FG_MAX_PAGES = 200; // a huge tree (a whole website) stops being searched here
const FG_MAX_READ = 512 * 1024; // bytes read per file: enough to see the imports of a bundle's head
const FG_MAX_SCRIPTS = 24; // local scripts read per page

// WHY not "test" or "docs" here: people do call a quick game test.html, and docs/ is where GitHub Pages serves a
// game from. Test folders are skipped by name (FG_SKIP_DIRS), docs pages are caught by their generator.
const NOT_GAME_NAME = /(^|[-_.\/ ])(readme|license|licence|changelog|about|privacy|terms|coverage|report)([-_. ]|$)|\.(test|spec)\.html?$/i;
const DOCS_GENERATOR = /<meta[^>]+name=["']generator["'][^>]+content=["'][^"']*(markdown|docusaurus|jsdoc|typedoc|istanbul|mkdocs|sphinx|hugo|jekyll|vitepress|pandoc)/i;
const FG_ENGINE = new RegExp([
  String.raw`from\s*['"](three|three\/[^'"]*|phaser|pixi\.js|@pixi\/[^'"]+|babylonjs|@babylonjs\/[^'"]+|p5|kaboom|kaplay|excalibur|playcanvas|melonjs)['"]`,
  String.raw`<script[^>]+src=["'][^"']*(three(\.module)?(\.min)?\.js|phaser[^"'\/]*\.js|pixi[^"'\/]*\.js|babylon[^"'\/]*\.js|p5(\.min)?\.js|kaboom[^"'\/]*\.js|kaplay[^"'\/]*\.js|excalibur[^"'\/]*\.js|playcanvas[^"'\/]*\.js|melonjs[^"'\/]*\.js)`,
  String.raw`"(three|phaser|pixi\.js)"\s*:\s*"`, // an import map
  String.raw`\bTHREE\.(Scene|WebGLRenderer)\b|new\s+Phaser\.Game\b|\bPIXI\.Application\b|new\s+Application\s*\(|new\s+BABYLON\.Engine\b|\bnew\s+Engine\s*\(\s*[A-Z_a-z]*(config|CONFIG)`,
].join('|'));
const FG_CANVAS = /<canvas\b|createElement\(\s*['"]canvas['"]\s*\)|\.getContext\(\s*['"](2d|webgl2?|webgpu)['"]/;
const FG_LOOP = /\brequestAnimationFrame\b|setAnimationLoop\b/;
const FG_INPUT = /['"](keydown|keyup|pointerdown|pointermove|mousedown|touchstart)['"]/;
const FG_BUILD_ONLY = /<script[^>]+src=["'][^"']+\.(ts|tsx|jsx|vue|svelte)["']/i;

/**
 * Every page under `root` that looks like a game, best first: [{ entry, score, needsBuild }]. `entry` is the page's
 * path relative to `root`, with forward slashes. Pages below GAME_MIN are not listed.
 */
export async function findGamePages(root) {
  const pages = [];
  await walkPages(root, '', 0, pages);
  const out = [];
  for (const rel of pages) {
    const r = await scorePage(root, rel);
    if (r.score >= GAME_MIN) out.push({ entry: rel, ...r });
  }
  return out.sort(byGameLike);
}

/**
 * The page to open for a folder with no index.html: the best runnable game page, else the best one that needs a
 * build (needsBuild: true), else null (no game here: the sample is offered). `others` = the rest, best first.
 */
export async function pickGamePage(root) {
  const all = await findGamePages(root);
  if (!all.length) return null;
  const best = all.find((p) => !p.needsBuild) || all[0];
  return { ...best, others: all.filter((p) => p !== best).map((p) => p.entry) };
}

function byGameLike(a, b) {
  if (a.needsBuild !== b.needsBuild) return a.needsBuild ? 1 : -1;
  if (a.score !== b.score) return b.score - a.score;
  const da = a.entry.split('/').length;
  const db = b.entry.split('/').length;
  if (da !== db) return da - db;
  const na = /game|index/i.test(path.basename(a.entry)) ? 0 : 1;
  const nb = /game|index/i.test(path.basename(b.entry)) ? 0 : 1;
  if (na !== nb) return na - nb;
  return a.entry < b.entry ? -1 : a.entry > b.entry ? 1 : 0;
}

async function walkPages(root, rel, depth, pages) {
  if (pages.length >= FG_MAX_PAGES) return;
  const items = await fs.readdir(path.join(root, rel), { withFileTypes: true }).catch(() => []);
  items.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)); // the same answer on every computer
  for (const it of items) {
    if (it.name.startsWith('.')) continue;
    const r = rel ? `${rel}/${it.name}` : it.name;
    if (it.isFile() && /\.html?$/i.test(it.name)) {
      if (pages.length < FG_MAX_PAGES) pages.push(r);
    } else if (it.isDirectory() && depth < FG_MAX_DEPTH && !FG_SKIP_DIRS.has(it.name.toLowerCase())) {
      await walkPages(root, r, depth + 1, pages);
    }
  }
}

async function fgReadHead(file) {
  let fh;
  try {
    fh = await fs.open(file, 'r');
    const buf = Buffer.alloc(FG_MAX_READ);
    const { bytesRead } = await fh.read(buf, 0, FG_MAX_READ, 0);
    return buf.subarray(0, bytesRead).toString('utf8');
  } catch {
    return '';
  } finally {
    await fh?.close().catch(() => {});
  }
}

/**
 * Local script paths a page or script loads (no URLs with a scheme, no bare package names in imports). `top` is the
 * page's folder: a path starting with / is read from there, because that folder is what the editor serves as the
 * top (a built dist/index.html asks for /assets/index-abc.js = dist/assets/index-abc.js).
 */
function fgLocalScripts(text, fromDir, top) {
  const out = [];
  const add = (spec, bareIsFile) => {
    if (!spec || /^[a-z][a-z0-9+.-]*:|^\/\//i.test(spec)) return;
    // <script src="game.js"> is a file next to the page; import 'three' is a package (an engine), not a file.
    if (!bareIsFile && !/^[./]/.test(spec)) return;
    const clean = spec.split(/[?#]/)[0];
    const abs = clean.startsWith('/') ? path.join(top, clean) : path.join(fromDir, clean);
    if (!abs.startsWith(top)) return; // never outside the page's folder
    out.push(abs);
  };
  for (const m of text.matchAll(/<script[^>]*\bsrc=["']([^"']+)["']/gi)) add(m[1], true);
  for (const m of text.matchAll(/\bimport\s*(?:[^'"()]*?\bfrom\s*)?['"]([^'"]+)['"]/g)) add(m[1], false);
  for (const m of text.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) add(m[1], false);
  return out;
}

/** { score, needsBuild } for one page (`rel` relative to `root`). */
export async function scorePage(root, rel) {
  const file = path.join(root, rel);
  const html = await fgReadHead(file);
  const needsBuild = FG_BUILD_ONLY.test(html);
  // The page and what it loads, as one text: an engine in main.js counts like one in the page.
  let text = html;
  const seen = new Set([file]);
  const top = path.dirname(file);
  let wave = fgLocalScripts(html, top, top);
  for (let level = 0; level < 2 && wave.length; level++) {
    const next = [];
    for (const s of wave) {
      if (seen.has(s) || seen.size > FG_MAX_SCRIPTS) continue;
      seen.add(s);
      const js = await fgReadHead(s);
      text += '\n' + js;
      next.push(...fgLocalScripts(js, path.dirname(s), top));
    }
    wave = next;
  }
  let score = 0;
  if (FG_ENGINE.test(text)) score += 5;
  if (FG_CANVAS.test(text)) score += 2;
  if (FG_LOOP.test(text)) score += 2;
  if (FG_INPUT.test(text)) score += 1;
  if (NOT_GAME_NAME.test(rel) || DOCS_GENERATOR.test(html)) score -= 6;
  return { score, needsBuild };
}

/** The stdout line that tells the agent which page was opened, and how to open another. */
export function entryLine(pick, root) {
  const others = pick.others.length ? ` Other game pages: ${pick.others.slice(0, 3).join(', ')}${pick.others.length > 3 ? ' …' : ''}.` : '';
  // Worded so an agent can pass it on without "it isn't called index.html" (the very words that disappointed): it
  // says which file is open and that it is the file itself, nothing about what is missing.
  return `studio: entry ${pick.entry} - the game page in ${root}, opened as it is (not copied).${others} Wrong page? Run again with --entry <file>`;
}
