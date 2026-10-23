// Headless check of the two ways to fit the studio (CONTRACT.md §7 and §8),
// with the real server, the built shell and example games, PC and phone:
//
//   A. Game rules (.studio/studio.json): grid and angle snap, a locked object,
//      a default size per kind.                       — three-crates (3D)
//   B. A game tool (.studio/tools.js): draw a course; saved to
//      .studio/data/course.json.                       — canvas-stars (2D)
//   C. The AI rewrites the editor look (.studio/ui/studio.css + shell.js);
//      ?ui=off brings back the original look.          — pixi-garden (2D)
//   D. The View page writes .studio/ui/prefs.json and it is kept on reload.
//
//   node test/studio-fit.browser.mjs [--shots <dir>]
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStudioServer } from '../src/server/server.mjs';
import { launch, newPage } from './adapters-2d/cdp.mjs';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const at = args.indexOf('--shots');
const SHOTS = at >= 0 ? resolve(args[at + 1]) : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const GAME = `document.querySelector('iframe').contentWindow`;
const IN = {
  ready: `document.querySelectorAll('.obj').length > 0 && !!${GAME}.__gameStudio?._debug`,
  anchor: (key) => `(() => { const f = document.querySelector('iframe'); const r = f.getBoundingClientRect();
    const a = f.contentWindow.__gameStudio._debug.anchor(${JSON.stringify(key)}); if (!a) return null;
    return JSON.stringify({ x: r.left + a.center[0], y: r.top + a.center[1], pose: a.pose }); })()`,
  handle: (kind) => `(() => { const f = document.querySelector('iframe'); const r = f.getBoundingClientRect();
    const b = f.contentDocument.querySelector('[data-studio-ui]')?.shadowRoot?.querySelector('[data-studio-handle=${kind}]');
    if (!b || b.hidden) return null; const row = b.parentElement; if (getComputedStyle(row).display === 'none') return null;
    const q = b.getBoundingClientRect(); if (!q.width) return null;
    return JSON.stringify({ x: r.left + q.left + q.width / 2, y: r.top + q.top + q.height / 2, w: q.width }); })()`,
  click: (sel) => `(() => { const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find(e => e.offsetParent); if (!el) return false; el.click(); return true; })()`,
};
const j = async (page, expr) => JSON.parse((await page.eval(expr)) || 'null');

async function session(example, layout, prepare, run) {
  const mobile = layout === 'phone';
  const tag = `${example}-${mobile ? '390' : '1280'}`;
  const root = mkdtempSync(join(tmpdir(), `studio-fit-${example}-`));
  cpSync(join(PKG, 'examples', example), root, { recursive: true });
  mkdirSync(join(root, '.studio'), { recursive: true });
  prepare(root);
  const lines = [];
  const srv = await startStudioServer({ root, uiDir: join(PKG, 'skills/arrange/bin/studio-ui'), log: (l) => lines.push(l) });
  const browser = await launch();
  const page = await newPage(browser, mobile ? { width: 390, height: 844, mobile: true } : { width: 1280, height: 800 });
  const ok = (m) => console.log(`  ✓ ${tag}: ${m}`);
  const shot = async (name) => {
    if (!SHOTS) return;
    await sleep(300);
    writeFileSync(join(SHOTS, `fit-${tag}-${name}.png`), await page.screenshot());
  };
  const drag = (x0, y0, x1, y1, steps = 8) => (mobile ? page.touchDrag(x0, y0, x1, y1, steps) : page.mouseDrag(x0, y0, x1, y1, steps));
  try {
    await page.goto(srv.url);
    await page.waitFor(IN.ready, 30000);
    await run({ page, root, lines, ok, shot, drag, mobile, srv });
    const errors = page.logs.filter((l) => l.startsWith('exception'));
    assert.deepEqual(errors, [], 'page errors');
  } catch (e) {
    console.log(page.logs.slice(-15).join('\n'));
    console.log(lines.join('\n'));
    await shot('FAIL').catch(() => {});
    throw e;
  } finally {
    await page.close();
    await browser.close();
    await srv.close();
    rmSync(root, { recursive: true, force: true });
  }
}

const selectKey = async (page, key) => {
  await page.eval(`studioShell.actions.select(${JSON.stringify(key)})`);
  await page.waitFor(`studioShell.selected() === ${JSON.stringify(key)}`, 3000);
  await sleep(400);
};

// --- A. game rules -------------------------------------------------------
async function rules(layout) {
  console.log(`A. game rules (.studio/studio.json) · ${layout}`);
  await session('three-crates', layout, (root) => {
    writeFileSync(join(root, '.studio/studio.json'), JSON.stringify({
      version: 1,
      snap: { grid: 1, angle: 90 },
      rules: [{ match: 'ground', locked: true }, { match: 'crate*', scale: { default: 1.5, min: 0.5, max: 2 } }],
    }));
  }, async ({ page, ok, shot, drag, mobile }) => {
    const items = JSON.parse(await page.eval(`JSON.stringify(${GAME}.__gameStudio._debug.list())`));
    const crate = items.find((i) => i.key === 'crate' || i.group === 'crate' || /^crate/.test(i.key));
    assert.ok(crate, 'no crate');
    await selectKey(page, crate.key);
    if (mobile) {
      await page.eval(IN.click('[data-action=sheet]'));
      await sleep(700);
    }
    const h = await j(page, IN.handle('move'));
    await drag(h.x, h.y, h.x + 37, h.y + 23);
    const p = (await j(page, IN.anchor(crate.key))).pose;
    assert.ok(p.p[0] === Math.round(p.p[0]) && p.p[2] === Math.round(p.p[2]), `not on the 1 m grid: ${JSON.stringify(p.p)}`);
    ok(`move snapped to the 1 m grid → ${JSON.stringify(p.p)}`);
    const a = await j(page, IN.anchor(crate.key));
    const r = await j(page, IN.handle('rotate'));
    const rad = Math.hypot(r.x - a.x, r.y - a.y), ang0 = Math.atan2(r.y - a.y, r.x - a.x);
    const pts = Array.from({ length: 12 }, (_, i) => [a.x + rad * Math.cos(ang0 + (i * 1.9) / 11), a.y + rad * Math.sin(ang0 + (i * 1.9) / 11)]);
    if (mobile) {
      await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: r.x, y: r.y, id: 1 }] });
      for (const [x, y] of pts) await page.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y, id: 1 }] });
      await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'left', buttons: 1, clickCount: 1 });
      for (const [x, y] of pts) await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1 });
      await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pts[11][0], y: pts[11][1], button: 'left', buttons: 0, clickCount: 1 });
    }
    const rr = (await j(page, IN.anchor(crate.key))).pose.r;
    const q = rr / (Math.PI / 2);
    assert.ok(Math.abs(q - Math.round(q)) < 1e-6 && Math.round(q) !== 0, `angle not on 90° steps: ${rr}`);
    ok(`turn snapped to 90° steps → ${Math.round((rr * 180) / Math.PI)}°`);
    await page.waitFor(`!!document.querySelector('[data-action=reset-size]')`, 3000);
    // A phone's card folds its rows under "…" (the card's `fine`, design review wave 1 W1-11, 2026-10-17), and since plan
    // step 7 (v0.1.38) the card is the picked object's tab of the one sheet: bring it up and open "…" first.
    if (mobile) {
      // Folded (the bar's ▾ folds the card too): ▴ unfolds onto the card.
      await page.eval(`(() => { if (document.querySelector('.shell').dataset.fold === 'min') document.querySelector('[data-action=sheet]').click(); return true; })()`);
      await sleep(400);
      await page.eval(`(() => { const t = document.querySelector('[data-part=sheet-tabs] [data-tab=pick]'); if (t && t.offsetParent && !document.querySelector('.card')?.offsetParent) t.click(); return true; })()`);
      await sleep(400);
      await page.eval(`(() => { const f = document.querySelector('.card .fine'); if (f && !f.open) f.querySelector('summary').click(); return true; })()`);
      await sleep(300);
    }
    assert.ok(await page.eval(IN.click('[data-action=reset-size]')), 'no "Default size" button to press');
    await sleep(200);
    assert.equal((await j(page, IN.anchor(crate.key))).pose.s, 1.5);
    ok('"Default size" button → ×1.5 (rule for crates)');
    await shot('rules');
    await selectKey(page, 'ground');
    // Since studio-tool-clear (2026-10-23) the strip keeps every tool in its place and dims the ones that do not work
    // (aria-disabled, the why as its tooltip) instead of hiding them: a locked object's Move is there, but off.
    const moveOff = `(() => { const b = document.querySelector('iframe').contentDocument.querySelector('[data-studio-ui]')?.shadowRoot?.querySelector('[data-studio-handle=move]'); return !b || b.hidden || b.getAttribute('aria-disabled') === 'true'; })()`;
    assert.equal(await page.eval(moveOff), true, 'locked ground has a Move that works');
    // The why is said once, in the line under the strip (studio-card-doors, plan step 3, 2026-10-23): the card is the
    // name only for a locked ground / road / sky (it said "Ground, road, or sky… Unlock" before).
    await sleep(300);
    const note = await page.eval(`document.querySelector('iframe').contentDocument.querySelector('[data-studio-ui]')?.shadowRoot?.querySelector('[data-studio-note]')?.textContent || ''`);
    assert.match(note, /Locked|固定|ロック/, `the line under the strip: "${note}"`);
    ok('locked object: Move dimmed, the line under the strip says it is locked');
  });
}

// --- B. a game tool --------------------------------------------------------
const COURSE_TOOL = `// Example game tool: draw the race course as a line of points (scene coordinates).
studio.extend({
  tools: [{
    id: 'course',
    label: { en: 'Draw course', ja: 'コースを引く' },
    icon: '✎',
    hint: { en: 'Drag in the game to draw the course', ja: 'ゲームの上を引いてコースを描く' },
    points: [],
    drawing: false,
    pointer(e, ctx) {
      const p = ctx.toGround(e.x, e.y);
      if (!p) return false;
      if (e.type === 'down') { this.points = [p]; this.drawing = true; }
      else if (e.type === 'move' && this.drawing) {
        const last = this.points[this.points.length - 1];
        if (Math.hypot(p[0] - last[0], p[p.length - 1] - last[last.length - 1]) > 4) this.points.push(p);
      } else if (e.type === 'up') { this.drawing = false; ctx.changed(); }
      return true;
    },
    draw(ctx) {
      const g = ctx.overlay;
      g.strokeStyle = '#ff5a36'; g.lineWidth = 6; g.lineJoin = g.lineCap = 'round';
      g.beginPath();
      this.points.forEach((p, i) => { const s = ctx.toScreen(p); if (s) i ? g.lineTo(s[0], s[1]) : g.moveTo(s[0], s[1]); });
      g.stroke();
    },
    data() { return { points: this.points.map((p) => p.map((v) => Math.round(v * 10) / 10)) }; },
    restore(d) { if (d && Array.isArray(d.points)) this.points = d.points; },
  }],
});
`;
async function tool(layout) {
  console.log(`B. game tool (.studio/tools.js) · ${layout}`);
  await session('canvas-stars', layout, (root) => {
    writeFileSync(join(root, '.studio/tools.js'), COURSE_TOOL);
  }, async ({ page, root, lines, ok, shot, drag, mobile }) => {
    if (mobile) {
      await page.eval(IN.click('[data-action=sheet]'));
      await sleep(600);
    }
    await page.waitFor(`!!document.querySelector('[data-game-tool=course]')`, 5000);
    ok('tool button shown: ' + (await page.eval(`document.querySelector('[data-game-tool=course]').textContent`)));
    await page.eval(IN.click('[data-game-tool=course]'));
    await page.waitFor(`document.querySelector('[data-game-tool=course]').getAttribute('aria-pressed') === 'true'`, 3000);
    const box = JSON.parse(await page.eval(`JSON.stringify(document.querySelector('iframe').getBoundingClientRect())`));
    const y = box.top + box.height * 0.25;
    await drag(box.left + box.width * 0.2, y, box.left + box.width * 0.8, y + 40, 12);
    await page.waitFor(`/\\(1\\)/.test(document.querySelector('[data-game-tool=course]').textContent)`, 3000);
    ok('drew a course (1 unsaved change on the tool)');
    await shot('tool');
    await page.eval(IN.click('[data-action=save]'));
    const file = join(root, '.studio/data/course.json');
    for (let i = 0; i < 40 && !existsSync(file); i++) await sleep(100);
    const data = JSON.parse(readFileSync(file, 'utf8'));
    assert.ok(Array.isArray(data.points) && data.points.length >= 3, `points: ${JSON.stringify(data)}`);
    assert.ok(lines.includes('studio: saved .studio/data/course.json'));
    await page.waitFor(`!/\\(\\d/.test(document.querySelector('[data-game-tool=course]').textContent)`, 3000);
    ok(`saved .studio/data/course.json (${data.points.length} points)`);
  });
}

// --- C. the AI rewrites the editor look; D. the View page -------------------
const UI_CSS = `/* Written by the AI: warm light colours, rounder buttons. */
:root[data-theme] { --studio-bg: #fff7e6; --studio-card: #ffffff; --studio-fg: #3b2a12; --studio-muted: #8a6d3b;
  --studio-line: #f0d9a8; --studio-accent: #e8590c; --studio-btn: #ffffff; --studio-input: #fff1d6; --studio-tab: #ffe3b0; color-scheme: light; }
button { border-radius: 999px; }
`;
const UI_JS = `// Written by the AI: list on the right, fewer buttons, one "Show all" button at the bottom.
studioShell.setPrefs({ panel: 'right' });
studioShell.hide('next');
studioShell.hide('lang');
studioShell.addButton({ id: 'frame-all', label: 'Show all', where: 'footer', onClick: () => studioShell.actions.frameAll() });
studioShell.setText('ja', { 'btn.save': 'しまう' });
`;
async function ui(layout) {
  console.log(`C/D. editor look (.studio/ui/, View page) · ${layout}`);
  await session('pixi-garden', layout, (root) => {
    mkdirSync(join(root, '.studio/ui'), { recursive: true });
    writeFileSync(join(root, '.studio/ui/studio.css'), UI_CSS);
    writeFileSync(join(root, '.studio/ui/shell.js'), UI_JS);
  }, async ({ page, root, ok, shot, mobile, srv }) => {
    await page.waitFor(`!!document.querySelector('[data-action=custom-frame-all]')`, 5000);
    const look = JSON.parse(await page.eval(`JSON.stringify({ bg: getComputedStyle(document.querySelector('.side')).backgroundColor,
      panel: document.querySelector('.shell').dataset.panel,
      sideX: document.querySelector('.side').getBoundingClientRect().x, stageX: document.querySelector('.stage').getBoundingClientRect().x })`));
    assert.equal(look.bg, 'rgb(255, 247, 230)', 'studio.css colours');
    // hide('next'): the ⌘K list has no "Ideas for your AI" (the place the Ideas live since the rebrand).
    await page.eval(`(() => { const i = document.querySelector('.ask-input'); i.focus(); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true })); })()`);
    await sleep(150);
    const next = await page.eval(`!!document.querySelector('.palette [data-action=next], .palette [data-step]')`);
    const palOk = await page.eval(`!!document.querySelector('.palette [data-action=play]')`);
    await page.eval(`document.querySelector('.ask-input').blur()`);
    assert.ok(palOk, 'the ⌘K list did not open');
    assert.equal(next, false, 'next steps hidden by shell.js');
    assert.equal(look.panel, 'right');
    if (!mobile) assert.ok(look.sideX > look.stageX, 'panel on the right');
    ok(`AI look applied (colours, ${mobile ? 'phone keeps its sheet' : 'list on the right'}, next steps hidden, extra button)`);
    await shot('ui-ai');
    const prefs = JSON.parse(readFileSync(join(root, '.studio/ui/prefs.json'), 'utf8'));
    assert.equal(prefs.panel, 'right');
    // The way back: ?ui=off shows the original look, writes nothing.
    await page.goto(srv.url + '&ui=off');
    await page.waitFor(IN.ready, 30000);
    const plain = JSON.parse(await page.eval(`JSON.stringify({ dark: matchMedia('(prefers-color-scheme: dark)').matches, bg: getComputedStyle(document.querySelector('.side')).backgroundColor, panel: document.querySelector('.shell').dataset.panel, custom: !!document.querySelector('[data-action=custom-frame-all]') })`));
    // The default look follows the device since the ive finish (2026-10-16; it was always dark before):
    // the desk --studio-bg is #1c1c1e dark / #ececf0 light (#121316 dark-only from the rebrand until the finish).
    // And the list on the left (the rebrand's default).
    const desk = plain.dark ? 'rgb(28, 28, 30)' : 'rgb(236, 236, 240)';
    assert.deepEqual({ bg: plain.bg, panel: plain.panel, custom: plain.custom }, { bg: desk, panel: 'left', custom: false });
    ok(`?ui=off → original look (${plain.dark ? 'dark' : 'light'} as the device, left, no extra button)`);
    // D. View page (the person, without the AI): light theme + bottom panel, saved and kept.
    rmSync(join(root, '.studio/ui/shell.js'));
    rmSync(join(root, '.studio/ui/studio.css'));
    await page.goto(srv.url);
    await page.waitFor(IN.ready, 30000);
    // The Look page: a row of the ⌘K list (press the ask field).
    await page.eval(`(() => { const i = document.querySelector('.ask-input'); i.focus(); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true })); })()`);
    await page.waitFor(`!!document.querySelector('.palette [data-action=settings]')`, 3000);
    await page.eval(IN.click('.palette [data-action=settings]'));
    await page.waitFor(`!!document.querySelector('[data-ui=theme-light]')`, 3000);
    await page.eval(IN.click('[data-ui=theme-light]'));
    if (!mobile) await page.eval(IN.click('[data-ui=panel-bottom]'));
    await page.eval(`(() => { const r = document.querySelector('[data-ui=handleSize]'); r.value = '64'; r.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await sleep(800);
    const saved = JSON.parse(readFileSync(join(root, '.studio/ui/prefs.json'), 'utf8'));
    assert.equal(saved.theme, 'light');
    assert.equal(saved.handleSize, 64);
    if (!mobile) assert.equal(saved.panel, 'bottom');
    await shot('ui-view');
    await page.goto(srv.url);
    await page.waitFor(IN.ready, 30000);
    const kept = JSON.parse(await page.eval(`JSON.stringify({ theme: document.documentElement.dataset.theme, panel: document.querySelector('.shell').dataset.panel })`));
    assert.equal(kept.theme, 'light');
    if (!mobile) assert.equal(kept.panel, 'bottom');
    // Handle size reaches the game page.
    const key = JSON.parse(await page.eval(`JSON.stringify(${GAME}.__gameStudio._debug.list().map(i => i.key))`)).find((k) => !k.startsWith('path:'));
    await selectKey(page, key);
    await sleep(400);
    const hd = await j(page, IN.handle('move'));
    assert.equal(Math.round(hd.w), 64, 'handle size');
    ok('View page → .studio/ui/prefs.json (light, handles 64 px' + (mobile ? '' : ', panel at the bottom') + '), kept after reload');
    await shot('ui-view-kept');
  });
}

for (const layout of ['pc', 'phone']) {
  await rules(layout);
  await tool(layout);
  await ui(layout);
}
console.log('all passed');
