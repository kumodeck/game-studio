// "Two uniforms" (studio-uniforms, 2026-10-23): the real server and the built shell,
// in headless Chrome, on games without levels (examples/three-orb-garden, three-crates).
//
// A hands-on try of v0.1.24: "pressing + Level suddenly typed text into the AI chat window — makes no sense", then, on
// the plan to make Level 2 at once: "it just makes it without asking?? there used to be a menu with copy and more".
//
//   1. "Level 1 ⌄" (last in the path since level-menu2, 2026-10-23) opens a menu — Level 1 ✓, New level, Duplicate; no
//      line of explanation, no ✦ row — and writes nothing in the AI box
//   2. Duplicate: the game opens on Level 2 (built from Level 1), the crumb says so, one line "Level 2 made. ⌘Z to
//      undo."; the box is still empty; ⌘Z takes it back (no crumb, "Level 1 ⌄" again), twice
//   3. a move on Level 2 hides the line; Save writes both levels and `levelsWas: []` (the code has none yet)
//   4. every plain row of the object's and the scene's menus, and F2: the box stays empty and is not focused; Rename
//      is a field on the card (Enter keeps: the list shows the name, the draft has `names`); ✦ rows are last, violet
//   5. ✦ "Ask AI to change …" puts the cursor in the box (a draft only: nothing is sent)
// Then pictures (--shots): the menu of "Level 1 ⌄", the line after Duplicate, the object menu, the name field — PC 1280×800,
// light and dark. With --tag before and --ui <the v0.1.24 shell>: the same moments in the old shell (no checks).
//
//   node test/studio-uniforms.browser.mjs [--shots <dir>] [--tag before|after] [--ui <built shell dir>] [--lang en|ja]
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
const UI = opt('--ui') ? resolve(opt('--ui')) : join(PKG, 'skills/arrange/bin/studio-ui');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WIN = `document.querySelector('iframe').contentWindow`;
const READY = `studioShell.items().length > 0 && !!${WIN}.__gameStudio?._debug`;
const BOX = `document.querySelector('.ask-input')`;

let failed = 0;
let browser = null, srv = null, root = null;
const fresh = async (game = 'three-orb-garden') => {
  await srv?.close();
  if (root) rmSync(root, { recursive: true, force: true });
  root = mkdtempSync(join(tmpdir(), 'studio-uniforms-'));
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
const asked = () => (existsSync(join(root, '.studio/requests')) ? readdirSync(join(root, '.studio/requests')).length : 0);

async function open({ w = 1280, h = 800, dark = false } = {}) {
  const page = await newPage(browser, { width: w, height: h });
  if (dark) await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  const ev = (e) => page.eval(e);
  const at = async (sel) => JSON.parse(await ev(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => e.offsetParent && !e.disabled); if (!b) return 'null';
    const r = b.getBoundingClientRect(); return JSON.stringify([r.left + Math.min(r.width / 2, 40), r.top + r.height / 2]); })()`));
  const press = async (sel) => {
    const p = await at(sel);
    assert.ok(p, `${sel} is on screen and enabled`);
    await page.click(p[0], p[1]);
    await sleep(350);
  };
  const right = async (sel) => {
    const p = await at(sel);
    assert.ok(p, `${sel} is on screen`);
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p[0], y: p[1] });
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p[0], y: p[1], button: 'right', buttons: 2, clickCount: 1 });
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p[0], y: p[1], button: 'right', buttons: 0, clickCount: 1 });
    await page.waitFor(`!document.querySelector('.ctx-menu').hidden`, 3000);
    await sleep(200);
  };
  const key = async (k, o = {}) => {
    const mods = (o.meta ? 4 : 0) | (o.shift ? 8 : 0);
    const code = o.code || (k.length === 1 ? `Key${k.toUpperCase()}` : k);
    await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, modifiers: mods, windowsVirtualKeyCode: o.vk || 0 });
    if (o.text) await page.send('Input.dispatchKeyEvent', { type: 'char', text: o.text, modifiers: mods });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, modifiers: mods, windowsVirtualKeyCode: o.vk || 0 });
    await sleep(250);
  };
  const rows = async () => JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('.ctx-menu > *')].map((e) => e.classList.contains('ctx-sep') ? '—' : e.classList.contains('ctx-note') ? '> ' + e.textContent
    : (e.classList.contains('ai') ? '✦ ' : '') + (e.dataset.action || '').replace(/^ctx-/, '')))`));
  /** The AI box: its words, and whether the cursor is in it. */
  const box = async () => JSON.parse(await ev(`JSON.stringify({ value: ${BOX}.value, focus: document.activeElement === ${BOX} })`));
  const crumb = () => ev(`(() => { const b = document.querySelector('.brand .level-switch'); return b && b.offsetParent ? b.textContent : null; })()`);
  const saveCount = () => ev(`(() => { const b = [...document.querySelectorAll('[data-action=save]')].find((e) => e.offsetParent); return b ? b.textContent : ''; })()`);
  return { page, ev, press, right, key, rows, box, crumb, saveCount, waitReady: () => page.waitFor(READY, 45000) };
}

const EMPTY = { value: '', focus: false };

async function flow() {
  await fresh();
  const p = await open();
  const errors = [];
  try {
    await p.page.goto(srv.url);
    await p.waitReady();
    await sleep(800);
    const sent = asked();
    // 1. "Level 1 ⌄" is a menu; the box stays empty.
    assert.equal(await p.crumb(), null, 'no levels yet');
    assert.match(await p.ev(`document.querySelector('.brand .level-add')?.textContent || ''`), /^Level 1$/, '"Level 1 ⌄"');
    // Where the level's name is once there are two: after "Scene" (Studio / game / Scene / Level 1 ⌄; level-menu2).
    assert.equal(await p.ev(`(() => { const a = document.querySelector('.brand .level-add'), s = document.querySelector('.brand .here'); return !!(a.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_PRECEDING); })()`), true);
    await p.press('.brand .level-add');
    assert.deepEqual(await p.rows(), ['level-one', '—', 'level-new', 'level-copy']);
    assert.deepEqual(await p.box(), EMPTY, 'the button wrote nothing in the AI box');
    await p.key('Escape', { vk: 27 });
    console.log('ok 1 "Level 1 ⌄" opens a menu (New level, Duplicate), the box stays empty');

    // 2. Duplicate → Level 2, then take it back with ⌘Z, twice.
    const make = async () => {
      await p.press('.brand .level-add');
      await p.press('.ctx-menu [data-action="ctx-level-copy"]');
      await p.page.waitFor(`document.querySelector('iframe').src.includes('studioLevel=level-2')`, 5000);
      await p.page.waitFor(`${READY} && /Level 2/.test(document.querySelector('.brand .level-switch')?.textContent || '')`, 45000);
      await sleep(400);
    };
    await make();
    assert.match(await p.ev(`document.querySelector('iframe').src`), /studioBuild=level-1(&|$)/, 'built from the game as it is');
    assert.match(await p.ev(`(() => { const l = document.querySelector('.level-made'); return l && !l.hidden ? l.textContent : ''; })()`), /^Level 2 made\. (⌘|Ctrl\+)Z to undo\.$/);
    assert.deepEqual(await p.box(), EMPTY, 'still nothing in the AI box');
    assert.match(await p.saveCount(), /1/, 'one change on Save');
    assert.equal(asked(), sent, 'nothing sent to the AI');
    await p.key('z', { meta: true, vk: 90 });
    await p.page.waitFor(`${READY} && !document.querySelector('.brand .level-switch') && !!document.querySelector('.brand .level-add')`, 45000);
    assert.doesNotMatch(await p.ev(`document.querySelector('iframe').src`), /studioLevel=/, 'the game as it was');
    await sleep(800);
    assert.ok(!('levels' in (placement() || {})), 'the draft has no levels again');
    await make();
    await p.key('z', { meta: true, vk: 90 });
    await p.page.waitFor(`${READY} && !document.querySelector('.brand .level-switch')`, 45000);
    console.log('ok 2 Duplicate opens Level 2 with one line; ⌘Z takes it back, twice');

    // 3. A move hides the line; Save writes both levels and levelsWas: [].
    await make();
    const k = JSON.parse(await p.ev(`JSON.stringify(studioShell.items().map((i) => i.key))`))[3];
    await p.ev(`studioShell.actions.select(${JSON.stringify(k)})`);
    await p.page.waitFor(`studioShell.selected() === ${JSON.stringify(k)}`, 3000);
    await p.key('ArrowRight', { vk: 39 });
    await sleep(600);
    assert.equal(await p.ev(`document.querySelector('.level-made').hidden`), true, 'the line goes with the first change');
    await p.key('s', { meta: true, vk: 83 });
    await p.page.waitFor(`/✓|Saved/.test(document.querySelector('.save-state')?.textContent || '')`, 8000).catch(() => {});
    await sleep(1200);
    const f = placement();
    assert.deepEqual(f?.levels?.map((l) => [l.id, l.from ?? null]), [['level-1', null], ['level-2', 'level-1']]);
    assert.deepEqual(f.levelsWas, [], 'the code has no levels yet');
    console.log('ok 3 a move hides the line; Save writes Level 1, Level 2 and levelsWas: []');
  } finally {
    if (errors.length) console.log(`  page errors: ${errors.join(' / ')}`);
    await p.page.close();
  }

  // 4–5. The menus' plain rows and F2 never write in the box; Rename is a field on the card. three-crates: its objects
  // have names in the code (Rename is for a named object; the orb garden's are all unnamed on purpose).
  await fresh('three-crates');
  const q = await open();
  try {
    await q.page.goto(srv.url);
    await q.waitReady();
    await sleep(800);
    const keys = JSON.parse(await q.ev(`JSON.stringify(studioShell.items().filter((i) => !i.unstable && i.movable !== false).map((i) => i.key))`));
    const k = keys[1];
    const pick = async () => {
      await q.ev(`studioShell.actions.select(${JSON.stringify(k)})`);
      await q.page.waitFor(`studioShell.selected() === ${JSON.stringify(k)}`, 3000);
      await sleep(200);
    };
    const row = `.objects .obj[data-key="${k}"]`;
    await pick();
    await q.right(row);
    const menu = await q.rows();
    const firstAi = menu.findIndex((r) => r.startsWith('✦'));
    assert.ok(firstAi > 0 && menu[firstAi - 1] === '—' && menu.slice(firstAi).every((r) => r.startsWith('✦')), `✦ rows last, after a line: ${menu.join(' | ')}`);
    assert.equal(menu[0], 'rename', 'Rename first (in place)');
    assert.match(await q.ev(`document.querySelector('.ctx-menu [data-action="ctx-rename"]').textContent`), /^RenameF2$/, 'Rename  F2');
    await q.key('Escape', { vk: 27 });
    // Remove and Show in Library leave the pick / the Scene, so they are pressed elsewhere (studio-context-menu).
    const plain = menu.filter((r) => r !== '—' && !r.startsWith('✦') && !r.startsWith('>') && r !== 'remove' && r !== 'showInLibrary');
    for (const id of plain) {
      await pick();
      await q.right(row);
      await q.press(`.ctx-menu [data-action="ctx-${id}"]`);
      if (id === 'rename') {
        assert.ok(await q.ev(`!!document.querySelector('.card .name-edit')`), 'Rename: the card\'s name is a field');
        await q.ev(`(() => { const i = document.querySelector('.card .name-edit'); i.value = 'Hero orb'; })()`);
        await q.key('Enter', { vk: 13 });
        await q.page.waitFor(`[...document.querySelectorAll('.objects .obj .name')].some((e) => e.textContent === 'Hero orb')`, 3000);
        assert.match(await q.ev(`document.querySelector('.card .head-name')?.textContent || ''`), /Hero orb/);
        await sleep(1500);
        assert.deepEqual(placement()?.names, { [k]: 'Hero orb' }, 'the draft carries the name for the AI');
        assert.match(await q.saveCount(), /1/, 'a rename is one change on Save');
        // ⌘Z puts the game's own name back.
        await q.key('z', { meta: true, vk: 90 });
        await q.page.waitFor(`![...document.querySelectorAll('.objects .obj .name')].some((e) => e.textContent === 'Hero orb')`, 3000);
      }
      assert.deepEqual(await q.box(), EMPTY, `${id}: nothing in the AI box`);
      if (id === 'duplicate') await q.key('z', { meta: true, vk: 90 });
    }
    // F2: the field, Esc leaves the name as it was.
    await pick();
    await q.key('F2', { code: 'F2', vk: 113 });
    assert.ok(await q.ev(`!!document.querySelector('.card .name-edit') && document.activeElement === document.querySelector('.card .name-edit')`), 'F2: the name field, with the cursor');
    await q.key('Escape', { vk: 27 });
    assert.ok(await q.ev(`!document.querySelector('.card .name-edit')`), 'Esc: back to the name');
    assert.deepEqual(await q.box(), EMPTY, 'F2: nothing in the AI box');
    // The scene's menu: its plain rows too.
    await q.ev(`studioShell.actions.select(null)`);
    await sleep(300);
    const scenePlain = ['selectAll', 'frame', 'home'];
    for (const id of scenePlain) {
      await q.ev(`studioShell.actions.select(null)`);
      await sleep(200);
      const f = JSON.parse(await q.ev(`JSON.stringify((() => { const r = document.querySelector('iframe').getBoundingClientRect(); return [r.left + 30, r.top + 30]; })())`));
      await q.page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: f[0], y: f[1], button: 'right', buttons: 2, clickCount: 1 });
      await q.page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: f[0], y: f[1], button: 'right', buttons: 0, clickCount: 1 });
      await q.page.waitFor(`!document.querySelector('.ctx-menu').hidden`, 3000);
      await sleep(200);
      const sm = await q.rows();
      assert.ok(sm[sm.length - 1].startsWith('✦'), `the scene's ✦ row is last: ${sm.join(' | ')}`);
      if (sm.includes(id)) await q.press(`.ctx-menu [data-action="ctx-${id}"]`);
      else await q.key('Escape', { vk: 27 });
      assert.deepEqual(await q.box(), EMPTY, `scene ${id}: nothing in the AI box`);
    }
    console.log(`ok 4 plain rows (${plain.join(', ')}; scene ${scenePlain.join(', ')}) and F2 leave the box empty; Rename is in place`);
    // 5. ✦ puts the cursor in the box, sends nothing.
    const before = asked();
    await pick();
    await q.right(row);
    await q.press('.ctx-menu [data-action="ctx-ask"]');
    assert.equal((await q.box()).focus, true, '✦: the cursor in the box');
    await sleep(500);
    assert.equal(asked(), before, '✦: nothing sent');
    console.log('ok 5 ✦ puts the cursor in the box and sends nothing');
  } finally {
    await q.page.close();
  }
}

/** Pictures: the menu of "Levels ⌄" (before: "+ Level" pressed), the line after Make, the object menu, the name field. */
async function shots() {
  for (const dark of [false, true]) {
    const name = `${TAG}-${LANG || 'en'}-${dark ? 'dark' : 'light'}`;
    await fresh('three-crates');
    const p = await open({ dark });
    try {
      await p.page.goto(srv.url + (LANG ? `&lang=${LANG}` : ''));
      await p.waitReady();
      await sleep(1500);
      await p.press('.brand .level-add');
      await sleep(400);
      writeFileSync(join(SHOTS, `${name}-1-level.png`), await p.page.screenshot());
      if (TAG !== 'before') {
        await p.press('.ctx-menu [data-action="ctx-level-copy"]');
        await p.page.waitFor(`${READY} && !!document.querySelector('.brand .level-switch')`, 45000);
        await sleep(1500);
        writeFileSync(join(SHOTS, `${name}-2-made.png`), await p.page.screenshot());
        // A fresh copy of the game for the menu pictures: the draft now has Level 2 (the crumb would say "Level 1").
        await fresh('three-crates');
        await p.page.goto(srv.url + (LANG ? `&lang=${LANG}` : ''));
        await p.waitReady();
        await sleep(1200);
      } else {
        await p.ev(`(() => { const i = ${BOX}; i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); i.blur(); })()`);
      }
      const k = JSON.parse(await p.ev(`JSON.stringify(studioShell.items().filter((i) => !i.unstable && i.movable !== false).map((i) => i.key))`))[1];
      await p.ev(`studioShell.actions.select(${JSON.stringify(k)})`);
      await sleep(600);
      await p.right(`.objects .obj[data-key="${k}"]`);
      await sleep(300);
      writeFileSync(join(SHOTS, `${name}-3-menu.png`), await p.page.screenshot());
      await p.press('.ctx-menu [data-action="ctx-rename"]');
      await sleep(500);
      writeFileSync(join(SHOTS, `${name}-4-rename.png`), await p.page.screenshot());
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
  if (TAG !== 'before' && !args.includes('--shots-only')) {
    try {
      await flow();
    } catch (e) {
      console.log(`✗ ${e.message}`);
      failed++;
    }
  }
  if (SHOTS) await shots();
} finally {
  await srv?.close();
  if (root) rmSync(root, { recursive: true, force: true });
  await browser.close();
}
process.exit(failed ? 1 : 0);
