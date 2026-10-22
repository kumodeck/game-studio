// Levels (2026-10-22, CONTRACT.md §1.10): a game with three levels (examples/three-isles), the real
// server and the built shell, in headless Chrome.
//
//   1. the top bar's path names the level (Studio / Three Isles / Meadow ⌄ / Scene; level-crumb, 2026-10-22), its
//      tooltip says "1 of 3", and the list's head says "In this scene" again (one door, not two)
//   2. a move in Meadow, then the menu → Canyon: the game opens on Canyon (its own objects), Save still counts the move
//   3. New level from Canyon → "Canyon 2", built from Canyon; Rename… → "Crystal Hall"; Move up; back to Meadow: the move is
//      still there
//   4. Save: placement.json has every level (Meadow's move, the copy with `from`, the rename with `labelWas`) and the
//      code's order (`levelsWas`); Delete level on Summit goes to its neighbour and Save writes it as missing
//   5. ▶ Play plays the level shown (in the same page since the fast switch, 2026-10-22)
//   6. ] and [ go to the next / previous level; ⌘K lists the levels' rows with those keys
//   7. a game without levels (examples/three-orb-garden): no crumb, "+ Level" after the path; pressing it writes the
//      request into the ask field and sends nothing; a saved move writes no `levels`
//   8. a game whose code has ONE level (three-isles with its list cut to Meadow): "+ Level" makes "Meadow 2" at once
// Then pictures of the crumb and its menu (and of "+ Level" in a game without levels): PC 1280×800, a side window
// 420×800 (mouse), a phone 390×844 (touch), light and dark.
//
//   node test/studio-levels.browser.mjs [--shots <dir>] [--tag before|after] [--ui <built shell dir>] [--no-assert] [--lang en|ja]
// --lang: the pictures' words (the editor's own choice when left out). The checks themselves always run in English.
// Added for the public docs' Japanese pages (docs/site, 2026-10-22), which use pictures of the Japanese screen.
// --ui with --no-assert: pictures only, with another built shell (the "before" set: the shell of the commit before).
// Exit 1 on failure.
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
const LANG = opt('--lang');
const CHECK = !args.includes('--no-assert');
const UI = opt('--ui') ? resolve(opt('--ui')) : join(PKG, 'skills/arrange/bin/studio-ui');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WIN = `document.querySelector('iframe').contentWindow`;
const DBG = `${WIN}.__gameStudio._debug`;
const READY = `studioShell.items().length > 0 && !!${WIN}.__gameStudio?._debug`;

let failed = 0;
let browser = null, srv = null, root = null;
const fresh = async (game, patch) => {
  await srv?.close();
  if (root) rmSync(root, { recursive: true, force: true });
  root = mkdtempSync(join(tmpdir(), 'studio-levels-'));
  cpSync(join(PKG, 'examples', game), root, { recursive: true });
  if (patch) patch(root);
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
  // The crumb's words and its tooltip ("Meadow  Level 1 of 3: Meadow. Press…"): the place in the list is said there.
  const head = () => ev(`(() => { const b = document.querySelector('.brand .level-switch'); return b && b.offsetParent ? b.textContent + '  ' + b.title : null; })()`);
  const key = async (k) => {
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: k === '[' ? 'BracketLeft' : 'BracketRight', text: k, windowsVirtualKeyCode: k === '[' ? 219 : 221 });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k === '[' ? 'BracketLeft' : 'BracketRight', windowsVirtualKeyCode: k === '[' ? 219 : 221 });
  };
  const keys = async () => JSON.parse(await ev(`JSON.stringify(${DBG}.list().map((i) => i.key))`));
  const frameUrl = () => ev(`document.querySelector('iframe').src`);
  const saveCount = () => ev(`(() => { const b = [...document.querySelectorAll('[data-action=save]')].find((e) => e.offsetParent); return b ? b.textContent : ''; })()`);
  const waitReady = () => page.waitFor(READY, 45000);
  return { page, ev, press, head, key, keys, frameUrl, saveCount, waitReady };
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
    // 1. The crumb, between the game and the Scene.
    assert.match(await p.head(), /Meadow.*1 of 3/, 'the crumb names the level, its tooltip its place');
    // (The level's slot is display: contents, so its parts are looked up by name, not by the bar's children.)
    assert.equal(await p.ev(`[...document.querySelectorAll('.brand .app, .brand .title, .brand .level-switch, .brand .here')].filter((e) => e.getClientRects().length).map((e) => e.textContent.trim()).join(' / ')`),
      'Studio / Three Isles / Meadow / Scene', 'Studio / Three Isles / Meadow / Scene');
    assert.match(await p.ev(`document.querySelector('.list-title')?.textContent || ''`), /In this scene/, 'the list says "In this scene" again');
    assert.equal(await p.ev(`!!document.querySelector('.list-tools .level-switch')`), false, 'one door: not in the list too');
    assert.equal(await p.ev(`!!document.querySelector('.level-add')`), false, 'no "+ Level" in a game with levels');
    assert.ok((await p.keys()).includes('tree-1'), 'Meadow has its trees');
    // 2. A move in Meadow, then Canyon.
    await p.ev(`studioShell.actions.select('rock-1')`);
    await p.page.waitFor(`studioShell.selected() === 'rock-1'`, 3000);
    const before = await p.ev(`JSON.stringify(${DBG}.list().find((i) => i.key === 'rock-1').pose.p.map((v) => Math.round(v * 100) / 100))`);
    await p.page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
    await p.page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
    await sleep(400);
    const moved = await p.ev(`JSON.stringify(${DBG}.list().find((i) => i.key === 'rock-1').pose.p.map((v) => Math.round(v * 100) / 100))`);
    assert.notEqual(moved, before, 'the arrow key moved rock-1');
    assert.match(await p.saveCount(), /1/, 'Save · 1');
    await menu(p, 'level:canyon');
    await p.page.waitFor(`document.querySelector('iframe').src.includes('studioLevel=canyon')`, 5000);
    await p.page.waitFor(`${READY} && ${DBG}.list().some((i) => i.key === 'crystal-1')`, 45000);
    assert.match(await p.head(), /Canyon.*2 of 3/);
    assert.equal(await p.ev(`studioShell.selected()`), null, 'nothing picked on a new level');
    assert.match(await p.saveCount(), /1/, 'Meadow\'s move still waits for Save');
    // 3. Copy, rename, move up.
    await menu(p, 'level-new');
    await p.page.waitFor(`document.querySelector('iframe').src.includes('studioLevel=canyon-2')`, 5000);
    assert.match(await p.frameUrl(), /studioBuild=canyon(&|$)/, 'the copy is built from Canyon');
    await p.page.waitFor(`${READY} && ${DBG}.list().some((i) => i.key === 'crystal-1')`, 45000);
    assert.match(await p.head(), /Canyon 2.*3 of 4/, 'right after Canyon');
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
    assert.deepEqual(f.levels.map((l) => l.id), ['meadow', 'canyon-2', 'canyon', 'summit']);
    assert.ok(f.levels[0].objects?.['rock-1']?.was, 'Meadow\'s move, with where the code has it');
    assert.equal(f.levels[1].from, 'canyon');
    assert.equal(f.levels[1].label, 'Crystal Hall');
    assert.deepEqual(f.levelsWas, ['meadow', 'canyon', 'summit']);
    await menu(p, 'level:summit');
    await p.page.waitFor(`${READY} && ${DBG}.list().some((i) => i.key === 'flag') && document.querySelector('iframe').src.includes('studioLevel=summit')`, 45000);
    await menu(p, 'level-delete');
    await p.page.waitFor(`document.querySelector('iframe').src.includes('studioLevel=canyon&')`, 5000);
    // The head comes back with the new page's list (it is not drawn while the list is empty).
    await p.page.waitFor(`/Canyon.*3 of 3/.test(document.querySelector('.level-switch')?.textContent || '')`, 45000).catch(() => {});
    assert.match(await p.head(), /Canyon.*3 of 3/, 'the neighbour before it');
    await p.page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 's', code: 'KeyS', windowsVirtualKeyCode: 83, modifiers: process.platform === 'darwin' ? 4 : 2 });
    await p.page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 's', code: 'KeyS', windowsVirtualKeyCode: 83, modifiers: process.platform === 'darwin' ? 4 : 2 });
    await sleep(1500);
    f = placement();
    assert.deepEqual(f.levels.map((l) => l.id), ['meadow', 'canyon-2', 'canyon'], 'Summit is gone from levels');
    assert.deepEqual(f.levelsWas, ['meadow', 'canyon', 'summit'], 'and still in the code\'s list (for the AI to delete)');
    // 5. Play on the level shown. Since the fast switch (2026-10-22) the page on screen itself plays (no new Play page):
    // the shell is in Play, the page says so (`_play.playing()`), and it is the level shown.
    await p.press('[data-action=play]');
    await p.page.waitFor(`document.querySelector('.shell').dataset.playing === 'on' && ${WIN}.__gameStudio._play?.playing?.() === true && document.querySelector('iframe').src.includes('studioLevel=canyon')`, 8000);
    await p.page.waitFor(`${WIN}.document.getElementById('level')?.textContent === 'Canyon'`, 20000);
    // While playing the crumb is the level's name as words (no menu under the person's hands).
    assert.equal(await p.ev(`document.querySelector('.brand .level-here')?.textContent || ''`), 'Canyon', 'Playing: the level as words');
    assert.equal(await p.head(), null);
    await p.press('[data-action=play]');
    await p.page.waitFor(`document.querySelector('.shell').dataset.playing !== 'on' && ${READY}`, 45000);
    console.log('ok levels: switch, copy, rename, move, delete, save, play');
    // 6. [ / ]: Meadow, Crystal Hall, Canyon — on Canyon (the last), ] does nothing, [ goes to Crystal Hall.
    await sleep(500);
    await p.key(']');
    await sleep(600);
    assert.match(await p.frameUrl(), /studioLevel=canyon(&|$)/, '] on the last level stays');
    await p.key('[');
    await p.page.waitFor(`document.querySelector('iframe').src.includes('studioLevel=canyon-2')`, 5000);
    await p.page.waitFor(`${READY} && /Crystal Hall/.test(document.querySelector('.brand .level-switch')?.textContent || '')`, 45000);
    // The menu writes those keys on the neighbours' rows.
    await p.press('.brand .level-switch');
    await p.page.waitFor(`document.querySelector('.ctx-menu') && !document.querySelector('.ctx-menu').hidden`, 3000);
    assert.equal(await p.ev(`document.querySelector('.ctx-menu [data-action="ctx-level:meadow"] .ctx-key')?.textContent || ''`), '[');
    assert.equal(await p.ev(`document.querySelector('.ctx-menu [data-action="ctx-level:canyon"] .ctx-key')?.textContent || ''`), ']');
    // The menu sits under the crumb, not over it.
    assert.ok(await p.ev(`document.querySelector('.ctx-menu').getBoundingClientRect().top >= document.querySelector('.brand .level-switch').getBoundingClientRect().bottom`), 'the menu is under the crumb');
    await p.page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await p.page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await sleep(300);
    // ⌘K: "Levels…", the previous and the next level with their keys.
    const mod = process.platform === 'darwin' ? 4 : 2;
    await p.page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'k', code: 'KeyK', windowsVirtualKeyCode: 75, modifiers: mod });
    await p.page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'k', code: 'KeyK', windowsVirtualKeyCode: 75, modifiers: mod });
    await p.page.waitFor(`document.querySelector('.shell').dataset.palette === 'open'`, 3000);
    const pal = JSON.parse(await p.ev(`JSON.stringify(['levels', 'level-prev', 'level-next'].map((a) => document.querySelector('.palette [data-action="' + a + '"]')?.textContent || ''))`));
    assert.match(pal[0], /Levels/);
    assert.match(pal[1], /Previous level: Meadow.*\[/);
    assert.match(pal[2], /Next level: Canyon.*\]/);
    console.log('ok levels: [ ], the menu\'s keys, ⌘K');
  } finally {
    const errors = p.page.logs.filter((l) => l.startsWith('exception'));
    if (errors.length) console.log(`  page errors: ${errors.join(' / ')}`);
    await p.page.close();
  }

  // 7. No levels: as before, and "+ Level" after the path.
  await fresh('three-orb-garden');
  const q = await open({ w: 1280, h: 800 });
  try {
    await q.page.goto(srv.url);
    await q.waitReady();
    assert.equal(await q.head(), null, 'no crumb in a game without levels');
    assert.match(await q.ev(`document.querySelector('.list-title')?.textContent || ''`), /In this scene/);
    assert.match(await q.ev(`(() => { const b = document.querySelector('.brand .level-add'); return b && b.offsetParent ? b.textContent : ''; })()`), /Level/, '"+ Level" after the path');
    // A hand-off would be a file in .studio/requests (server.mjs): none before Enter.
    const asked = () => (existsSync(join(root, '.studio/requests')) ? readdirSync(join(root, '.studio/requests')).length : 0);
    const before = asked();
    await q.press('.brand .level-add');
    assert.match(await q.ev(`document.querySelector('.ask-input').value`), /levels/, 'the request is in the ask field');
    assert.equal(await q.ev(`document.activeElement === document.querySelector('.ask-input')`), true, 'with the cursor in it');
    await sleep(500);
    assert.equal(asked(), before, 'nothing sent before Enter');
    await q.ev(`(() => { const i = document.querySelector('.ask-input'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); i.blur(); })()`);
    const k = (await q.keys())[3];
    await q.ev(`studioShell.actions.select(${JSON.stringify(k)})`);
    await q.page.waitFor(`studioShell.selected() === ${JSON.stringify(k)}`, 3000);
    await q.page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
    await q.page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
    await sleep(1500);
    const g = placement();
    assert.ok(g && Object.keys(g.objects).length === 1 && !('levels' in g) && !('levelsWas' in g), 'the draft is a one-level file');
    console.log('ok no levels: as before, "+ Level" fills the ask field');
  } finally {
    await q.page.close();
  }

  // 8. The code has one level: "+ Level" makes the second one here, built from it.
  await fresh('three-isles', oneLevel);
  const r = await open({ w: 1280, h: 800 });
  try {
    await r.page.goto(srv.url);
    await r.waitReady();
    await sleep(500);
    assert.equal(await r.head(), null, 'one level: no crumb');
    await r.press('.brand .level-add');
    await r.page.waitFor(`document.querySelector('iframe').src.includes('studioLevel=meadow-2')`, 5000);
    assert.match(await r.frameUrl(), /studioBuild=meadow(&|$)/, 'built from the one level');
    await r.page.waitFor(`${READY} && /Meadow 2/.test(document.querySelector('.brand .level-switch')?.textContent || '')`, 45000);
    assert.match(await r.head(), /Meadow 2.*2 of 2/);
    assert.equal(await r.ev(`!!document.querySelector('.level-add')`), false, '"+ Level" gives way to the crumb');
    assert.match(await r.saveCount(), /1/, 'one change on Save');
    console.log('ok one level: "+ Level" makes Meadow 2');
  } finally {
    await r.page.close();
  }
}

/** three-isles with its code's list cut to Meadow (a game whose code has levels, but one). */
function oneLevel(dir) {
  const f = join(dir, 'game.js');
  const src = readFileSync(f, 'utf8');
  const cut = src.replace('window.studio?.levels?.(LEVELS.map(', 'window.studio?.levels?.(LEVELS.slice(0, 1).map(');
  if (cut === src) throw new Error('three-isles/game.js: the studio.levels line moved');
  writeFileSync(f, cut);
}

/**
 * Pictures at three sizes × two themes: 1-open (the crumb), 2-menu (its menu open), and, after, 3-none (a game without
 * levels: "+ Level" after the path). "before" (the v0.1.19 shell, --ui): the level was the list's head, so the side
 * window and the phone open the list first to show it.
 */
async function shots() {
  const SIZES = [
    { id: 'pc', w: 1280, h: 800 },
    { id: 'side', w: 420, h: 800, side: true },
    { id: 'phone', w: 390, h: 844, touch: true },
  ];
  const sw = '.level-switch';
  for (const sz of SIZES) for (const dark of [false, true]) {
    const name = `${TAG}-${sz.id}-${dark ? 'dark' : 'light'}`;
    for (const game of TAG === 'before' ? ['three-isles'] : ['three-isles', 'three-orb-garden']) {
      await fresh(game);
      const p = await open({ ...sz, dark });
      try {
        await p.page.goto(srv.url + (LANG ? `&lang=${LANG}` : ''));
        await p.waitReady();
        if (TAG === 'before') {
          const sheet = await p.ev(`(() => { const b = document.querySelector('[data-action=sheet]'); if (!b || !b.offsetParent) return false; b.click(); return true; })()`);
          if (sheet) await sleep(700);
        }
        await sleep(1500);
        if (game === 'three-orb-garden') {
          writeFileSync(join(SHOTS, `${name}-3-none.png`), await p.page.screenshot());
          continue;
        }
        writeFileSync(join(SHOTS, `${name}-1-open.png`), await p.page.screenshot());
        if (await p.ev(`!!document.querySelector('${sw}')?.offsetParent`)) {
          await p.press(sw);
          await sleep(400);
          writeFileSync(join(SHOTS, `${name}-2-menu.png`), await p.page.screenshot());
        }
      } catch (e) {
        console.log(`${name} ${game}: ✗ ${e.message}`);
        failed++;
      } finally {
        await p.page.close();
      }
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
