// UI stage 1 (2026-10-19): the game's HTML UI as the editor's second layer. With the real server and the built editor,
// on examples/three-hud (a three.js world with an HTML title card, Start button and score marked data-studio-key):
//
// PC 1280×800 (mouse):
//   1. the top bar's middle has World | UI, World on; the list is the world's (trees, lanterns)
//   2. U → the UI layer: the list is the three UI elements, the world is dimmed, World | UI says UI
//   3. a click on the title card selects it (card: "UI" tag, no Duplicate / Delete)
//   4. dragging it moves it by the drag — CSS translate only: its left / top / transform are what the game wrote
//   5. "+" makes it bigger with its middle where it was (the title is centred with transform: translate(-50%, -50%))
//   6. Save → placement.json has `ui["title-card"]` (+ uiView), and nothing else changed (no objects, dim 3d)
//   7. the game opened WITHOUT the editor (a plain static server): the title is where it was put, at that size
//   8. back in the editor: U to the world, ⌘Z → the editor switches to the UI and the title goes back (one size
//      step); ⌘Z ×2 → back to the game's own place; ⇧⌘Z ×3 → where it was saved; the world still moves (an arrow key)
//   9. P → the window before Play (the lantern's move is not saved) → Try without saving: the UI as the game draws it
// Phone 390×844 (touch): the switch is icons only over the game; tap UI, tap the title, drag it.
// The game's UI over the world (a try of the editor, 2026-10-20, "the UI is always there, in the way"), in the PC and phone runs:
//   - on the world it is hidden (filter opacity 0, no pointer) and an eye with a slash says so next to World | UI
//   - a click where the Start button / title sits picks the world object behind it
//   - ⇧U (PC) / a tap on the eye (phone) shows it faded, still not in the pointer's way; again → hidden
//   - U → the UI layer: shown in full, the world dimmed; Play: the game as it is (no style at all)
// No data-studio-key (Lantern Cove 3D, Firefly Ruins 2D): no switch, no layer style in the game, and the saved
// placement.json is byte for byte the one the editor BEFORE UI stage 1 writes for the same moves (its built files
// from git, commit BEFORE below).
//
// HTML only (no world): the UI alone, opened in about a second, saved with dim 2d and no objects.
//
//   node test/studio-ui-layer.browser.mjs [--shots <dir>] [--only pc|phone|html|plain] [--lang en|ja]
// --lang (the PC and phone runs): the editor's words, for the public docs' Japanese pictures (docs/site, 2026-10-22).
// --shots <dir> also writes the photos (ui-pc-world.png, ui-pc-ui.png, ui-pc-moved.png, ui-phone-*.png).
// Exit 1 on failure.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStudioServer } from '../src/server/server.mjs';
import { launch, newPage } from './adapters-2d/cdp.mjs';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const SHOTS = opt('--shots') ? resolve(opt('--shots')) : null;
const ONLY = opt('--only');
const LANG = opt('--lang') || 'en';
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// The editor before UI stage 1 (its built files are committed): the "same bytes" baseline.
// Merge of 2026-10-19: the editor just before UI stage 1 was merged in, not the branch's own base. The
// branches merged earlier changed what the same arrow steps do (snap to surfaces: a move rides the ground under it, so
// Lantern Cove's lighthouse goes down a metre on its way right), which is theirs to change; this test only checks
// that UI stage 1 itself changes no byte for a game without data-studio-key. Was '187bb6f9f' on the UI stage 1 branch.
const BEFORE = '96945d944';

const WIN = `document.querySelector('iframe').contentWindow`;
const DBG = `${WIN}.__gameStudio._debug`;
const MAC = process.platform === 'darwin';
const MOD = MAC ? 4 : 2;
const CODES = { ArrowRight: ['ArrowRight', 39], '+': ['Equal', 187] };
/** One key press (down + up) with modifiers (2 Ctrl, 4 Meta, 8 Shift) on the editor page. */
const key = async (page, k, modifiers = 0) => {
  const [code, vk] = CODES[k] || [`Key${k.toUpperCase()}`, k.toUpperCase().charCodeAt(0)];
  const base = { key: k, code, windowsVirtualKeyCode: vk, modifiers };
  await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base });
  if (k.length === 1 && !(modifiers & (2 | 4))) await page.send('Input.dispatchKeyEvent', { type: 'char', ...base, text: k });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  await sleep(150);
};
/** The UI element's box in the EDITOR page's px (the game frame's offset added). */
const boxOf = async (page, k) => JSON.parse(await page.eval(`(() => { const f = document.querySelector('iframe').getBoundingClientRect();
  const r = ${WIN}.document.querySelector('[data-studio-key="${k}"]').getBoundingClientRect();
  return JSON.stringify({ x: f.left + r.left, y: f.top + r.top, w: r.width, h: r.height, cx: f.left + r.left + r.width / 2, cy: f.top + r.top + r.height / 2 }); })()`));
const poseOf = async (page, k) => JSON.parse(await page.eval(`JSON.stringify(${DBG}.list().find((i) => i.key === '${k}')?.pose ?? null)`));
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);
/** How the game's UI is drawn now (the bridge's style sheet, the title's and Start's computed look) and the eye. */
const uiLook = async (page) => JSON.parse(await page.eval(`(() => { const d = ${WIN}.document; const css = d.getElementById('studio-edit-layer')?.textContent ?? null;
  const look = (k) => { const e = d.querySelector('[data-studio-key="' + k + '"]'); const c = ${WIN}.getComputedStyle(e); return { filter: c.filter, pointer: c.pointerEvents }; };
  const eye = document.querySelector('[data-part=ui-peek]'); const r = eye && eye.getBoundingClientRect();
  return JSON.stringify({ css, title: look('title-card'), start: look('start-button'), startInner: ${WIN}.getComputedStyle(d.querySelector('.title-card h1')).pointerEvents,
    eye: eye && { hidden: eye.hidden || !eye.offsetParent, pressed: eye.getAttribute('aria-pressed'), text: eye.innerText.trim(), title: eye.title, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2, icon: eye.innerHTML.includes('M4 16 16 4') ? 'off' : 'on' } }); })()`));
/**
 * A point inside the UI element `k` (editor page px) with a world object right under it in the game, and that
 * object's key — found with the bridge's under() on a grid over the element's box.
 */
const worldUnder = async (page, k) => JSON.parse(await page.eval(`(() => { const f = document.querySelector('iframe').getBoundingClientRect();
  const r = ${WIN}.document.querySelector('[data-studio-key="${k}"]').getBoundingClientRect();
  // Only what a click picks: not the ground or anything else the editor holds still.
  const pickable = new Set(${DBG}.list().filter((i) => i.movable !== false && !i.held).map((i) => i.key));
  for (let j = 1; j < 8; j++) for (let i = 1; i < 8; i++) { const x = r.left + r.width * i / 8, y = r.top + r.height * j / 8; const u = ${DBG}.under(x, y);
    if (u && pickable.has(u)) return JSON.stringify({ key: u, x: f.left + x, y: f.top + y }); }
  return 'null'; })()`));

let failed = 0;
const cleanups = [];
const run = async (name, fn) => {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}: ${e.stack || e.message}`);
  } finally {
    for (const c of cleanups.splice(0).reverse()) await c().catch(() => {});
  }
};
/** A fresh copy of `from` in a temp folder, the studio server on it, a browser. */
const open = async (from, uiDir = join(PKG, 'skills/arrange/bin/studio-ui')) => {
  const root = mkdtempSync(join(tmpdir(), 'studio-ui-layer-'));
  cpSync(from, root, { recursive: true });
  const srv = await startStudioServer({ root, uiDir, log: () => {} });
  const browser = await launch();
  cleanups.push(async () => rmSync(root, { recursive: true, force: true }), () => srv.close(), () => browser.close());
  return { root, srv, browser };
};
/** The game folder over plain HTTP: no editor, no injected script — what a player gets. */
const staticServer = (root) => new Promise((ok) => {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css' };
  const s = createServer((req, res) => {
    const p = join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!p.startsWith(root) || !existsSync(p)) return res.writeHead(404).end();
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' }).end(readFileSync(p));
  });
  s.listen(0, '127.0.0.1', () => {
    cleanups.push(() => new Promise((r) => s.close(r)));
    ok(`http://127.0.0.1:${s.address().port}`);
  });
});
const waitEditing = (page) => page.waitFor(`!!${WIN}.__gameStudio?._debug && studioShell.items().length > 0`, 45000);

try {
  if (!ONLY || ONLY === 'pc') await run('PC 1280×800: switch, pick, drag, size, Save, reopen without the editor, undo across layers', async () => {
    const { root, srv, browser } = await open(join(PKG, 'examples/three-hud'));
    const page = await newPage(browser, { width: 1280, height: 800 });
    await page.goto(`${srv.url}&lang=${LANG}`);
    await waitEditing(page);
    await sleep(1200);
    // 1. World | UI in the top bar, World on.
    const sw = JSON.parse(await page.eval(`(() => { const s = document.querySelector('[data-part=layer-switch]'); const r = s && s.getBoundingClientRect();
      return JSON.stringify(s && { hidden: s.hidden, inHeader: !!s.closest('header'), cx: r.left + r.width / 2, on: s.querySelector('[aria-checked=true]')?.dataset.layer, text: s.innerText.replace(/\\s+/g, ' ').trim() }); })()`));
    assert.ok(sw && !sw.hidden && sw.inHeader, `the switch is in the top bar: ${JSON.stringify(sw)}`);
    near(sw.cx, 640, 2, 'the switch sits in the middle of the bar');
    assert.equal(sw.on, 'world');
    // Ive review 3, "what to cut" 1: no "UI hidden" beside the eye (the eye says it; the words are its tooltip).
    // "World" became "Scene" (plan step 1, 2026-10-23, "one word for one thing": the list and the switch say the same).
    assert.equal(sw.text, LANG === 'ja' ? 'シーン UI' : 'Scene UI');
    const worldKeys = await page.eval(`studioShell.items().map((i) => i.key).sort().join(' ')`);
    assert.match(worldKeys, /lantern-1.*tree-1/, `the world's list: ${worldKeys}`);
    assert.equal(await page.eval(`${DBG}.layer()`), 'world');
    if (SHOTS) writeFileSync(join(SHOTS, 'ui-pc-world.png'), await page.screenshot());

    // 1b. The game's UI is hidden on the world: invisible, out of the pointer's way, and said by the eye.
    const h0 = await uiLook(page);
    assert.match(h0.css, /filter:opacity\(0\)/, `hidden: ${h0.css}`);
    assert.equal(h0.title.filter, 'opacity(0)', 'the title is not drawn');
    assert.equal(h0.start.filter, 'opacity(0)', 'Start is not drawn');
    assert.equal(h0.start.pointer, 'none', 'Start takes no pointer');
    assert.equal(h0.startInner, 'none', 'nor what is inside the title');
    assert.ok(h0.eye && !h0.eye.hidden, 'the eye is there');
    assert.deepEqual([h0.eye.pressed, h0.eye.text, h0.eye.icon], ['false', '', 'off'], 'the eye alone says the UI is hidden');
    assert.equal(h0.eye.title, LANG === 'ja' ? 'ゲームの UI を見る  ⇧U' : "Show the game's UI  ⇧U", 'the words are the tooltip');
    assert.ok(h0.eye.cx > sw.cx + 40, 'right of the switch');
    // A click where a UI element sits picks the world object behind it.
    let behind = null;
    for (const k of ['start-button', 'title-card', 'score']) if (!behind) behind = await worldUnder(page, k);
    assert.ok(behind, 'a world object under one of the UI elements');
    await page.click(behind.x, behind.y);
    await page.waitFor(`studioShell.selected() === '${behind.key}'`, 3000);
    await page.eval(`studioShell.actions.select(null)`);
    await sleep(300);
    // ⇧U: shown, faded, still not in the way; ⇧U again: hidden.
    await page.eval(`document.activeElement?.blur?.()`);
    await key(page, 'U', 8);
    const h1 = await uiLook(page);
    assert.match(h1.css, /filter:opacity\(\.5\)/, `shown faded: ${h1.css}`);
    assert.equal(h1.title.filter, 'opacity(0.5)');
    assert.equal(h1.start.pointer, 'none', 'shown, Start still takes no pointer');
    assert.deepEqual([h1.eye.pressed, h1.eye.text, h1.eye.icon], ['true', '', 'on']);
    assert.equal(h1.eye.title, LANG === 'ja' ? 'ゲームの UI を隠す  ⇧U' : "Hide the game's UI  ⇧U");
    assert.equal(await page.eval(`${DBG}.layer()`), 'world', '⇧U does not switch the layer');
    if (SHOTS) writeFileSync(join(SHOTS, 'ui-pc-world-peek.png'), await page.screenshot());
    await page.click(h1.eye.cx, h1.eye.cy);
    await sleep(200);
    assert.equal((await uiLook(page)).title.filter, 'opacity(0)', 'the eye hides it again');

    // 2. U → the UI layer.
    await page.eval(`document.activeElement?.blur?.()`);
    await key(page, 'u');
    await page.waitFor(`${DBG}.layer() === 'ui' && studioShell.items().length === 3`, 5000);
    assert.equal(await page.eval(`studioShell.items().map((i) => i.key).join(' ')`), 'score title-card start-button');
    assert.equal(await page.eval(`document.querySelector('[data-part=layer-switch] [aria-checked=true]').dataset.layer`), 'ui');
    assert.match(await page.eval(`${WIN}.document.getElementById('studio-edit-layer')?.textContent || ''`), /brightness\(\.85\)/, 'the world is dimmed');
    const h2 = await uiLook(page);
    assert.deepEqual([h2.title.filter, h2.start.pointer], ['none', 'auto'], 'on the UI layer the UI is shown in full');
    assert.ok(h2.eye.hidden, 'no eye on the UI layer');
    assert.equal(await page.eval(`document.querySelector('header .here').textContent`), 'UI');

    // 3. Pick the title.
    const t0 = await boxOf(page, 'title-card');
    const css0 = JSON.parse(await page.eval(`(() => { const e = ${WIN}.document.querySelector('[data-studio-key="title-card"]'); const c = ${WIN}.getComputedStyle(e);
      return JSON.stringify({ left: c.left, top: c.top, transform: c.transform, inline: e.getAttribute('style') }); })()`));
    await page.click(t0.cx, t0.cy);
    await page.waitFor(`studioShell.selected() === 'title-card'`, 3000);
    await sleep(300);
    const card = JSON.parse(await page.eval(`JSON.stringify({ tag: !!document.querySelector('.inspector [data-part=ui-tag]'), copy: !!document.querySelector('.inspector [data-action=copy]'), del: !!document.querySelector('.inspector [data-action=remove]') })`));
    assert.deepEqual(card, { tag: true, copy: false, del: false }, 'the card: UI tag, no Duplicate / Delete');
    if (SHOTS) writeFileSync(join(SHOTS, 'ui-pc-ui.png'), await page.screenshot());

    // 4. Drag it 60 right, 80 up (it is picked: dragging it moves it).
    await page.mouseDrag(t0.cx, t0.cy, t0.cx + 60, t0.cy - 80, 10);
    await sleep(400);
    const t1 = await boxOf(page, 'title-card');
    near(t1.cx - t0.cx, 60, 1.5, 'moved right by the drag');
    near(t1.cy - t0.cy, -80, 1.5, 'moved up by the drag');
    const p1 = await poseOf(page, 'title-card');
    near(p1.p[0], 60, 1.5, 'offset x');
    near(p1.p[1], -80, 1.5, 'offset y');
    const css1 = JSON.parse(await page.eval(`(() => { const e = ${WIN}.document.querySelector('[data-studio-key="title-card"]'); const c = ${WIN}.getComputedStyle(e);
      return JSON.stringify({ left: c.left, top: c.top, transform: c.transform, translate: e.style.translate, styleTransform: e.style.transform }); })()`));
    assert.equal(css1.left, css0.left, 'left untouched');
    assert.equal(css1.top, css0.top, 'top untouched');
    assert.equal(css1.transform, css0.transform, 'the game\'s transform untouched');
    assert.equal(css1.styleTransform, '', 'no inline transform');
    assert.match(css1.translate, /px .*px/, 'moved with the translate property');

    // 5. "+" twice: bigger, the middle where it was.
    await key(page, '+');
    await key(page, '+');
    await sleep(300);
    const t2 = await boxOf(page, 'title-card');
    assert.ok(t2.w > t1.w * 1.05, `bigger (${t1.w} → ${t2.w})`);
    near(t2.cx, t1.cx, 1, 'the middle stays (x) while it grows');
    near(t2.cy, t1.cy, 1, 'the middle stays (y) while it grows');
    const p2 = await poseOf(page, 'title-card');
    assert.ok(p2.s > 1.05, `scale ${p2.s}`);
    if (SHOTS) writeFileSync(join(SHOTS, 'ui-pc-moved.png'), await page.screenshot());

    // 6. Save.
    await page.eval(`studioShell.actions.save()`);
    const file = join(root, 'placement.json');
    for (let i = 0; i < 40 && !(existsSync(file) && JSON.parse(readFileSync(file, 'utf8')).ui); i++) await sleep(150);
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    assert.deepEqual(Object.keys(saved.ui), ['title-card'], `only the title moved: ${JSON.stringify(saved.ui)}`);
    const e = saved.ui['title-card'];
    near(e.p[0], p2.p[0], 0.06, 'saved offset x');
    near(e.p[1], p2.p[1], 0.06, 'saved offset y');
    near(e.s, p2.s, 0.0001, 'saved scale');
    assert.equal(e.label, 'Glow Garden Tap the lanterns to light the garden'.slice(0, 40), 'the label: its text, first 40 characters');
    assert.equal(saved.dim, '3d');
    assert.deepEqual(saved.objects, {});
    assert.ok(Array.isArray(saved.uiView) && saved.uiView[0] > 500 && saved.uiView[1] > 400, `uiView ${saved.uiView}`);

    // 7. The game without the editor, at the same window size: the title where it was put (the drag; the size keeps
    // the middle), at that size.
    const plainUrl = await staticServer(root);
    const plain = await newPage(browser, { width: 1280, height: 800 });
    cleanups.push(() => plain.close());
    await plain.goto(`${plainUrl}/index.html`);
    await plain.waitFor(`document.querySelector('[data-studio-key="title-card"]').style.translate !== ''`, 30000);
    // `own`: where the game's CSS alone puts it (translate / scale taken off for a moment).
    const shown = JSON.parse(await plain.eval(`(() => { const e = document.querySelector('[data-studio-key="title-card"]'); const r = e.getBoundingClientRect();
      const t = e.style.translate, s = e.style.scale; e.style.translate = ''; e.style.scale = ''; const o = e.getBoundingClientRect(); e.style.translate = t; e.style.scale = s;
      return JSON.stringify({ cx: r.left + r.width / 2, cy: r.top + r.height / 2, ox: o.left + o.width / 2, oy: o.top + o.height / 2, w: r.width, bw: e.offsetWidth, bh: e.offsetHeight, scale: e.style.scale, transform: getComputedStyle(e).transform, hasStudio: !!window.__gameStudio }); })()`));
    assert.equal(shown.hasStudio, false, 'opened without the editor');
    // The saved p also holds the size's correction (it keeps the middle), so the middle is the game's own place
    // (left 50 %, top 42 %, centred by its transform) plus the drag.
    near(shown.cx, shown.ox + (t1.cx - t0.cx), 2, 'reopened: x (the game\'s own place + the drag)');
    near(shown.cy, shown.oy + (t1.cy - t0.cy), 2, 'reopened: y');
    assert.equal(Number(shown.scale), e.s, 'reopened: the size');
    // Its own transform is still translate(-50%, -50%) of its box (the box may wrap differently in another window).
    const mx = shown.transform.match(/matrix\(1, 0, 0, 1, ([-\d.]+), ([-\d.]+)\)/);
    assert.ok(mx, `reopened: the game's transform is a plain move (${shown.transform})`);
    near(Number(mx[1]), -shown.bw / 2, 0.6, 'reopened: the game\'s translate(-50%) x');
    near(Number(mx[2]), -shown.bh / 2, 0.6, 'reopened: the game\'s translate(-50%) y');
    if (SHOTS) writeFileSync(join(SHOTS, 'ui-pc-plain-game.png'), await plain.screenshot());

    // 8. Undo across the layers.
    await key(page, 'u');
    await page.waitFor(`${DBG}.layer() === 'world'`, 3000);
    await key(page, 'z', MOD);
    await page.waitFor(`${DBG}.layer() === 'ui'`, 3000);
    await sleep(300);
    const u1 = await poseOf(page, 'title-card');
    assert.ok(u1.s < p2.s, `undo: the size goes back first (${u1.s})`);
    // The two "+" were two steps, the drag one more.
    await key(page, 'z', MOD);
    await key(page, 'z', MOD);
    await sleep(300);
    const u2 = await poseOf(page, 'title-card');
    assert.deepEqual([Math.round(u2.p[0]), Math.round(u2.p[1]), u2.s], [0, 0, 1], 'undo: back to where the game puts it');
    const t3 = await boxOf(page, 'title-card');
    near(t3.cx, t0.cx, 1, 'undo: on screen (x)');
    near(t3.cy, t0.cy, 1, 'undo: on screen (y)');
    assert.equal(await page.eval(`${WIN}.document.querySelector('[data-studio-key="title-card"]').style.translate`), '', 'undo leaves no inline translate');
    await key(page, 'z', MOD | 8);
    await key(page, 'z', MOD | 8);
    await key(page, 'z', MOD | 8);
    await sleep(300);
    const r1 = await poseOf(page, 'title-card');
    near(r1.p[0], p2.p[0], 0.1, 'redo: x');
    near(r1.s, p2.s, 0.0001, 'redo: size');
    // The world still edits as before.
    await key(page, 'u');
    await page.waitFor(`${DBG}.layer() === 'world'`, 3000);
    assert.equal(await page.eval(`${WIN}.document.getElementById('studio-edit-layer')?.textContent || ''`).then((s) => /opacity\(0\)/.test(s)), true, 'back on the world, the UI is hidden');
    await page.eval(`studioShell.actions.select('lantern-3')`);
    await sleep(400);
    const l0 = JSON.parse(await page.eval(`JSON.stringify(${DBG}.list().find((i) => i.key === 'lantern-3').pose.p)`));
    await key(page, 'ArrowRight');
    await key(page, 'ArrowRight');
    await sleep(500);
    const l1 = JSON.parse(await page.eval(`JSON.stringify(${DBG}.list().find((i) => i.key === 'lantern-3').pose.p)`));
    assert.ok(Math.hypot(l1[0] - l0[0], l1[2] - l0[2]) > 0.01, `the lantern moved (${l0} → ${l1})`);
    // Play: the game as it is — no editing style, the UI drawn and pressable.
    await page.eval(`studioShell.actions.select(null)`);
    await page.eval(`document.activeElement?.blur?.()`);
    await key(page, 'p');
    // The lantern's two steps above are not saved, so ▶ Play asks first (the window before Play, v0.1.17,
    // test/studio-play-choice.browser.mjs). This test waited for Play without answering it and ran out of time here
    // (polish-1022, 2026-10-22): answer "Try without saving", which plays with the change and keeps it unsaved.
    await page.waitFor(`(() => { const g = document.querySelector('[data-part=unsaved-guard]'); return !!g && !g.hidden && g.dataset.kind === 'play'; })()`, 4000);
    await page.eval(`document.querySelector('[data-part=unsaved-guard] [data-action=guard-discard]').click()`);
    await page.waitFor(`!${WIN}.document.getElementById('studio-edit-layer')`, 8000);
    const hp = await uiLook(page);
    assert.deepEqual([hp.title.filter, hp.start.filter, hp.start.pointer], ['none', 'none', 'auto'], 'playing: the UI as the game draws it');
    const errors = page.logs.filter((l) => l.startsWith('exception'));
    assert.deepEqual(errors, [], 'page errors');
  });

  if (!ONLY || ONLY === 'phone') await run('phone 390×844: icons-only switch over the game, tap, drag', async () => {
    const { srv, browser } = await open(join(PKG, 'examples/three-hud'));
    const page = await newPage(browser, { width: 390, height: 844, mobile: true });
    await page.goto(`${srv.url}&lang=${LANG}`);
    await waitEditing(page);
    await sleep(1500);
    const sw = JSON.parse(await page.eval(`(() => { const s = document.querySelector('[data-part=layer-switch]'); const r = s.getBoundingClientRect(); const b = s.querySelector('[data-layer=ui]').getBoundingClientRect();
      return JSON.stringify({ inStage: !!s.closest('.stage'), text: s.innerText.trim(), cx: r.left + r.width / 2, w: b.width, h: b.height, ux: b.left + b.width / 2, uy: b.top + b.height / 2 }); })()`));
    assert.ok(sw.inStage, 'over the game');
    assert.equal(sw.text, '', 'icons only');
    near(sw.cx, 195, 2, 'in the middle');
    assert.ok(sw.w >= 44 && sw.h >= 40, `a finger's size (${sw.w}×${sw.h})`);
    if (SHOTS) writeFileSync(join(SHOTS, 'ui-phone-world.png'), await page.screenshot());
    // The UI hidden on the world, the eye a finger's size next to the switch; a tap shows it, another hides it.
    const p0 = await uiLook(page);
    assert.equal(p0.title.filter, 'opacity(0)', 'phone: hidden on the world');
    assert.ok(p0.eye && !p0.eye.hidden && p0.eye.text === '' && p0.eye.w >= 44 && p0.eye.h >= 40, `phone: the eye ${JSON.stringify(p0.eye)}`);
    assert.ok(p0.eye.cx + p0.eye.w / 2 <= 390, 'phone: the eye is on screen');
    await page.tap(p0.eye.cx, p0.eye.cy);
    await page.waitFor(`${WIN}.getComputedStyle(${WIN}.document.querySelector('[data-studio-key="title-card"]')).filter === 'opacity(0.5)'`, 3000);
    if (SHOTS) writeFileSync(join(SHOTS, 'ui-phone-world-peek.png'), await page.screenshot());
    await page.tap(p0.eye.cx, p0.eye.cy);
    await page.waitFor(`${WIN}.getComputedStyle(${WIN}.document.querySelector('[data-studio-key="title-card"]')).filter === 'opacity(0)'`, 3000);
    // A tap where the UI sits picks the world behind it.
    let behind = null;
    for (const k of ['start-button', 'title-card']) if (!behind) behind = await worldUnder(page, k);
    assert.ok(behind, 'phone: a world object under the UI');
    for (let i = 0; i < 3 && (await page.eval(`studioShell.selected()`)) !== behind.key; i++) {
      if (i) await sleep(600);
      await page.tap(behind.x, behind.y);
      await page.waitFor(`studioShell.selected() === '${behind.key}'`, 1500).catch(() => {});
    }
    assert.equal(await page.eval(`studioShell.selected()`), behind.key, 'phone: the world object behind the UI is picked');
    await page.eval(`studioShell.actions.select(null)`);
    await sleep(400);
    await page.tap(sw.ux, sw.uy);
    await page.waitFor(`${DBG}.layer() === 'ui'`, 4000);
    await sleep(500);
    const t0 = await boxOf(page, 'title-card');
    for (let i = 0; i < 3 && (await page.eval(`studioShell.selected()`)) !== 'title-card'; i++) {
      if (i) await sleep(600);
      await page.tap(t0.cx, t0.cy);
      await page.waitFor(`studioShell.selected() === 'title-card'`, 1500).catch(() => {});
    }
    assert.equal(await page.eval(`studioShell.selected()`), 'title-card');
    await sleep(600);
    if (SHOTS) writeFileSync(join(SHOTS, 'ui-phone-ui.png'), await page.screenshot());
    const t1 = await boxOf(page, 'title-card');
    await page.touchDrag(t1.cx, t1.cy, t1.cx, t1.cy - 120, 10);
    await sleep(500);
    const t2 = await boxOf(page, 'title-card');
    near(t2.cy - t1.cy, -120, 2, 'moved up by the drag');
    near(t2.cx, t1.cx, 1.5, 'not sideways');
    if (SHOTS) writeFileSync(join(SHOTS, 'ui-phone-moved.png'), await page.screenshot());
    const errors = page.logs.filter((l) => l.startsWith('exception'));
    assert.deepEqual(errors, [], 'page errors');
  });

  // A game that is all HTML (no world): the editor opens on the UI alone (no switch: one layer) after ~1 s, not 8,
  // and the file says dim 2d with no objects.
  if (!ONLY || ONLY === 'html') await run('HTML only (no world): the UI alone, saved as ui with dim 2d', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'studio-ui-html-'));
    cleanups.push(async () => rmSync(dir, { recursive: true, force: true }));
    writeFileSync(join(dir, 'index.html'), `<!doctype html><html><head><meta charset="utf-8"><title>Quiz Night</title>
<style>html,body{margin:0;height:100%;background:#123;color:#fff;font:600 20px system-ui}
.q{position:absolute;left:50%;top:30%;translate:-50% 0;font-size:40px}.score{position:fixed;right:20px;top:16px}</style></head>
<body><div class="q" data-studio-key="question">Which planet is red?</div><div class="score" data-studio-key="score">Score 0</div>
<script>requestAnimationFrame(function f(){ requestAnimationFrame(f); });</script></body></html>`);
    const { root, srv, browser } = await open(dir);
    const page = await newPage(browser, { width: 1280, height: 800 });
    const t = Date.now();
    await page.goto(srv.url);
    await waitEditing(page);
    const took = Date.now() - t;
    assert.equal(await page.eval(`${DBG}.layer()`), 'ui');
    assert.equal(await page.eval(`studioShell.items().map((i) => i.key).join(' ')`), 'question score');
    assert.equal(await page.eval(`!!document.querySelector('[data-part=layer-switch]:not([hidden])')`), false, 'one layer: no switch');
    assert.ok(took < 7000, `opened in ${took} ms (not the world's 8 s wait)`);
    await sleep(800);
    // The question (the middle; the score sits under the card's corner once something is picked).
    const b = await boxOf(page, 'question');
    await page.click(b.cx, b.cy);
    await page.waitFor(`studioShell.selected() === 'question'`, 3000);
    await page.mouseDrag(b.cx, b.cy, b.cx - 30, b.cy + 20, 6);
    await sleep(400);
    const st = JSON.parse(await page.eval(`JSON.stringify({ pose: ${DBG}.list().find((i) => i.key === 'question').pose, save: document.querySelector('[data-action=save]')?.innerText || '' })`));
    assert.deepEqual(st.pose.p.map(Math.round), [-30, 20], `moved: ${JSON.stringify(st)}`);
    await page.eval(`studioShell.actions.save()`);
    const file = join(root, 'placement.json');
    for (let i = 0; i < 60 && !existsSync(file); i++) await sleep(150);
    await sleep(500);
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(saved.dim, '2d');
    assert.deepEqual(saved.objects, {});
    assert.deepEqual(Object.keys(saved.ui), ['question']);
    assert.deepEqual(saved.ui.question.p.map(Math.round), [-30, 20]);
    const errors = page.logs.filter((l) => l.startsWith('exception'));
    assert.deepEqual(errors, [], 'page errors');
  });

  if (!ONLY || ONLY === 'plain') {
    // The editor before UI stage 1, from git, for the byte comparison.
    const before = mkdtempSync(join(tmpdir(), 'studio-ui-before-'));
    for (const f of ['index.html', 'shell.css', 'studio-edit.js', 'studio-shell.js']) {
      writeFileSync(join(before, f), execFileSync('git', ['show', `${BEFORE}:oss/game-studio/skills/arrange/bin/studio-ui/${f}`], { cwd: PKG, maxBuffer: 64 << 20 }));
    }
    for (const g of [{ id: 'lantern-cove', pick: 'lighthouse' }, { id: 'firefly-ruins', pick: 'urn' }]) {
      await run(`no data-studio-key (${g.id}): no switch, and placement.json byte for byte as before UI stage 1`, async () => {
        const files = [];
        for (const uiDir of [before, join(PKG, 'skills/arrange/bin/studio-ui')]) {
          const { root, srv, browser } = await open(join(PKG, 'starters', g.id), uiDir);
          const page = await newPage(browser, { width: 1280, height: 800 });
          await page.goto(srv.url);
          await waitEditing(page);
          await sleep(1500);
          if (uiDir !== before) {
            const s = await page.eval(`JSON.stringify({ sw: !!document.querySelector('[data-part=layer-switch]:not([hidden])'), style: !!${WIN}.document.getElementById('studio-edit-layer'), layer: ${DBG}.layer?.() })`);
            assert.deepEqual(JSON.parse(s), { sw: false, style: false, layer: 'world' }, `${g.id}: as before`);
            // U does nothing here (no UI layer).
            await key(page, 'u');
            assert.equal(await page.eval(`${DBG}.layer()`), 'world');
          }
          await page.eval(`studioShell.actions.select('${g.pick}')`);
          await page.waitFor(`studioShell.selected() === '${g.pick}'`, 3000);
          await sleep(800);
          await page.eval(`document.activeElement?.blur?.()`);
          // Three steps, each one seen to land before the next (a key pressed while the pick was still settling
          // was once lost in one of the two runs, and the files differed by a step, not by the editor).
          // 3D: turn steps (E), not arrow moves — an arrow move rides the ground (snap to surfaces), whose carrying
          // point was fixed after BEFORE when the branches were merged (2026-10-19); a difference there is not UI stage 1's.
          const stepKey = g.id === 'lantern-cove' ? 'e' : 'ArrowRight';
          const at = () => page.eval(`JSON.stringify(${DBG}.list().find((i) => i.key === '${g.pick}').pose)`);
          for (let i = 0; i < 3; i++) {
            const before = await at();
            await key(page, stepKey);
            await page.waitFor(`JSON.stringify(${DBG}.list().find((i) => i.key === '${g.pick}').pose) !== ${JSON.stringify(before)}`, 3000);
          }
          await sleep(500);
          await page.eval(`studioShell.actions.save()`);
          const file = join(root, 'placement.json');
          for (let i = 0; i < 60 && !existsSync(file); i++) await sleep(150);
          await sleep(800);
          files.push(readFileSync(file));
          for (const c of cleanups.splice(0).reverse()) await c().catch(() => {});
        }
        assert.ok(files[0].length > 50, 'the old editor saved a move');
        assert.ok(!files[1].includes('"ui"'), 'no ui field');
        assert.ok(files[0].equals(files[1]), `the same bytes:\n--- before\n${files[0]}\n--- now\n${files[1]}`);
      });
    }
    rmSync(before, { recursive: true, force: true });
  }
} finally {
  for (const c of cleanups.splice(0).reverse()) await c().catch(() => {});
}
if (failed) process.exit(1);
console.log('studio-ui-layer: ok');
