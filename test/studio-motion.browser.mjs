// Motion made with the GUI (motion-gui, 2026-10-22: asked for as "build an object's movement with the GUI"), in a headless
// browser on Lantern Cove (3D, a copy of the starter):
//   1. the rowboat's card has a Motion row ("None"); choosing "Back and forth" draws its path in the game — a dot B in
//      sight, to the boat's right — and counts one change on Save;
//   2. dragging the dot moves B (the dot ends under the pointer) and is one undo step ("change rowboat's motion");
//   3. ▶ moves the boat by itself in the frozen scene, ■ puts it back exactly where it was;
//   4. ⌘Z (Undo) brings B back; + / − add and take a point;
//   5. "Spin" on the buoy turns it on ▶;
//   6. Save writes `motion` to placement.json (path, speed, repeat; spin) as the schema wants;
//   7. ▶ Play: the starter's own loader moves the boat and turns the buoy (no code written).
// And pictures: PC 1280×800, the side window 400×900, a phone 390×844 × light and dark, with the motion chosen and
// while ▶ plays (`--tag before` = the same pick on an older build, `--ui <its studio-ui>`).
//
//   node test/studio-motion.browser.mjs [--shots <dir>] [--tag after|before] [--ui <studio-ui dir>] [--only pc,side,phone]
//     [--themes light,dark] [--lang en|ja] [--no-checks]
// The checks run once, on PC light (the other sizes only take pictures and check the row is there). Exit 1 on a failure.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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
const TAG = take('--tag', 'after');
const UI = resolve(take('--ui', join(PKG, 'skills/arrange/bin/studio-ui')));
const LANG = take('--lang', 'en');
const ONLY = take('--only', 'pc,side,phone').split(',');
const THEMES = take('--themes', 'light,dark').split(',');
const CHECKS = TAG === 'after' && !args.includes('--no-checks');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SIZES = [
  { id: 'pc', width: 1280, height: 800 },
  { id: 'side', width: 400, height: 900 },
  { id: 'phone', width: 390, height: 844, mobile: true },
].filter((s) => ONLY.includes(s.id));

let failed = 0;
const check = (ok, what) => {
  console.log(`  ${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failed++;
};

const DBG = `document.querySelector('iframe.game, iframe').contentWindow.__gameStudio._debug`;
// The path layer in the game page (bridge/motion.ts): its points' middles in the editor page's px.
const POINTS = `(() => { const f = [...document.querySelectorAll('iframe')].find((x) => x.offsetParent) || document.querySelector('iframe');
  const host = f.contentDocument.querySelector('[data-studio-motion]'); if (!host) return '[]';
  const o = f.getBoundingClientRect();
  return JSON.stringify([...host.shadowRoot.querySelectorAll('[data-point]')].map((c) => [o.left + +c.getAttribute('cx'), o.top + +c.getAttribute('cy')])); })()`;
const ROW = `(() => { const s = document.querySelector('[data-part=card] [data-part=motion-kind]'); if (!s) return null;
  const p = document.querySelector('[data-part=card] [data-part=motion-play]'); const n = document.querySelector('[data-part=card] [data-part=motion-points] .n');
  return JSON.stringify({ kind: s.value, play: !!p, on: !!p && p.classList.contains('on'), n: n ? +n.textContent : 0, visible: !!s.offsetParent }); })()`;
const SAVE = `(() => { const b = [...document.querySelectorAll('[data-part=save], [data-part=save-fab]')].find((x) => !x.hidden && x.offsetParent); return b ? b.textContent : ''; })()`;

async function run(size, theme) {
  const root = mkdtempSync(join(tmpdir(), 'studio-motion-'));
  cpSync(join(PKG, 'starters/lantern-cove'), root, { recursive: true });
  mkdirSync(join(root, '.studio/ui'), { recursive: true });
  writeFileSync(join(root, '.studio/ui/prefs.json'), JSON.stringify({ version: 1, lang: LANG, theme }));
  const srv = await startStudioServer({ root, uiDir: UI, log: () => {}, env: {} });
  const browser = await launch();
  const full = CHECKS && size.id === 'pc' && theme === THEMES[0];
  const name = (what) => join(SHOTS, `${TAG}-${size.id}-${theme}-${what}.png`);
  const shot = async (page, what) => SHOTS && writeFileSync(name(what), await page.screenshot());
  console.log(`${TAG} ${size.id} ${theme}${full ? ' (checks)' : ''}`);
  try {
    const page = await newPage(browser, { width: size.width, height: size.height, mobile: !!size.mobile, cdnCache: process.env.STUDIO_CDN_CACHE });
    const j = async (expr) => JSON.parse((await page.eval(expr)) || 'null');
    await page.goto(srv.url);
    await page.waitFor(`document.querySelectorAll('.obj').length > 0`, 90000);
    await sleep(2500);
    await page.eval(`studioShell.actions.select('rowboat')`);
    await sleep(1200);
    // Phone and the side window keep the numbers (and so the Motion row) under "…" on the card.
    if (size.id !== 'pc') await page.eval(`(() => { const d = document.querySelector('[data-part=card] details.fine'); if (d) d.open = true; return true; })()`);
    await sleep(400);
    if (TAG === 'before') {
      await shot(page, '1-card');
      return;
    }
    const row0 = await j(ROW);
    check(!!row0 && row0.kind === 'none' && !row0.play, `the card has a Motion row saying None (${JSON.stringify(row0)})`);
    // 1. Back and forth.
    const choose = (k) => page.eval(`(() => { const s = document.querySelector('[data-part=card] [data-part=motion-kind]'); s.value = ${JSON.stringify(k)}; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await choose('pingpong');
    await page.waitFor(`${POINTS}.length > 2`, 5000).catch(() => null);
    await sleep(500);
    const pts = await j(POINTS);
    const boat = await j(`(() => { const a = ${DBG}.anchor('rowboat'); const o = document.querySelector('iframe').getBoundingClientRect(); return JSON.stringify({ x: o.left + a.center[0], y: o.top + a.center[1], p: a.pose.p, r: a.pose.r }); })()`);
    const row1 = await j(ROW);
    check(pts.length === 1, `one point drawn in the game (${pts.length})`);
    check(!!row1?.play && row1.n === 1, 'the row now has ▶ and "1" point');
    if (size.id === 'pc') check(!!pts[0] && Math.abs(pts[0][0] - boat.x) > 40 && pts[0][0] > 0 && pts[0][0] < size.width && pts[0][1] > 0 && pts[0][1] < size.height,
      `B is in sight, beside the boat (B ${pts[0]?.map(Math.round)}, boat ${[boat.x, boat.y].map(Math.round)})`);
    const save1 = await page.eval(SAVE);
    if (full) check(/1/.test(save1), `Save counts it ("${save1}")`);
    // Off the card on a phone / the side window, so the path in the game shows.
    if (size.id !== 'pc') await page.eval(`(() => { const d = document.querySelector('[data-part=card] details.fine'); if (d) d.open = false; return true; })()`);
    await sleep(500);
    await shot(page, '1-path');
    if (full) {
      // 2. Drag B somewhere else.
      const [bx, by] = pts[0];
      const to = [bx - 140, by + 30];
      await page.mouseDrag(Math.round(bx), Math.round(by), Math.round(to[0]), Math.round(to[1]), 8);
      await sleep(500);
      const pts2 = await j(POINTS);
      check(!!pts2[0] && Math.hypot(pts2[0][0] - to[0], pts2[0][1] - to[1]) < 14, `the dragged point ends under the pointer (${pts2[0]?.map(Math.round)} vs ${to})`);
      const tip = await page.eval(`(document.querySelector('[data-action=undo]') || {}).title || ''`);
      check(/motion/.test(tip) || /動き/.test(tip), `Undo names it ("${tip.split('\n')[0]}")`);
      const still = await j(`JSON.stringify(${DBG}.anchor('rowboat').pose.p)`);
      check(JSON.stringify(still) === JSON.stringify(boat.p), 'dragging B did not move the boat');
      // 3. ▶ then ■.
      await page.eval(`document.querySelector('[data-part=card] [data-part=motion-play]').click()`);
      await sleep(900);
      const mid = await j(`JSON.stringify(${DBG}.anchor('rowboat').pose.p)`);
      check(Math.hypot(mid[0] - boat.p[0], mid[2] - boat.p[2]) > 0.3, `▶ moves the boat by itself (${mid.map((v) => v.toFixed(2))})`);
      check((await j(ROW)).on, 'the button shows ■ while it plays');
      await shot(page, '2-play');
      await page.eval(`document.querySelector('[data-part=card] [data-part=motion-play]').click()`);
      await sleep(400);
      const back = await j(`JSON.stringify(${DBG}.anchor('rowboat').pose.p)`);
      check(back.every((v, i) => Math.abs(v - boat.p[i]) < 1e-6), '■ puts it back exactly');
      check(!(await j(ROW)).on, 'and the ▶ is back');
      // 4. Undo the drag; + and −.
      await page.eval(`studioShell.actions.undo()`);
      await sleep(500);
      const pts3 = await j(POINTS);
      check(!!pts3[0] && Math.hypot(pts3[0][0] - bx, pts3[0][1] - by) < 3, 'Undo brings B back');
      await page.eval(`document.querySelector('[data-part=card] [data-action=motion-more]').click()`);
      await sleep(400);
      check((await j(POINTS)).length === 2 && (await j(ROW)).n === 2, '+ adds a point');
      await page.eval(`document.querySelector('[data-part=card] [data-action=motion-less]').click()`);
      await sleep(400);
      check((await j(POINTS)).length === 1, '− takes it away');
      // A press in the game while ▶ plays stops it (the person is about to do something else).
      await page.eval(`document.querySelector('[data-part=card] [data-part=motion-play]').click()`);
      await sleep(500);
      await page.click(Math.round(size.width * 0.45), Math.round(size.height * 0.3));
      await sleep(400);
      check(!(await j(ROW))?.on, 'a press in the game stops ▶');
      // 5. Spin on the buoy.
      await page.eval(`studioShell.actions.select('buoy')`);
      await sleep(900);
      check((await j(POINTS)).length === 0, 'another pick: the boat\'s path is not drawn');
      await choose('spin');
      await sleep(300);
      const r0 = await j(`JSON.stringify(${DBG}.anchor('buoy').pose.r || 0)`);
      await page.eval(`document.querySelector('[data-part=card] [data-part=motion-play]').click()`);
      await sleep(700);
      const r1 = await j(`JSON.stringify(${DBG}.anchor('buoy').pose.r || 0)`);
      check(Math.abs(r1 - r0) > 0.2, `▶ spins the buoy (${r0.toFixed(2)} → ${r1.toFixed(2)})`);
      await page.eval(`document.querySelector('[data-part=card] [data-part=motion-play]').click()`);
      await sleep(300);
      // 6. Save.
      await page.eval(`studioShell.actions.save()`);
      await sleep(1200);
      const f = existsSync(join(root, 'placement.json')) ? JSON.parse(readFileSync(join(root, 'placement.json'), 'utf8')) : null;
      const mb = f?.motion?.rowboat, mu = f?.motion?.buoy;
      check(!!mb && mb.path.length === 1 && mb.repeat === 'pingpong' && mb.speed === 1.5, `placement.json: rowboat ${JSON.stringify(mb)}`);
      check(!!mu && Math.abs(mu.spin - Math.PI / 2) < 1e-3, `placement.json: buoy ${JSON.stringify(mu)}`);
      check(!f?.objects?.rowboat && !f?.objects?.buoy, 'a motion is not a move: objects stays empty');
      // 7. ▶ Play: the starter's loader runs it.
      const play = await j(`(() => { const b = [...document.querySelectorAll('[data-action=play]')].find((x) => x.offsetParent && x.getBoundingClientRect().width); if (!b) return null; const r = b.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }); })()`);
      await page.click(play.x, play.y);
      const PLAY = `[...document.querySelectorAll('iframe')].map((f) => f.contentWindow.__gameStudio && f.contentWindow.__gameStudio._play).find(Boolean)`;
      await page.waitFor(`(() => { const p = ${PLAY}; return !!p && p.list().length > 0; })()`, 30000);
      await sleep(1500);
      const pose = async () => j(`JSON.stringify(Object.fromEntries(${PLAY}.list().filter((i) => i.key === 'rowboat' || i.key === 'buoy').map((i) => [i.key, i.pose])))`);
      const a = await pose();
      await sleep(800);
      const b = await pose();
      check(!!a.rowboat && Math.hypot(b.rowboat.p[0] - a.rowboat.p[0], b.rowboat.p[2] - a.rowboat.p[2]) > 0.3, 'Play: the boat goes back and forth by itself');
      check(!!a.buoy && Math.abs((b.buoy.r ?? 0) - (a.buoy.r ?? 0)) > 0.2, 'Play: the buoy turns');
    } else {
      // ▶ for the picture: the boat on its way.
      if (size.id !== 'pc') await page.eval(`(() => { const d = document.querySelector('[data-part=card] details.fine'); if (d) d.open = true; return true; })()`);
      await page.eval(`document.querySelector('[data-part=card] [data-part=motion-play]').click()`);
      await sleep(1100);
      if (size.id !== 'pc') await page.eval(`(() => { const d = document.querySelector('[data-part=card] details.fine'); if (d) d.open = false; return true; })()`);
      await sleep(300);
      await shot(page, '2-play');
      // The row itself, with the menu chosen (phone / side window: "…" open).
      if (size.id !== 'pc') {
        await page.eval(`(() => { const d = document.querySelector('[data-part=card] details.fine'); if (d) d.open = true; return true; })()`);
        await sleep(300);
        await shot(page, '3-row');
      }
    }
    const errors = page.logs.filter((l) => /^exception|error:/.test(l) && !/favicon|net::/.test(l));
    check(!errors.length, `no page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
  } finally {
    await browser.close();
    await srv.close?.();
  }
}

for (const size of SIZES) for (const theme of THEMES) await run(size, theme);
console.log(failed ? `${failed} check(s) failed` : 'ok');
process.exit(failed ? 1 : 0);
