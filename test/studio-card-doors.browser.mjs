// One way in, a light card (studio-card-doors, 2026-10-23; a hands-on try: "I couldn't tell how to make a motion and then
// put it on objects", "it's all over the place"). Headless, PC 1280×800, on test/neon-run (hexagons the game slides, a
// ring it turns, a road that is locked, a gate with nothing, a ship with a saved motion on it):
//   1. hex-1 (the game moves it): the card has no paragraph on what the game does (the line under the strip says it,
//      once), no Motion row (no motion yet: the strip's Motion is the way in), no "Show in Library" / "Select all like
//      this" on its face — they are in the card's ⋯
//   2. the ring (the game turns it): the same, no paragraph
//   3. the road (locked): the card has no "Unlock"; the line under the strip has it, and a press there frees the road
//      (Move works again). The right-click menu has no "Unlock" and no "Copy"
//   4. the gate (nothing): no Motion row
//   5. the ship (a motion): one Motion row — its name and when it plays, and a press opens the timeline on it
//   6. the card's ⋯ on hex-1: Show in Library · Select all 4 like this
//   7. the left column: no small grey second words on Scene / Library, no "Multi-select" button (PC)
//   8. ⌘K's "Editor view" and "Ideas for your AI" open as a window over the game (the list stays at the left), Esc
//      closes it; an idea's "Ask" only puts the words in the ask box (nothing sent)
//   9. no page errors
// Pictures (`--shots <dir>`): 03-<before|after>-<lang>-<theme>-<1-hex|2-ring|3-road|4-gate|5-motion|6-more|7-settings|8-ideas>.png.
// `--before --ui <dir> --loader <file>`: an older build, pictures only.
//
//   node test/studio-card-doors.browser.mjs [--shots <dir>] [--before --ui <dir> --loader <file>] [--themes dark,light] [--lang en|ja]
// Exit 1 on a failure.
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStudioServer } from '../src/server/server.mjs';
import { launch, newPage } from './adapters-2d/cdp.mjs';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const take = (flag, d = null) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : d;
};
const SHOTS = take('--shots') ? resolve(take('--shots')) : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const BEFORE = args.includes('--before');
const UI = resolve(take('--ui', join(PKG, 'skills/arrange/bin/studio-ui')));
const LOADER = resolve(take('--loader', join(PKG, 'skills/arrange/bin/studio-placement.js')));
const LANG = take('--lang', 'en');
const THEMES = take('--themes', 'dark').split(',');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failed = 0;
const check = (ok, what) => {
  console.log(`  ${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failed++;
};

const GAME = `document.querySelector('iframe.game, iframe').contentWindow`;
const DBG = `${GAME}.__gameStudio?._debug`;
const ROOT = `document.querySelector('iframe.game, iframe').contentDocument.querySelector('[data-studio-ui]').shadowRoot`;
const TL = `window.__studioTimeline`;
const W = LANG === 'ja'
  ? { unlock: '動かせるようにする', copy: 'コピー', lib: 'ライブラリで見る', kind: /同じ種類を全部選ぶ/ }
  : { unlock: 'Unlock', copy: 'Copy', lib: 'Show in Library', kind: /^Select all \d+ like this/ };

async function open(theme) {
  const root = mkdtempSync(join(tmpdir(), 'studio-card-doors-'));
  cpSync(join(PKG, 'test/neon-run'), root, { recursive: true });
  copyFileSync(LOADER, join(root, 'studio-placement.js'));
  mkdirSync(join(root, '.studio/ui'), { recursive: true });
  writeFileSync(join(root, '.studio/ui/prefs.json'), JSON.stringify({ version: 1, lang: LANG, theme }));
  // The ship carries a saved motion (Hop, when the game starts); the gate has none.
  writeFileSync(join(root, 'placement.json'), JSON.stringify({ version: 1, tool: 'placement', dim: '3d', space: 'local',
    objects: {}, motion: { ship: { clips: [{ use: 'Hop', when: { on: 'start' } }] } },
    motions: [{ name: 'Hop', len: 0.8, keys: { p: [{ t: 0, v: [0, 0, 0] }, { t: 0.4, v: [0, 1.4, 0] }, { t: 0.8, v: [0, 0, 0] }] } }] }, null, 2));
  const srv = await startStudioServer({ root, uiDir: UI, log: () => {}, env: {} });
  const browser = await launch();
  const page = await newPage(browser, { width: 1280, height: 800, cdnCache: process.env.STUDIO_CDN_CACHE });
  await page.goto(srv.url);
  await page.waitFor(`document.querySelectorAll('.obj').length > 0 && !!${DBG}`, 90000);
  await page.waitFor(`${DBG}.list().some((i) => i.held === 'game')`, 20000).catch(() => {});
  await sleep(1500);
  return { page, errors: { get length() { return page.logs.filter((l) => l.startsWith('exception')).length; }, get 0() { return page.logs.find((l) => l.startsWith('exception')); } }, close: async () => (await browser.close(), await srv.close?.()) };
}

async function run(theme) {
  console.log(`${LANG} ${theme}${BEFORE ? ' (before)' : ''}`);
  const { page, errors, close } = await open(theme);
  const tag = `${LANG} ${theme}`;
  const j = async (expr) => JSON.parse((await page.eval(expr)) || 'null');
  const shot = async (what) => SHOTS && writeFileSync(join(SHOTS, `03-${BEFORE ? 'before' : 'after'}-${LANG}-${theme}-${what}.png`), await page.screenshot());
  const key = async (k, code, vk, mods = 0) => {
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers: mods });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers: mods });
    await sleep(400);
  };
  const select = async (k) => {
    await key('Escape', 'Escape', 27);
    await page.eval(`studioShell.actions.select(${JSON.stringify(k)})`);
    await sleep(1100);
  };
  // What the card shows: its texts, its buttons' actions, and whether a Motion row is there.
  const card = () => j(`(() => { const c = document.querySelector('[data-part=card]'); if (!c || c.hidden) return null;
    return JSON.stringify({ text: c.textContent, held: !!c.querySelector('[data-part=held]'), motion: c.querySelector('[data-part=motion-row]')?.textContent ?? null,
      oldMotion: !!c.querySelector('[data-part=motion-make], [data-part=motion-timeline], [data-part=motion-from-lib]'),
      actions: [...c.querySelectorAll('[data-action]')].map((b) => b.dataset.action) }); })()`);
  const note = () => j(`(() => { const n = ${ROOT}.querySelector('[data-studio-note]');
    if (!n || n.style.display === 'none' || n.style.visibility === 'hidden') return null;
    const b = n.querySelector('[data-studio-unhold]'); const o = document.querySelector('iframe.game, iframe').getBoundingClientRect(); const r = b?.getBoundingClientRect();
    return JSON.stringify({ text: n.textContent, btn: b ? { text: b.textContent, x: o.left + r.left + r.width / 2, y: o.top + r.top + r.height / 2 } : null }); })()`);
  const menu = () => j(`(() => { const m = document.querySelector('[data-part=context-menu]'); if (!m || m.hidden) return null;
    return JSON.stringify({ place: m.dataset.place, rows: [...m.querySelectorAll('.ctx-label')].map((c) => c.textContent) }); })()`);
  // A right-click on the object's row in the scene list (on the game, the road's middle is under a hexagon).
  const rightClick = async (k) => {
    const a = await j(`(() => { const r = document.querySelector('.objects .obj[data-key=${JSON.stringify(k)}]')?.getBoundingClientRect(); return r ? JSON.stringify({ x: r.left + 40, y: r.top + r.height / 2 }) : 'null'; })()`);
    if (!a) return null;
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
      await page.send('Input.dispatchMouseEvent', { type, x: a.x, y: a.y, button: type === 'mouseMoved' ? 'none' : 'right', buttons: type === 'mousePressed' ? 2 : 0, clickCount: 1 });
    }
    await sleep(600);
    return menu();
  };
  const offMove = () => j(`JSON.stringify(${ROOT}.querySelector('[data-studio-handle=move]')?.getAttribute('aria-disabled') === 'true')`);
  try {
    // ---- 1. hex-1 ----
    await select('hex-1');
    await shot('1-hex');
    const c1 = await card();
    if (!BEFORE) {
      check(!!c1 && !c1.held, `${tag}: hex-1's card has no paragraph on what the game does`);
      check(!!c1 && c1.motion === null && !c1.oldMotion, `${tag}: hex-1's card has no Motion row (no motion yet)`);
      check(!!c1 && !c1.actions.includes('show-in-library') && !c1.actions.includes('select-kind') && c1.actions.includes('card-more'),
        `${tag}: Show in Library / Select all like this are not on the card's face; the ⋯ is (${c1?.actions.join(' ')})`);
      const n = await note();
      check(!!n && !n.btn, `${tag}: the line under the strip says it once ("${n?.text}")`);
      const m = await rightClick('hex-1');
      check(!!m && !m.rows.includes(W.copy), `${tag}: the object's menu has no Copy (${m?.rows.join(' | ')})`);
      await key('Escape', 'Escape', 27);
    }
    // ---- 2. the ring ----
    await select('ring');
    await shot('2-ring');
    if (!BEFORE) {
      const c2 = await card();
      check(!!c2 && !c2.held, `${tag}: the ring's card has no paragraph`);
    }
    // ---- 3. the road ----
    await select('road');
    await shot('3-road');
    if (!BEFORE) {
      const c3 = await card();
      check(!!c3 && !c3.actions.includes('unfix') && !c3.held, `${tag}: the road's card has no Unlock and no paragraph (${c3?.actions.join(' ')})`);
      const m = await rightClick('road');
      check(!m || !m.rows.includes(W.unlock), `${tag}: the road's menu has no Unlock (${m?.rows.join(' | ')})`);
      await key('Escape', 'Escape', 27);
      await page.eval(`studioShell.actions.select('road')`);
      await sleep(800);
      const n = await note();
      check(!!n?.btn && n.btn.text === W.unlock, `${tag}: the line under the strip has "${W.unlock}" ("${n?.text}")`);
      check(await offMove(), `${tag}: the road's Move is off before`);
      if (n?.btn) {
        await page.click(n.btn.x, n.btn.y);
        await sleep(900);
      }
      check(!(await offMove()), `${tag}: a press on "${W.unlock}" frees the road (Move works)`);
      check(!(await note())?.btn, `${tag}: and the line has no "${W.unlock}" any more`);
    }
    // ---- 4. the gate ----
    await select('gate');
    await shot('4-gate');
    if (!BEFORE) {
      const c4 = await card();
      check(!!c4 && c4.motion === null && !c4.oldMotion, `${tag}: the gate's card has no Motion row`);
    }
    // ---- 5. the ship (a motion) ----
    await select('ship');
    await shot('5-motion');
    if (!BEFORE) {
      const c5 = await card();
      check(!!c5?.motion && c5.motion.includes('Hop') && !c5.oldMotion, `${tag}: the ship's card has one Motion row ("${c5?.motion}")`);
      await page.eval(`document.querySelector('[data-part=card] [data-part=motion-row] button')?.click()`);
      await sleep(700);
      const st = await j(`JSON.stringify(${TL}.state())`);
      check(!!st?.open, `${tag}: a press on it opens the timeline`);
      await page.eval(`${TL}.setOpen(false)`);
      await sleep(300);
    }
    // ---- 6. the card's ⋯ ----
    await select('hex-1');
    if (!BEFORE) {
      await page.eval(`document.querySelector('[data-part=card] [data-action=card-more]')?.click()`);
      await sleep(500);
      const m = await menu();
      check(!!m && m.rows[0]?.startsWith(W.lib) && W.kind.test(m.rows[1] ?? ''), `${tag}: the card's ⋯: ${m?.rows.join(' | ')}`);
    }
    await shot('6-more');
    await key('Escape', 'Escape', 27);
    // ---- 7. the left column ----
    if (!BEFORE) {
      const side = await j(`JSON.stringify({ subs: [...document.querySelectorAll('.tabs .sub')].filter((s) => s.offsetParent && s.textContent.trim()).length,
        multi: !!document.querySelector('[data-action=multi]')?.offsetParent })`);
      check(side.subs === 0 && !side.multi, `${tag}: the left column has no small second words and no Multi-select (${JSON.stringify(side)})`);
    }
    // ---- 8. ⌘K's windows ----
    await page.eval(`studioShell.actions.openSettings()`);
    await sleep(700);
    await shot('7-settings');
    if (!BEFORE) {
      const w = await j(`(() => { const p = document.querySelector('[data-part=page-window]'); const s = document.querySelector('[data-part=stage]').getBoundingClientRect();
        if (!p || p.hidden) return 'null'; const r = p.querySelector('.page-window-plate').getBoundingClientRect();
        return JSON.stringify({ over: r.left >= s.left && r.right <= s.right, list: !!document.querySelector('.objects .obj')?.offsetParent }); })()`);
      check(!!w?.over && w.list, `${tag}: Editor view is a window over the game, the list stays (${JSON.stringify(w)})`);
      await key('Escape', 'Escape', 27);
      check(await j(`JSON.stringify(!!document.querySelector('[data-part=page-window]')?.hidden)`), `${tag}: Esc closes it`);
    }
    await page.eval(`studioShell.actions.openNextSteps()`);
    await sleep(700);
    await page.eval(`document.querySelector('[data-step=fit]')?.click()`);
    await sleep(500);
    await shot('8-ideas');
    if (!BEFORE) {
      const before = await j(`JSON.stringify(document.querySelectorAll('[data-part=ai] *').length)`);
      await page.eval(`document.querySelector('.step-actions [data-action=ask]')?.click()`);
      await sleep(700);
      const r = await j(`JSON.stringify({ box: document.querySelector('[data-part=ask] textarea, [data-part=ask] input')?.value ?? '', open: !document.querySelector('[data-part=page-window]')?.hidden })`);
      check(r.box.length > 10 && !r.open, `${tag}: "Ask" puts the idea in the ask box and closes the window ("${r.box.slice(0, 40)}…")`);
      const reqs = await j(`JSON.stringify(document.querySelector('[data-part=ai]')?.textContent ?? '')`);
      check(!/On it|取りかかって/.test(reqs ?? ''), `${tag}: nothing was sent (${before})`);
    }
    check(!errors.length, `${tag}: no page errors${errors.length ? ` (${errors[0]})` : ''}`);
  } finally {
    await close();
  }
}

for (const theme of THEMES) await run(theme);
console.log(failed ? `${failed} failed` : 'ok');
process.exit(failed ? 1 : 0);
