// An AI-written three.js game with no names (dogfood 2026-10-17, U4; supervision W1-8): the pumpkin farm built its
// barn as `const barn = new Group(); barn.position.set(…); barn.add(walls, roof, door)`, and its fence from loose
// meshes. The editor listed the barn's walls, roof and door as three rows, a click on the barn selected only its
// door, the card and the ask chip read `path:3/2`, and the way to name them was a foot row nobody scrolled to.
//
// With the real server and the built editor, at PC 1280×800 (mouse) and phone 390×844 (touch), light and dark:
//   1. the barn is ONE object (key path:2: the light is child 0, the ground 1), not its parts
//   2. a click / tap on the barn selects the whole barn, and dragging it moves the barn
//   3. nowhere on screen (text, tooltips, labels) is there a `path:` key
//   4. the first row of the object list is the grey "N objects have no name" row with "Name them" (narrow: the same
//      row folds them all, "Unnamed objects N · Ask AI to name them", side window 10/19)
//
//   node test/studio-unnamed.browser.mjs [--shots <dir>]
// Exit 1 on failure.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStudioServer } from '../src/server/server.mjs';
import { launch, newPage } from './adapters-2d/cdp.mjs';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const SHOTS = args.includes('--shots') ? resolve(args[args.indexOf('--shots') + 1]) : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The farm, cut down: the same shapes of code an AI writes (a placed group of parts, loose fence posts, no names).
const GAME = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Little Farm</title><style>html,body{margin:0;height:100%;overflow:hidden}</style>
<script type="importmap">{ "imports": { "three": "https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.module.min.js" } }</script>
</head><body><script type="module">
import * as THREE from 'three';
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fd8ff);
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 200);
camera.position.set(10, 9, 14);
camera.lookAt(0, 0, 0);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
scene.add(new THREE.HemisphereLight(0xffffff, 0x557733, 1.5));
const add = (geo, color, x, y, z, parent = scene) => {
  const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color }));
  m.position.set(x, y, z);
  parent.add(m);
  return m;
};
add(new THREE.PlaneGeometry(40, 40), 0x6cbf4a, 0, 0, 0).rotation.x = -Math.PI / 2;
const barn = new THREE.Group();
barn.position.set(-2, 0, -1);
add(new THREE.BoxGeometry(6, 4, 5), 0xb83a2e, 0, 2, 0, barn);
add(new THREE.ConeGeometry(4.2, 2, 4), 0x5a3a2a, 0, 5, 0, barn).rotation.y = Math.PI / 4;
add(new THREE.BoxGeometry(2, 2.6, 0.1), 0xf3eadb, 0, 1.3, 2.53, barn);
scene.add(barn);
for (let i = -6; i <= 6; i += 1.5) add(new THREE.BoxGeometry(0.2, 1.2, 0.2), 0xd9b67a, i, 0.6, 6);
renderer.setAnimationLoop(() => renderer.render(scene, camera));
</script></body></html>`;

const SIZES = [
  { id: 'pc', w: 1280, h: 800, touch: false },
  { id: 'phone', w: 390, h: 844, touch: true },
];
const WIN = `document.querySelector('iframe').contentWindow`;
// The barn: the scene's third child (the light is 0, the ground 1). Path keys count every child.
const BARN = 'path:2';
// Everything a person can read: text, and the words shown on hover or read aloud.
const SHOWN = `(() => {
  const words = [document.body.innerText];
  for (const el of document.querySelectorAll('[title], [aria-label], [placeholder]')) words.push(el.getAttribute('title') || '', el.getAttribute('aria-label') || '', el.getAttribute('placeholder') || '');
  const g = ${WIN}.document;
  words.push(g.body.innerText);
  for (const host of g.querySelectorAll('*')) if (host.shadowRoot) words.push(host.shadowRoot.textContent || '');
  return words.join('\\n');
})()`;

let failed = 0;
let browser = null, srv = null, root = null;
// Each page starts from the game as written, in a fresh folder, server and browser: the editor keeps the last
// drag (a draft under .studio/) and the last view (the browser's storage), and the next page would open on them.
const fresh = async () => {
  await browser?.close();
  await srv?.close();
  if (root) rmSync(root, { recursive: true, force: true });
  root = mkdtempSync(join(tmpdir(), 'studio-unnamed-'));
  writeFileSync(join(root, 'index.html'), GAME);
  srv = await startStudioServer({ root, uiDir: join(PKG, 'skills/arrange/bin/studio-ui'), log: () => {} });
  browser = await launch();
};
try {
  for (const sz of SIZES) {
    for (const theme of ['light', 'dark']) {
      const tag = `${sz.id}-${theme}`;
      await fresh();
      const page = await newPage(browser, { width: sz.w, height: sz.h, mobile: sz.touch });
      try {
        await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
        await page.goto(srv.url);
        // (Narrow: the unnamed objects are one folded row, not .obj rows, until one is picked.)
        await page.waitFor(`document.querySelectorAll('.obj, .noname:not([hidden])').length > 0 && !!${WIN}.__gameStudio?._debug`, 30000);
        await sleep(800);
        // 1. The barn is one object.
        const keys = await page.eval(`studioShell.items().map((i) => i.key)`);
        assert.ok(keys.includes(BARN), `${tag}: the barn (${BARN}) is one object: ${keys.join(' ')}`);
        assert.ok(!keys.some((k) => k.startsWith('path:2/')), `${tag}: the barn's parts are not listed: ${keys.join(' ')}`);
        // 4. The first row of the list: "N objects have no name · Name them", grey, no frame.
        if (sz.touch) await page.eval(`document.querySelector('[data-action=sheet]').click()`), await sleep(700);
        const row = JSON.parse(await page.eval(`(() => { const s = document.querySelector('.side .list-scroll'); const f = s && s.firstElementChild;
          const btn = f && f.querySelector('[data-action=ask-name-all]'); const cs = f && getComputedStyle(f);
          return JSON.stringify({ cls: f && f.className, hidden: !f || f.hidden || !f.offsetParent, text: f && f.innerText, btn: btn && btn.innerText,
            border: cs && cs.borderTopWidth, bg: cs && cs.backgroundColor, before: !!(f && f.nextElementSibling && f.nextElementSibling.matches('.objects')) }); })()`));
        // Narrow screens fold them into that row (side window 10/19): "▸ Unnamed objects N · Ask AI to name them".
        assert.equal(row.cls, sz.touch ? 'noname fold' : 'noname', `${tag}: the list's first row is the no-name row`);
        assert.equal(row.hidden, false, `${tag}: the no-name row shows`);
        assert.match(row.text, sz.touch ? new RegExp(`^Unnamed objects\\s+${keys.length}`) : new RegExp(`^${keys.length} objects have no name`), `${tag}: "${row.text}"`);
        assert.equal(row.btn, sz.touch ? 'Ask AI to name them' : 'Name them');
        assert.equal(row.border, '0px', `${tag}: no frame`);
        assert.ok(/rgba\(0, 0, 0, 0\)|transparent/.test(row.bg), `${tag}: no fill (${row.bg})`);
        if (SHOTS) writeFileSync(join(SHOTS, `unnamed-${tag}-list.png`), await page.screenshot());
        // Close the sheet and let it settle (a tap while it still slides lands on it, not on the game).
        if (sz.touch) await page.eval(`document.querySelector('[data-action=sheet]').click()`), await sleep(1500);
        // 2. A click on the barn (on its door, the part in front) selects the whole barn; a drag moves it.
        const at = JSON.parse(await page.eval(`(() => { const f = document.querySelector('iframe').getBoundingClientRect();
          const a = ${WIN}.__gameStudio._debug.anchor('${BARN}'); const r = a.rect;
          return JSON.stringify([f.left + r.x + r.w / 2, f.top + r.y + r.h / 2]); })()`));
        // Up to 3 presses (as test/adapters-2d does): right after the sheet closes a tap can land while it still moves.
        for (let i = 0; i < 3 && (await page.eval(`studioShell.selected()`)) !== BARN; i++) {
          if (i) await sleep(700);
          if (sz.touch) await page.tap(at[0], at[1]);
          else await page.click(at[0], at[1]);
          await page.waitFor(`studioShell.selected() === '${BARN}'`, 1500).catch(() => {});
        }
        assert.equal(await page.eval(`studioShell.selected()`), BARN, `${tag}: clicking the barn selects the barn`);
        const pos = () => page.eval(`${WIN}.__gameStudio._debug.list().find((i) => i.key === '${BARN}').pos`);
        const p0 = await pos();
        // Where the barn is now (the view may have moved on select; W1-1 keeps it still, not this test's subject).
        await sleep(600);
        const now = JSON.parse(await page.eval(`(() => { const f = document.querySelector('iframe').getBoundingClientRect();
          const r = ${WIN}.__gameStudio._debug.anchor('${BARN}').rect; return JSON.stringify([f.left + r.x + r.w / 2, f.top + r.y + r.h / 2]); })()`));
        if (sz.touch) await page.touchDrag(now[0], now[1], now[0] + 40, now[1] + 10, 8);
        else await page.mouseDrag(now[0], now[1], now[0] + 40, now[1] + 10, 8);
        await sleep(500);
        const p1 = await pos();
        assert.ok(Math.hypot(p1[0] - p0[0], p1[2] - p0[2]) > 0.2, `${tag}: the barn moved (${p0} → ${p1})`);
        // 3. No inner key anywhere a person reads.
        const shown = await page.eval(SHOWN);
        assert.ok(!/path:/.test(shown), `${tag}: "path:" on screen: …${shown.slice(Math.max(0, shown.indexOf('path:') - 60), shown.indexOf('path:') + 20)}…`);
        if (SHOTS) writeFileSync(join(SHOTS, `unnamed-${tag}-barn.png`), await page.screenshot());
        const errors = page.logs.filter((l) => l.startsWith('exception'));
        assert.deepEqual(errors, [], 'page errors');
        console.log(`  ✓ ${tag}`);
      } catch (e) {
        failed++;
        console.log(`  ✗ ${tag}: ${e.message}`);
        if (SHOTS) writeFileSync(join(SHOTS, `unnamed-${tag}-fail.png`), await page.screenshot());
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
console.log('studio-unnamed: ok');
