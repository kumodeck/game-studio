// Pictures (and the numbers behind them) for the design review's wave 1 of the editor screen (2026-10-17):
// W1-1 the camera stays put when you pick, W1-2 the quiet tool strip, W1-3 Ideas / Editor view keep the game
// where it is, W1-4 ⌘K types into its list (never into the ask box), W1-11 the card's numbers and picture.
// No assertions (test/studio-w1.browser.mjs checks the same things); the same steps every time, so a "before"
// and an "after" run can be laid side by side for review.
//
//   node test/w1-shots.browser.mjs --shots <dir> [--only pc,side,phone] [--theme light|dark|both] [--lang en|ja]
//
// Lantern Cove (3D starter) at PC 1280×800 (mouse), the side window 400×900 and a phone 390×844 (touch, 2×).
// Every step writes `<layout>-<theme>-<nn>-<step>.png` and a line in numbers.json: the edit camera
// (`_debug.view()`), the lighthouse's box on screen, the tool strip's box, the game frame's box, the ask box's text.
// Needs the network for the starter's three.js (or STUDIO_CDN_CACHE).
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStudioServer } from '../src/server/server.mjs';
import { launch, newPage } from './adapters-2d/cdp.mjs';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const take = (flag, d) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : d;
};
const SHOTS = resolve(take('--shots', join(tmpdir(), 'studio-w1-shots')));
const ONLY = take('--only', 'pc,side,phone').split(',');
const THEME = take('--theme', 'both');
const THEMES = THEME === 'both' ? ['light', 'dark'] : [THEME];
const LANG = take('--lang', 'en');
mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LAYOUTS = {
  pc: { width: 1280, height: 800 },
  side: { width: 400, height: 900, mobile: true },
  phone: { width: 390, height: 844, mobile: true },
};
const DBG = `document.querySelector('iframe').contentWindow.__gameStudio?._debug`;
const PICK = 'lighthouse';
const numbers = [];

// Everything measured at once, in page pixels.
const MEASURE = `(() => {
  const f = document.querySelector('iframe'); const fr = f.getBoundingClientRect();
  const d = f.contentWindow.__gameStudio._debug;
  const a = d.anchor(${JSON.stringify(PICK)});
  const box = (r) => r && r.width ? { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) } : null;
  const ui = f.contentDocument.querySelector('[data-studio-ui]')?.shadowRoot;
  const strip = ui && [...ui.querySelectorAll('[data-studio-handle]')].map((b) => b.parentElement).find((p) => p && getComputedStyle(p).display !== 'none' && p.getBoundingClientRect().width);
  const sr = strip && strip.getBoundingClientRect();
  const r = a && (a.rect || { x: a.center[0] - a.size / 2, y: a.center[1] - a.size / 2, w: a.size, h: a.size });
  const ask = document.querySelector('.dock .ask-slot input');
  const card = document.querySelector('.inspector');
  return JSON.stringify({
    view: d.view(),
    pick: r ? { x: Math.round(fr.left + r.x), y: Math.round(fr.top + r.y), w: Math.round(r.w), h: Math.round(r.h) } : null,
    strip: sr && sr.width ? { x: Math.round(fr.left + sr.left), y: Math.round(fr.top + sr.top), w: Math.round(sr.width), h: Math.round(sr.height) } : null,
    frame: box(fr),
    ask: ask ? ask.value : null,
    palette: !!document.querySelector('#studio-palette:not([hidden])'),
    card: card && !card.hidden ? card.textContent.replace(/\\s+/g, ' ').trim().slice(0, 160) : null,
  });
})()`;

async function run(layout, theme) {
  const size = LAYOUTS[layout];
  const mobile = !!size.mobile;
  const root = mkdtempSync(join(tmpdir(), 'studio-w1-shots-'));
  cpSync(join(PKG, 'starters/lantern-cove'), root, { recursive: true });
  mkdirSync(join(root, '.studio/ui'), { recursive: true });
  writeFileSync(join(root, '.studio/ui/prefs.json'), JSON.stringify({ version: 1, lang: LANG, theme }));
  const srv = await startStudioServer({ root, uiDir: join(PKG, 'skills/arrange/bin/studio-ui'), log: () => {} });
  const browser = await launch();
  const page = await newPage(browser, { ...size, cdnCache: process.env.STUDIO_CDN_CACHE });
  let n = 0;
  const shot = async (name, wait = 700) => {
    await sleep(wait);
    const tag = `${layout}-${theme}-${String(++n).padStart(2, '0')}-${name}`;
    writeFileSync(join(SHOTS, `${tag}.png`), await page.screenshot());
    const m = JSON.parse(await page.eval(MEASURE));
    numbers.push({ shot: tag, ...m });
    console.log(`  ✓ ${tag}  pick ${JSON.stringify(m.pick)} strip ${JSON.stringify(m.strip)} frame ${JSON.stringify(m.frame)}`);
    return m;
  };
  const key = async (k, { ctrl = false, text } = {}) => {
    const code = k.length === 1 ? `Key${k.toUpperCase()}` : k;
    const base = { key: k, code, windowsVirtualKeyCode: k === 'Escape' ? 27 : k.toUpperCase().charCodeAt(0), modifiers: ctrl ? 2 : 0 };
    await page.send('Input.dispatchKeyEvent', { type: ctrl ? 'rawKeyDown' : 'keyDown', ...base, ...(text && !ctrl ? { text } : {}) });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  };
  const type = (text) => page.send('Input.insertText', { text });
  const press = (x, y) => (mobile ? page.tap(x, y) : page.click(x, y));
  const shell = (code) => page.eval(`(() => { const s = window.studioShell; ${code} })()`);
  try {
    await page.goto(srv.url);
    await page.waitFor(`document.querySelectorAll('.obj').length > 0 && !!${DBG}`, 90000);
    await sleep(1500);
    const open = await shot('open');
    // A real press on the lighthouse where it stands in the opening picture.
    const p = open.pick;
    await press(p.x + p.w / 2, p.y + p.h / 2);
    await shot('picked', 1400);
    // Another tool on the strip (T = turn; the phone presses the strip's turn button).
    if (mobile) {
      const b = JSON.parse(await page.eval(`(() => { const f = document.querySelector('iframe'); const b = f.contentDocument.querySelector('[data-studio-ui]').shadowRoot.querySelector('[data-studio-handle=rotate]');
        if (!b) return 'null'; const r = b.getBoundingClientRect(), o = f.getBoundingClientRect(); return JSON.stringify({ x: o.left + r.left + r.width / 2, y: o.top + r.top + r.height / 2 }); })()`));
      if (b) await page.tap(b.x, b.y);
    } else {
      await page.eval(`document.activeElement?.blur?.()`);
      await key('t', { text: 't' });
    }
    await shot('turn');
    if (mobile) {
      // The list sheet (the handle under the game), then the "…" list (the phone's ⌘K).
      await page.eval(`(() => { const b = [...document.querySelectorAll('[data-action=sheet]')].find((e) => e.offsetParent); b?.click(); return !!b; })()`);
      await shot('sheet', 900);
      await page.eval(`(() => { const b = [...document.querySelectorAll('[data-action=sheet]')].find((e) => e.offsetParent); b?.click(); })()`);
      await sleep(600);
      await page.eval(`(() => { const b = [...document.querySelectorAll('.sheet-more, [data-action=palette]')].find((e) => e.offsetParent); b?.click(); return !!b; })()`);
      await shot('more', 900);
      await key('Escape');
      await sleep(400);
    }
    // Ideas (the page of next steps), then Esc, then Editor view.
    await shell('s.actions.openNextSteps(); return true;');
    await shot('ideas', 900);
    await key('Escape');
    await shot('ideas-esc', 600);
    await shell('s.actions.openSettings(); return true;');
    await shot('editor-view', 900);
    if (!mobile) {
      // ⌘K while Editor view is open, then typing: the words must land in the ⌘K list's search, not the ask box.
      await key('k', { ctrl: true });
      await sleep(300);
      await type('Editor view');
      await shot('cmdk-typed', 600);
      await key('Escape');
      await key('Escape');
      await sleep(300);
      // The same pages with the list on the right.
      await shell(`s.setPrefs({ panel: 'right' }); return true;`);
      await sleep(600);
      await shell('s.actions.openNextSteps(); return true;');
      await shot('ideas-right', 900);
      await key('Escape');
      await shell(`s.setPrefs({ panel: 'left' }); return true;`);
    }
  } catch (e) {
    console.log(`  ✗ ${layout}-${theme}: ${e.message}`);
    console.log(page.logs.slice(-10).join('\n'));
  } finally {
    await page.close();
    await browser.close();
    await srv.close();
    rmSync(root, { recursive: true, force: true });
  }
}

for (const layout of Object.keys(LAYOUTS).filter((l) => ONLY.includes(l))) {
  for (const theme of THEMES) await run(layout, theme);
}
writeFileSync(join(SHOTS, 'numbers.json'), JSON.stringify(numbers, null, 1));
console.log(`shots in ${SHOTS}`);
