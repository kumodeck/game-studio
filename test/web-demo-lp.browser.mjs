// The web demo's front page with the editor in a frame (2026-10-19), in a headless browser, served the way
// KUMODeck's test version does (test/web-demo-host.mjs).
//
//   node test/web-demo-lp.browser.mjs [--dir <built folder>] [--shots <dir>] [--lang en|ja]
//
// Without --dir it builds into a temporary folder first (scripts/build-web-demo.mjs).
// PC 1280×800 with a mouse:
//   1. in a short window (1280×640) the page opens with no frame yet (the editor's stage is mostly below the fold);
//      the install line is INSTALL.md's
//   2. the window at 800 (a third of the stage in view: the editor peeks in on the first screen) → the frame loads the editor on Lantern Cove (studio/?game=…&embed=1), with no "← Samples" in it
//   3. the wheel over the editor, before it is clicked, scrolls the page (the "Click to use" layer is on top)
//   4. clicked → the editor has the keys: W flies the camera; ↓ / Space / Page Down / End don't move the page,
//      with nothing selected, with an object selected (↓ moves the object instead), and with the focus in the game
//   5. right-click on an object opens the editor's menu; a drag then ⌘Z puts it back; Save keeps it in this browser
//   6. a click outside gives the page back: ↓ scrolls the page again
//   7. the other sample swaps the frame's page; "Open full size" opens the same editor without the frame, with the save
// Phone 390×844 with touch:
//   8. no iframe anywhere on the page (scrolled to the bottom too); each sample is a card that opens the editor
// --shots: the page (whole, light and dark) and the editor being used, at both sizes.
// Exit 1 on failure.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, newPage } from './adapters-2d/cdp.mjs';
import { startHost } from './web-demo-host.mjs';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const SHOTS = opt('--shots') ? resolve(opt('--shots')) : null;
const LANG = opt('--lang') || 'en';
let DIR = opt('--dir') ? resolve(opt('--dir')) : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
if (!DIR) {
  DIR = join(mkdtempSync(join(tmpdir(), 'studio-web-demo-lp-')), 'site');
  execFileSync(process.execPath, [join(PKG, 'scripts/build-web-demo.mjs'), '--out', DIR], { stdio: 'inherit' });
}
const INSTALL_LINE = /```\n([^\n]+)\n```/.exec(readFileSync(join(PKG, 'INSTALL.md'), 'utf8'))[1];
const MOD = process.platform === 'darwin' ? 4 : 2; // ⌘ on a Mac, Ctrl elsewhere (CDP modifiers)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EF = `document.querySelector('#stage iframe')`;
const ED = `${EF}.contentDocument`;
const GF = `${ED}.querySelector('iframe.game')`;
const DBG = `${GF}.contentWindow.__gameStudio._debug`;
const READY = `!!${EF} && ${ED}?.querySelectorAll('.obj').length > 0 && !!${GF}?.contentWindow.__gameStudio?._debug`;
const KEYS = {
  ArrowDown: { code: 'ArrowDown', vk: 40 }, ArrowUp: { code: 'ArrowUp', vk: 38 }, ' ': { code: 'Space', vk: 32, text: ' ' },
  PageDown: { code: 'PageDown', vk: 34 }, End: { code: 'End', vk: 35 }, Escape: { code: 'Escape', vk: 27 },
  w: { code: 'KeyW', vk: 87, text: 'w' }, z: { code: 'KeyZ', vk: 90 },
};

const host = await startHost({ dir: DIR });
const base = host.url;
console.log(`web demo front page at ${base}`);
let failed = false;
const browser = await launch();
try {
  for (const [name, fn] of [['pc', runPc], ['phone', runPhone]]) {
    try {
      await fn();
    } catch (e) {
      failed = true;
      console.log(`  ✗ ${name}: ${e.message} (${(/web-demo-lp\.browser\.mjs:(\d+)/.exec(e.stack || '') || [])[1] || '?'})`);
    }
  }
} finally {
  await browser.close();
  await host.close();
}
if (failed) process.exit(1);
console.log('web demo front page: all passed');

/** The whole page as one picture (taller than the window). */
async function fullShot(page, file) {
  if (!SHOTS) return;
  const h = await page.eval('document.documentElement.scrollHeight');
  const w = await page.eval('document.documentElement.clientWidth');
  const r = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: w, height: h, scale: 1 } });
  writeFileSync(join(SHOTS, file), Buffer.from(r.data, 'base64'));
}
async function shot(page, file) {
  if (SHOTS) writeFileSync(join(SHOTS, file), await page.screenshot());
}
function theme(page, value) {
  return page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value }] });
}

async function runPc() {
  const page = await newPage(browser, { width: 1280, height: 800 });
  const step = (s) => console.log(`  ✓ pc: ${s}`);
  const j = async (expr) => JSON.parse((await page.eval(expr)) || 'null');
  const key = async (k, modifiers = 0) => {
    const d = KEYS[k];
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: d.code, windowsVirtualKeyCode: d.vk, text: modifiers ? undefined : d.text, modifiers });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: d.code, windowsVirtualKeyCode: d.vk, modifiers });
    await sleep(250);
  };
  const scrollY = () => page.eval('Math.round(scrollY)');
  // Where an object of the embedded game is on this page (frame in frame), and whether a press there gets it.
  const at = (k) => j(`(() => { const e = ${EF}.getBoundingClientRect(), g = ${GF}.getBoundingClientRect(), a = ${DBG}.anchor(${JSON.stringify(k)});
    if (!a || !a.visible) return 'null'; const x = a.center[0], y = a.center[1];
    return JSON.stringify({ x: e.left + g.left + x, y: e.top + g.top + y, under: ${DBG}.under(x, y) }); })()`);
  const poseOf = async (k) => (await j(`JSON.stringify(${DBG}.list())`)).find((i) => i.key === k)?.pose;
  const pick = async () => {
    for (const k of ['sea-stack', 'lighthouse', 'sea-stack-small']) {
      const p = await at(k);
      if (p && p.under === k) return { k, p };
    }
    throw new Error('none of sea-stack, lighthouse, sea-stack-small can be pressed in the embedded editor');
  };
  try {
    // --- 1. no frame before it is seen (a short window first) ---
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 640, deviceScaleFactor: 1, mobile: false });
    await page.goto(`${base}index.html?lang=${LANG}`);
    await page.waitFor(`document.querySelectorAll('a.sample').length === 2 && [...document.querySelectorAll('a.sample img')].every((i) => i.complete && i.naturalWidth > 0)`);
    await sleep(800);
    await shot(page, 'pc-light-1-top.png');
    const seen = await page.eval(`(() => { const r = document.getElementById('stage').getBoundingClientRect(); return Math.max(0, Math.min(innerHeight, r.bottom) - Math.max(0, r.top)) / r.height; })()`);
    assert.ok(seen < 0.25, `the editor's stage is ${(seen * 100).toFixed(0)}% on screen before any scroll (this step needs it below the fold)`);
    assert.equal(await page.eval(`document.querySelectorAll('iframe').length`), 0, 'an iframe is on the page before the stage was seen');
    assert.equal(await page.eval(`document.getElementById('cmd').textContent`), INSTALL_LINE, 'the install line is not INSTALL.md’s');
    assert.ok(await page.eval(`document.getElementById('repo').href.startsWith('https://github.com/')`), 'no GitHub link');
    assert.ok(await page.eval(`document.documentElement.scrollWidth <= innerWidth`), 'the page scrolls sideways');
    step(`opened with no iframe (${(seen * 100).toFixed(0)}% of the stage on screen); the install line is INSTALL.md’s`);

    // --- 2. seen → loaded ---
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await page.waitFor(`document.querySelectorAll('iframe').length === 1`, 5000);
    await shot(page, 'pc-light-1-top-800.png');
    step('the window at 800 → a third of the stage in view → the frame is made');
    await page.eval(`window.scrollTo(0, document.getElementById('try').getBoundingClientRect().top + scrollY - 24)`);
    await page.waitFor(READY, 90000);
    await page.waitFor(`document.getElementById('stage').classList.contains('ready')`);
    const src = await page.eval(`${EF}.getAttribute('src')`);
    assert.ok(/studio\/\?game=lantern-cove&embed=1/.test(src), `frame src: ${src}`);
    assert.equal(await page.eval(`!!${ED}.querySelector('.demo-back')`), false, 'the embedded editor has "← Samples"');
    assert.equal(await page.eval(`${ED}.body.classList.contains('studio-embed')`), true);
    await sleep(1500);
    step(`the frame loads ${src}`);

    // --- 3. the wheel before the click scrolls the page ---
    const stage = await j(`(() => { const r = document.getElementById('stage').getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2, top: r.top }); })()`);
    const y0 = await scrollY();
    await page.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: stage.x, y: stage.y, deltaX: 0, deltaY: 200 });
    await sleep(600);
    const y1 = await scrollY();
    assert.ok(y1 > y0 + 50, `the wheel over the editor (not clicked yet) did not scroll the page: ${y0} → ${y1}`);
    await page.eval(`window.scrollTo(0, ${y0})`);
    await sleep(400);
    step(`the wheel over the editor before a click scrolls the page (${y0} → ${y1})`);

    // --- 4. clicked → the keys are the editor's ---
    await page.click(stage.x, stage.y - 120);
    await sleep(400);
    assert.equal(await page.eval(`document.getElementById('stage').classList.contains('active') && document.activeElement === ${EF}`), true, 'a click did not hand the editor the keys');
    const hint = await page.eval(`document.getElementById('hint').textContent`);
    const view0 = JSON.stringify(await j(`JSON.stringify(${DBG}.view())`));
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'w', code: 'KeyW', windowsVirtualKeyCode: 87, text: 'w' });
    await sleep(500);
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'w', code: 'KeyW', windowsVirtualKeyCode: 87 });
    await sleep(300);
    assert.notEqual(JSON.stringify(await j(`JSON.stringify(${DBG}.view())`)), view0, 'W in the embedded editor did not move the camera');
    const yA = await scrollY();
    for (const k of ['ArrowDown', ' ', 'PageDown', 'End']) {
      await key(k);
      assert.equal(await scrollY(), yA, `"${k}" in the editor (nothing selected) scrolled the page`);
    }
    step(`clicked → "${hint}"; W flies; ↓ Space PageDown End leave the page where it is`);
    await shot(page, 'pc-light-2-clicked.png');

    // Selected (the press goes into the game frame, so the focus is there now): ↓ moves the object, not the page.
    const { k: obj, p } = await pick();
    await page.click(p.x, p.y);
    await sleep(600);
    assert.equal(await page.eval(`${EF}.contentWindow.studioShell.selected()`), obj, `a click on "${obj}" did not select it`);
    const before = await poseOf(obj);
    for (const k of ['ArrowDown', 'ArrowDown', ' ', 'PageDown']) {
      await key(k);
      assert.equal(await scrollY(), yA, `"${k}" with "${obj}" selected scrolled the page`);
    }
    const stepped = await poseOf(obj);
    assert.ok(JSON.stringify(stepped.p) !== JSON.stringify(before.p), `↓ did not move "${obj}"`);
    // Nothing selected again, the focus still in the game frame.
    await key('Escape');
    for (const k of ['ArrowDown', ' ', 'End']) {
      await key(k);
      assert.equal(await scrollY(), yA, `"${k}" with the focus in the game scrolled the page`);
    }
    step(`"${obj}" selected: ↓ moves it, the page stays; Esc then ↓ Space End: the page stays`);

    // --- 5. right-click, ⌘Z, Save ---
    const q = (await at(obj)) || p;
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: q.x, y: q.y });
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: q.x, y: q.y, button: 'right', buttons: 2, clickCount: 1 });
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: q.x, y: q.y, button: 'right', buttons: 0, clickCount: 1 });
    await page.waitFor(`!!${ED}.querySelector('.ctx-menu:not([hidden])')`, 5000);
    const rows = await page.eval(`${ED}.querySelectorAll('.ctx-menu:not([hidden]) .ctx-row').length`);
    await shot(page, 'pc-light-3-menu.png');
    await key('Escape');
    await page.waitFor(`!${ED}.querySelector('.ctx-menu:not([hidden])')`, 5000);
    assert.equal(await scrollY(), yA, 'the right-click menu moved the page');
    const q2 = (await at(obj)) || q;
    await page.click(q2.x, q2.y);
    await sleep(400);
    const b0 = await poseOf(obj);
    await page.mouseDrag(q2.x, q2.y, q2.x - 70, q2.y + 25, 10);
    await sleep(500);
    const dragged = await poseOf(obj);
    assert.ok(Math.hypot(...dragged.p.map((v, i) => v - b0.p[i])) > 0.1, `the drag did not move "${obj}"`);
    await key('z', MOD);
    await sleep(500);
    const undone = await poseOf(obj);
    assert.ok(Math.hypot(...undone.p.map((v, i) => v - b0.p[i])) < 1e-3, `⌘Z in the frame did not undo the drag: ${JSON.stringify({ b0: b0.p, undone: undone.p })}`);
    await page.mouseDrag(q2.x, q2.y, q2.x - 70, q2.y + 25, 10);
    await sleep(500);
    const kept = await poseOf(obj);
    await page.eval(`[...${ED}.querySelectorAll('[data-action=save]')].find((b) => b.offsetParent).click()`);
    // "Save · 2" → "✓ Saved": no count left on the button.
    await page.waitFor(`!/\\d\\s*$/.test([...${ED}.querySelectorAll('[data-action=save]')].find((b) => b.offsetParent)?.textContent ?? '')`, 5000);
    await sleep(800);
    step(`right-click → the menu (${rows} rows); a drag then ⌘Z → back; dragged again and saved`);
    await shot(page, 'pc-light-4-moved.png');

    // --- 6. a click outside gives the page back ---
    const out = await j(`(() => { const r = document.getElementById('tryTitle').getBoundingClientRect(); return JSON.stringify({ x: r.left + 4, y: r.top + r.height / 2 }); })()`);
    await page.click(out.x, out.y);
    await sleep(300);
    assert.equal(await page.eval(`document.getElementById('stage').classList.contains('active')`), false, 'a click outside left the editor active');
    const yB = await scrollY();
    await key('ArrowDown');
    await sleep(300);
    assert.ok((await scrollY()) > yB, 'after a click outside, ↓ does not scroll the page');
    step('a click outside → ↓ scrolls the page again');

    // --- 7. the other sample; open full size ---
    await page.eval(`window.scrollTo(0, document.getElementById('try').getBoundingClientRect().top + scrollY - 24)`);
    await page.eval(`document.querySelector('a.sample[data-game=firefly-ruins]').click()`);
    await page.waitFor(`${EF}.getAttribute('src').includes('game=firefly-ruins') && document.getElementById('stage').classList.contains('ready')`, 30000);
    await page.waitFor(READY, 60000);
    await sleep(1500);
    assert.equal(await page.eval(`document.querySelector('a.sample[data-game=firefly-ruins]').getAttribute('aria-selected')`), 'true');
    step('Firefly Ruins → the frame switches to it');
    await shot(page, 'pc-light-5-2d.png');
    await theme(page, 'dark');
    await sleep(400);
    await shot(page, 'pc-dark-5-2d.png');
    await page.eval('window.scrollTo(0, 0)');
    await sleep(300);
    await fullShot(page, 'pc-dark-page.png');
    await theme(page, 'light');
    await sleep(300);
    await fullShot(page, 'pc-light-page.png');

    await page.eval(`document.querySelector('a.sample[data-game=lantern-cove]').click()`);
    await page.waitFor(`${EF}.getAttribute('src').includes('game=lantern-cove')`);
    await page.eval(`document.getElementById('full').click()`);
    await page.waitFor(`location.pathname.endsWith('/studio/')`, 20000);
    await page.waitFor(`document.querySelectorAll('.obj').length > 0 && !!document.querySelector('iframe')?.contentWindow.__gameStudio?._debug`, 90000);
    await sleep(1500);
    assert.equal(await page.eval(`!!document.querySelector('.demo-back')`), true, 'the full-size editor has no "← Samples"');
    const full = (await j(`JSON.stringify(document.querySelector('iframe').contentWindow.__gameStudio._debug.list())`)).find((i) => i.key === obj).pose;
    assert.ok(Math.hypot(...full.p.map((v, i) => v - kept.p[i])) < 2e-3, `full size: "${obj}" at ${JSON.stringify(full.p)}, not the saved ${JSON.stringify(kept.p)}`);
    step(`"Open full size" → the editor without the frame, with "${obj}" where it was saved in the frame`);
    const errors = page.logs.filter((l) => /^(error|exception)/.test(l) && !/placement\.json|404/.test(l));
    assert.deepEqual(errors, [], 'page errors');
  } finally {
    await page.close();
  }
}

async function runPhone() {
  const page = await newPage(browser, { width: 390, height: 844, mobile: true });
  const step = (s) => console.log(`  ✓ phone: ${s}`);
  try {
    for (const t of ['light', 'dark']) {
      await theme(page, t);
      await page.goto(`${base}index.html?lang=${LANG}`);
      await page.waitFor(`document.querySelectorAll('a.sample').length === 2 && [...document.querySelectorAll('a.sample img')].every((i) => i.complete && i.naturalWidth > 0)`);
      await sleep(500);
      await shot(page, `phone-${t}-1-top.png`);
      // Scroll through the whole page, like a thumb: the frame must never be made.
      const h = await page.eval('document.documentElement.scrollHeight');
      for (let y = 0; y <= h; y += 400) {
        await page.eval(`window.scrollTo(0, ${y})`);
        await sleep(120);
      }
      await sleep(800);
      assert.equal(await page.eval(`document.querySelectorAll('iframe').length`), 0, 'an iframe on the phone page');
      assert.ok(await page.eval(`document.documentElement.scrollWidth <= innerWidth`), 'the phone page scrolls sideways');
      await page.eval('window.scrollTo(0, 0)');
      await sleep(300);
      await fullShot(page, `phone-${t}-page.png`);
    }
    step('no iframe on the page, top to bottom (light and dark); no sideways scroll');
    await theme(page, 'light');
    await page.eval(`document.querySelector('a.sample[data-game=firefly-ruins]').scrollIntoView({ block: 'center' })`);
    await sleep(300);
    const c = JSON.parse(await page.eval(`(() => { const r = document.querySelector('a.sample[data-game=firefly-ruins]').getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }); })()`));
    await page.tap(c.x, c.y);
    await page.waitFor(`location.pathname.endsWith('/studio/') && location.search.includes('game=firefly-ruins') && !location.search.includes('embed')`, 20000);
    await page.waitFor(`document.querySelectorAll('.obj').length > 0`, 90000);
    await sleep(1500);
    await shot(page, 'phone-light-2-editor.png');
    step('a tap on a card opens the editor on its own page');
  } finally {
    await page.close();
  }
}
