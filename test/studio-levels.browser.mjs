// Levels (2026-10-22, CONTRACT.md §1.10): a game with three levels (examples/three-isles), the real
// server and the built shell, in headless Chrome.
//
//   1. the list's head names the level ("Meadow", "1 of 3") instead of "In this scene"
//   2. a move in Meadow, then the menu → Cave: the game opens on Cave (its own objects), Save still counts the move
//   3. New level from Cave → "Cave 2", built from Cave; Rename… → "Crystal Hall"; Move up; back to Meadow: the move is
//      still there
//   4. Save: placement.json has every level (Meadow's move, the copy with `from`, the rename with `labelWas`) and the
//      code's order (`levelsWas`); Delete level on Summit goes to its neighbour and Save writes it as missing
//   5. ▶ Play plays the level shown (in the same page since the fast switch, 2026-10-22)
//   6. a game without levels (examples/three-orb-garden): "In this scene", no switch, a saved move writes no `levels`
// Then pictures of the head and its menu: PC 1280×800, a side window 420×800 (mouse), a phone 390×844 (touch), light
// and dark.
//
//   node test/studio-levels.browser.mjs [--shots <dir>] [--tag before|after] [--ui <built shell dir>] [--no-assert]
// --ui with --no-assert: pictures only, with another built shell (the "before" set: the shell of the commit before).
// Exit 1 on failure.
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStudioServer } from '../src/server/server.mjs';
import { launch, newPage } from './adapters-2d/cdp.mjs';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const SHOTS = opt('--shots') ? resolve(opt('--shots')) : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const TAG = opt('--tag') || 'after';
const CHECK = !args.includes('--no-assert');
const UI = opt('--ui') ? resolve(opt('--ui')) : join(PKG, 'skills/arrange/bin/studio-ui');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WIN = `document.querySelector('iframe').contentWindow`;
const DBG = `${WIN}.__gameStudio._debug`;
const READY = `studioShell.items().length > 0 && !!${WIN}.__gameStudio?._debug`;

let failed = 0;
let browser = null, srv = null, root = null;
const fresh = async (game) => {
  await srv?.close();
  if (root) rmSync(root, { recursive: true, force: true });
  root = mkdtempSync(join(tmpdir(), 'studio-levels-'));
  cpSync(join(PKG, 'examples', game), root, { recursive: true });
  srv = await startStudioServer({ root, uiDir: UI, log: () => {} });
};
const placement = () => {
  try {
    return JSON.parse(readFileSync(join(root, 'placement.json'), 'utf8'));
  } catch {
    return null;
  }
};

/** One page with helpers. */
async function open({ w, h, touch = false, dark = false, side = false }) {
  const page = await newPage(browser, { width: w, height: h, mobile: touch });
  // The side window: a desktop window at 2× with a mouse (not the phone emulation).
  if (side) await page.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: false });
  if (dark) await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  const ev = (e) => page.eval(e);
  const press = async (sel) => {
    const at = JSON.parse(await ev(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => e.offsetParent && !e.disabled); if (!b) return null;
      const r = b.getBoundingClientRect(); return JSON.stringify([r.left + Math.min(r.width / 2, 40), r.top + r.height / 2]); })()`) || 'null');
    assert.ok(at, `${sel} is on screen and enabled`);
    if (touch) await page.tap(at[0], at[1]);
    else await page.click(at[0], at[1]);
    await sleep(300);
  };
  const head = () => ev(`(() => { const b = document.querySelector('.level-switch'); return b && b.offsetParent ? b.textContent : null; })()`);
  const keys = async () => JSON.parse(await ev(`JSON.stringify(${DBG}.list().map((i) => i.key))`));
  const frameUrl = () => ev(`document.querySelector('iframe').src`);
  const saveCount = () => ev(`(() => { const b = [...document.querySelectorAll('[data-action=save]')].find((e) => e.offsetParent); return b ? b.textContent : ''; })()`);
  const waitReady = () => page.waitFor(READY, 45000);
  return { page, ev, press, head, keys, frameUrl, saveCount, waitReady };
}

/** Choose a row of the levels' menu (opened from the head). */
async function menu(p, id) {
  if (args.includes('--verbose')) console.log(`  menu → ${id}`);
  await p.press('.level-switch');
  await p.page.waitFor(`document.querySelector('.ctx-menu') && !document.querySelector('.ctx-menu').hidden`, 3000);
  await p.press(`.ctx-menu [data-action="ctx-${id}"]`);
}

async function flow() {
  await fresh('three-isles');
  const p = await open({ w: 1280, h: 800 });
  try {
    await p.page.goto(srv.url);
    await p.waitReady();
    await sleep(800);
    // 1. The head.
    assert.match(await p.head(), /Meadow.*1 of 3/, 'the head names the level and its place');
    assert.equal(await p.ev(`!!document.querySelector('.list-title')`), false, '"In this scene" gives way to it');
    assert.ok((await p.keys()).includes('tree-1'), 'Meadow has its trees');
    // 2. A move in Meadow, then Cave.
    await p.ev(`studioShell.actions.select('rock-1')`);
    await p.page.waitFor(`studioShell.selected() === 'rock-1'`, 3000);
    const before = await p.ev(`JSON.stringify(${DBG}.list().find((i) => i.key === 'rock-1').pose.p.map((v) => Math.round(v * 100) / 100))`);
    await p.page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
    await p.page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
    await sleep(400);
    const moved = await p.ev(`JSON.stringify(${DBG}.list().find((i) => i.key === 'rock-1').pose.p.map((v) => Math.round(v * 100) / 100))`);
    assert.notEqual(moved, before, 'the arrow key moved rock-1');
    assert.match(await p.saveCount(), /1/, 'Save · 1');
    await menu(p, 'level:cave');
    await p.page.waitFor(`document.querySelector('iframe').src.includes('studioLevel=cave')`, 5000);
    await p.page.waitFor(`${READY} && ${DBG}.list().some((i) => i.key === 'crystal-1')`, 45000);
    assert.match(await p.head(), /Cave.*2 of 3/);
    assert.equal(await p.ev(`studioShell.selected()`), null, 'nothing picked on a new level');
    assert.match(await p.saveCount(), /1/, 'Meadow\'s move still waits for Save');
    // 3. Copy, rename, move up.
    await menu(p, 'level-new');
    await p.page.waitFor(`document.querySelector('iframe').src.includes('studioLevel=cave-2')`, 5000);
    assert.match(await p.frameUrl(), /studioBuild=cave(&|$)/, 'the copy is built from Cave');
    await p.page.waitFor(`${READY} && ${DBG}.list().some((i) => i.key === 'crystal-1')`, 45000);
    assert.match(await p.head(), /Cave 2.*3 of 4/, 'right after Cave');
    await menu(p, 'level-rename');
    await p.page.waitFor(`document.activeElement && document.activeElement.classList.contains('level-rename')`, 3000);
    await p.page.send('Input.insertText', { text: 'Crystal Hall' });
    await p.page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await p.page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await sleep(300);
    assert.match(await p.head(), /Crystal Hall.*3 of 4/);
    await menu(p, 'level-up');
    assert.match(await p.head(), /Crystal Hall.*2 of 4/);
    await menu(p, 'level:meadow');
    await p.page.waitFor(`${READY} && ${DBG}.list().some((i) => i.key === 'tree-4')`, 45000);
    await sleep(500);
    assert.equal(await p.ev(`JSON.stringify(${DBG}.list().find((i) => i.key === 'rock-1').pose.p.map((v) => Math.round(v * 100) / 100))`), moved, 'the move in Meadow is kept across levels');
    // 4. Save, then delete Summit and save again.
    await p.page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 's', code: 'KeyS', windowsVirtualKeyCode: 83, modifiers: process.platform === 'darwin' ? 4 : 2 });
    await p.page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 's', code: 'KeyS', windowsVirtualKeyCode: 83, modifiers: process.platform === 'darwin' ? 4 : 2 });
    await p.page.waitFor(`!/\\d/.test([...document.querySelectorAll('[data-action=save]')].find((e) => e.offsetParent)?.textContent || '')`, 8000).catch(() => {});
    let f = placement();
    assert.ok(f && Array.isArray(f.levels), 'placement.json has levels');
    assert.deepEqual(f.objects, {});
    assert.deepEqual(f.levels.map((l) => l.id), ['meadow', 'cave-2', 'cave', 'summit']);
    assert.ok(f.levels[0].objects?.['rock-1']?.was, 'Meadow\'s move, with where the code has it');
    assert.equal(f.levels[1].from, 'cave');
    assert.equal(f.levels[1].label, 'Crystal Hall');
    assert.deepEqual(f.levelsWas, ['meadow', 'cave', 'summit']);
    await menu(p, 'level:summit');
    await p.page.waitFor(`${READY} && ${DBG}.list().some((i) => i.key === 'flag') && document.querySelector('iframe').src.includes('studioLevel=summit')`, 45000);
    await menu(p, 'level-delete');
    await p.page.waitFor(`document.querySelector('iframe').src.includes('studioLevel=cave&')`, 5000);
    // The head comes back with the new page's list (it is not drawn while the list is empty).
    await p.page.waitFor(`/Cave.*3 of 3/.test(document.querySelector('.level-switch')?.textContent || '')`, 45000).catch(() => {});
    assert.match(await p.head(), /Cave.*3 of 3/, 'the neighbour before it');
    await p.page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 's', code: 'KeyS', windowsVirtualKeyCode: 83, modifiers: process.platform === 'darwin' ? 4 : 2 });
    await p.page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 's', code: 'KeyS', windowsVirtualKeyCode: 83, modifiers: process.platform === 'darwin' ? 4 : 2 });
    await sleep(1500);
    f = placement();
    assert.deepEqual(f.levels.map((l) => l.id), ['meadow', 'cave-2', 'cave'], 'Summit is gone from levels');
    assert.deepEqual(f.levelsWas, ['meadow', 'cave', 'summit'], 'and still in the code\'s list (for the AI to delete)');
    // 5. Play on the level shown. Since the fast switch (2026-10-22) the page on screen itself plays (no new Play page):
    // the shell is in Play, the page says so (`_play.playing()`), and it is the level shown.
    await p.press('[data-action=play]');
    await p.page.waitFor(`document.querySelector('.shell').dataset.playing === 'on' && ${WIN}.__gameStudio._play?.playing?.() === true && document.querySelector('iframe').src.includes('studioLevel=cave')`, 8000);
    await p.page.waitFor(`${WIN}.document.getElementById('level')?.textContent === 'Cave'`, 20000);
    console.log('ok levels: switch, copy, rename, move, delete, save, play');
  } finally {
    const errors = p.page.logs.filter((l) => l.startsWith('exception'));
    if (errors.length) console.log(`  page errors: ${errors.join(' / ')}`);
    await p.page.close();
  }

  // 6. No levels: as before.
  await fresh('three-orb-garden');
  const q = await open({ w: 1280, h: 800 });
  try {
    await q.page.goto(srv.url);
    await q.waitReady();
    assert.equal(await q.head(), null, 'no switch in a game without levels');
    assert.match(await q.ev(`document.querySelector('.list-title')?.textContent || ''`), /In this scene/);
    const k = (await q.keys())[3];
    await q.ev(`studioShell.actions.select(${JSON.stringify(k)})`);
    await q.page.waitFor(`studioShell.selected() === ${JSON.stringify(k)}`, 3000);
    await q.page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
    await q.page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
    await sleep(1500);
    const g = placement();
    assert.ok(g && Object.keys(g.objects).length === 1 && !('levels' in g) && !('levelsWas' in g), 'the draft is a one-level file');
    console.log('ok no levels: as before');
  } finally {
    await q.page.close();
  }
}

/** Pictures: the head (and, after, its menu open) at three sizes × two themes. */
async function shots() {
  const SIZES = [
    { id: 'pc', w: 1280, h: 800 },
    { id: 'side', w: 420, h: 800, side: true },
    { id: 'phone', w: 390, h: 844, touch: true },
  ];
  for (const sz of SIZES) for (const dark of [false, true]) {
    await fresh('three-isles');
    const name = `${TAG}-${sz.id}-${dark ? 'dark' : 'light'}`;
    const p = await open({ ...sz, dark });
    try {
      await p.page.goto(srv.url);
      await p.waitReady();
      // The list: the side window and the phone open it from the ask bar's list button.
      const sheet = await p.ev(`(() => { const b = document.querySelector('[data-action=sheet]'); if (!b || !b.offsetParent) return false; b.click(); return true; })()`);
      if (sheet) await sleep(700);
      await sleep(1500);
      writeFileSync(join(SHOTS, `${name}-1-open.png`), await p.page.screenshot());
      if (await p.head()) {
        await p.press('.level-switch');
        await sleep(400);
        writeFileSync(join(SHOTS, `${name}-2-menu.png`), await p.page.screenshot());
      }
    } catch (e) {
      console.log(`${name}: ✗ ${e.message}`);
      failed++;
    } finally {
      await p.page.close();
    }
  }
}

browser = await launch();
try {
  if (CHECK) {
    try {
      await flow();
    } catch (e) {
      failed++;
      console.log(`✗ ${e.message}`);
    }
  }
  if (SHOTS) await shots();
} finally {
  await browser.close();
  await srv?.close();
  if (root) rmSync(root, { recursive: true, force: true });
}
if (SHOTS) console.log(`shots in ${SHOTS}`);
if (failed) {
  console.log(`${failed} failed`);
  process.exit(1);
}
