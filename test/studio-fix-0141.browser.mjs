// fix-0141 (2026-10-24) in a headless browser: the parts of the third first-run check that its walk does not measure,
// on Neon Run (test/neon-run), PC 1280×800, one language a run (`--lang en|ja`), dark:
//   group  ⑧ the list's "hex" row picks the four: the strip keeps its Motion button in its place, dimmed, with "Motions are
//          made one object at a time" (a press opens nothing); the line under the strip says what the game does to
//          them; the card's names are not cut to "hex-1, hex-2, …" (two lines);
//   camera ⑨ with the timeline and Fine-tune open, the ship (under the plate) picked from the list may slide the view;
//          closing the plate puts the view back where it was;
//   lib    ⑪ the Library scrolled to its end: the last tile's name is above the dock (the ask bar).
// Pictures (`--shots <dir>`): fix-0141-<lang>-<step>.png.
//
//   node test/studio-fix-0141.browser.mjs [--lang en|ja] [--shots <dir>]
// Exit 1 on a failure.
import { cpSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStudioServer } from '../src/server/server.mjs';
import { launch, newPage } from './adapters-2d/cdp.mjs';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const take = (flag, d = null) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : d;
};
const SHOTS = take('--shots') ? resolve(take('--shots')) : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const LANG = take('--lang', 'en');
const UI = join(PKG, 'skills/arrange/bin/studio-ui');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W = LANG === 'ja' ? { one: '動きは 1 つずつ作ります' } : { one: 'Motions are made one object at a time' };

let failed = 0;
const check = (ok, what) => {
  console.log(`  ${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failed++;
};

// The gate moves with the game (Hop), so the timeline opens on it.
const K = (t, v) => ({ t, v });
const FILE = { version: 1, tool: 'placement', dim: '3d', space: 'local', objects: {},
  motions: [{ name: 'Hop', len: 0.8, keys: { p: [K(0, [0, 0, 0]), K(0.4, [0, 1.4, 0]), K(0.8, [0, 0, 0])] } }],
  motion: { gate: { clips: [{ use: 'Hop', when: { on: 'start' } }] } } };

const GAME = `document.querySelector('iframe.game, iframe')`;
const DBG = `${GAME}.contentWindow.__gameStudio?._debug`;
const SROOT = `([...${GAME}.contentDocument.querySelectorAll('[data-studio-ui]')].map((h) => h.shadowRoot).find((r) => r && r.querySelector('[data-studio-handle]')) || null)`;
const VIEW = `JSON.stringify(${DBG}?.view?.() ?? null)`;
const sameView = (a, b) => !!a && !!b && a.target.every((v, i) => Math.abs(v - b.target[i]) < 0.01) && Math.abs(a.distance - b.distance) < 0.01 && Math.abs(a.yaw - b.yaw) < 1e-3 && Math.abs(a.pitch - b.pitch) < 1e-3;
const rowAt = (sel) => `(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e || !e.getBoundingClientRect().width) return 'null';
  e.scrollIntoView({ block: 'nearest' }); const r = e.getBoundingClientRect(); return JSON.stringify({ x: r.left + Math.min(40, r.width / 2), y: r.top + r.height / 2 }); })()`;

const root = mkdtempSync(join(tmpdir(), 'studio-fix-0141-'));
cpSync(join(PKG, 'test/neon-run'), root, { recursive: true });
if (!existsSync(join(root, 'studio-placement.js'))) copyFileSync(join(PKG, 'skills/arrange/bin/studio-placement.js'), join(root, 'studio-placement.js'));
mkdirSync(join(root, '.studio/ui'), { recursive: true });
writeFileSync(join(root, '.studio/ui/prefs.json'), JSON.stringify({ version: 1, lang: LANG, theme: 'dark', seen: ['timeline-steps', 'open-line'] }));
writeFileSync(join(root, 'placement.json'), JSON.stringify(FILE, null, 2));
// No KUMODeck sign-in: the real ~/.kumo of the machine running this is never read.
const srv = await startStudioServer({ root, kumo: { home: join(root, '.no-kumo-home'), env: {} }, uiDir: UI, log: () => {}, env: {} });
const browser = await launch();
try {
  const page = await newPage(browser, { width: 1280, height: 800, cdnCache: process.env.STUDIO_CDN_CACHE });
  const j = async (expr) => JSON.parse((await page.eval(expr)) || 'null');
  const shot = async (what) => SHOTS && writeFileSync(join(SHOTS, `fix-0141-${LANG}-${what}.png`), await page.screenshot());
  const clickRow = async (sel) => {
    const p = await j(rowAt(sel));
    if (!p) throw new Error(`no row ${sel}`);
    await page.click(Math.round(p.x), Math.round(p.y));
    await sleep(1200);
  };
  await page.goto(srv.url);
  await page.waitFor(`document.querySelectorAll('.obj').length > 0 && !!${DBG}`, 90000);
  await sleep(2500);
  console.log(`${LANG} pc`);

  // ---- ⑧ the group row ----
  await clickRow('.obj.group-row');
  const grp = await j(`(() => { const r = ${SROOT}; const m = r?.querySelector('[data-studio-motion]'); const n = r?.querySelector('[data-studio-note]');
    const k = document.querySelector('[data-part=card] .group-head .key');
    return JSON.stringify({ n: (studioShell.items?.() ?? []).length, motion: m ? { hidden: m.hidden, w: m.getBoundingClientRect().width, off: m.getAttribute('aria-disabled'), title: m.title } : null,
      note: n && n.style.display !== 'none' ? n.textContent.trim() : null, names: k ? { text: k.textContent, cut: k.scrollHeight > k.clientHeight + 2 || k.scrollWidth > k.clientWidth + 1 } : null }); })()`);
  await shot('1-group');
  check(!!grp?.motion && !grp.motion.hidden && grp.motion.w > 0 && grp.motion.off === 'true' && grp.motion.title === W.one, `⑧ the strip's Motion button stays, dimmed: ${JSON.stringify(grp?.motion)}`);
  check(!!grp?.note, `⑧ the line under the strip says what the game does: ${JSON.stringify(grp?.note)}`);
  check(!!grp?.names && !grp.names.cut && /hex-4/.test(grp.names.text), `⑧ the card's names are not cut: ${JSON.stringify(grp?.names)}`);
  // A press on the dimmed button opens nothing (no menu, no timeline).
  const mb = await j(`(() => { const o = ${GAME}.getBoundingClientRect(); const b = ${SROOT}?.querySelector('[data-studio-motion]'); if (!b) return 'null'; const q = b.getBoundingClientRect(); return JSON.stringify({ x: o.left + q.left + q.width / 2, y: o.top + q.top + q.height / 2 }); })()`);
  if (mb) {
    await page.click(Math.round(mb.x), Math.round(mb.y));
    await sleep(700);
  }
  const after = await j(`JSON.stringify({ menu: !!document.querySelector('.ctx-menu:not([hidden]), [data-part=context-menu]:not([hidden])'), tl: !!document.querySelector('[data-part=timeline]')?.getClientRects().length })`);
  check(!!mb && !after.menu && !after.tl, `⑧ a press on it opens nothing: ${JSON.stringify(after)}`);
  await page.eval(`studioShell.actions.selectMany([])`);
  await sleep(500);

  // ---- ⑨ the ship under the plate ----
  await page.eval(`studioShell.actions.select('gate')`);
  await sleep(1000);
  await page.eval(`window.__studioTimeline.setOpen(true)`);
  await sleep(1200);
  const fineBtn = await j(rowAt('[data-part=tl-fine-btn]'));
  const fineOpen = await page.eval(`!!document.querySelector('[data-part=tl-fine]')?.getClientRects().length || !!document.querySelector('.tl-fine')?.getClientRects().length`);
  if (fineBtn && !fineOpen) {
    await page.click(Math.round(fineBtn.x), Math.round(fineBtn.y));
    await sleep(900);
  }
  const v0 = await j(VIEW);
  await clickRow('.obj:not(.group-row)[data-key=ship]');
  await sleep(600);
  const v1 = await j(VIEW);
  await shot('2-ship-plate');
  await page.eval(`window.__studioTimeline.setOpen(false)`);
  await sleep(1200);
  const v2 = await j(VIEW);
  await shot('3-plate-closed');
  console.log(`  (the ship picked with the plate open: the view ${sameView(v0, v1) ? 'stayed' : 'slid'})`);
  check(sameView(v0, v2), `⑨ the plate closed: the view is back where it was (${JSON.stringify({ v0, v2 })})`);

  // ---- ⑪ the Library's last row ----
  await page.eval(`studioShell.actions.selectMany([])`);
  await page.eval(`studioShell.actions.switchTool('library')`);
  await sleep(2000);
  const lib = await j(`(() => { const g = document.querySelector('.assets-page .gsl-grid'); const d = document.querySelector('.dock'); if (!g || !d) return 'null';
    g.scrollTop = g.scrollHeight; const tiles = [...g.querySelectorAll('.gsl-tile')].filter((t) => t.getClientRects().length); const last = tiles.at(-1);
    const nm = last?.querySelector('.gsl-name') || last; return JSON.stringify({ tiles: tiles.length, nameBottom: nm ? Math.round(nm.getBoundingClientRect().bottom) : null, dockTop: Math.round(d.getBoundingClientRect().top),
      pad: getComputedStyle(g).paddingBottom, dockH: getComputedStyle(document.querySelector('.shell')).getPropertyValue('--dock-h') }); })()`);
  await sleep(300);
  await shot('4-library-end');
  check(!!lib && lib.tiles > 0 && lib.nameBottom <= lib.dockTop, `⑪ the last tile's name is above the dock: ${JSON.stringify(lib)}`);
} catch (e) {
  console.log(`  ✗ ${e.message}`);
  failed++;
} finally {
  await Promise.race([Promise.allSettled([browser.close(), srv.close()]), sleep(15000)]);
}
console.log(failed ? `${failed} failed` : 'ok fix-0141');
process.exit(failed ? 1 : 0);
