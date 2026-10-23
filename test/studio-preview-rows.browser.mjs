// "▶ Preview" plays only the timeline's rows (studio-preview-rows, 2026-10-24), in a headless browser. The request,
// made while making sea-stack's motion in Lantern Cove: "I'm making the motion of the object I picked, but when I play
// it other objects start moving too — I want to play only the objects lined up on the timeline I'm on".
//   lantern  sea-stack "Sway" (once, the game starts), the buoy "Bob" (a loop, the game starts), the rowboat "Row"
//            (after sea-stack's Sway). sea-stack picked, the timeline open (one row): the time line at 0.5 s, ▶, and
//            the line's ▷ (the game starts) move sea-stack only — the buoy and the boat stay where the editor put them;
//   neon     test/neon-run: the orb "Hop" (once, the start) picked, the ship's motion a loop from the start: ▶ moves the
//            orb, the ship stays.
// The unit tests of the same rule: test/timeline-preview-rows.test.ts.
// Pictures (`--shots <dir>`): <game>-<theme>-play.png while ▶ runs (`--themes`, default dark,light for Lantern Cove;
// neon in the first theme).
//
//   node test/studio-preview-rows.browser.mjs [--shots <dir>] [--themes dark,light] [--lang en|ja]
// Exit 1 on a failure.
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
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
const LANG = take('--lang', 'en');
const THEMES = take('--themes', 'dark,light').split(',');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failed = 0;
const check = (ok, what) => {
  console.log(`  ${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failed++;
};

const K = (t, v) => ({ t, v });
const rise = (len, h) => ({ p: [K(0, [0, 0, 0]), K(len, [0, h, 0])] });
const LANTERN = { version: 1, tool: 'placement', dim: '3d', space: 'local', objects: {},
  motions: [
    { name: 'Sway', len: 1.5, repeat: 'once', keys: rise(1.5, 3) },
    { name: 'Bob', len: 1, repeat: 'loop', keys: rise(1, 2) },
    { name: 'Row', len: 2, repeat: 'once', keys: { p: [K(0, [0, 0, 0]), K(2, [-6, 0, 0])] } }],
  motion: {
    'sea-stack': { clips: [{ use: 'Sway', when: { on: 'start' } }] },
    buoy: { clips: [{ use: 'Bob', when: { on: 'start' } }] },
    rowboat: { clips: [{ use: 'Row', when: { on: 'after', key: 'sea-stack', use: 'Sway' } }] } } };
const NEON = { version: 1, tool: 'placement', dim: '3d', space: 'local', objects: {},
  motions: [
    { name: 'Hop', len: 1.5, repeat: 'once', keys: rise(1.5, 2) },
    { name: 'Glide', len: 1, repeat: 'loop', keys: { p: [K(0, [0, 0, 0]), K(1, [3, 0, 0])] } }],
  motion: { orb: { clips: [{ use: 'Hop', when: { on: 'start' } }] }, ship: { clips: [{ use: 'Glide', when: { on: 'start' } }] } } };

const DBG = `[...document.querySelectorAll('iframe')].map((f) => f.contentWindow.__gameStudio && f.contentWindow.__gameStudio._debug).find(Boolean)`;
const TL = 'window.__studioTimeline';

async function open(browser, src, file, theme) {
  const root = mkdtempSync(join(tmpdir(), 'studio-preview-rows-'));
  cpSync(join(PKG, src), root, { recursive: true });
  // test/neon-run keeps no loader of its own (its README): the built one, as the other screen tests copy it.
  if (!existsSync(join(root, 'studio-placement.js'))) copyFileSync(join(UI, '../studio-placement.js'), join(root, 'studio-placement.js'));
  mkdirSync(join(root, '.studio/ui'), { recursive: true });
  writeFileSync(join(root, '.studio/ui/prefs.json'), JSON.stringify({ version: 1, lang: LANG, theme, seen: ['timeline-steps', 'open-line'] }));
  writeFileSync(join(root, 'placement.json'), JSON.stringify(file, null, 2));
  // No KUMODeck sign-in: the real ~/.kumo of the machine running this is never read.
  const srv = await startStudioServer({ root, kumo: { home: join(root, '.no-kumo-home'), env: {} }, uiDir: UI, log: () => {}, env: {} });
  const page = await newPage(browser, { width: 1280, height: 800, cdnCache: process.env.STUDIO_CDN_CACHE });
  await page.goto(srv.url);
  await page.waitFor(`document.querySelectorAll('.obj').length > 0`, 90000);
  await sleep(2500);
  const j = async (expr) => JSON.parse((await page.eval(expr)) || 'null');
  const p = async (k) => (await j(`JSON.stringify((${DBG}.anchor(${JSON.stringify(k)}) || {}).pose || null)`))?.p ?? null;
  const shot = async (what) => SHOTS && writeFileSync(join(SHOTS, `${what}.png`), await page.screenshot());
  return { page, j, p, shot, close: async () => (await page.close?.(), await srv.close?.()) };
}
const same = (a, b) => !!a && !!b && a.every((v, i) => Math.abs(v - b[i]) < 1e-3);
const fmt = (v) => JSON.stringify(v?.map((x) => Math.round(x * 100) / 100));

/** Pick `picked`, open the timeline; the time line, ▶ and (if `cue`) the line's ▷ move `picked` only, never `still`. */
async function scene(g, { picked, still, shot, cue }) {
  await g.page.eval(`studioShell.actions.select(${JSON.stringify(picked)})`);
  await sleep(900);
  await g.page.eval(`${TL}.setOpen(true)`);
  await sleep(1200);
  const rows = await g.j(`JSON.stringify([...document.querySelectorAll('[data-part=timeline] [data-row]')].map((e) => e.dataset.row))`);
  console.log(`  rows: ${JSON.stringify(rows)}`);
  const home = {};
  for (const k of [picked, ...still]) home[k] = await g.p(k);
  // The time line at 0.5 s.
  await g.page.eval(`${TL}.setTime(0.5)`);
  await sleep(500);
  const moved = await g.p(picked);
  check(!same(moved, home[picked]), `time line 0.5 s: ${picked} shows its motion (${fmt(home[picked])} → ${fmt(moved)})`);
  for (const k of still) {
    const v = await g.p(k);
    check(same(v, home[k]), `time line 0.5 s: ${k} (not a row) stays (${fmt(home[k])} / ${fmt(v)})`);
  }
  await g.page.eval(`${TL}.setTime(0)`);
  await sleep(400);
  // ▶ (the real button), sampled while it runs and after it ends.
  const played = await g.page.eval(`(() => { const b = document.querySelector('[data-part=tl-play]'); if (!b) return false; b.click(); return true; })()`);
  check(played, '▶ Preview is on the line');
  let movedOnce = false;
  const bad = new Set();
  for (let i = 0; i < 6; i++) {
    await sleep(300);
    if (i === 2) await shot();
    if (!same(await g.p(picked), home[picked])) movedOnce = true;
    for (const k of still) if (!same(await g.p(k), home[k])) bad.add(k);
  }
  check(movedOnce, `▶: ${picked} moves`);
  check(!bad.size, `▶: the others stay put (${still.join(', ')}${bad.size ? ` — moved: ${[...bad].join(', ')}` : ''})`);
  await sleep(800);
  check((await g.j(`JSON.stringify(${TL}.state().playing)`)) === false, '▶ ends with the picked motion (a loop elsewhere does not keep it going)');
  if (!cue) return;
  // The line's ▷ (the game starts): the scene runs by the game's rules — an "after" on another object starts, but that
  // object is not on the timeline, so it is not moved.
  const tried = await g.page.eval(`(() => { const b = document.querySelector('[data-part=tl-try-this]'); if (!b) return false; b.click(); return true; })()`);
  check(tried, '▷ (try what starts it) is on the line');
  bad.clear();
  let lit = {};
  for (let i = 0; i < 8; i++) {
    await sleep(300);
    for (const k of still) if (!same(await g.p(k), home[k])) bad.add(k);
    lit = { ...lit, ...(await g.j(`JSON.stringify(${TL}.state().lit)`)) };
  }
  check(!bad.size, `▷: the others stay put (${still.join(', ')}${bad.size ? ` — moved: ${[...bad].join(', ')}` : ''}; started by the rules: ${JSON.stringify(lit)})`);
  await g.page.eval(`${TL}.stopTry?.() ?? document.querySelector('[data-part=tl-try-this].on')?.click()`);
}

const browser = await launch();
try {
  for (const [i, theme] of THEMES.entries()) {
    console.log(`lantern ${LANG} ${theme}`);
    const g = await open(browser, 'starters/lantern-cove', LANTERN, theme);
    try {
      await scene(g, { picked: 'sea-stack', still: ['buoy', 'rowboat'], cue: true, shot: () => g.shot(`lantern-${theme}-play`) });
    } finally {
      await g.close();
    }
    if (i) continue;
    console.log(`neon ${LANG} ${theme}`);
    const n = await open(browser, 'test/neon-run', NEON, theme);
    try {
      await scene(n, { picked: 'orb', still: ['ship'], shot: () => n.shot(`neon-${theme}-play`) });
    } finally {
      await n.close();
    }
  }
} finally {
  await browser.close?.();
}
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
