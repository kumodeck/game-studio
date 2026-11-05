// A slow computer connects (src/bridge/connect-wait.ts, decided 2026-11-05), in a headless browser, PC 1280×800.
//
//   node test/studio-slow-connect.browser.mjs            (STUDIO_CDN_CACHE=<dir> answers jsDelivr from local copies)
//
// Before, the game page looked for something to edit for ~8 s (55 × 150 ms) and then said "This game isn't connected
// to Game Studio yet" — on a slow or busy computer three.js had not drawn its first scene by then.
//   A. Lantern Cove with the CPU slowed 8× (CDP Emulation.setCPUThrottlingRate): the editor opens, "isn't connected"
//      never shows.
//   B. A three.js game that draws its first frame only after 16 s (a slow computer still reading the game): the line
//      says "Connecting the game to Game Studio…" while it waits, then the editor opens with the game's objects.
//   C. A 2D canvas game with no adapter, drawing at full speed: "isn't connected" still comes, within ~15 s.
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStudioServer } from '../src/server/server.mjs';
import { launch, newPage } from './adapters-2d/cdp.mjs';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const UI = join(PKG, 'skills/arrange/bin/studio-ui');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NOT_CONNECTED = 'isn’t connected to Game Studio yet';
const CONNECTING = 'Connecting the game to Game Studio';
const status = `(document.querySelector('.status')?.textContent ?? '')`;
const rows = `document.querySelectorAll('.objects .obj').length`;
// --only a,b,c: just those parts.
const ONLY = (process.argv.find((a) => a.startsWith('--only='))?.slice(7) ?? 'a,b,c').split(',');

/** Watch the status line every 200 ms until `done` is true in the page (or `ms`): every distinct line seen. */
async function watch(page, done, ms) {
  const seen = new Set();
  const end = Date.now() + ms;
  for (;;) {
    const s = await page.eval(status).catch(() => '');
    if (s) seen.add(s);
    if (await page.eval(done).catch(() => false)) return { ok: true, seen: [...seen], at: ms - (end - Date.now()) };
    if (Date.now() > end) return { ok: false, seen: [...seen], at: ms };
    await sleep(200);
  }
}

async function editorOn(root, fn) {
  const srv = await startStudioServer({ root, kumo: { home: join(root, '.no-kumo-home'), env: {} }, uiDir: UI, log: () => {} });
  const browser = await launch();
  try {
    const page = await newPage(browser, { width: 1280, height: 800, cdnCache: process.env.STUDIO_CDN_CACHE });
    await fn(page, srv);
  } finally {
    await browser.close();
    await srv.close();
    rmSync(root, { recursive: true, force: true });
  }
}

// ---- A. Lantern Cove, CPU 8× slower ----
if (ONLY.includes('a')) {
  const root = mkdtempSync(join(tmpdir(), 'studio-slow-a-'));
  cpSync(join(PKG, 'starters/lantern-cove'), root, { recursive: true, filter: (p) => !p.includes('/.studio/') && !p.endsWith('/.studio') && !p.endsWith('placement.json') });
  await editorOn(root, async (page, srv) => {
    await page.send('Emulation.setCPUThrottlingRate', { rate: 8 });
    await page.goto(srv.url);
    const r = await watch(page, `${rows} > 5`, 240_000);
    console.log(`  A: ${r.ok ? 'open' : 'NOT open'} after ${Math.round(r.at / 1000)} s; lines: ${JSON.stringify(r.seen)}`);
    assert.ok(r.ok, 'A: the editor opens on a slowed CPU');
    assert.ok(!r.seen.some((s) => s.includes(NOT_CONNECTED)), 'A: "isn’t connected" never shown');
    await page.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  });
}

// ---- B. three.js that draws its first frame after 16 s ----
if (ONLY.includes('b')) {
  const root = mkdtempSync(join(tmpdir(), 'studio-slow-b-'));
  writeFileSync(join(root, 'index.html'), `<!doctype html><html><head><meta charset="utf-8"><title>late</title>
<script type="importmap">{ "imports": { "three": "https://cdn.jsdelivr.net/npm/three@0.187.0/build/three.module.min.js" } }</script>
<style>html,body{margin:0;height:100%;overflow:hidden}</style></head><body>
<script type="module">
import * as THREE from 'three';
const renderer = new THREE.WebGLRenderer();
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 100);
camera.position.set(0, 4, 8); camera.lookAt(0, 0, 0);
for (let i = 0; i < 3; i++) { const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshNormalMaterial()); m.name = 'box-' + i; m.position.x = (i - 1) * 2; scene.add(m); }
// A slow computer: nothing is drawn for the first 16 s (the old wait gave up at ~4 + 8 s).
setTimeout(() => { const loop = () => { renderer.render(scene, camera); requestAnimationFrame(loop); }; loop(); }, 16000);
</script></body></html>`);
  await editorOn(root, async (page, srv) => {
    await page.goto(srv.url);
    // The list groups box-0..2 into one row ("box 3"): the frame's own list says all three are there.
    const r = await watch(page, `${rows} >= 1 && document.querySelector('iframe.game:not(.leaving)')?.contentWindow?.__gameStudio?._debug?.list().length >= 3`, 90_000);
    console.log(`  B: ${r.ok ? 'open' : 'NOT open'} after ${Math.round(r.at / 1000)} s; lines: ${JSON.stringify(r.seen)}`);
    if (!r.ok) console.log(page.logs.slice(-20).join('\n'));
    assert.ok(r.ok, 'B: the editor opens once the late game draws');
    assert.ok(r.at >= 15_000, `B: not before the game drew (${r.at} ms)`);
    assert.ok(r.seen.some((s) => s.includes(CONNECTING)), 'B: "Connecting…" while it waits');
    assert.ok(!r.seen.some((s) => s.includes(NOT_CONNECTED)), 'B: "isn’t connected" never shown');
  });
}

// ---- C. a 2D canvas game with no adapter: still told ----
if (ONLY.includes('c')) {
  const root = mkdtempSync(join(tmpdir(), 'studio-slow-c-'));
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'index.html'), `<!doctype html><html><head><meta charset="utf-8"><title>plain</title></head><body style="margin:0">
<canvas id="c" width="640" height="400"></canvas>
<script>
const g = document.getElementById('c').getContext('2d');
let x = 0;
const loop = () => { g.fillStyle = '#123'; g.fillRect(0, 0, 640, 400); g.fillStyle = '#fc6'; g.fillRect((x = (x + 2) % 600), 180, 40, 40); requestAnimationFrame(loop); };
loop();
</script></body></html>`);
  await editorOn(root, async (page, srv) => {
    await page.goto(srv.url);
    const r = await watch(page, `${status}.includes(${JSON.stringify(NOT_CONNECTED)})`, 40_000);
    console.log(`  C: ${r.ok ? 'told' : 'NOT told'} after ${Math.round(r.at / 1000)} s; lines: ${JSON.stringify(r.seen)}`);
    assert.ok(r.ok && r.at <= 20_000, `C: "isn’t connected" within ~15 s (${r.at} ms)`);
  });
}

console.log('studio-slow-connect: ok');
process.exit(0);
