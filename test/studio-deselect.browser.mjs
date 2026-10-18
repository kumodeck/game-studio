// A click / tap on "nothing" drops the pick (a web demo try 2026-10-18: "I want to click an empty spot to deselect, and I
// can't"). Before the fix, on Lantern Cove a click on the sky beside the lighthouse picked the lighthouse again: its
// box (the tower + its long light beam) covered half the sky, and a box near the press was enough to be picked
// (src/adapters/three/pick.js). A ground listed as an object was picked by a tap on the grass, and the desk round the
// game (the 8 px margin, the list column under the rows, the gap between the phone's card and ask bar) did nothing.
//
// With the real server and the built editor, for Lantern Cove (3D), Firefly Ruins (2D) and a small farm whose ground
// is a listed object, at PC 1280×800 (mouse) and phone 390×844 (touch):
//   1. pick an object, click / tap an empty spot of the game (the sky inside the lighthouse's box, the water, the
//      sky, the letterbox, the farm's grass) → nothing is picked, and the grass did not get picked either
//   2. pick, then drag from an empty spot → the view turns / pans and the pick STAYS (decided 2026-10-18: turning the
//      view never changes what is picked, as in other 3D editors; only a press that does not travel is a click)
//   3. pick, then Escape → nothing is picked (focus in the game after a click on the object; PC also with focus in
//      the list after a click on a row)
//   4. PC: pick, then click the bare desk → nothing is picked (the margin right of the game, the list column under
//      the rows). Not on the phone: the game fills the screen there, and a tap on the 16 px gap between the card and
//      the ask bar is moved onto the ask field by the browser's touch adjustment (tried 2026-10-18), as on a phone.
//   5. a click on an object still picks it, and the view did not move on the pick (wave 1: the camera stays still)
//
//   node test/studio-deselect.browser.mjs [--shots <dir>] [--only pc|phone] [--game lantern-cove|firefly-ruins|farm]
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The farm: a ground plane that IS a listed object (an AI's game names nothing), with a crate on it.
const FARM = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Farm</title><style>html,body{margin:0;height:100%;overflow:hidden}</style>
<script type="importmap">{ "imports": { "three": "https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.module.min.js" } }</script>
</head><body><script type="module">
import * as THREE from 'three';
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fd8ff);
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 200);
camera.position.set(0, 9, 12);
camera.lookAt(0, 0, 0);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
scene.add(new THREE.HemisphereLight(0xffffff, 0x557733, 1.5));
const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshLambertMaterial({ color: 0x6cbf4a }));
ground.rotation.x = -Math.PI / 2;
scene.add(ground);
const crate = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshLambertMaterial({ color: 0xb8803a }));
crate.position.set(0, 1, 0);
scene.add(crate);
renderer.setAnimationLoop(() => renderer.render(scene, camera));
</script></body></html>`;

// pick: the object picked before each empty click. empty: where to look for an empty spot, as a share of the game
// frame [x0, y0, x1, y1] or the picked object's own box ('box'). A spot is empty when nothing is under it, nor
// under any of 8 points 40 px around it (so the finger's slack cannot reach an object) but the ground, and the
// editor's own panels do not cover it.
const GAMES = [
  { id: 'lantern-cove', pick: 'lighthouse', spots: [{ name: 'sky in the lighthouse box', in: 'box' }, { name: 'sky', in: [0.55, 0.05, 0.75, 0.3] }, { name: 'water', in: [0.15, 0.6, 0.85, 0.85] }] },
  { id: 'firefly-ruins', pick: 'urn', spots: [{ name: 'sky', in: [0.1, 0.12, 0.6, 0.4] }, { name: 'water / below', in: [0.1, 0.72, 0.9, 0.9] }] },
  { id: 'farm', html: FARM, pick: 'path:2', ground: 'path:1', spots: [{ name: 'grass', in: [0.1, 0.62, 0.9, 0.85] }] },
].filter((g) => !opt('--game') || g.id === opt('--game'));
const SIZES = [
  { id: 'pc', w: 1280, h: 800, touch: false },
  { id: 'phone', w: 390, h: 844, touch: true },
].filter((s) => !opt('--only') || s.id === opt('--only'));

const WIN = `document.querySelector('iframe').contentWindow`;
const FRAME = `(() => { const r = document.querySelector('iframe').getBoundingClientRect(); return JSON.stringify([r.left, r.top, r.width, r.height]); })()`;
const BOX = (key) => `(() => { const f = document.querySelector('iframe').getBoundingClientRect(); const a = ${WIN}.__gameStudio._debug.anchor(${JSON.stringify(key)});
  if (!a || !a.rect) return null; const r = a.rect; return JSON.stringify({ x: f.left + r.x, y: f.top + r.y, w: r.w, h: r.h }); })()`;
// Is (x, y) (shell px) an empty spot of the game: the game frame on top there, and nothing under it or 40 px around?
const EMPTY = (x, y, ground) => `(() => { const f = document.querySelector('iframe'); const r = f.getBoundingClientRect();
  if (document.elementFromPoint(${x}, ${y}) !== f) return false;
  const gx = ${x} - r.left, gy = ${y} - r.top, g = f.contentWindow;
  const hit = g.document.elementFromPoint(gx, gy); if (!hit || hit.shadowRoot || hit.closest('[data-studio-ui]')) return false;
  for (const [dx, dy] of [[0, 0], [40, 0], [-40, 0], [0, 40], [0, -40], [28, 28], [-28, 28], [28, -28], [-28, -28]]) {
    const px = gx + dx, py = gy + dy; if (px < 0 || py < 0 || px > r.width || py > r.height) return false;
    const u = g.__gameStudio._debug.under(px, py); if (u && u !== ${JSON.stringify(ground || null)}) return false; }
  return true; })()`;
const KEY = (page, key) => page.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: key === 'Escape' ? 27 : 0 })
  .then(() => page.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: key === 'Escape' ? 27 : 0 }));

let failed = 0;
let browser = null, srv = null, root = null;
// Each page from the game as written, in a fresh folder, server and browser (the editor keeps drafts and the view).
const fresh = async (g) => {
  await browser?.close();
  await srv?.close();
  if (root) rmSync(root, { recursive: true, force: true });
  root = mkdtempSync(join(tmpdir(), 'studio-deselect-'));
  if (g.html) writeFileSync(join(root, 'index.html'), g.html);
  else cpSync(join(PKG, 'starters', g.id), root, { recursive: true });
  srv = await startStudioServer({ root, uiDir: join(PKG, 'skills/arrange/bin/studio-ui'), log: () => {} });
  browser = await launch();
};
try {
  for (const g of GAMES) {
    for (const sz of SIZES) {
      const tag = `${g.id}-${sz.id}`;
      await fresh(g);
      const page = await newPage(browser, { width: sz.w, height: sz.h, mobile: sz.touch });
      const press = (x, y) => (sz.touch ? page.tap(x, y) : page.click(x, y));
      const drag = (x0, y0, x1, y1) => (sz.touch ? page.touchDrag(x0, y0, x1, y1, 10) : page.mouseDrag(x0, y0, x1, y1, 10));
      const selected = () => page.eval('studioShell.selected()');
      const view = () => page.eval(`JSON.stringify(${WIN}.__gameStudio._debug.view())`);
      try {
        await page.goto(srv.url);
        await page.waitFor(`document.querySelectorAll('.obj').length > 0 && !!${WIN}.__gameStudio?._debug`, 30000);
        await sleep(1000);
        const keys = await page.eval('studioShell.items().map((i) => i.key)');
        assert.ok(keys.includes(g.pick), `${tag}: ${g.pick} is listed (${keys.join(' ')})`);
        // 5. A real click on the object picks it (on its middle, or a point of it nothing stands in front of).
        const pickIt = async () => {
          const at = JSON.parse(await page.eval(`(() => { const f = document.querySelector('iframe').getBoundingClientRect(); const a = ${WIN}.__gameStudio._debug.anchor(${JSON.stringify(g.pick)});
            const r = a.rect; const u = ${WIN}.__gameStudio._debug.under;
            for (let fy = 0.5; fy < 1; fy += 0.1) for (const fx of [0.5, 0.4, 0.6, 0.3, 0.7]) { const x = r.x + r.w * fx, y = r.y + r.h * fy;
              if (u(x, y) === ${JSON.stringify(g.pick)}) return JSON.stringify([f.left + x, f.top + y]); }
            return JSON.stringify([f.left + a.center[0], f.top + a.center[1]]); })()`));
          for (let i = 0; i < 3 && (await selected()) !== g.pick; i++) {
            if (i) await sleep(600);
            await press(at[0], at[1]);
            await page.waitFor(`studioShell.selected() === ${JSON.stringify(g.pick)}`, 1500).catch(() => {});
          }
          assert.equal(await selected(), g.pick, `${tag}: a click on ${g.pick} picks it`);
          await sleep(400);
        };
        const [fx, fy, fw, fh] = JSON.parse(await page.eval(FRAME));
        const v0 = await view();
        await pickIt();
        assert.equal(await view(), v0, `${tag}: the view did not move on the pick`);
        // Find each empty spot once, with the object picked (its card and strip are on screen then).
        const spots = [];
        for (const s of g.spots) {
          let area;
          if (s.in === 'box') {
            const b = JSON.parse(await page.eval(BOX(g.pick)));
            area = [b.x, b.y, b.x + b.w, b.y + b.h];
          } else area = [fx + fw * s.in[0], fy + fh * s.in[1], fx + fw * s.in[2], fy + fh * s.in[3]];
          let at = null;
          for (let y = area[1] + 6; !at && y < area[3]; y += 12) for (let x = area[0] + 6; !at && x < area[2]; x += 12) if (await page.eval(EMPTY(x, y, g.ground))) at = [x, y];
          assert.ok(at, `${tag}: an empty spot (${s.name}) in ${area.map(Math.round)}`);
          spots.push({ ...s, at });
        }
        if (SHOTS) writeFileSync(join(SHOTS, `${tag}-1-picked.png`), await page.screenshot());
        // 1. Click / tap on each empty spot: the pick is dropped (and the ground is not picked instead).
        for (const s of spots) {
          if ((await selected()) !== g.pick) await pickIt();
          await press(s.at[0], s.at[1]);
          await sleep(400);
          assert.equal(await selected(), null, `${tag}: a ${sz.touch ? 'tap' : 'click'} on the ${s.name} (${s.at.map(Math.round)}) drops the pick`);
          if (SHOTS && s === spots[0]) writeFileSync(join(SHOTS, `${tag}-2-after-empty-click.png`), await page.screenshot());
        }
        if (g.ground) {
          // With nothing picked too: a tap on the grass never picks the ground (it is picked from the list).
          await press(spots[0].at[0], spots[0].at[1]);
          await sleep(400);
          assert.equal(await selected(), null, `${tag}: a tap on the grass does not pick the ground`);
        }
        // 2. A drag from an empty spot looks around, and the pick stays.
        await pickIt();
        const va = await view();
        const s0 = spots[spots.length - 1].at;
        await drag(s0[0], s0[1], s0[0] + 70, s0[1] + 12);
        await sleep(500);
        assert.notEqual(await view(), va, `${tag}: a drag from the ${spots[spots.length - 1].name} turned / moved the view`);
        assert.equal(await selected(), g.pick, `${tag}: a drag from an empty spot keeps the pick`);
        // 3. Escape drops the pick (focus in the game: the last press was in it).
        await KEY(page, 'Escape');
        await sleep(300);
        assert.equal(await selected(), null, `${tag}: Escape (focus in the game) drops the pick`);
        if (!sz.touch) {
          // Focus in the list: a click on the row, then Escape.
          await page.eval(`document.querySelector('.obj[data-key=${JSON.stringify(g.pick)}]')?.scrollIntoView({ block: 'center' })`);
          const row = JSON.parse(await page.eval(`(() => { const r = document.querySelector('.obj[data-key=${JSON.stringify(g.pick)}]').getBoundingClientRect(); return JSON.stringify([r.left + 40, r.top + r.height / 2]); })()`));
          await page.click(row[0], row[1]);
          await page.waitFor(`studioShell.selected() === ${JSON.stringify(g.pick)}`, 2000);
          await KEY(page, 'Escape');
          await sleep(300);
          assert.equal(await selected(), null, `${tag}: Escape (focus in the list) drops the pick`);
        }
        // 4. A click on the bare desk drops the pick.
        const desk = sz.touch ? [] : [
          [`the margin right of the game`, `JSON.stringify([${fx + fw + 4}, ${fy + fh / 2}])`],
          [`the list column under the rows`, `(() => { const rows = [...document.querySelectorAll('.side .obj')]; const last = rows[rows.length - 1].getBoundingClientRect();
            const foot = document.querySelector('.side-foot').getBoundingClientRect(); return JSON.stringify([120, (last.bottom + foot.top) / 2]); })()`]];
        for (const [name, where] of desk) {
          await pickIt();
          const at = JSON.parse(await page.eval(where));
          assert.ok(at, `${tag}: ${name} is on screen`);
          const what = await page.eval(`(() => { const e = document.elementFromPoint(${at[0]}, ${at[1]}); return e ? e.tagName + '.' + e.className : null; })()`);
          await press(at[0], at[1]);
          await sleep(400);
          assert.equal(await selected(), null, `${tag}: a ${sz.touch ? 'tap' : 'click'} on ${name} (${at.map(Math.round)}, ${what}) drops the pick`);
        }
        const errors = page.logs.filter((l) => l.startsWith('exception'));
        assert.deepEqual(errors, [], 'page errors');
        console.log(`  ✓ ${tag} (${spots.map((s) => `${s.name} ${s.at.map(Math.round)}`).join(', ')})`);
      } catch (e) {
        failed++;
        console.log(`  ✗ ${tag}: ${e.message}`);
        if (SHOTS) writeFileSync(join(SHOTS, `${tag}-fail.png`), await page.screenshot());
      } finally {
        await page.close();
      }
    }
  }
} finally {
  await browser?.close();
  await srv?.close();
  if (root) rmSync(root, { recursive: true, force: true });
}
if (failed) process.exit(1);
console.log('studio-deselect: ok');
