// The web demo's Assets panel on the starters' real files (2026-10-17: until then both starters drew everything in
// code, so Assets only said "No assets yet…" and listing, "Used by" and Replace could not be tried in the demo).
//
//   node test/web-demo-assets.browser.mjs [--dir <built folder>] [--shots <dir>] [--lang ja|en] [--only pc,390]
//
// Without --dir it builds the demo into a temporary folder first (scripts/build-web-demo.mjs), then serves it like
// KUMODeck's test version (test/web-demo-host.mjs). Per sample (Lantern Cove 3D, Firefly Ruins 2D), at 1280×800
// with a mouse and 390×844 with touch, headless:
//   1. the demo has a tab icon: /favicon.ico answers (it was a 404), both pages link it
//   2. Assets lists the starter's files (from studio/games.json), all "used" except the spare picture
//   3. each used file says which objects use it ("Used by": sail.jpg → sailboat, planks.jpg → crate + pier +
//      rowboat, bell.png → bell, …) — what the game's loaders and the adapter report, not a table in the test
//   4. Replace in the panel: sail.jpg → sail-tanbark.jpg / boat.png → boat-lacquer.png is recorded (the tile says
//      "→ sail-tanbark.jpg"), and "Keep the original" takes it back. Whether the picture is also shown in the game
//      right away is printed: the edit script does not do that preview yet (src/bridge/editor.ts answers
//      studio:library/preview with ok: false), so it is a note, or a failure with --strict-preview
//   5. the file really is the game's picture: the same demo with sail.jpg's bytes swapped for sail-tanbark.jpg's
//      (what the replace becomes once applied) shows a different picture on that object (the average colour of its
//      screen box in the Scene view, against the noise of loading the original twice)
// A fresh browser profile per run (the demo keeps the panel's state in the browser). No page errors.
// --shots writes <size>-<game>-1-assets, -2-used-by, -3-replace, -4-before, -5-after (.png). Exit 1 on failure.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { launch, newPage } from './adapters-2d/cdp.mjs';
import { startHost } from './web-demo-host.mjs';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const SHOTS = opt('--shots') ? resolve(opt('--shots')) : null;
const LANG = opt('--lang') || 'ja';
const ONLY = opt('--only')?.split(',');
const STRICT_PREVIEW = args.includes('--strict-preview');
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
let DIR = opt('--dir') ? resolve(opt('--dir')) : null;
if (!DIR) {
  DIR = join(mkdtempSync(join(tmpdir(), 'studio-web-demo-assets-')), 'site');
  execFileSync(process.execPath, [join(PKG, 'scripts/build-web-demo.mjs'), '--out', DIR], { stdio: 'inherit' });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let VIEW_W = 1280; // CSS width of the page being shot (phones are shot at 2× pixels); set per run

const SIZES = [
  { tag: 'pc', width: 1280, height: 800, mobile: false },
  { tag: '390', width: 390, height: 844, mobile: true },
].filter((s) => !ONLY || ONLY.includes(s.tag));

// What each starter's files are for (starters/<id>/js: the game code says the same in its comments).
const EXPECT = {
  'lantern-cove': {
    files: ['barrel.glb', 'bell.mp3', 'planks.jpg', 'sail-tanbark.jpg', 'sail.jpg', 'waves.mp3'],
    usedBy: { 'assets/sail.jpg': ['sailboat'], 'assets/planks.jpg': ['crate', 'pier', 'rowboat'], 'assets/barrel.glb': ['barrel'], 'assets/bell.mp3': ['buoy'] },
    spare: 'assets/sail-tanbark.jpg',
    replace: ['assets/sail.jpg', 'assets/sail-tanbark.jpg'],
  },
  'firefly-ruins': {
    files: ['banner.png', 'bell.mp3', 'bell.png', 'boat-lacquer.png', 'boat.png', 'lantern.png'],
    usedBy: { 'assets/bell.png': ['bell'], 'assets/bell.mp3': ['bell'], 'assets/lantern.png': ['lantern'], 'assets/boat.png': ['boat'], 'assets/banner.png': ['banner'] },
    spare: 'assets/boat-lacquer.png',
    replace: ['assets/boat.png', 'assets/boat-lacquer.png'],
  },
};
const WORDS = { ja: { preview: 'ゲームの中で見せています' }, en: { preview: 'Previewing in the game' } }[LANG];

const FRAME = `document.querySelector('iframe')`;
const IN = {
  ready: `document.querySelectorAll('.obj').length > 0 && !!${FRAME}?.contentWindow.__gameStudio?._debug`,
  tiles: `JSON.stringify([...document.querySelectorAll('.gsl-tile[data-path]')].filter((t) => !t.closest('.gsl-picker')).map((t) => ({
    path: t.dataset.path, name: t.querySelector('.gsl-name')?.textContent, badge: t.querySelector('.gsl-meta')?.firstElementChild?.className || '' })))`,
  keys: `JSON.stringify([...document.querySelectorAll('.gsl-in-scene .gsl-key')].map((k) => k.firstChild.textContent.trim()))`,
  status: `document.querySelector('.gsl-status')?.textContent || ''`,
  click: (sel) => `(() => { const b = document.querySelector(${JSON.stringify(sel)}); if (!b) return false; b.scrollIntoView({ block: 'center' }); b.click(); return true; })()`,
  // The screen box of one object (page px): where its picture is. Comparing only there keeps the game's own
  // movement elsewhere (fireflies, ripples: the editor freezes the game at a slightly different time per load) out.
  box: (key) => `(() => { const f = ${FRAME}.getBoundingClientRect(); const a = ${FRAME}.contentWindow.__gameStudio._debug.anchor(${JSON.stringify(key)});
    if (!a) return null; const r = a.rect; return JSON.stringify({ left: f.left + r.x, top: f.top + r.y, right: f.left + r.x + r.w, bottom: f.top + r.y + r.h }); })()`,
};

// The same demo with each starter's replaced file swapped for its replacement, served next to the original.
const SWAPPED = join(mkdtempSync(join(tmpdir(), 'studio-web-demo-swapped-')), 'site');
cpSync(DIR, SWAPPED, { recursive: true });
for (const [game, { replace: [from, to] }] of Object.entries(EXPECT)) copyFileSync(join(DIR, 'games', game, to), join(SWAPPED, 'games', game, from));

const host = await startHost({ dir: DIR });
const host2 = await startHost({ dir: SWAPPED });
const base = host.url;
let failed = 0;
const notes = [];
try {
  // --- 1. the tab icon ---
  for (const [path, type] of [['favicon.ico', 'image/x-icon'], ['favicon.svg', 'image/svg+xml'], ['apple-touch-icon.png', 'image/png']]) {
    const r = await fetch(new URL(path, base));
    assert.equal(r.status, 200, `${path}: HTTP ${r.status}`);
    assert.equal(r.headers.get('content-type'), type, `${path}: ${r.headers.get('content-type')}`);
  }
  console.log('  ✓ favicon.ico, favicon.svg and apple-touch-icon.png answer');
  for (const size of SIZES) {
    for (const game of Object.keys(EXPECT)) {
      try {
        await run(size, game);
      } catch (e) {
        failed++;
        console.log(`  ✗ ${size.tag}-${game}: ${e.message}`);
      }
    }
  }
} finally {
  await host.close();
  await host2.close();
  rmSync(dirname(SWAPPED), { recursive: true, force: true });
}
for (const n of notes) console.log(`  · ${n}`);
if (failed) process.exit(1);
console.log('web demo assets: all passed');

async function run(size, game) {
  const tag = `${size.tag}-${game}`;
  const want = EXPECT[game];
  const step = (s) => console.log(`  ✓ ${tag}: ${s}`);
  const browser = await launch(); // a fresh profile: no replace or save left from an earlier run
  const page = await newPage(browser, size);
  const j = async (expr) => JSON.parse((await page.eval(expr)) || 'null');
  const shot = async (name) => {
    const png = await page.screenshot();
    if (SHOTS) writeFileSync(join(SHOTS, `${tag}-${name}.png`), png);
    return png;
  };
  const open = async (at) => {
    await page.goto(`${at}studio/?game=${game}&lang=${LANG}`);
    await page.waitFor(IN.ready, 60000);
    await sleep(1200); // the first picture and the thumbnails
  };
  /** The game in the Scene view (on a phone the Assets sheet covers most of it). */
  const sceneShot = async (name) => {
    await page.eval(IN.click('[data-tool=placement]'));
    await sleep(900);
    // Phone: the Scene from the Library sheet opens the object list sheet; close it to see the game.
    if (await page.eval(`document.querySelector('.shell')?.dataset.sheet === 'open'`)) {
      await page.eval(IN.click('[data-action=sheet]'));
      await sleep(700);
    }
    return decodePng(name ? await shot(name) : await page.screenshot());
  };
  VIEW_W = size.width;
  const errorsSoFar = () => page.logs.filter((l) => l.startsWith('exception') || l.startsWith('error'));
  try {
    await open(base);
    const icons = await page.eval(`[...document.querySelectorAll('link[rel~=icon]')].map((l) => new URL(l.href).pathname)`);
    assert.ok(icons.some((p) => p.endsWith('/favicon.ico')), `editor page icons: ${icons}`);

    // --- 2. the list ---
    assert.ok(await page.eval(IN.click('[data-tool=library]')), 'no Assets button');
    await page.waitFor(`document.querySelectorAll('.gsl-tile[data-path]').length >= ${want.files.length}`, 15000);
    await sleep(600); // thumbnails
    const tiles = await j(IN.tiles);
    assert.deepEqual(tiles.map((t) => t.name).sort(), want.files, `files: ${tiles.map((t) => t.name)}`);
    for (const t of tiles) {
      const used = !/unused/.test(t.badge);
      assert.equal(used, t.path !== want.spare, `${t.path}: badge ${t.badge}`);
    }
    step(`Assets lists ${tiles.length} files (${tiles.filter((t) => !/unused/.test(t.badge)).length} used, the spare one unused)`);
    await page.eval(`document.querySelector('.gsl-tile')?.scrollIntoView({ block: 'center' })`);
    await shot('1-assets');

    // --- 3. Used by ---
    const [from, to] = want.replace;
    for (const path of [...Object.keys(want.usedBy).filter((p) => p !== from), from]) { // the replaced one last: its detail stays open
      const keys = want.usedBy[path];
      assert.ok(await page.eval(IN.click(`.gsl-tile[data-path="${path}"]`)), `no tile ${path}`);
      await page.waitFor(`document.querySelector('.gsl-dtitle .gsl-path')?.textContent === ${JSON.stringify(path)}`, 5000);
      // The objects that use a file come from the game page; give it a moment on a slow software GPU.
      let got = [];
      for (let i = 0; i < 30 && keys.some((k) => !got.includes(k)); i++) {
        got = await j(IN.keys);
        if (keys.some((k) => !got.includes(k))) await sleep(200);
      }
      assert.deepEqual([...got].sort(), [...keys].sort(), `${path} used by ${got}`);
    }
    step(`Used by: ${Object.entries(want.usedBy).map(([p, k]) => `${p.split('/').pop()} → ${k.join(' + ')}`).join(', ')}`);
    await page.eval(`document.querySelector('.gsl-in-scene')?.scrollIntoView({ block: 'center' })`);
    await shot('2-used-by');

    // --- 4. Replace in the panel ---
    assert.ok(await page.eval(IN.click('.gsl-replace .gsl-primary')), 'no Replace button');
    await page.waitFor(`!!document.querySelector('.gsl-picker .gsl-tile[data-path="${to}"]')`, 5000);
    assert.ok(await page.eval(IN.click(`.gsl-picker .gsl-tile[data-path="${to}"]`)), `${to} is not offered`);
    await page.waitFor(`!!(${IN.status})`, 10000);
    const status = await page.eval(IN.status);
    const toName = to.split('/').pop();
    assert.ok(await page.eval(`[...document.querySelectorAll('.gsl-tile[data-path="${from}"] .gsl-tag-replace')].some((t) => t.textContent.includes(${JSON.stringify(toName)}))`),
      `the tile of ${from} does not say → ${toName}`);
    await page.eval(`document.querySelector('.gsl-replace')?.scrollIntoView({ block: 'center' })`);
    await shot('3-replace');
    const previewed = status.includes(WORDS.preview);
    if (!previewed) {
      const n = `${tag}: Replace is recorded, but the game does not show ${toName} yet ("${status}"): the edit script's studio:library/preview is not built (src/bridge/editor.ts)`;
      if (STRICT_PREVIEW) throw new Error(n);
      notes.push(n);
    }
    step(`Replace ${from.split('/').pop()} → ${toName}: recorded on the tile; panel says "${status}"`);
    assert.ok(await page.eval(IN.click('.gsl-replace .gsl-btn:not(.gsl-primary)')), 'no "keep the original" button');
    await sleep(500);
    assert.equal(await page.eval(`document.querySelectorAll('.gsl-tile[data-path="${from}"] .gsl-tag-replace').length`), 0, 'the replace stayed after "keep the original"');
    step('"keep the original" takes it back');

    // --- 5. the file is the game's picture: swap the file, the game changes ---
    const before = await sceneShot('4-before');
    const key = want.usedBy[from][0];
    const rect = await j(IN.box(key));
    assert.ok(rect && rect.right > rect.left, `${key} has no box on screen`);
    await open(base);
    const before2 = await sceneShot(null);
    assert.deepEqual(errorsSoFar(), [], 'page errors');
    await open(host2.url);
    const after = await sceneShot('5-after');
    // The average colour of the object's box: a new picture moves it a lot; loading the same game twice barely does
    // (the editor stops a bobbing boat at a slightly different height each time: its edges differ, its colour not).
    const m0 = meanColor(before, rect), noise = colorDistance(m0, meanColor(before2, rect)), diff = colorDistance(m0, meanColor(after, rect));
    assert.ok(diff > Math.max(4, noise * 4), `the game did not change with ${toName} as ${from}: average colour moved ${diff.toFixed(1)} (noise ${noise.toFixed(1)})`);
    step(`${from} swapped for ${toName} → the ${key}'s average colour moved ${diff.toFixed(1)} (loading the original twice: ${noise.toFixed(1)})`);
    assert.deepEqual(errorsSoFar(), [], 'page errors');
  } catch (e) {
    console.log(page.logs.slice(-15).join('\n'));
    await shot('FAIL').catch(() => {});
    throw e;
  } finally {
    await page.close();
    await browser.close();
  }
}

/** Average [r, g, b] inside `rect` (page px; phones are shot at 2×, scaled here). */
function meanColor(p, rect, k = p.width / VIEW_W) {
  const x0 = Math.max(0, Math.floor(rect.left * k)), y0 = Math.max(0, Math.floor(rect.top * k));
  const x1 = Math.min(p.width, Math.ceil(rect.right * k)), y1 = Math.min(p.height, Math.ceil(rect.bottom * k));
  const sum = [0, 0, 0];
  let n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * p.width + x) * 4;
    sum[0] += p.data[i]; sum[1] += p.data[i + 1]; sum[2] += p.data[i + 2];
    n++;
  }
  return sum.map((v) => v / Math.max(1, n));
}
function colorDistance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** The PNGs Chrome writes: 8-bit RGB or RGBA, not interlaced → { width, height, data: RGBA }. */
function decodePng(buf) {
  let o = 8, width = 0, height = 0, type = 0;
  const idat = [];
  while (o < buf.length) {
    const len = buf.readUInt32BE(o), kind = buf.toString('latin1', o + 4, o + 8), body = buf.subarray(o + 8, o + 8 + len);
    if (kind === 'IHDR') {
      width = body.readUInt32BE(0); height = body.readUInt32BE(4); type = body[9];
      assert.ok(body[8] === 8 && (type === 2 || type === 6) && body[12] === 0, 'unexpected PNG format');
    } else if (kind === 'IDAT') idat.push(body);
    o += 12 + len;
  }
  const bpp = type === 6 ? 4 : 3, stride = width * bpp, raw = inflateSync(Buffer.concat(idat));
  const px = Buffer.alloc(stride * height), data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), row = y * stride;
    for (let x = 0; x < stride; x++) {
      const left = x >= bpp ? px[row + x - bpp] : 0, up = y ? px[row - stride + x] : 0, ul = y && x >= bpp ? px[row - stride + x - bpp] : 0;
      let v = line[x];
      if (f === 1) v += left;
      else if (f === 2) v += up;
      else if (f === 3) v += (left + up) >> 1;
      else if (f === 4) {
        const pa = Math.abs(up - ul), pb = Math.abs(left - ul), pc = Math.abs(left + up - 2 * ul);
        v += pa <= pb && pa <= pc ? left : pb <= pc ? up : ul;
      }
      px[row + x] = v & 0xff;
    }
  }
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = px[i * bpp]; data[i * 4 + 1] = px[i * bpp + 1]; data[i * 4 + 2] = px[i * bpp + 2]; data[i * 4 + 3] = bpp === 4 ? px[i * bpp + 3] : 255;
  }
  return { width, height, data };
}
