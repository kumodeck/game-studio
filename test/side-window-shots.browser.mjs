// Pictures and numbers for the side window next to a chat (a try on 2026-10-19: "it's hard to use from the sidebar"),
// no assertions: the editor at 400×900 and 420×800 with a mouse (the chat app's side window is a desktop window,
// no touch), the list sheet opened and one object picked — then the same game opened large (PC 1280×800) as the
// side window's "Open large" button opens it. Prints, per size, how much of the window the game keeps above the
// sheet, how many list rows read, and whether anything that can be pressed sits in the bottom 48 px (where the chat
// app lays its own toolbar over the window).
//
//   node test/side-window-shots.browser.mjs --shots <dir> [--game <folder> | --starter lantern-cove] [--pick <key>]
//     [--tag before|after] [--only 400x900,420x800,large] [--lang ja|en] [--theme dark|light]
// --game: a folder with an index.html (e.g. .scratch/neon-run, an AI-written runner with 60 unnamed objects).
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
const SHOTS = resolve(opt('--shots') || join(tmpdir(), 'side-window-shots'));
mkdirSync(SHOTS, { recursive: true });
const TAG = opt('--tag') || 'now';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const src = opt('--game') ? resolve(opt('--game')) : join(PKG, 'starters', opt('--starter') || 'lantern-cove');
const name = src.split('/').pop();
const SIZES = [[400, 900], [420, 800], ['large', 1280, 800]].filter((s) => !opt('--only') || opt('--only').split(',').includes(s[0] === 'large' ? 'large' : `${s[0]}x${s[1]}`));

const GAME = `document.querySelector('iframe').contentWindow`;
const READY = `document.querySelectorAll('.obj, .noname').length > 0 && !!${GAME}.__gameStudio?._debug`;
// What the side window shows: the game above the sheet (share of the window), the list rows that read whole, and
// anything pressable in the bottom 48 px.
const MEASURE = `(() => {
  const H = innerHeight;
  const side = document.querySelector('.side').getBoundingClientRect();
  const panel = document.querySelector('.side .list-scroll, .side .panel').getBoundingClientRect();
  const covers = [...document.querySelectorAll('.card-slot > .card:not([hidden]), .dock .bar')].filter((e) => e.offsetParent).map((e) => e.getBoundingClientRect().top);
  const bottom = Math.min(panel.bottom, ...covers);
  const rows = [...document.querySelectorAll('.side .list-scroll > .noname, .side .panel .obj')].filter((e) => e.offsetParent);
  const seen = rows.filter((e) => { const r = e.getBoundingClientRect(); return r.top >= panel.top - 1 && r.bottom <= bottom + 1; });
  // Pressable there = really under the pointer (rows scrolled out of the list and the folded card's numbers have boxes there too).
  const low = [...document.querySelectorAll('button, input, [role=option], summary, a')].filter((e) => {
    if (!e.offsetParent) return false; const r = e.getBoundingClientRect(); if (!(r.width > 0 && r.bottom > H - 48 && r.top < H)) return false;
    const x = Math.min(Math.max(r.left + r.width / 2, 0), innerWidth - 1), y = Math.min((Math.max(r.top, H - 48) + Math.min(r.bottom, H)) / 2, H - 1);
    const hit = document.elementFromPoint(x, y); return !!hit && (hit === e || e.contains(hit)); })
    .map((e) => (e.dataset.action || e.getAttribute('aria-label') || e.className || e.tagName).toString().slice(0, 24));
  return JSON.stringify({ game: +(Math.max(0, side.top - document.querySelector('iframe').getBoundingClientRect().top) / H).toFixed(2), sheetTop: Math.round(side.top), seen: seen.length, rows: seen.map((e) => e.innerText.replace(/\\s+/g, ' ').trim().slice(0, 30)), low });
})()`;

const root = mkdtempSync(join(tmpdir(), `side-window-${name}-`));
cpSync(src, root, { recursive: true });
if (opt('--lang')) {
  mkdirSync(join(root, '.studio/ui'), { recursive: true });
  writeFileSync(join(root, '.studio/ui/prefs.json'), JSON.stringify({ version: 1, lang: opt('--lang') }));
}
const srv = await startStudioServer({ root, uiDir: join(PKG, 'skills/arrange/bin/studio-ui'), log: () => {} });
const browser = await launch();
try {
  for (const s of SIZES) {
    const large = s[0] === 'large';
    const [w, h] = large ? [s[1], s[2]] : s;
    const tag = `${name}-${large ? 'large' : `${w}x${h}`}-${TAG}`;
    const page = await newPage(browser, { width: w, height: h });
    // A desktop window at 2× (the chat app on a Mac), with a mouse: not the phone emulation (no touch).
    await page.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: false });
    if (opt('--theme')) await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: opt('--theme') }] });
    try {
      await page.goto(srv.url);
      await page.waitFor(READY, 30000);
      await sleep(1200);
      writeFileSync(join(SHOTS, `${tag}-0-open.png`), await page.screenshot());
      const keys = await page.eval(`studioShell.items().map((i) => i.key)`);
      const key = opt('--pick') && keys.includes(opt('--pick')) ? opt('--pick') : keys[Math.floor(keys.length / 2)];
      // The list: the side window opens it from the ask bar's list button (the phone layout), PC has its column.
      const sheet = await page.eval(`(() => { const b = document.querySelector('[data-action=sheet]'); if (!b || !b.offsetParent) return false; b.click(); return true; })()`);
      if (sheet) await sleep(700);
      await page.eval(`studioShell.actions.select(${JSON.stringify(key)})`);
      await page.waitFor(`studioShell.selected() === ${JSON.stringify(key)}`, 3000);
      await sleep(1200);
      writeFileSync(join(SHOTS, `${tag}-1-picked.png`), await page.screenshot());
      const m = JSON.parse(await page.eval(MEASURE));
      console.log(`${tag}: picked ${key}; game ${Math.round(m.game * 100)}% of the window above the sheet (top ${m.sheetTop}); ${m.seen} rows read: ${m.rows.join(' | ')}; in the bottom 48 px: ${m.low.join(', ') || 'nothing'}`);
      const errors = page.logs.filter((l) => l.startsWith('exception'));
      if (errors.length) console.log(`  page errors: ${errors.join(' / ')}`);
    } catch (e) {
      console.log(`${tag}: ✗ ${e.message}`);
      writeFileSync(join(SHOTS, `${tag}-fail.png`), await page.screenshot()).catch?.(() => {});
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
