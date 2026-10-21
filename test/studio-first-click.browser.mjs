// The first click selects (first-click pass, 2026-10-20 — a try of test demo v16: "I click the lighthouse and
// it isn't selected"; in a real Chrome the first click never selected, the second always did, while every headless
// test passed on the first).
//
//   node test/studio-first-click.browser.mjs [--dir <built web demo>] [--only pc,lp,2d,phone,side,glow] [--shots <dir>]
//
// Two ways a real first click was lost, each copied here the way a real browser does it (headless did neither):
//   - "late move": a real mouse can deliver the move that brought the cursor to the spot AFTER the press, with no
//     button in it. bridge/input.ts read that as a lost release and ended the press with no tap. The second click,
//     on the same spot, has no such move — so it worked. Here: mousePressed, then mouseMoved with buttons 0 on the
//     same spot, then mouseReleased.
//   - "while getting ready": the game draws a moment before the editor listens (bridge waits for objects, then the
//     editor page's core/edit). A click then went to the game and was gone. Here the editor page's core/edit is held
//     back (a script in each frame keeps it until the test lets it go), the click lands, then it is let go: the
//     object clicked is picked once the editor begins (bridge/early-press.ts).
// And one way that was suspected and does NOT lose it (kept as a guard): a page without the focus
// (Emulation.setFocusEmulationEnabled false — the first click then also brings the focus in).
//
// Where (each with the first click on its page):
//   pc     the demo's editor page, 1280×800, Lantern Cove: no focus; late move (then a drag still moves it); while getting ready
//   lp     the demo's front page with the editor in its frame: late move → picked and the editor in use
//   2d     the demo's editor page on Firefly Ruins: late move; while getting ready
//   phone  the demo's editor page at 390×844 with touch: a tap while getting ready; a plain first tap
//   side   the local studio in a chat's side window (400×900, mouse) on Lantern Cove: late move
//   glow   the local studio on Glow Garden (examples/three-hud; three.js from the CDN or STUDIO_CDN_CACHE): late move
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
const ONLY = (opt('--only') || 'pc,lp,2d,phone,side,glow').split(',');
let DIR = opt('--dir') ? resolve(opt('--dir')) : null;
if (!DIR) {
  DIR = join(mkdtempSync(join(tmpdir(), 'studio-first-click-')), 'site');
  execFileSync(process.execPath, [join(PKG, 'scripts/build-web-demo.mjs'), '--out', DIR], { stdio: 'inherit' });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Holds the editor page's core/edit (and every studio message after it, in order) in the game frame while
// top.__holdEdit is true; top.__letGo() hands them on. Runs in every frame before the page's own scripts, so its
// listener comes before the bridge's.
const HOLD = `(() => {
  if (window === top) {
    window.__holdEdit = true;
    window.__held = [];
    window.__letGo = () => { window.__holdEdit = false; for (const h of window.__held.splice(0)) h.w.dispatchEvent(new MessageEvent('message', { data: h.data, origin: h.origin, source: h.source })); };
    return;
  }
  let holding = false;
  addEventListener('message', (e) => {
    const d = e.data;
    if (!e.isTrusted || !d || typeof d.type !== 'string' || !d.type.startsWith('studio:')) return;
    if (!holding && !(d.type === 'studio:core/edit' && d.on && top.__holdEdit)) return;
    if (!top.__holdEdit) return;
    holding = true;
    e.stopImmediatePropagation();
    top.__held.push({ w: window, data: d, origin: e.origin, source: e.source });
  }, true);
})();`;


// ----- helpers -----

/** The game frame of an editor page (`frame` = an expression for the editor page's document, default this page's). */
const gameOf = (doc = 'document') => `(${doc}.querySelector('iframe.game') || ${doc}.querySelector('iframe'))`;
const editorReady = (doc = 'document') => `${doc}.querySelectorAll('.obj').length > 0 && !!${gameOf(doc)}?.contentWindow.__gameStudio?._debug`;

/**
 * Something to click on this editor page: the first of `order` (else any listed object) whose middle is on screen,
 * small (not the ground) and right under that point. → { key, x, y } in this page's coordinates.
 * `frame` = an expression for the iframe element holding the editor page (the front page's), or null.
 */
async function target(page, order = [], frame = null) {
  const doc = frame ? `${frame}.contentDocument` : 'document';
  // The game's place on the page first holds still: the editor's panels settle for about a second after the list
  // shows (the game frame moved 42 px to the left then), and a point measured before that is off the object.
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
    const named = ${JSON.stringify(order)}, list = d.list();
    for (const k of [...named, ...list.map((i) => i.key)]) {
      const a = d.anchor(k);
      if (!a || !a.visible || !a.rect || k === 'ground' || list.find((i) => i.key === k)?.backdrop) continue;
      const [x, y] = a.center;
      if (x < 40 || y < 60 || x > gr.width - 80 || y > gr.height - 60) continue;
      // Not a ground or a sky (any of them, unnamed): its box is a fifth of the game or less. A named one may be bigger
      // (the lighthouse's box takes its light beam in).
      if (!named.includes(k) && a.rect.w * a.rect.h > gr.width * gr.height * 0.2) continue;
      if (d.under(x, y) !== k) continue;
      return JSON.stringify({ key: k, x: off.left + gr.left + x, y: off.top + gr.top + y });
    }
    return 'null';
  })()`);
  const t = JSON.parse(r);
  if (!t) throw new Error('nothing small on screen to click');
  return t;
}

/** A real mouse's first click: the cursor's move arrives after the press, with no button in it (see the header). */
async function lateMoveClick(page, x, y) {
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x - 180, y: y + 140 });
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 });
  await sleep(90);
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
}

async function shot(page, file) {
  if (SHOTS) writeFileSync(join(SHOTS, file), await page.screenshot());
}

/** A fresh page (its own tab) with the editor's core/edit held back, opened on `url`; resolves once the game drew. */
async function heldPage(size, url) {
  const page = await newPage(browser, size);
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: HOLD });
  await page.goto(url);
  // The game drew and the bridge made its editor (it asked for core/edit), but the editor page's answer is held.
  await page.waitFor(`!!${gameOf()}?.contentWindow.__gameStudio?._debug && window.__held.length > 0`, 90000);
  await sleep(600);
  assert.equal(await page.eval(`document.querySelectorAll('.obj').length`), 0, 'the list showed while core/edit was held');
  return page;
}

/** The click (or tap) lands while the editor is held; nothing is picked yet; let go → `key` is picked. */
async function whileGettingReady(page, t, how, label) {
  if (how === 'tap') await page.tap(t.x, t.y);
  else await page.click(t.x, t.y);
  await sleep(500);
  assert.equal(await page.eval('window.studioShell.selected()'), null, `${label}: picked before the editor began`);
  await shot(page, `${label}-1-held.png`);
  await page.eval('window.__letGo()');
  await page.waitFor(editorReady(), 30000);
  await sleep(1200);
  await shot(page, `${label}-2-ready.png`);
  assert.equal(await page.eval('window.studioShell.selected()'), t.key, `${label}: the ${how} on "${t.key}" while the editor got ready was lost`);
}

// ----- pc: the demo's editor page -----
async function runPc() {
  const step = (s) => console.log(`  ✓ pc: ${s}`);
  const url = `${host.url}studio/?game=lantern-cove`;
  const size = { width: 1280, height: 800 };
  let t;
  {
    // No focus: the page has not been given it (a real window that was not the front one).
    const page = await newPage(browser, size);
    try {
      await page.send('Emulation.setFocusEmulationEnabled', { enabled: false });
      await page.goto(url);
      await page.waitFor(editorReady(), 90000);
      await sleep(1500);
      t = await target(page, ['lighthouse']);
      await page.click(t.x, t.y);
      await sleep(600);
      assert.equal(await page.eval('window.studioShell.selected()'), t.key, `no focus: the first click on "${t.key}" did not pick it`);
      step(`no focus: the first click on "${t.key}" picks it`);
    } finally {
      await page.close();
    }
  }
  {
    const page = await newPage(browser, size);
    try {
      await page.goto(url);
      await page.waitFor(editorReady(), 90000);
      await sleep(1500);
      t = await target(page, ['lighthouse']);
      await lateMoveClick(page, t.x, t.y);
      await sleep(600);
      await shot(page, 'pc-late-move.png');
      assert.equal(await page.eval('window.studioShell.selected()'), t.key, `late move: the first click on "${t.key}" did not pick it`);
      // The same on a drag: a late no-button move at the press must not end it either.
      const G = gameOf();
      const pose = () => page.eval(`JSON.stringify(${G}.contentWindow.__gameStudio._debug.list().find((i) => i.key === ${JSON.stringify(t.key)}).pose.p)`);
      const before = JSON.parse(await pose());
      await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: t.x, y: t.y, button: 'left', buttons: 1, clickCount: 1 });
      await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: t.x, y: t.y, button: 'none', buttons: 0 });
      for (let i = 1; i <= 10; i++) await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: t.x - i * 6, y: t.y + i * 2, button: 'left', buttons: 1 });
      await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: t.x - 60, y: t.y + 20, button: 'left', buttons: 0, clickCount: 1 });
      await sleep(600);
      const after = JSON.parse(await pose());
      assert.ok(Math.hypot(...after.map((v, i) => v - before[i])) > 0.1, `late move: a drag on "${t.key}" did not move it`);
      step(`late move: the first click on "${t.key}" picks it; a drag with the same late move moves it`);
    } finally {
      await page.close();
    }
  }
  {
    const page = await heldPage(size, url);
    try {
      await whileGettingReady(page, t, 'click', 'pc-ready');
      step(`while getting ready: the click on "${t.key}" picks it once the editor begins`);
    } finally {
      await page.close();
    }
  }
}

// ----- lp: the front page with the editor in its frame -----
async function runLp() {
  const step = (s) => console.log(`  ✓ lp: ${s}`);
  const page = await newPage(browser, { width: 1280, height: 800 });
  const EF = `document.querySelector('#stage iframe')`;
  try {
    await page.goto(`${host.url}index.html`);
    await page.waitFor(`document.querySelectorAll('a.sample').length === 2`);
    await page.eval(`window.scrollTo(0, document.getElementById('try').getBoundingClientRect().top + scrollY - 24)`);
    await page.waitFor(`!!${EF} && ${editorReady(`${EF}.contentDocument`)}`, 90000);
    await sleep(1500);
    const t = await target(page, ['lighthouse'], EF);
    await lateMoveClick(page, t.x, t.y);
    await sleep(700);
    await shot(page, 'lp-late-move.png');
    assert.equal(await page.eval(`${EF}.contentWindow.studioShell.selected()`), t.key, `late move: the first click on "${t.key}" in the front page's editor did not pick it`);
    assert.equal(await page.eval(`document.getElementById('stage').classList.contains('active')`), true, 'the first click did not put the editor in use');
    step(`late move: the first click on "${t.key}" picks it and the editor is in use`);
  } finally {
    await page.close();
  }
}

// ----- 2d: Firefly Ruins -----
async function run2d() {
  const step = (s) => console.log(`  ✓ 2d: ${s}`);
  const url = `${host.url}studio/?game=firefly-ruins`;
  const size = { width: 1280, height: 800 };
  let t;
  {
    const page = await newPage(browser, size);
    try {
      await page.goto(url);
      await page.waitFor(editorReady(), 90000);
      await sleep(1500);
      t = await target(page);
      await lateMoveClick(page, t.x, t.y);
      await sleep(600);
      await shot(page, '2d-late-move.png');
      assert.equal(await page.eval('window.studioShell.selected()'), t.key, `late move: the first click on "${t.key}" did not pick it`);
      step(`late move: the first click on "${t.key}" picks it`);
    } finally {
      await page.close();
    }
  }
  {
    // Getting ready on a PC: the 2D view opens with everything in frame, a different picture from the game's own —
    // the tap is read on the picture it was made on (before that), so it still picks what was under it then.
    const page = await heldPage(size, url);
    try {
      const g = await page.eval(`JSON.stringify(${gameOf()}.getBoundingClientRect())`).then(JSON.parse);
      // Before begin the debug peek reads the game's own picture: find the target there.
      const t0 = await target(page, [t.key]).catch(() => null);
      if (!t0) throw new Error(`"${t.key}" is not clickable on the game's own picture (before the editor began); size ${g.width}×${g.height}`);
      await whileGettingReady(page, t0, 'click', '2d-ready');
      step(`while getting ready: the click on "${t0.key}" picks it once the editor begins (the view then frames everything)`);
    } finally {
      await page.close();
    }
  }
}

// ----- phone: touch -----
async function runPhone() {
  const step = (s) => console.log(`  ✓ phone: ${s}`);
  const url = `${host.url}studio/?game=lantern-cove`;
  const size = { width: 390, height: 844, mobile: true };
  let t;
  {
    const page = await newPage(browser, size);
    try {
      await page.goto(url);
      await page.waitFor(editorReady(), 90000);
      await sleep(1500);
      t = await target(page, ['lighthouse', 'sea-stack', 'sea-stack-small']);
      await page.tap(t.x, t.y);
      await sleep(600);
      assert.equal(await page.eval('window.studioShell.selected()'), t.key, `the first tap on "${t.key}" did not pick it`);
      step(`the first tap on "${t.key}" picks it`);
    } finally {
      await page.close();
    }
  }
  {
    const page = await heldPage(size, url);
    try {
      await whileGettingReady(page, t, 'tap', 'phone-ready');
      step(`while getting ready: the tap on "${t.key}" picks it once the editor begins`);
    } finally {
      await page.close();
    }
  }
}

// ----- side / glow: the local studio -----
async function local(gameDir, size, label, order) {
  const root = mkdtempSync(join(tmpdir(), `studio-first-click-${label}-`));
  cpSync(gameDir, root, { recursive: true });
  mkdirSync(join(root, '.studio/ui'), { recursive: true });
  writeFileSync(join(root, '.studio/ui/prefs.json'), JSON.stringify({ version: 1, lang: 'en', theme: 'dark' }));
  const srv = await startStudioServer({ root, uiDir: join(PKG, 'skills/arrange/bin/studio-ui'), log: () => {} });
  const page = await newPage(browser, { ...size, cdnCache: process.env.STUDIO_CDN_CACHE });
  try {
    await page.goto(srv.url);
    await page.waitFor(editorReady(), 90000);
    await sleep(1500);
    const t = await target(page, order);
    await lateMoveClick(page, t.x, t.y);
    await sleep(600);
    await shot(page, `${label}-late-move.png`);
    assert.equal(await page.eval('window.studioShell.selected()'), t.key, `late move: the first click on "${t.key}" did not pick it`);
    return t;
  } finally {
    await page.close();
    await srv.close?.();
    rmSync(root, { recursive: true, force: true });
  }
}
async function runSide() {
  const t = await local(join(PKG, 'starters/lantern-cove'), { width: 400, height: 900 }, 'side', ['lighthouse', 'sea-stack']);
  console.log(`  ✓ side: late move: the first click on "${t.key}" in the 400×900 side window picks it`);
}
async function runGlow() {
  const t = await local(join(PKG, 'examples/three-hud'), { width: 1280, height: 800 }, 'glow', []);
  console.log(`  ✓ glow: late move: the first click on "${t.key}" in Glow Garden picks it`);
}

// ----- run -----
let failed = false;
const browser = await launch();
const host = await startHost({ dir: DIR });
try {
  for (const [name, fn] of [['pc', runPc], ['lp', runLp], ['2d', run2d], ['phone', runPhone], ['side', runSide], ['glow', runGlow]]) {
    if (!ONLY.includes(name)) continue;
    try {
      await fn();
    } catch (e) {
      failed = true;
      console.log(`  ✗ ${name}: ${e.message.split('\n')[0]} (${(/studio-first-click\.browser\.mjs:(\d+)/.exec(e.stack || '') || [])[1] || '?'})`);
    }
  }
} finally {
  await browser.close();
  await host.close();
}
if (failed) process.exit(1);
console.log('first click: all passed');
