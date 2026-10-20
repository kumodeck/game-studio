// Pictures and numbers for a hands-on try of 2026-10-19 (items 4, 5, 6 of
//), on the same kind of game: an AI-written three.js runner whose
// unnamed Group pillars flow toward the camera every frame, on a road, under a sky. Per layout (PC 1280×800 with a
// mouse, the chat app's side window 400×900 with a mouse, a phone 390×844 with touch):
//   0-open     the first screen (what sits at the top: how many cards / plates are stacked there)
//   1-pillar   a pillar picked (does the card say the game moves it?)
//   2-road     the road picked from the list, then the Height tool dragged up on the game (the accident: does the
//              road rise?)
//   3-save     Save pressed after that (is a big change shown before it goes to the AI?)
// No assertions: it prints what happened, so the same script shows the "before" and the "after".
//
//   node test/fb-safe-shots.browser.mjs --game .scratch/pillar-run --shots <dir> [--tag before|after]
//     [--only pc,side,phone] [--lang ja|en]
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
const SHOTS = resolve(opt('--shots') || join(tmpdir(), 'fb-safe-shots'));
mkdirSync(SHOTS, { recursive: true });
const TAG = opt('--tag') || 'now';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const src = resolve(opt('--game') || join(PKG, '.scratch/pillar-run'));
const LAYOUTS = [
  { id: 'pc', width: 1280, height: 800, mobile: false, dpr: 1 },
  { id: 'side', width: 400, height: 900, mobile: false, dpr: 2 },
  { id: 'phone', width: 390, height: 844, mobile: true, dpr: 2 },
].filter((l) => !opt('--only') || opt('--only').split(',').includes(l.id));

const GAME = `document.querySelector('iframe').contentWindow`;
const READY = `document.querySelectorAll('.obj, .noname').length > 0 && !!${GAME}.__gameStudio?._debug`;
// The plates floating over the game (item 6): the list sheet, the AI's news line, the picked object's card, the ask
// bar — each one that shows its own glass (its own background), with its top and height. "One plate" = the card, the
// news and the bar share the dock's glass (shell.css, 2026-10-19), so only the dock counts.
const PLATES = `(() => {
  const out = [];
  for (const [name, sel] of [['sheet', '.shell[data-layout=phone] .side'], ['dock', '.dock'], ['news', '.ai-caption'], ['card', '.card-slot > .card, .inspector > .card'], ['bar', '.dock .bar']]) {
    const e = document.querySelector(sel);
    if (!e || !e.offsetParent || e.hidden) continue;
    const cs = getComputedStyle(e);
    const glass = cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent';
    if (!glass) continue;
    const r = e.getBoundingClientRect();
    if (r.height < 8) continue;
    out.push(name + '@' + Math.round(r.top) + '+' + Math.round(r.height));
  }
  return out.join(' ');
})()`;
// The game's own pose of an object (the adapter's read-back), so a refused drag shows as "no change".
const HEIGHT = (k) => `(${GAME}.__gameStudio._debug.anchor(${JSON.stringify(k)})?.pose?.p?.[1] ?? null)`;

const root = mkdtempSync(join(tmpdir(), 'fb-safe-'));
cpSync(src, root, { recursive: true });
mkdirSync(join(root, '.studio/ui'), { recursive: true });
writeFileSync(join(root, '.studio/ui/prefs.json'), JSON.stringify({ version: 1, lang: opt('--lang') || 'ja' }));
const srv = await startStudioServer({ root, uiDir: join(PKG, 'skills/arrange/bin/studio-ui'), log: () => {} });
const browser = await launch();
try {
  for (const l of LAYOUTS) {
    const tag = `${l.id}-${l.width}x${l.height}-${TAG}`;
    const page = await newPage(browser, { width: l.width, height: l.height, mobile: l.mobile, cdnCache: process.env.STUDIO_CDN_CACHE });
    if (!l.mobile) await page.send('Emulation.setDeviceMetricsOverride', { width: l.width, height: l.height, deviceScaleFactor: l.dpr, mobile: false });
    const shot = async (n) => writeFileSync(join(SHOTS, `${tag}-${n}.png`), await page.screenshot());
    try {
      // A fresh folder each layout: the save of one layout must not be the next one's start.
      rmSync(join(root, 'placement.json'), { force: true });
      await page.goto(srv.url);
      await page.waitFor(READY, 30000);
      await sleep(2500);
      await shot('0-open');
      console.log(`${tag}: plates: ${await page.eval(PLATES)}`);
      const items = await page.eval(`JSON.stringify(studioShell.items().map((i) => ({ key: i.key, label: i.label, kinds: i.kinds, backdrop: i.backdrop, held: i.held, movable: i.movable })))`).then(JSON.parse);
      console.log(`  ${items.length} objects; held as ground: ${items.filter((i) => i.held === 'ground').map((i) => i.key).join(', ') || 'none'}; held as moved by the game: ${items.filter((i) => i.held === 'game').length}`);
      const pillar = items.find((i) => i.kinds.includes('group'));
      const road = items.find((i) => i.kinds.includes('plane'));
      // The list: phones and the side window open it from the bar's list button.
      const openList = async () => {
        if (await page.eval(`(() => { const b = document.querySelector('[data-action=sheet]'); if (!b || !b.offsetParent) return false; b.click(); return true; })()`)) await sleep(700);
      };
      await openList();
      if (pillar) {
        await page.eval(`studioShell.actions.select(${JSON.stringify(pillar.key)})`);
        await sleep(1200);
        await shot('1-pillar');
        console.log(`  plates with a pick: ${await page.eval(PLATES)}`);
        const card = await page.eval(`(document.querySelector('.card-slot > .card:not([hidden]), .inspector > .card:not([hidden])')?.innerText || '').replace(/\\s+/g, ' ').slice(0, 200)`);
        console.log(`  pillar ${pillar.key}: card "${card}"`);
      }
      if (road) {
        await page.eval(`studioShell.actions.select(${JSON.stringify(road.key)})`);
        await sleep(1000);
        const y0 = await page.eval(HEIGHT(road.key));
        // The accident: the Height tool (H), then a drag up the middle of the game.
        const f = JSON.parse(await page.eval(`JSON.stringify(document.querySelector('iframe').getBoundingClientRect())`));
        // Upper part of the game: on a phone / the side window the list sheet covers the lower half.
        const cx = f.left + f.width / 2, cy = f.top + f.height * 0.4;
        await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'h', code: 'KeyH', text: 'h', windowsVirtualKeyCode: 72 });
        await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'h', code: 'KeyH', windowsVirtualKeyCode: 72 });
        await sleep(300);
        if (l.mobile) await page.touchDrag(cx, cy, cx, cy - 220, 12);
        else await page.mouseDrag(cx, cy, cx, cy - 220, 12);
        await sleep(800);
        const y1 = await page.eval(HEIGHT(road.key));
        await shot('2-road');
        const card = await page.eval(`(document.querySelector('.card-slot > .card:not([hidden]), .inspector > .card:not([hidden])')?.innerText || '').replace(/\\s+/g, ' ').slice(0, 200)`);
        console.log(`  road ${road.key}: height ${y0} → ${y1}; card "${card}"`);
        // The way to move it on purpose (after): the card's "Make movable", then the same drag, then Save.
        const freed = await page.eval(`(() => { const b = document.querySelector('[data-action=unfix]'); if (!b || !b.offsetParent) return false; b.click(); return true; })()`);
        if (freed) {
          await sleep(500);
          await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'h', code: 'KeyH', text: 'h', windowsVirtualKeyCode: 72 });
          await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'h', code: 'KeyH', windowsVirtualKeyCode: 72 });
          await sleep(300);
          if (l.mobile) await page.touchDrag(cx, cy, cx, cy - 220, 12);
          else await page.mouseDrag(cx, cy, cx, cy - 220, 12);
          await sleep(800);
          console.log(`  made movable on purpose: height now ${await page.eval(HEIGHT(road.key))}`);
        }
        // Not awaited: Save waits for the answer when it asks first.
        await page.eval(`void setTimeout(() => studioShell.actions.save(), 0)`).catch(() => {});
        await sleep(1200);
        await shot('3-save');
        const sheet = await page.eval(`(document.querySelector('.safe-save:not([hidden])')?.innerText || '').replace(/\\s+/g, ' ').slice(0, 300)`);
        console.log(`  after Save: ${sheet ? `asked first: "${sheet}"` : 'nothing shown before it went to the AI'}`);
      }
      const errors = page.logs.filter((x) => x.startsWith('exception'));
      if (errors.length) console.log(`  page errors: ${errors.join(' / ')}`);
    } catch (e) {
      console.log(`${tag}: ✗ ${e.message}`);
      await shot('fail').catch(() => {});
    } finally {
      await page.close();
    }
  }
} finally {
  await browser.close();
  await srv.close();
  rmSync(root, { recursive: true, force: true });
}
console.log(`shots in ${SHOTS}`);
