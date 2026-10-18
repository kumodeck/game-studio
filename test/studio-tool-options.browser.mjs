// The ▾ on the strip's turn / size buttons, in a headless browser (play test 2026-10-18: "turn and size have
// options — put a ▾ on the button and open them from it; today a second press opens the turn options, and
// people don't press a button twice").
//
//   node test/studio-tool-options.browser.mjs [--shots <dir>] [--only pc,phone] [--theme light|dark|both] [--game lantern-cove,firefly-ruins]
//
// Lantern Cove (3D: the lighthouse) and Firefly Ruins (2D: the first object that turns and resizes), PC 1280×800
// with a mouse and a phone 390×844 with a finger, light and dark:
// - the ▾ shows where there are choices and nowhere else: 3D turn with one picked; size with several picked;
//   never on 2D turn (2D turns one way only) and never on size with one picked;
// - the ▾ sits inside the button (bottom-right corner): the buttons keep their size (44 px on a phone) and the
//   strip does not move by 1 px while tools are chosen, the choices open and close, a choice is made;
// - one tap on the turn button only chooses the tool (no choices in the way); one tap on the ▾ opens them;
//   a long press on the button opens them too; PC: hovering the button lights the ▾;
// - choosing a way chooses its tool and the button wears that way's picture (axis x / "each in place");
// - Escape in the game, Escape in the editor page and a press in the editor page close the choices
//   (and leave the chosen tool alone).
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
const DBG = `document.querySelector('iframe').contentWindow.__gameStudio?._debug`;
const ROOT = `document.querySelector('iframe').contentDocument.querySelector('[data-studio-ui]').shadowRoot`;

let failed = 0;

async function run(game, layout, theme) {
  const mobile = layout === 'phone';
  const three = game === 'lantern-cove';
  const tag = `${layout}-${theme}-${game}`;
  const root = mkdtempSync(join(tmpdir(), `studio-tool-options-${game}-`));
  cpSync(join(PKG, 'starters', game), root, { recursive: true });
  mkdirSync(join(root, '.studio/ui'), { recursive: true });
  writeFileSync(join(root, '.studio/ui/prefs.json'), JSON.stringify({ version: 1, lang: 'en', theme }));
  const srv = await startStudioServer({ root, uiDir: join(PKG, 'skills/arrange/bin/studio-ui'), log: () => {} });
  const browser = await launch();
  const page = await newPage(browser, { ...(mobile ? { width: 390, height: 844, mobile: true } : { width: 1280, height: 800 }), cdnCache: process.env.STUDIO_CDN_CACHE });
  const ok = (m) => console.log(`  ✓ ${tag}: ${m}`);
  const shot = async (name) => {
    if (SHOTS) writeFileSync(join(SHOTS, `after-${tag}-${name}.png`), await page.screenshot());
  };
  const j = async (expr) => JSON.parse((await page.eval(expr)) || 'null');
  /** An element in the strip's shadow root, in page px (its box and middle), or null when hidden. */
  const inStrip = async (sel) => j(`(() => { const o = document.querySelector('iframe').getBoundingClientRect();
    const b = ${ROOT}.querySelector(${JSON.stringify(sel)});
    if (!b || b.hidden || !b.getBoundingClientRect().width) return null; const r = b.getBoundingClientRect();
    return JSON.stringify({ x: o.left + r.left + r.width / 2, y: o.top + r.top + r.height / 2, l: o.left + r.left, t: o.top + r.top, w: r.width, h: r.height }); })()`);
  const strip = () => inStrip('.row');
  const menuOpen = async () => j(`(() => { const m = ${ROOT}.querySelector('.menu'); return JSON.stringify(m.style.display !== 'none' && m.children.length > 0
    ? [...m.children].map((b) => b.dataset.studioChoice + (b.getAttribute('aria-checked') === 'true' ? '*' : '')) : null); })()`);
  const pressed = async () => j(`JSON.stringify([...${ROOT}.querySelectorAll('[data-studio-handle]')].filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.dataset.studioHandle))`);
  const picture = (k) => page.eval(`${ROOT}.querySelector('[data-studio-handle=${k}] > svg').innerHTML`);
  const tap = async (pt) => (mobile ? page.tap(pt.x, pt.y) : page.click(pt.x, pt.y));
  /** Hold a press on `pt` for `ms` without moving, then let go. */
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
  const escape = async (where) => {
    // 'game': the game frame has focus; 'shell': the editor page has focus.
    if (where === 'game') await page.eval(`document.querySelector('iframe').contentWindow.focus()`);
    else await page.eval(`(document.activeElement?.blur?.(), document.querySelector('iframe').blur(), window.focus(), document.body.focus())`);
    await sleep(100);
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await sleep(250);
  };
  /** The strip must not have moved by 1 px (W1-2): same left / top / width / height as `ref`. */
  const still = async (ref, when) => {
    const r = await strip();
    assert.ok(r, `${when}: the strip is gone`);
    for (const k of ['l', 't', 'w', 'h']) assert.ok(Math.abs(r[k] - ref[k]) < 0.5, `${when}: the strip moved (${k} ${ref[k]} → ${r[k]})`);
  };
  /** The ▾ is inside its button's box, in the bottom-right quarter. */
  const inCorner = (more, btn) => more.l >= btn.l - 0.5 && more.t >= btn.t - 0.5 && more.l + more.w <= btn.l + btn.w + 0.5 && more.t + more.h <= btn.t + btn.h + 0.5
    && more.x > btn.x && more.y > btn.y;
  try {
    await page.goto(srv.url);
    await page.waitFor(`document.querySelectorAll('.obj').length > 0 && !!${DBG}`, 90000);
    await sleep(1500);
    const items = await j(`JSON.stringify(${DBG}.list())`);
    const one = three ? 'lighthouse' : items.find((i) => i.rotatable && i.scalable).key;
    const many = [one, ...items.filter((i) => i.key !== one && i.scalable).slice(0, 1).map((i) => i.key)];
    await page.eval(`window.studioShell.actions.select(${JSON.stringify(one)})`);
    await sleep(1200);
    const s0 = await strip();
    assert.ok(s0, 'no strip under the picked object');
    await shot('1-picked');

    // ---- where the ▾ shows ----
    const turnBtn = await inStrip('[data-studio-handle=rotate]');
    const sizeBtn = await inStrip('[data-studio-handle=scale]');
    assert.ok(turnBtn && sizeBtn, 'no turn / size button');
    if (mobile) for (const b of [turnBtn, sizeBtn]) assert.ok(b.w >= 44 && b.h >= 44, `a phone button is ${b.w}×${b.h} (44 or more)`);
    const turnMore = await inStrip('[data-studio-handle=rotate] .more');
    if (three) {
      assert.ok(turnMore, 'no ▾ on the 3D turn button');
      assert.ok(inCorner(turnMore, turnBtn), `the ▾ is not in the turn button's bottom-right corner: ${JSON.stringify({ turnMore, turnBtn })}`);
      ok(`▾ on Turn (${turnMore.w}×${turnMore.h} in the corner of the ${turnBtn.w}×${turnBtn.h} button)`);
    } else {
      assert.equal(turnMore, null, '2D turn has no choices, but its button has a ▾');
      ok('no ▾ on 2D Turn');
    }
    assert.equal(await inStrip('[data-studio-handle=scale] .more'), null, 'size with one picked has no choices, but its button has a ▾');
    ok('no ▾ on Size with one picked');

    // ---- PC: hovering the button lights the ▾ ----
    if (!mobile && three) {
      const op = () => page.eval(`getComputedStyle(${ROOT}.querySelector('[data-studio-handle=rotate] .more')).opacity`);
      const rest = Number(await op());
      await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: turnBtn.x, y: turnBtn.y });
      await sleep(300);
      const lit = Number(await op());
      assert.ok(lit > rest, `hovering the turn button did not light its ▾ (${rest} → ${lit})`);
      ok(`hover lights the ▾ (${rest} → ${lit})`);
      await shot('2-hover');
    }

    // ---- one tap on the turn button: the tool, no choices; the strip stays put through every tool ----
    for (const k of three ? ['lift', 'scale', 'move', 'rotate'] : ['scale', 'move', 'rotate']) {
      await tap(await inStrip(`[data-studio-handle=${k}]`));
      await sleep(250);
      assert.deepEqual(await pressed(), [k], `after a tap on ${k}`);
      assert.equal(await menuOpen(), null, `a tap on ${k} opened choices`);
      await still(s0, `after choosing ${k}`);
    }
    ok('one tap chooses each tool, no choices open, the strip does not move');

    if (three) {
      // ---- one tap on the ▾: the choices, the tool unchanged ----
      // Another tool first: a tap on the ▾ that landed on the button itself would then CHOOSE Turn (not open), so a
      // miss cannot pass through the unadvertised "second tap on the chosen button" shortcut.
      await tap(await inStrip('[data-studio-handle=move]'));
      await sleep(250);
      const pic0 = await picture('rotate');
      await tap(turnMore);
      await sleep(300);
      assert.deepEqual(await menuOpen(), ['axis:y*', 'axis:x', 'axis:z'], 'one tap on the ▾ did not open the turn choices');
      assert.deepEqual(await pressed(), ['move'], 'the tap on the ▾ changed the tool');
      await still(s0, 'with the choices open');
      await shot('3-turn-options-open');
      ok('one tap on the ▾ opens Turn / Tilt forward / Tilt sideways');
      // A choice: it closes, its tool is chosen, the button wears its picture.
      await tap(await inStrip('[data-studio-choice="axis:x"]'));
      await sleep(300);
      assert.equal(await menuOpen(), null, 'the choices stayed open after a choice');
      assert.equal(await page.eval(`${ROOT}.querySelector('[data-studio-handle=rotate]').dataset.axis`), 'x');
      assert.deepEqual(await pressed(), ['rotate'], 'a choice did not choose Turn');
      const pic1 = await picture('rotate');
      assert.notEqual(pic1, pic0, 'the turn button kept its picture after Tilt forward was chosen');
      assert.deepEqual(await pressed(), ['rotate']);
      await still(s0, 'after Tilt forward was chosen');
      await shot('4-tilt-forward-chosen');
      // The button's picture is the one the choice had in the menu.
      await tap(turnMore);
      await sleep(300);
      const menuPic = await page.eval(`${ROOT}.querySelector('[data-studio-choice="axis:x"] > svg').innerHTML`);
      assert.equal(pic1, menuPic, 'the turn button does not wear the menu\'s Tilt forward picture');
      ok('a choice closes the menu and the button wears its picture');
      // Escape in the game closes the choices, keeps the tool.
      await escape('game');
      assert.equal(await menuOpen(), null, 'Escape in the game did not close the choices');
      assert.deepEqual(await pressed(), ['rotate'], 'Escape (choices open) also dropped the tool');
      // Escape in the editor page.
      await tap(turnMore);
      await sleep(300);
      assert.ok(await menuOpen(), 'the ▾ did not open the choices again');
      await escape('shell');
      assert.equal(await menuOpen(), null, 'Escape in the editor page did not close the choices');
      assert.deepEqual(await pressed(), ['rotate'], 'Escape in the editor page (choices open) also dropped the tool');
      // A press in the editor page (the ask box / the card): outside.
      await tap(turnMore);
      await sleep(300);
      assert.ok(await menuOpen());
      const outside = await j(`(() => { const e = [...document.querySelectorAll('.card:not([hidden]) .card-title, .card:not([hidden]), textarea, input')].find((x) => x.offsetParent && x.getBoundingClientRect().width > 20);
        if (!e) return 'null'; const r = e.getBoundingClientRect(); return JSON.stringify({ x: r.left + Math.min(20, r.width / 2), y: r.top + r.height / 2 }); })()`);
      assert.ok(outside, 'no place in the editor page to press');
      await tap(outside);
      await sleep(300);
      assert.equal(await menuOpen(), null, 'a press in the editor page did not close the choices');
      await still(s0, 'after the choices closed');
      ok('Escape (game and editor page) and a press outside close the choices, the tool stays');
      // A long press on the button opens them too (and changes nothing).
      await escape('game'); // drop the tool: the long press must not need it
      await page.eval(`document.activeElement?.blur?.()`);
      const pose0 = JSON.stringify((await j(`JSON.stringify(${DBG}.list())`)).find((i) => i.key === one).pose);
      await hold(turnBtn, 700);
      assert.deepEqual(await menuOpen(), ['axis:y', 'axis:x*', 'axis:z'], 'a long press on Turn did not open its choices');
      assert.equal(JSON.stringify((await j(`JSON.stringify(${DBG}.list())`)).find((i) => i.key === one).pose), pose0, 'the long press changed the object');
      await still(s0, 'after the long press');
      ok('a long press on Turn opens the choices');
      await tap(await inStrip('[data-studio-choice="axis:y"]'));
      await sleep(300);
      assert.equal(await picture('rotate'), pic0, 'back to Turn: the button did not get its own picture back');
      ok('back to Turn: the tool\'s own picture again');
    }

    // ---- several picked: the ▾ on Size ----
    await page.eval(`window.studioShell.actions.selectMany(${JSON.stringify(many)}, ${JSON.stringify(one)})`);
    await sleep(900);
    const g0 = await strip();
    assert.ok(g0, 'no strip for several');
    const sizeMore = await inStrip('[data-studio-handle=scale] .more');
    assert.ok(sizeMore, 'no ▾ on Size with several picked');
    assert.ok(inCorner(sizeMore, await inStrip('[data-studio-handle=scale]')), 'the size ▾ is not in its button\'s corner');
    assert.equal(await inStrip('[data-studio-handle=rotate] .more'), null, 'several turn upright only, but Turn has a ▾');
    // The ▾ first, with Size NOT chosen (a press that landed on the button would choose Size, not open).
    await tap(await inStrip('[data-studio-handle=move]'));
    await sleep(250);
    const spic0 = await picture('scale');
    await tap(sizeMore);
    await sleep(300);
    assert.deepEqual(await menuOpen(), ['scale:spread*', 'scale:inplace'], 'the ▾ on Size did not open Together / Each in place');
    assert.deepEqual(await pressed(), ['move'], 'the tap on the size ▾ changed the tool');
    await escape('game');
    assert.equal(await menuOpen(), null);
    // One tap on the button: Size, no choices.
    await tap(await inStrip('[data-studio-handle=scale]'));
    await sleep(300);
    assert.equal(await menuOpen(), null, 'one tap on Size (several) opened its choices');
    await tap(sizeMore);
    await sleep(300);
    assert.ok(await menuOpen(), 'the ▾ on Size did not open its choices again');
    await still(g0, 'with the size choices open');
    await shot('5-size-options-open');
    await tap(await inStrip('[data-studio-choice="scale:inplace"]'));
    await sleep(300);
    assert.equal(await menuOpen(), null);
    const spic1 = await picture('scale');
    assert.notEqual(spic1, spic0, 'the size button kept its picture after Each in place was chosen');
    assert.deepEqual(await pressed(), ['scale']);
    await still(g0, 'after Each in place was chosen');
    await shot('6-each-in-place-chosen');
    ok('several: ▾ on Size, one tap opens Together / Each in place, the button wears the choice');
    // Back to one: no ▾ on Size, its own picture.
    await page.eval(`window.studioShell.actions.select(${JSON.stringify(one)})`);
    await sleep(700);
    assert.equal(await inStrip('[data-studio-handle=scale] .more'), null, 'one picked again, but Size still has a ▾');
    assert.equal(await picture('scale'), spic0, 'one picked again, but Size still wears "each in place"');
    ok('one picked again: Size is plain');
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

for (const game of GAMES) for (const layout of LAYOUTS) for (const theme of THEMES) await run(game, layout, theme);
if (failed) {
  console.log(`studio-tool-options: ${failed} run(s) failed`);
  process.exit(1);
}
console.log('studio-tool-options: ok');
