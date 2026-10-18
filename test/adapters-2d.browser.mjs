// End-to-end check of the example 2D adapters in a real headless browser.
//
// Run:  node --test test/adapters-2d.browser.mjs
//   STUDIO_CHROME=<path>     browser binary (default: first headless Chrome found)
//   STUDIO_CDN_CACHE=<dir>   answer https://cdn.jsdelivr.net/npm/<x> from <dir>/<x>
//                            when present (offline / flaky network)
//   STUDIO_SHOTS=<dir>       write screenshots there
//   STUDIO_ONLY=<example>    run one example
//
// For every example game and for both a desktop (mouse, 1280x800) and a phone
// (touch, 390x844) viewport, this walks the whole placement loop the way a
// person would: list objects -> press an object to select it -> drag the move,
// rotate and scale handles -> undo x3 / redo x3 -> pan and zoom the edit view
// -> save placement.json -> reload the game and check the loader put the
// object back exactly where it was saved.
//
// The edit script is test/adapters-2d/studio-stub.js (a stand-in for the
// bridge, see that file), so this checks the adapters, not the studio UI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChrome, launch, newPage } from './adapters-2d/cdp.mjs';
import { startServer } from './adapters-2d/server.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const KEY_RE = /^[A-Za-z0-9_:#.\-\/]{1,80}$/;

/**
 * target: a stable key to move. still: a key whose pose must not change while
 * frozen (it moves on its own when the game runs). asset: expected file name
 * in assetsOf(target), when the object uses an image file.
 */
const EXAMPLES = [
  { name: 'phaser-garden', engine: 'phaser', target: 'house', still: 'cloud', asset: 'house.svg', minItems: 8 },
  { name: 'phaser-runner', engine: 'phaser', target: 'sun', still: 'cloud', minItems: 5 },
  // Phaser 3.80.1 from the CDN: the Phaser an AI writes first (dogfood 2026-10-17, the adapter found nothing).
  { name: 'phaser-v3-hop', engine: 'phaser', target: 'door', still: 'cloud', minItems: 9 },
  { name: 'pixi-garden', engine: 'pixi', target: 'house', still: 'cloud', asset: 'house.svg', minItems: 8 },
  { name: 'pixi-bubbles', engine: 'pixi', target: 'panel', minItems: 2 },
  { name: 'canvas-stars', engine: 'canvas', target: 'basket', still: 'star-1', asset: 'basket.svg', minItems: 5 },
  { name: 'dom-board', engine: 'dom', target: 'house', still: 'bee', asset: 'house.svg', minItems: 5 },
].filter((e) => !process.env.STUDIO_ONLY || e.name === process.env.STUDIO_ONLY);

const VIEWPORTS = [
  { id: 'pc', width: 1280, height: 800, touch: false },
  { id: 'phone', width: 390, height: 844, touch: true },
];

const chrome = findChrome();
const skip = chrome ? false : 'no headless Chrome found (set STUDIO_CHROME)';

test('2D example adapters, end to end', { skip, timeout: 300_000 }, async (t) => {
  const scratch = mkdtempSync(join(tmpdir(), 'studio-2d-'));
  const server = await startServer(ROOT, scratch);
  const browser = await launch();
  const shots = process.env.STUDIO_SHOTS;
  if (shots) mkdirSync(shots, { recursive: true });
  try {
    for (const ex of EXAMPLES) {
      for (const vp of VIEWPORTS) {
        await t.test(`${ex.name} @ ${vp.id}`, async () => {
          rmSync(join(scratch, `${ex.name}.json`), { force: true });
          const page = await newPage(browser, { width: vp.width, height: vp.height, mobile: vp.touch, cdnCache: process.env.STUDIO_CDN_CACHE });
          try {
            await runLoop(page, server.url, ex, vp, scratch, shots);
          } catch (e) {
            e.message += `\n--- page log ---\n${page.logs.slice(-20).join('\n')}`;
            throw e;
          } finally {
            await page.close();
          }
        });
      }
    }
  } finally {
    await browser.close();
    await server.close();
    rmSync(scratch, { recursive: true, force: true });
  }
});

const q = (v) => JSON.stringify(v);
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b} (±${tol})`);

async function runLoop(page, base, ex, vp, scratch, shots) {
  const T = (expr) => page.eval(`window.__studioTest.${expr}`);
  const press = vp.touch ? (x0, y0, x1, y1) => page.touchDrag(x0, y0, x1, y1, 8) : (x0, y0, x1, y1) => page.mouseDrag(x0, y0, x1, y1, 8);
  const tapAt = vp.touch ? (x, y) => page.tap(x, y) : (x, y) => page.click(x, y);

  await page.goto(`${base}/examples/${ex.name}/?studio=edit`);
  await page.waitFor('window.__studioTest');
  const begun = await T('begin()');

  // --- list: valid, unique keys; the engine reported itself
  assert.equal(begun.name, ex.engine);
  assert.ok(begun.items.length >= ex.minItems, `expected >= ${ex.minItems} objects, got ${begun.items.length}`);
  const keys = begun.items.map((i) => i.key);
  assert.equal(new Set(keys).size, keys.length, `duplicate keys: ${keys}`);
  for (const k of keys) assert.match(k, KEY_RE);
  for (const it of begun.items) assert.equal(!!it.unstable, it.key.startsWith('path:'), `unstable flag of ${it.key}`);
  assert.ok(keys.includes(ex.target), `target ${ex.target} not in ${keys}`);

  // --- time is frozen: a drifting object stays put
  if (ex.still) {
    const a = await T(`pose(${q(ex.still)})`);
    await new Promise((r) => setTimeout(r, 400));
    assert.deepEqual(await T(`pose(${q(ex.still)})`), a, 'object moved while frozen');
  }

  // --- select by pressing the object (a tap never moves it)
  const before = await T(`pose(${q(ex.target)})`);
  const a0 = await T(`anchor(${q(ex.target)})`);
  const b0 = a0.rect;
  assert.ok(b0 && b0.w > 0 && b0.h > 0, 'target has screen bounds');
  // Press inside the bounds; repeat to cycle to it if something smaller sits on top.
  const cx = b0.x + b0.w / 2, cy = b0.y + b0.h / 2;
  for (let i = 0; i < 6 && (await T('selected()')) !== ex.target; i++) await tapAt(cx, cy);
  assert.equal(await T('selected()'), ex.target, 'press selects the object');
  assert.deepEqual(await T(`pose(${q(ex.target)})`), before, 'selecting does not move');

  // --- move handle: the pivot follows the finger on screen
  let h = await T('handles()');
  const dx = vp.touch ? 40 : 70, dy = vp.touch ? -50 : -40;
  await press(h.move[0], h.move[1], h.move[0] + dx, h.move[1] + dy);
  const a1 = await T(`anchor(${q(ex.target)})`);
  near(a1.center[0], a0.center[0] + dx, 1.5, 'moved x on screen');
  near(a1.center[1], a0.center[1] + dy, 1.5, 'moved y on screen');
  near(a1.rect.x, b0.x + dx, 2, 'bounds follow the move');
  const moved = await T(`pose(${q(ex.target)})`);

  // --- rotate handle: drag a quarter turn clockwise around the pivot
  h = await T('handles()');
  const c = h.move;
  const r0 = Math.hypot(h.rotate[0] - c[0], h.rotate[1] - c[1]);
  const ang0 = Math.atan2(h.rotate[1] - c[1], h.rotate[0] - c[0]);
  const arc = [];
  for (let i = 0; i <= 8; i++) arc.push([c[0] + r0 * Math.cos(ang0 + (Math.PI / 2) * (i / 8)), c[1] + r0 * Math.sin(ang0 + (Math.PI / 2) * (i / 8))]);
  await pressPath(page, vp.touch, arc);
  const rotated = await T(`pose(${q(ex.target)})`);
  near(norm(rotated.r - (moved.r || 0)), Math.PI / 2, 0.02, 'rotation is +90° (clockwise)');

  // --- scale handle: drag outwards to 1.5x the distance from the pivot
  h = await T('handles()');
  const sv = [h.scale[0] - c[0], h.scale[1] - c[1]];
  await press(h.scale[0], h.scale[1], c[0] + sv[0] * 1.5, c[1] + sv[1] * 1.5);
  const scaled = await T(`pose(${q(ex.target)})`);
  near(sOf(scaled), sOf(rotated) * 1.5, 0.01, 'scale x1.5');

  // --- undo x3 back to the start, redo x3 back to the end
  assert.equal(await T('undoDepth()'), 3, 'one undo step per gesture');
  for (let i = 0; i < 3; i++) assert.ok(await T('undo()'));
  assertPose(await T(`pose(${q(ex.target)})`), before, 'undo restores');
  for (let i = 0; i < 3; i++) assert.ok(await T('redo()'));
  assertPose(await T(`pose(${q(ex.target)})`), scaled, 'redo re-applies');

  // --- edit view: pan + zoom change only the picture, never the pose
  const aBefore = await T(`anchor(${q(ex.target)})`);
  const mid = [vp.width / 2, vp.height / 2];
  // Zoom 1.5x and shift so the object lands in the middle of the screen (what
  // "focus on the selected object" does). Engines zoom around the canvas
  // centre, which is the screen centre in these examples, so the expected
  // spot is c' = mid + 1.5 * (c - mid) + shift = mid.
  const shift = [-1.5 * (aBefore.center[0] - mid[0]), -1.5 * (aBefore.center[1] - mid[1])];
  await T(`view({ x: ${shift[0]}, y: ${shift[1]}, zoom: 1.5 })`);
  const aZoom = await T(`anchor(${q(ex.target)})`);
  assertPose(aZoom.pose, scaled, 'view does not move objects');
  near(aZoom.center[0], mid[0], 3, 'zoomed anchor x');
  near(aZoom.center[1], mid[1], 3, 'zoomed anchor y');
  near(aZoom.size, aBefore.size * 1.5, 3, 'zoomed size');
  // A move while zoomed still follows the finger 1:1 on screen.
  h = await T('handles()');
  await press(h.move[0], h.move[1], h.move[0] + 30, h.move[1] + 15);
  const aZ2 = await T(`anchor(${q(ex.target)})`);
  near(aZ2.center[0], aZoom.center[0] + 30, 1.5, 'zoomed move x');
  near(aZ2.center[1], aZoom.center[1] + 15, 1.5, 'zoomed move y');
  if (shots) writeFileSync(join(shots, `${ex.name}-${vp.id}-zoomed.png`), await page.screenshot());
  await T('view({ x: 0, y: 0, zoom: 1 })');
  const final = await T(`pose(${q(ex.target)})`);
  const aBack = await T(`anchor(${q(ex.target)})`);
  // Back at zoom 1, the 30 x 15 screen-px move is 30/1.5 x 15/1.5 px.
  near(aBack.center[0], aBefore.center[0] + 20, 1.5, 'view restored x');
  near(aBack.center[1], aBefore.center[1] + 10, 1.5, 'view restored y');

  // --- thumbnail and assets
  const thumb = await T(`capture(${q(ex.target)}, 96)`);
  assert.ok(typeof thumb === 'string' && thumb.startsWith('data:image/png') && thumb.length > 200, 'thumbnail');
  if (ex.asset) {
    const assets = await T(`assetsOf(${q(ex.target)})`);
    assert.ok(assets.some((x) => x.sure && x.url.endsWith(`/${ex.asset}`)), `assetsOf has ${ex.asset}: ${q(assets)}`);
  }
  if (shots) writeFileSync(join(shots, `${ex.name}-${vp.id}-edit.png`), await page.screenshot());

  // --- save placement.json
  const file = await T('placement()');
  assert.equal(file.dim, '2d');
  assert.equal(file.tool, 'placement');
  const entry = file.objects[ex.target];
  assert.ok(entry && entry.was, 'saved entry with was');
  assertPose(entry.was, before, 'was = pose before editing', 0.06);
  writeFileSync(join(scratch, `${ex.name}.json`), JSON.stringify(file, null, 2));

  // --- reload: the game's loader applies the file -> same place
  await page.goto(`${base}/examples/${ex.name}/?studio=edit`);
  await page.waitFor('window.__studioTest');
  await T('observe()');
  assertPose(await T(`pose(${q(ex.target)})`), final, 'loaded pose = saved pose', 0.06);
  if (shots) writeFileSync(join(shots, `${ex.name}-${vp.id}-reloaded.png`), await page.screenshot());
  const errors = page.logs.filter((l) => l.startsWith('exception') || l.startsWith('error'));
  assert.deepEqual(errors, [], 'no page errors');
}

async function pressPath(page, touch, pts) {
  const [x0, y0] = pts[0];
  if (touch) {
    await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0, id: 1 }] });
    for (const [x, y] of pts.slice(1)) await page.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y, id: 1 }] });
    await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0, y: y0 });
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y: y0, button: 'left', buttons: 1, clickCount: 1 });
    for (const [x, y] of pts.slice(1)) await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1 });
    const [x1, y1] = pts[pts.length - 1];
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x1, y: y1, button: 'left', buttons: 0, clickCount: 1 });
  }
}

function norm(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}
function sOf(p) {
  return Array.isArray(p.s) ? p.s[0] : p.s ?? 1;
}
function assertPose(a, b, what, tol = 1e-6) {
  near(a.p[0], b.p[0], tol, `${what} x`);
  near(a.p[1], b.p[1], tol, `${what} y`);
  near(norm((a.r || 0) - (b.r || 0)), 0, Math.max(tol, 2e-4), `${what} r`);
  near(sOf(a), sOf(b), Math.max(tol, 2e-4), `${what} s`);
}
