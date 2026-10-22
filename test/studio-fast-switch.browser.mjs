// ▶ Play and back in the same page (fast switch, 2026-10-22; a try of the editor: "every time I play and go back to edit it loads
// again — tedious") in a headless browser: the real local server, the built editor, the starters.
// bridge/play-switch.ts says what the switch does; contract.ts `studio:core/play`.
//
//   node test/studio-fast-switch.browser.mjs [--only time,cove,ruins,fresh] [--times <n>] [--before <studio-ui dir>]
//
// time   Lantern Cove (three.js) and Firefly Ruins (PixiJS), PC 1280×800: ▶ Play and back to Edit, `--times` rounds
//        (3), timed in the editor's own page from the press to:
//          Play — the game page's corner mark is up (play/on reached it: the game runs and can be asked);
//          Edit — the editor is up again: the list is there and the page's editor answers (`_debug`).
//        With --before <dir> (the `skills/arrange/bin/studio-ui` of an older build) the same rounds with that editor:
//        the before / after numbers come from both.
// cove   Lantern Cove, PC: an unsaved move (the lighthouse) → Play (Try without saving): the same page (a mark left on
//        its window is still there), the move in the running game, the game's frames running, its first frame step
//        one frame (not the time spent editing), the boats sailing. Back in Edit: the same page, every object where it
//        was before Play (what the game moved is not kept), the same edit camera, the pick, Save · 1. Play again,
//        pause (❚❚), Edit while paused, Play: the game runs again.
// ruins  Firefly Ruins (2D), PC: Play and back in the same page; the poses as in Edit.
// fresh  Lantern Cove, PC: Play's ▾ → "Play from the start": a new page (the mark is gone), playing; Edit after it opens
//        a new edit page (as before the fast switch).
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStudioServer } from '../src/server/server.mjs';
import { launch, newPage } from './adapters-2d/cdp.mjs';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const take = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args.splice(i, 2)[1] : null;
};
const ONLY = take('--only')?.split(',') || null;
const TIMES = Number(take('--times') || 3);
const BEFORE = take('--before');
// How long to let a new editor settle before the first round (its watch, the self-check, the list's pictures).
// 8000 ms (was 2500, 2026-10-22): with software rendering the self-check can still be running at 2.5 s, Play then waits
// for it and the first Edit's core/ready answer was sometimes missed ("every round finished" failed 1 in 3 runs).
const SETTLE = Number(take('--settle') || 8000);
// --games cove,ruins: which games `time` measures.
const GAMES = take('--games')?.split(',') || ['cove', 'ruins'];
const want = (n) => !ONLY || ONLY.includes(n);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const FR = `document.querySelector('iframe.game:not(.leaving)')`;
const GW = `${FR}.contentWindow`;
const OV = `${FR}.contentDocument.querySelector('game-studio-play')`;
const IN = {
  // The editor is up: the list is there, the page's editor answers, the shell is in Edit.
  edit: `document.querySelector('.shell').dataset.playing === 'off' && document.querySelector('.shell').dataset.items === 'seen'
    && document.querySelectorAll('.obj, .noname').length > 0 && !!${GW}?.__gameStudio?._debug`,
  // Play is up: the shell is in Play and the game page's corner mark is shown (play/on reached the page).
  play: `document.querySelector('.shell').dataset.playing === 'on' && !!${OV}?.shadowRoot?.querySelector('.mark') && ${OV}.style.display !== 'none'
    && !${GW}.__gameStudio._debug`,
  list: `JSON.stringify(${GW}.__gameStudio._debug ? ${GW}.__gameStudio._debug.list() : ${GW}.__gameStudio._play.list())`,
  // A frame loop of the page's own through the game's requestAnimationFrame (what a game's loop does).
  probe: `(() => { const w = ${GW}; if (w.__pp) return true; w.__pp = { f: 0, st: [] };
    const loop = (t) => { w.__pp.f++; w.__pp.st.push(t); if (w.__pp.st.length > 30) w.__pp.st.shift(); w.requestAnimationFrame(loop); }; w.requestAnimationFrame(loop); return true; })()`,
  pp: `JSON.stringify({ f: ${GW}.__pp.f, st: ${GW}.__pp.st.slice(), now: ${GW}.performance.now() })`,
};
// Press ▶ Play / Edit in the editor's page and time, there, two things (ms from the press):
//   page   — the game page answered: Play's play/hello, or Edit's core/ready `editing: true` (the page's editor is up);
//   screen — `cond` holds in a frame of the editor's page (checked every frame): what the person sees.
// WHY both: in headless Chrome (software GL) a game's own resize (the side panel steps away in Play and comes back in
// Edit, so the game's canvas changes size) takes about a second per resize in WebGLRenderer.setSize, before and after
// this change alike; on a real GPU it is a few ms. `page` is the switch itself; `screen` includes that.
const timed = (cond, answer) => `new Promise((res) => { const t0 = performance.now(); let page = -1;
  const on = (e) => { const d = e.data; if (page < 0 && d && (${answer})) page = Math.round(performance.now() - t0); };
  window.addEventListener('message', on);
  document.querySelector('button.play').click();
  const tick = () => { let ok = false; try { ok = !!(${cond}); } catch {} const ms = performance.now() - t0;
    if (ok || ms > 60000) { window.removeEventListener('message', on); res({ page, screen: ok ? Math.round(ms) : -1 }); } else requestAnimationFrame(tick); };
  requestAnimationFrame(tick); })`;
const ANSWER = { play: `d.type === 'studio:play/hello'`, edit: `d.type === 'studio:core/ready' && d.editing === true` };
// What of IN.play is missing (a timeout's message).
const PLAY_PARTS = `JSON.stringify({ playing: document.querySelector('.shell').dataset.playing, host: !!${OV}, mark: !!${OV}?.shadowRoot?.querySelector('.mark'),
  display: ${OV}?.style.display, debug: !!${GW}.__gameStudio._debug, switchPlaying: ${GW}.__gameStudio._play?.playing?.() })`;
const j = async (page, expr) => JSON.parse((await page.eval(expr)) || 'null');
const arr = (v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const close = (a, b, d = 1e-3) => !!a && !!b && arr(a).length === arr(b).length && arr(a).every((v, i) => Math.abs(v - arr(b)[i]) < d);
/** The keys of `a` whose pose (place, turn, size, tilt) differs from `b`'s. */
/** Two view states the same, number by number (a restored camera may differ in the last digits). */
const sameView = (a, b) => {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-4;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return a === b;
  const ks = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...ks].every((k) => sameView(a[k], b[k]));
};
const samePoses = (a, b, d = 1e-3) => {
  const m = new Map(b.map((i) => [i.key, i.pose]));
  const same = (x, y) => close(x.p, y.p, d) && close(arr(x.r), arr(y.r), d) && close(arr(x.s), arr(y.s), d) && close(arr(x.t), arr(y.t), d);
  return a.filter((i) => m.has(i.key) && !same(i.pose, m.get(i.key))).map((i) => i.key);
};

/** ▶ Play / Edit as a person presses it; with changes not saved, Play's window → Try without saving. */
async function pressPlay(page) {
  await page.eval(`document.querySelector('button.play').click()`);
  for (let i = 0; i < 6; i++) {
    await sleep(100);
    const asked = await page.eval(`(() => { const b = document.querySelector('[data-part=unsaved-guard]:not([hidden]) [data-action=guard-discard]'); if (b) b.click(); return !!b; })()`);
    if (asked) return true;
  }
  return false;
}

let failed = 0;
const check = (ok, what) => {
  console.log(`  ${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failed++;
};

function gameFolder(src) {
  const root = mkdtempSync(join(tmpdir(), 'fast-switch-'));
  cpSync(join(PKG, src), root, { recursive: true });
  for (const f of ['placement.json', '.studio/requests', '.studio/status.json', '.studio/watch.json']) rmSync(join(root, f), { recursive: true, force: true });
  mkdirSync(join(root, '.studio/ui'), { recursive: true });
  writeFileSync(join(root, '.studio/ui/prefs.json'), JSON.stringify({ version: 1, lang: 'en' }));
  return root;
}

const browser = await launch();
async function open(src, uiDir) {
  const root = gameFolder(src);
  const srv = await startStudioServer({ root, uiDir: uiDir || join(PKG, 'skills/arrange/bin/studio-ui'), log: () => {}, env: { CLAUDECODE: '1' } });
  const page = await newPage(browser, { width: 1280, height: 800 });
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await page.goto(srv.url);
  await page.waitFor(IN.edit, 90000);
  // The editor's first moments (its watch of the game, the self-check, the list's pictures).
  await sleep(SETTLE);
  return { root, page, close: async () => { await page.close(); srv.close(); rmSync(root, { recursive: true, force: true }); } };
}

/** `TIMES` rounds of Play → Edit; the times (ms) of each. */
async function rounds(src, uiDir) {
  const g = await open(src, uiDir);
  const play = [], edit = [];
  try {
    for (let i = 0; i < TIMES; i++) {
      play.push(await g.page.eval(timed(IN.play, ANSWER.play)));
      if (play[play.length - 1].screen < 0) console.log('    play parts:', await g.page.eval(PLAY_PARTS));
      await sleep(1500);
      edit.push(await g.page.eval(timed(IN.edit, ANSWER.edit)));
      if (edit[edit.length - 1].screen < 0) console.log('    edit: still not up after 60 s');
      await sleep(1500);
    }
  } finally {
    await g.close();
  }
  return { play, edit };
}
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

async function time() {
  const all = { cove: ['Lantern Cove (three.js)', 'starters/lantern-cove'], ruins: ['Firefly Ruins (PixiJS)', 'starters/firefly-ruins'] };
  for (const [name, src] of GAMES.map((g) => all[g])) {
    console.log(`time: ${name}, ${TIMES} rounds`);
    const say = (tag, r) => {
      for (const k of ['play', 'edit']) {
        const p = r[k].map((x) => x.page), s = r[k].map((x) => x.screen);
        console.log(`  ${tag}  ${k === 'play' ? 'Play' : 'Edit'}  page ${p.join(' / ')} ms (median ${median(p)})   screen ${s.join(' / ')} ms (median ${median(s)})`);
      }
    };
    if (BEFORE) say('before', await rounds(src, resolve(BEFORE)));
    const a = await rounds(src);
    say('after ', a);
    check([...a.play, ...a.edit].every((x) => x.screen >= 0 && x.page >= 0), 'every round finished');
  }
}

async function cove() {
  console.log('cove: Lantern Cove, PC 1280×800');
  const g = await open('starters/lantern-cove');
  const { page } = g;
  try {
    await page.eval(`(${GW}.__fastSwitchMark = 'the first page', true)`);
    // An unsaved move, as a person types it on the card.
    await page.eval(`studioShell.actions.select('lighthouse')`);
    await sleep(700);
    await page.eval(`(() => { const i = document.querySelector('[data-part=card] .fields input'); i.value = String((parseFloat(i.value) || 0) + 4); i.dispatchEvent(new Event('change')); return true; })()`);
    await sleep(1200);
    const editList = await j(page, IN.list);
    const view = await page.eval(`JSON.stringify(${GW}.__gameStudio._debug.view())`);
    const lighthouse = editList.find((i) => i.key === 'lighthouse').pose.p;
    const fab = await page.eval(`document.querySelector('[data-part=save]').innerText.replace(/\\s+/g, ' ').trim()`);
    check(/1/.test(fab), `an unsaved move ("${fab}")`);
    await page.eval(IN.probe);

    // ▶ Play: the window (unsaved), Try without saving.
    await page.eval(`document.querySelector('button.play').click()`);
    await page.waitFor(`!!document.querySelector('[data-part=unsaved-guard]:not([hidden]) [data-action=guard-discard]')`, 5000);
    // In Edit the game's clock stands still (core/time.ts `clock`): the time spent editing is no step for the game.
    const e0 = await page.eval(`${GW}.performance.now()`);
    await sleep(1500);
    const e1 = await page.eval(`${GW}.performance.now()`);
    check(e1 === e0, `Edit: the game's clock stands still (${Math.round(e1 - e0)} ms in 1.5 s)`);
    const before = await j(page, IN.pp);
    await page.eval(`document.querySelector('[data-part=unsaved-guard]:not([hidden]) [data-action=guard-discard]').click()`);
    await page.waitFor(IN.play, 20000);
    check((await page.eval(`${GW}.__fastSwitchMark`)) === 'the first page', 'Play: the same page (no reload)');
    check((await page.eval(`${GW}.__gameStudio._play.playing()`)) === true, 'Play: the page says it is playing');
    const playList = await j(page, IN.list);
    check(close(playList.find((i) => i.key === 'lighthouse')?.pose.p, lighthouse, 0.01), 'Play: the unsaved move is in the running game');
    await sleep(2500);
    const after = await j(page, IN.pp);
    // Headless software GL draws Lantern Cove at a few frames a second: "runs" = more than a couple of frames.
    check(after.f - before.f >= 3, `Play: the game's frames run (${after.f - before.f} in 2.5 s)`);
    const steps = after.st.slice(1).map((t, i) => t - after.st[i]);
    // The first frames after Play: the probe's last frame in Edit was minutes of page time ago in a real session; with
    // the clock stopped there the game sees one frame's step. Every step under 250 ms (one slow headless frame).
    // The first frame after Play follows on from the last one before Edit held the game: no step of the seconds spent in
    // Edit (above: 1.5 s and more). Headless software GL draws a frame in up to ~0.4 s, so "under 1 s".
    // From: the game's last frame in Edit, or (the probe started in a held page) the clock where Edit stopped it.
    const from = before.st.length ? before.st[before.st.length - 1] : e1;
    const firstStep = after.st.length ? after.st.find((t) => t > from) - from : Infinity;
    check(firstStep < 1000 && Math.max(...steps) < 1000, `Play: the first frame steps ${Math.round(firstStep)} ms, not the time in Edit (largest step ${Math.round(Math.max(...steps))} ms)`);
    // The game moves something itself (as the player sailing would): the sailboat, through three.js.
    await page.eval(`(() => { let n = 0; for (const sc of ${GW}.__studioThree.scenes) sc.traverse((o) => { if (o.userData?.studioKey === 'sailboat') { o.position.x += 3; o.rotation.y += 0.5; n++; } }); return n; })()`);
    await sleep(600);
    const moved = samePoses(await j(page, IN.list), playList, 0.01);
    check(moved.includes('sailboat'), `Play: the game moved the sailboat (${moved.slice(0, 4).join(', ')})`);
    check((await page.eval(`document.querySelector('[data-part=save]').innerText.replace(/\\s+/g, ' ').trim()`)) === fab, 'Play: Save · 1 beside Play');

    // Back to Edit: the same page, the layout, the camera, the pick.
    await page.eval(`document.querySelector('button.play').click()`);
    await page.waitFor(IN.edit, 20000);
    check((await page.eval(`${GW}.__fastSwitchMark`)) === 'the first page', 'Edit: the same page (no reload)');
    const back = await j(page, IN.list);
    const off = samePoses(back, editList);
    check(off.length === 0 && back.length === editList.length, `Edit: every object where it was before Play (${back.length} objects${off.length ? `; off: ${off.join(', ')}` : ''})`);
    const viewBack = await page.eval(`JSON.stringify(${GW}.__gameStudio._debug.view())`);
    check(sameView(JSON.parse(viewBack), JSON.parse(view)), `Edit: the same edit camera${sameView(JSON.parse(viewBack), JSON.parse(view)) ? '' : ` (${view} → ${viewBack})`}`);
    check((await page.eval(`studioShell.selected()`)) === 'lighthouse', 'Edit: the lighthouse still picked');
    check((await page.eval(`document.querySelector('[data-part=save]').innerText.replace(/\\s+/g, ' ').trim()`)) === fab, `Edit: ${fab} as before`);
    check((await page.eval(`${OV}.style.display`)) === 'none', 'Edit: the play overlay is put away');
    const held = await j(page, IN.pp);
    await sleep(800);
    check((await j(page, IN.pp)).f - held.f <= 1, 'Edit: the game is held again');

    // Play again, pause, Edit while paused, Play: it runs again.
    await pressPlay(page);
    await page.waitFor(IN.play, 20000).catch(async (e) => {
      console.log('    play parts:', await page.eval(PLAY_PARTS));
      throw e;
    });
    check((await page.eval(`${OV}.shadowRoot.querySelector('.mark .word').offsetParent !== null`)) === true, 'Play again: the corner mark is back');
    await page.eval(`${OV}.shadowRoot.querySelector('[data-part=pause-button]').click()`);
    await page.waitFor(`!!${OV}.shadowRoot.querySelector('[data-part=pause-chat]:not([hidden])')`, 5000);
    const p0 = await j(page, IN.pp);
    await sleep(800);
    check((await j(page, IN.pp)).f - p0.f <= 1, 'Pause: held');
    await page.eval(`document.querySelector('button.play').click()`);
    await page.waitFor(IN.edit, 20000);
    check(samePoses(await j(page, IN.list), editList).length === 0, 'Edit from a pause: the layout');
    check((await page.eval(`${OV}.style.display`)) === 'none', 'Edit from a pause: the pause panel put away with the overlay');
    await pressPlay(page);
    await page.waitFor(IN.play, 20000);
    const r0 = await j(page, IN.pp);
    await sleep(1200);
    check((await j(page, IN.pp)).f - r0.f >= 2, 'Play after a pause and Edit: the game runs');
    check(!(await page.eval(`!!${OV}.shadowRoot.querySelector('[data-part=pause-chat]:not([hidden])')`)), 'Play after a pause and Edit: no pause panel left');
    await page.eval(`document.querySelector('button.play').click()`);
    await page.waitFor(IN.edit, 20000);
    check((await page.eval(`${GW}.__fastSwitchMark`)) === 'the first page', 'after three rounds: still the first page');
  } finally {
    await g.close();
  }
}

async function ruins() {
  console.log('ruins: Firefly Ruins (2D), PC');
  const g = await open('starters/firefly-ruins');
  const { page } = g;
  try {
    await page.eval(`(${GW}.__fastSwitchMark = 1, true)`);
    const editList = await j(page, IN.list);
    await page.eval(IN.probe);
    const f0 = await j(page, IN.pp);
    await page.eval(`document.querySelector('button.play').click()`);
    await page.waitFor(IN.play, 20000);
    await sleep(2000);
    check((await j(page, IN.pp)).f - f0.f >= 3, 'Play: the game runs');
    check((await page.eval(`${GW}.__fastSwitchMark`)) === 1, 'Play: the same page');
    await page.eval(`document.querySelector('button.play').click()`);
    await page.waitFor(IN.edit, 20000);
    check((await page.eval(`${GW}.__fastSwitchMark`)) === 1, 'Edit: the same page');
    const off = samePoses(await j(page, IN.list), editList);
    check(off.length === 0, `Edit: the layout as before${off.length ? ` (off: ${off.join(', ')})` : ''}`);
  } finally {
    await g.close();
  }
}

async function fresh() {
  console.log('fresh: Play from the start (Play\'s ▾), Lantern Cove PC');
  const g = await open('starters/lantern-cove');
  const { page } = g;
  try {
    await page.eval(`(${GW}.__fastSwitchMark = 1, true)`);
    check((await page.eval(`!!document.querySelector('[data-action=play-more]')?.offsetParent`)) === true, 'Play has its ▾');
    await page.eval(`document.querySelector('[data-action=play-more]').click()`);
    await page.waitFor(`!!document.querySelector('[data-part=context-menu]:not([hidden]) [data-action=ctx-play-fresh]')`, 3000);
    const label = await page.eval(`document.querySelector('[data-action=ctx-play-fresh]').textContent`);
    check(/Play from the start/.test(label), `its row: "${label}"`);
    await page.eval(`document.querySelector('[data-action=ctx-play-fresh]').click()`);
    await page.waitFor(`${IN.play} && ${GW}.__fastSwitchMark === undefined`, 30000);
    check(true, 'a new page, playing');
    check(!(await page.eval(`new URL(${FR}.src).searchParams.has('studio')`)), 'the Play page\'s address (no studio=edit)');
    await page.eval(`(${GW}.__fastSwitchMark = 2, true)`);
    await page.eval(`document.querySelector('button.play').click()`);
    await page.waitFor(`${IN.edit} && ${GW}.__fastSwitchMark === undefined`, 60000);
    check(true, 'Edit after it: a new edit page, as before');
    // ⌘K lists it too.
    const rows = await page.eval(`(document.querySelector('[data-action=palette]')?.click(), new Promise((r) => setTimeout(() => r([...document.querySelectorAll('[data-action]')].some((e) => e.dataset.action === 'play-fresh')), 300)))`);
    check(rows === true, '⌘K lists "Play from the start"');
  } finally {
    await g.close();
  }
}

try {
  if (want('cove')) await cove();
  if (want('ruins')) await ruins();
  if (want('fresh')) await fresh();
  if (want('time')) await time();
} catch (e) {
  check(false, `${e.message}`);
} finally {
  await browser.close();
}
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
