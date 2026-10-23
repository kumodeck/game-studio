// Plan step 5 "the Library's shelf" (studio-library-shelf, 2026-10-23; the UI plan’s step 5). The
// first-run walk (#12, #13) found: "Library 9" next to "All 11"; the motions Hop and Motion in the objects' grid; "Drawn in
// code (no file)", "Locked by this game's settings" and "Not attached yet" in the details; and "Make with AI" that said
// only after the press that it needs a KUMODeck sign-in and money. Checked here in the built editor, headless, PC 1280 × 800:
//   neon    test/neon-run with two motions (Hop on nothing, "ship’s motion" on the ship), no assets, KUMODeck signed out:
//           the headings "Objects · 9" / "Motions · 2" / "Assets · 0" + one drop place; the left column, All and the
//           headings say the same number; no Multi-select on PC; road's detail (locked, no asset) and Hop's detail (on
//           nothing) carry none of the old lines; "✦ Make with AI · sign-in · paid".
//   lantern starters/lantern-cove (assets), signed in to a fake KUMODeck ($5.00): "Assets · n" over n file tiles, the
//           same count sums, "✦ Make with AI · $5.00 left".
//
//   node test/studio-library-shelf.browser.mjs [--only neon,lantern] [--lang en|ja] [--theme dark|light]
//        [--shots <dir>] [--prefix after] [--ui <studio-ui dir>] [--no-checks]
// --ui: another build of the editor page (the "before" photos: the build before this change, with --no-checks).
// Nothing leaves the machine: the KUMODeck is test/kumo-fake.mjs on 127.0.0.1 and the sign-in lives in a temporary HOME.
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStudioServer } from '../src/server/server.mjs';
import { launch, newPage } from './adapters-2d/cdp.mjs';
import { fakeKumoServer, FAKE_KUMO_PROJECT } from './kumo-fake.mjs';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const take = (f, d = null) => (args.includes(f) ? args[args.indexOf(f) + 1] : d);
const ONLY = (take('--only') || 'neon,lantern').split(',');
const LANG = take('--lang', 'en');
const THEME = take('--theme', 'dark');
const SHOTS = take('--shots');
const PREFIX = take('--prefix', 'after');
const CHECKS = !args.includes('--no-checks');
const UI = resolve(take('--ui', join(PKG, 'skills/arrange/bin/studio-ui')));
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failed = 0;
const check = (ok, what) => {
  if (!CHECKS) return;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failed++;
};

// Neon Run's motions: one on nothing (Hop), one on the ship from the start (the default name of a new motion, step 1).
const SHIP_MOTION = LANG === 'ja' ? 'ship の動き' : 'ship’s motion';
const NEON_FILE = { version: 1, tool: 'placement', dim: '3d', space: 'local', objects: {},
  motions: [
    { name: 'Hop', len: 0.8, keys: { p: [{ t: 0, v: [0, 0, 0] }, { t: 0.4, v: [0, 1.4, 0] }, { t: 0.8, v: [0, 0, 0] }] } },
    { name: SHIP_MOTION, len: 1, keys: { p: [{ t: 0, v: [-1, 0, 0] }, { t: 0.5, v: [0, 0, 0] }, { t: 1, v: [1, 0, 0] }] } },
  ],
  motion: { ship: { clips: [{ use: SHIP_MOTION, when: { on: 'start' } }] } } };

async function open(browser, kumo, src, { signedIn, file }) {
  const base = mkdtempSync(join(tmpdir(), 'library-shelf-'));
  const root = join(base, 'game');
  const home = join(base, 'home');
  cpSync(join(PKG, src), root, { recursive: true });
  // test/neon-run keeps no loader of its own (its README): the built one, as the other screen tests copy it.
  if (!existsSync(join(root, 'studio-placement.js'))) copyFileSync(join(UI, '../studio-placement.js'), join(root, 'studio-placement.js'));
  mkdirSync(join(root, '.studio/ui'), { recursive: true });
  writeFileSync(join(root, '.studio/ui/prefs.json'), JSON.stringify({ version: 1, lang: LANG, theme: THEME, seen: ['timeline-steps'] }));
  if (file) writeFileSync(join(root, 'placement.json'), JSON.stringify(file, null, 2));
  writeFileSync(join(root, 'kumo.json'), JSON.stringify({ projectId: FAKE_KUMO_PROJECT, api: kumo.api }));
  if (signedIn) {
    mkdirSync(join(home, '.kumo'), { recursive: true });
    writeFileSync(join(home, '.kumo/credentials.json'), kumo.credentials());
  }
  const srv = await startStudioServer({ root, uiDir: UI, log: () => {}, kumo: { home, env: {} } });
  const page = await newPage(browser, { width: 1280, height: 800 });
  await page.goto(srv.url + '&tool=library');
  await page.waitFor(`document.querySelectorAll('.lib-object').length > 0 && !!document.querySelector('.gsl-ai-open')`, 90000);
  await sleep(3000);
  const j = async (e) => JSON.parse((await page.eval(e)) || 'null');
  const shot = async (name) => {
    if (SHOTS) writeFileSync(join(SHOTS, `05-${PREFIX}-${LANG}-${THEME}-${name}.png`), await page.screenshot());
  };
  // What the shelf says: the left column's Library number, All, the headings and the tiles under each.
  const counts = () => j(`(() => {
    const num = (e) => Number(e?.textContent?.trim() || 0);
    const heads = [...document.querySelectorAll('.gsl-group')].map((e) => ({ group: e.dataset.group, text: e.textContent }));
    return JSON.stringify({
      left: num(document.querySelector('.nav-row[data-tool=library] .n')),
      all: num(document.querySelector('.filter-row[data-shelf=all] b')),
      heads,
      headSum: heads.reduce((a, h) => a + Number((h.text.match(/(\\d+)\\s*$/) || [0, 0])[1]), 0),
      objects: [...document.querySelectorAll('.lib-object')].reduce((a, t) => a + Number(t.querySelector('.shelf-many')?.textContent.replace('×', '') || 1), 0),
      motions: document.querySelectorAll('.lib-motion:not(.lib-motion-new)').length,
      files: document.querySelectorAll('.gsl-tile[data-kind=file]').length,
      drop: !!document.querySelector('[data-part=assets-drop]'),
      multi: [...document.querySelectorAll('.shelf-multi')].some((b) => b.offsetParent),
      ai: document.querySelector('.gsl-ai-open')?.textContent || '',
      count: document.querySelector('.gsl-count')?.textContent || '',
    });
  })()`);
  const detailText = () => page.eval(`document.querySelector('.gsl-detail')?.innerText || ''`);
  const press = (sel) => page.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; e.click(); return true; })()`);
  return { page, j, shot, counts, detailText, press, close: async () => { await page.close?.(); await srv.close?.(); } };
}

const ja = LANG === 'ja';
const browser = await launch();
const kumo = await fakeKumoServer({ delayMs: 500 });
try {
  if (ONLY.includes('neon')) {
    const g = await open(browser, kumo, 'test/neon-run', { signedIn: false, file: NEON_FILE });
    try {
      await g.page.waitFor(`/sign|サイン/i.test(document.querySelector('.gsl-ai-open')?.textContent || '') || ${!CHECKS}`, 15000).catch(() => undefined);
      await sleep(500);
      const c = await g.counts();
      console.log(`neon: ${JSON.stringify(c)}`);
      await g.shot('neon-all');
      check(c.heads.map((h) => h.group).join(',') === 'objects,motions,assets', `headings: ${c.heads.map((h) => h.text).join(' / ')}`);
      check(c.heads[0]?.text === (ja ? '物 · 9' : 'Objects · 9') && c.heads[1]?.text === (ja ? '動き · 2' : 'Motions · 2') && c.heads[2]?.text === (ja ? '素材 · 0' : 'Assets · 0'), 'Objects · 9 (hex ×4 = 4), Motions · 2, Assets · 0');
      check(c.drop, 'Assets · 0 has one drop place');
      check(c.left === 11 && c.all === 11 && c.headSum === 11, `one count: left ${c.left}, All ${c.all}, headings ${c.headSum}`);
      check(c.objects === 9 && c.motions === 2, `tiles: objects ${c.objects} (copies counted), motions ${c.motions}`);
      check(!c.count, `no second count line over the grid ("${c.count}")`);
      check(!c.multi, 'no Multi-select button on PC');
      check(c.ai.includes('✦') && (ja ? c.ai.includes('サインイン · 有料') : c.ai.includes('sign-in · paid')), `signed out: "${c.ai}"`);
      // Scrolled to "Assets · 0" and its drop place, for the photo (then back to the top).
      await g.page.eval(`document.querySelector('.gsl-group[data-group=assets]')?.scrollIntoView({ block: 'center' }), true`);
      await sleep(600);
      await g.shot('neon-assets');
      await g.page.eval(`document.querySelector('.gsl-group')?.scrollIntoView({ block: 'end' }), true`);
      const hopTile = await g.page.eval(`document.querySelector('.lib-motion[data-motion="Hop"]')?.innerText || ''`);
      check(!/Not attached|まだ付けて/.test(hopTile), `Hop's tile says nothing about being on nothing ("${hopTile.replace(/\n/g, ' ')}")`);

      // road: locked, drawn in code
      await g.press('.lib-object[data-key="road"]');
      await sleep(800);
      const road = await g.detailText();
      console.log(`road: ${road.replace(/\n/g, ' | ')}`);
      await g.shot('neon-road');
      check(!/No asset|素材なし|Drawn in code|コードで描いた/.test(road), 'road: no "No asset" line');
      check(!/settings|設定で固定/.test(road) && (ja ? road.includes('固定しています') : road.includes('Locked so it isn’t nudged')), 'road: locked in the strip’s words');
      check((ja ? road.includes('シーンで見る') : road.includes('Show in the scene')) && !/about it|これについて/.test(road), 'road: "Show in the scene" and "✦ Ask …" (no "about it")');

      // Hop: on nothing
      await g.press('.lib-motion[data-motion="Hop"]');
      await sleep(800);
      const hop = await g.detailText();
      console.log(`Hop: ${hop.replace(/\n/g, ' | ')}`);
      await g.shot('neon-hop');
      check(!/Not attached|まだ付けて/.test(hop), 'Hop: no "Not attached yet"');
      await g.press(`.lib-motion[data-motion=${JSON.stringify(SHIP_MOTION)}]`);
      await sleep(800);
      const sm = await g.detailText();
      check(/ship/.test(sm), `the ship's motion says it is on ship ("${sm.replace(/\n/g, ' | ').slice(0, 120)}")`);
      await g.shot('neon-ship-motion');
    } finally {
      await g.close();
    }
  }

  if (ONLY.includes('lantern')) {
    const g = await open(browser, kumo, 'starters/lantern-cove', { signedIn: true });
    try {
      await g.page.waitFor(`/\\$5\\.00/.test(document.querySelector('.gsl-ai-open')?.textContent || '') || ${!CHECKS}`, 20000).catch(() => undefined);
      await g.page.waitFor(`document.querySelectorAll('.gsl-tile[data-kind=file]').length > 0`, 20000).catch(() => undefined);
      await sleep(1500);
      const c = await g.counts();
      console.log(`lantern: ${JSON.stringify(c)}`);
      await g.shot('lantern-all');
      const assets = c.heads.find((h) => h.group === 'assets');
      check(!!assets && assets.text === (ja ? `素材 · ${c.files}` : `Assets · ${c.files}`) && c.files > 0, `Assets heading over ${c.files} files: "${assets?.text}"`);
      check(!c.drop, 'no drop place while there are assets');
      check(c.left === c.all && c.all === c.headSum, `one count: left ${c.left}, All ${c.all}, headings ${c.headSum}`);
      check(c.ai.includes('✦') && (ja ? c.ai.includes('残り $5.00') : c.ai.includes('$5.00 left')), `signed in: "${c.ai}"`);
      // Scrolled to the assets' heading, for the photo.
      await g.page.eval(`document.querySelector('.gsl-group[data-group=assets]')?.scrollIntoView({ block: 'start' }), true`);
      await sleep(600);
      await g.shot('lantern-assets');
    } finally {
      await g.close();
    }
  }
} finally {
  await kumo.close?.();
  await browser.close?.();
}
if (CHECKS) console.log(failed ? `${failed} FAILED` : 'all ok');
process.exit(failed ? 1 : 0);
