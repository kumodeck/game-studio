// Plan step 7 "the one line when it opens, and the side window's sheet" (2026-10-23), in a headless browser: the real
// local server, the built editor, test/neon-run and the stand-in AI (test/ai-feel/fake-agent.mjs), in the side window
// next to a chat (420×860, a mouse) and on a phone (390×844, touch).
//
//   1 open    nothing picked: one line under the game says what this is ("Shape your game by hand. Your AI writes the
//             code.") — not a step-by-step tour, one line
//   2 pick    the gate picked: the line is gone, and stays gone for this game (a reload does not bring it back)
//   3 sheet   ONE sheet at the foot: [Scene | gate | Motion] tabs, the card in it, the ask row at its foot with the AI's
//             presence as a dot inside the field — not four blocks stacked (reply / "● Claude is watching" / card / field)
//   4 fold    the grip folds the sheet to the ask row alone
//   5 reply   asked: the AI's reply is over the game (not in the stack at the foot), and fades after a few seconds
//   6 back    focusing the field brings the reply back
//
//   node test/studio-open-side.browser.mjs [--only side,phone] [--lang en|ja] [--theme dark|light] [--shots <dir>]
//                                          [--prefix after] [--ui <studio-ui dir>] [--before]
// --before: photos only (no checks), for the build before this change (--ui <that build's studio-ui>).
// Photos: <shots>/07-<prefix>-<device>-<lang>-<theme>-<n>-<name>.png.
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStudioServer } from '../src/server/server.mjs';
import { launch, newPage } from './adapters-2d/cdp.mjs';
import { startFakeAgent } from './ai-feel/fake-agent.mjs';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const take = (f, d = null) => (args.includes(f) ? args[args.indexOf(f) + 1] : d);
const ONLY = take('--only') ? take('--only').split(',') : null;
const SHOTS = take('--shots') ? resolve(take('--shots')) : null;
const PREFIX = take('--prefix', 'after');
const LANG = take('--lang', 'en') === 'ja' ? 'ja' : 'en';
const THEME = take('--theme', 'dark') === 'light' ? 'light' : 'dark';
const UI = resolve(take('--ui', join(PKG, 'skills/arrange/bin/studio-ui')));
const BEFORE = args.includes('--before');
const ja = LANG === 'ja';
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failed = 0;
const check = (ok, what) => {
  if (BEFORE) return;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failed++;
};

const DEVICES = [
  { id: 'side', width: 420, height: 860, mobile: false },
  { id: 'phone', width: 390, height: 844, mobile: true },
].filter((d) => !ONLY || ONLY.includes(d.id));

const FR = `document.querySelector('iframe')`;
const DBG = `${FR}.contentWindow.__gameStudio?._debug`;
const EDIT_READY = `document.querySelectorAll('.obj').length > 0 && !!${DBG}`;
// What is on screen at the foot: the separate blocks a person sees stacked there (each a box of its own, drawn, in the
// lower half), the one line, the reply and where it is.
const FOOT = `JSON.stringify((() => {
  const H = innerHeight;
  const shown = (e) => { if (!e || e.hidden) return false; const s = getComputedStyle(e); if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity < 0.05) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.top < H && r.bottom > 0; };
  const box = (e) => { const r = e.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) }; };
  const parts = { caption: document.querySelector('.ai-caption'), presenceRow: document.querySelector('.presence-row'), card: document.querySelector('.card-slot > .card'), bar: document.querySelector('.bar'), side: document.querySelector('.side') };
  const stacked = Object.entries(parts).filter(([, e]) => shown(e) && e.getBoundingClientRect().top > H / 2).map(([k]) => k);
  const intro = document.querySelector('[data-part=intro-line]');
  const line = document.querySelector('.ai-line');
  const cap = parts.caption;
  const stage = document.querySelector('iframe').getBoundingClientRect();
  const sheet = parts.side;
  const tabs = [...document.querySelectorAll('[data-part=sheet-tabs] [role=tab]')].filter((b) => b.offsetParent);
  const dot = document.querySelector('.ask-box .presence-dot, .ask-slot .presence');
  return { stacked, intro: shown(intro) ? intro.innerText.trim() : '', introBox: shown(intro) ? box(intro) : null,
    reply: shown(line) && line.innerText.trim() ? line.innerText.replace(/\\s+/g, ' ').trim() : '', replyBox: shown(cap) ? box(cap) : null,
    sheetBox: shown(sheet) ? box(sheet) : null, barBox: shown(parts.bar) ? box(parts.bar) : null, stage: { top: Math.round(stage.top), bottom: Math.round(stage.bottom) },
    tabs: tabs.map((b) => ({ text: b.innerText.trim(), on: b.getAttribute('aria-selected') === 'true', h: Math.round(b.getBoundingClientRect().height) })),
    dotInField: !!dot && shown(dot) && !!dot.closest('.bar'), fold: document.querySelector('.shell').dataset.fold || '' };
})())`;

function gameFolder() {
  const root = mkdtempSync(join(tmpdir(), 'open-side-'));
  cpSync(join(PKG, 'test/neon-run'), root, { recursive: true });
  for (const f of ['placement.json', '.studio/requests', '.studio/status.json', '.studio/watch.json']) rmSync(join(root, f), { recursive: true, force: true });
  if (!existsSync(join(root, 'studio-placement.js'))) copyFileSync(join(UI, '../studio-placement.js'), join(root, 'studio-placement.js'));
  mkdirSync(join(root, '.studio/ui'), { recursive: true });
  writeFileSync(join(root, '.studio/ui/prefs.json'), JSON.stringify({ version: 1, lang: LANG, theme: THEME }));
  return root;
}

const browser = await launch();
try {
  for (const dev of DEVICES) {
    console.log(`${dev.id} ${dev.width}×${dev.height} (${LANG}, ${THEME})`);
    const root = gameFolder();
    const srv = await startStudioServer({ root, uiDir: UI, log: () => {}, env: { CLAUDECODE: '1' } });
    const agent = startFakeAgent(root);
    const page = await newPage(browser, { width: dev.width, height: dev.height, mobile: dev.mobile });
    const j = async (e) => JSON.parse((await page.eval(e)) || 'null');
    const until = async (expr, ms) => {
      const t0 = Date.now();
      for (;;) {
        if (await page.eval(expr).catch(() => false)) return true;
        if (Date.now() - t0 > ms) return false;
        await sleep(200);
      }
    };
    const shot = async (n, name) => {
      if (!SHOTS) return;
      await sleep(350);
      writeFileSync(join(SHOTS, `07-${PREFIX}-${dev.id}-${LANG}-${THEME}-${n}-${name}.png`), await page.screenshot());
    };
    const at = (sel) => j(`JSON.stringify((() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.offsetParent); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })())`);
    const press = async (sel) => {
      const p = await at(sel);
      if (p) await (dev.mobile ? page.tap(p.x, p.y) : page.click(p.x, p.y));
      await sleep(500);
      return !!p;
    };
    try {
      await page.goto(srv.url);
      await page.waitFor(EDIT_READY, 90000);
      await until(`document.querySelector('.presence')?.dataset.state === 'watching'`, 30000);
      await sleep(2000);

      // 1 open
      let f = await j(FOOT);
      await shot(1, 'open');
      const LINE = ja ? 'ゲームを手で直す場所。コードは、いつもの AI が書く。' : 'Shape your game by hand. Your AI writes the code.';
      check(f.intro === LINE, `open: the one line ("${f.intro}")`);
      check(!!f.introBox && !!f.barBox && f.introBox.bottom <= f.barBox.top + 1, 'open: the line sits over the ask row (under the game)');

      // 2 pick the gate (the list's own action: the same as a click on it in the game)
      await page.eval(`studioShell.actions.select('gate')`);
      await sleep(900);
      f = await j(FOOT);
      await shot(2, 'pick');
      check(!f.intro, 'pick: the one line is gone');

      // 3 one sheet
      // No motion on the gate yet: no Motion tab (making one is the strip's Motion, the one way in).
      check(f.tabs.length === 2 && f.tabs[0].text === (ja ? 'シーン' : 'Scene'), `sheet: Scene | gate, no Motion tab without a motion ${JSON.stringify(f.tabs.map((x) => x.text))}`);
      check(f.tabs.some((x) => x.on && /gate/.test(x.text)), 'sheet: the picked object\'s tab is on');
      check(f.tabs.every((x) => x.h >= (dev.mobile ? 44 : 30)), `sheet: tabs ${dev.mobile ? '≥ 44' : '≥ 30 (a mouse)'} tall ${JSON.stringify(f.tabs.map((x) => x.h))}`);
      check(f.dotInField, 'sheet: the presence is a dot in the ask row');
      check(!f.stacked.includes('presenceRow') && !(f.stacked.includes('caption') && f.replyBox && f.sheetBox && f.replyBox.top >= f.sheetBox.top), `sheet: no presence line, no reply stacked at the foot ${JSON.stringify(f.stacked)}`);
      // Scene tab: the list, not the card; the list keeps its rows (the sheet is not the whole window).
      await press('[data-part=sheet-tabs] [data-tab=scene]');
      f = await j(FOOT);
      const rows = await page.eval(`[...document.querySelectorAll('.side .obj')].filter((e) => { const r = e.getBoundingClientRect(); return e.offsetParent && r.height > 0 && r.top > 0 && r.bottom < innerHeight; }).length`);
      await shot(3, 'tab-scene');
      check(f.tabs.some((x) => x.on && x.text === (ja ? 'シーン' : 'Scene')) && !f.stacked.includes('card'), `scene tab: the list, no card ${JSON.stringify(f.stacked)}`);
      check(rows >= 4 && !!f.sheetBox && f.sheetBox.top > f.stage.top + 100, `scene tab: the list shows rows (${rows}) and the game stays above it (sheet top ${f.sheetBox?.top})`);
      // A motion on the gate (what the strip's Motion → Make a motion does): the Motion tab comes, and is on.
      await page.eval(`(window.__studioTimeline.make('gate'), true)`);
      await sleep(900);
      f = await j(FOOT);
      await shot(3, 'tab-motion');
      check(f.tabs.length === 3 && f.tabs[2].on && f.tabs[2].text === (ja ? '動き' : 'Motion'), `motion: the Motion tab, on ${JSON.stringify(f.tabs)}`);
      check(!f.stacked.includes('card') && !f.stacked.includes('side'), `motion tab: no card, no list under the timeline ${JSON.stringify(f.stacked)}`);
      await press('[data-part=sheet-tabs] [data-tab=pick]');
      f = await j(FOOT);
      await shot(3, 'sheet');
      check(f.stacked.includes('card') && !(await page.eval(`window.__studioTimeline.isOpen()`)), `pick tab: the card again, the timeline put away ${JSON.stringify(f.stacked)}`);

      // 4 fold
      await press('[data-action=sheet-grip]');
      await sleep(400);
      f = await j(FOOT);
      await shot(4, 'fold');
      check(f.fold === 'min', 'fold: the grip folds the sheet');
      await press('[data-action=sheet]');
      await sleep(400);

      // 5 ask the AI: the reply over the game, then it fades
      const input = await at('.ask-input');
      if (input) {
        await page.eval(`(document.querySelector('.ask-input').focus(), true)`);
        await page.send('Input.insertText', { text: ja ? 'ゲートを少し大きく' : 'Make the gate a little bigger' });
        await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
        await page.send('Input.dispatchKeyEvent', { type: 'char', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
        await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
        await page.eval(`(document.activeElement?.blur?.(), true)`);
      }
      await until(`(() => { const l = document.querySelector('.ai-line'); return !!l && !l.hidden && /${ja ? 'できました|入れました|しました' : 'Made the change|Done|done|Added|added|In the game'}/.test(l.innerText); })()`, 25000);
      await sleep(300);
      f = await j(FOOT);
      await shot(5, 'reply');
      check(!!f.reply, `reply: shown ("${f.reply}")`);
      check(!!f.replyBox && f.replyBox.bottom <= (f.sheetBox ? f.sheetBox.top : f.barBox.top) + 1, `reply: over the game, not in the stack at the foot ${JSON.stringify({ reply: f.replyBox, sheet: f.sheetBox, bar: f.barBox })}`);
      const faded = await until(`(() => { const c = document.querySelector('.ai-caption'); return !c || c.hidden || +getComputedStyle(c).opacity < 0.05 || getComputedStyle(c).display === 'none'; })()`, 20000);
      await shot(5, 'reply-faded');
      check(faded, 'reply: fades by itself');

      // 6 the field brings it back
      await page.eval(`(document.querySelector('.ask-input')?.focus(), true)`);
      await sleep(600);
      f = await j(FOOT);
      await shot(6, 'reply-back');
      check(!!f.reply, 'back: focusing the field brings the reply back');
      await page.eval(`(document.activeElement?.blur?.(), true)`);

      // 2' the line stays gone for this game: a reload, nothing picked
      await page.eval(`(studioShell.actions.select(null), true)`).catch(() => {});
      await page.goto(srv.url);
      await page.waitFor(EDIT_READY, 90000);
      await sleep(1500);
      f = await j(FOOT);
      check(!f.intro, 'reload: the one line does not come back for this game');
    } finally {
      await agent?.stop();
      await page.close?.();
      await srv.close?.();
    }
  }
} finally {
  browser.close();
}
if (failed) {
  console.log(`${failed} failed`);
  process.exit(1);
}
console.log(BEFORE ? 'photos taken' : 'all ok');
