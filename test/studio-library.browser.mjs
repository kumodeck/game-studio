// One Library (decided after a try of the editor, 2026-10-18): "put objects and files all in one library; the left has two things,
// Scene and Library; inside the Library you narrow it to objects or files." Before (plan 1, the same morning) the
// objects had a shelf of their own ("Objects" with a "Scene | Grid" switch) next to the files' shelf ("Assets").
//
// With the real server and the built editor, Lantern Cove (3D) and Firefly Ruins (2D), at PC 1280×800 (mouse), the
// side window next to a chat 400×900 (mouse, the narrow layout) and a phone 390×844 (touch), dark then light:
//   1. the left has two rows, Scene and Library (the Library counts everything in it); the Scene shows the game and
//      its list under "In this scene" (PC), not to be mixed up with the Library
//   2. Library: objects and assets in ONE grid (a tile per object kind, then the files), each tile tagged "Object" /
//      "Asset"; the game out of view; the left column = the Library's filters and no object row anywhere on screen;
//      narrow: the Scene | Library switch heads the sheet, the chips scroll sideways
//   3. the filters are one list, All / 3D / 2D / Sound / Other, no headings, a shelf with nothing on it hidden (a review
//      2026-10-18, it replaced Show / Made from / Asset type / Use), each counted; the game's own shelf (3D for Lantern
//      Cove, 2D for Firefly Ruins) holds every object (files are read: objects drawn with a file name it) and its
//      files; another shelf holds only its files; a second press goes back to All; "All" brings everything back —
//      every press in the left column keeps the Library (the 10/18 bug). Used / unused stays on the file tiles.
//   4. a press on an object's tile picks it (real input): still the Library, its detail on the right (Show in game →,
//      Duplicate, Delete), the camera did not move, keys don't move the hidden object; Duplicate + ⌘Z; Escape drops it
//   5. the object's file ("planks.jpg →") opens the file's detail in the Library (one detail at a time: the pick goes)
//   6. a file's detail names the objects that use it; "Show just these objects" narrows the Library to them
//      ("planks.jpg used by 3 ×"), still no game; a name there opens that object's detail, still the Library
//   7. (PC) the last row is not cut: scrolled to the end, the last tile's name is seen above the AI bar
//   8. "Show in game →": the Scene, the game back, the pick kept
// Pictures (--shots <dir>): <game>-<size>-<theme>-1-scene / 2-library-all / 3-library-<3d|2d> (the game's shelf) /
// 4-object-detail / 5-library-sound / 6-asset-detail.png
//
//   node test/studio-library.browser.mjs [--shots <dir>] [--only pc,side,phone] [--game lantern-cove|firefly-ruins]
//                                        [--theme dark|light|both] [--lang ja|en]
// Exit 1 on failure.
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStudioServer } from '../src/server/server.mjs';
import { launch, newPage } from './adapters-2d/cdp.mjs';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const SHOTS = opt('--shots') ? resolve(opt('--shots')) : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const LANG = opt('--lang') || 'ja';
const THEMES = (opt('--theme') || 'both') === 'both' ? ['dark', 'light'] : [opt('--theme')];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// shared: a file several objects use (the one the Library is narrowed by). dim: the shelf the game's objects sit on.
// shelves: the filters the game should show (one with nothing on it is hidden: neither starter has fonts or JSON).
const GAMES = [
  { id: 'lantern-cove', shared: 'assets/planks.jpg', dim: '3d', shelves: ['all', '3d', '2d', 'sound'] },
  { id: 'firefly-ruins', shared: null, dim: '2d', shelves: ['all', '2d', 'sound'] },
].filter((g) => !opt('--game') || g.id === opt('--game'));
const SIZES = [
  { id: 'pc', w: 1280, h: 800, touch: false },
  { id: 'side', w: 400, h: 900, touch: false },
  { id: 'phone', w: 390, h: 844, touch: true },
].filter((s) => !opt('--only') || opt('--only').split(',').includes(s.id));

const WIN = `document.querySelector('iframe.game:not(.leaving)').contentWindow`;
// Visible = laid out, on screen and not covered (what a person can see and press).
const VIS = `(e) => { if (!e || !e.isConnected) return false; const r = e.getBoundingClientRect(); if (!r.width || !r.height || r.bottom < 0 || r.top > innerHeight) return false;
  if (!e.checkVisibility({ visibilityProperty: true, opacityProperty: true })) return false;
  const x = Math.min(Math.max(r.left + r.width / 2, 1), innerWidth - 1), y = Math.min(Math.max(r.top + r.height / 2, 1), innerHeight - 1);
  const top = document.elementFromPoint(x, y); return !!top && (e === top || e.contains(top) || top.contains(e)); }`;
const visible = (sel) => `(() => { const v = ${VIS}; return [...document.querySelectorAll(${JSON.stringify(sel)})].some(v); })()`;

let failed = 0;
let browser = null, srv = null, root = null;
const fresh = async (g, theme) => {
  await browser?.close();
  await srv?.close();
  if (root) rmSync(root, { recursive: true, force: true });
  root = mkdtempSync(join(tmpdir(), 'studio-library-'));
  cpSync(join(PKG, 'starters', g.id), root, { recursive: true });
  mkdirSync(join(root, '.studio/ui'), { recursive: true });
  writeFileSync(join(root, '.studio/ui/prefs.json'), JSON.stringify({ version: 1, lang: LANG, theme }));
  srv = await startStudioServer({ root, uiDir: join(PKG, 'skills/arrange/bin/studio-ui'), log: () => {} });
  browser = await launch();
};

try {
  for (const g of GAMES) {
    for (const sz of SIZES) {
      for (const theme of THEMES) {
        const tag = `${g.id}-${sz.id}-${theme}`;
        await fresh(g, theme);
        const page = await newPage(browser, { width: sz.w, height: sz.h, mobile: sz.touch });
        const narrow = sz.w <= 720;
        const shot = async (name) => {
          if (!SHOTS) return;
          // No focus ring from the test's own presses in the pictures.
          await page.eval(`document.activeElement?.blur?.()`);
          await sleep(500);
          writeFileSync(join(SHOTS, `${tag}-${name}.png`), await page.screenshot());
        };
        // A real press (mouse click / finger tap) on the middle of the first visible match.
        const press = async (sel) => {
          const at = JSON.parse(await page.eval(`(() => { const v = ${VIS}; const all = [...document.querySelectorAll(${JSON.stringify(sel)})];
            let e = all.find(v); if (!e) { e = all.find((x) => x.getBoundingClientRect().width); e?.scrollIntoView({ block: 'center', inline: 'center' }); if (!v(e)) return 'null'; }
            const r = e.getBoundingClientRect(); return JSON.stringify([r.left + r.width / 2, r.top + r.height / 2]); })()`));
          assert.ok(at, `${tag}: nothing visible to press for ${sel}`);
          if (sz.touch) await page.tap(at[0], at[1]);
          else await page.click(at[0], at[1]);
          await sleep(350);
        };
        const selected = () => page.eval('studioShell.selected()');
        const view = () => page.eval(`JSON.stringify(${WIN}.__gameStudio._debug.view())`);
        const nItems = () => page.eval('studioShell.items().length');
        const libOn = () => page.eval(visible('.assets-page .gsl'));
        const gameOn = () => page.eval(`(() => { const f = document.querySelector('iframe.game:not(.leaving)').getBoundingClientRect(); const e = document.elementFromPoint(f.left + f.width / 2, f.top + Math.min(f.height / 3, 120)); return e && e.tagName === 'IFRAME'; })()`);
        const step = (s) => console.log(`  ${tag}: ${s}`);
        try {
          await page.goto(srv.url);
          await page.waitFor(`document.querySelectorAll('.obj').length > 0 && !!${WIN}?.__gameStudio?._debug`, 60000);
          await sleep(1500);
          const n = await nItems();
          const J = (js) => page.eval(`JSON.stringify(${js})`).then(JSON.parse);
          const tilesOf = (kind) => J(`[...document.querySelectorAll('.assets-page .gsl-tile[data-kind=${kind}]')].map((t) => t.dataset.key || t.dataset.path)`);

          // 1. Two rows: Scene and Library.
          const rows = await J(`[...document.querySelectorAll('.tabs .nav-row')].map((r) => [r.dataset.tool, r.querySelector('.label').textContent, r.querySelector('.sub')?.textContent, r.querySelector('.n')?.textContent || ''])`);
          assert.deepEqual(rows.map((r) => r[0]), ['placement', 'library'], `${tag}: Scene / Library rows`);
          assert.deepEqual(rows.map((r) => r[1]), LANG === 'ja' ? ['シーン', 'ライブラリ'] : ['Scene', 'Library']);
          assert.equal(rows[0][3], '', `${tag}: the Scene row has no count (its list counts)`);
          if (!narrow) {
            assert.ok(await page.eval(visible('.nav-row[data-tool=placement] .sub')), `${tag}: the grey word shows on PC`);
            assert.ok(await page.eval(visible('.side .list-title')), `${tag}: "In this scene" heads the Scene's list`);
          }
          assert.equal(await page.eval(`!!document.querySelector('.view-float, [data-action=objects-shelf]')`), false, `${tag}: no "Scene | Grid" / "Grid" any more`);
          step(`rows ${JSON.stringify(rows)}`);
          if (narrow) await press('.bar [data-action=sheet]');
          await shot('1-scene');

          // 2. The Library: one grid.
          const v0 = await view();
          await press('.nav-row[data-tool=library]');
          await page.waitFor(`${visible('.assets-page .gsl-tile[data-kind=object]')} && document.querySelectorAll('.assets-page .gsl-tile[data-kind=file]').length > 0`, 20000);
          await sleep(800);
          assert.ok(await libOn(), `${tag}: the Library is open`);
          if (!narrow) assert.equal(await gameOn(), false, `${tag}: the Library takes the game's place`);
          assert.equal(await page.eval(visible('li.obj')), false, `${tag}: no object row on screen with the Library open`);
          if (!narrow) assert.ok(await page.eval(`!!document.querySelector('.side .tool-body > .shelf-filters [data-shelf=all]')`), `${tag}: the left column holds the Library's filters`);
          else {
            assert.ok(await page.eval(visible('.assets-page .gsl-head .tabs')), `${tag}: the Scene | Library switch heads the sheet`);
            const row = await J(`(() => { const s = getComputedStyle(document.querySelector('.assets-page .shelf-filters')); return [s.overflowX, s.flexWrap]; })()`);
            assert.deepEqual(row, ['auto', 'nowrap'], `${tag}: the filter chips are one row that scrolls sideways`);
          }
          const objTiles = await tilesOf('object');
          const fileTiles = await tilesOf('file');
          const groups = await page.eval(`new Set(studioShell.items().map((i) => i.group || 'key:' + i.key)).size`);
          assert.equal(objTiles.length, groups, `${tag}: one tile per object kind (${objTiles.length} / ${groups})`);
          // Objects first, then the files, in the same grid.
          const order = await J(`[...document.querySelector('.assets-page .gsl-grid').children].map((t) => t.dataset.kind || '')`);
          assert.ok(order.lastIndexOf('object') < order.indexOf('file'), `${tag}: objects first, then the files (${order.join(',')})`);
          const tags = await J(`[...document.querySelectorAll('.assets-page .gsl-grid > .gsl-tile')].map((t) => t.dataset.kind + ':' + (t.querySelector('.lib-kind')?.textContent || ''))`);
          assert.ok(tags.every((x) => /:.+/.test(x)), `${tag}: every tile is tagged (${tags.join(', ')})`);
          assert.equal(rows[1][3], String(n + fileTiles.length), `${tag}: the Library counts objects + assets`);
          step(`Library: ${objTiles.length} object tiles + ${fileTiles.length} assets`);
          await page.waitFor(`document.querySelectorAll('.assets-page .lib-object .shelf-file').length > 0`, 15000);
          await shot('2-library-all');

          // 3. All / 3D / 2D / Sound / Other: one list, no headings, empty shelves hidden.
          const shelves = await J(`[...document.querySelectorAll('.shelf-filters > *')].map((c) => [c.dataset.shelf || c.tagName, c.querySelector('.label')?.textContent || '', +(c.querySelector('b')?.textContent || 0)])`);
          assert.deepEqual(shelves.map((c) => c[0]), g.shelves, `${tag}: the filters are ${g.shelves.join(' / ')} (${JSON.stringify(shelves)})`);
          const words = { ja: { all: 'すべて', '3d': '3D', '2d': '2D', sound: '音', other: 'その他' }, en: { all: 'All', '3d': '3D', '2d': '2D', sound: 'Sound', other: 'Other' } }[LANG];
          assert.deepEqual(shelves.map((c) => c[1]), g.shelves.map((k) => words[k]), `${tag}: their words`);
          assert.equal(shelves[0][2], n + fileTiles.length, `${tag}: All counts every object and asset`);
          const extOf = { '3d': /\.(glb|gltf|obj|fbx)$/i, '2d': /\.(png|jpe?g|webp|svg|gif)$/i, sound: /\.(mp3|ogg|wav|m4a)$/i };
          for (const [sh, label, cnt] of shelves.slice(1)) {
            await press(`.shelf-filters [data-shelf="${sh}"]`);
            assert.ok(await libOn(), `${tag}: "${label}" keeps the Library`);
            const o = await tilesOf('object');
            const f = await tilesOf('file');
            if (sh === g.dim) assert.equal(o.length, objTiles.length, `${tag}: "${label}" holds every object of this ${g.dim} game`);
            else assert.equal(o.length, 0, `${tag}: "${label}" holds no objects`);
            assert.ok(f.every((p) => extOf[sh]?.test(p)), `${tag}: "${label}" holds only its files (${f.join(', ')})`);
            assert.equal(f.length, fileTiles.filter((p) => extOf[sh]?.test(p)).length, `${tag}: "${label}" holds all of its files`);
            assert.equal(cnt, (sh === g.dim ? n : 0) + f.length, `${tag}: "${label}" ${cnt} = what it shows`);
            step(`"${label}" ${cnt}: ${o.length} object tiles + ${f.join(', ') || 'no files'}`);
            if (sh === g.dim) {
              const files = await J(`[...document.querySelectorAll('.assets-page .lib-object')].map((t) => [t.dataset.key, t.querySelector('.shelf-file')?.textContent || ''])`);
              if (g.shared) assert.ok(files.some(([, x]) => x.includes(g.shared.split('/').pop())), `${tag}: ${g.shared} under a tile`);
              await shot(`3-library-${sh}`);
            }
            if (sh === 'sound') {
              // Used / not used stays on the file's tile (it left the filters).
              assert.ok(await page.eval(`[...document.querySelectorAll('.assets-page .gsl-tile[data-kind=file]')].every((t) => t.querySelector('.gsl-badge, .gsl-uses'))`), `${tag}: each sound says if it is used`);
              await shot('5-library-sound');
            }
          }
          // A second press on the shelf that is on goes back to All.
          const last = shelves[shelves.length - 1][0];
          await press(`.shelf-filters [data-shelf="${last}"]`);
          assert.equal(await page.eval(`document.querySelector('.shelf-filters [data-shelf=all]').getAttribute('aria-pressed')`), 'true', `${tag}: a second press goes back to All`);
          await press(`.shelf-filters [data-shelf="${g.dim}"]`);
          await press('.shelf-filters [data-shelf=all]');
          assert.equal((await tilesOf('object')).length + (await tilesOf('file')).length, objTiles.length + fileTiles.length, `${tag}: "All" brings everything back`);
          const files = await J(`[...document.querySelectorAll('.assets-page .lib-object')].map((t) => [t.dataset.key, t.querySelector('.shelf-file')?.textContent || ''])`);
          const withFile = files.filter(([, f]) => f && !/コード|code/i.test(f));
          assert.ok(withFile.length > 0, `${tag}: some objects name their file (${JSON.stringify(files)})`);

          // 4. Pick an object in the Library.
          const pickKey = withFile[0][0];
          await press(`.assets-page .gsl-tile[data-key="${pickKey}"]`);
          const sel = await selected();
          assert.ok(sel && (sel === pickKey || (await page.eval(`studioShell.items().find((i) => i.key === ${JSON.stringify(pickKey)})?.group`))), `${tag}: the tile picks ${pickKey} (${sel})`);
          assert.ok(await libOn(), `${tag}: picking keeps the Library`);
          assert.ok(await page.eval(visible('.gsl-detail[data-kind=object] [data-action=show-in-game]')), `${tag}: the object's detail with "Show in game →"`);
          assert.equal(await view(), v0, `${tag}: the camera did not move`);
          if (!sz.touch) {
            // Arrow keys and T in the Library do not move or turn the object nobody can see there.
            const poseOf = () => page.eval(`JSON.stringify(${WIN}.__gameStudio._debug.list().find((i) => i.key === studioShell.selected())?.pose)`);
            const p0 = await poseOf();
            for (const key of ['ArrowRight', 'ArrowUp', 't']) {
              await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key.length === 1 ? `Key${key.toUpperCase()}` : key, windowsVirtualKeyCode: { ArrowRight: 39, ArrowUp: 38, t: 84 }[key] });
              await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key.length === 1 ? `Key${key.toUpperCase()}` : key, windowsVirtualKeyCode: { ArrowRight: 39, ArrowUp: 38, t: 84 }[key] });
            }
            await sleep(400);
            assert.equal(await poseOf(), p0, `${tag}: keys in the Library leave the object where it is`);
          }
          await shot('4-object-detail');
          if (await page.eval(visible('.gsl-detail [data-action=copy]'))) {
            await press('.gsl-detail [data-action=copy]');
            await page.waitFor(`studioShell.items().length > ${n}`, 8000).catch(() => {});
            const n2 = await nItems();
            assert.ok(n2 > n, `${tag}: Duplicate in the Library adds (${n} → ${n2})`);
            assert.ok(await libOn(), `${tag}: Duplicate keeps the Library`);
            await page.eval('studioShell.actions.undo()');
            await page.waitFor(`studioShell.items().length === ${n}`, 8000);
            step(`duplicate ${n} → ${n2}, undo → ${n}`);
          }
          if (!(await selected())) await press(`.assets-page .gsl-tile[data-key="${pickKey}"]`);
          if (!sz.touch) {
            await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
            await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
            await sleep(300);
            assert.equal(await selected(), null, `${tag}: Escape drops the pick in the Library`);
            assert.equal(await page.eval(visible('.gsl-detail')), false, `${tag}: and the detail goes`);
            await press(`.assets-page .gsl-tile[data-key="${pickKey}"]`);
          }

          // 5. The object's file → that file's detail, in the Library.
          await press('.gsl-detail[data-kind=object] [data-action=open-asset]');
          await page.waitFor(visible('.gsl-detail[data-kind=file] .gsl-in-scene'), 5000);
          assert.ok(await libOn(), `${tag}: the file opens in the Library`);
          assert.equal(await selected(), null, `${tag}: one detail at a time (the pick went)`);
          step(`${pickKey}'s file → its detail in the Library`);

          // 6. A file objects use: its detail, "Show just these objects", a name.
          const uses = await J(`[...document.querySelectorAll('.assets-page .gsl-tile[data-kind=file]')].map((t) => [t.dataset.path, t.querySelector('.gsl-uses')?.textContent || '']).filter((x) => x[1])`);
          assert.ok(uses.length, `${tag}: files say how many objects use them`);
          const file = g.shared && uses.some(([p]) => p === g.shared) ? g.shared : uses.sort((a, b) => (parseInt(b[1].replace(/\D+/g, ' ').trim()) || 0) - (parseInt(a[1].replace(/\D+/g, ' ').trim()) || 0))[0][0];
          await press(`.assets-page .gsl-tile[data-path="${file}"]`);
          await page.waitFor(`!!document.querySelector('.gsl-in-scene h4')`, 5000);
          const users = await J(`[...document.querySelectorAll('.gsl-in-scene .gsl-key')].map((k) => k.dataset.key)`);
          await shot('6-asset-detail');
          await press('.gsl-in-scene [data-action=asset-show-users]');
          await page.waitFor(visible('.assets-page .shelf-band'), 10000);
          assert.ok(await libOn(), `${tag}: "Show just these objects" stays in the Library`);
          if (!narrow) assert.equal(await gameOn(), false, `${tag}: and off the game`);
          const shown = await J(`[...document.querySelectorAll('.assets-page .lib-object')].flatMap((t) => { const g = t.dataset.group; return g ? studioShell.items().filter((i) => (i.group || 'key:' + i.key) === g).map((i) => i.key) : [t.dataset.key]; })`);
          assert.deepEqual([...new Set(shown)].sort(), [...new Set(users)].sort(), `${tag}: narrowed to the objects using ${file}`);
          assert.equal((await tilesOf('file')).length, 0, `${tag}: only those objects`);
          step(`"Show just these objects" for ${file}: ${shown.join(', ')}`);
          // (Narrow: the filters are at the top of the sheet; a person scrolls up to them.)
          const toTop = () => page.eval(`(() => { for (const e of document.querySelectorAll('.assets-page .gsl, .assets-page .gsl-grid')) e.scrollTop = 0; })()`).then(() => sleep(250));
          await toTop();
          await press('.shelf-band .shelf-band-x');
          await toTop();
          assert.equal((await tilesOf('object')).length, objTiles.length, `${tag}: the band's × shows all objects again`);
          await press('.shelf-filters [data-shelf=all]');
          await press(`.assets-page .gsl-tile[data-path="${file}"]`);
          await page.waitFor(`!!document.querySelector('.gsl-in-scene .gsl-key')`, 5000);
          await press('.gsl-in-scene .gsl-key');
          await page.waitFor(visible('.gsl-detail[data-kind=object]'), 10000);
          assert.equal(await selected(), users[0], `${tag}: a name opens that object's detail`);
          assert.ok(await libOn(), `${tag}: still the Library`);
          step(`a name in the file's detail → ${users[0]}'s detail, still the Library`);

          // 7. The last row is not cut (PC: the grid scrolls; narrow: the sheet).
          await page.eval(`(() => { for (const e of document.querySelectorAll('.assets-page .gsl, .assets-page .gsl-grid')) e.scrollTop = e.scrollHeight; })()`);
          await sleep(400);
          const lastRow = await J(`(() => { const v = ${VIS}; const t = [...document.querySelectorAll('.assets-page .gsl-grid > .gsl-tile')].pop(); return [t.dataset.key || t.dataset.path, v(t.querySelector('.gsl-name'))]; })()`);
          assert.ok(lastRow[1], `${tag}: the last tile (${lastRow[0]}) shows its name at the end of the Library`);
          if (!narrow) {
            const cut = await page.eval(`(() => { const g = document.querySelector('.assets-page .gsl-grid').getBoundingClientRect(), p = document.querySelector('.assets-page').getBoundingClientRect(); return Math.round(p.bottom - g.bottom); })()`);
            assert.ok(cut <= 1, `${tag}: the grid stops ${cut} px above the plate's bottom (the last row cut straight through)`);
          }
          await page.eval(`(() => { for (const e of document.querySelectorAll('.assets-page .gsl, .assets-page .gsl-grid')) e.scrollTop = 0; })()`);
          await sleep(300);

          // 8. "Show in game →".
          const before = await selected();
          await press('.gsl-detail [data-action=show-in-game]');
          await sleep(600);
          assert.equal(await libOn(), false, `${tag}: Show in game closes the Library`);
          assert.ok(await gameOn(), `${tag}: the game is back`);
          assert.equal(await selected(), before, `${tag}: with the pick kept`);
          assert.equal(await page.eval(`document.querySelector('.nav-row[data-tool=placement]').getAttribute('aria-selected')`), 'true', `${tag}: on the Scene row`);
          step(`"Show in game" → the Scene, ${before} still picked`);
        } catch (e) {
          failed++;
          console.error(`✗ ${tag}: ${e.message}`);
          if (SHOTS) writeFileSync(join(SHOTS, `${tag}-FAILED.png`), await page.screenshot().catch(() => Buffer.alloc(0)));
        }
        await page.close();
      }
    }
  }
} finally {
  await browser?.close();
  await srv?.close();
  if (root) rmSync(root, { recursive: true, force: true });
}
console.log(failed ? `studio-library: ${failed} failed` : 'studio-library: ok');
process.exit(failed ? 1 : 0);
