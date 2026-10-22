// UI stages 2–3 (studio-ui-edit-2, 2026-10-22): screens, a UI element's text and colours, a button's states, sample
// values and the theme — with the real server and the built editor, on examples/three-hud (Glow Garden: four screens
// marked data-studio-screen, the score's number data-studio-value, the colours as CSS variables, buttons with
// :hover / :active / :disabled). Every check runs at every size (PC 1280×800, the side window 400×900, a phone
// 390×844) in the light and the dark theme:
//   1. the UI list's head names the screen shown — "Title ⌄ 1 of 4" — and lists the title's elements
//   2. its menu shows Game over: the game shows that screen (the others hidden, its code not run), the list is its
//      elements, the head says "Game over 4 of 4"; a press in the game picks an element of that screen
//   3. the result's card: Text = its heading; a new text shows in the game; ⌘Z puts it back, ⇧⌘Z again
//   4. the score's Sample 999,999: the game's number shows it; the note says it is not saved
//   5. Title again; the Start button's State: Hover shows the page's :hover look (its fill), a Fill typed in Hover
//      changes the hovered look only; Normal and Disabled look as the page's CSS says
//   6. Theme under the list: the game's variables (glow, ink…); --glow changed → the Start button's fill follows
//   7. Save → placement.json: ui['result-card'] { p [0, 0], screen 'over', set.text, setWas.text }, the Start
//      button's '@hover' fill with its was, theme['--glow'] { v, was }; no sample anywhere
//   8. ▶ Play (the same page): the game as its code makes it — the title screen, its own score, no shown state —
//      with the saved look (the theme) kept
//   9. the game opened WITHOUT the editor (a plain static server): the heading's new text, the theme's colour and
//      the hover rule are there (the loader, studio-placement.js)
//  10. the editor opened again: nothing unsaved, the heading's text given back to the page
//
//   node test/studio-ui-edit-2.browser.mjs [--shots <dir>] [--only pc,side,phone] [--themes light,dark] [--lang en|ja]
// --shots writes after-<size>-<theme>-<what>.png (screens, text, sample, state, theme) and, from the game alone,
// after-<size>-<theme>-plain.png. Exit 1 on failure.
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStudioServer } from '../src/server/server.mjs';
import { launch, newPage } from './adapters-2d/cdp.mjs';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, d) => (args.includes(name) ? args[args.indexOf(name) + 1] : d);
const SHOTS = opt('--shots') ? resolve(opt('--shots')) : null;
const LANG = opt('--lang', 'en');
const THEMES = opt('--themes', 'light,dark').split(',');
const SIZES = [
  { id: 'pc', width: 1280, height: 800 },
  { id: 'side', width: 400, height: 900 },
  { id: 'phone', width: 390, height: 844, mobile: true },
].filter((s) => !opt('--only') || opt('--only').split(',').includes(s.id));
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WIN = `document.querySelector('iframe').contentWindow`;
const GDOC = `${WIN}.document`;
const DBG = `${WIN}.__gameStudio._debug`;
const W = LANG === 'ja'
  ? { title: 'タイトル', over: 'ゲームオーバー', of: (n, t) => `${n} / ${t}`, note: '保存しない', theme: 'テーマ' }
  : { title: 'Title', over: 'Game over', of: (n, t) => `${n} of ${t}`, note: 'Never saved', theme: 'Theme' };

let failed = 0;
const cleanups = [];
const staticServer = (root) => new Promise((ok) => {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png' };
  const s = createServer((req, res) => {
    const p = join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!p.startsWith(root) || !existsSync(p)) return res.writeHead(404).end();
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' }).end(readFileSync(p));
  });
  s.listen(0, '127.0.0.1', () => {
    cleanups.push(() => new Promise((r) => s.close(r)));
    ok(`http://127.0.0.1:${s.address().port}`);
  });
});
const J = async (page, expr) => JSON.parse(await page.eval(`JSON.stringify(${expr})`));
/** Click an element of the editor page by selector (JS click: the same handler a press runs). */
const press = (page, sel) => page.eval(`(() => { const b = document.querySelector(${JSON.stringify(sel)}); if (!b) throw new Error('no ' + ${JSON.stringify(sel)}); b.click(); return true; })()`);
/** Type into a field of the card (value + change, as leaving the field does). */
const typeIn = (page, sel, v) => page.eval(`(() => { const i = document.querySelector(${JSON.stringify(sel)}); if (!i) throw new Error('no ' + ${JSON.stringify(sel)}); i.focus(); i.value = ${JSON.stringify(v)}; i.dispatchEvent(new Event('change', { bubbles: true })); i.blur(); return true; })()`);
const gameStyle = (k, prop, inner = '') => `${WIN}.getComputedStyle(${GDOC}.querySelector('[data-studio-key="${k}"]${inner}'))${prop}`;
const head = (page) => page.eval(`document.querySelector('[data-part=screen-switch]')?.textContent || ''`);
const keys = (page) => page.eval(`studioShell.items().map((i) => i.key).join(' ')`);
/** The card's look rows open: on the phone and the side window they sit in "…" with the numbers. */
const openFine = (page) => page.eval(`(() => { const f = document.querySelector('.card details.fine'); if (f && !f.open) f.open = true; return !!f; })()`);
const lookFor = (page, k) => page.waitFor(`document.querySelector('[data-part=ui-look][data-key="${k}"]:not([hidden])')`, 5000);

async function run(size, theme) {
  const root = mkdtempSync(join(tmpdir(), 'studio-ui-edit-2-'));
  cpSync(join(PKG, 'examples/three-hud'), root, { recursive: true });
  rmSync(join(root, 'placement.json'), { force: true });
  mkdirSync(join(root, '.studio/ui'), { recursive: true });
  writeFileSync(join(root, '.studio/ui/prefs.json'), JSON.stringify({ version: 1, lang: LANG, theme }));
  const srv = await startStudioServer({ root, uiDir: join(PKG, 'skills/arrange/bin/studio-ui'), log: () => {} });
  const browser = await launch();
  cleanups.push(async () => rmSync(root, { recursive: true, force: true }), () => srv.close(), () => browser.close());
  const shot = async (page, what) => SHOTS && writeFileSync(join(SHOTS, `after-${size.id}-${theme}-${what}.png`), await page.screenshot());
  const page = await newPage(browser, { width: size.width, height: size.height, mobile: !!size.mobile });
  await page.goto(`${srv.url}&lang=${LANG}`);
  await page.waitFor(`!!${WIN}.__gameStudio?._debug && studioShell.items().length > 0`, 45000);
  await sleep(1200);

  // 1. The UI layer: the head names the screen shown.
  await press(page, '[data-part=layer-switch] [data-layer=ui]');
  await page.waitFor(`${DBG}.layer() === 'ui' && studioShell.items().length === 3`, 8000);
  await page.waitFor(`!!document.querySelector('[data-part=screen-switch]')`, 5000);
  assert.equal(await head(page), `${W.title}${W.of(1, 4)}`, 'the head says the title screen, 1 of 4');
  assert.equal(await keys(page), 'score title-card start-button');

  // 2. Game over from the head's menu.
  await press(page, '[data-part=screen-switch]');
  await page.waitFor(`!!document.querySelector('.ctx-menu:not([hidden]) [data-action="ctx-screen:over"]')`, 3000);
  assert.deepEqual(await J(page, `[...document.querySelectorAll('.ctx-menu .ctx-row')].map((b) => b.textContent.replace('✓', '').trim())`),
    LANG === 'ja' ? ['タイトル', 'プレイ中', 'ポーズ', 'ゲームオーバー'] : ['Title', 'Playing', 'Paused', 'Game over']);
  await press(page, '.ctx-menu [data-action="ctx-screen:over"]');
  await page.waitFor(`studioShell.items().some((i) => i.key === 'result-card')`, 5000);
  assert.equal(await keys(page), 'score result-card again-button', 'the list is the game-over screen (and the score, always on)');
  assert.equal(await head(page), `${W.over}${W.of(4, 4)}`);
  const shown = await J(page, `Object.fromEntries([...${GDOC}.querySelectorAll('[data-studio-screen]')].map((e) => [e.dataset.studioScreen, ${WIN}.getComputedStyle(e).display]))`);
  assert.deepEqual(shown, { title: 'none', play: 'none', pause: 'none', over: 'grid' }, `only the game-over screen is drawn, with its own display: ${JSON.stringify(shown)}`);
  assert.equal(await page.eval(`${GDOC}.getElementById('over-screen').hasAttribute('hidden')`), false);
  // A press in the game picks an element of that screen (the heading's panel).
  const box = await J(page, `(() => { const f = document.querySelector('iframe').getBoundingClientRect(); const r = ${GDOC}.querySelector('[data-studio-key="result-card"] h2').getBoundingClientRect();
    return { x: f.left + r.left + r.width / 2, y: f.top + r.top + r.height / 2 }; })()`);
  if (size.mobile) await page.tap(box.x, box.y);
  else await page.click(box.x, box.y);
  await page.waitFor(`studioShell.selected() === 'result-card'`, 4000);
  await shot(page, 'screens');

  // 3. The heading's text.
  await openFine(page);
  await lookFor(page, 'result-card');
  assert.equal(await page.eval(`document.querySelector('[data-part=ui-text]').value`), 'The garden glows');
  await typeIn(page, '[data-part=ui-text]', 'Garden lit!');
  await page.waitFor(`${GDOC}.querySelector('#over-screen h2').textContent === 'Garden lit!'`, 3000);
  await page.waitFor(`!!document.querySelector('[data-part=ui-look] [data-action=ui-back]')`, 3000);
  await page.eval(`studioShell.actions.undo()`);
  await page.waitFor(`${GDOC}.querySelector('#over-screen h2').textContent === 'The garden glows'`, 3000);
  await page.eval(`studioShell.actions.redo()`);
  await page.waitFor(`${GDOC}.querySelector('#over-screen h2').textContent === 'Garden lit!'`, 3000);
  await sleep(300);
  await openFine(page);
  await shot(page, 'text');

  // 4. A sample in the score.
  await page.eval(`studioShell.actions.select('score')`);
  await openFine(page);
  await lookFor(page, 'score');
  await page.waitFor(`!!document.querySelector('[data-part=ui-look] [data-sample="999,999"]')`, 3000);
  await press(page, '[data-part=ui-look] [data-sample="999,999"]');
  await page.waitFor(`${GDOC}.getElementById('score').textContent === '999,999'`, 3000);
  await page.waitFor(`document.querySelector('[data-part=ui-look] [data-sample="999,999"]')?.getAttribute('aria-pressed') === 'true'`, 3000);
  assert.match(await page.eval(`document.querySelector('[data-part=ui-sample-note]').textContent`), new RegExp(W.note, 'i'));
  // The score's word is its Text (data-studio-text), never the number.
  assert.equal(await page.eval(`document.querySelector('[data-part=ui-text]').value`), 'Glow');
  await openFine(page);
  await shot(page, 'sample');

  // 5. The Start button's states, on the title screen.
  await press(page, '[data-part=screen-switch]');
  await page.waitFor(`!!document.querySelector('.ctx-menu:not([hidden]) [data-action="ctx-screen:title"]')`, 3000);
  await press(page, '.ctx-menu [data-action="ctx-screen:title"]');
  await page.waitFor(`studioShell.items().some((i) => i.key === 'start-button')`, 5000);
  await page.eval(`studioShell.actions.select('start-button')`);
  await openFine(page);
  await lookFor(page, 'start-button');
  await page.waitFor(`!!document.querySelector('[data-part=ui-state] [data-state=hover]')`, 3000);
  const bg = () => page.eval(gameStyle('start-button', '.backgroundColor'));
  assert.equal(await bg(), 'rgb(255, 207, 110)', 'normal: --glow');
  await press(page, '[data-part=ui-state] [data-state=hover]');
  await page.waitFor(`${GDOC}.querySelector('[data-studio-key="start-button"]').dataset.studioState === 'hover'`, 3000);
  await page.waitFor(`${gameStyle('start-button', '.backgroundColor')} === 'rgb(255, 224, 143)'`, 3000);
  await page.waitFor(`document.querySelector('[data-part="@hover.background-text"] input, input[data-part="@hover.background-text"]')?.value === '#ffe08f'`, 3000);
  await typeIn(page, 'input[data-part="@hover.background-text"]', '#ff8fb1');
  await page.waitFor(`${gameStyle('start-button', '.backgroundColor')} === 'rgb(255, 143, 177)'`, 3000);
  await openFine(page);
  await shot(page, 'state');
  await press(page, '[data-part=ui-state] [data-state=normal]');
  await page.waitFor(`!${GDOC}.querySelector('[data-studio-key="start-button"]').dataset.studioState`, 3000);
  await page.waitFor(`${gameStyle('start-button', '.backgroundColor')} === 'rgb(255, 207, 110)'`, 3000);
  await press(page, '[data-part=ui-state] [data-state=disabled]');
  await page.waitFor(`${gameStyle('start-button', '.backgroundColor')} === 'rgb(107, 98, 80)'`, 3000);
  assert.equal(await page.eval(`${GDOC}.querySelector('[data-studio-key="start-button"]').disabled`), false, 'never really disabled (it must stay draggable)');
  await press(page, '[data-part=ui-state] [data-state=normal]');
  await page.waitFor(`${gameStyle('start-button', '.backgroundColor')} === 'rgb(255, 207, 110)'`, 3000);

  // 6. The theme.
  if (size.id !== 'pc') await page.eval(`document.querySelector('[data-action=sheet]')?.click()`);
  await page.waitFor(`!!document.querySelector('[data-part=ui-theme-head]')`, 5000);
  assert.match(await page.eval(`document.querySelector('[data-part=ui-theme-head]').textContent`), new RegExp(`${W.theme}\\s*8`));
  await press(page, '[data-part=ui-theme-head]');
  await page.waitFor(`!document.querySelector('[data-part=ui-theme-rows]').hidden`, 3000);
  const names = await J(page, `[...document.querySelectorAll('[data-part=theme-row]')].map((r) => r.dataset.name)`);
  assert.deepEqual(names, ['--glow', '--glow-hover', '--glow-pressed', '--ink', '--ink-dark', '--panel', '--font-display', '--font-ui']);
  await typeIn(page, '[data-part=theme-row][data-name="--glow"] input[data-part=theme-text]', '#7fd1ff');
  await page.waitFor(`${gameStyle('start-button', '.backgroundColor')} === 'rgb(127, 209, 255)'`, 3000);
  await sleep(300);
  await shot(page, 'theme');
  if (size.id !== 'pc') await page.eval(`document.querySelector('[data-action=sheet]')?.click()`);

  // 7. Save.
  await page.eval(`studioShell.actions.save()`);
  let saved = null;
  for (let i = 0; i < 40 && !saved?.theme; i++) {
    await sleep(250);
    try {
      saved = JSON.parse(readFileSync(join(root, 'placement.json'), 'utf8'));
    } catch {
      /* not yet */
    }
  }
  assert.ok(saved, 'placement.json written');
  const rc = saved.ui['result-card'];
  assert.deepEqual({ p: rc.p, screen: rc.screen, set: rc.set, setWas: rc.setWas }, { p: [0, 0], screen: 'over', set: { text: 'Garden lit!' }, setWas: { text: 'The garden glows' } });
  assert.match(rc.label, /^The garden glows/, 'its words, for the AI to find it');
  assert.deepEqual(saved.ui['start-button'].set, { '@hover': { background: '#ff8fb1' } });
  assert.deepEqual(saved.ui['start-button'].setWas, { '@hover': { background: '#ffe08f' } });
  assert.equal(saved.ui['start-button'].screen, 'title');
  assert.deepEqual(saved.theme, { '--glow': { v: '#7fd1ff', was: '#ffcf6e' } });
  assert.equal('score' in saved.ui, false, 'a sample is not a change');
  assert.ok(!readFileSync(join(root, 'placement.json'), 'utf8').includes('999,999'), 'no sample anywhere in the file');
  assert.deepEqual(saved.objects, {});

  // 8. ▶ Play in the same page: the game's own screen and score, no shown state; the theme stays.
  await page.eval(`[...document.querySelectorAll('[data-action=play]')].find((x) => x.offsetParent && x.getBoundingClientRect().width)?.click()`);
  await page.waitFor(`document.querySelector('.shell').dataset.playing === 'on'`, 15000);
  await sleep(800);
  const play = await J(page, `({ title: ${WIN}.getComputedStyle(${GDOC}.getElementById('title-screen')).display, over: ${GDOC}.getElementById('over-screen').hidden,
    overStyle: ${GDOC}.getElementById('over-screen').getAttribute('style'), score: ${GDOC}.getElementById('score').textContent,
    state: ${GDOC}.querySelector('[data-studio-key="start-button"]').dataset.studioState ?? null, bg: ${gameStyle('start-button', '.backgroundColor')} })`);
  assert.deepEqual(play, { title: 'block', over: true, overStyle: null, score: '0', state: null, bg: 'rgb(127, 209, 255)' }, `Play: ${JSON.stringify(play)}`);
  await page.eval(`[...document.querySelectorAll('[data-action=play]')].find((x) => x.offsetParent && x.getBoundingClientRect().width)?.click()`);
  await page.waitFor(`document.querySelector('.shell').dataset.playing !== 'on' && !!${WIN}.__gameStudio?._debug`, 15000);

  // 9. The game alone.
  const url = await staticServer(root);
  const plain = await newPage(browser, { width: size.width, height: size.height, mobile: !!size.mobile });
  await plain.goto(`${url}/index.html`);
  await plain.waitFor(`!!document.getElementById('studio-ui-set')`, 30000);
  const alone = await J(plain, `({ h2: document.querySelector('#over-screen h2').textContent, glow: document.documentElement.style.getPropertyValue('--glow'),
    bg: getComputedStyle(document.querySelector('.start')).backgroundColor, sheet: document.getElementById('studio-ui-set').textContent })`);
  assert.equal(alone.h2, 'Garden lit!');
  assert.equal(alone.glow, '#7fd1ff');
  assert.equal(alone.bg, 'rgb(127, 209, 255)');
  assert.match(alone.sheet, /\[data-studio-key="start-button"\]:hover\{background-color:#ff8fb1!important\}/);
  if (SHOTS) writeFileSync(join(SHOTS, `after-${size.id}-${theme}-plain.png`), await plain.screenshot());
  await plain.close();

  // 10. The editor again: nothing unsaved, the page given the looks.
  await page.goto(`${srv.url}&lang=${LANG}`);
  await page.waitFor(`!!${WIN}.__gameStudio?._debug && studioShell.items().length > 0`, 45000);
  await sleep(1500);
  assert.equal(await page.eval(`${GDOC}.querySelector('#over-screen h2').textContent`), 'Garden lit!');
  assert.equal(await page.eval(`[...document.querySelectorAll('[data-part=save]')].every((b) => b.hidden || !b.offsetParent)`), true, 'nothing unsaved after reopening');
}

try {
  for (const size of SIZES) for (const theme of THEMES) {
    const name = `${size.id} ${size.width}×${size.height} ${theme}`;
    try {
      await run(size, theme);
      console.log(`  ✓ ${name}`);
    } catch (e) {
      failed++;
      console.log(`  ✗ ${name}: ${e.stack || e.message}`);
    } finally {
      for (const c of cleanups.splice(0).reverse()) await c().catch(() => {});
    }
  }
} finally {
  for (const c of cleanups.splice(0).reverse()) await c().catch(() => {});
}
console.log(failed ? `studio-ui-edit-2: ${failed} failed` : 'studio-ui-edit-2: ok');
process.exit(failed ? 1 : 0);
