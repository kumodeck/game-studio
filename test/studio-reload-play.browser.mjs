// ▶ Play → Edit → ▶ Play after the game was read again (studio-fix-reload-play, 2026-10-24) in a headless browser: the
// real local server, the built editor, the games.
//
// The bug (found on v0.1.49): after the game was read again in the editor — `--do editor.reload`,
// a code layout's numbers changed (softReload('draft'), the same soft reload), the AI's change, the editor page itself
// reloaded — ▶ Play, Edit, ▶ Play froze the game's picture on the second Play: 0 frames in 3 s. v0.1.49 reads the game
// again on every change of a layout's numbers, so anyone trying layouts met it at once.
// The cause (src/adapters/three/boot.js `heldOnce`): the three.js boot's safety net for the first look — 8 s after a
// game's studio.waitForReady() with no ready() (test/neon-run) it holds the game — fired whenever its 8 s were up. On a
// new game page a person presses Play → Edit → Play within those 8 s, and the net held the game in the middle of Play
// (the editor had let it go): the browser still gave frames, the game's frame callbacks were parked until the next Edit.
//
//   node test/studio-reload-play.browser.mjs [--only neon,cove] [--times <n>] [--after <ms>] [--base]
//
// neon  test/neon-run (3D; waitForReady() and no ready(): the 8 s net; the game's loader copied in, a motion at the start)
// cove  starters/lantern-cove (three.js; waitForReady() and ready({ camera }))
// Each: `--times` rounds (5) of: read the game again (the AI's hands: editor.reload) → ▶ Play at once (`--after`, 0)
// → Edit → ▶ Play → Edit; then one round after the editor page itself was reloaded (editor.reload --editor). In every
// Play: the game's frames run — a frame loop on the game page's own requestAnimationFrame (what a game's loop runs on)
// gets its first frame within 15 s (Lantern Cove's first full draw takes seconds in headless software GL, on a page
// opened or read again too: not this bug) and then at least `min` frames in 3 s — and the three.js boot does not hold
// the game while it plays.
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStudioServer } from '../src/server/server.mjs';
import { askEditor } from '../src/server/hands-cli.mjs';
import { launch, newPage } from './adapters-2d/cdp.mjs';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const take = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args.splice(i, 2)[1] : null;
};
const ONLY = take('--only')?.split(',') || null;
const TIMES = Number(take('--times') || 5);
// 8000 ms: as studio-fast-switch's SETTLE (the editor's first moments: its watch, the self-check, the list's pictures).
const SETTLE = Number(take('--settle') || 8000);
// --after <ms>: how long after the game was read again ▶ Play is pressed. 0 (default): at once, inside the boot's 8 s —
// what showed the bug every time (2500 let the 8 s run out in Edit, where a hold does no harm, and it passed).
const AFTER = Number(take('--after') || 0);
// --base: a round 0 first, on the page opened first, without reading the game again.
const BASE = args.includes('--base');
const want = (n) => !ONLY || ONLY.includes(n);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const FR = `document.querySelector('iframe.game:not(.leaving)')`;
const GW = `${FR}.contentWindow`;
const OV = `${FR}.contentDocument.querySelector('game-studio-play')`;
const IN = {
  // As studio-fast-switch.browser.mjs: the editor is up (and the old frame of a soft reload gone) / Play is up.
  edit: `document.querySelector('.shell').dataset.playing === 'off' && document.querySelector('.shell').dataset.items === 'seen'
    && document.querySelectorAll('.obj, .noname').length > 0 && !!${GW}?.__gameStudio?._debug && document.querySelectorAll('iframe.game').length === 1`,
  play: `document.querySelector('.shell').dataset.playing === 'on' && !!${OV}?.shadowRoot?.querySelector('.mark') && ${OV}.style.display !== 'none'
    && !${GW}.__gameStudio._debug`,
};
// The game page's frames: wait (up to 15 s) for the first frame of a loop on its requestAnimationFrame, then count them
// for `ms`. With, for the log: the three.js boot's holds and releases on this page (w.__holds, `listen` below), whether
// it is held now, core time's freeze, and the editor page's own frames (0 there too = the browser gave no frames at all).
const frames = (ms) => `new Promise((res) => { const w = ${GW}; const p0 = performance.now(); let first = -1, f = 0, tf = 0, on = true, t0 = 0;
  const loop = () => { if (!on) return; if (first < 0) { first = Math.round(performance.now() - p0); t0 = performance.now(); setTimeout(done, ${ms}); } else f++; w.requestAnimationFrame(loop); };
  const tloop = () => { if (!on) return; if (first >= 0) tf++; requestAnimationFrame(tloop); };
  const done = () => { on = false; res(JSON.stringify({ first, f, ms: Math.round(first < 0 ? 0 : performance.now() - t0), top: tf,
    holds: w.__holds || [], held: !!w.__studioThree?.held, frozen: !!w.__gameStudio?.core?.time?.frozen })); };
  w.requestAnimationFrame(loop); requestAnimationFrame(tloop);
  setTimeout(() => { if (first < 0) done(); }, 15000); })`;

let failed = 0;
const check = (ok, what) => {
  console.log(`  ${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failed++;
};

function gameFolder(src, file) {
  const root = mkdtempSync(join(tmpdir(), 'reload-play-'));
  cpSync(resolve(PKG, src), root, { recursive: true });
  for (const f of ['placement.json', '.studio/requests', '.studio/status.json', '.studio/watch.json']) rmSync(join(root, f), { recursive: true, force: true });
  if (file) writeFileSync(join(root, 'placement.json'), JSON.stringify(file, null, 2));
  mkdirSync(join(root, '.studio/ui'), { recursive: true });
  writeFileSync(join(root, '.studio/ui/prefs.json'), JSON.stringify({ version: 1, lang: 'en' }));
  return root;
}

/** ▶ Play / Edit as a person presses it; with changes not saved, Play's window → Try without saving. */
async function press(page) {
  await page.eval(`document.querySelector('button.play').click()`);
  for (let i = 0; i < 6; i++) {
    await sleep(100);
    const asked = await page.eval(`(() => { const b = document.querySelector('[data-part=unsaved-guard]:not([hidden]) [data-action=guard-discard]'); if (b) b.click(); return !!b; })()`);
    if (asked) return;
  }
}

const browser = await launch();
// Neon Run with a motion at the start (studio-fast-switch's restore): the game's loader plays it in the page.
const NEON_FILE = { version: 1, tool: 'placement', dim: '3d', space: 'local', objects: {},
  motions: [{ name: 'Slide', len: 2, keys: { p: [{ t: 0, v: [0, 0, 0] }, { t: 2, v: [4, 0, 0] }] } }],
  motion: { gate: { clips: [{ use: 'Slide', when: { on: 'start' } }] } } };
// `min`: frames in 3 s that count as running. Headless software GL: Neon Run ~110–180, Lantern Cove ~7–15 (its water,
// shadows and bloom); the bug is 0.
const GAMES = {
  neon: { name: 'Neon Run', src: 'test/neon-run', file: NEON_FILE, min: 30, prepare: (root) => cpSync(join(PKG, 'skills/arrange/bin/studio-placement.js'), join(root, 'studio-placement.js')) },
  cove: { name: 'Lantern Cove', src: 'starters/lantern-cove', min: 3 },
};

async function run(id) {
  const game = GAMES[id];
  console.log(`${id}: ${game.name} — read again → ▶ Play → Edit → ▶ Play, ${TIMES} rounds + the editor page reloaded`);
  const root = gameFolder(game.src, game.file);
  game.prepare?.(root);
  const srv = await startStudioServer({ root, uiDir: join(PKG, 'skills/arrange/bin/studio-ui'), log: () => {}, env: { CLAUDECODE: '1' } });
  const page = await newPage(browser, { width: 1280, height: 800 });
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  const ai = (op) => askEditor({ origin: srv.origin, stopToken: srv.stopToken }, [op], 'claude');
  // Every hold / release of the three.js boot on the game page now, with when (the page's ms): what held it, for the log.
  const listen = () => page.eval(`(() => { const w = ${GW}; const b = w.__studioThree; if (!b || w.__holds) return true; w.__holds = [];
    b.on((t, d) => { if (t === 'hold' || t === 'release') w.__holds.push([t, d, Math.round(w.performance.now())]); }); return true; })()`);
  const playFrames = async (when) => {
    await page.waitFor(IN.play, 30000);
    const r = JSON.parse(await page.eval(frames(3000)));
    // Held after the last release = the boot held the game in the middle of Play.
    const last = r.holds[r.holds.length - 1];
    const heldInPlay = r.held || (last && last[0] === 'hold');
    check(r.first >= 0 && r.f >= game.min && !heldInPlay,
      `${when}: the game's frames run (${r.first < 0 ? 'no frame in 15 s' : `first frame after ${r.first} ms, then ${r.f} in ${r.ms} ms`})${heldInPlay ? `; the three.js boot held it (${JSON.stringify(last)})` : ''}`
      + (r.first >= 0 && r.f >= game.min && !heldInPlay ? '' : ` — holds ${JSON.stringify(r.holds)}, frozen ${r.frozen}, editor page frames ${r.top}`));
  };
  // ▶ Play → Edit → ▶ Play → Edit, Play pressed `AFTER` ms after the page came up.
  const round = async (name) => {
    await listen();
    await sleep(AFTER);
    await press(page);
    await playFrames(`${name}, Play 1`);
    await page.eval(`document.querySelector('button.play').click()`);
    await page.waitFor(IN.edit, 30000);
    await sleep(1200);
    await press(page);
    await playFrames(`${name}, Play 2 (after Edit)`);
    await page.eval(`document.querySelector('button.play').click()`);
    await page.waitFor(IN.edit, 30000);
    await sleep(1200);
  };
  try {
    await page.goto(srv.url);
    await page.waitFor(IN.edit, 90000);
    await sleep(SETTLE);
    if (BASE) await round('round 0 (the page opened first)');
    for (let i = 1; i <= TIMES; i++) {
      // Read the game again, as `studio.mjs <game> --do editor.reload` does (softReload: a new frame behind the old one,
      // the same as a code layout's numbers changing).
      const mark = `round-${i}`;
      await page.eval(`(${GW}.__reloadMark = '${mark}', true)`);
      const r = await ai({ do: 'editor.reload' });
      check(r?.results?.[0]?.ok === true, `round ${i}: the game read again (${JSON.stringify(r?.results?.[0] || r).slice(0, 120)})`);
      await page.waitFor(`${GW}?.__reloadMark !== '${mark}'`, 30000);
      await page.waitFor(IN.edit, 60000);
      await round(`round ${i}`);
    }
    // The editor page itself reloaded (editor.reload --editor): a new page, Play at once.
    await page.eval(`(window.__reloadMark = 'whole', true)`);
    const r = await ai({ do: 'editor.reload', editor: true });
    check(r?.results?.[0]?.ok === true, `the editor page reloaded (${JSON.stringify(r?.results?.[0] || r).slice(0, 120)})`);
    await page.waitFor(`window.__reloadMark !== 'whole'`, 30000);
    await page.waitFor(IN.edit, 90000);
    await round('the editor page reloaded');
  } catch (e) {
    check(false, e.message);
  } finally {
    await page.close();
    srv.close();
    rmSync(root, { recursive: true, force: true });
  }
}

try {
  for (const id of Object.keys(GAMES)) if (want(id)) await run(id);
} catch (e) {
  check(false, `${e.message}`);
} finally {
  await browser.close();
}
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
