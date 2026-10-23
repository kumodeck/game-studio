// Use the Library (a request after a try of the editor, 2026-10-18): "I can look at things in the Library, but so far
// it doesn't do anything. I want to add things from it to the scene, and point at one in the Library and ask the AI
// 'bring this enemy in as the boss at the climax'." — "And when I pick something in the game, go straight to its page
// in the Library."
//
// With the real server and the built editor, Lantern Cove (3D) and Firefly Ruins (2D), at PC 1280×800 (mouse) and a
// phone 390×844 (touch), dark then light:
//   1. Library → an object's tile (real press): the ask box's chip names it (the same chip as a pick in the Scene),
//      still the Library
//   2. its "Add to scene": one new object (a copy of it), the Scene on screen with the copy picked, the copy in the
//      middle of what the camera sees (on screen, inside the free part of the frame), the camera not moved; ⌘Z (PC) /
//      the top bar's Undo (phone) takes it away again
//   3. its "Ask your AI…": the cursor in the ask box, still the Library; words + Enter → one `ask` request whose object
//      has its key and the file it is drawn with (`files`)
//   4. a file's tile: the chip names the file; its "Add to scene" drafts "Add this to the scene" in the ask box (nothing
//      sent yet); Enter → one `ask` request with `assets: [the file]`; Multi-select + two files → the chip says 2 files
//   5. (PC) a tile dragged onto the Scene row adds it (the same as "Add to scene")
//   6. the Scene → the Library: pick an object in the list, the card's "Show in Library →" → the Library with that
//      object's detail and its tile picked, the camera not moved; its file ("planks.jpg →") opens the file's detail;
//      ⌘K and the object's menu have "Show in Library"
//   7. the web demo (no AI, --demo): "Add to scene" on an object still adds it; on a file it is dimmed with one line
//      saying why, and there is no "Ask your AI…"
// Pictures (--shots <dir>): <game>-<size>-<theme>-1-lib-object / 2-added / 3-ask-object / 4-file-draft / 5-files-2 /
// 6-scene-card / 7-scene-to-library, and demo-<game>-<size>-file.png
//
//   node test/studio-library-use.browser.mjs [--shots <dir>] [--only pc,phone] [--game lantern-cove|firefly-ruins]
//                                            [--theme dark|light|both] [--lang ja|en] [--demo | --no-demo]
// Exit 1 on failure.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStudioServer } from '../src/server/server.mjs';
import { runWatch } from '../src/server/ai-watch.mjs';
import { launch, newPage } from './adapters-2d/cdp.mjs';
import { startHost } from './web-demo-host.mjs';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const SHOTS = opt('--shots') ? resolve(opt('--shots')) : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const LANG = opt('--lang') || 'ja';
const THEMES = (opt('--theme') || 'both') === 'both' ? ['dark', 'light'] : [opt('--theme')];
const DEMO = !args.includes('--no-demo');
const ONLY_DEMO = args.includes('--demo');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// file: a file of the game to add / ask about (a 3D model, a 2D picture). second: another file, for two at once.
const GAMES = [
  { id: 'lantern-cove', dim: '3d', file: 'assets/barrel.glb', second: 'assets/bell.mp3' },
  { id: 'firefly-ruins', dim: '2d', file: 'assets/lantern.png', second: 'assets/bell.mp3' },
].filter((g) => !opt('--game') || g.id === opt('--game'));
const SIZES = [
  { id: 'pc', w: 1280, h: 800, touch: false },
  { id: 'phone', w: 390, h: 844, touch: true },
].filter((s) => !opt('--only') || opt('--only').split(',').includes(s.id));
const W = {
  ja: { addFile: 'これをシーンに足して', boss: 'この敵をボスとしてクライマックスに登場させて', files2: '素材 2', why: 'AI につながっていません' },
  en: { addFile: 'Add this to the scene', boss: 'bring this enemy in as the boss at the climax', files2: '2 files', why: 'isn’t connected here' },
}[LANG];

const WIN = `document.querySelector('iframe.game:not(.leaving)').contentWindow`;
// Visible = laid out, on screen and not covered (what a person can see and press).
const VIS = `(e) => { if (!e || !e.isConnected) return false; const r = e.getBoundingClientRect(); if (!r.width || !r.height || r.bottom < 0 || r.top > innerHeight) return false;
  if (!e.checkVisibility({ visibilityProperty: true, opacityProperty: true })) return false;
  const x = Math.min(Math.max(r.left + r.width / 2, 1), innerWidth - 1), y = Math.min(Math.max(r.top + r.height / 2, 1), innerHeight - 1);
  const top = document.elementFromPoint(x, y); return !!top && (e === top || e.contains(top) || top.contains(e)); }`;
const visible = (sel) => `(() => { const v = ${VIS}; return [...document.querySelectorAll(${JSON.stringify(sel)})].some(v); })()`;
const requests = (root) => {
  try {
    return readdirSync(join(root, '.studio/requests')).filter((n) => n.endsWith('.json')).sort().map((n) => JSON.parse(readFileSync(join(root, '.studio/requests', n), 'utf8')));
  } catch {
    return [];
  }
};

let failed = 0;
let browser = null, srv = null, root = null, watch = null;
const fresh = async (g, theme) => {
  watch?.abort();
  await browser?.close();
  await srv?.close();
  if (root) rmSync(root, { recursive: true, force: true });
  root = mkdtempSync(join(tmpdir(), 'studio-library-use-'));
  cpSync(join(PKG, 'starters', g.id), root, { recursive: true });
  mkdirSync(join(root, '.studio/ui'), { recursive: true });
  writeFileSync(join(root, '.studio/ui/prefs.json'), JSON.stringify({ version: 1, lang: LANG, theme }));
  // No KUMODeck sign-in (studio-library-shelf, 2026-10-23): the Library reads it at once now for its "✦ Make with AI" words,
  // and the real ~/.kumo of the machine running this must not be read (nor its balance land in a picture).
  srv = await startStudioServer({ root, kumo: { home: join(root, '.no-kumo-home'), env: {} }, uiDir: join(PKG, 'skills/arrange/bin/studio-ui'), log: () => {} });
  // An AI's watch (what `studio.mjs --watch` runs), as when a person works next to their AI: the editor then says
  // "your AI has it" instead of a big "your AI isn't watching" card, which covered a phone list's last rows.
  watch = new AbortController();
  void runWatch(root, { out: () => {}, signal: watch.signal }).catch(() => undefined);
  browser = await launch();
};

/** The helpers every case uses, on one page. */
function helpers(page, sz, tag) {
  const J = (js) => page.eval(`JSON.stringify(${js})`).then(JSON.parse);
  const shot = async (name) => {
    if (!SHOTS) return;
    await sleep(500);
    writeFileSync(join(SHOTS, `${tag}-${name}.png`), await page.screenshot());
  };
  // A real press (mouse click / finger tap) on the middle of the first visible match.
  const press = async (sel) => {
    const at = JSON.parse(await page.eval(`(() => { const v = ${VIS}; const all = [...document.querySelectorAll(${JSON.stringify(sel)})];
      let e = all.find(v); if (!e) { e = all.find((x) => x.getBoundingClientRect().width); e?.scrollIntoView({ block: 'center', inline: 'center' }); if (!v(e)) e?.scrollIntoView({ block: 'start' }); if (!v(e)) return 'null'; }
      const r = e.getBoundingClientRect(); return JSON.stringify([r.left + r.width / 2, r.top + r.height / 2]); })()`));
    if (!at && process.env.STUDIO_DEBUG_SHOTS) writeFileSync(join(process.env.STUDIO_DEBUG_SHOTS, `${tag}-no-press.png`), await page.screenshot());
    assert.ok(at, `${tag}: nothing visible to press for ${sel}`);
    if (sz.touch) await page.tap(at[0], at[1]);
    else await page.click(at[0], at[1]);
    await sleep(400);
  };
  const key = async (k, mods = 0) => {
    const code = k.length === 1 ? `Key${k.toUpperCase()}` : k;
    const vk = { Enter: 13, Escape: 27, z: 90 }[k];
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers: mods, ...(k === 'Enter' ? { text: '\r' } : {}) });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers: mods });
    await sleep(400);
  };
  // The phone's list sheet slides up: wait for it to stand still, or the next tap lands on the game behind it.
  const openSheet = async () => {
    await press('.bar [data-action=sheet]');
    await sleep(700);
  };
  const chip = () => page.eval(`(() => { const c = document.querySelector('.ask-chip'); return c && !c.hidden ? c.textContent : ''; })()`);
  const libOn = () => page.eval(visible('.assets-page .gsl'));
  const view = () => page.eval(`JSON.stringify(${WIN}.__gameStudio._debug.view())`);
  const openLibrary = async () => {
    if (await libOn()) return;
    if (sz.touch && !(await page.eval(visible('.nav-row[data-tool=library]')))) await openSheet();
    await press('.nav-row[data-tool=library]');
    try {
      // Tiles there (a phone opens on the pick's detail, the tiles under it: pressing scrolls to them).
      await page.waitFor(`${visible('.assets-page .gsl')} && document.querySelectorAll('.assets-page .gsl-tile[data-kind=object]').length > 0 && document.querySelectorAll('.assets-page .gsl-tile[data-kind=file]').length > 0`, 20000);
    } catch (e) {
      // What was on screen instead (a picture for the one reading the failure).
      if (process.env.STUDIO_DEBUG_SHOTS) writeFileSync(join(process.env.STUDIO_DEBUG_SHOTS, `${tag}-no-library.png`), await page.screenshot());
      throw e;
    }
    await sleep(600);
  };
  /** Can `sel` be pressed (on screen, not covered, after scrolling it into view)? */
  const pressable = (sel) => page.eval(`(() => { const v = ${VIS}; const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; if (v(e)) return true;
    e.scrollIntoView({ block: 'center' }); if (v(e)) return true; e.scrollIntoView({ block: 'start' }); return v(e); })()`);
  return { J, shot, press, pressable, key, openSheet, chip, libOn, view, openLibrary, step: (s) => console.log(`  ${tag}: ${s}`) };
}

async function runLocal(g, sz, theme) {
  const tag = `${g.id}-${sz.id}-${theme}`;
  await fresh(g, theme);
  const page = await newPage(browser, { width: sz.w, height: sz.h, mobile: sz.touch });
  const { J, shot, press, pressable, key, openSheet, chip, libOn, view, openLibrary, step } = helpers(page, sz, tag);
  await page.goto(srv.url);
  await page.waitFor(`document.querySelectorAll('.obj').length > 0 && !!${WIN}?.__gameStudio?._debug`, 60000);
  await sleep(1500);
  const n0 = await page.eval('studioShell.items().length');

  // 1. An object's tile in the Library: its chip in the ask box. A single object (no "×3") drawn with a file.
  await openLibrary();
  await page.waitFor(`!!document.querySelector('.assets-page .lib-object:not([data-group]) .shelf-file:not(.code)')`, 15000);
  const tileKey = await page.eval(`document.querySelector('.assets-page .lib-object:not([data-group]) .shelf-file:not(.code)').closest('.lib-object').dataset.key`);
  const tileName = await page.eval(`document.querySelector('.assets-page .lib-object[data-key="${tileKey}"] .gsl-name').textContent`);
  const tileFile = await page.eval(`document.querySelector('.assets-page .lib-object[data-key="${tileKey}"] .shelf-file').title.split('\\n')[0]`);
  await press(`.assets-page .lib-object[data-key="${tileKey}"]`);
  assert.equal(await page.eval('studioShell.selected()'), tileKey, `${tag}: the press picks it`);
  assert.equal(await chip(), tileName, `${tag}: the ask box's chip names the picked object`);
  assert.ok(await page.eval(visible('.ask-chip')), `${tag}: the chip (and the ask box) is on screen in the Library`);
  assert.ok(await libOn(), `${tag}: still the Library`);
  assert.ok(await page.eval(visible('.lib-object-detail [data-action=add-to-scene]')) && await page.eval(visible('.lib-object-detail [data-action=lib-ask]')), `${tag}: Add to scene and Ask your AI… on its detail`);
  step(`tile ${tileKey} (“${tileName}”, ${tileFile}) → chip “${await chip()}”`);
  await shot('1-lib-object');

  // 2. Add to scene: a copy in the middle of the view, the Scene with it picked, the camera unmoved; undo.
  const v0 = await view();
  await press('.lib-object-detail [data-action=add-to-scene]');
  await page.waitFor(`studioShell.items().length === ${n0 + 1}`, 8000);
  await sleep(600);
  const sel = await page.eval('studioShell.selected()');
  const copy = await J(`studioShell.items().find((i) => i.key === ${JSON.stringify(sel)})`);
  assert.ok(copy && copy.copyOf === tileKey, `${tag}: the new pick is a copy of ${tileKey} (${JSON.stringify(copy)})`);
  assert.equal(await page.eval(`document.querySelector('.shell').dataset.view`), 'placement', `${tag}: the Scene is on screen`);
  assert.equal(await libOn(), false, `${tag}: the Library stepped away`);
  assert.equal(await view(), v0, `${tag}: the camera did not move`);
  const at = await J(`(() => { const a = ${WIN}.__gameStudio._debug.anchor(${JSON.stringify(sel)}); const f = document.querySelector('iframe.game:not(.leaving)').getBoundingClientRect(); return a && { x: a.center[0] / f.width, y: a.center[1] / f.height, visible: a.visible }; })()`);
  assert.ok(at && at.visible && at.x > 0.15 && at.x < 0.85 && at.y > 0.1 && at.y < 0.9, `${tag}: the copy is in the middle of the view (${JSON.stringify(at)})`);
  step(`Add to scene → ${sel} at ${at.x.toFixed(2)}, ${at.y.toFixed(2)} of the frame, camera kept`);
  await shot('2-added');
  if (sz.touch) await press('.top [data-action=undo]');
  else await key('z', 2);
  await page.waitFor(`studioShell.items().length === ${n0}`, 5000);
  step('undo takes it away');

  // 3. Ask your AI… from the Library: the request names the object and its file.
  await openLibrary();
  await press(`.assets-page .lib-object[data-key="${tileKey}"]`);
  await press('.lib-object-detail [data-action=lib-ask]');
  assert.equal(await page.eval(`document.activeElement?.classList.contains('ask-input')`), true, `${tag}: the cursor is in the ask box`);
  assert.ok(await libOn(), `${tag}: Ask your AI… keeps the Library`);
  await page.send('Input.insertText', { text: W.boss });
  await shot('3-ask-object');
  const r0 = requests(root).length;
  await key('Enter');
  await page.waitFor(`!document.querySelector('.ask-input').value`, 5000);
  let reqs = requests(root);
  assert.equal(reqs.length, r0 + 1, `${tag}: one request kept`);
  const boss = reqs.at(-1);
  assert.equal(boss.kind, 'ask');
  assert.equal(boss.text, W.boss);
  assert.deepEqual(boss.objects.map((o) => o.key), [tileKey], `${tag}: about the picked object`);
  assert.ok(boss.objects[0].files?.includes(tileFile), `${tag}: with the file it is drawn with (${JSON.stringify(boss.objects[0])})`);
  assert.equal(boss.assets, undefined);
  assert.ok(await libOn(), `${tag}: still the Library after sending`);
  step(`asked “${W.boss}” → ${boss.id} (objects ${JSON.stringify(boss.objects.map((o) => [o.key, o.files]))})`);

  // 4. A file: its chip; "Add to scene" drafts the request, Enter sends it with the file.
  await press(`.assets-page .gsl-tile[data-kind=file][data-path="${g.file}"]`);
  const base = g.file.slice(g.file.lastIndexOf('/') + 1);
  assert.equal(await chip(), base, `${tag}: the chip names the file`);
  assert.equal(await page.eval('studioShell.selected()'), null, `${tag}: opening a file drops the objects' pick`);
  const r1 = requests(root).length;
  const addOn = () => page.eval(`document.querySelector('.assets-page .gsl-detail [data-action=file-add-to-scene]')?.disabled === false`);
  assert.equal(await addOn(), true, `${tag}: a file's Add to scene can be pressed where an AI is connected`);
  await press('.assets-page .gsl-detail [data-action=file-add-to-scene]');
  assert.equal(await addOn(), true, `${tag}: and stays so after the press`);
  assert.equal(await page.eval(`document.querySelector('.ask-input').value`), W.addFile, `${tag}: the words are drafted`);
  assert.equal(await page.eval(`document.activeElement?.classList.contains('ask-input')`), true);
  assert.equal(requests(root).length, r1, `${tag}: nothing is sent before Enter`);
  assert.equal(await chip(), base);
  await shot('4-file-draft');
  await key('Enter');
  await page.waitFor(`!document.querySelector('.ask-input').value`, 5000);
  reqs = requests(root);
  assert.equal(reqs.length, r1 + 1);
  const add = reqs.at(-1);
  assert.deepEqual([add.kind, add.text, add.assets, add.objects?.length ?? 0], ['ask', W.addFile, [g.file], 0], `${tag}: ${JSON.stringify(add)}`);
  if (g.dim === '3d') assert.ok(add.view?.eye && add.view?.target, `${tag}: 3D: where the camera looks, for placing it`);
  step(`file ${g.file}: draft “${W.addFile}” → Enter → ${add.id} (assets ${JSON.stringify(add.assets)})`);
  // Two files: the chip counts them. Phone: Multi-select, in the "+" next to the search (the second design review's ⑦; its
  // "Done" comes back next to it). PC: Shift + click — the bar has no Multi-select there (studio-library-shelf, 2026-10-23).
  const second = `.assets-page .gsl-tile[data-kind=file][data-path="${g.second}"]`;
  if (sz.touch) {
    await press('.assets-page [data-action=library-more]');
    await press('.assets-page [data-action=more-shelf-multi]');
    await press(second);
  } else {
    assert.equal(await page.eval(`[...document.querySelectorAll('.assets-page .shelf-multi')].some((b) => b.offsetParent)`), false, `${tag}: no Multi-select on PC`);
    await page.eval(`(() => { const t = document.querySelector(${JSON.stringify(second)}); t.scrollIntoView({ block: 'center' }); t.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })); return true; })()`);
    await sleep(400);
  }
  assert.equal(await chip(), W.files2, `${tag}: two files picked → "${W.files2}"`);
  assert.equal(await page.eval(`document.querySelectorAll('.assets-page .gsl-tile.gsl-open[data-kind=file]').length`), 2, `${tag}: both tiles marked as picked`);
  await shot('5-files-2');
  if (sz.touch) await press('.assets-page [data-action=shelf-multi]');
  step(`${sz.touch ? 'Multi-select' : 'Shift + click'}: two files → chip “${W.files2}”`);

  // 5. (PC) A tile dropped on the Scene row = Add to scene. (Built from DataTransfer in the page: the headless
  // browser has no drag of its own to send; the events and their data are the browser's.)
  if (!sz.touch) {
    await page.eval(`(() => { const dt = new DataTransfer(); const tile = document.querySelector('.assets-page .lib-object[data-key="${tileKey}"]');
      tile.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
      const row = document.querySelector('.nav-row[data-tool=placement]');
      row.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
      window.__dropOn = row.classList.contains('drop-on') && document.querySelector('.shell').dataset.drag === 'library';
      row.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
      tile.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt })); })()`);
    assert.equal(await page.eval('window.__dropOn'), true, `${tag}: the Scene row shows it takes the drop`);
    await page.waitFor(`studioShell.items().length === ${n0 + 1}`, 8000);
    assert.equal(await page.eval(`studioShell.items().find((i) => i.key === studioShell.selected())?.copyOf`), tileKey, `${tag}: the drop added a copy, picked`);
    assert.equal(await page.eval(`document.querySelector('.shell').dataset.view`), 'placement');
    await key('z', 2);
    await page.waitFor(`studioShell.items().length === ${n0}`, 5000);
    step('a tile dropped on the Scene row adds it (and ⌘Z takes it away)');
  }

  // 6. The Scene → the Library: the card's "Show in Library →".
  if (await libOn()) await press('.nav-row[data-tool=placement]');
  if (sz.touch && (await page.eval(`document.querySelector('.shell').dataset.sheet`)) !== 'open') await openSheet();
  // On a phone a short list sheet (Firefly Ruins: the game takes the top half) can have the row under the picked
  // object's card and the AI line at its foot (layout older than this test): then pick it through the shell.
  const rowOk = await pressable(`.objects .obj[data-key="${tileKey}"]`);
  if (rowOk) await press(`.objects .obj[data-key="${tileKey}"]`);
  else {
    step(`note: the list row of ${tileKey} is covered on this phone sheet; picked through studioShell`);
    await page.eval(`studioShell.actions.selectMany([${JSON.stringify(tileKey)}], ${JSON.stringify(tileKey)})`);
    await sleep(800);
  }
  assert.equal(await page.eval('studioShell.selected()'), tileKey);
  if (sz.touch) {
    // The phone's card folds its rows under "…".
    if (!(await page.eval(visible('.card [data-action=show-in-library]')))) await press('.card .fine > summary');
  }
  await page.waitFor(visible('.card [data-action=show-in-library]'), 5000);
  await shot('6-scene-card');
  const v1 = await view();
  await press('.card [data-action=show-in-library]');
  await sleep(400);
  assert.ok(await libOn(), `${tag}: the Library is open`);
  assert.equal(await page.eval(`document.querySelector('.assets-page .lib-object-detail') ? ${visible('.assets-page .lib-object-detail')} : false`), true, `${tag}: with the object's detail`);
  assert.equal(await page.eval(`document.querySelector('.assets-page .lib-object.gsl-open')?.dataset.key`), tileKey, `${tag}: its tile picked`);
  assert.equal(await view(), v1, `${tag}: the camera did not move`);
  assert.equal(await chip(), tileName, `${tag}: the chip names that object only (no files left from the last visit)`);
  await shot('7-scene-to-library');
  await press(`.lib-object-detail [data-action=open-asset][data-path="${tileFile}"]`);
  assert.equal(await page.eval(`document.querySelector('.assets-page .gsl-detail[data-kind=file] .gsl-path')?.textContent`), tileFile, `${tag}: its file's detail`);
  step(`Scene → card “Show in Library →” → ${tileKey}'s detail → its file ${tileFile}`);
  // ⌘K (PC) and the object's menu list the way too.
  await press('.nav-row[data-tool=placement]');
  if (sz.touch && (await page.eval(`document.querySelector('.shell').dataset.sheet`)) !== 'open') await openSheet();
  if (rowOk) await press(`.objects .obj[data-key="${tileKey}"]`);
  else await page.eval(`studioShell.actions.selectMany([${JSON.stringify(tileKey)}], ${JSON.stringify(tileKey)})`);
  if (!sz.touch) {
    await press('.foot-row[data-action=palette]');
    assert.ok(await page.eval(`!!document.querySelector('.palette [data-action=show-in-library]') && !!document.querySelector('.palette [data-action=show-file-in-library]')`), `${tag}: ⌘K lists Show in Library and its file`);
    await key('Escape');
  }
  if (!rowOk) {
    step('the menu check skipped (its row is covered, see the note)');
    await page.close();
    return;
  }
  if (sz.touch && (await page.eval(`document.querySelector('.shell').dataset.sheet`)) !== 'open') await openSheet();
  // The phone card's "…" (opened above) grows the card over the list: fold it first.
  if (sz.touch && (await page.eval(`!!document.querySelector('.card .fine[open]')`))) await press('.card .fine > summary');
  const r = await J(`(() => { const el = document.querySelector('.objects .obj[data-key="${tileKey}"]'); el.scrollIntoView({ block: 'center' }); const e = el.getBoundingClientRect(); return [e.left + 40, e.top + e.height / 2]; })()`);
  await sleep(300);
  if (sz.touch) {
    // A finger held still past UI.longPressMs (450; 900 as in studio-context-menu, for a loaded machine).
    await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: r[0], y: r[1], id: 1 }] });
    await sleep(900);
    await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r[0], y: r[1], button: 'right', clickCount: 1 });
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r[0], y: r[1], button: 'right', clickCount: 1 });
  }
  await sleep(400);
  if (!(await page.eval(`!document.querySelector('.ctx-menu').hidden`)) && process.env.STUDIO_DEBUG_SHOTS) writeFileSync(join(process.env.STUDIO_DEBUG_SHOTS, `${tag}-no-menu.png`), await page.screenshot());
  const menu = await J(`[...document.querySelectorAll('.ctx-menu:not([hidden]) .ctx-row')].map((e) => e.dataset.action.replace(/^ctx-/, ''))`);
  assert.ok(menu.includes('showInLibrary'), `${tag}: the object's menu has Show in Library (${JSON.stringify(menu)})`);
  // Its file is on the card ("Assets: planks.jpg") and in ⌘K; the menu keeps to 7 rows since design review 2 (②).
  assert.ok(!menu.includes('showFileInLibrary'), `${tag}: no "Show its asset in Library" row in the menu`);
  await key('Escape');
  step(`⌘K and the menu: ${JSON.stringify(menu.filter((m) => /Library/.test(m)))}`);
  await page.close();
}

async function runDemo() {
  const dir = join(mkdtempSync(join(tmpdir(), 'studio-library-use-demo-')), 'site');
  execFileSync(process.execPath, [join(PKG, 'scripts/build-web-demo.mjs'), '--out', dir], { stdio: 'ignore' });
  const host = await startHost({ dir });
  const b = await launch();
  try {
    for (const g of GAMES) {
      for (const sz of SIZES) {
        const tag = `demo-${g.id}-${sz.id}`;
        const page = await newPage(b, { width: sz.w, height: sz.h, mobile: sz.touch });
        const { shot, press, chip, openLibrary, step } = helpers(page, sz, tag);
        try {
          await page.goto(`${host.url}studio/?game=${g.id}&lang=${LANG}`);
          await page.waitFor(`document.querySelectorAll('.obj').length > 0 && !!document.querySelector('iframe').contentWindow.__gameStudio?._debug`, 60000);
          await sleep(1200);
          const n0 = await page.eval('studioShell.items().length');
          await openLibrary();
          await press('.assets-page .lib-object');
          assert.equal(await page.eval(`!!document.querySelector('.lib-object-detail [data-action=lib-ask]')`), false, `${tag}: no Ask your AI… without an AI`);
          await press('.lib-object-detail [data-action=add-to-scene]');
          await page.waitFor(`studioShell.items().length === ${n0 + 1}`, 8000);
          assert.equal(await page.eval(`document.querySelector('.shell').dataset.view`), 'placement', `${tag}: the Scene with the copy`);
          await openLibrary();
          await press(`.assets-page .gsl-tile[data-kind=file][data-path="${g.file}"]`);
          assert.equal(await page.eval(`document.querySelector('.assets-page .gsl-detail [data-action=file-add-to-scene]')?.disabled`), true, `${tag}: a file's Add to scene is dimmed`);
          assert.ok((await page.eval(`document.querySelector('.assets-page .gsl-use-why')?.textContent || ''`)).includes(W.why), `${tag}: and says why`);
          assert.equal(await page.eval(`!!document.querySelector('.assets-page .gsl-detail [data-action=file-ask]')`), false, `${tag}: no Ask your AI… on a file`);
          assert.equal(await chip(), '', `${tag}: no ask box (no chip) in the demo`);
          await shot('file');
          step('object added from the Library; a file\'s Add to scene dimmed with why; no AI rows');
        } catch (e) {
          failed++;
          console.log(`  ✗ ${tag}: ${e.message} (${(/studio-library-use\.browser\.mjs:(\d+)/.exec(e.stack || '') || [])[1] || '?'})`);
        } finally {
          await page.close();
        }
      }
    }
  } finally {
    await b.close();
    await host.close();
  }
}

try {
  if (!ONLY_DEMO) {
    for (const g of GAMES) {
      for (const sz of SIZES) {
        for (const theme of THEMES) {
          const tag = `${g.id}-${sz.id}-${theme}`;
          try {
            await runLocal(g, sz, theme);
            console.log(`✓ ${tag}`);
          } catch (e) {
            failed++;
            console.log(`  ✗ ${tag}: ${e.message} (${(/studio-library-use\.browser\.mjs:(\d+)/.exec(e.stack || '') || [])[1] || '?'})`);
          }
        }
      }
    }
  }
  if (DEMO) await runDemo();
} finally {
  watch?.abort();
  await browser?.close();
  await srv?.close();
  if (root) rmSync(root, { recursive: true, force: true });
}
if (failed) {
  console.log(`studio-library-use: ${failed} failed`);
  process.exit(1);
}
console.log('studio-library-use: all passed');
