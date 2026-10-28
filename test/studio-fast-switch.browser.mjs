// ▶ Play and back in the same page (fast switch, 2026-10-22; a try of the editor: "every time I play and go back to edit it loads
// again — tedious") in a headless browser: the real local server, the built editor, the starters.
// bridge/play-switch.ts says what the switch does; contract.ts `studio:core/play`.
//
//   node test/studio-fast-switch.browser.mjs [--only time,cove,ruins,fresh,when,old,scene2d,levels,restore,crumb] [--shots <dir>] [--times <n>] [--before <studio-ui dir>]
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
// ruins  Firefly Ruins (2D), PC: Play and back in the same page; the poses as in Edit. With no placement.json yet, the
//        game's loader still offers to play motions in the page (studio-no-reload).
// fresh  Lantern Cove, PC: Play's ▾ → "Play from the start": a new page (the mark is gone), playing; Edit after it opens
//        a new edit page (as before the fast switch).
// when   (studio-no-reload, 2026-10-22: "when I go back to edit after playing, don't load") Lantern Cove with motions
//        saved in placement.json that wait for something (a key, a cue, a scene motion of two objects on a cue, an area)
//        and one at the start: ▶ Play in the same page (before: a new Play page every time), the start's clip moving,
//        E moving the crate, the game's cue() (the loader the game imported) rolling the barrel and the scene's two
//        objects; Edit: the same page, every object back at the layout, nothing moving; Play again: from the start.
// old    (integrate 1023, 2026-10-23: a real game kept a copy of the loader from before the play hook) `when`
//        with the game's studio-placement.js replaced by an older copy (test/old-loader, v0.1.23): the editor's server
//        answers it with its own loader (src/server/loader-copy.mjs), so ▶ Play → Edit stays in the same page; the
//        copy on disk is unchanged.
// scene2d Firefly Ruins (PixiJS) with a clip at the start and one on a cue: the same in 2D.
// levels Three Isles (levels) with a cue motion on Meadow's flag: Play and Edit in the same page, the flag's clip runs.
// restore (studio-edit-restore, 2026-10-23; a try of the editor on a neon runner: "after playing, Edit came back in the middle of the
//        game — keep the edit scene I was on") test/neon-run (3D, a game that moves most of its things) with a motion on
//        the gate, in light and dark: the gate picked, the timeline open at 1 s, the edit camera turned. ▶ Play, the
//        game runs 3 s, the ship steered, and — as a game does — a new thing added to the scene ('spark') and a hexagon
//        taken out. Edit: every object, the camera, the pick, the timeline (open, 1 s, the gate at its 1 s place) as
//        before Play; the spark out of the scene and the hexagon back. Play again: the game gets its spark back and the
//        hexagon stays out (its own state). Edit again: the edit scene again. `--shots <dir>`: before / after photos.
// crumb  Three Isles (three levels; level-crumb, 2026-10-22) at every size (PC 1280×800, a side window 420×800, a phone
//        390×844 by touch) in light and dark: go to Canyon from the top bar's level crumb, ▶ Play in the same page on
//        Canyon — the crumb is the level's name as words then (no menu) — and Edit: the same page, the crumb a button
//        again, still Canyon.
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
// --shots <dir>: restore's before / after photos (light and dark).
const SHOTS = take('--shots');
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
// WHY the wait for the answer after `screen` holds (2026-10-22, studio-switch-timing): Edit's `screen` can hold BEFORE
// the page's answer is read here. The game page is a same-origin frame: on core/play off it shows its editor at once
// (`_debug` comes back in the same task, play-switch.ts back()), and the core/ready it posts is a task of its own on the
// editor's page — a frame of this page can run in between. The listener used to go when `screen` held, so that answer,
// already on its way, was dropped: page -1 with screen a few ms ("every round finished" failed 1 run in 3; 8 s of
// SETTLE did not help, it was never the settling). `late` = rounds whose answer came after the screen (for the log).
const timed = (cond, answer) => `new Promise((res) => { const t0 = performance.now(); let page = -1, screen = -1;
  const on = (e) => { const d = e.data; if (page < 0 && d && (${answer})) page = Math.round(performance.now() - t0); };
  window.addEventListener('message', on);
  document.querySelector('button.play').click();
  const done = () => { window.removeEventListener('message', on); res({ page, screen, late: screen >= 0 && page >= 0 && page > screen }); };
  // After the screen: up to 5 s more for the page's answer (it comes within a task or two when the page answers at all).
  const wait = () => { if (page >= 0 || performance.now() - t0 > screen + 5000) done(); else setTimeout(wait, 20); };
  const tick = () => { let ok = false; try { ok = !!(${cond}); } catch {} const ms = performance.now() - t0;
    if (ok) { screen = Math.round(ms); wait(); } else if (ms > 60000) done(); else requestAnimationFrame(tick); };
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

function gameFolder(src, file) {
  const root = mkdtempSync(join(tmpdir(), 'fast-switch-'));
  cpSync(resolve(PKG, src), root, { recursive: true });
  for (const f of ['placement.json', '.studio/requests', '.studio/status.json', '.studio/watch.json']) rmSync(join(root, f), { recursive: true, force: true });
  // A saved placement.json (motions that wait for something): saved, so ▶ Play asks nothing.
  if (file) writeFileSync(join(root, 'placement.json'), JSON.stringify(file, null, 2));
  mkdirSync(join(root, '.studio/ui'), { recursive: true });
  writeFileSync(join(root, '.studio/ui/prefs.json'), JSON.stringify({ version: 1, lang: 'en' }));
  return root;
}

const browser = await launch();
/** `vp`: the window (PC 1280×800 by default); touch = the phone emulation, dark = the dark theme. */
async function open(src, uiDir, vp = { w: 1280, h: 800 }, file, prepare) {
  const root = gameFolder(src, file);
  if (prepare) prepare(root);
  const srv = await startStudioServer({ root, uiDir: uiDir || join(PKG, 'skills/arrange/bin/studio-ui'), log: () => {}, env: { CLAUDECODE: '1' } });
  const page = await newPage(browser, { width: vp.w, height: vp.h, mobile: !!vp.touch });
  if (!vp.touch) await page.send('Emulation.setDeviceMetricsOverride', { width: vp.w, height: vp.h, deviceScaleFactor: vp.w < 600 ? 2 : 1, mobile: false });
  if (vp.dark) await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  await page.goto(srv.url);
  await page.waitFor(IN.edit, 90000);
  // The editor's first moments (its watch of the game, the self-check, the list's pictures).
  await sleep(SETTLE);
  return { root, page, close: async () => { await page.close(); srv.close(); rmSync(root, { recursive: true, force: true }); } };
}

/** `TIMES` rounds of Play → Edit; the times (ms) of each. */
async function rounds(src, uiDir, file) {
  const g = await open(src, uiDir, undefined, file);
  const play = [], edit = [], same = [];
  try {
    for (let i = 0; i < TIMES; i++) {
      // Which rounds stayed in the first page (studio-no-reload: the list of the cases that still load a page).
      await g.page.eval(`(${GW}.__roundMark = true, true)`);
      play.push(await g.page.eval(timed(IN.play, ANSWER.play)));
      if (play[play.length - 1].screen < 0) console.log('    play parts:', await g.page.eval(PLAY_PARTS));
      await sleep(1500);
      edit.push(await g.page.eval(timed(IN.edit, ANSWER.edit)));
      if (edit[edit.length - 1].screen < 0) console.log('    edit: still not up after 60 s');
      same.push((await g.page.eval(`${GW}.__roundMark === true`)) === true);
      await sleep(1500);
    }
  } finally {
    await g.close();
  }
  return { play, edit, same };
}
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

// Motions that wait for something (studio-motion-triggers' shape), saved. Lantern Cove: the buoy at the start, the crate
// on E, the barrel (lifted) on the game's cue, a scene motion (two objects, one motion: studio-timeline-2) on a cue, the rowboat
// on an area the player sails into.
const WHEN_FILE = { version: 1, tool: 'placement', dim: '3d', space: 'local', objects: {},
  motions: [
    { name: 'Bob', len: 2, repeat: 'pingpong', keys: { p: [{ t: 0, v: [0, 0, 0] }, { t: 2, v: [0, 0.8, 0] }] } },
    { name: 'Hop', len: 0.8, keys: { p: [{ t: 0, v: [0, 0, 0] }, { t: 0.4, v: [0, 1.4, 0] }, { t: 0.8, v: [0, 0, 0] }] } },
    { name: 'Lift', len: 2, keys: { p: [{ t: 0, v: [0, 0, 0] }, { t: 2, v: [0, 3, 0] }] } },
    { name: 'Pair', len: 2, tracks: { 'pine-1': { p: [{ t: 0, v: [0, 0, 0] }, { t: 2, v: [0, 2, 0] }] }, 'pine-2': { p: [{ t: 0, v: [0, 0, 0] }, { t: 2, v: [0, 2, 0] }] } } },
    { name: 'Row', len: 3, repeat: 'pingpong', keys: { p: [{ t: 0, v: [0, 0, 0] }, { t: 3, v: [-5, 0, 0] }] } },
  ],
  motion: {
    buoy: { clips: [{ use: 'Bob', when: { on: 'start' } }] },
    crate: { clips: [{ use: 'Hop', when: { on: 'key', key: 'KeyE' } }] },
    barrel: { clips: [{ use: 'Lift', when: { on: 'cue', cue: 'barrel-hit' } }] },
    'pine-1': { clips: [{ use: 'Pair', when: { on: 'cue', cue: 'pair' } }] },
    'pine-2': { clips: [{ use: 'Pair', when: { on: 'cue', cue: 'pair' } }] },
    rowboat: { clips: [{ use: 'Row', when: { on: 'enter', area: { p: [10, 0.5, 4], size: [4, 2, 3] }, who: 'player' } }] },
  } };
// Firefly Ruins (2D): the tree sways at the start, the bell rings (a turn) on a cue.
const RUINS_FILE = { version: 1, tool: 'placement', dim: '2d', space: 'local', objects: {},
  motions: [
    { name: 'Sway', len: 2, repeat: 'pingpong', keys: { p: [{ t: 0, v: [0, 0] }, { t: 2, v: [40, 0] }] } },
    { name: 'Ring', len: 1, keys: { r: [{ t: 0, v: [0] }, { t: 1, v: [1] }] } },
  ],
  motion: { tree: { clips: [{ use: 'Sway', when: { on: 'start' } }] }, bell: { clips: [{ use: 'Ring', when: { on: 'cue', cue: 'ring' } }] } } };
// The loader the game imported (the same module: the same URL, imported in the game's own window), for its cue():
// what the game's code would call.
const LOADER = (path) => `${GW}.eval(${JSON.stringify(`import(${JSON.stringify(path)})`)})`;
const poseOf = (list, k) => list.find((i) => i.key === k)?.pose;

/** Play → checks while playing (`during`) → Edit → back at the layout, all in the first page. */
async function sameRound(g, tag, during) {
  const { page } = g;
  await page.eval(`(${GW}.__fastSwitchMark = ${JSON.stringify(tag)}, true)`);
  // Every frame of the editor's page from Play to Edit: no "loading" shown (the status line's opening / waiting / finding
  // words) and no second game frame (a page loading under the one on screen).
  await page.eval(`(() => { const w = window; w.__seen = { loading: 0, frames: 1 }; w.__seenOn = true;
    const f = () => { if (!w.__seenOn) return; const st = document.querySelector('[data-part=status]')?.textContent || '';
      if (/Opening your game|Waiting for the game|Finding objects/.test(st)) w.__seen.loading++;
      w.__seen.frames = Math.max(w.__seen.frames, document.querySelectorAll('iframe.game').length); requestAnimationFrame(f); };
    requestAnimationFrame(f); return true; })()`);
  const editList = await j(page, IN.list);
  await page.eval(`document.querySelector('button.play').click()`);
  await page.waitFor(IN.play, 30000).catch(async (e) => {
    console.log('    play parts:', await page.eval(PLAY_PARTS));
    throw e;
  });
  check((await page.eval(`${GW}.__fastSwitchMark`)) === tag, 'Play: the same page (no reload)');
  await during(editList);
  const t = await page.eval(timed(IN.edit, ANSWER.edit));
  check(t.screen >= 0, `Edit: up in ${t.screen} ms (the page answered in ${t.page} ms)`);
  check((await page.eval(`${GW}.__fastSwitchMark`)) === tag, 'Edit: the same page (no reload)');
  await sleep(300);
  const seen = await j(page, `(window.__seenOn = false, JSON.stringify(window.__seen))`);
  check(seen.loading === 0 && seen.frames === 1, `Play → Edit: no loading shown (${seen.loading} frames), one game page (${seen.frames})`);
  const back = await j(page, IN.list);
  const off = samePoses(back, editList, 0.01);
  check(off.length === 0, `Edit: every object back at the layout${off.length ? ` (off: ${off.join(', ')})` : ''}`);
  await sleep(800);
  const still = samePoses(await j(page, IN.list), back, 1e-4);
  check(still.length === 0, `Edit: nothing moves${still.length ? ` (moving: ${still.join(', ')})` : ''}`);
  return editList;
}

async function when(old = false) {
  console.log(old ? 'old: the same with an older copy of the loader in the game (no play hook), PC' : 'when: Lantern Cove with motions that wait for something, PC');
  const OLD = join(PKG, 'test/old-loader/studio-placement.js');
  const g = await open('starters/lantern-cove', null, undefined, WHEN_FILE, old ? (root) => cpSync(OLD, join(root, 'studio-placement.js')) : undefined);
  const { page } = g;
  try {
    if (old) {
      // What the game's own import got: the editor's loader (its play hook found a world), not the copy on disk.
      const hooks = await page.eval(`(() => { const s = ${GW}[Symbol.for('game-studio.play')]; return s ? [...s].filter((h) => h.has()).length : -1; })()`);
      check(hooks === 1, `old: the game's import is answered with the editor's loader (play hooks with a world: ${hooks})`);
      // The editor's own loader is /__studio/studio-placement.js (here the source file: the test runs src/server).
      const same = await page.eval(`Promise.all(['/studio-placement.js', '/__studio/studio-placement.js'].map((u) => ${GW}.fetch(u).then((r) => r.text()))).then(([a, b]) => a === b && /game-studio\\.play/.test(a))`);
      check(same === true, 'old: /studio-placement.js is the current loader');
      check(readFileSync(join(g.root, 'studio-placement.js'), 'utf8') === readFileSync(OLD, 'utf8'), 'old: the copy on disk is unchanged');
    }
    const moved = (a, b, k) => !close(poseOf(a, k)?.p, poseOf(b, k)?.p, 0.01) || !close(arr(poseOf(a, k)?.r), arr(poseOf(b, k)?.r), 0.01);
    const playing = async (editList) => {
      // Up to 6 s: headless software GL draws a few frames a second, and the first Play's resize of the game takes
      // seconds there (a few ms on a GPU: STUDIO_ANGLE=metal).
      let now;
      const t0 = Date.now();
      for (let i = 0; i < 30 && !moved((now = await j(page, IN.list)), editList, 'buoy'); i++) await sleep(200);
      check(moved(now, editList, 'buoy'), `Play: the buoy bobs (at the start; seen after ${Date.now() - t0} ms, y ${poseOf(editList, 'buoy')?.p[1]} → ${poseOf(now, 'buoy')?.p[1]})`);
      check(!moved(now, editList, 'crate') && !moved(now, editList, 'barrel'), 'Play: the crate and the barrel wait');
      await page.eval(`(() => { const w = ${GW}; w.dispatchEvent(new w.KeyboardEvent('keydown', { code: 'KeyE', key: 'e' })); return true; })()`);
      for (let i = 0; i < 10 && !moved((now = await j(page, IN.list)), editList, 'crate'); i++) await sleep(100);
      check(moved(now, editList, 'crate'), 'Play: E — the crate hops');
      const cue = await page.eval(`${LOADER('/studio-placement.js')}.then((m) => [m.cue('barrel-hit'), m.cue('pair')])`);
      check(Array.isArray(cue) && cue.every(Boolean), `Play: the game's cue() starts them (${JSON.stringify(cue)})`);
      // Polled (software GL's first Play draws a frame a second or slower; see the buoy above).
      const all = (l) => ['barrel', 'pine-1', 'pine-2'].every((k) => moved(l, editList, k));
      for (let i = 0; i < 30 && !all((now = await j(page, IN.list))); i++) await sleep(200);
      check(moved(now, editList, 'barrel'), 'Play: the cue lifts the barrel');
      check(moved(now, editList, 'pine-1') && moved(now, editList, 'pine-2'), 'Play: the scene motion moves both pines');
    };
    await sameRound(g, 'when-1', playing);
    // The game's calls do nothing in Edit (the editor owns every pose).
    const cueInEdit = await page.eval(`${LOADER('/studio-placement.js')}.then((m) => m.cue('barrel-hit'))`);
    check(cueInEdit === false, "Edit: the game's cue() does nothing");
    await sameRound(g, 'when-1', playing);
  } catch (e) {
    check(false, e.message);
  } finally {
    await g.close();
  }
}

async function scene2d() {
  console.log('scene2d: Firefly Ruins (PixiJS) with motions, PC');
  const g = await open('starters/firefly-ruins', null, undefined, RUINS_FILE);
  const { page } = g;
  try {
    await sameRound(g, '2d', async (editList) => {
      await sleep(1000);
      let now = await j(page, IN.list);
      check(!close(poseOf(now, 'tree')?.p, poseOf(editList, 'tree')?.p, 0.5), 'Play: the tree sways (at the start)');
      const cue = await page.eval(`${LOADER('/studio-placement.js')}.then((m) => m.cue('ring'))`);
      check(cue === true, "Play: the game's cue('ring')");
      await sleep(500);
      now = await j(page, IN.list);
      check(!close(arr(poseOf(now, 'bell')?.r), arr(poseOf(editList, 'bell')?.r), 0.01), 'Play: the bell turns');
    });
  } catch (e) {
    check(false, e.message);
  } finally {
    await g.close();
  }
}

async function levels() {
  console.log('levels: Three Isles with a cue motion on Meadow\'s flag, PC');
  const file = { version: 1, tool: 'placement', dim: '3d', space: 'local', objects: {},
    motions: [{ name: 'Rise', len: 1, keys: { p: [{ t: 0, v: [0, 0, 0] }, { t: 1, v: [0, 3, 0] }] } }],
    levels: [{ id: 'meadow', objects: {}, motion: { flag: { clips: [{ use: 'Rise', when: { on: 'cue', cue: 'rise' } }] } } }] };
  const g = await open('examples/three-isles', null, undefined, file);
  const { page } = g;
  try {
    await sameRound(g, 'levels', async (editList) => {
      check((await page.eval(`${GW}.document.getElementById('level')?.textContent`)) === 'Meadow', 'Play: on Meadow');
      const cue = await page.eval(`${LOADER('/studio-placement.js')}.then((m) => m.cue('rise'))`);
      check(cue === true, "Play: the game's cue('rise')");
      await sleep(600);
      const now = await j(page, IN.list);
      check((poseOf(now, 'flag')?.p[1] ?? 0) > (poseOf(editList, 'flag')?.p[1] ?? 0) + 0.3, 'Play: the flag rises');
    });
    check(/Meadow/.test(await page.eval(`document.querySelector('.brand .level-switch')?.textContent || ''`)), 'Edit: still Meadow');
  } catch (e) {
    check(false, e.message);
  } finally {
    await g.close();
  }
}

/** A game that is all HTML (no world), as test/studio-ui-layer.browser.mjs makes it: a folder of its own. */
function htmlOnly() {
  const dir = mkdtempSync(join(tmpdir(), 'fast-switch-html-'));
  writeFileSync(join(dir, 'index.html'), `<!doctype html><html><head><meta charset="utf-8"><title>Quiz Night</title>
<style>html,body{margin:0;height:100%;background:#123;color:#fff;font:600 20px system-ui}
.q{position:absolute;left:50%;top:30%;translate:-50% 0;font-size:40px}.score{position:fixed;right:20px;top:16px}</style></head>
<body><div class="q" data-studio-key="question">Which planet is red?</div><div class="score" data-studio-key="score">Score 0</div>
<script>requestAnimationFrame(function f(){ requestAnimationFrame(f); });</script></body></html>`);
  return dir;
}

async function time() {
  // `when`: Lantern Cove with motions that wait for something (WHEN_FILE) — before studio-no-reload a new Play page.
  const all = { cove: ['Lantern Cove (three.js)', 'starters/lantern-cove'], ruins: ['Firefly Ruins (PixiJS)', 'starters/firefly-ruins'],
    when: ['Lantern Cove with motions that wait ("when")', 'starters/lantern-cove', WHEN_FILE], ruins2d: ['Firefly Ruins with motions', 'starters/firefly-ruins', RUINS_FILE],
    // The other kinds of game (studio-no-reload's list of every case): a UI layer over a 3D world, levels, Phaser, a
    // world made of HTML, and a game that is all HTML (the UI alone).
    hud: ['Three HUD (a UI layer)', 'examples/three-hud'], isles: ['Three Isles (levels)', 'examples/three-isles'],
    phaser: ['Phaser Garden', 'examples/phaser-garden'], dom: ['DOM Board (a world of HTML)', 'examples/dom-board'], html: ['HTML only (the UI alone)', htmlOnly] };
  for (const [name, from, file] of GAMES.map((g) => all[g])) {
    const src = typeof from === 'function' ? from() : from;
    console.log(`time: ${name}, ${TIMES} rounds`);
    const say = (tag, r) => {
      for (const k of ['play', 'edit']) {
        const p = r[k].map((x) => x.page), s = r[k].map((x) => x.screen);
        const late = r[k].filter((x) => x.late).length;
        console.log(`  ${tag}  ${k === 'play' ? 'Play' : 'Edit'}  page ${p.join(' / ')} ms (median ${median(p)})   screen ${s.join(' / ')} ms (median ${median(s)})${late ? `   answer after the screen: ${late}` : ''}`);
      }
      console.log(`  ${tag}  same page: ${r.same.filter(Boolean).length} of ${r.same.length} rounds`);
    };
    if (BEFORE) say('before', await rounds(src, resolve(BEFORE), file));
    const a = await rounds(src, undefined, file);
    say('after ', a);
    check([...a.play, ...a.edit].every((x) => x.screen >= 0 && x.page >= 0), 'every round finished');
    check(a.same.every(Boolean), 'every round in the same page (no reload)');
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
    // Pause-edit (2026-10-28): ❚❚ Pause to edit in the top bar; the paused moment is the editor (data-moment).
    check((await page.eval(`!!document.querySelector('[data-part=play-pause]:not([hidden])')?.offsetParent`)) === true, 'Play again: ❚❚ Pause to edit is back');
    await page.eval(`document.querySelector('[data-part=play-pause]').click()`);
    await page.waitFor(`document.querySelector('.shell').dataset.moment === 'on'`, 8000);
    const p0 = await j(page, IN.pp);
    await sleep(800);
    check((await j(page, IN.pp)).f - p0.f <= 1, 'Pause: held');
    await page.eval(`document.querySelector('button.play').click()`);
    await page.waitFor(IN.edit, 20000);
    check(samePoses(await j(page, IN.list), editList).length === 0, 'Edit from a pause: the layout');
    check((await page.eval(`${OV}.style.display`)) === 'none' && (await page.eval(`document.querySelector('.shell').dataset.moment`)) !== 'on', 'Edit from a pause: the paused moment ended, the overlay put away');
    await pressPlay(page);
    await page.waitFor(IN.play, 20000);
    const r0 = await j(page, IN.pp);
    await sleep(1200);
    check((await j(page, IN.pp)).f - r0.f >= 2, 'Play after a pause and Edit: the game runs');
    check((await page.eval(`document.querySelector('.shell').dataset.moment !== 'on' && document.querySelector('.shell').dataset.paused !== 'on'`)) === true, 'Play after a pause and Edit: not paused');
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
    // No placement.json yet (404): the game's loader can still play the draft's motions here (its play hook).
    check((await page.eval(`[...(${GW}[Symbol.for('game-studio.play')] || [])].some((h) => h.has())`)) === true, 'no placement.json yet: the game\'s loader can play motions in this page');
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

// Neon Run's gate slides 4 m along x in 2 s (a clip at the start), so the timeline at 1 s shows it 2 m over.
const NEON_FILE = { version: 1, tool: 'placement', dim: '3d', space: 'local', objects: {},
  motions: [{ name: 'Slide', len: 2, keys: { p: [{ t: 0, v: [0, 0, 0] }, { t: 2, v: [4, 0, 0] }] } }],
  motion: { gate: { clips: [{ use: 'Slide', when: { on: 'start' } }] } } };
/** The game's scene as the page holds it (the one with the gate), as an expression in the game page. */
const NEON_SCENE = `(${GW}.__studioThree.scenes.find((s) => s.getObjectByName('gate')))`;

async function restore() {
  for (const dark of [false, true]) {
    console.log(`restore: Neon Run (3D) — Edit comes back to the edit scene, PC ${dark ? 'dark' : 'light'}`);
    const g = await open('test/neon-run', null, { w: 1280, h: 800, dark }, NEON_FILE,
      (root) => cpSync(join(PKG, 'skills/arrange/bin/studio-placement.js'), join(root, 'studio-placement.js')));
    const { page } = g;
    const shot = async (name) => {
      if (!SHOTS) return;
      mkdirSync(SHOTS, { recursive: true });
      writeFileSync(join(SHOTS, `restore-${dark ? 'dark' : 'light'}-${name}.png`), await page.screenshot());
    };
    // Everything Edit should come back to.
    const scene = async () => j(page, `JSON.stringify({
      list: ${GW}.__gameStudio._debug.list().map((i) => ({ key: i.key, pose: i.pose })),
      view: ${GW}.__gameStudio._debug.view(),
      picked: studioShell.selected(),
      timeline: (({ open, time, clip }) => ({ open, time, clip }))(__studioTimeline.state()),
      spark: !!${NEON_SCENE}.getObjectByName('spark'),
      hex2: !!${NEON_SCENE}.getObjectByName('hex-2') })`);
    const same = (now, was, when) => {
      const off = samePoses(now.list, was.list, 0.01);
      check(off.length === 0 && now.list.length === was.list.length, `${when}: every object where it was before Play (${now.list.length} objects${off.length ? `; off: ${off.join(', ')}` : ''})`);
      check(sameView(now.view, was.view), `${when}: the same edit camera${sameView(now.view, was.view) ? '' : ` (${JSON.stringify(was.view)} → ${JSON.stringify(now.view)})`}`);
      check(now.picked === was.picked, `${when}: the same pick (${now.picked})`);
      check(now.timeline.open && Math.abs(now.timeline.time - was.timeline.time) < 1e-6 && now.timeline.clip === was.timeline.clip,
        `${when}: the timeline open at the same time (${JSON.stringify(now.timeline)})`);
      check(!now.spark && now.hex2, `${when}: what the game added is out of the scene, what it took away is back (spark ${now.spark}, hex-2 ${now.hex2})`);
    };
    try {
      await page.eval(`(${GW}.__fastSwitchMark = 'restore', true)`);
      await page.eval(`studioShell.actions.select('gate')`);
      await sleep(600);
      await page.eval(`(__studioTimeline.setOpen(true), __studioTimeline.setTime(1), true)`);
      // The edit camera turned (as a drag on the sky does), told to the shell as the page tells it.
      await page.eval(`(${GW}.postMessage({ type: 'studio:core/view', view: { action: 'orbit', dx: 60, dy: 20 } }, '*'), true)`);
      await sleep(1200);
      const before = await scene();
      check(before.picked === 'gate' && before.timeline.open && before.timeline.time === 1, `before Play: the gate picked, the timeline at 1 s (${JSON.stringify(before.timeline)})`);
      // The timeline at 1 s shows the gate at its clip's 1 s place: 2 m over from the layout.
      const gateAt1 = poseOf(before.list, 'gate')?.p;
      await shot('1-edit');

      // ▶ Play: the game runs, the ship steered, a thing made and a hexagon taken away — what a game does.
      await pressPlay(page);
      await page.waitFor(IN.play, 30000);
      await page.eval(`(() => { const w = ${GW}; w.dispatchEvent(new w.KeyboardEvent('keydown', { code: 'ArrowRight', key: 'ArrowRight' })); return true; })()`);
      await sleep(3000);
      await page.eval(`(() => { const w = ${GW}; w.dispatchEvent(new w.KeyboardEvent('keyup', { code: 'ArrowRight', key: 'ArrowRight' })); return true; })()`);
      await page.eval(`(() => { const s = ${NEON_SCENE}; const k = s.getObjectByName('hex-1').clone(); k.name = 'spark'; k.position.set(0, 2, 2); s.add(k);
        s.remove(s.getObjectByName('hex-2')); return true; })()`);
      await sleep(800);
      const playing = await j(page, IN.list);
      const moved = samePoses(playing, before.list, 0.01);
      check(moved.includes('ship') && moved.some((k) => /^hex-/.test(k)), `Play: the game moved things (${moved.join(', ')})`);
      await shot('2-play');

      // Edit: the edit scene, not the moment of play.
      const t = await page.eval(timed(IN.edit, ANSWER.edit));
      check(t.screen >= 0, `Edit: up in ${t.screen} ms (the page answered in ${t.page} ms)`);
      check((await page.eval(`${GW}.__fastSwitchMark`)) === 'restore', 'Edit: the same page (no reload)');
      await sleep(800);
      const back = await scene();
      same(back, before, 'Edit');
      check(close(poseOf(back.list, 'gate')?.p, gateAt1, 0.01), `Edit: the gate where the timeline at 1 s shows it (${JSON.stringify(poseOf(back.list, 'gate')?.p)})`);
      await shot('3-edit-again');

      // Play again: the game's own things are its own again (the spark it made, the hexagon it took).
      await pressPlay(page);
      await page.waitFor(IN.play, 30000);
      await sleep(600);
      const st = await j(page, `JSON.stringify({ spark: !!${NEON_SCENE}.getObjectByName('spark'), hex2: !!${NEON_SCENE}.getObjectByName('hex-2') })`);
      check(st.spark && !st.hex2, `Play again: the game's spark is back and the hexagon stays taken (${JSON.stringify(st)})`);
      await sleep(1500);
      await page.eval(`document.querySelector('button.play').click()`);
      await page.waitFor(IN.edit, 30000);
      await sleep(800);
      same(await scene(), before, 'Edit again');
    } catch (e) {
      check(false, e.message);
    } finally {
      await g.close();
    }
  }
}

async function crumb() {
  const SIZES = [{ id: 'pc', w: 1280, h: 800 }, { id: 'side', w: 420, h: 800 }, { id: 'phone', w: 390, h: 844, touch: true }];
  for (const sz of SIZES) for (const dark of [false, true]) {
    console.log(`crumb: Three Isles, ${sz.id} ${sz.w}×${sz.h} ${dark ? 'dark' : 'light'}`);
    const g = await open('examples/three-isles', null, { ...sz, dark });
    const { page } = g;
    const tap = async (sel) => {
      const at = JSON.parse(await page.eval(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => e.offsetParent && !e.disabled); if (!b) return null;
        const r = b.getBoundingClientRect(); return JSON.stringify([r.left + Math.min(r.width / 2, 30), r.top + r.height / 2]); })()`) || 'null');
      if (!at) throw new Error(`${sel} is not on screen`);
      if (sz.touch) await page.tap(at[0], at[1]);
      else await page.click(at[0], at[1]);
      await sleep(300);
    };
    try {
      const crumbText = `document.querySelector('.brand .level-switch')?.offsetParent ? document.querySelector('.brand .level-switch').textContent : ''`;
      check(/Meadow/.test(await page.eval(crumbText)), 'the crumb in the top bar: Meadow');
      // The crumb fits the bar: not under Play, not cut to nothing.
      const fit = await j(page, `JSON.stringify((() => { const c = document.querySelector('.brand .level-switch').getBoundingClientRect(); const p = document.querySelector('button.play').getBoundingClientRect();
        return { w: Math.round(c.width), clear: c.right <= p.left, top: c.top >= 0 && c.bottom <= document.querySelector('.top').getBoundingClientRect().bottom }; })())`);
      check(fit.w >= 40 && fit.clear && fit.top, `the crumb fits the bar (${fit.w} px wide, left of Play: ${fit.clear})`);
      await tap('.brand .level-switch');
      await page.waitFor(`!!document.querySelector('[data-part=context-menu]:not([hidden]) [data-action="ctx-level:canyon"]')`, 3000);
      await tap('[data-part=context-menu] [data-action="ctx-level:canyon"]');
      await page.waitFor(`${FR}?.src.includes('studioLevel=canyon') && /Canyon/.test(${crumbText})`, 10000);
      await page.waitFor(IN.edit, 90000);
      await sleep(SETTLE / 2);
      await page.eval(`(${GW}.__fastSwitchMark = 'canyon', true)`);
      await pressPlay(page);
      await page.waitFor(IN.play, 30000);
      check((await page.eval(`${GW}.__fastSwitchMark`)) === 'canyon', 'Play: the same page');
      check((await page.eval(`${GW}.document.getElementById('level')?.textContent`)) === 'Canyon', 'Play: on Canyon');
      const words = await page.eval(`(() => { const e = document.querySelector('.brand .level-here'); return e && e.offsetParent ? e.textContent : ''; })()`);
      check(words === 'Canyon' && !(await page.eval(`!!document.querySelector('.brand .level-switch')`)), `Play: the crumb is words ("${words}"), no menu`);
      await page.eval(`document.querySelector('button.play').click()`);
      await page.waitFor(IN.edit, 30000);
      check((await page.eval(`${GW}.__fastSwitchMark`)) === 'canyon', 'Edit: the same page');
      check(/Canyon/.test(await page.eval(crumbText)), 'Edit: the crumb a button again, on Canyon');
    } catch (e) {
      check(false, e.message);
    } finally {
      await g.close();
    }
  }
}

try {
  if (want('crumb')) await crumb();
  if (want('cove')) await cove();
  if (want('ruins')) await ruins();
  if (want('fresh')) await fresh();
  if (want('when')) await when();
  if (want('old')) await when(true);
  if (want('scene2d')) await scene2d();
  if (want('levels')) await levels();
  if (want('restore')) await restore();
  if (want('time')) await time();
} catch (e) {
  check(false, `${e.message}`);
} finally {
  await browser.close();
}
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
