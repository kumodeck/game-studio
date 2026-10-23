// Camera up / down in the editor, in a headless browser (play test 2026-10-18: "I can't raise the camera; it's needed").
//
//   node test/studio-camera-up.browser.mjs [--shots <dir>] [--only pc,phone] [--theme light|dark|both] [--game lantern-cove,firefly-ruins]
//
// Lantern Cove (3D) at PC 1280×800 with a mouse and a phone 390×844 with a finger, light and dark:
// - the ↑↓ buttons sit in the game's bottom-right corner, inside the game, clear of the card and the ask bar
//   (nothing of the editor page covers them), finger-sized on the phone;
// - a click / tap on ↑ raises the camera, ↓ lowers it; holding ↑ keeps raising; dragging up on them raises too;
//   every time only the height changes: the direction (yaw, pitch) and the distance stay;
// - the pick stays through all of it (a press on the buttons is never a click on "nothing"), and picking still
//   does not move the camera (wave 1);
// - keys (PC): E / Q raise / lower with nothing picked (game focused and editor page focused); with something
//   picked E / Q still turn it and the camera stays; with Space held they raise / lower and the object stays;
// - ⌘K lists "Camera up" / "Camera down" with their keys, and the row raises the camera.
// Firefly Ruins (2D): no buttons, no ⌘K rows, and E does nothing to the view (2D has no camera height).
// Photos (--shots): <pc|phone>-<light|dark>-1-before.png (picked, before) and -2-after-up.png (after going up).
// Each run uses a temporary copy of the starter. Needs the network for the starters' libraries (or STUDIO_CDN_CACHE).
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
const LAYOUTS = take('--only', 'pc,phone').split(',');
const THEME = take('--theme', 'both');
const THEMES = THEME === 'both' ? ['light', 'dark'] : [THEME];
const GAMES = take('--game', 'lantern-cove,firefly-ruins').split(',');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WIN = `document.querySelector('iframe').contentWindow`;
const DBG = `${WIN}.__gameStudio?._debug`;
// The ↑↓ group, in its own shadow root (bridge/rise.ts).
const RISE = `[...document.querySelector('iframe').contentDocument.querySelectorAll('[data-studio-ui]')].map((h) => h.shadowRoot?.querySelector('.cam')).find(Boolean)`;

let failed = 0;

async function run(game, layout, theme) {
  const mobile = layout === 'phone';
  const three = game === 'lantern-cove';
  const tag = `${layout}-${theme}-${game}`;
  const root = mkdtempSync(join(tmpdir(), `studio-camera-up-${game}-`));
  cpSync(join(PKG, 'starters', game), root, { recursive: true });
  mkdirSync(join(root, '.studio/ui'), { recursive: true });
  writeFileSync(join(root, '.studio/ui/prefs.json'), JSON.stringify({ version: 1, lang: 'en', theme }));
  const srv = await startStudioServer({ root, uiDir: join(PKG, 'skills/arrange/bin/studio-ui'), log: () => {} });
  const browser = await launch();
  const page = await newPage(browser, { ...(mobile ? { width: 390, height: 844, mobile: true } : { width: 1280, height: 800 }), cdnCache: process.env.STUDIO_CDN_CACHE });
  const ok = (m) => console.log(`  ✓ ${tag}: ${m}`);
  const shot = async (name) => {
    if (SHOTS) writeFileSync(join(SHOTS, `${layout}-${theme}-${name}.png`), await page.screenshot());
  };
  const j = async (expr) => JSON.parse((await page.eval(expr)) || 'null');
  const view = () => j(`JSON.stringify(${DBG}.view())`);
  const selected = () => page.eval('studioShell.selected()');
  /** The ↑ / ↓ button in page px, or null when there is none. */
  const button = (dir) => j(`(() => { const o = document.querySelector('iframe').getBoundingClientRect(); const cam = ${RISE};
    const b = cam && cam.querySelector('[data-rise=${dir}]'); if (!b || !b.getBoundingClientRect().width) return null; const r = b.getBoundingClientRect();
    return JSON.stringify({ x: o.left + r.left + r.width / 2, y: o.top + r.top + r.height / 2, l: o.left + r.left, t: o.top + r.top, w: r.width, h: r.height, title: b.title,
      frame: [o.left, o.top, o.width, o.height] }); })()`);
  const tap = async (pt) => (mobile ? page.tap(pt.x, pt.y) : page.click(pt.x, pt.y));
  const drag = (x0, y0, x1, y1) => (mobile ? page.touchDrag(x0, y0, x1, y1, 10) : page.mouseDrag(x0, y0, x1, y1, 10));
  const hold = async (pt, ms) => {
    if (mobile) {
      await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pt.x, y: pt.y, id: 1 }] });
      await sleep(ms);
      await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pt.x, y: pt.y });
      await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', buttons: 1, clickCount: 1 });
      await sleep(ms);
      await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', buttons: 0, clickCount: 1 });
    }
    await sleep(250);
  };
  const key = async (k, type = 'both', modifiers = 0) => {
    const code = k === ' ' ? 'Space' : `Key${k.toUpperCase()}`;
    const vk = k === ' ' ? 32 : k.toUpperCase().charCodeAt(0);
    if (type !== 'up') await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers, text: k === ' ' || modifiers ? undefined : k });
    if (type !== 'down') await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers });
    await sleep(150);
  };
  const focusGame = () => page.eval(`document.querySelector('iframe').contentWindow.focus()`);
  const focusShell = () => page.eval(`(document.activeElement?.blur?.(), document.querySelector('iframe').blur(), window.focus(), document.body.focus())`);
  /** Only the height changed between two view states (by more than `min` world units, in the sign of `sign`). */
  const rose = (a, b, sign, when, min = 1e-3) => {
    for (const k of ['yaw', 'pitch', 'distance']) assert.ok(Math.abs(a[k] - b[k]) < 1e-9, `${when}: ${k} changed (${a[k]} → ${b[k]})`);
    assert.ok(Math.abs(a.target[0] - b.target[0]) < 1e-9 && Math.abs(a.target[2] - b.target[2]) < 1e-9, `${when}: the camera moved sideways`);
    const d = b.target[1] - a.target[1];
    assert.ok(sign > 0 ? d > min : d < -min, `${when}: the height went ${d} (wanted ${sign > 0 ? 'up' : 'down'})`);
    return Math.abs(d);
  };
  const same = (a, b, when) => assert.equal(JSON.stringify(b), JSON.stringify(a), `${when}: the view moved`);
  try {
    await page.goto(srv.url);
    await page.waitFor(`document.querySelectorAll('.obj').length > 0 && !!${DBG}`, 90000);
    await sleep(1500);
    if (!three) {
      assert.equal(await button('up'), null, '2D shows camera up / down');
      const v0 = await view();
      await focusGame();
      await key('e');
      same(v0, await view(), '2D, E');
      await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'k', code: 'KeyK', windowsVirtualKeyCode: 75, modifiers: 2 });
      await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'k', code: 'KeyK', windowsVirtualKeyCode: 75, modifiers: 2 });
      await page.waitFor(`!!document.querySelector('#studio-palette:not([hidden])')`, 3000);
      assert.equal(await page.eval(`!!document.querySelector('#studio-palette [data-action^=camera-]')`), false, '2D lists Camera up / down in ⌘K');
      ok('2D: no camera up / down (buttons, E, ⌘K)');
      return;
    }

    // The buttons: in the game's bottom-right corner, nothing of the editor page over them, finger-sized on a phone.
    const up = await button('up');
    const down = await button('down');
    assert.ok(up && down, 'no ↑↓ buttons');
    const [fl, ft, fw, fh] = up.frame;
    assert.ok(up.l > fl + fw / 2 && up.t > ft + fh / 2, `the buttons are not in the bottom-right (${up.l}, ${up.t} in ${up.frame})`);
    assert.ok(down.l + down.w <= fl + fw && down.t + down.h <= ft + fh, 'the buttons stick out of the game');
    assert.ok(down.t > up.t, '↓ is not under ↑');
    if (mobile) assert.ok(up.w >= 44 && up.h >= 44, `phone buttons are ${up.w}×${up.h}`);
    for (const b of [up, down]) {
      const top = await page.eval(`document.elementFromPoint(${b.x}, ${b.y})?.tagName`);
      assert.equal(top, 'IFRAME', `something of the editor page covers ${b === up ? '↑' : '↓'} (${top})`);
    }
    assert.match(up.title, /^Camera up \(E\)$/);
    assert.match(down.title, /^Camera down \(Q\)$/);
    ok(`↑↓ in the bottom-right, ${up.w}×${up.h} each, not covered`);

    // Pick the lighthouse: the camera does not move (wave 1), the tooltips name Space+E / Q (E / Q turn it now).
    const v0 = await view();
    await page.eval(`window.studioShell.actions.select('lighthouse')`);
    await sleep(1200);
    assert.equal(await selected(), 'lighthouse');
    same(v0, await view(), 'picking');
    // Phone: the ↑↓ step aside while the card is up (the second design review's ⑧, 2026-10-19), and come back with
    // nothing picked; the presses below are made with nothing picked there.
    const PICK = mobile ? null : 'lighthouse';
    if (mobile) {
      assert.equal(await button('up'), null, 'phone: ↑↓ shown while the card is up');
      await shot('1-before');
      await page.eval(`window.studioShell.actions.select(null)`);
      await sleep(800);
      assert.ok(await button('up'), 'phone: no ↑↓ after the pick was dropped');
      ok('phone: ↑↓ hidden while the card is up, back with nothing picked');
    } else {
      assert.equal((await button('up')).title, 'Camera up (Space+E)');
      await shot('1-before');
    }

    // A click / tap on ↑ and ↓: one step each way, only the height.
    let a = await view();
    await tap(await button('up'));
    await sleep(300);
    let b = await view();
    const step = rose(a, b, 1, '↑');
    assert.equal(await selected(), PICK, '↑ dropped the pick');
    await tap(await button('down'));
    await sleep(300);
    rose(b, await view(), -1, '↓');
    assert.ok(Math.abs((await view()).target[1] - a.target[1]) < 1e-6, '↑ then ↓ did not come back to the same height');
    ok('a click on ↑ / ↓ raises / lowers by one step, the direction stays, the pick stays');

    // Held: keeps going (more than one step).
    a = await view();
    await hold(await button('up'), 1200);
    const held = rose(a, await view(), 1, '↑ held');
    assert.ok(held > step * 2, `holding ↑ for 1.2 s went up ${held}, one click ${step}`);
    ok(`holding ↑ keeps going (${(held / step).toFixed(1)} steps in 1.2 s)`);

    // Dragged down on ↓ then up on ↑: the camera follows the drag.
    a = await view();
    const d = await button('down');
    await drag(d.x, d.y, d.x, d.y + 60);
    await sleep(300);
    b = await view();
    rose(a, b, -1, 'dragging down on ↓');
    const u = await button('up');
    await drag(u.x, u.y, u.x, u.y - 160);
    await sleep(300);
    rose(b, await view(), 1, 'dragging up on ↑');
    assert.equal(await selected(), PICK, 'dragging on the buttons dropped the pick');
    ok('dragging on the buttons follows the drag');

    if (!mobile) {
      // E / Q with the lighthouse picked: they still turn it, the camera stays.
      await focusGame();
      a = await view();
      const r0 = await j(`JSON.stringify(${DBG}.anchor('lighthouse').pose)`);
      await key('e');
      await sleep(300);
      same(a, await view(), 'E with something picked');
      const r1 = await j(`JSON.stringify(${DBG}.anchor('lighthouse').pose)`);
      assert.notEqual(JSON.stringify(r1), JSON.stringify(r0), 'E with something picked did not turn it');
      await key('q');
      await sleep(300);
      // Space held + E: the camera goes up, the lighthouse stays.
      const p0 = await j(`JSON.stringify(${DBG}.anchor('lighthouse').pose)`);
      await key(' ', 'down');
      await key('e');
      await key(' ', 'up');
      await sleep(300);
      rose(a, await view(), 1, 'Space+E');
      assert.equal(JSON.stringify(await j(`JSON.stringify(${DBG}.anchor('lighthouse').pose)`)), JSON.stringify(p0), 'Space+E turned the lighthouse');
      ok('E / Q turn the picked object; Space+E raises the camera instead');
      // Nothing picked: E / Q raise / lower, in the game and in the editor page.
      await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await page.waitFor(`studioShell.selected() === null`, 3000);
      a = await view();
      await key('e');
      await sleep(250);
      b = await view();
      rose(a, b, 1, 'E in the game, nothing picked');
      await key('q');
      await sleep(250);
      rose(b, await view(), -1, 'Q in the game, nothing picked');
      await focusShell();
      a = await view();
      await key('e');
      await sleep(300);
      rose(a, await view(), 1, 'E in the editor page, nothing picked');
      ok('nothing picked: E / Q raise / lower (game and editor page)');
      await page.eval(`window.studioShell.actions.select('lighthouse')`);
      await sleep(800);
    }

    // ⌘K: the rows, with their keys; the row raises the camera.
    await focusShell();
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'k', code: 'KeyK', windowsVirtualKeyCode: 75, modifiers: 2 });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'k', code: 'KeyK', windowsVirtualKeyCode: 75, modifiers: 2 });
    await page.waitFor(`!!document.querySelector('#studio-palette:not([hidden])')`, 3000);
    const rows = await j(`JSON.stringify([...document.querySelectorAll('#studio-palette [data-action^=camera-]')].map((r) => r.textContent.trim()))`);
    // A phone's list prints no keys (no keyboard there; design review 2 ④, main.ts "All actions prints no keys").
    assert.deepEqual(rows, mobile ? ['Camera up', 'Camera down'] : ['Camera upSpace+E', 'Camera downSpace+Q']);
    a = await view();
    await page.eval(`document.querySelector('#studio-palette [data-action=camera-up]').click()`);
    await sleep(400);
    rose(a, await view(), 1, '⌘K Camera up');
    ok('⌘K lists Camera up / down with their keys and the row raises the camera');

    // The photo after going up: back to the opening view (⇧F, the editor page focused; the ⌘K row run above closed
    // the list), the same picture as the "before" photo, then three clicks on ↑ — the photos differ by those steps only.
    await focusShell();
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'F', code: 'KeyF', windowsVirtualKeyCode: 70, modifiers: 8 });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'F', code: 'KeyF', windowsVirtualKeyCode: 70, modifiers: 8 });
    await sleep(1500);
    assert.ok(Math.abs((await view()).target[1] - v0.target[1]) < 1e-6, '⇧F did not bring the opening view back');
    if (!mobile && (await selected()) !== 'lighthouse') {
      await page.eval(`window.studioShell.actions.select('lighthouse')`);
      await sleep(800);
    }
    for (let i = 0; i < 3; i++) {
      await tap(await button('up'));
      await sleep(200);
    }
    await sleep(600);
    assert.equal(await selected(), PICK, 'the pick was lost on the way');
    await shot('2-after-up');
    ok('photos');
  } catch (e) {
    failed++;
    console.log(`  ✗ ${tag}: ${e.message}`);
    console.log(page.logs?.slice(-8).join('\n') ?? '');
  } finally {
    await page.close();
    await browser.close();
    await srv.close();
    rmSync(root, { recursive: true, force: true });
  }
}

for (const game of GAMES) for (const layout of LAYOUTS) for (const theme of (game === 'lantern-cove' ? THEMES : THEMES.slice(0, 1))) await run(game, layout, theme);
if (failed) {
  console.log(`studio-camera-up: ${failed} run(s) failed`);
  process.exit(1);
}
console.log('studio-camera-up: ok');
