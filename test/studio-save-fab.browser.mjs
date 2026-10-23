// The one Save and the card's minimize. History: a try of the editor, 2026-10-20 — "people won't notice they have to press
// Save — show a Save button in the game view once something changed, bottom right, in a colour that stands out" and
// "the card gets in the way while working: a minimize button" — put Save in the game's corner (save-fab). On 2026-10-21
// a second orange Save came beside ▶ Play, and a try of it asked "why are there two buttons that do the same thing?":
// now there is ONE Save, beside ▶ Play (main.ts topSave), and nothing in the game's corner. (The file keeps its name:
// other notes and team tools point here.)
// Per layout (PC 1280×800 with a mouse, the chat app's side window 400×900 with a mouse, a phone 390×844 with touch)
// and theme (dark, light), on Lantern Cove (3D: the camera ↑↓ sit in the game's bottom-right corner):
//   0-open     nothing changed: no Save
//   1-changed  one object moved (the card's X field): "Save · 1" beside ▶ Play, whole on screen, the only Save, no
//              Save over the game
//   2-min      the card minimized: one line (its name); another pick keeps it minimized; a reload too (this browser)
//   3-saved    the Save pressed with a real click / tap: placement.json written, "✓ Saved" for a moment, then gone
//
//   node test/studio-save-fab.browser.mjs [--shots <dir>] [--tag before|after] [--only pc,side,phone]
//     [--theme dark|light|both] [--lang ja|en] [--before]
// --before: an old build: photos and numbers only, no assertions.
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
const BEFORE = args.includes('--before');
const SHOTS = opt('--shots') ? resolve(opt('--shots')) : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const TAG = opt('--tag') || (BEFORE ? 'before' : 'after');
const THEMES = (opt('--theme') || 'both') === 'both' ? ['dark', 'light'] : [opt('--theme')];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LAYOUTS = [
  { id: 'pc', width: 1280, height: 800, mobile: false, dpr: 1 },
  { id: 'side', width: 400, height: 900, mobile: false, dpr: 2 },
  { id: 'phone', width: 390, height: 844, mobile: true, dpr: 2 },
].filter((l) => !opt('--only') || opt('--only').split(',').includes(l.id));

const GAME = `document.querySelector('iframe').contentWindow`;
const READY = `document.querySelectorAll('.obj, .noname').length > 0 && !!${GAME}.__gameStudio?._debug`;
// The one Save (beside ▶ Play since 2026-10-21; [data-part=save-fab] in the game's corner before).
const FAB = `document.querySelector('[data-part=save]')`;
// Boxes on screen (page coordinates): the Save, and what is around it. The camera ↑↓ live in the game frame's own
// shadow root, so their box is moved by the frame's place.
const BOXES = `(() => {
  const r = (e) => { if (!e || !e.offsetParent && getComputedStyle(e).position !== 'fixed' || e.hidden) return null; const b = e.getBoundingClientRect(); return b.width && b.height ? { l: Math.round(b.left), t: Math.round(b.top), r: Math.round(b.right), b: Math.round(b.bottom) } : null; };
  const fr = document.querySelector('iframe').getBoundingClientRect();
  let cam = null;
  try {
    for (const host of ${GAME}.document.querySelectorAll('[data-studio-ui]')) {
      const c = host.shadowRoot?.querySelector('.cam');
      if (!c || getComputedStyle(c).display === 'none') continue;
      const b = c.getBoundingClientRect();
      if (b.width) cam = { l: Math.round(fr.left + b.left), t: Math.round(fr.top + b.top), r: Math.round(fr.left + b.right), b: Math.round(fr.top + b.bottom) };
    }
  } catch {}
  const fab = ${FAB};
  return JSON.stringify({
    fab: fab && !fab.hidden && fab.offsetParent ? r(fab) : null, fabText: fab && !fab.hidden ? fab.innerText.replace(/\\s+/g, ' ').trim() : '',
    cam, bar: r(document.querySelector('.dock .bar')), caption: r(document.querySelector('.ai-caption:not([hidden])')),
    card: r(document.querySelector('.inspector > .card:not([hidden]), .card-slot > .card:not([hidden])')),
    sheet: document.querySelector('.shell').dataset.layout === 'phone' && document.querySelector('.shell').dataset.sheet === 'open' ? r(document.querySelector('.side')) : null,
    game: r(document.querySelector('iframe')), W: innerWidth, H: innerHeight,
    // Every Save press on screen (v0.1.9 had two: the corner one and "Save to game" beside Play).
    saves: [...document.querySelectorAll('[data-action=save], [data-action=save-top], [data-part=save-fab]')].filter((e) => !e.hidden && e.offsetParent && e.getBoundingClientRect().width).length,
    topBeside: (() => { const t = ${FAB}; const p = document.querySelector('.top [data-action=play]'); if (!t || t.hidden || !t.offsetParent || !p) return false;
      const a = t.getBoundingClientRect(), b = p.getBoundingClientRect(); return b.left - a.right >= 0 && b.left - a.right <= 8 && Math.abs((a.top + a.bottom) - (b.top + b.bottom)) < 4; })(),
    head: r(document.querySelector('.top')),
  });
})()`;
const meet = (a, b) => !!a && !!b && a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;

let failed = 0;
const check = (ok, what) => {
  if (BEFORE) return console.log(`  · ${what}: ${ok ? 'yes' : 'no'}`);
  console.log(`  ${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failed++;
};

const root = mkdtempSync(join(tmpdir(), 'save-fab-'));
cpSync(join(PKG, 'starters/lantern-cove'), root, { recursive: true });
mkdirSync(join(root, '.studio/ui'), { recursive: true });
writeFileSync(join(root, '.studio/ui/prefs.json'), JSON.stringify({ version: 1, lang: opt('--lang') || 'ja' }));
const srv = await startStudioServer({ root, uiDir: join(PKG, 'skills/arrange/bin/studio-ui'), log: () => {} });
const browser = await launch();
try {
  for (const l of LAYOUTS) for (const theme of THEMES) {
    const tag = `${l.id}-${l.width}x${l.height}-${theme}-${TAG}`;
    console.log(tag);
    const page = await newPage(browser, { width: l.width, height: l.height, mobile: l.mobile });
    if (!l.mobile) await page.send('Emulation.setDeviceMetricsOverride', { width: l.width, height: l.height, deviceScaleFactor: l.dpr, mobile: false });
    await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
    const shot = async (n) => SHOTS && writeFileSync(join(SHOTS, `${tag}-${n}.png`), await page.screenshot());
    const boxes = async () => JSON.parse(await page.eval(BOXES));
    const press = async (b) => {
      const x = (b.l + b.r) / 2, y = (b.t + b.b) / 2;
      if (l.mobile) await page.tap(x, y);
      else await page.click(x, y);
    };
    try {
      // A fresh folder each run: one layout's save must not be the next one's start.
      rmSync(join(root, 'placement.json'), { force: true });
      rmSync(join(root, '.studio/requests'), { recursive: true, force: true });
      await page.goto(srv.url);
      await page.waitFor(READY, 30000);
      // A fresh browser state too (the minimized card is remembered in this browser).
      await page.eval(`(() => { try { localStorage.clear(); } catch {} })()`);
      await page.goto(srv.url);
      await page.waitFor(READY, 30000);
      await sleep(1500);
      let b = await boxes();
      await shot('0-open');
      check(!b.fab && b.saves === 0, 'nothing changed: no Save');

      const keys = await page.eval(`JSON.stringify(studioShell.items().filter((i) => i.movable !== false && !i.held).map((i) => i.key))`).then(JSON.parse);
      const [k1, k2] = [keys.find((k) => /boat|crate|barrel/.test(k)) || keys[0], keys.find((k) => /lighthouse|buoy|pier/.test(k)) || keys[1]];
      await page.eval(`studioShell.actions.select(${JSON.stringify(k1)})`);
      await sleep(900);
      // One change: the card's X field (on a phone it sits under "…", closed, but is still the same field).
      const moved = await page.eval(`(() => { const i = document.querySelector('[data-part=card] .fields input'); if (!i) return false; i.value = String((parseFloat(i.value) || 0) + 0.5); i.dispatchEvent(new Event('change')); return true; })()`);
      await sleep(900);
      // Measured once its arrival (studio-rise + the one bounce) has settled: on a busy first page it can still be running
      // at 900 ms, and the box is then a few px low.
      await page.waitFor(`!(${FAB}?.getAnimations?.() || []).some((a) => a.playState === 'running')`, 3000).catch(() => {});
      b = await boxes();
      await shot('1-changed');
      console.log(`  moved ${k1}: ${moved}; boxes ${JSON.stringify(b)}`);
      check(!!b.fab && /1/.test(b.fabText), `one change: Save ("${b.fabText}")`);
      check(b.saves === 1, `one Save on screen, not two (${b.saves})`);
      if (b.fab) {
        check(b.topBeside, 'beside ▶ Play, on its line');
        check(!!b.head && b.fab.t >= b.head.t && b.fab.b <= b.head.b, 'in the top bar, not over the game');
        check(b.fab.r <= b.W && b.fab.b <= b.H && b.fab.l >= 0, 'whole on screen');
        for (const n of ['card', 'sheet']) if (b[n]) check(!meet(b.fab, b[n]), `clear of the ${n}`);
        const tip = await page.eval(`${FAB}?.title || ${FAB}?.dataset.tip || ''`);
        if (l.id !== 'phone') check(/⌘S|Ctrl/.test(await page.eval(`${FAB}.innerText + ' ' + (${FAB}.getAttribute('aria-keyshortcuts') || '') + ' ' + (${FAB}.title || '')`)), `the key ⌘S on it (${tip})`);
      }

      // The card's minimize.
      const min = `document.querySelector('[data-part=card] [data-action=card-min]')`;
      const has = await page.eval(`!!${min} && !!${min}.offsetParent`);
      check(has, 'the card has a minimize button');
      if (has) {
        const h0 = b.card ? b.card.b - b.card.t : 0;
        const mb = JSON.parse(await page.eval(`JSON.stringify((() => { const r = ${min}.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; })())`));
        await press(mb);
        await sleep(500);
        b = await boxes();
        await shot('2-min');
        const h1 = b.card ? b.card.b - b.card.t : 0;
        const name = await page.eval(`document.querySelector('[data-part=card] .card-head strong')?.innerText || ''`);
        // PC: the tall card folds to one line. Phone / side window: the card already is one line (name, copy, delete,
        // "…"); minimized it keeps the name only.
        check(h1 > 0 && h1 <= 60 && (h1 < h0 || l.id !== 'pc'), `minimized to one line (${h0} → ${h1} px, "${name}")`);
        check(await page.eval(`![...document.querySelectorAll('[data-part=card] [data-action=copy], [data-part=card] [data-action=remove], [data-part=card] [data-part=fine] > summary')].some((e) => e.offsetParent)`), 'no copy / delete / … while minimized');
        check(await page.eval(`!document.querySelector('[data-part=card] .card-body') || !document.querySelector('[data-part=card] .card-body').offsetParent`), 'no fields while minimized');
        if (b.fab) check(!meet(b.fab, b.card), 'Save still clear of the card');
        await page.eval(`studioShell.actions.select(${JSON.stringify(k2)})`);
        await sleep(700);
        b = await boxes();
        check(!!b.card && b.card.b - b.card.t <= 60 && await page.eval(`document.querySelector('[data-part=card]').dataset.min === 'on'`), `another pick (${k2}) stays minimized`);
        // Reload: the draft keeps the change, the browser keeps the minimized card.
        await page.goto(srv.url);
        await page.waitFor(READY, 30000);
        await sleep(1200);
        if (l.mobile || l.id === 'side') await page.eval(`(() => { const s = document.querySelector('[data-action=sheet]'); if (s && s.offsetParent && document.querySelector('.shell').dataset.sheet !== 'open') s.click(); })()`);
        await page.eval(`studioShell.actions.select(${JSON.stringify(k1)})`);
        await sleep(900);
        // Plan step 7 (v0.1.38, 2026-10-23): the phone / side window's bottom is one sheet with tabs (Scene | <picked> |
        // Motion), one thing at a time — a pick with the list up keeps the list, and the card is the picked tab. So the
        // card is brought up by its tab (it stood over the list before).
        await page.eval(`(() => { const t = document.querySelector('[data-part=sheet-tabs] [data-tab=pick]'); if (t && t.offsetParent && t.getAttribute('aria-selected') !== 'true') t.click(); })()`);
        await sleep(500);
        b = await boxes();
        check(await page.eval(`document.querySelector('[data-part=card]').dataset.min === 'on'`), 'after a reload still minimized');
        await shot('2b-min-reload');
        // Open it again from the same button.
        const ob = JSON.parse(await page.eval(`JSON.stringify((() => { const r = ${min}.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; })())`));
        await press(ob);
        await sleep(500);
        check(await page.eval(`document.querySelector('[data-part=card]').dataset.min !== 'on'`), 'opens again');
        b = await boxes();
        if (b.fab && b.card) check(!meet(b.fab, b.card), 'Save clear of the open card (with the sheet up)');
        if (b.fab && b.sheet) check(!meet(b.fab, b.sheet), 'Save clear of the list sheet');
        await shot('2c-open-again');
      }

      // Save from the game: a real press. (The reload above kept the change in the draft, which the editor counts as
      // saved since the draft IS placement.json — as before this change. So one more change first.)
      await page.eval(`(() => { const i = document.querySelector('[data-part=card] .fields input'); if (!i) return; i.value = String((parseFloat(i.value) || 0) + 0.5); i.dispatchEvent(new Event('change')); })()`);
      await sleep(900);
      b = await boxes();
      await shot('2d-changed-again');
      // On a phone / the side window the list sheet is up now (opened before the pick above).
      if (b.fab) for (const n of ['card', 'sheet']) if (b[n]) check(!meet(b.fab, b[n]), `again: clear of the ${n}`);
      const reqs = () => (existsSync(join(root, '.studio/requests')) ? readdirSync(join(root, '.studio/requests')).filter((f) => f.endsWith('.json')).length : 0);
      const r0 = reqs();
      if (b.fab) {
        await press(b.fab);
        // "✓ Saved" in its place for a moment (SAVE_DONE_MS 1.2 s after the hand-off went through), then gone.
        let doneText = '';
        for (let i = 0; i < 30 && !/保存済み|Saved/.test(doneText); i++) {
          doneText = await page.eval(`(${FAB}.hidden ? '(hidden) ' : '') + ${FAB}.innerText.replace(/\\s+/g, ' ')`);
          if (!/保存済み|Saved/.test(doneText)) await sleep(50);
        }
        check(/保存済み|Saved/.test(doneText), `"✓ Saved" in its place for a moment ("${doneText}")`);
        await sleep(1500);
        b = await boxes();
        await shot('3-saved');
        const file = join(root, 'placement.json');
        const saved = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
        check(!!saved && JSON.stringify(saved).includes(k1), `pressed: placement.json written with ${k1}`);
        check(reqs() > r0, 'handed to the AI (a saved request)');
        check(await page.eval(`(() => { const s = document.querySelector('[data-action=save]'); return !s || s.dataset.unsaved === '0' || !(Number(s.dataset.unsaved) > 0); })()`), 'nothing left to save');
        await sleep(1500);
        b = await boxes();
        check(!b.fab && b.saves === 0, 'the Save is gone after saving');
        await shot('3b-later');
      } else check(false, 'a Save to press');
      const errors = page.logs.filter((x) => x.startsWith('exception'));
      check(!errors.length, `no page errors${errors.length ? ': ' + errors.join(' / ') : ''}`);
    } catch (e) {
      console.log(`  ✗ ${e.message}`);
      failed++;
      await shot('fail').catch(() => {});
    } finally {
      await page.close();
    }
  }
} finally {
  await browser.close?.();
  await srv.close?.();
  rmSync(root, { recursive: true, force: true });
}
if (failed && !BEFORE) {
  console.log(`${failed} failed`);
  process.exit(1);
}
console.log(BEFORE ? 'before: photos and numbers only' : 'ok');
process.exit(0);
