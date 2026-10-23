// The pictures of the objects, Ive review 3 ⑥ and ⑧ (2026-10-20), in a headless browser on Lantern Cove, PC 1280×800.
//
//   node test/studio-thumbs-keep.browser.mjs
//
// ⑧ The Library's tiles are sharp: each tile's picture is drawn at twice the tile's size on screen (it was the list's
//    96 px picture stretched to ~115–135 px), and the lighthouse's tile is the tower, not its light beams: the tower
//    fills at least 60 % of the tile's height (it was a small blurred stroke in the middle).
// ⑥ ▶ Play → Edit: the list's pictures are there the moment the list is back (the old ones, replaced as the new ones
//    come). Before, every row was an empty square until each picture was drawn again.
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStudioServer } from '../src/server/server.mjs';
import { launch, newPage } from './adapters-2d/cdp.mjs';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ROWS = `JSON.stringify((() => { const rows = [...document.querySelectorAll('.objects .obj')]; return { rows: rows.length,
  pictures: rows.filter((r) => { const i = r.querySelector('img'); return i && !i.hidden && i.getAttribute('src'); }).length }; })())`;

const root = mkdtempSync(join(tmpdir(), 'studio-thumbs-keep-'));
cpSync(join(PKG, 'starters/lantern-cove'), root, { recursive: true, filter: (p) => !p.includes('/.studio/') && !p.endsWith('/.studio') && !p.endsWith('placement.json') });
// No KUMODeck sign-in (studio-library-shelf, 2026-10-23): the Library reads it at once now for its "✦ Make with AI" words,
// and the real ~/.kumo of the machine running this must not be read (nor its balance land in a picture).
const srv = await startStudioServer({ root, kumo: { home: join(root, '.no-kumo-home'), env: {} }, uiDir: join(PKG, 'skills/arrange/bin/studio-ui'), log: () => {} });
const browser = await launch();
try {
  const page = await newPage(browser, { width: 1280, height: 800, cdnCache: process.env.STUDIO_CDN_CACHE });
  await page.goto(srv.url);
  await page.waitFor(`document.querySelectorAll('.objects .obj').length > 10`, 120000);
  // Every row drawn once.
  await page.waitFor(`(() => { const r = JSON.parse(${ROWS}); return r.pictures === r.rows; })()`, 60000);

  // ⑧ The Library.
  await page.eval(`(document.querySelector('.nav-row[data-tool=library]').click(), true)`);
  const SHARP = `(() => { const i = document.querySelector('.assets-page .gsl-tile[data-key=lighthouse] img.shelf-pic'); return !!i && !i.hidden && i.complete && i.naturalWidth >= 2 * i.clientWidth - 32; })()`;
  await page.waitFor(SHARP, 60000);
  const tile = JSON.parse(await page.eval(`JSON.stringify((() => { const i = document.querySelector('.assets-page .gsl-tile[data-key=lighthouse] img.shelf-pic');
    const n = i.naturalWidth, c = document.createElement('canvas'); c.width = c.height = n; const g = c.getContext('2d'); g.drawImage(i, 0, 0);
    const d = g.getImageData(0, 0, n, n).data; let top = n, bottom = -1;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (d[(y * n + x) * 4 + 3] > 24) { if (y < top) top = y; bottom = y; break; }
    return { natural: n, shown: i.clientWidth, tall: (bottom - top + 1) / n }; })())`));
  assert.ok(tile.natural >= 2 * tile.shown - 32, `the tile's picture is twice its size on screen: ${JSON.stringify(tile)}`);
  assert.ok(tile.tall >= 0.6, `the lighthouse fills 60 % of its tile's height or more: ${JSON.stringify(tile)}`);
  console.log(`  ok ⑧: lighthouse tile ${tile.natural} px for ${tile.shown} px on screen, ${Math.round(tile.tall * 100)} % tall`);
  await page.eval(`(document.querySelector('.nav-row[data-tool=placement]').click(), true)`);
  await sleep(500);

  // ⑥ Play → Edit.
  await page.eval(`(document.querySelector('button.play').click(), true)`);
  await page.waitFor(`document.querySelector('.shell').dataset.playing === 'on'`, 30000);
  await sleep(2000);
  await page.eval(`(document.querySelector('button.play').click(), true)`);
  await page.waitFor(`document.querySelector('.shell').dataset.playing === 'off' && document.querySelectorAll('.objects .obj').length > 10`, 60000);
  const back = JSON.parse(await page.eval(ROWS));
  assert.equal(back.pictures, back.rows, `every row has its picture the moment the list is back: ${JSON.stringify(back)}`);
  console.log(`  ok ⑥: after Edit, ${back.pictures} / ${back.rows} rows with a picture at once`);
  console.log('studio-thumbs-keep: ok');
} finally {
  await browser.close();
  await srv.close();
  rmSync(root, { recursive: true, force: true });
}
process.exit(0);
