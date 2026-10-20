// Snap to surfaces in a headless browser (a request after a try of the editor, 2026-10-19: "in Unreal, an object moved up or down stops once when
// it meets the ground or another thing — I want to set things down exactly on the ground"). Lantern Cove (3D).
//
//   node test/studio-snap-surface.browser.mjs [--shots <dir>] [--only pc|phone]
//
// PC 1280×800 (mouse, keys):
// - End (Drop to floor): the barrel raised 1.2 m with PgUp lands with its bottom on the water;
// - the Height tool dragged down: stops with the bottom on the surface below (a little extra pull held), and a long
//   pull goes through it; with Ctrl held during the drag it does not stop;
// - the Move tool: the barrel dragged from the water (it floats half under it) onto the pier stands on the planks
//   (y 1.11, its bottom exactly on them), where the pointer put its foot; with Ctrl held during the drag it moves flat at its height;
// - the ? sheet lists Drop to floor (End) and Move without snapping (⌃ ⌥), ⌘K has Drop to floor.
// Phone 390×844 (touch): the barrel dragged by the finger onto the pier stands on it; raised, then the place's menu
// (a long press) "Drop to floor" sets it down.
// Photos (--shots): <pc|phone>-1-on-pier.png, -2-before-drop.png, -3-after-drop.png.
// Each run uses a temporary copy of the starter. Needs the network for the starter's libraries (or STUDIO_CDN_CACHE).
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStudioServer } from '../src/server/server.mjs';
import { launch, newPage } from './adapters-2d/cdp.mjs';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const take = (flag, d) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : d;
};
const SHOTS = take('--shots', null) ? resolve(take('--shots')) : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const ONLY = take('--only', null);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DBG = `document.querySelector('iframe').contentWindow.__gameStudio?._debug`;
const MOD = process.platform === 'darwin' ? 4 : 2; // ⌘ / Ctrl for ⌘K
const CTRL = 2;
const BARREL = 'barrel';
/** A point on the pier's planks (props.js: the pier at x 15, z 6; planks from x 4.5 to 16, 2.2 m wide, top y 1.11). */
const ON_PIER = [11, 1.11, 6];
const PIER_TOP = 1.11;

let failed = 0;

async function run(phone) {
  const tag = phone ? 'phone' : 'pc';
  const root = mkdtempSync(join(tmpdir(), `studio-snap-${tag}-`));
  cpSync(join(PKG, 'starters', 'lantern-cove'), root, { recursive: true });
  mkdirSync(join(root, '.studio/ui'), { recursive: true });
  writeFileSync(join(root, '.studio/ui/prefs.json'), JSON.stringify({ version: 1, lang: 'en', theme: 'light' }));
  const srv = await startStudioServer({ root, uiDir: join(PKG, 'skills/arrange/bin/studio-ui'), log: () => {} });
  const browser = await launch();
  const page = await newPage(browser, phone ? { width: 390, height: 844, mobile: true, cdnCache: process.env.STUDIO_CDN_CACHE } : { width: 1280, height: 800, cdnCache: process.env.STUDIO_CDN_CACHE });
  const ok = (m) => console.log(`  ✓ ${tag}: ${m}`);
  const shot = async (name) => {
    if (!SHOTS) return;
    await sleep(500);
    writeFileSync(join(SHOTS, `${tag}-${name}.png`), await page.screenshot());
  };
  const j = async (expr) => JSON.parse((await page.eval(expr)) || 'null');
  const rest = () => j(`JSON.stringify(${DBG}.rest(${JSON.stringify(BARREL)}))`);
  const foot = () => j(`JSON.stringify(${DBG}.foot(${JSON.stringify(BARREL)}))`);
  const pose = () => j(`JSON.stringify(${DBG}.anchor(${JSON.stringify(BARREL)}).pose)`);
  /** A scene point on the page (px), or null behind the camera. */
  const screen = (p) => j(`(() => { const f = document.querySelector('iframe').getBoundingClientRect(); const s = ${DBG}.toScreen(${JSON.stringify(p)});
    return JSON.stringify(s && { x: f.left + s[0], y: f.top + s[1] }); })()`);
  const frameBox = () => j(`JSON.stringify(document.querySelector('iframe').getBoundingClientRect())`);
  const center = () => j(`(() => { const f = document.querySelector('iframe').getBoundingClientRect(); const a = ${DBG}.anchor(${JSON.stringify(BARREL)});
    return JSON.stringify({ x: f.left + a.center[0], y: f.top + a.center[1], liftPx: a.liftPx }); })()`);
  const key = async (k, code, vk, modifiers = 0) => {
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers });
    await sleep(60);
  };
  const raise = async (n) => {
    for (let i = 0; i < n; i++) await key('PageUp', 'PageUp', 33);
    await sleep(300);
  };
  const undo = async () => {
    await page.eval(`studioShell.actions.undo()`);
    await sleep(300);
  };
  const line = (a, b, n = 20) => Array.from({ length: n + 1 }, (_, i) => ({ x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n }));
  /** A mouse drag (the left button), `modifiers` held on the moves only (Ctrl pressed after the drag began). */
  const drag = async (pts, modifiers = 0) => {
    const [a] = pts;
    if (phone) {
      await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a.x, y: a.y, id: 1 }] });
      for (const p of pts.slice(1)) await page.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p.x, y: p.y, id: 1 }] });
      await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: a.x, y: a.y });
      await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: a.x, y: a.y, button: 'left', buttons: 1, clickCount: 1 });
      for (const p of pts.slice(1)) await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'left', buttons: 1, modifiers });
      const l = pts[pts.length - 1];
      await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: l.x, y: l.y, button: 'left', buttons: 0, clickCount: 1, modifiers });
    }
    await sleep(350);
  };
  const tool = async (k) => {
    await key(k, `Key${k.toUpperCase()}`, k.toUpperCase().charCodeAt(0));
    await sleep(150);
  };
  /** Drag the barrel's foot to the screen point `to` (the drag starts on the barrel; the foot keeps its offset). */
  const footTo = async (to, modifiers = 0) => {
    const c = await center();
    // On surfaces the editor carries the point where the barrel meets what it stands on (its foot at the water's
    // level, not its sunk bottom: adapters/three grab, merge of 2026-10-19), so the pointer puts THAT point on the target.
    const ft = await foot(), r = await rest();
    const f = await screen(!modifiers && r && r.below !== null ? [ft[0], r.below, ft[2]] : ft);
    await drag(line(c, { x: c.x + to.x - f.x, y: c.y + to.y - f.y }, 30), modifiers);
  };
  const near = (a, b, eps) => Math.abs(a - b) <= eps;
  const step = (m) => process.env.SNAP_TRACE && console.log(`    … ${tag}: ${m}`);
  try {
    await page.goto(srv.url);
    await page.waitFor(`document.querySelectorAll('.obj').length > 0 && !!${DBG}`, 90000);
    await sleep(1500);
    await page.eval(`studioShell.actions.select(${JSON.stringify(BARREL)})`);
    await sleep(1200); // the first pick glides from the opening view (0.6 s)
    // The barrel and the pier both in view: frame all if the glide's framing left the pier out.
    const inView = async (p) => {
      const s = await screen(p);
      const f = await frameBox();
      return s && s.x > f.left + 30 && s.x < f.right - 30 && s.y > f.top + 60 && s.y < f.bottom - (phone ? 260 : 60);
    };
    // Closer, toward the middle of the barrel and the pier (the wheel zooms toward the pointer), so the photos show
    // the barrel on the planks — while both stay in view (one step back when a step lost one of them).
    const both = async () => (await inView(ON_PIER)) && (await inView(await foot()));
    for (let i = 0; i < 6 && (await both()); i++) {
      const a = await screen(ON_PIER), b = await screen(await foot());
      const at = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      await page.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: at.x, y: at.y, deltaX: 0, deltaY: -200 });
      await sleep(150);
      if (!(await both())) {
        await page.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: at.x, y: at.y, deltaX: 0, deltaY: 200 });
        await sleep(150);
        break;
      }
    }
    await sleep(400);
    if (!(await inView(ON_PIER))) {
      await page.eval(`studioShell.actions.frameAll()`);
      await sleep(600);
    }
    assert.ok(await inView(ON_PIER), 'the pier is not in view');
    const r0 = await rest();
    assert.ok(r0 && r0.below !== null, `nothing under the barrel: ${JSON.stringify(r0)}`);
    const stand = r0.bottom - r0.below; // the barrel floats low: its bottom a little under the water
    ok(`the barrel stands on the water (bottom ${r0.bottom.toFixed(3)}, surface ${r0.below.toFixed(3)})`);

    // ---- Move: onto the pier ----
    if (!phone) await tool('m');
    const target = await screen(ON_PIER);
    await footTo(target);
    const r1 = await rest();
    const f1 = await foot();
    assert.ok(near(r1.below, PIER_TOP, 0.02), `not over the pier's planks: surface ${r1.below}`);
    // On another surface than the one it floated in, the bottom sits exactly on it (the float's sink is not kept).
    assert.ok(near(r1.bottom - r1.below, Math.max(0, stand), 0.01), `not standing on the planks: bottom ${r1.bottom}, surface ${r1.below}`);
    assert.ok(Math.hypot(f1[0] - ON_PIER[0], f1[2] - ON_PIER[2]) < 0.6, `the foot is not where the pointer put it: ${f1}`);
    ok(`dragged onto the pier: stands on the planks (bottom ${r1.bottom.toFixed(3)}, planks ${r1.below.toFixed(3)})`);
    await shot('1-on-pier');

    // ---- Drop to floor ----
    await raise(12);
    const r2 = await rest();
    assert.ok(r2.bottom - r2.below > 1.1, `PgUp did not raise it: ${JSON.stringify(r2)}`);
    await shot('2-before-drop');
    if (phone) {
      // The place's menu: a finger held still on the barrel, then "Drop to floor".
      const c = await center();
      await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: c.x, y: c.y, id: 1 }] });
      await sleep(900);
      await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitFor(`!document.querySelector('.ctx-menu').hidden`, 3000);
      await sleep(200);
      const row = await j(`(() => { const b = document.querySelector('.ctx-menu [data-action=ctx-drop]'); if (!b) return 'null'; const r = b.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }); })()`);
      assert.ok(row, 'the place\'s menu has no Drop to floor');
      await page.tap(row.x, row.y);
      await sleep(500);
    } else await key('End', 'End', 35);
    await sleep(300);
    const r3 = await rest();
    assert.ok(near(r3.bottom, r3.below, 0.005), `not set on the surface: ${JSON.stringify(r3)}`);
    assert.ok(near(r3.below, PIER_TOP, 0.02), `dropped onto something else than the planks: ${r3.below}`);
    ok(`Drop to floor (${phone ? 'the place\'s menu' : 'End'}): bottom ${r2.bottom.toFixed(2)} → ${r3.bottom.toFixed(3)} on the planks`);
    await shot('3-after-drop');
    if (phone) return;

    // ---- Height: stops on the planks, a long pull goes through, Ctrl frees it ----
    await tool('h');
    await raise(10);
    let c = await center();
    const r4 = await rest();
    const gapPx = (r4.bottom - r4.below) * c.liftPx;
    await drag(line(c, { x: c.x, y: c.y + gapPx + 12 }, 24));
    const r5 = await rest();
    assert.ok(near(r5.bottom, r5.below, 0.01), `the height drag did not stop on the planks: ${JSON.stringify(r5)} (asked ${(r4.bottom - r4.below).toFixed(2)} m + 12 px)`);
    ok(`Height: pulled ${(r4.bottom - r4.below).toFixed(2)} m + 12 px down, stopped on the planks (bottom ${r5.bottom.toFixed(3)})`);
    c = await center();
    await drag(line(c, { x: c.x, y: c.y + 120 }, 24));
    const r6 = await rest();
    assert.ok(r6.bottom < PIER_TOP - 0.05, `a long pull did not go through the planks: ${JSON.stringify(r6)}`);
    ok(`Height: a long pull goes through (bottom ${r6.bottom.toFixed(2)})`);
    step('undo ×2');
    await undo();
    await undo();
    step('rest');
    const r7 = await rest();
    assert.ok(near(r7.bottom - r7.below, r4.bottom - r4.below, 0.01), `undo did not bring the height back: ${JSON.stringify(r7)}`);
    c = await center();
    step('ctrl drag');
    await drag(line(c, { x: c.x, y: c.y + gapPx + 12 }, 24), CTRL);
    step('ctrl drag done');
    const r8 = await rest();
    assert.ok(r8.bottom < PIER_TOP - 0.01, `with Ctrl held the height drag still stopped: ${JSON.stringify(r8)}`);
    ok(`Height with Ctrl held: no stop (bottom ${r8.bottom.toFixed(3)})`);
    await undo();

    // ---- Move with Ctrl: flat at its height ----
    await key('End', 'End', 35);
    await tool('m');
    const y0 = (await pose()).p[1];
    const back = await screen([4, 0, 12]);
    await footTo(back, CTRL);
    const y1 = (await pose()).p[1];
    assert.ok(near(y0, y1, 1e-6), `with Ctrl held the move changed the height: ${y0} → ${y1}`);
    ok('Move with Ctrl held: flat, the height kept');
    await undo();

    // ---- the ? sheet and ⌘K ----
    await page.eval(`(document.activeElement?.blur?.(), document.body.focus())`);
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: '?', code: 'Slash', windowsVirtualKeyCode: 191, modifiers: 8, text: '?' });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: '?', code: 'Slash', windowsVirtualKeyCode: 191, modifiers: 8 });
    await page.waitFor(`!!document.querySelector('.keys-sheet:not([hidden])')`, 3000);
    const rows = await j(`JSON.stringify(['drop', 'free'].map((k) => document.querySelector('.keys-sheet [data-key=' + k + ']')?.textContent.trim() || null))`);
    assert.ok(rows[0] && /Drop to floor/.test(rows[0]) && /End/.test(rows[0]), `the sheet: ${rows[0]}`);
    assert.ok(rows[1] && /without snapping/.test(rows[1]), `the sheet: ${rows[1]}`);
    ok(`the ? sheet: "${rows[0]}" · "${rows[1]}"`);
    await key('Escape', 'Escape', 27);
    await key('k', 'KeyK', 75, MOD);
    await page.waitFor(`!!document.querySelector('#studio-palette:not([hidden])')`, 3000);
    const pal = await page.eval(`document.querySelector('#studio-palette [data-action=drop]')?.textContent.trim() || ''`);
    assert.match(pal, /Drop to floor/);
    ok(`⌘K: "${pal}"`);
  } catch (e) {
    failed++;
    console.error(`  ✗ ${tag}: ${e.message}`);
    if (SHOTS) writeFileSync(join(SHOTS, `${tag}-fail.png`), await page.screenshot());
  } finally {
    await browser.close();
    await srv.close();
  }
}

for (const phone of [false, true]) {
  if (ONLY && ONLY !== (phone ? 'phone' : 'pc')) continue;
  await run(phone);
}
if (failed) {
  console.error(`studio-snap-surface: ${failed} failed`);
  process.exit(1);
}
console.log('studio-snap-surface: ok');
