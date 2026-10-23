// Narrow widths (the side window next to a chat, phones): with an object picked, the object
// list must still read at a glance — a try on 2026-10-17: "in the side pane the object list
// becomes impossible to follow; same on a phone" (the sheet showed one row, sea-arch, under the
// Scene / Assets rows, "All actions", the picked object's card and the ask bar).
//
// For both starters (Lantern Cove 3D, Firefly Ruins 2D) at four sizes — 400×600 (the side window
// of that try), 400×900, 390×844, 430×932 — with touch, the real server and the built
// shell:
//   1. open the list sheet (the ask bar's list button)
//   2. pick an object from the middle of the list
//   3. measure: rows fully readable (inside the list's scroll box, above the card and the bar)
//      ≥ 5 (≥ 4 at 600 high, where the game must keep its share), the picked row among them,
//      the picked object's card still shown, and the game still seen above the sheet (≥ 24 %
//      of the screen height), with the picked object itself in that part
//   4. (with --shots) a picture before and after the pick
//
// Our own samples never show an adapter warning (Ive review N1 / W1-5, 2026-10-17): at these sizes and at the PC's
// 1280×800 every adapter self-check result passes and no status line is shown over the list. This was a "note"
// until then (the check's 32×32 copy of the canvas missed small moves on phones); now it fails the run.
//
// Firefly Ruins' pond mirrors what is moved (W1-10, findings M16): the urn and the bell are dragged with real
// mouse / touch input, and the water under where each was and where it went must both change on screen.
//
//   node test/studio-narrow.browser.mjs [--shots <dir>] [--only 400x600,390x844,1280x800] [--game lantern-cove] [--lang ja|en]
// Exit 1 on failure.
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStudioServer } from '../src/server/server.mjs';
import { launch, newPage } from './adapters-2d/cdp.mjs';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const SHOTS = opt('--shots') ? resolve(opt('--shots')) : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1280×800 (PC, no sheet): only the self-check and the reflection are checked there.
const SIZES = [[400, 600], [400, 900], [390, 844], [430, 932], [1280, 800]].filter(([w, h]) => !opt('--only') || opt('--only').split(',').includes(`${w}x${h}`));
// The picked object: one from the middle of each list, so "where am I in the list" is a real question.
const GAMES = [
  { id: 'lantern-cove', pick: 'lighthouse' },
  { id: 'firefly-ruins', pick: null },
].filter((g) => !opt('--game') || g.id === opt('--game'));

const GAME = `document.querySelector('iframe').contentWindow`;
const READY = `document.querySelectorAll('.obj').length > 0 && !!${GAME}.__gameStudio?._debug`;

// What can be read: list rows whose whole height is inside the list's scroll box and above
// whatever floats over the sheet's foot (the card, the bar). Plus where the game shows.
const MEASURE = `(() => {
  const panel = document.querySelector('.side .panel').getBoundingClientRect();
  const covers = [...document.querySelectorAll('.card-slot > .card:not([hidden]), .dock .bar')]
    .filter((e) => e.offsetParent).map((e) => e.getBoundingClientRect().top);
  const bottom = Math.min(panel.bottom, ...covers);
  // Sticky kind headings sit over the top rows of the scroll box.
  const heads = [...document.querySelectorAll('.side .panel .kind-head, .side .panel [data-sticky]')]
    .filter((e) => e.offsetParent && getComputedStyle(e).position === 'sticky').map((e) => e.getBoundingClientRect());
  const top = Math.max(panel.top, ...heads.filter((r) => r.top <= panel.top + 2).map((r) => r.bottom));
  const rows = [...document.querySelectorAll('.side .panel .obj')].filter((e) => e.offsetParent);
  const seen = rows.filter((e) => { const r = e.getBoundingClientRect(); return r.top >= top - 1 && r.bottom <= bottom + 1; });
  const sel = rows.find((e) => e.getAttribute('aria-selected') === 'true');
  const side = document.querySelector('.side').getBoundingClientRect();
  const stage = document.querySelector('iframe').getBoundingClientRect();
  return JSON.stringify({ rows: rows.length, seen: seen.length, names: seen.map((e) => e.textContent.trim().slice(0, 18)),
    warn: !!document.querySelector('.side .status.warn')?.offsetParent,
    selSeen: !!sel && seen.includes(sel), card: covers.length > 1,
    pickTab: !!document.querySelector('[data-part=sheet-tabs] [data-tab=pick]')?.offsetParent, gameSeen: Math.round(side.top - stage.top), sheetTop: Math.round(side.top) });
})()`;
// Every self-check result the editor receives (the bridge posts it to the shell's window), from the first one on.
const CATCH_CHECKS = `window.__checks = []; if (window === window.top) addEventListener('message', (e) => {
  if (e.data && e.data.type === 'studio:core/check') window.__checks.push(e.data.result); });`;
const anchorBox = (key) => `(() => { const f = document.querySelector('iframe').getBoundingClientRect();
  const a = ${GAME}.__gameStudio._debug.anchor(${JSON.stringify(key)}); if (!a) return null;
  const r = a.rect || { x: a.center[0] - a.size / 2, y: a.center[1] - a.size / 2, w: a.size, h: a.size };
  return JSON.stringify({ x: f.left + r.x, y: f.top + r.y, w: r.w, h: r.h, cx: f.left + a.center[0], cy: f.top + a.center[1] }); })()`;
// Mean colour change (0–255) inside `box` between two screenshots, decoded by the page itself (no PNG library).
const DIFF = (a, b, box, dpr) => `(async () => {
  const load = (b64) => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = 'data:image/png;base64,' + b64; });
  const [ia, ib] = await Promise.all([load(${JSON.stringify(a)}), load(${JSON.stringify(b)})]);
  const k = ${dpr}, x = Math.round(${box.x} * k), y = Math.round(${box.y} * k), w = Math.max(1, Math.round(${box.w} * k)), h = Math.max(1, Math.round(${box.h} * k));
  const px = (img) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
    g.drawImage(img, x, y, w, h, 0, 0, w, h); return g.getImageData(0, 0, w, h).data; };
  const p = px(ia), q = px(ib); let sum = 0;
  for (let i = 0; i < p.length; i += 4) sum += (Math.abs(p[i] - q[i]) + Math.abs(p[i + 1] - q[i + 1]) + Math.abs(p[i + 2] - q[i + 2])) / 3;
  return sum / (p.length / 4);
})()`;
const anchorY = (key) => `(() => { const f = document.querySelector('iframe'); const r = f.getBoundingClientRect();
  const a = f.contentWindow.__gameStudio._debug.anchor(${JSON.stringify(key)}); return a ? r.top + a.center[1] : null; })()`;

/**
 * Firefly Ruins (W1-10): drag the urn and the bell left by about their width with real input, then compare the
 * water under where each stood and where it went — both must change on screen (the reflection followed). The game is
 * frozen while editing, so nothing else in the water moves; a control patch (under the tree, far right) must not.
 */
async function reflection(page, tag, pc, shot) {
  const dpr = pc ? 1 : 2; // newPage(): deviceScaleFactor 2 with mobile
  const snap = async () => (await page.send('Page.captureScreenshot', { format: 'png' })).data;
  const box = async (key) => JSON.parse(await page.eval(anchorBox(key)));
  const view = () => page.eval(`JSON.stringify(${GAME}.__gameStudio._debug.view())`);
  // The water just under an object standing on the bank: its mirror image, inner part (edges blur in the strips).
  const water = (r) => ({ x: r.x + r.w * 0.2, y: r.y + r.h * 1.2, w: r.w * 0.6, h: r.h * 0.6 });
  for (const key of ['urn', 'bell']) {
    // Selected once and let go, so whatever the editor's camera does on a pick has already happened.
    await page.eval(`studioShell.actions.select(${JSON.stringify(key)})`);
    await page.waitFor(`studioShell.selected() === ${JSON.stringify(key)}`, 3000);
    await sleep(800);
    await page.eval('studioShell.actions.select(null)');
    await sleep(600);
    const v0 = await view();
    const b0 = await box(key);
    const ctl = water(await box('tree'));
    const s0 = await snap();
    await page.eval(`studioShell.actions.select(${JSON.stringify(key)})`);
    await sleep(800);
    const b = await box(key);
    const dx = -Math.max(b.w * 0.9, 14);
    if (pc) await page.mouseDrag(b.cx, b.cy, b.cx + dx, b.cy, 8);
    else await page.touchDrag(b.cx, b.cy, b.cx + dx, b.cy, 8);
    await sleep(500);
    await page.eval('studioShell.actions.select(null)');
    await sleep(600);
    const b1 = await box(key);
    const s1 = await snap();
    if (shot) {
      writeFileSync(join(SHOTS, `${tag}-refl-${key}-0.png`), Buffer.from(s0, 'base64'));
      writeFileSync(join(SHOTS, `${tag}-refl-${key}-1.png`), Buffer.from(s1, 'base64'));
    }
    assert.equal(await view(), v0, `${tag}: the editor's view changed while moving the ${key} (the comparison needs the same view)`);
    assert.ok(b1.x < b0.x - Math.abs(dx) * 0.5, `${tag}: the ${key} did not move (${Math.round(b0.x)} → ${Math.round(b1.x)})`);
    const was = await page.eval(DIFF(s0, s1, water(b0), dpr));
    const now = await page.eval(DIFF(s0, s1, water(b1), dpr));
    const still = await page.eval(DIFF(s0, s1, ctl, dpr));
    console.log(`  ${tag}: ${key} moved ${Math.round(b1.x - b0.x)}px; water change where it was ${was.toFixed(1)}, where it went ${now.toFixed(1)}, under the tree ${still.toFixed(1)}`);
    assert.ok(still < 1.5, `${tag}: the water under the tree changed too (${still.toFixed(1)}): the comparison is not clean`);
    assert.ok(was > 3, `${tag}: the ${key}'s old reflection stayed in the water (change ${was.toFixed(1)})`);
    assert.ok(now > 3, `${tag}: no reflection where the ${key} went (change ${now.toFixed(1)})`);
    await page.eval('studioShell.actions.undo()');
    await sleep(500);
  }
}

let failed = 0;
for (const g of GAMES) {
  const root = mkdtempSync(join(tmpdir(), `studio-narrow-${g.id}-`));
  cpSync(join(PKG, 'starters', g.id), root, { recursive: true });
  if (opt('--lang')) {
    mkdirSync(join(root, '.studio/ui'), { recursive: true });
    writeFileSync(join(root, '.studio/ui/prefs.json'), JSON.stringify({ version: 1, lang: opt('--lang') }));
  }
  const srv = await startStudioServer({ root, uiDir: join(PKG, 'skills/arrange/bin/studio-ui'), log: () => {} });
  const browser = await launch();
  try {
    for (const [w, h] of SIZES) {
      const tag = `${g.id}-${w}x${h}`;
      const pc = w >= 1000;
      const page = await newPage(browser, { width: w, height: h, mobile: !pc });
      await page.send('Page.addScriptToEvaluateOnNewDocument', { source: CATCH_CHECKS });
      const shot = async (name) => {
        if (!SHOTS) return;
        await sleep(400);
        writeFileSync(join(SHOTS, `${tag}-${name}.png`), await page.screenshot());
      };
      try {
        await page.goto(srv.url);
        await page.waitFor(READY, 30000);
        await sleep(800);
        if (g.id === 'firefly-ruins') await reflection(page, tag, pc, !!SHOTS);
        // The sheet's own measures fail after the self-check is checked below (so a crowded sheet never hides it).
        let sheetFail = null;
        if (!pc) {
          try {
            await page.eval(`document.querySelector('[data-action=sheet]').click()`);
            await sleep(700);
            await shot('1-list');
            const keys = JSON.parse(await page.eval(`JSON.stringify([...document.querySelectorAll('.side .panel .obj')].map((e) => e.dataset.key))`));
            const key = g.pick && keys.includes(g.pick) ? g.pick : keys[Math.floor(keys.length / 2)];
            await page.eval(`studioShell.actions.select(${JSON.stringify(key)})`);
            await page.waitFor(`studioShell.selected() === ${JSON.stringify(key)}`, 3000);
            await sleep(900);
            const m = JSON.parse(await page.eval(MEASURE));
            const y = await page.eval(anchorY(key));
            await shot('2-picked');
            const want = h <= 640 ? 4 : 5;
            console.log(`  ${tag}: ${m.seen}/${m.rows} rows readable (${m.names.join(', ')}); picked ${key} ${m.selSeen ? 'in view' : 'NOT in view'}; game ${m.gameSeen}px above the sheet; object at y=${Math.round(y)} (sheet top ${m.sheetTop})`);
            assert.ok(m.seen >= Math.min(want, m.rows), `${tag}: only ${m.seen} rows readable (want ≥ ${want})`);
            assert.ok(m.selSeen, `${tag}: the picked row is not in view`);
            // Plan step 7 (v0.1.38, 2026-10-23): the phone / side window's bottom is one sheet showing one thing at a time
            // (Scene | <picked> | Motion). A pick from the Scene list keeps the list up; the card is the picked object's
            // tab, one press away — it no longer stands over the list (that was the card check before).
            assert.ok(m.pickTab, `${tag}: no tab for the picked object's card in the sheet`);
            assert.ok(m.gameSeen >= h * 0.24, `${tag}: only ${m.gameSeen}px of the game above the sheet`);
            assert.ok(y !== null && y < m.sheetTop, `${tag}: the picked object is under the sheet (y=${y}, sheet top ${m.sheetTop})`);
          } catch (e) {
            sheetFail = e;
          }
        } else if (g.pick) {
          // The check runs once editing starts; on a PC nothing has been picked yet in this run.
          await page.eval(`studioShell.actions.select(${JSON.stringify(g.pick)})`);
        }
        // Our own samples: no adapter warning, ever (W1-5). Every self-check result passed, and no line over the list.
        await page.waitFor('window.__checks.length > 0', 10000);
        const results = JSON.parse(await page.eval('JSON.stringify(window.__checks)'));
        const bad = results.flatMap((r) => r.checks.filter((c) => !c.ok && !c.skipped).map((c) => `${c.id}${c.detail ? ` (${c.detail})` : ''}`));
        assert.deepEqual(bad, [], `${tag}: the adapter self-check failed on our own sample`);
        const line = await page.eval(`(() => { const s = document.querySelector('.side .status.warn, .side .status.note'); return s && !s.hidden && s.offsetParent ? s.textContent : ''; })()`);
        assert.equal(line, '', `${tag}: a warning line is shown over the list`);
        console.log(`  ${tag}: self-check passed ${results.length}× (${results.map((r) => r.sample).join(', ')}); no warning`);
        if (sheetFail) throw sheetFail;
        const errors = page.logs.filter((l) => l.startsWith('exception'));
        assert.deepEqual(errors, [], 'page errors');
        console.log(`  ✓ ${tag}`);
      } catch (e) {
        failed++;
        console.log(`  ✗ ${e.message}`);
        await shot('FAIL').catch(() => {});
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
    await srv.close();
    rmSync(root, { recursive: true, force: true });
  }
}
if (failed) {
  console.log(`${failed} failed`);
  process.exit(1);
}
console.log('ok');
