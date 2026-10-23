// Moving things while making a motion (studio-motion-move, 2026-10-23). A try of v0.1.34 on NEON DASH: "I try to make a
// motion, but moving is limited? It doesn't go well." The tester's recording (17:26): the second blue pillar — a thing the
// game moves — with ● on at 1.0 s and points at 0 s and 1.0 s; a Move drag showed "Move X −1.49" by the strip while the
// pillar stayed put, inched and came back, and the card's X went 9.5 → 9.0 → 8.6 → 8.2 → 8.7 → 6.5.
//
// For each kind of thing in test/neon-run — the blue pillar standing on the road that the game slides (NEON DASH's),
// a hexagon the game slides (in the air), a ring the game turns, plain ones (ship, gate) — this goes through making a
// motion as a person does: "Make a motion" (timeline.make, the Motion button's first row) → a slow drag (the pointer
// stops at every step, so the shell's pose comes back between steps, as with a hand) → let go → a second drag (the
// next step) → a turn with the Turn tool → Done; then the tester's state: ● on, the time line on the last point, a
// Move drag on the thing (off its middle, where the point's dot is).
//   1. the thing follows the pointer through every drag (it travels at least 70 % of the pointer's way, and the gap
//      between them does not grow by more than 25 px);
//   2. one drag = a motion with two points; the second drag = a third point (the first step kept);
//   3. a turn while making makes turn points — on the ring the game turns too;
//   4. what the game moves: while making, the line under the strip says the game moves it too and the two add up when
//      played (not "sets where it starts"); after the timeline folds, the start-spot line is back;
//   5. no page errors.
// Pictures (`--shots <dir>`): <lang>-<theme>-<key>-<1-make|2-drag|3-let-go|4-second|5-turn|6-at-1s>.png.
//
//   node test/studio-motion-move.browser.mjs [--shots <dir>] [--themes dark] [--lang ja|en] [--only pillar,ship]
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
const UI = resolve(take('--ui', join(PKG, 'skills/arrange/bin/studio-ui')));
const LOADER = resolve(take('--loader', join(PKG, 'skills/arrange/bin/studio-placement.js')));
const LANG = take('--lang', 'ja');
const THEMES = take('--themes', 'dark').split(',');
const ONLY = take('--only', 'pillar,hex-1,ring,ship,gate').split(',');
const SIZE = { width: 1280, height: 800 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failed = 0;
const check = (ok, what) => {
  console.log(`  ${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failed++;
};

const FRAME = `document.querySelector('iframe.game, iframe')`;
const DBG = `${FRAME}.contentWindow.__gameStudio?._debug`;
const ROOT = `${FRAME}.contentDocument.querySelector('[data-studio-ui]').shadowRoot`;
const TL = `window.__studioTimeline`;
const W = LANG === 'ja'
  ? { start: /スタート位置/, meet: /^この物はゲームも.+います。遊ぶと、ゲームの動きと重なります。$/ }
  : { start: /where it starts/, meet: /too\. When you play, its motion and this one add up\.$/ };
const GAME_MOVES = new Set(['pillar', 'hex-1', 'ring']);

async function open(theme) {
  const root = mkdtempSync(join(tmpdir(), 'studio-motion-move-'));
  cpSync(join(PKG, 'test/neon-run'), root, { recursive: true });
  copyFileSync(LOADER, join(root, 'studio-placement.js'));
  mkdirSync(join(root, '.studio/ui'), { recursive: true });
  writeFileSync(join(root, '.studio/ui/prefs.json'), JSON.stringify({ version: 1, lang: LANG, theme }));
  const srv = await startStudioServer({ root, uiDir: UI, log: () => {}, env: {} });
  const browser = await launch();
  const page = await newPage(browser, { width: SIZE.width, height: SIZE.height, cdnCache: process.env.STUDIO_CDN_CACHE });
  await page.goto(srv.url);
  await page.waitFor(`document.querySelectorAll('.obj').length > 0 && !!${DBG}`, 90000);
  // The editor watches the game for its first moments (observe.ts) before it knows what the game moves.
  await page.waitFor(`${DBG}.list().some((i) => i.held === 'game')`, 20000).catch(() => {});
  await sleep(1500);
  return { page, close: async () => (await browser.close(), await srv.close?.()) };
}

async function run(theme) {
  console.log(`${LANG} ${theme}`);
  const { page, close } = await open(theme);
  const j = async (expr) => JSON.parse((await page.eval(expr)) || 'null');
  const shot = async (key, what) => SHOTS && writeFileSync(join(SHOTS, `${LANG}-${theme}-${key}-${what}.png`), await page.screenshot());
  // Where the thing is on the editor page: its middle, and a point a little below it (off the path's dot, which sits
  // on the middle at the time line — a press there drags the point, not the thing).
  const at = (k) => j(`(() => { const o = ${FRAME}.getBoundingClientRect(); const a = ${DBG}.anchor(${JSON.stringify(k)}); if (!a) return 'null';
    const r = a.rect, below = r ? Math.min(r.h * 0.3, 40) : 0;
    return JSON.stringify({ x: o.left + a.center[0], y: o.top + a.center[1], press: { x: o.left + a.center[0], y: o.top + a.center[1] + below } }); })()`);
  const inStrip = (sel) => j(`(() => { const o = ${FRAME}.getBoundingClientRect(); const b = ${ROOT}.querySelector(${JSON.stringify(sel)});
    if (!b || b.hidden || !b.getBoundingClientRect().width) return null; const r = b.getBoundingClientRect();
    return JSON.stringify({ x: o.left + r.left + r.width / 2, y: o.top + r.top + r.height / 2, cls: b.className, disabled: b.getAttribute('aria-disabled') }); })()`);
  const note = () => j(`(() => { const n = ${ROOT}.querySelector('[data-studio-note]');
    return n && n.style.display !== 'none' && n.style.visibility !== 'hidden' && n.textContent ? JSON.stringify(n.textContent) : 'null'; })()`);
  const keysOf = async (k, ch = 'p') => (await j(`JSON.stringify(${TL}.motionOf(${JSON.stringify(k)})?.clips?.[0]?.keys?.[${JSON.stringify(ch)}] ?? [])`)) ?? [];
  const esc = async () => {
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await sleep(300);
  };
  const tool = async (k) => {
    const b = await inStrip(`[data-studio-handle=${k}]`);
    if (b && b.disabled !== 'true') (await page.click(b.x, b.y), await sleep(350));
    return b;
  };
  /**
   * A hand's drag on `k`: press (off its middle), `steps` moves with a pause at each (the shell's pose comes back in
   * between), let go. Returns how far the thing went against the pointer, and the gap at each step.
   */
  const slowDrag = async (k, dx, dy, name, steps = 8) => {
    const a = await at(k);
    if (!a) return { ratio: 0, grow: Infinity, lags: [] };
    const p0 = a.press;
    const lags = [];
    let last = a;
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p0.x, y: p0.y });
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p0.x, y: p0.y, button: 'left', buttons: 1, clickCount: 1 });
    await sleep(80);
    for (let i = 1; i <= steps; i++) {
      const x = p0.x + (dx * i) / steps, y = p0.y + (dy * i) / steps;
      await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1 });
      await sleep(120);
      last = (await at(k)) ?? last;
      lags.push(Math.round(Math.hypot(last.press.x - x, last.press.y - y)));
      if (name && i === Math.ceil(steps / 2)) await shot(k, name);
    }
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p0.x + dx, y: p0.y + dy, button: 'left', buttons: 0, clickCount: 1 });
    // Let go while making: the motion plays the part just made (stepEnds); wait for it to stop at its end.
    await sleep(1800);
    const ratio = Math.hypot(last.x - a.x, last.y - a.y) / Math.hypot(dx, dy);
    // The first steps may stay put (a drag starts past a few px); after that the gap must not grow.
    const rest = lags.slice(2);
    return { ratio, grow: Math.max(...rest) - Math.min(...rest), lags };
  };
  const follows = (k, d, what) => check(d.ratio >= 0.7 && d.grow <= 25, `${k}: ${what} follows the pointer (went ${(d.ratio * 100).toFixed(0)} % of its way; gap ${d.lags.join(' ')} px)`);

  try {
    const held = await j(`JSON.stringify(${DBG}.list().filter((i) => i.held).map((i) => i.key + ':' + i.held + ':' + (i.driven || []).join('+')))`);
    console.log(`  held: ${held.join(', ')}`);
    for (const k of ONLY) {
      console.log(`  -- ${k}`);
      await page.eval(`studioShell.actions.select(${JSON.stringify(k)})`);
      await sleep(900);
      const before = await note();
      // "Make a motion" (the Motion button's first row, the card's "+ New motion"): the same call.
      await page.eval(`${TL}.make(${JSON.stringify(k)})`);
      await sleep(700);
      const during = await note();
      const strip = await j(`JSON.stringify([...${ROOT}.querySelectorAll('[data-studio-handle]')].filter((b) => !b.hidden && b.getBoundingClientRect().width)
        .map((b) => b.dataset.studioHandle + (b.getAttribute('aria-disabled') === 'true' ? ':off' : '')))`);
      console.log(`  line before: ${before} · while making: ${during} · strip: ${strip.join(' ')}`);
      await shot(k, '1-make');
      if (GAME_MOVES.has(k)) {
        check(!!during && W.meet.test(during), `${k}: while making, the line says the game moves it too and the two add up ("${during}")`);
        check(!strip.some((s) => s.endsWith(':off')), `${k}: while making, every tool works (${strip.join(' ')})`);
      } else check(!during, `${k}: no line on a thing nothing moves ("${during}")`);
      // 1st step: the Move tool, a drag sideways.
      await tool('move');
      const d1 = await slowDrag(k, 160, 0, '2-drag');
      const k1 = await keysOf(k);
      console.log(`  drag 1: keys p ${k1.map((x) => `${x.t}s`).join(' ')}`);
      await shot(k, '3-let-go');
      follows(k, d1, 'the first drag');
      check(k1.length === 2, `${k}: one drag = a motion with two points (${k1.length})`);
      // 2nd step: drag again (a press on the thing where it stands — its point's dot is there too).
      const d2 = await slowDrag(k, -120, 0);
      const k2 = await keysOf(k);
      console.log(`  drag 2: keys p ${k2.map((x) => `${x.t}s`).join(' ')}`);
      await shot(k, '4-second');
      follows(k, d2, 'the second drag');
      check(k2.length === 3 && Math.abs(k2[1].v[0] - k1[1].v[0]) < 1e-3, `${k}: the second drag adds a third point and keeps the first step (${k2.length})`);
      // 3rd step: a turn (the Turn tool, dragged on the thing).
      const rt = await tool('rotate');
      if (rt && rt.disabled !== 'true') await slowDrag(k, 80, 0, null, 4);
      const kr = await keysOf(k, 'r');
      console.log(`  turn: ${rt?.disabled === 'true' ? 'off' : `keys r ${kr.map((x) => `${x.t}s`).join(' ')}`}`);
      await shot(k, '5-turn');
      check(kr.length >= 2, `${k}: a turn while making makes turn points (${kr.length})`);
      // Done (Esc ends making), then the tester's state: ● on, the time line on the last position point, Move.
      await esc();
      await page.eval(`studioShell.actions.select(${JSON.stringify(k)})`);
      await sleep(500);
      const tLast = k2.at(-1)?.t ?? 1;
      await page.eval(`(${TL}.setAuto(true), ${TL}.setTime(${tLast}), 'null')`);
      await sleep(400);
      await tool('move');
      const d3 = await slowDrag(k, -140, 0);
      const k3 = await keysOf(k);
      console.log(`  at ${tLast} s with ● on: keys p ${k3.map((x) => `${x.t}s`).join(' ')}`);
      await shot(k, '6-at-1s');
      follows(k, d3, `a drag at ${tLast} s with ● on`);
      check(k3.length === 3 && Math.abs(k3.at(-1).v[0] - k2.at(-1).v[0]) > 0.3, `${k}: it moved the point at ${tLast} s (${k2.at(-1)?.v?.[0]?.toFixed?.(2)} → ${k3.at(-1)?.v?.[0]?.toFixed?.(2)})`);
      // The timeline folded: what the game moves is back to "a move here sets where it starts".
      await page.eval(`${TL}.setOpen(false)`);
      await sleep(500);
      const after = await note();
      if (GAME_MOVES.has(k)) check(after === before, `${k}: folded, the line is the one before again ("${after}")`);
      await esc();
    }
    const errors = page.logs.filter((l) => /^exception|error:/.test(l) && !/favicon|net::/.test(l));
    check(!errors.length, `no page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
  } finally {
    await close();
  }
}

for (const theme of THEMES) await run(theme);
console.log(failed ? `${failed} check(s) failed` : 'ok');
process.exit(failed ? 1 : 0);
