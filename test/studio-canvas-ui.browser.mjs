// The UI drawn in the canvas (studio-canvas-ui stage 1, 2026-10-24; CONTRACT.md §1.13). With the real server and the
// built editor, headless, dark, in Japanese and English, on examples/three-canvas-hud (a three.js runner whose score,
// health bar, round JUMP button and minimap are drawn in a 2D canvas over the world — no HTML UI):
//
//   0. before the rewrite: nothing to pick — since stage 2 the UI layer is there with nothing in its list (the HUD's
//      four parts are dotted frames "Not selectable yet"). Then the AI's rewrite (test/canvas-ui/game.js: drawHud()
//      through codeUi()) and `--do ui.code --id score,hp-bar,jump,minimap`: the check passes, the HUD's picture is the
//      same as before (the editor's held first frame, pixel by pixel), and the UI layer lists the four, top first
//   1. pick the score in the picture → the orange frame and the card (offset, size, text, colour, fill, samples);
//      999,999 drawn as a sample; the world darker around the four boxes only (the board's holes)        [one-1.png]
//   2. drag the health bar to the top middle: while held, the dotted place it was and "20 px from the top middle";
//      size 1.4 on the card; the file says code / from top / at; ⌘Z ×2 back, ⇧⌘Z ×2 again              [one-2.png]
//   3. the JUMP button: State Pressed, Fill #ff8fb1 → the game draws its pressed look pink                [one-3.png]
//   4. JUMP moved 300 px left, ▶ Play: a tap on its new place jumps, a tap on its old place does not
//   5. Save, then the AI's part: it writes the file's numbers into codeUi() and sends [ui.code, ui.set --clear] → the
//      file has no `ui`, and the picture is the same as before it wrote them
//
// Stage 2 (studio-canvas-ui-2, 2026-10-24: the UI not selectable yet, screens, samples):
//   missing  A. the example with score / bar / JUMP through codeUi and the minimap still plain: the minimap has a dotted
//               frame "Not selectable yet" (not in the list; `--do list` has it in `uiFound`); a press on it → the cross
//               and the line "This UI can't be selected yet · ✦ …"; ✦ → the draft and the chip "Here (bottom left)" with
//               the 240×160 picture in the box below (not sent); a press elsewhere then Esc → the line goes  [one-4.png]
//            B. the example as it is (nothing delivered): Scene | UI shows, the list says "No selectable UI yet", four
//               frames, a press → "This game draws its UI inside the picture"
//            C. examples/canvas-stars (one canvas for everything): no frames, no Scene | UI (as before)
//   screens  test/canvas-ui/screens (one canvas, two screens): the list's head offers Playing / Game over; choosing it
//            lists and draws that screen's UI while the game's own state stays; the bar's samples Full / Half / Empty;
//            a long sample widens the score's frame (its size is a function)
//
//   node test/studio-canvas-ui.browser.mjs [--only one|missing|screens] [--shots <dir>] [--lang ja,en]
// Exit 1 on failure.
import assert from 'node:assert/strict';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStudioServer } from '../src/server/server.mjs';
import { askEditor } from '../src/server/hands-cli.mjs';
import { launch, newPage } from './adapters-2d/cdp.mjs';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const SHOTS = opt('--shots') ? resolve(opt('--shots')) : null;
const LANGS = (opt('--lang') || 'ja,en').split(',');
const ONLY = opt('--only') ? opt('--only').split(',') : ['one', 'missing', 'screens'];
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WIN = `document.querySelector('iframe').contentWindow`;
const DBG = `${WIN}.__gameStudio._debug`;
const MOD = process.platform === 'darwin' ? 4 : 2;

let failed = 0;
const run = async (name, fn) => {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}: ${e.stack || e.message}`);
  }
};

/** One key press with modifiers (2 Ctrl, 4 Meta, 8 Shift) on the editor page. */
const key = async (page, k, modifiers = 0) => {
  const code = k.length === 1 ? `Key${k.toUpperCase()}` : k;
  const vk = k.length === 1 ? k.toUpperCase().charCodeAt(0) : { Enter: 13, Escape: 27 }[k] ?? 0;
  const base = { key: k, code, windowsVirtualKeyCode: vk, modifiers };
  await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base });
  if (k.length === 1 && !(modifiers & (2 | 4))) await page.send('Input.dispatchKeyEvent', { type: 'char', ...base, text: k });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  await sleep(200);
};
const mouse = (page, type, x, y) => page.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 });
/** A drag in steps (the editor's handles follow a real pointer). `hold`: stop before letting go. */
const drag = async (page, from, to, hold) => {
  await mouse(page, 'mousePressed', from.x, from.y);
  for (let i = 1; i <= 12; i++) {
    await mouse(page, 'mouseMoved', from.x + ((to.x - from.x) * i) / 12, from.y + ((to.y - from.y) * i) / 12);
    await sleep(30);
  }
  await sleep(250);
  if (hold) await hold();
  await mouse(page, 'mouseReleased', to.x, to.y);
  await sleep(350);
};
/** The game frame's place in the editor page. */
const frameBox = async (page) => JSON.parse(await page.eval(`JSON.stringify(document.querySelector('iframe').getBoundingClientRect())`));
/** A codeUi's box as the game draws it (CSS px of the game) and the canvas's size. */
const boxOf = async (page, id) => JSON.parse(await page.eval(`JSON.stringify(${WIN}[Symbol.for('game-studio.codeUis')].get('${id}').box())`));
/** The middle of a codeUi's box in the editor page. */
const middleOf = async (page, id) => {
  const f = await frameBox(page);
  const b = await boxOf(page, id);
  return { x: f.left + b.x + b.w / 2, y: f.top + b.y + b.h / 2 };
};
/** One pixel of the HUD canvas (game CSS px; the HUD's devicePixelRatio is 1 here). */
const hudPx = (page, x, y) => page.eval(`Array.from(${WIN}.document.getElementById('hud').getContext('2d').getImageData(${Math.round(x)}, ${Math.round(y)}, 1, 1).data).join(',')`);
/**
 * The HUD's picture, drawn once more after its pixels were read: reading a canvas (the editor's 40 px check does) moves
 * it to the browser's CPU drawing, whose edges are anti-aliased a little differently from the GPU's. Both pictures of a
 * comparison are taken this way, so only what is drawn where can differ.
 */
const hudPng = (page) => page.eval(`(() => { const c = ${WIN}.document.getElementById('hud'); const x = c.getContext('2d');
  for (let i = 0; i < 3; i++) x.getImageData(0, 0, c.width, c.height); ${WIN}.__gameStudio.core.time.step(); return c.toDataURL('image/png'); })()`);
/** How many HUD pixels differ (more than 24 in a channel) from a PNG taken before. */
const hudDiff = (page, png) => page.eval(`new Promise((ok) => { const img = new Image(); img.onload = () => { const c = ${WIN}.document.getElementById('hud');
  const o = document.createElement('canvas'); o.width = c.width; o.height = c.height; const x = o.getContext('2d'); x.drawImage(img, 0, 0);
  const a = x.getImageData(0, 0, c.width, c.height).data, b = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0;
  for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) > 24 || Math.abs(a[i + 1] - b[i + 1]) > 24 || Math.abs(a[i + 2] - b[i + 2]) > 24 || Math.abs(a[i + 3] - b[i + 3]) > 24) n++;
  ok(n); }; img.src = ${JSON.stringify(png)}; })`);
const PLAY_BTN = `(() => { const b = [...document.querySelectorAll('[data-action=play]')].find((x) => x.offsetParent && x.getBoundingClientRect().width); if (!b) return null; const r = b.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }); })()`;
/** ▶ Play / back to Edit with the top bar's button; with changes not saved, "Try without saving". */
const togglePlay = async (page) => {
  const b = JSON.parse((await page.eval(PLAY_BTN)) || 'null');
  if (b) await page.click(b.x, b.y);
  for (let i = 0; i < 10; i++) {
    await sleep(200);
    if (await page.eval(`!!document.querySelector('[data-part=unsaved-guard][data-kind=play]:not([hidden])')`)) {
      await page.eval(`document.querySelector('[data-part=unsaved-guard] [data-action=guard-discard]').click()`);
      break;
    }
  }
};
const rgb = (s) => s.split(',').slice(0, 3).map(Number);
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);
const colourNear = (px, hex, msg) => {
  const want = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const got = rgb(px);
  assert.ok(got.every((v, i) => Math.abs(v - want[i]) <= 40), `${msg}: ${px} vs ${hex}`);
};
const file = (root) => (existsSync(join(root, 'placement.json')) ? JSON.parse(readFileSync(join(root, 'placement.json'), 'utf8')) : null);

async function one(lang) {
  console.log(`${lang} dark`);
  const root = mkdtempSync(join(tmpdir(), 'studio-canvas-ui-'));
  cpSync(join(PKG, 'examples/three-canvas-hud'), root, { recursive: true });
  copyFileSync(join(PKG, 'skills/arrange/bin/studio-placement.js'), join(root, 'studio-placement.js'));
  mkdirSync(join(root, '.studio/ui'), { recursive: true });
  writeFileSync(join(root, '.studio/ui/prefs.json'), JSON.stringify({ version: 1, lang, theme: 'dark', seen: ['timeline-steps', 'open-line'] }));
  const srv = await startStudioServer({ root, uiDir: join(PKG, 'skills/arrange/bin/studio-ui'), log: () => {} });
  const browser = await launch();
  const ai = (ops) => askEditor({ origin: srv.origin, stopToken: srv.stopToken }, ops, 'claude');
  const J = lang === 'ja';
  try {
    const page = await newPage(browser, { width: 1280, height: 800, cdnCache: process.env.STUDIO_CDN_CACHE });
    await page.goto(srv.url);
    await page.waitFor(`!!${DBG} && studioShell.items().length > 0`, 45000);
    await sleep(2500);
    let before = null;

    await run('0. before the rewrite: nothing to pick (stage 2: Scene | UI, an empty list); the AI\'s rewrite + ui.code: checked, the same picture, the four listed top first', async () => {
      assert.equal(await page.eval(`(() => { const s = document.querySelector('[data-part=layer-switch]'); return !!s && !s.hidden; })()`), true, 'Scene | UI before the rewrite (stage 2: the HUD is seen, not selectable yet)');
      assert.equal(await page.eval(`JSON.stringify(${DBG}.layer())`), '"world"');
      before = await hudPng(page);
      copyFileSync(join(PKG, 'test/canvas-ui/game.js'), join(root, 'game.js'));
      const r = await ai([{ do: 'ui.code', id: 'score,hp-bar,jump,minimap' }]);
      assert.equal(r.results?.[0]?.ok, true, `ui.code: ${JSON.stringify(r)}`);
      assert.match(r.results[0].said, /picture follows it/);
      await page.waitFor(`${DBG}.layer() === 'ui' && studioShell.items().length === 4`, 10000);
      assert.equal(await page.eval(`studioShell.items().map((i) => i.key).join(' ')`), 'score hp-bar minimap jump');
      const n = await hudDiff(page, before);
      assert.ok(n < 40, `the HUD after the rewrite is the picture before it (${n} pixels differ)`);
      // The AI's sentence over the ask bar, in the person's words.
      const said = await page.eval(`document.body.innerText`);
      assert.ok(said.includes(J ? 'エディタで動かせるようにしました' : 'movable in the editor'), 'the line says what the AI did');
    });

    await run('1. pick the score: frame, card from look, a sample drawn, the world darker around the boxes', async () => {
      const m = await middleOf(page, 'score');
      await page.click(m.x - 60, m.y);
      await page.waitFor(`studioShell.selected() === 'score'`, 3000);
      await sleep(400);
      const card = JSON.parse(await page.eval(`(() => { const l = document.querySelector('[data-part=ui-look]'); const v = (p) => l.querySelector('[data-part=' + p + '] input, input[data-part=' + p + ']')?.value;
        return JSON.stringify({ text: v('ui-text'), size: v('ui-size'), color: v('color-text'), fill: v('background-text'), samples: [...l.querySelectorAll('[data-sample]')].map((b) => b.dataset.sample), tag: document.body.innerText.includes('UI') }); })()`));
      assert.deepEqual([card.text, card.size, card.color, card.fill], ['SCORE', '24', '#ffffff', 'rgba(10, 6, 24, 0.55)'], `the card's rows: ${JSON.stringify(card)}`);
      assert.deepEqual(card.samples, ['999,999', 'empty']);
      // The board: a hole for each of the four (the world is darker everywhere else).
      const holes = await page.eval(`(${WIN}.document.querySelector('svg[data-studio-ui-board] path')?.getAttribute('d') || '').split('M').length - 2`);
      assert.equal(holes, 4, 'four holes in the darkening board');
      const b = await boxOf(page, 'score');
      const plain = await hudPx(page, b.x + 150, b.y + 22);
      await page.eval(`document.querySelector('[data-sample="999,999"]').click()`);
      await sleep(400);
      assert.notEqual(await hudPx(page, b.x + 150, b.y + 22), plain, 'the sample is drawn in the game');
      if (SHOTS) writeFileSync(join(SHOTS, `one-1-${lang}.png`), await page.screenshot());
      await page.eval(`document.querySelector('[data-sample="999,999"]').click()`);
      await sleep(300);
    });

    await run('2. the health bar to the top middle (the line says from where), 1.4×; the file; ⌘Z ×2 and ⇧⌘Z ×2', async () => {
      const f = await frameBox(page);
      const b = await boxOf(page, 'hp-bar');
      const from = { x: f.left + b.x + b.w / 2, y: f.top + b.y + b.h / 2 };
      const to = { x: f.left + b.W / 2, y: f.top + 20 + b.h / 2 };
      // From the list: the score's strip sits right under the score, over the bar.
      await page.eval(`document.querySelector('li.obj[data-key="hp-bar"]').click()`);
      await page.waitFor(`studioShell.selected() === 'hp-bar'`, 3000);
      await sleep(300);
      let words = null;
      await drag(page, from, to, async () => {
        words = JSON.parse(await page.eval(`(() => { const l = ${WIN}.document.querySelector('svg[data-studio-ui-line]'); return JSON.stringify(l && { from: l.getAttribute('data-from'), words: l.getAttribute('data-words') }); })()`));
        if (SHOTS) writeFileSync(join(SHOTS, `one-2-${lang}.png`), await page.screenshot());
      });
      assert.ok(words, 'the line is drawn while dragging');
      assert.equal(words.from, 'top');
      assert.equal(words.words, J ? '上の真ん中から 20 px' : '20 px from the top centre');
      assert.equal(await page.eval(`!!${WIN}.document.querySelector('svg[data-studio-ui-line]')`), false, 'gone when let go');
      const moved = await boxOf(page, 'hp-bar');
      near(moved.x + moved.w / 2, b.W / 2, 2, 'in the middle');
      near(moved.y, 20, 2, '20 px from the top');
      // 1.4× on the card's Size.
      await page.eval(`(() => { const i = document.querySelector('input[aria-label="×"]'); i.focus(); i.value = '1.4'; i.dispatchEvent(new Event('change')); i.blur(); })()`);
      await sleep(500);
      const big = await boxOf(page, 'hp-bar');
      near(big.w, b.w * 1.4, 1, '1.4 times as wide');
      near(big.x + big.w / 2, b.W / 2, 2, 'still in the middle');
      await sleep(1200);
      const e = file(root)?.ui?.['hp-bar'];
      assert.ok(e, `the draft has ui["hp-bar"]: ${JSON.stringify(file(root))}`);
      assert.deepEqual([e.code, e.from, e.s], ['hp-bar', 'top', 1.4], JSON.stringify(e));
      near(e.at[0], 0, 1, 'at x from the top middle');
      near(e.at[1], 20 - (b.h * 0.4) / 2, 1, 'at y from the top (the middle stays where it was)');
      await key(page, 'z', MOD);
      near((await boxOf(page, 'hp-bar')).w, b.w, 1, '⌘Z: the size back');
      await key(page, 'z', MOD);
      const back = await boxOf(page, 'hp-bar');
      assert.deepEqual([Math.round(back.x), Math.round(back.y)], [Math.round(b.x), Math.round(b.y)], '⌘Z: back where the code draws it');
      await key(page, 'z', MOD | 8);
      await key(page, 'z', MOD | 8);
      const again = await boxOf(page, 'hp-bar');
      near(again.w, b.w * 1.4, 1, '⇧⌘Z ×2: big again');
      near(again.x + again.w / 2, b.W / 2, 2, '⇧⌘Z ×2: in the middle again');
    });

    await run('3. JUMP: State Pressed, Fill pink — the game draws its pressed look pink', async () => {
      const m = await middleOf(page, 'jump');
      await page.eval(`studioShell.actions.select(null)`);
      await sleep(200);
      await page.click(m.x, m.y);
      await page.waitFor(`studioShell.selected() === 'jump'`, 3000);
      await sleep(400);
      const f = await frameBox(page);
      const cx = m.x - f.left, cy = m.y - f.top;
      colourNear(await hudPx(page, cx - 20, cy - 20), '#56e3f5', 'normal');
      await page.eval(`document.querySelector('[data-part=ui-state] [data-state=active]').click()`);
      await sleep(400);
      colourNear(await hudPx(page, cx - 20, cy - 20), '#2fb8d0', 'shown pressed');
      await page.eval(`(() => { const i = document.querySelector('[data-part="@active.background-text"]') || document.querySelector('input[data-part="@active.background-text"]'); i.focus(); i.value = '#ff8fb1'; i.dispatchEvent(new Event('change')); i.blur(); })()`);
      await sleep(500);
      colourNear(await hudPx(page, cx - 20, cy - 20), '#ff8fb1', 'pressed, pink');
      if (SHOTS) writeFileSync(join(SHOTS, `one-3-${lang}.png`), await page.screenshot());
      await page.eval(`document.querySelector('[data-part=ui-state] [data-state=normal]').click()`);
      await sleep(300);
      colourNear(await hudPx(page, cx - 20, cy - 20), '#56e3f5', 'normal again');
    });

    let oldJump = null, newJump = null;
    await run('4. JUMP moved 300 px left: in ▶ Play a tap on its new place jumps, on its old place does not', async () => {
      oldJump = await middleOf(page, 'jump');
      newJump = { x: oldJump.x - 300, y: oldJump.y };
      await drag(page, oldJump, newJump);
      const moved = await middleOf(page, 'jump');
      near(moved.x, newJump.x, 3, 'moved');
      await page.eval(`studioShell.actions.select(null)`);
      await togglePlay(page);
      await page.waitFor(`${WIN}.__gameStudio._play?.playing?.() === true`, 15000);
      await sleep(1200);
      const y = async () => JSON.parse(await page.eval(`JSON.stringify(${WIN}.__gameStudio._play.list().find((i) => i.key === 'player')?.pose?.p ?? null)`))?.[1];
      const y0 = await y();
      await page.click(oldJump.x, oldJump.y);
      await sleep(150);
      near(await y(), y0, 0.05, 'a tap where it was: no jump');
      await sleep(600);
      await page.click(newJump.x, newJump.y);
      await sleep(150);
      assert.ok((await y()) > y0 + 0.3, 'a tap on its new place: it jumps');
      await togglePlay(page);
      await page.waitFor(`!!${DBG} && studioShell.items().length > 0`, 15000);
      await sleep(800);
    });

    await run('5. Save; the AI writes the numbers into codeUi() and sends [ui.code, ui.set --clear]: no `ui` in the file, the same picture', async () => {
      await page.eval(`studioShell.actions.save()`);
      await sleep(1500);
      const saved = file(root);
      assert.ok(saved?.ui?.['hp-bar'] && saved.ui.jump, `saved: ${JSON.stringify(saved?.ui)}`);
      // Where each one is now (the game's own state — the score, the hexagons — ran on in ▶ Play and starts again when
      // the page is read again, so the boxes are compared, and the pressed colour the code now has).
      const boxes = {};
      for (const id of ['score', 'hp-bar', 'jump', 'minimap']) boxes[id] = await boxOf(page, id);
      // The AI's write-back (as SKILL.md says): `at` / `scale` from the file, the pressed fill into `states`.
      let code = readFileSync(join(root, 'game.js'), 'utf8');
      const hp = saved.ui['hp-bar'], jp = saved.ui.jump;
      code = code.replace(`at: { from: 'top-left', x: 16, y: 60 }, size: [214, 20],`, `at: { from: '${hp.from}', x: ${hp.at[0]}, y: ${hp.at[1]} }, size: [214, 20], scale: ${hp.s ?? 1},`);
      code = code.replace(`at: { from: 'bottom-right', x: 24, y: 24 }, size: 72,`, `at: { from: '${jp.from}', x: ${jp.at[0]}, y: ${jp.at[1]} }, size: 72,`);
      code = code.replace(`active: { background: '#2fb8d0' }`, `active: { background: '${jp.set['@active'].background}' }`);
      writeFileSync(join(root, 'game.js'), code);
      const r = await ai([{ do: 'ui.code', id: 'hp-bar,jump' }, { do: 'ui.set', id: 'hp-bar', clear: true }, { do: 'ui.set', id: 'jump', clear: true }]);
      assert.ok(r.results?.every((x) => x.ok), `the AI's write-back: ${JSON.stringify(r)}`);
      await sleep(1500);
      const after = file(root);
      assert.equal(after.ui, undefined, `no ui left: ${JSON.stringify(after.ui)}`);
      for (const id of Object.keys(boxes)) {
        const b = await boxOf(page, id);
        for (const k of ['x', 'y', 'w', 'h']) near(b[k], boxes[id][k], 0.6, `${id}.${k} the same after the AI wrote it`);
      }
      assert.equal(await page.eval(`${WIN}[Symbol.for('game-studio.codeUis')].get('jump').lookNow('active').background`), '#ff8fb1', 'the pressed fill is the code\'s now');
      assert.equal(await page.eval(`JSON.stringify(${WIN}[Symbol.for('game-studio.codeUis')].get('hp-bar').live)`), JSON.stringify({ p: [0, 0], s: 1, state: null, sample: null }), 'nothing of the editor\'s over the code');
      const dirty = await page.eval(`document.querySelector('[data-part=save]')?.innerText ?? ''`);
      assert.ok(!/·\s*\d/.test(dirty), `nothing to save after the write-back: ${dirty}`);
    });
  } finally {
    await browser.close();
    srv.close();
    rmSync(root, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------- stage 2
const FOUND = `${WIN}.document.querySelector('game-studio-found')?.shadowRoot`;
/** The dotted frames drawn in the game page now (viewport px of the game) and their tags' words. */
const framesOf = async (page) => JSON.parse(await page.eval(`(() => { const r = ${FOUND}; if (!r) return '[]';
  return JSON.stringify([...r.querySelectorAll('.f')].map((f) => { const b = f.getBoundingClientRect(); const t = r.querySelector('[data-found-tag="' + f.dataset.found + '"]');
    return { x: b.left, y: b.top, w: b.width, h: b.height, on: f.classList.contains('on'), tag: t ? t.textContent : null }; })); })()`));
const crossOn = (page) => page.eval(`!!${FOUND}?.querySelector('[data-found-cross]')`);
const lineText = (page) => page.eval(`(() => { const l = document.querySelector('[data-part=ui-missing]'); return l && !l.hidden ? l.innerText.replace(/\\s+/g, ' ').trim() : null; })()`);
const layerSwitch = (page) => page.eval(`(() => { const s = document.querySelector('[data-part=layer-switch]'); return !!s && !s.hidden && s.offsetParent !== null; })()`);
const toUi = async (page) => {
  await page.eval(`document.querySelector('[data-part=layer-switch] [data-layer=ui]').click()`);
  await page.waitFor(`${DBG}.layer() === 'ui'`, 5000);
  await sleep(700);
};
/** A game folder from an example (and maybe another game.js), served, with the editor open on it. */
async function open(lang, example, gameJs, transform) {
  const root = mkdtempSync(join(tmpdir(), 'studio-canvas-ui-2-'));
  cpSync(join(PKG, example), root, { recursive: true });
  copyFileSync(join(PKG, 'skills/arrange/bin/studio-placement.js'), join(root, 'studio-placement.js'));
  if (gameJs) {
    let code = readFileSync(join(PKG, gameJs), 'utf8');
    if (transform) code = transform(code);
    writeFileSync(join(root, 'game.js'), code);
  }
  mkdirSync(join(root, '.studio/ui'), { recursive: true });
  writeFileSync(join(root, '.studio/ui/prefs.json'), JSON.stringify({ version: 1, lang, theme: 'dark', seen: ['timeline-steps', 'open-line'] }));
  const srv = await startStudioServer({ root, uiDir: join(PKG, 'skills/arrange/bin/studio-ui'), log: () => {} });
  const browser = await launch();
  const page = await newPage(browser, { width: 1280, height: 800, cdnCache: process.env.STUDIO_CDN_CACHE });
  await page.goto(srv.url);
  const ai = (ops) => askEditor({ origin: srv.origin, stopToken: srv.stopToken }, ops, 'claude');
  const close = async () => {
    await browser.close();
    srv.close();
    rmSync(root, { recursive: true, force: true });
  };
  return { root, srv, page, ai, close };
}

async function missing(lang) {
  console.log(`${lang} dark — not selectable yet`);
  const J = lang === 'ja';
  const TAG = J ? 'まだ選べません' : 'Not selectable yet';
  // A. Score, bar and JUMP delivered; the minimap still drawn with its numbers in the code (bottom left, 100 × 120).
  {
    const g = await open(lang, 'examples/three-canvas-hud', 'test/canvas-ui/game.js', (code) => {
      const a = code.replace(/^const mapUi = codeUi\('minimap'.*\n/m, '').replace('b = mapUi.box();\n  const mx = b.x, my = b.y, s = b.s;', 'const mx = 16, my = h - 16 - 120, s = 1;');
      assert.ok(!a.includes('mapUi'), 'the minimap is plain again');
      return a;
    });
    const { page } = g;
    try {
      await page.waitFor(`!!${DBG} && studioShell.items().length > 0`, 45000);
      await sleep(2000);
      await run('A1. Scene | UI; on the UI layer three listed, the minimap a dotted frame (not listed); `list` says uiFound', async () => {
        assert.equal(await layerSwitch(page), true, 'Scene | UI');
        await toUi(page);
        assert.equal(await page.eval(`studioShell.items().map((i) => i.key).join(' ')`), 'score hp-bar jump');
        const fr = await framesOf(page);
        assert.equal(fr.length, 1, `one frame: ${JSON.stringify(fr)}`);
        const H = await page.eval(`${WIN}.innerHeight`);
        // The minimap: 16 px from the left, 16 px from the bottom, 100 × 120 (the frame 5 px round it, a cell's rounding).
        near(fr[0].x + 5, 16, 6, 'frame left');
        near(fr[0].y + fr[0].h - 5, H - 16, 6, 'frame bottom');
        near(fr[0].w - 10, 100, 10, 'frame width');
        near(fr[0].h - 10, 120, 10, 'frame height');
        assert.equal(fr[0].tag, TAG);
        const listed = await page.eval(`document.querySelector('.objects')?.innerText ?? ''`);
        assert.ok(!listed.includes(TAG), 'the list does not show it');
        const l = await g.ai([{ do: 'list' }]);
        const uf = l.results?.[0]?.list?.uiFound;
        assert.ok(Array.isArray(uf) && uf.length === 1 && uf[0].from === 'hud-canvas', `uiFound: ${JSON.stringify(uf)}`);
        // An AI job of `list` alone only reads: the person stays on the UI layer.
        assert.equal(await page.eval(`${DBG}.layer()`), 'ui', 'still on the UI layer after `list`');
      });
      await run('A2. a press on the minimap: the cross, its frame lit, the line with ✦', async () => {
        const f = await frameBox(page);
        const fr = (await framesOf(page))[0];
        const at = { x: f.left + fr.x + fr.w / 2 - 10, y: f.top + fr.y + fr.h / 2 + 10 };
        await page.click(at.x, at.y);
        await sleep(500);
        assert.equal(await crossOn(page), true, 'the cross');
        assert.equal((await framesOf(page))[0].on, true, 'the pressed frame lit');
        const text = await lineText(page);
        assert.ok(text && text.includes(J ? 'ここの UI はまだ選べません' : 'This UI can’t be selected yet'), `the line: ${text}`);
        assert.ok(text.includes(J ? 'この UI を編集できるようにしてもらう' : 'to make this UI editable'), `the ✦: ${text}`);
        assert.equal(await page.eval(`studioShell.selected()`), null, 'nothing picked');
        if (SHOTS) writeFileSync(join(SHOTS, `one-4-${lang}.png`), await page.screenshot());
      });
      await run('A3. ✦: the draft and the chip "Here (bottom left)" with the picture in the box below — not sent; the line and the cross go', async () => {
        const before = readdirOf(join(g.root, '.studio/requests')).length;
        await page.eval(`document.querySelector('[data-action=ui-missing-ask]').click()`);
        await sleep(500);
        assert.equal(await lineText(page), null, 'the line went');
        assert.equal(await crossOn(page), false, 'the cross went');
        const box = JSON.parse(await page.eval(`(() => { const a = document.querySelector('[data-part=ask]'); const c = a.querySelector('.ask-chip:not([hidden])'); const img = c?.querySelector('img');
          return JSON.stringify({ value: a.querySelector('.ask-input').value, chip: c ? c.textContent : null, src: img ? img.src.slice(0, 22) : null, w: img?.naturalWidth, h: img?.naturalHeight, focus: document.activeElement === a.querySelector('.ask-input') }); })()`));
        assert.equal(box.value, J ? 'この UI を編集できるようにして' : 'Make this UI editable');
        assert.equal(box.chip, J ? '左下のここ' : 'Here (bottom left)');
        assert.equal(box.src, 'data:image/jpeg;base64');
        assert.deepEqual([box.w, box.h], [240, 160], 'the picture is 240 × 160');
        assert.equal(box.focus, true, 'the cursor in the box');
        await sleep(400);
        assert.equal(readdirOf(join(g.root, '.studio/requests')).length, before, 'nothing sent');
        if (SHOTS) writeFileSync(join(SHOTS, `one-4b-${lang}.png`), await page.screenshot());
      });
      await run('A4. the request it would send: intent ui-code, the place, the frames, the picture (sent here by the test)', async () => {
        await page.eval(`document.querySelector('[data-part=ask] .ask-send').click()`);
        await sleep(1200);
        const reqs = readdirOf(join(g.root, '.studio/requests')).filter((n) => n.includes('-ask-'));
        assert.equal(reqs.length, 1, `one ask: ${reqs}`);
        const r = JSON.parse(readFileSync(join(g.root, '.studio/requests', reqs[0]), 'utf8'));
        assert.equal(r.intent, 'ui-code');
        assert.equal(r.layer, 'ui');
        assert.ok(Array.isArray(r.pressed) && r.pressed.length === 2, `pressed: ${r.pressed}`);
        assert.equal(r.found?.length, 1);
        assert.match(r.shot, /^\.studio\/play\/.*-ask-[0-9a-f]{4}\.jpg$/);
        assert.ok(existsSync(join(g.root, r.shot)), 'the picture is a file');
      });
      await run('A5. a press beside every box, then Esc: the line and the cross go', async () => {
        const f = await frameBox(page);
        await page.click(f.left + 640, f.top + 300);
        await sleep(400);
        assert.ok(await lineText(page), 'the line');
        await key(page, 'Escape');
        await sleep(300);
        assert.equal(await lineText(page), null, 'Esc: the line went');
        assert.equal(await crossOn(page), false, 'Esc: the cross went');
      });
    } finally {
      await g.close();
    }
  }
  // B. Nothing delivered (the example as it is).
  {
    const g = await open(lang, 'examples/three-canvas-hud');
    const { page } = g;
    try {
      await page.waitFor(`!!${DBG} && studioShell.items().length > 0`, 45000);
      await sleep(2000);
      await run('B. nothing delivered: Scene | UI, the list "No selectable UI yet", four frames, a press says the UI is in the picture', async () => {
        assert.equal(await layerSwitch(page), true, 'Scene | UI');
        await toUi(page);
        assert.equal(await page.eval(`studioShell.items().length`), 0);
        assert.equal(await page.eval(`document.querySelector('[data-part=ui-empty]')?.textContent ?? null`), J ? '選べる UI はまだありません' : 'No selectable UI yet');
        const fr = await framesOf(page);
        assert.equal(fr.length, 4, `four frames: ${JSON.stringify(fr)}`);
        const f = await frameBox(page);
        await page.click(f.left + fr[0].x + fr[0].w / 2, f.top + fr[0].y + fr[0].h / 2);
        await sleep(500);
        const text = await lineText(page);
        assert.ok(text && text.includes(J ? 'このゲームの UI は、ゲームの絵の中に描かれています' : 'This game draws its UI inside the picture'), `the line: ${text}`);
        if (SHOTS) writeFileSync(join(SHOTS, `none-${lang}.png`), await page.screenshot());
      });
    } finally {
      await g.close();
    }
  }
  // C. One canvas for everything.
  {
    const g = await open(lang, 'examples/canvas-stars');
    const { page } = g;
    try {
      await page.waitFor(`!!${DBG} && studioShell.items().length > 0`, 45000);
      await sleep(2000);
      await run('C. one canvas (canvas-stars): no Scene | UI, no frames — as before', async () => {
        assert.equal(await layerSwitch(page), false, 'no Scene | UI');
        assert.equal(await page.eval(`${DBG}.layer()`), 'world');
        assert.equal(await page.eval(`!!${WIN}.document.querySelector('game-studio-found')`), false, 'no frames');
      });
    } finally {
      await g.close();
    }
  }
}

async function screens(lang) {
  console.log(`${lang} dark — screens and samples`);
  const J = lang === 'ja';
  const g = await open(lang, 'test/canvas-ui/screens');
  const { page } = g;
  const W = `${WIN}`;
  try {
    await page.waitFor(`!!${DBG} && studioShell.items().length > 0`, 45000);
    await sleep(1500);
    await run('S1. the list\'s head: Playing ⌄ 1 / 2; the play screen listed', async () => {
      assert.equal(await page.eval(`studioShell.items().map((i) => i.key).join(' ')`), 'score hp');
      const head = await page.eval(`document.querySelector('[data-part=screen-switch]')?.innerText.replace(/\\s+/g, ' ').trim() ?? null`);
      assert.ok(head && head.includes(J ? 'プレイ中' : 'Playing') && head.includes('2'), `head: ${head}`);
      assert.equal(await page.eval(`${W}.studio.screen()`), 'play');
    });
    await run('S2. Game over chosen: its UI listed and drawn; the game\'s own state stays', async () => {
      await page.eval(`document.querySelector('[data-part=screen-switch]').click()`);
      await sleep(300);
      const row = await page.eval(`(() => { const r = [...document.querySelectorAll('.ctx-row')].find((x) => x.dataset.id === 'screen:over' || /${J ? 'ゲームオーバー' : 'Game over'}/i.test(x.textContent)); if (!r) return false; r.click(); return true; })()`);
      assert.equal(row, true, 'the Game over row');
      await page.waitFor(`studioShell.items().map((i) => i.key).join(' ') === 'over-title retry'`, 4000);
      await sleep(400);
      assert.equal(await page.eval(`${W}.studio.screen()`), 'over');
      assert.equal(await page.eval(`JSON.stringify(${W}.game)`), JSON.stringify({ score: 4200, hp: 6, screen: 'play' }), 'the game\'s state is untouched');
      const b = JSON.parse(await page.eval(`JSON.stringify(${W}[Symbol.for('game-studio.codeUis')].get('retry').box())`));
      const px = await page.eval(`Array.from(${W}.document.getElementById('hud').getContext('2d').getImageData(${Math.round(b.x + 8)}, ${Math.round(b.y + 8)}, 1, 1).data).join(',')`);
      colourNear(px, '#ffd166', 'RETRY drawn');
      if (SHOTS) writeFileSync(join(SHOTS, `screens-over-${lang}.png`), await page.screenshot());
      await page.eval(`document.querySelector('[data-part=screen-switch]').click()`);
      await sleep(300);
      await page.eval(`[...document.querySelectorAll('.ctx-row')].find((x) => x.dataset.id === 'screen:play' || /${J ? 'プレイ中' : 'Playing'}/.test(x.textContent))?.click()`);
      await page.waitFor(`studioShell.items().map((i) => i.key).join(' ') === 'score hp'`, 4000);
    });
    await run('S3. the bar\'s samples Full / Half / Empty draw it full, half, empty', async () => {
      await page.eval(`document.querySelector('li.obj[data-key="hp"]').click()`);
      await page.waitFor(`studioShell.selected() === 'hp'`, 3000);
      await sleep(300);
      const words = await page.eval(`[...document.querySelectorAll('[data-sample]')].map((b) => b.textContent).join(' ')`);
      assert.equal(words, J ? '満タン 半分 空' : 'Full Half Empty');
      const b = JSON.parse(await page.eval(`JSON.stringify(${W}[Symbol.for('game-studio.codeUis')].get('hp').box())`));
      const at = (f) => page.eval(`Array.from(${W}.document.getElementById('hud').getContext('2d').getImageData(${Math.round(b.x + b.w * f)}, ${Math.round(b.y + b.h / 2)}, 1, 1).data).join(',')`);
      for (const [v, inside, outside] of [['1', 0.95, null], ['0.5', 0.4, 0.6], ['0', null, 0.05]]) {
        await page.eval(`document.querySelector('[data-sample="${v}"]').click()`);
        await page.waitFor(`document.querySelector('[data-sample="${v}"]')?.getAttribute('aria-pressed') === 'true'`, 3000);
        await sleep(400);
        if (inside !== null) colourNear(await at(inside), '#3ddc84', `${v}: filled at ${inside}`);
        if (outside !== null) colourNear(await at(outside), '#39404f', `${v}: empty at ${outside}`);
        await page.eval(`document.querySelector('[data-sample="${v}"]').click()`);
        await sleep(200);
      }
    });
    await run('S4. a long sample: the score\'s frame follows its text (size is a function)', async () => {
      await page.eval(`document.querySelector('li.obj[data-key="score"]').click()`);
      await page.waitFor(`studioShell.selected() === 'score'`, 3000);
      await sleep(300);
      const w0 = JSON.parse(await page.eval(`JSON.stringify(${DBG}.anchor('score').rect)`)).w;
      // A score's samples are numbers (999,999 · Empty); a long one is typed in "Your own…".
      await page.eval(`(() => { const i = document.querySelector('input[data-part=ui-sample-own]'); i.focus(); i.value = '999,999,999,999'; i.dispatchEvent(new Event('change')); i.blur(); })()`);
      await sleep(600);
      const w1 = JSON.parse(await page.eval(`JSON.stringify(${DBG}.anchor('score').rect)`)).w;
      assert.ok(w1 > w0 + 40, `the frame grew with the text: ${w0} → ${w1}`);
      if (SHOTS) writeFileSync(join(SHOTS, `screens-long-${lang}.png`), await page.screenshot());
    });
  } finally {
    await g.close();
  }
}

const readdirOf = (dir) => (existsSync(dir) ? readdirSync(dir) : []);

for (const lang of LANGS) {
  if (ONLY.includes('one')) await one(lang);
  if (ONLY.includes('missing')) await missing(lang);
  if (ONLY.includes('screens')) await screens(lang);
}
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
