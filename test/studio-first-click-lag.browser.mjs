// The click selects what was clicked, at once — never one click late (first-click pass 2, 2026-10-20 — a try of test
// demo v17 in a real Chrome 152, Mac, Retina: the editor page open 6 s, click the sailboat → nothing picked; click the
// lighthouse → the SAILBOAT got picked. A listener on the game window saw only `lostpointercapture` (buttons 0)).
//
//   node test/studio-first-click-lag.browser.mjs [--dir <built web demo>] [--only pc,lp,2d,phone,side] [--shots <dir>]
//
// headless always hands the release to the game frame as a pointerup, so it never saw this. Here a script in each frame
// (before the page's own) changes how the release reaches the game window, the ways a real Chrome can:
//   late    the pointerup is held back and handed on just before the NEXT press (the lostpointercapture still comes at
//           once; the click / mouseup do not). With bridge/input.ts reading only pointerup, the press stayed open and
//           the late pointerup tapped it on the next press: the previous object, one click late — what the try saw.
//   parent  the pointerup goes to the page above the game frame (the editor page), nothing to the game window.
//   swap    the first release is lost altogether and the next press too; only the next release comes. It must not
//           tap the first press (that is "the other object picked"); it picks what was let go on. (The first click
//           picks nothing here: no sign of its release ever comes.)
// Each: click the sailboat, then the lighthouse (two different objects); after each click the one clicked is picked.
//
// Where:
//   pc     the demo's editor page, 1280×800, Lantern Cove: late (a jump click and a click with its move), parent, swap
//   lp     the demo's front page with the editor in its frame: late, parent (two pages up)
//   2d     the demo's editor page on Firefly Ruins: late
//   phone  the demo's editor page at 390×844 with touch: late (taps)
//   side   the local studio in a chat's side window (400×900, mouse) on Lantern Cove: late
// Exit 1 on failure.
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
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const SHOTS = opt('--shots') ? resolve(opt('--shots')) : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const ONLY = (opt('--only') || 'pc,lp,2d,phone,side').split(',');
let DIR = opt('--dir') ? resolve(opt('--dir')) : null;
if (!DIR) {
  DIR = join(mkdtempSync(join(tmpdir(), 'studio-first-click-lag-')), 'site');
  execFileSync(process.execPath, [join(PKG, 'scripts/build-web-demo.mjs'), '--out', DIR], { stdio: 'inherit' });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The release's way to the game window (see the header). Runs in every frame before the page's own scripts, so its
// capture listeners on window come before the bridge's; it acts only in the game frame (the one with the bridge).
const LOSE = (mode) => `(() => {
  const MODE = ${JSON.stringify(mode)};
  if (window === top) return;
  const game = () => !!window.__gameStudio;
  let held = null, ups = 0, dropDown = false;
  const kill = (e) => e.stopImmediatePropagation();
  addEventListener('pointerup', (e) => {
    if (!e.isTrusted || !game()) return;
    kill(e);
    const init = { bubbles: true, cancelable: true, composed: true, pointerId: e.pointerId, pointerType: e.pointerType, isPrimary: e.isPrimary, button: e.button, buttons: 0 };
    if (MODE === 'late') held = { ...init, clientX: e.clientX, clientY: e.clientY };
    else if (MODE === 'parent') {
      const f = frameElement.getBoundingClientRect();
      parent.document.dispatchEvent(new PointerEvent('pointerup', { ...init, clientX: f.left + e.clientX, clientY: f.top + e.clientY }));
    } else if (MODE === 'swap' && ++ups === 1) dropDown = true;
    else if (MODE === 'swap') dispatchEvent(new PointerEvent('pointerup', { ...init, clientX: e.clientX, clientY: e.clientY }));
  }, true);
  addEventListener('pointerdown', (e) => {
    if (!e.isTrusted || !game()) return;
    if (held) {
      const h = held;
      held = null;
      dispatchEvent(new PointerEvent('pointerup', h));
    }
    if (dropDown) {
      dropDown = false;
      kill(e);
    }
  }, true);
  // The click / mouseup never come; the lostpointercapture comes only in 'late' (as the try saw); 'swap' also loses the
  // moves between the two clicks (else the move to the second object would end the first press: no wrong pick to test).
  const lost = ['click', 'mouseup', ...(MODE === 'late' ? [] : ['lostpointercapture'])];
  for (const t of lost) addEventListener(t, (e) => { if (e.isTrusted && game()) kill(e); }, true);
  if (MODE === 'swap') addEventListener('pointermove', (e) => { if (e.isTrusted && game() && e.buttons === 0) kill(e); }, true);
})();`;

const gameOf = (doc = 'document') => `(${doc}.querySelector('iframe.game') || ${doc}.querySelector('iframe'))`;
const editorReady = (doc = 'document') => `${doc}.querySelectorAll('.obj').length > 0 && !!${gameOf(doc)}?.contentWindow.__gameStudio?._debug`;

/**
 * Two different objects to click on this editor page, `order` first (else any listed): each with its middle on
 * screen, small (not the ground) and right under that point. → [{ key, x, y }, …] in this page's coordinates.
 * `frame` = an expression for the iframe holding the editor page (the front page's), or null.
 */
async function targets(page, order = [], frame = null) {
  const doc = frame ? `${frame}.contentDocument` : 'document';
  // The game's place holds still first (the editor's panels settle for about a second after the list shows).
  const where = `(() => { const f = ${frame || 'null'}, g = ${gameOf(doc)}; const a = f ? f.getBoundingClientRect() : { left: 0, top: 0 }, b = g.getBoundingClientRect();
    return [a.left + b.left, a.top + b.top, b.width, b.height].map(Math.round).join(); })()`;
  for (let last = '', same = 0, end = Date.now() + 10000; same < 3 && Date.now() < end; await sleep(200)) {
    const now = await page.eval(where);
    same = now === last ? same + 1 : 0;
    last = now;
  }
  const r = await page.eval(`(() => {
    const f = ${frame || 'null'}, g = ${gameOf(doc)}, d = g.contentWindow.__gameStudio._debug;
    const off = f ? f.getBoundingClientRect() : { left: 0, top: 0 }, gr = g.getBoundingClientRect();
    const named = ${JSON.stringify(order)}, list = d.list(), out = [];
    for (const k of [...new Set([...named, ...list.map((i) => i.key)])]) {
      const a = d.anchor(k);
      if (!a || !a.visible || !a.rect || k === 'ground' || list.find((i) => i.key === k)?.backdrop) continue;
      const [x, y] = a.center;
      if (x < 40 || y < 60 || x > gr.width - 80 || y > gr.height - 60) continue;
      if (!named.includes(k) && a.rect.w * a.rect.h > gr.width * gr.height * 0.2) continue;
      if (d.under(x, y) !== k) continue;
      out.push({ key: k, x: off.left + gr.left + x, y: off.top + gr.top + y });
      if (out.length === 2) break;
    }
    return JSON.stringify(out);
  })()`);
  const t = JSON.parse(r);
  if (t.length < 2) throw new Error('not two small objects on screen to click');
  return t;
}

async function shot(page, file) {
  if (SHOTS) writeFileSync(join(SHOTS, file), await page.screenshot());
}

/**
 * Click (or tap) a, then b; what is picked after each. Fails with both answers, so a lag reads as
 * "after a: null, after b: a".
 */
async function twoClicks(page, [a, b], { how = 'click', selected = 'window.studioShell.selected()', label, firstLost = false }) {
  // 'jump': the cursor is just there (no move to the spot first), as an automated click in a real Chrome can be. With no
  // no-button move between the two clicks, nothing else ends the first press: a late release then lands on the next.
  const jump = async (t) => {
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: t.x, y: t.y, button: 'left', buttons: 1, clickCount: 1 });
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: t.x, y: t.y, button: 'left', buttons: 0, clickCount: 1 });
  };
  const press = (t) => (how === 'tap' ? page.tap(t.x, t.y) : how === 'jump' ? jump(t) : page.click(t.x, t.y));
  const before = await page.eval(selected);
  assert.equal(before, null, `${label}: "${before}" was picked before any click`);
  await press(a);
  await sleep(700);
  const first = await page.eval(selected);
  await shot(page, `${label}-1.png`);
  await press(b);
  await sleep(700);
  const second = await page.eval(selected);
  await shot(page, `${label}-2.png`);
  const said = `after the ${how} on "${a.key}": ${first}; after the ${how} on "${b.key}": ${second}`;
  // firstLost ('swap'): the first release never comes in any form, so nothing can pick a then; b must still be b, not a.
  assert.ok((first === a.key || (firstLost && first === null)) && second === b.key, `${label}: ${said}`);
  return said;
}

/** A fresh page with the release's way changed (`mode`), on `url`, editor ready. */
async function losePage(size, url, mode) {
  const page = await newPage(browser, size);
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: LOSE(mode) });
  await page.goto(url);
  return page;
}

// ----- pc: the demo's editor page -----
async function runPc() {
  const url = `${host.url}studio/?game=lantern-cove`;
  for (const [mode, how] of [['late', 'jump'], ['late', 'click'], ['parent', 'click'], ['swap', 'click']]) {
    const page = await losePage({ width: 1280, height: 800 }, url, mode);
    try {
      await page.waitFor(editorReady(), 90000);
      await sleep(1500);
      const t = await targets(page, ['sailboat', 'lighthouse']);
      console.log(`  ✓ pc ${mode} ${how}: ${await twoClicks(page, t, { how, label: `pc-${mode}-${how}`, firstLost: mode === 'swap' })}`);
    } catch (e) {
      fail(`pc ${mode} ${how}`, e);
    } finally {
      await page.close();
    }
  }
}

// ----- lp: the front page with the editor in its frame (the game two pages down) -----
async function runLp() {
  const EF = `document.querySelector('#stage iframe')`;
  for (const mode of ['late', 'parent']) {
    const page = await losePage({ width: 1280, height: 800 }, `${host.url}index.html`, mode);
    try {
      await page.waitFor(`document.querySelectorAll('a.sample').length === 2`);
      await page.eval(`window.scrollTo(0, document.getElementById('try').getBoundingClientRect().top + scrollY - 24)`);
      await page.waitFor(`!!${EF} && ${editorReady(`${EF}.contentDocument`)}`, 90000);
      await sleep(1500);
      const t = await targets(page, ['sailboat', 'lighthouse'], EF);
      console.log(`  ✓ lp ${mode}: ${await twoClicks(page, t, { label: `lp-${mode}`, selected: `${EF}.contentWindow.studioShell.selected()` })}`);
    } catch (e) {
      fail(`lp ${mode}`, e);
    } finally {
      await page.close();
    }
  }
}

// ----- 2d: Firefly Ruins -----
async function run2d() {
  const page = await losePage({ width: 1280, height: 800 }, `${host.url}studio/?game=firefly-ruins`, 'late');
  try {
    await page.waitFor(editorReady(), 90000);
    await sleep(1500);
    const t = await targets(page);
    console.log(`  ✓ 2d late: ${await twoClicks(page, t, { label: '2d-late' })}`);
  } finally {
    await page.close();
  }
}

// ----- phone: touch -----
async function runPhone() {
  const page = await losePage({ width: 390, height: 844, mobile: true }, `${host.url}studio/?game=lantern-cove`, 'late');
  try {
    await page.waitFor(editorReady(), 90000);
    await sleep(1500);
    const t = await targets(page, ['lighthouse', 'sailboat', 'sea-stack', 'sea-stack-small']);
    console.log(`  ✓ phone late: ${await twoClicks(page, t, { how: 'tap', label: 'phone-late' })}`);
  } finally {
    await page.close();
  }
}

// ----- side: the local studio in a chat's side window -----
async function runSide() {
  const root = mkdtempSync(join(tmpdir(), 'studio-first-click-lag-side-'));
  cpSync(join(PKG, 'starters/lantern-cove'), root, { recursive: true });
  mkdirSync(join(root, '.studio/ui'), { recursive: true });
  writeFileSync(join(root, '.studio/ui/prefs.json'), JSON.stringify({ version: 1, lang: 'en', theme: 'dark' }));
  const srv = await startStudioServer({ root, uiDir: join(PKG, 'skills/arrange/bin/studio-ui'), log: () => {} });
  const page = await losePage({ width: 400, height: 900 }, srv.url, 'late');
  try {
    await page.waitFor(editorReady(), 90000);
    await sleep(1500);
    const t = await targets(page, ['sailboat', 'lighthouse', 'sea-stack']);
    console.log(`  ✓ side late: ${await twoClicks(page, t, { label: 'side-late' })}`);
  } finally {
    await page.close();
    await srv.close?.();
    rmSync(root, { recursive: true, force: true });
  }
}

// ----- run -----
let failed = false;
// One mode failing does not stop the others (a run before the fix shows every way at once).
function fail(name, e) {
  failed = true;
  console.log(`  ✗ ${name}: ${e.message.split('\n')[0]} (${(/studio-first-click-lag\.browser\.mjs:(\d+)/.exec(e.stack || '') || [])[1] || '?'})`);
}
const browser = await launch();
const host = await startHost({ dir: DIR });
try {
  for (const [name, fn] of [['pc', runPc], ['lp', runLp], ['2d', run2d], ['phone', runPhone], ['side', runSide]]) {
    if (!ONLY.includes(name)) continue;
    try {
      await fn();
    } catch (e) {
      fail(name, e);
    }
  }
} finally {
  await browser.close();
  await host.close();
}
if (failed) process.exit(1);
console.log('first click, never late: all passed');
