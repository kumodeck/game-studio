// Design review 2 (2026-10-19), items ①–⑥: the scene and its tools, measured the way the review measured them, in a
// headless browser with the real server and the built editor. One test for the six, so a "before" run on the old build
// and an "after" run on this one take the same pictures and print the same numbers (--before: measure and photograph,
// assert nothing).
//
//   node test/studio-review2-scene.browser.mjs [--shots <dir>] [--before] [--only pc|phone] [--theme light|dark|both]
//                                              [--game lantern-cove,firefly-ruins] [--part 1,2,3,4,5,6]
//
// PC 1280×800 (mouse) and phone 390×844 (touch), light and dark:
//   ① the Library's "Add to scene" (Lantern Cove: sea-stack and barrel; Firefly Ruins: urn): the copy's screen box is
//      at most 35 % of the game's height, its middle inside the middle 60 % both ways, and the strip is on screen;
//      the object's detail has no Duplicate
//   ② the menus: the lighthouse / urn's menu (PC 7 rows at most + to front / to back in 2D, no Undo / Redo; phone 5 at
//      most, none dimmed, 8 px above the card and the ask box); with it picked, a right-click / long press on the sky
//      at the review's point (1000, 120 on PC, beside the card) opens the SCENE's menu, with no dimmed row
//   ③ the turn ▾: one row as high as the strip, at most 1.5× its width, the chosen way not a black / white square;
//      the hint line 40 characters at most and clear of the camera's ↑ ↓ (phone); after Tilt forward, picking the pines
//      puts Turn back
//   ④ ⌘K (phone: "All actions") with the lighthouse picked: the first rows are Play · Duplicate · Delete · Copy · Show in
//      Library; no "Add 3 more … in a row" / "Make … glow" / Fit / Look / Add a tool; no keys printed on a phone
//   ⑤ the three pines (the list's "pine" row): the strip 12 px under the lowest pine on screen
//   ⑥ the lighthouse picked, a click / tap on the sky (1000,120 · 1100,180 · 600,100) and the water (700,650) — the
//      review's PC points, moved to the same share of the game frame on a phone: nothing is picked. A point the
//      editor's own card covers is reported (a click there is a click on the card) and the nearest bare sky beside the
//      card is used instead.
// Pictures: <part>-<game>-<layout>-<theme>-<what>.png. Exit 1 on failure (not with --before).
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
const BEFORE = args.includes('--before');
const LAYOUTS = take('--only', 'pc,phone').split(',');
const THEMES = take('--theme', 'both') === 'both' ? ['light', 'dark'] : [take('--theme')];
const GAMES = take('--game', 'lantern-cove,firefly-ruins').split(',');
const PARTS = take('--part', '1,2,3,4,5,6').split(',').map(Number);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const GAME = {
  'lantern-cove': { pick: 'lighthouse', add: ['sea-stack', 'barrel'], many: 'pine' },
  'firefly-ruins': { pick: 'urn', add: ['urn'], many: null },
};
const WIN = `document.querySelector('iframe.game:not(.leaving)').contentWindow`;
const DBG = `${WIN}.__gameStudio?._debug`;
const ROOT = `${WIN}.document.querySelector('[data-studio-ui]').shadowRoot`;
const FRAME = `(() => { const r = document.querySelector('iframe.game:not(.leaving)').getBoundingClientRect(); return JSON.stringify({ l: r.left, t: r.top, w: r.width, h: r.height }); })()`;
const MENU = `(() => { const m = document.querySelector('.ctx-menu'); if (!m || m.hidden) return 'null'; const r = m.getBoundingClientRect();
  return JSON.stringify({ place: m.dataset.place, l: r.left, t: r.top, w: r.width, h: r.height,
    rows: [...m.querySelectorAll('.ctx-row')].map((b) => ({ id: b.dataset.action.slice(4), off: b.disabled })) }); })()`;
// A point of the object nothing stands in front of (page px).
const POINT = (key) => `(() => { const f = document.querySelector('iframe.game:not(.leaving)').getBoundingClientRect(); const a = ${DBG}.anchor(${JSON.stringify(key)});
  const r = a.rect; const u = ${DBG}.under;
  for (let fy = 0.5; fy < 1; fy += 0.1) for (const fx of [0.5, 0.4, 0.6, 0.3, 0.7]) { const x = r.x + r.w * fx, y = r.y + r.h * fy;
    if (u(x, y) === ${JSON.stringify(key)}) return JSON.stringify([f.left + x, f.top + y]); }
  return JSON.stringify([f.left + a.center[0], f.top + a.center[1]]); })()`;
/** In the strip's shadow root, in page px. */
const IN_STRIP = (sel) => `(() => { const o = document.querySelector('iframe.game:not(.leaving)').getBoundingClientRect();
  const b = ${ROOT}.querySelector(${JSON.stringify(sel)}); if (!b || b.hidden || !b.getBoundingClientRect().width || getComputedStyle(b).display === 'none') return 'null'; const r = b.getBoundingClientRect();
  return JSON.stringify({ x: o.left + r.left + r.width / 2, y: o.top + r.top + r.height / 2, l: o.left + r.left, t: o.top + r.top, w: r.width, h: r.height }); })()`;

let failed = 0;
const report = [];

async function run(game, layout, theme) {
  const touch = layout === 'phone';
  const g = GAME[game];
  const tag = `${game}-${layout}-${theme}`;
  const root = mkdtempSync(join(tmpdir(), `studio-review2-${game}-`));
  cpSync(join(PKG, 'starters', game), root, { recursive: true });
  mkdirSync(join(root, '.studio/ui'), { recursive: true });
  writeFileSync(join(root, '.studio/ui/prefs.json'), JSON.stringify({ version: 1, lang: 'en', theme }));
  // No KUMODeck sign-in (studio-library-shelf, 2026-10-23): the Library reads it at once now for its "✦ Make with AI" words,
  // and the real ~/.kumo of the machine running this must not be read (nor its balance land in a picture).
  const srv = await startStudioServer({ root, kumo: { home: join(root, '.no-kumo-home'), env: {} }, uiDir: join(PKG, 'skills/arrange/bin/studio-ui'), log: () => {} });
  const browser = await launch();
  const page = await newPage(browser, { ...(touch ? { width: 390, height: 844, mobile: true } : { width: 1280, height: 800 }), cdnCache: process.env.STUDIO_CDN_CACHE });
  const j = async (expr) => JSON.parse((await page.eval(expr)) || 'null');
  const note = (part, m) => {
    console.log(`  ${part} ${tag}: ${m}`);
    report.push(`${part} ${tag}: ${m}`);
  };
  /** An assertion that only counts after the fix (--before prints what it found instead). */
  const check = (cond, msg) => {
    if (BEFORE) {
      if (!cond) console.log(`    (before) ng: ${msg}`);
      return;
    }
    assert.ok(cond, `${tag}: ${msg}`);
  };
  const shot = async (part, name) => {
    if (SHOTS) writeFileSync(join(SHOTS, `${part}-${tag}-${name}.png`), await page.screenshot());
  };
  const selected = () => page.eval('studioShell.selected()');
  const press = async (x, y) => (touch ? page.tap(x, y) : page.click(x, y));
  const pressSel = async (sel) => {
    const at = await j(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return 'null'; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return JSON.stringify([r.left + r.width / 2, r.top + r.height / 2]); })()`);
    assert.ok(at, `${tag}: ${sel} is there`);
    await sleep(250);
    await press(at[0], at[1]);
    await sleep(400);
  };
  const key = async (k, code = k, vk = 0, modifiers = 0) => {
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers });
    await sleep(200);
  };
  const openMenu = async (x, y) => {
    if (touch) {
      await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
      await sleep(900);
      await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'right', buttons: 2, clickCount: 1 });
      await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'right', buttons: 0, clickCount: 1 });
    }
    await page.waitFor(`!document.querySelector('.ctx-menu').hidden`, 3000).catch(() => {});
    await sleep(250);
  };
  const closeMenu = async () => {
    await page.eval(`document.querySelector('.ctx-menu').hidden || document.querySelector('.ctx-catch').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`);
    await sleep(200);
  };
  /** Pick by clicking the object in the game (no camera move), as a person does. */
  const pickInGame = async (k) => {
    if ((await selected()) === k) return;
    const [x, y] = await j(POINT(k));
    await press(x, y);
    await sleep(500);
  };
  /** The review's PC point (page px at 1280×800) as the same share of this game frame. */
  const reviewPoint = (f, x, y) => {
    if (!touch) return [x, y];
    const PC = { l: 248, t: 44, w: 1024, h: 748 };
    return [f.l + ((x - PC.l) / PC.w) * f.w, f.t + ((y - PC.t) / PC.h) * f.h];
  };
  const onGame = (x, y) => page.eval(`document.elementFromPoint(${x}, ${y}) === document.querySelector('iframe.game:not(.leaving)')`);
  try {
    await page.goto(srv.url);
    await page.waitFor(`document.querySelectorAll('.obj').length > 0 && !!${DBG}`, 90000);
    await sleep(1500);
    const f = await j(FRAME);

    // ---------- ① Add to scene: where the copy lands ----------
    if (PARTS.includes(1)) {
      for (const k of g.add) {
        const n0 = await page.eval('studioShell.items().length');
        await page.eval(`studioShell.actions.select(null)`);
        await page.eval(`studioShell.actions.switchTool('library')`);
        await page.waitFor(`document.querySelectorAll('.assets-page .lib-object').length > 0`, 20000);
        await sleep(600);
        // Found and measured in one go: the tiles are drawn again as their pictures arrive, and a press that straddles
        // that is lost — so press again until the detail shows.
        const TILE = `(() => { const t = document.querySelector('.assets-page .lib-object[data-key=${JSON.stringify(k)}]')
          || [...document.querySelectorAll('.assets-page .lib-object[data-group]')].find((e) => studioShell.items().some((i) => i.key === ${JSON.stringify(k)} && (i.group || 'key:' + i.key) === e.dataset.group));
          if (!t) return 'null'; t.scrollIntoView({ block: 'center' }); const r = t.getBoundingClientRect(); return JSON.stringify([r.left + r.width / 2, r.top + r.height / 3]); })()`;
        for (let i = 0; i < 5 && !(await page.eval(`!!document.querySelector('.gsl-detail [data-action=add-to-scene]')`)); i++) {
          await j(TILE);
          await sleep(300);
          const at = await j(TILE);
          assert.ok(at, `${tag}: a Library tile for ${k}`);
          await press(at[0], at[1]);
          await sleep(700);
        }
        await page.waitFor(`!!document.querySelector('.gsl-detail [data-action=add-to-scene]')`, 5000);
        const acts = await j(`JSON.stringify([...document.querySelectorAll('.gsl-detail:not([hidden]) .shelf-acts button')].filter((b) => b.offsetParent).map((b) => b.dataset.action))`);
        check(!acts.includes('copy'), `the object's detail has no Duplicate (${acts})`);
        if (k === g.add[0]) await shot('1', `${k}-detail`);
        await pressSel('.gsl-detail:not([hidden]) [data-action=add-to-scene]');
        await page.waitFor(`studioShell.items().length === ${n0 + 1}`, 8000);
        await sleep(1200);
        const nk = await selected();
        const a = await j(`JSON.stringify(${DBG}.anchor(${JSON.stringify(nk)}))`);
        const r = a.rect;
        const strip = await j(IN_STRIP('.row'));
        const hShare = r.h / f.h, cx = (r.x + r.w / 2) / f.w, cy = (r.y + r.h / 2) / f.h;
        note('①', `${k} → ${nk}: box ${Math.round(r.w)}×${Math.round(r.h)} = ${(hShare * 100).toFixed(0)}% of the height, middle at ${(cx * 100).toFixed(0)}% / ${(cy * 100).toFixed(0)}%, strip ${strip ? `at ${Math.round(strip.l)},${Math.round(strip.t)}` : 'not shown'}`);
        check(hShare <= 0.35 + 1e-3, `${k}: the copy is ${(hShare * 100).toFixed(0)}% of the height (35% at most)`);
        check(cx >= 0.2 && cx <= 0.8 && cy >= 0.2 && cy <= 0.8, `${k}: the copy's middle is inside the middle 60% (${cx.toFixed(2)}, ${cy.toFixed(2)})`);
        check(!!strip && strip.t >= f.t && strip.t + strip.h <= f.t + f.h && strip.l >= f.l && strip.l + strip.w <= f.l + f.w, `${k}: the strip is on screen`);
        await shot('1', `${k}-added`);
        await page.eval('studioShell.actions.undo()');
        await page.waitFor(`studioShell.items().length === ${n0}`, 8000);
        await sleep(400);
      }
      await page.eval(`studioShell.actions.select(null)`);
      await page.eval(`studioShell.actions.switchTool('placement')`);
      await sleep(800);
    }

    // ---------- ② the menus ----------
    if (PARTS.includes(2)) {
      await pickInGame(g.pick);
      const [px, py] = await j(POINT(g.pick));
      await openMenu(px, py);
      const m = await j(MENU);
      assert.ok(m, `${tag}: the object's menu opened`);
      const ids = m.rows.map((r) => r.id);
      const layers = ids.filter((i) => i.startsWith('layer-')).length;
      note('②', `object menu ${m.rows.length} rows (${m.rows.filter((r) => r.off).length} dimmed): ${ids.join(' · ')}`);
      if (touch) {
        check(m.rows.length <= 5 && m.rows.every((r) => !r.off), `a phone's menu: 5 rows at most, none dimmed (${ids})`);
        const floor = await j(`JSON.stringify(Math.min(...[document.querySelector('.card'), document.querySelector('.bar')].filter((e) => e && e.offsetParent).map((e) => e.getBoundingClientRect().top)))`);
        note('②', `menu bottom ${Math.round(m.t + m.h)}, card / ask box top ${Math.round(floor)}`);
        check(m.t + m.h <= floor - 8 + 0.5, 'the menu ends 8 px above the card / ask box');
      } else check(m.rows.length - layers <= 7 && layers <= 2 && !ids.includes('undo'), `PC: 7 rows at most (+ to front / to back), no Undo (${ids})`);
      await shot('2', 'object-menu');
      await closeMenu();
      // The review's sky point with the pick: the scene's menu.
      await pickInGame(g.pick);
      let [sx, sy] = reviewPoint(f, 1000, 120);
      if (!(await onGame(sx, sy))) {
        // Under the card (PC): the bare sky just left of the card, at the same height.
        const c = await j(`(() => { const e = document.querySelector('.card'); if (!e || !e.offsetParent) return 'null'; const r = e.getBoundingClientRect(); return JSON.stringify([r.left, r.top]); })()`);
        note('②', `(${Math.round(sx)}, ${Math.round(sy)}) is on the card${c ? ` (its left edge at ${Math.round(c[0])})` : ''}: right-clicking the sky at (${Math.round(c ? c[0] - 40 : sx)}, ${Math.round(sy)}) instead`);
        if (c) sx = c[0] - 40;
      }
      const empty = await page.eval(`(() => { const f = document.querySelector('iframe.game:not(.leaving)').getBoundingClientRect(); return ${DBG}.under(${sx} - f.left, ${sy} - f.top); })()`);
      await openMenu(sx, sy);
      const s = await j(MENU);
      note('②', `right-click at (${Math.round(sx)}, ${Math.round(sy)}) [under it: ${empty || 'nothing'}] with ${g.pick} picked → ${s ? `${s.place} menu: ${s.rows.map((r) => r.id + (r.off ? '(dim)' : '')).join(' · ')}` : 'no menu'}`);
      if (!empty) check(s && s.place === 'scene' && s.rows.every((r) => !r.off), `nothing under the point: the scene's menu with no dimmed row (${JSON.stringify(s)})`);
      await shot('2', 'sky-menu');
      await closeMenu();
      await page.eval(`studioShell.actions.select(null)`);
      await sleep(300);
    }

    // ---------- ③ the turn ▾, the chosen look, the hint line, the way going back ----------
    if (PARTS.includes(3) && game === 'lantern-cove') {
      await pickInGame(g.pick);
      await sleep(400);
      const more = await j(IN_STRIP('[data-studio-handle=rotate] .more'));
      assert.ok(more, `${tag}: the turn button's ▾`);
      await press(more.x, more.y);
      await sleep(500);
      const row = await j(IN_STRIP('.row'));
      const menu = await j(IN_STRIP('.menu'));
      assert.ok(row && menu, `${tag}: the strip and its choices`);
      const chosenBg = await page.eval(`(() => { const b = ${ROOT}.querySelector('.menu button.chosen'); return b ? getComputedStyle(b).backgroundColor : ''; })()`);
      const wraps = await page.eval(`[...${ROOT}.querySelectorAll('.menu button')].some((b) => b.getBoundingClientRect().height > ${row.h} + 1)`);
      note('③', `▾ choices ${Math.round(menu.w)}×${Math.round(menu.h)} over a ${Math.round(row.w)}×${Math.round(row.h)} strip (×${(menu.w / row.w).toFixed(2)} wide), chosen ground ${chosenBg}`);
      const solid = (c) => /rgb\((2[0-9]|3[0-9]|24[0-9]|25[0-5]), ?\1, ?\1\)$|rgb\(29, 29, 31\)|rgb\(245, 245, 247\)/.test(c);
      check(Math.abs(menu.h - row.h) <= 1 && menu.w <= row.w * 1.5 + 0.5, 'the choices are one row as high as the strip, 1.5× its width at most');
      check(!solid(chosenBg), `the chosen way is not a filled black / white square (${chosenBg})`);
      check(!wraps, 'no choice wraps to a second line');
      await shot('3', 'turn-choices');
      const tilt = await j(IN_STRIP('[data-studio-choice="axis:x"]'));
      await press(tilt.x, tilt.y);
      await sleep(600);
      const btnBg = await page.eval(`getComputedStyle(${ROOT}.querySelector('[data-studio-handle=rotate]')).backgroundColor`);
      const hint = await j(`(() => { const o = document.querySelector('iframe.game:not(.leaving)').getBoundingClientRect(); const e = ${ROOT}.querySelector('.hint'); if (!e || e.style.display === 'none') return 'null'; const r = e.getBoundingClientRect();
        return JSON.stringify({ text: e.textContent, l: o.left + r.left, t: o.top + r.top, w: r.width, h: r.height }); })()`);
      const cam = await j(IN_STRIP('.cam'));
      note('③', `Tilt forward chosen: strip button ground ${btnBg}; hint ${hint ? `"${hint.text}" (${hint.text.length} characters, ${Math.round(hint.w)} px)` : 'not shown'}${cam ? `; camera ↑↓ at ${Math.round(cam.l)},${Math.round(cam.t)}` : ''}`);
      check(!solid(btnBg), `the chosen tool is not a filled black / white square (${btnBg})`);
      check(!hint || hint.text.length <= 40, `the hint is 40 characters at most (${hint?.text.length})`);
      check(!hint || !/[▾•]/.test(hint.text), 'the hint has no ▾ / •');
      if (hint && cam) check(hint.l + hint.w <= cam.l || hint.t + hint.h <= cam.t || hint.t >= cam.t + cam.h, 'the hint is clear of the camera ↑ ↓');
      await shot('3', 'tilt-chosen');
      // The pines: Turn again.
      await page.eval(`studioShell.actions.selectMany(studioShell.items().filter((i) => i.key.startsWith('pine')).map((i) => i.key), null)`);
      await sleep(700);
      const axis = await page.eval(`${ROOT}.querySelector('[data-studio-handle=rotate]').dataset.axis || 'y'`);
      note('③', `after picking the pines the turn button's way is "${axis}"`);
      check(axis === 'y', `another pick puts Turn back (axis ${axis})`);
      await shot('3', 'pines-after-tilt');
      await key('Escape', 'Escape', 27);
      await page.eval(`studioShell.actions.select(null)`);
      await sleep(300);
    }

    // ---------- ④ ⌘K / All actions ----------
    if (PARTS.includes(4)) {
      await pickInGame(g.pick);
      if (touch) {
        if (await page.eval(`!document.querySelector('.sheet-more')?.offsetParent`)) await page.eval(`document.querySelector('.bar [data-action=sheet]')?.click()`);
        await sleep(600);
        await page.eval(`document.querySelector('.sheet-more').click()`);
      } else await page.eval(`document.querySelector('.foot-row[data-action=palette]').click()`);
      await page.waitFor(`document.querySelectorAll('.p-row').length > 3`, 5000);
      await sleep(400);
      const rows = await j(`JSON.stringify([...document.querySelectorAll('.p-row')].map((b) => ({ a: b.dataset.action || b.dataset.step || '', label: b.querySelector('.p-label').textContent, k: b.querySelector('.p-k')?.textContent || '' })))`);
      note('④', `first rows: ${rows.slice(0, 6).map((r) => r.label + (r.k ? ` [${r.k}]` : '')).join(' · ')}`);
      check(rows.slice(0, 5).map((r) => r.a).join(',') === 'play,copy,remove,clip-copy,show-in-library', `the first rows are Play · Duplicate · Delete · Copy · Show in Library (${rows.slice(0, 5).map((r) => r.a)})`);
      check(!rows.some((r) => /in a row|glow|Make it nighttime|Fit the editor|Change how the editor|Add a tool/.test(r.label)), 'no made-up sentences and no Ideas rows');
      if (touch) check(rows.filter((r) => /^(⌘|Ctrl|[A-Z?]$|⌫|Del)/.test(r.k)).length === 0, `no keys on a phone (${rows.filter((r) => r.k).map((r) => r.k)})`);
      await shot('4', 'palette');
      await key('Escape', 'Escape', 27);
      await key('Escape', 'Escape', 27);
      await page.eval(`studioShell.actions.select(null)`);
      if (touch && (await page.eval(`!!document.querySelector('.sheet-more')?.offsetParent`))) await page.eval(`document.querySelector('.bar [data-action=sheet]')?.click()`);
      await sleep(500);
    }

    // ---------- ⑤ several picked: the strip under the nearest one on screen ----------
    if (PARTS.includes(5) && g.many) {
      const keys = await j(`JSON.stringify(studioShell.items().filter((i) => i.key.startsWith(${JSON.stringify(g.many)})).map((i) => i.key))`);
      // The list's "pine" row, as the review did (PC). A phone: picked straight away (the list sheet would cover the
      // game the strip is measured on).
      const row = !touch && (await page.eval(`(() => { const e = [...document.querySelectorAll('.objects .obj[data-group]')].find((r) => r.textContent.includes(${JSON.stringify(g.many)})); if (!e) return null; e.setAttribute('data-r2', '1'); return true; })()`));
      if (row) await pressSel('.objects [data-r2]');
      else await page.eval(`studioShell.actions.selectMany(${JSON.stringify(keys)}, null)`);
      await sleep(800);
      const strip = await j(IN_STRIP('.row'));
      const boxes = await j(`(() => { const f = document.querySelector('iframe.game:not(.leaving)').getBoundingClientRect(); return JSON.stringify(${JSON.stringify(keys)}.map((k) => { const a = ${DBG}.anchor(k); return a && a.visible && a.rect ? { k, x: f.left + a.rect.x, y: f.top + a.rect.y, w: a.rect.w, h: a.rect.h, cx: f.left + a.center[0], cy: f.top + a.center[1] } : null; }).filter(Boolean)); })()`);
      // On screen = some of its box inside the frame; the strip goes under the part that shows.
      const onScreen = boxes.map((b) => ({ ...b, x0: Math.max(f.l, b.x), x1: Math.min(f.l + f.w, b.x + b.w) }))
        .filter((b) => b.x1 - b.x0 >= 4 && Math.min(f.t + f.h, b.y + b.h) - Math.max(f.t, b.y) >= 4);
      const near = onScreen.sort((a, b) => b.y + b.h - (a.y + a.h))[0];
      note('⑤', `${keys.length} picked, ${onScreen.length} on screen; strip ${strip ? `${Math.round(strip.l)},${Math.round(strip.t)} ${Math.round(strip.w)}×${Math.round(strip.h)}` : 'not shown'}; nearest ${near ? `${near.k} bottom ${Math.round(near.y + near.h)} x ${Math.round(near.x0)}–${Math.round(near.x1)}` : '-'}`);
      if (near && strip) {
        const under = Math.abs(strip.t - (near.y + near.h) - 12) <= 1.5;
        const over = strip.t + strip.h <= near.y;
        // Centred on it, or — at the window's edge, where the strip is kept 8 px inside — at least overlapping it.
        check((under || over) && strip.l <= near.x1 + 1 && strip.l + strip.w >= near.x0 - 1, `the strip is 12 px under ${near.k} (or above it without room) and on it`);
      } else check(!strip, 'none on screen: no strip');
      await shot('5', 'pines');
      await page.eval(`studioShell.actions.select(null)`);
      await sleep(300);
    }

    // ---------- ⑥ a click on nothing drops the pick ----------
    if (PARTS.includes(6) && game === 'lantern-cove') {
      for (const [x0, y0, what] of [[1000, 120, 'sky'], [1100, 180, 'sky'], [600, 100, 'sky'], [700, 650, 'water']]) {
        await pickInGame(g.pick);
        assert.equal(await selected(), g.pick, `${tag}: ${g.pick} picked`);
        let [x, y] = reviewPoint(f, x0, y0);
        let moved = '';
        if (!(await onGame(x, y))) {
          const c = await j(`(() => { const e = document.querySelector('.card'); if (!e || !e.offsetParent) return 'null'; const r = e.getBoundingClientRect(); return JSON.stringify([r.left, r.top, r.right, r.bottom]); })()`);
          moved = ` — on the card (${c ? c.map(Math.round).join(',') : '?'})`;
          // The nearest bare game point beside the card (left of it, or above it), with nothing within a finger's
          // slack (40 px) around it either.
          const bare = (px, py) => page.eval(`(() => { const f = document.querySelector('iframe.game:not(.leaving)'); const r = f.getBoundingClientRect();
            if (document.elementFromPoint(${px}, ${py}) !== f) return false; const u = f.contentWindow.__gameStudio._debug.under;
            for (const [dx, dy] of [[0, 0], [40, 0], [-40, 0], [0, 40], [0, -40], [28, 28], [-28, 28], [28, -28], [-28, -28]]) if (u(${px} - r.left + dx, ${py} - r.top + dy)) return false;
            return true; })()`);
          if (c) {
            let found = null;
            for (let d = 24; !found && d < 400; d += 12) for (const p of [[c[0] - d, y], [x, c[1] - d]]) if (!found && p[0] > f.l && p[1] > f.t && (await bare(p[0], p[1]))) found = p;
            if (found) [x, y] = found;
          }
          moved += `, clicked (${Math.round(x)}, ${Math.round(y)}) instead`;
        }
        const under = await page.eval(`(() => { const f = document.querySelector('iframe.game:not(.leaving)').getBoundingClientRect(); return ${DBG}.under(${x} - f.left, ${y} - f.top); })()`);
        await press(x, y);
        await sleep(500);
        const after = await selected();
        note('⑥', `${what} (${x0}, ${y0})${moved}: under it ${under || 'nothing'} → picked ${after ?? 'nothing'}`);
        if (!under) check(after === null, `a click on ${what} at (${Math.round(x)}, ${Math.round(y)}) drops the pick`);
        if (x0 === 1000) await shot('6', 'after-sky-click');
      }
    }
    const errors = page.logs.filter((l) => l.startsWith('exception'));
    assert.deepEqual(errors, [], 'page errors');
  } catch (e) {
    failed++;
    console.log(`  ✗ ${tag}: ${e.message}`);
    if (SHOTS) writeFileSync(join(SHOTS, `fail-${tag}.png`), await page.screenshot());
  } finally {
    await browser.close().catch(() => {});
    await srv.close?.();
    rmSync(root, { recursive: true, force: true });
  }
}

for (const game of GAMES) for (const layout of LAYOUTS) for (const theme of THEMES) await run(game, layout, theme);
if (SHOTS) writeFileSync(join(SHOTS, `measures${BEFORE ? '-before' : ''}.txt`), report.join('\n') + '\n');
console.log(failed ? `✗ ${failed} run(s) failed` : '✓ review 2 ①–⑥ (scene)');
process.exit(failed && !BEFORE ? 1 : 0);
