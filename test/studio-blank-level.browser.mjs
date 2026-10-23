// New level on a game that moves its own things (studio-blank-level, 2026-10-23). A hands-on try of v0.1.28 on NEON
// DASH: "Level 3 ⌄ → New level — I made a new level but it wasn't blank. Makes no sense." The list still had all 61
// unnamed things (sky, white road, blue road… in faint words) and the top said "Moving things may not show in this
// game yet. Your AI has the details." The cause: New level writes the level's deletions (`removed`), and when the page
// came back on the new level the editor made them again only for objects still standing where they were (`was`);
// a runner moves every one of them each frame, so none was hidden. Now a blank level hides every object the game lists
// but the ground / sky (PlacementModel.blankKeep), wherever the game has it and whatever it makes later.
//
// The game: test/neon-run (hexagons the game slides, a ring it turns, an orb it pulses) with eight unnamed road pieces
// added that scroll from the game's clock (absolute z every frame, as AI-written runners often do). Run twice per
// theme: without the loader (an AI-made game before "add the loader", as NEON DASH was — the editor alone hides
// things; the pictures) and with it (the loader hides `removed` at load where they stand at `was`, which before the
// fix made the old editor blank only on a lucky first frame: one run blank, the next not). Checks:
//   1. New level from "Level 1 ⌄": Level 2 opens, the list has only the road (the ground), the game shows no hexagon,
//      ring, orb, gate, ship or road piece (all hidden), Save counts one change
//   2. a few seconds later (the game kept moving and scrolling): still blank
//   3. no self-check line at the top (it moved something the game moves itself: check-note.ts)
//   4. Save: Level 2 is written `blank: true` with `from`, its `removed` lists what went
// Pictures (--shots <dir>): PC 1280×800, Japanese, dark and light; `before` with --before --ui <old built shell> (no checks).
//
//   node test/studio-blank-level.browser.mjs [--shots <dir>] [--before --ui <dir>] [--lang ja|en] [--themes dark,light]
// Exit 1 on a failure.
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
const LOADER = join(PKG, 'skills/arrange/bin/studio-placement.js');
const LANG = take('--lang', 'ja');
const THEMES = take('--themes', 'dark,light').split(',');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GAME = `document.querySelector('iframe').contentWindow`;
const DBG = `${GAME}.__gameStudio?._debug`;

let failed = 0;
const check = (ok, what) => {
  console.log(`  ${ok ? '✓' : '✗'} ${what}`);
  if (!ok && !BEFORE) failed++;
};

// Eight unnamed road pieces the game scrolls from its own clock (absolute z each frame): NEON DASH's "white road",
// "blue road" rows. Unnamed = `path:` keys, the faint names in the list.
const PIECES = `
    const pieces = [];
    for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(1.6, .06, 3), glow(i % 2 ? 0x29e6ff : 0xffffff, .9));
      scene.add(m);
      pieces.push(m);
    }
    const scroll = (t) => pieces.forEach((m, i) => m.position.set(i % 2 ? 2.4 : -2.4, .05, ((t * 9 + i * 7) % 56) - 50));
    scroll(0);
`;

async function open(theme, loader) {
  const root = mkdtempSync(join(tmpdir(), 'studio-blank-level-'));
  cpSync(join(PKG, 'test/neon-run'), root, { recursive: true });
  copyFileSync(LOADER, join(root, 'studio-placement.js'));
  let html = readFileSync(join(root, 'index.html'), 'utf8');
  html = html.replace("    await applyPlacement(scene, './placement.json');", `${PIECES}\n${loader ? '' : '//'}    await applyPlacement(scene, './placement.json');`)
    .replace('      ring.rotation.y += 1.6 * dt;', '      ring.rotation.y += 1.6 * dt;\n      scroll(t);');
  writeFileSync(join(root, 'index.html'), html);
  mkdirSync(join(root, '.studio/ui'), { recursive: true });
  writeFileSync(join(root, '.studio/ui/prefs.json'), JSON.stringify({ version: 1, lang: LANG, theme }));
  const srv = await startStudioServer({ root, uiDir: UI, log: () => {}, env: {} });
  const browser = await launch();
  const page = await newPage(browser, { width: 1280, height: 800, cdnCache: process.env.STUDIO_CDN_CACHE });
  await page.goto(srv.url);
  await page.waitFor(`studioShell.items().length > 0 && !!${DBG}`, 90000);
  await page.waitFor(`${DBG}.list().some((i) => i.held === 'game')`, 20000).catch(() => {});
  await sleep(1500);
  const close = async () => {
    await browser.close();
    await srv.close?.();
    rmSync(root, { recursive: true, force: true });
  };
  return { page, root, close };
}

async function run(theme, loader) {
  console.log(`${LANG} ${theme} ${loader ? 'with the loader' : 'no loader'}${BEFORE ? ' (before)' : ''}`);
  const { page, root, close } = await open(theme, loader);
  const ev = (e) => page.eval(e);
  const j = async (e) => JSON.parse((await ev(e)) || 'null');
  const shot = async (what) => SHOTS && !loader && writeFileSync(join(SHOTS, `${BEFORE ? 'before' : 'after'}-${LANG}-${theme}-${what}.png`), await page.screenshot());
  const press = async (sel) => {
    const at = await j(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => e.offsetParent && !e.disabled); if (!b) return null;
      const r = b.getBoundingClientRect(); return JSON.stringify([r.left + Math.min(r.width / 2, 40), r.top + r.height / 2]); })()`);
    if (!at) throw new Error(`${sel} is not on screen`);
    await page.click(at[0], at[1]);
    await sleep(400);
  };
  // What the list shows (the Scene's rows) and what the game draws (visible meshes the adapter lists).
  const rows = () => j(`JSON.stringify(studioShell.items().map((i) => i.key))`);
  // The scene's own top-level things that are drawn (three's `visible`; boot.js keeps every scene in __studioThree):
  // unnamed ones as "?". WHY not the adapter's list: a deleted object leaves the list even when the picture still has
  // it — the bug this test was written on showed an empty list over a full picture (adapter.js watch()).
  const shown = () => j(`(() => { const out = []; for (const sc of ${GAME}.__studioThree.scenes) for (const o of sc.children) if (o.visible && (o.isMesh || o.isGroup)) out.push(o.name || '?'); return JSON.stringify(out); })()`);
  const note = () => ev(`(() => { const s = document.querySelector('.status'); return s && !s.hidden ? s.textContent : ''; })()`);
  try {
    const all = await rows();
    console.log(`  Level 1: ${all.length} things (${all.slice(0, 12).join(' ')}…)`);
    await press('.brand .level-add');
    await page.waitFor(`document.querySelector('.ctx-menu') && !document.querySelector('.ctx-menu').hidden`, 3000);
    await shot('1-menu');
    await press('.ctx-menu [data-action="ctx-level-new"]');
    await page.waitFor(`document.querySelector('iframe').src.includes('studioLevel=level-2')`, 5000);
    await page.waitFor(`studioShell.items().length > 0 && !!${DBG} && !!document.querySelector('.brand .level-crumb .level-switch')`, 45000);
    await sleep(2500);
    const left = await rows();
    console.log(`  Level 2 list: ${left.join(' ')}`);
    check(left.length > 0 && left.every((k) => k === 'road'), `1. the list keeps only the road (${left.join(', ')})`);
    const drawn = await shown();
    check(drawn.join() === 'road', `1. the game draws only the road (${drawn.join(', ')})`);
    check(/1/.test(await ev(`[...document.querySelectorAll('[data-action=save]')].find((e) => e.offsetParent)?.textContent || ''`)), '1. Save counts one change');
    await shot('2-new-level');
    await sleep(3000);
    check((await rows()).every((k) => k === 'road') && (await shown()).join() === 'road', '2. still blank a few seconds later');
    const top = await note();
    console.log(`  top line: "${top}"`);
    check(!/画面|screen/.test(top), '3. no self-check line about moving');
    if (!BEFORE) {
      await press('[data-action=save]');
      await sleep(1500);
      const f = JSON.parse(readFileSync(join(root, 'placement.json'), 'utf8'));
      const l2 = f.levels?.find((l) => l.id === 'level-2');
      check(!!l2 && l2.blank === true && l2.from === 'level-1', '4. Level 2 is written blank: true, from level-1');
      check(!!l2?.removed?.some((r) => r.key === 'hex-1') && l2.removed.some((r) => r.key.startsWith('path:')), `4. its removed lists what went (${l2?.removed?.length})`);
    }
  } catch (e) {
    console.log(`  ✗ ${e.message}`);
    failed++;
  } finally {
    await close();
  }
}

for (const theme of THEMES) for (const loader of [false, true]) await run(theme, loader);
console.log(failed ? `${failed} failed` : 'ok');
process.exit(failed ? 1 : 0);
