// WASD camera in the editor, in a headless browser (camera-wasd pass 2026-10-18: "anyone who has used a 3D game engine
// moves the camera with WASD too").
//
//   node test/studio-camera-wasd.browser.mjs [--shots <dir>] [--theme light|dark] [--game lantern-cove,firefly-ruins]
//
// Lantern Cove (3D) at PC 1280×800 with a mouse and a keyboard:
// - nothing picked, the game focused: W held flies forward along the line of sight, smoothly (more the longer it is
//   held), and stops when let go; S comes back, D goes right, E / Q up / down; the direction never changes; Shift is
//   faster; the editor page focused does the same;
// - something picked: W / A / D do nothing to the view, S still chooses the Size tool, E still turns the pick;
// - something picked + the right button held: W flies, E rises, the drag turns where the camera stands (fly look),
//   the release opens no menu, the pick stays (and the camera never moves by itself in between);
// - typing in the ask box: W types, the view stays;
// - the ? sheet lists "Fly the camera  WASD" with its rule, ⌘K finds it by "wasd" with WASD / Right button+WASD.
// Firefly Ruins (2D): W does nothing to the view, no fly row in the sheet.
// --web: the browser-only web demo (the trial version, scripts/build-web-demo.mjs, served like the hosted test version):
// Lantern Cove opens, W held flies and stops on release, E rises, S with the lighthouse picked chooses Size.
// Photos (--shots): pc-<theme>-1-before.png (the opening view), -2-after-fly.png (after flying), -3-keys.png (the sheet).
// Each run uses a temporary copy of the starter. Needs the network for the starters' libraries (or STUDIO_CDN_CACHE).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStudioServer } from '../src/server/server.mjs';
import { launch, newPage } from './adapters-2d/cdp.mjs';
import { startHost } from './web-demo-host.mjs';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const take = (flag, d) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : d;
};
const SHOTS = take('--shots', null) ? resolve(take('--shots')) : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const THEME = take('--theme', 'light');
const GAMES = take('--game', 'lantern-cove,firefly-ruins').split(',');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WIN = `document.querySelector('iframe').contentWindow`;
const DBG = `${WIN}.__gameStudio?._debug`;
const ROOT = `${WIN}.document.querySelector('[data-studio-ui]').shadowRoot`;

let failed = 0;

/** Where the edit camera stands (camera.js: target + distance along yaw / pitch). */
const eye = (s) => {
  const cp = Math.cos(s.pitch);
  return [s.target[0] + s.distance * cp * Math.sin(s.yaw), s.target[1] + s.distance * Math.sin(s.pitch), s.target[2] + s.distance * cp * Math.cos(s.yaw)];
};
const sub = (a, b) => a.map((x, i) => x - b[i]);
const len = (a) => Math.hypot(...a);

async function run(game) {
  const three = game === 'lantern-cove';
  const tag = `pc-${THEME}-${game}`;
  const root = mkdtempSync(join(tmpdir(), `studio-camera-wasd-${game}-`));
  cpSync(join(PKG, 'starters', game), root, { recursive: true });
  mkdirSync(join(root, '.studio/ui'), { recursive: true });
  writeFileSync(join(root, '.studio/ui/prefs.json'), JSON.stringify({ version: 1, lang: 'en', theme: THEME }));
  const srv = await startStudioServer({ root, uiDir: join(PKG, 'skills/arrange/bin/studio-ui'), log: () => {} });
  const browser = await launch();
  const page = await newPage(browser, { width: 1280, height: 800, cdnCache: process.env.STUDIO_CDN_CACHE });
  const ok = (m) => console.log(`  ✓ ${tag}: ${m}`);
  const shot = async (name) => {
    if (SHOTS) writeFileSync(join(SHOTS, `pc-${THEME}-${name}.png`), await page.screenshot());
  };
  const j = async (expr) => JSON.parse((await page.eval(expr)) || 'null');
  const view = () => j(`JSON.stringify(${DBG}.view())`);
  const selected = () => page.eval('studioShell.selected()');
  const pose = (k) => j(`JSON.stringify(${DBG}.anchor(${JSON.stringify(k)}).pose)`);
  const keyEv = (type, k, modifiers = 0) => {
    const code = k === ' ' ? 'Space' : k === '?' ? 'Slash' : `Key${k.toUpperCase()}`;
    const vk = k === ' ' ? 32 : k === '?' ? 191 : k.toUpperCase().charCodeAt(0);
    const text = type === 'keyDown' && !(modifiers & ~8) && k !== ' ' ? k : undefined;
    return page.send('Input.dispatchKeyEvent', { type, key: k, code, windowsVirtualKeyCode: vk, modifiers, text });
  };
  /** Hold a key for `ms` (no auto-repeat: the editor must keep moving on its own while the key is down). */
  const hold = async (k, ms, modifiers = 0) => {
    await keyEv('keyDown', k, modifiers);
    await sleep(ms);
    await keyEv('keyUp', k, modifiers);
    await sleep(150);
  };
  const press = (k, modifiers = 0) => hold(k, 30, modifiers);
  const focusGame = () => page.eval(`document.querySelector('iframe').contentWindow.focus()`);
  const focusShell = () => page.eval(`(document.activeElement?.blur?.(), document.querySelector('iframe').blur(), window.focus(), document.body.focus())`);
  const same = (a, b, when) => assert.equal(JSON.stringify(b), JSON.stringify(a), `${when}: the view moved`);
  /** The view's direction (yaw / pitch) and distance stayed, only the place changed — returns how far the camera went. */
  const flew = (a, b, when) => {
    for (const k of ['yaw', 'pitch', 'distance']) assert.ok(Math.abs(a[k] - b[k]) < 1e-9, `${when}: ${k} changed (${a[k]} → ${b[k]})`);
    const d = len(sub(eye(b), eye(a)));
    assert.ok(d > 1e-3, `${when}: the camera did not move`);
    return d;
  };
  /** The look direction of a view state (unit). */
  const dirOf = (s) => {
    const cp = Math.cos(s.pitch);
    return [-cp * Math.sin(s.yaw), -Math.sin(s.pitch), -cp * Math.cos(s.yaw)];
  };
  const frame = () => j(`(() => { const r = document.querySelector('iframe').getBoundingClientRect(); return JSON.stringify([r.left, r.top, r.width, r.height]); })()`);
  const right = (type, x, y) => page.send('Input.dispatchMouseEvent', { type, x, y, button: 'right', buttons: type === 'mouseReleased' ? 0 : 2, clickCount: 1 });
  const menuOpen = () => page.eval(`(() => { const m = document.querySelector('.ctx-menu'); return !!m && !m.hidden; })()`);
  try {
    await page.goto(srv.url);
    await page.waitFor(`document.querySelectorAll('.obj').length > 0 && !!${DBG}`, 90000);
    await sleep(1500);
    if (!three) {
      const v0 = await view();
      await focusGame();
      await hold('w', 400);
      await hold('d', 200);
      same(v0, await view(), '2D, W / D');
      await focusShell();
      await press('?', 8);
      await page.waitFor(`!!document.querySelector('.keys-sheet:not([hidden])')`, 3000);
      assert.equal(await page.eval(`!!document.querySelector('.keys-sheet [data-key=fly]')`), false, '2D lists Fly the camera');
      ok('2D: W A S D do nothing to the view, no fly row');
      return;
    }

    // Nothing picked, the game focused (the opening view): the "before" photo, then W held.
    assert.equal(await selected(), null);
    await shot('1-before');
    await focusGame();
    let a = await view();
    await hold('w', 150);
    let b = await view();
    const short = flew(a, b, 'W (short)');
    const fwd = sub(eye(b), eye(a));
    const want = dirOf(a);
    for (let i = 0; i < 3; i++) assert.ok(Math.abs(fwd[i] / short - want[i]) < 1e-6, `W went ${fwd}, the view looks ${want}`);
    a = b;
    await hold('w', 700);
    b = await view();
    const long = flew(a, b, 'W (held)');
    assert.ok(long > short * 2, `holding W 700 ms went ${long}, 150 ms ${short} (it should keep going while held)`);
    await sleep(300);
    same(b, await view(), 'after W was let go');
    ok(`nothing picked: W flies along the line of sight, keeps going while held (${(long / short).toFixed(1)}×), stops on release`);

    a = await view();
    await hold('s', 700);
    b = await view();
    const backD = sub(eye(b), eye(a));
    assert.ok(backD.every((x, i) => Math.sign(x) === -Math.sign(fwd[i]) || Math.abs(x) < 1e-6), 'S did not go back');
    a = b;
    await hold('d', 300);
    b = await view();
    flew(a, b, 'D');
    const side = sub(eye(b), eye(a));
    assert.ok(Math.abs(side[1]) < 1e-6, 'D changed the height');
    assert.ok(Math.abs(side[0] * want[0] + side[2] * want[2]) < 1e-6 * len(side) + 1e-9, 'D is not sideways');
    a = b;
    await hold('e', 300);
    b = await view();
    flew(a, b, 'E');
    assert.ok(b.target[1] > a.target[1] && Math.abs(b.target[0] - a.target[0]) < 1e-9, 'E did not go straight up');
    a = b;
    await hold('q', 300);
    b = await view();
    assert.ok(b.target[1] < a.target[1], 'Q did not go down');
    // Shift: faster.
    a = await view();
    await hold('a', 400);
    const plain = flew(a, (b = await view()), 'A');
    await hold('A', 400, 8);
    const fast = flew(b, await view(), 'Shift+A');
    assert.ok(fast > plain * 1.8, `Shift+A went ${fast}, A ${plain}`);
    ok(`S back, D right (level), E / Q up / down, Shift ×${(fast / plain).toFixed(1)}`);

    // The editor page focused: the same.
    await focusShell();
    a = await view();
    await hold('w', 400);
    flew(a, (b = await view()), 'W in the editor page');
    await sleep(300);
    same(b, await view(), 'after W was let go in the editor page');
    // Typing in the ask box: W types.
    const ask = await page.eval(`!!document.querySelector('.ask-input')?.offsetParent`);
    if (ask) {
      await page.eval(`document.querySelector('.ask-input').focus()`);
      a = await view();
      await hold('w', 300);
      same(a, await view(), 'W typed in the ask box');
      assert.match(await page.eval(`document.querySelector('.ask-input').value`), /w/);
      await page.eval(`(() => { const i = document.querySelector('.ask-input'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); i.blur(); })()`);
    }
    ok(`the editor page focused: W flies; typing in the ask box ${ask ? 'types (the view stays)' : '(no ask box)'}`);

    // ⌘K, nothing picked: "wasd" finds Fly the camera with WASD.
    await focusShell();
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'k', code: 'KeyK', windowsVirtualKeyCode: 75, modifiers: 2 });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'k', code: 'KeyK', windowsVirtualKeyCode: 75, modifiers: 2 });
    await page.waitFor(`!!document.querySelector('#studio-palette:not([hidden])')`, 3000);
    const row = () => j(`JSON.stringify([...document.querySelectorAll('#studio-palette [data-action=fly]')].map((r) => r.textContent.trim()))`);
    assert.deepEqual(await row(), ['Fly the cameraWASD']);
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await sleep(300);

    // Something picked: W / A / D leave the view alone, S chooses Size, E turns the pick.
    await page.eval(`window.studioShell.actions.select('lighthouse')`);
    await sleep(1200);
    assert.equal(await selected(), 'lighthouse');
    await focusGame();
    a = await view();
    const p0 = await pose('lighthouse');
    await hold('w', 300);
    await hold('a', 200);
    await hold('d', 200);
    same(a, await view(), 'W / A / D with something picked');
    assert.equal(JSON.stringify(await pose('lighthouse')), JSON.stringify(p0), 'W / A / D changed the lighthouse');
    await press('s');
    const pressed = () => j(`JSON.stringify([...${ROOT}.querySelectorAll('[data-studio-handle]')].filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.dataset.studioHandle))`);
    assert.deepEqual(await pressed(), ['scale'], 'S did not choose the Size tool');
    await press('e');
    await sleep(200);
    same(a, await view(), 'E with something picked');
    assert.notEqual(JSON.stringify(await pose('lighthouse')), JSON.stringify(p0), 'E with something picked did not turn it');
    await press('q');
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await sleep(200);
    assert.equal(await selected(), 'lighthouse', 'Escape (dropping the tool) dropped the pick');
    ok('something picked: W / A / D leave the view, S = Size tool, E turns it');

    // Something picked + the right button held: W flies, E rises, the drag looks where the camera stands, no menu.
    const [fl, ft, fw, fh] = await frame();
    const x = fl + fw * 0.5, y = ft + fh * 0.18; // the sky over the harbour
    a = await view();
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await right('mousePressed', x, y);
    await sleep(100);
    await hold('w', 400);
    b = await view();
    flew(a, b, 'right button + W');
    await hold('e', 250);
    const c = await view();
    assert.ok(c.target[1] > b.target[1], 'right button + E did not rise');
    // The drag now turns where the camera stands.
    for (let i = 1; i <= 8; i++) {
      await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x + i * 12, y, button: 'right', buttons: 2 });
      await sleep(16);
    }
    const d = await view();
    assert.ok(Math.abs(d.yaw - c.yaw) > 0.05, 'the right-drag while flying did not turn the view');
    assert.ok(len(sub(eye(d), eye(c))) < 1e-6 * Math.max(1, c.distance), `the right-drag while flying moved the camera (${len(sub(eye(d), eye(c)))})`);
    await right('mouseReleased', x + 96, y);
    await sleep(400);
    assert.equal(await menuOpen(), false, 'the release after flying opened the menu');
    assert.equal(await selected(), 'lighthouse', 'flying dropped the pick');
    await sleep(300);
    same(d, await view(), 'after the right button was let go (the camera moved by itself)');
    // A plain right-click (no key) still opens the menu.
    await right('mousePressed', x, y);
    await right('mouseReleased', x, y);
    await page.waitFor(`(() => { const m = document.querySelector('.ctx-menu'); return !!m && !m.hidden; })()`, 3000);
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await sleep(300);
    ok('something picked + right button: W flies, E rises, the drag looks in place, no menu after; a plain right-click still opens it');

    // ⌘K with a pick: Right button+WASD.
    await focusShell();
    if ((await selected()) !== 'lighthouse') {
      await page.eval(`window.studioShell.actions.select('lighthouse')`);
      await sleep(800);
    }
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'k', code: 'KeyK', windowsVirtualKeyCode: 75, modifiers: 2 });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'k', code: 'KeyK', windowsVirtualKeyCode: 75, modifiers: 2 });
    await page.waitFor(`!!document.querySelector('#studio-palette:not([hidden])')`, 3000);
    assert.deepEqual(await row(), ['Fly the cameraRight button+WASD']);
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await sleep(300);
    ok('⌘K: Fly the camera — WASD with nothing picked, Right button+WASD with a pick');

    // The "after" photo: back to the opening view with nothing picked (⇧F, Esc), then fly in: W + a little up and right.
    await focusShell();
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await page.waitFor(`studioShell.selected() === null`, 3000);
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'F', code: 'KeyF', windowsVirtualKeyCode: 70, modifiers: 8 });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'F', code: 'KeyF', windowsVirtualKeyCode: 70, modifiers: 8 });
    await sleep(1500);
    await focusGame();
    await hold('w', 900);
    await hold('e', 250);
    await hold('d', 250);
    await sleep(500);
    await shot('2-after-fly');
    ok('photos (before / after flying)');

    // The ? sheet: the fly row, its rule under the name.
    await focusShell();
    await press('?', 8);
    await page.waitFor(`!!document.querySelector('.keys-sheet:not([hidden])')`, 3000);
    const fly = await j(`(() => { const r = document.querySelector('.keys-sheet [data-key=fly]'); return r ? JSON.stringify({ name: r.querySelector('dt').firstChild.textContent, note: r.querySelector('.keys-note')?.textContent, keys: [...r.querySelectorAll('kbd')].map((k) => k.textContent) }) : 'null'; })()`);
    assert.ok(fly, 'no fly row in the sheet');
    assert.equal(fly.name, 'Fly the camera');
    assert.deepEqual(fly.keys, ['WASD']);
    assert.match(fly.note, /right mouse button/);
    await sleep(300);
    await shot('3-keys');
    ok(`the ? sheet: "${fly.name}  ${fly.keys.join(' ')}" — ${fly.note}`);
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

/** The web demo (the trial version): the same keys work there. */
async function runWeb() {
  const tag = 'web-demo-pc-lantern-cove';
  const dir = join(mkdtempSync(join(tmpdir(), 'studio-camera-wasd-web-')), 'site');
  execFileSync(process.execPath, [join(PKG, 'scripts/build-web-demo.mjs'), '--out', dir], { stdio: 'ignore' });
  const host = await startHost({ dir });
  const browser = await launch();
  const page = await newPage(browser, { width: 1280, height: 800, cdnCache: process.env.STUDIO_CDN_CACHE });
  const j = async (expr) => JSON.parse((await page.eval(expr)) || 'null');
  const view = () => j(`JSON.stringify(${DBG}.view())`);
  const keyEv = (type, k) => page.send('Input.dispatchKeyEvent', { type, key: k, code: `Key${k.toUpperCase()}`, windowsVirtualKeyCode: k.toUpperCase().charCodeAt(0), text: type === 'keyDown' ? k : undefined });
  const hold = async (k, ms) => {
    await keyEv('keyDown', k);
    await sleep(ms);
    await keyEv('keyUp', k);
    await sleep(150);
  };
  try {
    // The editor on its own page (the front page's "Open full size"; the front page's frame: test/web-demo-lp.browser.mjs).
    await page.goto(`${host.url}studio/?game=lantern-cove&lang=en`);
    await page.waitFor(`document.querySelectorAll('.obj').length > 0 && !!${DBG}`, 90000);
    await sleep(1500);
    await page.eval(`${WIN}.focus()`);
    const a = await view();
    await hold('w', 500);
    const b = await view();
    const d = len(sub(eye(b), eye(a)));
    assert.ok(d > 1e-3 && a.yaw === b.yaw && a.pitch === b.pitch, `W in the web demo: moved ${d}`);
    await sleep(300);
    assert.equal(JSON.stringify(await view()), JSON.stringify(b), 'the web demo kept flying after W was let go');
    await hold('e', 250);
    assert.ok((await view()).target[1] > b.target[1], 'E in the web demo did not rise');
    await page.eval(`window.studioShell.actions.select('lighthouse')`);
    await sleep(1000);
    await page.eval(`${WIN}.focus()`);
    const c = await view();
    await hold('w', 300);
    assert.equal(JSON.stringify(await view()), JSON.stringify(c), 'W with the lighthouse picked moved the view in the web demo');
    console.log(`  ✓ ${tag}: W flies (${d.toFixed(2)} in 0.5 s) and stops, E rises, W with a pick leaves the view`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${tag}: ${e.message}`);
  } finally {
    await page.close();
    await browser.close();
    await host.close();
    rmSync(dirname(dir), { recursive: true, force: true });
  }
}

if (args.includes('--web')) await runWeb();
else for (const game of GAMES) await run(game);
if (failed) {
  console.log(`studio-camera-wasd: ${failed} run(s) failed`);
  process.exit(1);
}
console.log('studio-camera-wasd: ok');
