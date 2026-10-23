// The right-click / long-press menu, per place, in a headless browser (context menu, 2026-10-18 — a request after a try of the editor: "right-click
// in each place should bring up the menu for it — in the scene, duplicate, delete, that kind of thing").
//
//   node test/studio-context-menu.browser.mjs [--shots <dir>] [--only pc,phone] [--theme light|dark|both]
//                                             [--game lantern-cove,firefly-ruins] [--lang en|ja]
//
// Lantern Cove (3D) and Firefly Ruins (2D), PC 1280×800 with a mouse (right button) and a phone 390×844 with a finger
// (a press held still), light and dark, with the real server and the built editor:
//   1. on an object in the game that is not picked: it is picked first, the object's menu opens next to the point
//      (inside the window), the camera did not move, nothing the floating panels cover changed (the strip stayed);
//      the keys at the right end are the shortcut table's (PC) and phones show none
//   2. Esc closes it (PC) / a tap outside closes it and does nothing else (phone): the pick stays, the view stays
//   1b. short (design review 2, item ②): PC 7 rows at most in 3D (+ to front / to back in 2D), no Undo / Redo, no Paste
//      with nothing copied; a phone 5 rows at most, none dimmed, no Duplicate / Copy / Paste / Delete (the card has
//      them), and the menu ends 8 px above the card and the ask box
//   3. choosing works (PC): Duplicate makes a copy (one more object); ↓ to Duplicate and Enter does the same as the mouse
//   4. on an empty spot of the game WITH something picked: the scene's menu, not the pick's (review 2: the sky beside
//      the lighthouse) — Select all · Deselect · Show all · …, no dimmed row; Deselect drops the pick and is gone from
//      the menu after it; Select all picks everything
//   5. on a row of the scene list (PC: the left column; phone: the list sheet): the row's object is picked and the
//      object's menu opens; 2D (layers) lists to front / to back only
//   6. the Library: an object's tile → Add to scene · Ask your AI… · Show in game · Delete (no Duplicate); a file's
//      tile → Add to scene · Ask your AI… · Replace… (review 2 ①); "Show in game" goes back
//   7. the browser's own menu never shows in the editor (contextmenu prevented), except in a text field
//   8. phone: a long press on the strip's turn button (3D) still opens the strip's choices, not this menu
// Pictures (--shots <dir>): <game>-<layout>-<theme>-1-object / 2-scene / 3-list / 4-lib-object / 5-lib-file.png
// Each run uses a temporary copy of the starter. Exit 1 on failure.
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStudioServer } from '../src/server/server.mjs';
import { launch, newPage } from './adapters-2d/cdp.mjs';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const take = (flag, d) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : d);
const SHOTS = take('--shots', null) ? resolve(take('--shots')) : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const LAYOUTS = take('--only', 'pc,phone').split(',');
const THEMES = take('--theme', 'both') === 'both' ? ['dark', 'light'] : [take('--theme')];
const GAMES = take('--game', 'lantern-cove,firefly-ruins').split(',');
const LANG = take('--lang', 'en');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// pick: an object to right-click; empty: where to look for nothing (share of the game frame [x0, y0, x1, y1]).
const GAME = {
  'lantern-cove': { pick: 'lighthouse', empty: [0.5, 0.05, 0.8, 0.3], file: 'assets/planks.jpg' },
  'firefly-ruins': { pick: 'urn', empty: [0.1, 0.12, 0.6, 0.4], file: null },
};
const WIN = `document.querySelector('iframe.game:not(.leaving)').contentWindow`;
const DBG = `${WIN}.__gameStudio?._debug`;
const ROOT = `${WIN}.document.querySelector('[data-studio-ui]').shadowRoot`;
// Is (x, y) (page px) an empty spot of the game: the frame on top, nothing under it or 40 px around (a finger's slack).
const EMPTY = (x, y) => `(() => { const f = document.querySelector('iframe.game:not(.leaving)'); const r = f.getBoundingClientRect();
  if (document.elementFromPoint(${x}, ${y}) !== f) return false;
  const gx = ${x} - r.left, gy = ${y} - r.top, g = f.contentWindow;
  const hit = g.document.elementFromPoint(gx, gy); if (!hit || hit.closest('[data-studio-ui]')) return false;
  for (const [dx, dy] of [[0, 0], [40, 0], [-40, 0], [0, 40], [0, -40], [28, 28], [-28, 28], [28, -28], [-28, -28]]) {
    const px = gx + dx, py = gy + dy; if (px < 0 || py < 0 || px > r.width || py > r.height) return false;
    if (g.__gameStudio._debug.under(px, py)) return false; }
  return true; })()`;
// A point of the object nothing stands in front of (page px).
const POINT = (key) => `(() => { const f = document.querySelector('iframe.game:not(.leaving)').getBoundingClientRect(); const a = ${DBG}.anchor(${JSON.stringify(key)});
  const r = a.rect; const u = ${DBG}.under;
  for (let fy = 0.5; fy < 1; fy += 0.1) for (const fx of [0.5, 0.4, 0.6, 0.3, 0.7]) { const x = r.x + r.w * fx, y = r.y + r.h * fy;
    if (u(x, y) === ${JSON.stringify(key)}) return JSON.stringify([f.left + x, f.top + y]); }
  return JSON.stringify([f.left + a.center[0], f.top + a.center[1]]); })()`;
const MENU = `(() => { const m = document.querySelector('.ctx-menu'); if (!m || m.hidden) return 'null'; const r = m.getBoundingClientRect();
  return JSON.stringify({ place: m.dataset.place, l: r.left, t: r.top, w: r.width, h: r.height,
    rows: [...m.querySelectorAll('.ctx-row')].map((b) => ({ id: b.dataset.action.slice(4), label: b.querySelector('.ctx-label').textContent, key: b.querySelector('.ctx-key')?.textContent || '', off: b.disabled })) }); })()`;

let failed = 0;

async function run(game, layout, theme) {
  const touch = layout === 'phone';
  const g = GAME[game];
  const tag = `${game}-${layout}-${theme}`;
  const root = mkdtempSync(join(tmpdir(), `studio-context-menu-${game}-`));
  cpSync(join(PKG, 'starters', game), root, { recursive: true });
  mkdirSync(join(root, '.studio/ui'), { recursive: true });
  writeFileSync(join(root, '.studio/ui/prefs.json'), JSON.stringify({ version: 1, lang: LANG, theme }));
  const srv = await startStudioServer({ root, uiDir: join(PKG, 'skills/arrange/bin/studio-ui'), log: () => {} });
  const browser = await launch();
  const page = await newPage(browser, { ...(touch ? { width: 390, height: 844, mobile: true } : { width: 1280, height: 800 }), cdnCache: process.env.STUDIO_CDN_CACHE });
  const ok = (m) => console.log(`  ✓ ${tag}: ${m}`);
  const j = async (expr) => JSON.parse((await page.eval(expr)) || 'null');
  const shot = async (name) => {
    if (SHOTS) writeFileSync(join(SHOTS, `${tag}-${name}.png`), await page.screenshot());
  };
  const selected = () => page.eval('studioShell.selected()');
  const picked = () => j(`JSON.stringify(document.querySelectorAll('.obj[aria-selected=true]').length)`);
  const view = () => page.eval(`JSON.stringify(${DBG}.view())`);
  const count = () => page.eval('studioShell.items().length');
  const menu = () => j(MENU);
  const ids = (m) => m.rows.map((r) => r.id);
  /** The way to open a menu here: the right button (PC) or a finger held still (phone). */
  const open = async (x, y) => {
    if (touch) {
      await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
      // 900 ms: well past UI.longPressMs (450) even when a loaded machine runs the page's timers late (700 was flaky).
      await sleep(900);
      await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'right', buttons: 2, clickCount: 1 });
      await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'right', buttons: 0, clickCount: 1 });
    }
    await page.waitFor(`!document.querySelector('.ctx-menu').hidden`, 3000).catch(() => {});
    await sleep(200);
  };
  const press = async (x, y) => (touch ? page.tap(x, y) : page.click(x, y));
  /** A real press on a menu row. */
  const choose = async (id) => {
    const at = await j(`(() => { const b = document.querySelector('.ctx-menu [data-action="ctx-${id}"]'); if (!b) return 'null'; const r = b.getBoundingClientRect(); return JSON.stringify([r.left + r.width / 2, r.top + r.height / 2]); })()`);
    assert.ok(at, `${tag}: the menu has ${id}`);
    await press(at[0], at[1]);
    await sleep(500);
  };
  const key = async (k, code = k, vk = 0) => {
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk });
    await sleep(200);
  };
  /** The menu is beside the point and wholly inside the window. */
  const near = (m, x, y, what) => {
    const W = touch ? 390 : 1280, H = touch ? 844 : 800;
    assert.ok(m.l >= 7 && m.t >= 7 && m.l + m.w <= W - 7 && m.t + m.h <= H - 7, `${what}: the menu is inside the window (${JSON.stringify(m)})`);
    // Beside the point: its top or bottom edge within 40 px of it (a finger: above it when there is room). A menu taller
    // than the room above AND below the finger (2D on a phone, the finger mid-screen) is pinned inside the window.
    if (touch && m.h > y - 24 && m.h > H - 8 - (y + 24)) return;
    assert.ok(Math.abs(m.l + (touch ? m.w / 2 : 0) - x) < m.w + 4 && Math.min(Math.abs(m.t - y), Math.abs(m.t + m.h - y)) < 40, `${what}: the menu opens at the point (${x}, ${y}) → ${m.l}, ${m.t} (${m.w}×${m.h})`);
  };
  const keysShown = (m, what) => {
    const dup = m.rows.find((r) => r.id === 'duplicate');
    if (touch) assert.ok(m.rows.every((r) => !r.key), `${what}: no keys on a phone`);
    else if (dup) assert.match(dup.key, /^(⌘D|Ctrl\+D)$/, `${what}: Duplicate shows its key`);
  };
  try {
    await page.goto(srv.url);
    await page.waitFor(`document.querySelectorAll('.obj').length > 0 && !!${DBG}`, 90000);
    await sleep(1500);
    const n0 = await count();
    const v0 = await view();

    // ---- 1. an object in the game, not picked yet: picked first, its menu at the point, no camera move ----
    const [px, py] = await j(POINT(g.pick));
    assert.equal(await selected(), null, 'nothing picked at the start');
    await open(px, py);
    assert.equal(await selected(), g.pick, `${tag}: the press picked ${g.pick} first`);
    let m = await menu();
    assert.ok(m, `${tag}: the menu opened on ${g.pick}`);
    assert.equal(m.place, 'object');
    // studio-uniforms (2026-10-23): plain rows first (Rename in place, for a named object), the ✦ rows last.
    assert.ok(ids(m).indexOf('ask') > 0 && ids(m).slice(ids(m).indexOf('ask')).every((i) => ['ask', 'askMotion', 'name'].includes(i)), `${tag}: ✦ rows last (${ids(m)})`);
    for (const id of ['undo', 'redo', 'paste', 'layer-forward', 'layer-backward']) assert.ok(!ids(m).includes(id), `${tag}: no ${id} (${ids(m)})`);
    const layerRows = ids(m).filter((i) => i.startsWith('layer-')).length;
    if (touch) {
      assert.ok(m.rows.length <= 5, `${tag}: a phone's menu is 5 rows at most (${ids(m)})`);
      assert.ok(m.rows.every((r) => !r.off), `${tag}: no dimmed row on a phone (${ids(m)})`);
      for (const id of ['duplicate', 'copy', 'remove']) assert.ok(!ids(m).includes(id), `${tag}: no ${id} on a phone (the card has it)`);
      // Over neither the card nor the ask box.
      const floor = await j(`JSON.stringify(Math.min(...[document.querySelector('.card'), document.querySelector('.bar')].filter((e) => e && e.offsetParent).map((e) => e.getBoundingClientRect().top)))`);
      assert.ok(m.t + m.h <= floor - 8 + 0.5, `${tag}: the menu ends 8 px above the card / ask box (${m.t + m.h} vs ${floor})`);
    } else {
      for (const id of ['duplicate', 'copy', 'remove', 'showInLibrary']) assert.ok(ids(m).includes(id), `${tag}: object menu has ${id} (${ids(m)})`);
      assert.ok(m.rows.length - layerRows <= 7, `${tag}: 7 rows at most (${ids(m)})`);
      near(m, px, py, tag);
    }
    if (game === 'firefly-ruins') assert.ok(layerRows <= 2, `${tag}: to front / to back only`);
    keysShown(m, tag);
    assert.equal(await view(), v0, `${tag}: the camera did not move for the menu`);
    await page.eval(`document.activeElement?.blur?.()`);
    await shot('1-object');
    ok(`object menu: ${m.rows.map((r) => r.label + (r.key ? ` ${r.key}` : '')).join(' · ')}`);

    // ---- 2. closing: Esc (PC) / a tap outside (phone) — nothing else happens ----
    if (touch) {
      // Outside the menu: the game's top right (merge of 2026-10-19: with Drop to floor the phone menu has one more row
      // and opens higher, so the old point — the game's top left — fell on the menu itself).
      const [fx, fy] = await j(`(() => { const r = document.querySelector('iframe.game').getBoundingClientRect(); return JSON.stringify([r.right - 20, r.top + 60]); })()`);
      await page.tap(fx, fy);
    } else {
      await page.eval(`document.querySelector('.ctx-menu').focus()`);
      await key('Escape', 'Escape', 27);
    }
    await sleep(300);
    assert.equal(await menu(), null, `${tag}: the menu closed`);
    assert.equal(await selected(), g.pick, `${tag}: closing kept the pick`);
    assert.equal(await view(), v0, `${tag}: closing did not move the camera`);
    ok(touch ? 'a tap outside closes it, the pick and view stay' : 'Esc closes it, the pick and view stay');

    // ---- 3. choosing: Duplicate → one more, Undo → back; PC also with ↓ and Enter ----
    // The menu on what is already picked: the strip under it does not move by 1 px (wave 1's rule), nor the view.
    const strip0 = await j(`(() => { const e = ${ROOT}.querySelector('.row'); if (!e || !e.getBoundingClientRect().width) return 'null'; const r = e.getBoundingClientRect(); return JSON.stringify([r.left, r.top, r.width, r.height]); })()`);
    await open(px, py);
    const strip1 = await j(`(() => { const e = ${ROOT}.querySelector('.row'); if (!e || !e.getBoundingClientRect().width) return 'null'; const r = e.getBoundingClientRect(); return JSON.stringify([r.left, r.top, r.width, r.height]); })()`);
    assert.ok(strip0 && strip1, `${tag}: the strip is under the pick`);
    assert.ok(strip0.every((v, i) => Math.abs(v - strip1[i]) < 0.5), `${tag}: the strip stayed put when the menu opened (${strip0} → ${strip1})`);
    if (!touch) {
      await choose('duplicate');
      await page.waitFor(`studioShell.items().length === ${n0 + 1}`, 5000);
      // Undo is the top bar's (and ⌘Z), not the menu's.
      await page.eval(`studioShell.actions.undo()`);
      await page.waitFor(`studioShell.items().length === ${n0}`, 5000);
      await open(px, py);
      for (let i = 0; i < 8 && (await page.eval(`document.activeElement?.dataset?.action`)) !== 'ctx-duplicate'; i++) await key('ArrowDown', 'ArrowDown', 40);
      assert.equal(await page.eval(`document.activeElement?.dataset?.action`), 'ctx-duplicate', `${tag}: ↓ reaches Duplicate`);
      assert.ok(await page.eval(`document.activeElement.classList.contains('on')`), `${tag}: the row under the keys is highlighted`);
      await key('Enter', 'Enter', 13);
      await page.waitFor(`studioShell.items().length === ${n0 + 1}`, 5000);
      assert.equal(await menu(), null, `${tag}: Enter ran it and closed the menu`);
      await page.eval(`studioShell.actions.undo()`);
      await page.waitFor(`studioShell.items().length === ${n0}`, 5000);
    } else await key('Escape', 'Escape', 27);
    assert.equal(await view(), v0, `${tag}: the camera never moved`);
    ok(touch ? 'the strip stays put under the menu' : 'Duplicate from the menu, ↓ + Enter');

    // ---- 4. an empty spot: the scene's menu; Deselect, Select all ----
    const f = await j(`(() => { const r = document.querySelector('iframe.game:not(.leaving)').getBoundingClientRect(); return JSON.stringify([r.left, r.top, r.width, r.height]); })()`);
    let spot = null;
    const area = [f[0] + f[2] * g.empty[0], f[1] + f[3] * g.empty[1], f[0] + f[2] * g.empty[2], f[1] + f[3] * g.empty[3]];
    for (let y = area[1] + 6; !spot && y < area[3]; y += 12) for (let x = area[0] + 6; !spot && x < area[2]; x += 12) if (await page.eval(EMPTY(x, y))) spot = [x, y];
    assert.ok(spot, `${tag}: an empty spot in ${area.map(Math.round)}`);
    if (!(await selected())) await page.eval(`studioShell.actions.select(${JSON.stringify(g.pick)})`);
    await open(spot[0], spot[1]);
    m = await menu();
    assert.ok(m, `${tag}: a menu on the empty spot`);
    assert.equal(m.place, 'scene');
    assert.deepEqual(ids(m), ['selectAll', 'deselect', 'frame', 'home', 'ask'], `${tag}: the scene's rows`);
    assert.ok(m.rows.every((r) => !r.off), `${tag}: no dimmed row in the scene's menu`);
    assert.equal(await selected(), g.pick, `${tag}: a menu on nothing keeps the pick (Deselect is in it)`);
    near(m, spot[0], spot[1], `${tag} scene`);
    await page.eval(`document.activeElement?.blur?.()`);
    await shot('2-scene');
    await choose('deselect');
    assert.equal(await selected(), null, `${tag}: Deselect from the menu drops the pick`);
    await open(spot[0], spot[1]);
    assert.ok(!ids(await menu()).includes('deselect'), `${tag}: no Deselect with nothing picked`);
    await choose('selectAll');
    assert.ok(await selected(), `${tag}: Select all picked`);
    assert.ok((await picked()) > 1, `${tag}: Select all picked several (${await picked()} rows)`);
    assert.equal(await view(), v0, `${tag}: the scene's menu never moved the camera`);
    await page.eval(`studioShell.actions.select(null)`);
    ok(`scene menu: ${m.rows.map((r) => r.label).join(' · ')}`);

    // ---- 5. a row of the scene list ----
    if (touch) {
      await page.eval(`document.querySelector('[data-action=sheet]').click()`);
      await sleep(700);
    }
    const rowKey = await page.eval(`(() => { const r = [...document.querySelectorAll('.objects .obj[data-key]')].find((e) => !e.dataset.group && e.dataset.key !== ${JSON.stringify(g.pick)} && e.getBoundingClientRect().height); return r ? r.dataset.key : null; })()`);
    assert.ok(rowKey, `${tag}: a list row to press`);
    const rowAt = await j(`(() => { const e = document.querySelector('.objects .obj[data-key=${JSON.stringify(rowKey)}]'); e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return JSON.stringify([r.left + Math.min(80, r.width / 2), r.top + r.height / 2]); })()`);
    await sleep(300);
    await open(rowAt[0], rowAt[1]);
    m = await menu();
    assert.ok(m, `${tag}: a menu on the list row ${rowKey}`);
    assert.equal(m.place, 'object');
    assert.equal(await selected(), rowKey, `${tag}: the row's object was picked first`);
    if (game === 'firefly-ruins') assert.ok((ids(m).includes('layer-toFront') || ids(m).includes('layer-toBack')) && !ids(m).includes('layer-forward'), `${tag}: 2D lists to front / to back only (${ids(m)})`);
    else assert.ok(!ids(m).includes('layer-forward'), `${tag}: 3D has no draw-order rows`);
    assert.equal(await view(), v0, `${tag}: a row's menu did not move the camera`);
    await page.eval(`document.activeElement?.blur?.()`);
    await shot('3-list');
    // A press outside on the desk closes it.
    await page.eval(`document.querySelector('.ctx-catch').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`);
    await sleep(200);
    assert.equal(await menu(), null, `${tag}: a press outside closed the row's menu`);
    if (touch) {
      await page.eval(`document.querySelector('[data-action=sheet]').click()`);
      await sleep(500);
    }
    ok('list row: picked, then its menu');

    // ---- 6. the Library ----
    await page.eval(`studioShell.actions.select(null)`);
    await page.eval(`studioShell.actions.switchTool('library')`);
    await page.waitFor(`document.querySelectorAll('.assets-page .lib-object').length > 0 && document.querySelectorAll('.assets-page .gsl-tile[data-kind=file]').length > 0`, 20000);
    await sleep(800);
    const tileAt = async (sel) => j(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return 'null'; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return JSON.stringify([r.left + r.width / 2, r.top + r.height / 3]); })()`);
    const objTile = await page.eval(`(() => { const t = document.querySelector('.assets-page .lib-object:not([data-group])') || document.querySelector('.assets-page .lib-object'); return t.dataset.key; })()`);
    let at = await tileAt(`.assets-page .lib-object[data-key="${objTile}"]`);
    await sleep(300);
    at = await tileAt(`.assets-page .lib-object[data-key="${objTile}"]`);
    await open(at[0], at[1]);
    m = await menu();
    assert.ok(m, `${tag}: a menu on the Library's object tile`);
    assert.equal(m.place, 'libObject');
    assert.deepEqual(ids(m), ['addToScene', 'showInGame', 'remove', 'ask']);
    assert.ok(await selected(), `${tag}: the tile's object was picked`);
    assert.ok(await page.eval(`!!document.querySelector('.assets-page .gsl-detail:not([hidden]) .lib-object-detail')`), `${tag}: its detail shows`);
    await page.eval(`document.activeElement?.blur?.()`);
    await shot('4-lib-object');
    // Esc with the focus outside the menu (blurred for the picture) still closes the menu, and only the menu.
    const pick4 = await selected();
    await key('Escape', 'Escape', 27);
    assert.equal(await menu(), null, `${tag}: Esc closes the menu wherever the focus is`);
    assert.equal(await selected(), pick4, `${tag}: that Esc closed the menu only (the pick stays)`);
    // A file tile (one objects use, where the game has one).
    const fileSel = g.file ? `.assets-page .gsl-tile[data-kind=file][data-path="${g.file}"]` : `.assets-page .gsl-tile[data-kind=file]`;
    at = await tileAt(fileSel);
    await sleep(300);
    at = await tileAt(fileSel);
    await open(at[0], at[1]);
    m = await menu();
    assert.ok(m, `${tag}: a menu on a file tile`);
    assert.equal(m.place, 'libFile');
    assert.deepEqual(ids(m), ['replace', 'addFile', 'askFile']);
    assert.ok(await page.eval(`!!document.querySelector('.assets-page .gsl-detail:not([hidden])[data-kind=file]')`), `${tag}: the file's detail opened`);
    await page.eval(`document.activeElement?.blur?.()`);
    await shot('5-lib-file');
    await choose('replace');
    assert.ok(await page.eval(`!!document.querySelector('.assets-page .gsl-picker')`), `${tag}: Replace… opened the picker`);
    // Show in game from an object tile goes back to the game with the pick.
    at = await tileAt(`.assets-page .lib-object`);
    await sleep(300);
    at = await tileAt(`.assets-page .lib-object`);
    await open(at[0], at[1]);
    await choose('showInGame');
    await page.waitFor(`document.querySelector('.assets-page').hidden`, 5000);
    assert.ok(await selected(), `${tag}: Show in game keeps the pick`);
    ok('Library: object and file tiles');

    // ---- 7. the browser's own menu: never in the editor, still in a field ----
    const prevented = await page.eval(`(() => { const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }); document.querySelector('.top').dispatchEvent(e); return e.defaultPrevented; })()`);
    assert.equal(prevented, true, `${tag}: the browser's menu is kept out of the editor`);
    if (!touch) {
      const inField = await page.eval(`(() => { const i = document.querySelector('.ask-box input'); const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }); i.dispatchEvent(e); return e.defaultPrevented; })()`);
      assert.equal(inField, false, `${tag}: a text field keeps the browser's menu (cut, copy, paste)`);
    }
    await key('Escape', 'Escape', 27);

    // ---- 8. phone, 3D: a long press on the strip's turn button opens the strip's choices, not this menu ----
    if (touch && game === 'lantern-cove') {
      await page.eval(`studioShell.actions.select(${JSON.stringify(g.pick)})`);
      await sleep(800);
      const b = await j(`(() => { const o = document.querySelector('iframe.game:not(.leaving)').getBoundingClientRect(); const e = ${ROOT}.querySelector('[data-studio-handle=rotate]');
        if (!e || !e.getBoundingClientRect().width) return 'null'; const r = e.getBoundingClientRect(); return JSON.stringify([o.left + r.left + r.width / 2, o.top + r.top + r.height / 2]); })()`);
      assert.ok(b, `${tag}: the turn button is on screen`);
      await open(b[0], b[1]);
      assert.equal(await menu(), null, `${tag}: no place menu from the strip's long press`);
      await page.waitFor(`(() => { const m = ${ROOT}.querySelector('.menu'); return m.style.display !== 'none' && m.children.length > 0; })()`, 3000)
        .catch(() => assert.fail(`${tag}: the strip's choices opened`));
      ok('the strip keeps its own long press');
    }
    const errors = page.logs.filter((l) => l.startsWith('exception'));
    assert.deepEqual(errors, [], 'page errors');
  } catch (e) {
    failed++;
    console.log(`  ✗ ${tag}: ${e.message}`);
    if (SHOTS) writeFileSync(join(SHOTS, `${tag}-fail.png`), await page.screenshot());
  } finally {
    await page.close();
    await browser.close();
    await srv.close();
    rmSync(root, { recursive: true, force: true });
  }
}

for (const game of GAMES) for (const layout of LAYOUTS) for (const theme of THEMES) await run(game, layout, theme);
if (failed) process.exit(1);
console.log('studio-context-menu: ok');
