// studio-fix-0146 (2026-10-24), what x-motion-0145 found while filming the motion / levels announcement, in a headless
// browser on Lantern Cove (3D, a copy of the starter, PC 1280×800):
//   A. a New level kept only the ground and the Library offered nothing else ("Build it by hand" had to be filmed on a
//      Duplicate). Now the Library lists the game's other things under "Not in this level · n":
//      1. New level from "Level 1 ⌄": the Library has the heading and its tiles, dashed (lib-absent)
//      2. a press on a tile: the Scene, the thing in this level (in the list, picked), Save counts one change
//      3. Save: Level 2's file has it at its place (objects) and not in its `removed`; Level 1 has nothing of it
//   B. ▶ on the timeline with the thing picked fell to about 20 frames a second (57 with nothing picked):
//      4. ▶ with the rowboat picked: 50 frames a second or more, and not far under the run with nothing picked
// Pictures (--shots <dir>): the Library of the blank level, dark and light (webp, small).
//
//   node test/studio-fix-0146.browser.mjs [--shots <dir>] [--ui <built shell>] [--themes dark,light] [--lang en|ja] [--only levels,fps]
// --ui with an older build gives the "before" numbers (the checks then report what that build does).
// Exit 1 on a failure.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
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
const ONLY = take('--only', 'levels,fps').split(',');
const PROFILE = args.includes('--profile');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GAME = `document.querySelector('iframe').contentWindow`;

let failed = 0;
const check = (ok, what) => {
  console.log(`  ${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failed++;
};

// The rowboat's motion (as test/studio-timeline.browser.mjs's pictures): it moves and turns, so the outline both slides
// and changes shape while ▶ plays.
const MOTION_FILE = { version: 1, tool: 'placement', dim: '3d', space: 'local', objects: {}, motion: {
  rowboat: { clips: [{ name: 'Row', len: 3, repeat: 'pingpong', start: true, keys: {
    p: [{ t: 0, v: [0, 0, 0] }, { t: 1.5, v: [-2.5, 1.2, -1.5] }, { t: 3, v: [-5, 0, 0] }], r: [{ t: 0, v: [0, 0, 0] }, { t: 3, v: [0, 0.8, 0] }] } }] },
} };

async function open(theme, file) {
  const root = mkdtempSync(join(tmpdir(), 'studio-fix-0146-'));
  cpSync(join(PKG, 'starters/lantern-cove'), root, { recursive: true });
  mkdirSync(join(root, '.studio/ui'), { recursive: true });
  writeFileSync(join(root, '.studio/ui/prefs.json'), JSON.stringify({ version: 1, lang: LANG, theme, seen: ['timeline-steps'] }));
  if (file) writeFileSync(join(root, 'placement.json'), JSON.stringify(file, null, 2));
  const srv = await startStudioServer({ root, uiDir: UI, log: () => {}, env: {} });
  const browser = await launch();
  const page = await newPage(browser, { width: 1280, height: 800, cdnCache: process.env.STUDIO_CDN_CACHE });
  await page.goto(srv.url);
  await page.waitFor(`document.querySelectorAll('.obj').length > 0`, 90000);
  await sleep(2500);
  const close = async () => {
    await browser.close();
    await srv.close?.();
    rmSync(root, { recursive: true, force: true });
  };
  return { page, root, close };
}

const shotWebp = async (page, name) => {
  if (!SHOTS) return;
  const png = join(SHOTS, `${name}.png`);
  writeFileSync(png, await page.screenshot());
  // Small pictures (the task's rule): webp at 1280 wide, quality 70.
  execFileSync('cwebp', ['-quiet', '-q', '70', png, '-o', join(SHOTS, `${name}.webp`)]);
  rmSync(png);
};

async function levels(theme) {
  console.log(`levels ${LANG} ${theme}`);
  const { page, root, close } = await open(theme, null);
  const j = async (e) => JSON.parse((await page.eval(e)) || 'null');
  const press = async (sel) => {
    const at = await j(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => e.offsetParent && !e.disabled); if (!b) return null;
      const r = b.getBoundingClientRect(); return JSON.stringify([r.left + Math.min(r.width / 2, 40), r.top + r.height / 2]); })()`);
    if (!at) throw new Error(`${sel} is not on screen`);
    await page.click(at[0], at[1]);
    await sleep(500);
  };
  const SAVE = `[...document.querySelectorAll('[data-action=save]')].find((e) => e.offsetParent)?.textContent || ''`;
  try {
    const all = await j(`JSON.stringify(studioShell.items().map((i) => i.key))`);
    await press('.brand .level-add');
    await page.waitFor(`document.querySelector('.ctx-menu') && !document.querySelector('.ctx-menu').hidden`, 3000);
    await press('.ctx-menu [data-action="ctx-level-new"]');
    await page.waitFor(`document.querySelector('iframe').src.includes('studioLevel=level-2')`, 5000);
    // Lantern Cove's sea is not in the list, so a blank level may list nothing at all: wait for the game page's edit view.
    await page.waitFor(`!!document.querySelector('[data-part=level-switch]') && !!${GAME}.__gameStudio?._debug`, 45000).catch(async (e) => {
      console.log(`  (waiting for Level 2: ${await page.eval(`JSON.stringify({ items: studioShell.items().length, crumb: document.querySelector('[data-part=level-crumb]')?.outerHTML?.slice(0, 200) ?? null, src: document.querySelector('iframe').src.slice(-80) })`)})`);
      throw e;
    });
    await sleep(2500);
    const left = await j(`JSON.stringify(studioShell.items().map((i) => i.key))`);
    console.log(`  Level 1: ${all.length} things; Level 2 (blank): ${left.join(', ')}`);
    await page.eval(`studioShell.actions.switchTool('library')`);
    await page.waitFor(`!!document.querySelector('[data-part=absent-tile]')`, 8000).catch(() => {});
    await sleep(800);
    const lib = await j(`JSON.stringify({ head: document.querySelector('.gsl-group[data-group=absent]')?.textContent ?? null,
      tiles: [...document.querySelectorAll('[data-part=absent-tile]')].map((t) => ({ key: t.dataset.key, name: t.querySelector('.gsl-name')?.textContent, dashed: getComputedStyle(t.querySelector('.gsl-thumb')).outlineStyle })) })`);
    console.log(`  Library: "${lib?.head}" ${lib?.tiles.slice(0, 6).map((t) => t.name).join(', ')}…`);
    check(!!lib?.head && lib.tiles.length > 0, `1. "Not in this level" with ${lib?.tiles.length ?? 0} tiles`);
    check(!!lib?.tiles.length && lib.tiles.every((t) => t.dashed === 'dashed'), '1. told apart: a dashed frame');
    await shotWebp(page, `after-${LANG}-${theme}-library-blank-level`);
    if (!lib?.tiles.length) return;
    const pick = lib.tiles.find((t) => t.key === 'rowboat') || lib.tiles[0];
    await page.eval(`document.querySelector('[data-part=absent-tile][data-key="${pick.key}"]').click()`);
    await page.waitFor(`studioShell.items().some((i) => i.key === ${JSON.stringify(pick.key)})`, 5000).catch(() => {});
    await sleep(1200);
    const after = await j(`JSON.stringify({ keys: studioShell.items().map((i) => i.key), sel: studioShell.selected(), tool: document.querySelector('.app, body').dataset.tool ?? null })`);
    check(after.keys.includes(pick.key), `2. ${pick.key} is in Level 2's list now`);
    check(after.sel === pick.key, `2. and picked (${after.sel})`);
    const save = await page.eval(SAVE);
    check(/2/.test(save), `2. Save counts New level + the thing (“${save.trim()}”)`);
    await shotWebp(page, `after-${LANG}-${theme}-placed-in-blank-level`);
    await page.eval(`studioShell.actions.save()`);
    await sleep(1500);
    const f = JSON.parse(readFileSync(join(root, 'placement.json'), 'utf8'));
    const l2 = f.levels?.find((l) => l.id === 'level-2');
    const l1 = f.levels?.find((l) => l.id === 'level-1');
    check(!!l2?.objects?.[pick.key] && !l2.removed?.some((r) => r.key === pick.key), `3. Level 2 has ${pick.key} at its place, not in its removed`);
    check(!!l2?.removed?.length, `3. the other things stay out of Level 2 (${l2?.removed?.length})`);
    check(!l1?.objects?.[pick.key], '3. Level 1 is not touched');
  } catch (e) {
    console.log(`  ✗ ${e.message}`);
    failed++;
  } finally {
    await close();
  }
}

// Frames a second while ▶ plays, counted with the editor page's requestAnimationFrame over 3 s. WHY the editor's and
// not the game's: the editor holds the game's own frames while editing (core/time.ts), so the game page's
// requestAnimationFrame never comes; the game frame is the same origin, so it shares the editor's one thread, and the
// outline's renders slow both alike. A 6 s cap so a page that stops drawing fails instead of hanging.
const FPS = `new Promise((res) => { let n = 0; const t0 = performance.now(); setTimeout(() => res(-1), 6000);
  const tick = () => { n++; if (performance.now() - t0 < 3000) requestAnimationFrame(tick); else res(Math.round(n * 1000 / (performance.now() - t0))); };
  requestAnimationFrame(tick); })`;

async function fps(theme) {
  console.log(`fps ${theme}`);
  const { page, close } = await open(theme, MOTION_FILE);
  try {
    await page.eval(`studioShell.actions.select('rowboat')`);
    await sleep(1200);
    await page.eval(`document.querySelector('[data-part=card] [data-part=motion-timeline-line]').click()`);
    await sleep(800);
    await page.eval(`document.querySelector('[data-part=tl-play]').click()`);
    await sleep(800);
    if (PROFILE) await page.send('Profiler.enable'), await page.send('Profiler.setSamplingInterval', { interval: 200 }), await page.send('Profiler.start');
    const picked = await page.eval(FPS);
    if (PROFILE) {
      // The functions that took the most time of their own while ▶ played with the pick (--profile).
      const { profile } = await page.send('Profiler.stop');
      const self = new Map();
      const dt = new Map(profile.nodes.map((n) => [n.id, n]));
      const step = (profile.endTime - profile.startTime) / profile.samples.length / 1000;
      for (const id of profile.samples) {
        const f = dt.get(id).callFrame;
        const k = `${f.functionName || '(anon)'} ${f.url.split('/').pop()}:${f.lineNumber}`;
        self.set(k, (self.get(k) || 0) + step);
      }
      for (const [k, ms] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`    ${ms.toFixed(0).padStart(5)} ms  ${k}`);
      // Who calls the costliest one (the stacks of its samples, 6 frames up).
      const parent = new Map();
      for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id);
      const top = [...self].sort((a, b) => b[1] - a[1])[0][0];
      const stacks = new Map();
      for (const id of profile.samples) {
        const f = dt.get(id).callFrame;
        if (`${f.functionName || '(anon)'} ${f.url.split('/').pop()}:${f.lineNumber}` !== top) continue;
        const st = [];
        for (let p = parent.get(id); p && st.length < 6; p = parent.get(p)) { const g = dt.get(p).callFrame; st.push(`${g.functionName || '(anon)'}:${g.lineNumber}`); }
        const k = st.join(' < ');
        stacks.set(k, (stacks.get(k) || 0) + step);
      }
      for (const [k, ms] of [...stacks].sort((a, b) => b[1] - a[1]).slice(0, 5)) console.log(`    ${ms.toFixed(0).padStart(5)} ms  ${top} < ${k}`);
    }
    const still = await page.eval(`studioShell.selected()`);
    await page.eval(`studioShell.actions.select(null)`);
    await sleep(600);
    const none = await page.eval(FPS);
    console.log(`  ▶ with the rowboat picked (${still}): ${picked} fps · nothing picked: ${none} fps`);
    check(still === 'rowboat', '4. the rowboat stayed picked while ▶ played');
    check(picked >= 50, `4. 50 frames a second or more with the pick (${picked})`);
    check(picked >= none * 0.85, `4. not far under nothing picked (${picked} / ${none})`);
  } catch (e) {
    console.log(`  ✗ ${e.message}`);
    failed++;
  } finally {
    await close();
  }
}

for (const theme of THEMES) {
  if (ONLY.includes('levels')) await levels(theme);
  if (ONLY.includes('fps') && theme === THEMES[0]) await fps(theme);
}
console.log(failed ? `${failed} failed` : 'ok');
process.exit(failed ? 1 : 0);
