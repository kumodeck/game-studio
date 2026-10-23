// The bottom sheet folds (a try of v0.1.7 in the Claude app's side window with an AI-made NEON ORB, 2026-10-21: "it's
// too hard to use from the Claude sidebar — the bottom menu has to be able to be minimised"). In its screenshot the
// sheet (Scene | Library, the list, "11 selected", "Deselect" on a row of its own, the ask bar) took the lower half of
// the window, the list's rows lay over one another ("tile-3" over "tile-3-6") and over the card, and the grip at the
// sheet's top did nothing a person could find.
//
// A NEON ORB-like 3D game (rows of named tiles), the real server and the built shell, in the side window
// (400×900, a mouse) and on a phone (390×844, touch):
//   1. one press on the grip folds the sheet, the card and the AI's line: one row stays (the ask bar with what is
//      picked, "×11"), and the game is seen over at least 80 % of the window
//   2. folded, a pick (one, then 11) and the AI's answer do not open it again (the AI's news is a dot on ▴)
//   3. one press on ▴ opens it as it was; the fold is kept across a reload
//   4. with 11 picked, in the low sheet and with a group opened: no two list rows overlap, and none lies under the card
//   5. "Deselect" is not a row of its own: it sits in the card's head (read on the sheet's card tab since plan step 7)
//
//   node test/studio-side-sheet.browser.mjs [--shots <dir>] [--tag before|after] [--only side,phone] [--theme dark,light]
//     [--no-assert] [--ui <dir>] (pictures only, and another built shell: the "before" set, from the commit before the fold)
// Exit 1 on failure.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStudioServer } from '../src/server/server.mjs';
import { launch, newPage } from './adapters-2d/cdp.mjs';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(PKG, 'skills/arrange/bin/studio.mjs');
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const SHOTS = opt('--shots') ? resolve(opt('--shots')) : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const TAG = opt('--tag') || 'after';
const CHECK = !args.includes('--no-assert');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// NEON ORB, cut down: eight rows of eleven tiles ("tile-r-c", loose meshes: the list folds each row as a kind
// "tile-r ×11", as in the screenshot of that try), a few orbs and the player.
const GAME = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Neon Orb</title><style>html,body{margin:0;height:100%;overflow:hidden;background:#06041a}</style>
<script type="importmap">{ "imports": { "three": "https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.module.min.js" } }</script>
</head><body><script type="module">
import * as THREE from 'three';
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x07051c);
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 300);
camera.position.set(0, 9, 14);
camera.lookAt(0, 0, -2);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
scene.add(new THREE.HemisphereLight(0x8899ff, 0x221144, 2));
const tileMat = new THREE.MeshStandardMaterial({ color: 0x1a1260, emissive: 0x2a1a90, emissiveIntensity: 0.4 });
for (let r = 0; r < 8; r++) {
  for (let c = 0; c < 11; c++) { const t = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.3, 1.4), tileMat); t.name = 'tile-' + r + '-' + c; t.position.set((c - 5) * 1.5, 0, -r * 1.5 + 4); scene.add(t); }
}
for (let i = 0; i < 6; i++) { const o = new THREE.Mesh(new THREE.OctahedronGeometry(0.35), new THREE.MeshStandardMaterial({ color: 0x33cc88, emissive: 0x33cc88, emissiveIntensity: 0.6 })); o.name = 'orb-' + i; o.position.set((i % 3 - 1) * 4, 0.8, 2 - Math.floor(i / 3) * 6); scene.add(o); }
const player = new THREE.Mesh(new THREE.SphereGeometry(0.5, 24, 16), new THREE.MeshStandardMaterial({ color: 0xff6a00, emissive: 0xff6a00, emissiveIntensity: 0.8 })); player.name = 'player'; player.position.set(0, 0.7, 4); scene.add(player);
renderer.setAnimationLoop(() => renderer.render(scene, camera));
</script></body></html>`;

const DEVICES = [
  { id: 'side', width: 400, height: 900, mobile: false },
  { id: 'phone', width: 390, height: 844, mobile: true },
].filter((d) => !opt('--only') || opt('--only').split(',').includes(d.id));
const THEMES = (opt('--theme') || 'dark,light').split(',');

const WIN = `document.querySelector('iframe').contentWindow`;
const READY = `document.querySelectorAll('.obj, .noname:not([hidden])').length > 0 && !!${WIN}.__gameStudio?._debug`;
// How much of the window the game is seen over: from the stage's top to the highest thing that covers its foot (the
// sheet, the dock: card, AI line, bar). The Save pill and the strip float on the game and are not counted.
const MEASURE = `(() => {
  const H = innerHeight;
  const stage = document.querySelector('iframe').getBoundingClientRect();
  const shown = (e) => { if (!e) return false; const s = getComputedStyle(e); if (s.display === 'none' || s.visibility === 'hidden') return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.top < H && r.bottom > 0; };
  const side = document.querySelector('.side');
  const covers = [side, document.querySelector('.dock')].filter(shown).map((e) => e.getBoundingClientRect().top);
  const foot = Math.min(stage.bottom, ...covers);
  // The list's scroll box (the sheet's panel): rows outside it are clipped, not drawn.
  const box = document.querySelector('.side .panel');
  const boxR = box && box.getBoundingClientRect();
  const card = document.querySelector('.card-slot > .card:not([hidden])');
  const cardR = shown(card) ? card.getBoundingClientRect() : null;
  // The rows drawn in the list's box (not scrolled out): their boxes, to check that none lies over another or under the card.
  const rows = shown(side) && boxR ? [...document.querySelectorAll('.side .list-scroll > .noname:not([hidden]), .side .list-scroll .obj')].filter((e) => e.offsetParent)
    .map((e) => ({ e, r: e.getBoundingClientRect() })).filter(({ r }) => r.bottom > boxR.top + 1 && r.top < boxR.bottom - 1) : [];
  const name = (e) => e.innerText.replace(/\\s+/g, ' ').trim().slice(0, 24);
  const over = [];
  for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
    const a = rows[i].r, b = rows[j].r;
    // Nested (a group's head holds its members' list): only the head's own line counts.
    if (rows[i].e.contains(rows[j].e) || rows[j].e.contains(rows[i].e)) continue;
    if (Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) over.push(name(rows[i].e) + ' / ' + name(rows[j].e));
  }
  // Under the card = the part of a row drawn in its box (the box clips the rest) where the card is: the card covers it.
  const underCard = cardR ? rows.filter(({ r }) => Math.min(r.bottom, boxR.bottom) > cardR.top + 1 && Math.max(r.top, boxR.top) < cardR.bottom).map(({ e }) => name(e)) : [];
  const deselect = document.querySelector('[data-action=select-none]');
  const dr = shown(deselect) ? deselect.getBoundingClientRect() : null;
  const head = card && card.querySelector('.card-head');
  return JSON.stringify({ H, game: Math.round(foot - stage.top), share: +((foot - stage.top) / H).toFixed(2), sheet: shown(side), card: !!cardR,
    caption: shown(document.querySelector('.ai-caption')), fold: document.querySelector('.shell').dataset.fold || '', rows: rows.length, over, underCard,
    deselectInHead: !!dr && !!head && head.contains(deselect), chip: (document.querySelector('.ask-chip:not([hidden])') || {}).textContent || '',
    news: document.querySelector('[data-action=sheet]')?.dataset.news || '' });
})()`;
// A real press on an element (the grip listens to pointer events, not to click()).
const center = (sel) => `JSON.stringify((() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.offsetParent); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })())`;

let failed = 0;
const fail = (e) => {
  failed++;
  console.log(`  ✗ ${e.message}`);
};
const check = (fn) => {
  if (!CHECK) return;
  try {
    fn();
  } catch (e) {
    fail(e);
  }
};

for (const dev of DEVICES) {
  for (const theme of THEMES) {
    const tag = `${dev.id}-${dev.width}x${dev.height}-${theme}`;
    const root = mkdtempSync(join(tmpdir(), 'studio-side-sheet-'));
    writeFileSync(join(root, 'index.html'), GAME);
    mkdirSync(join(root, '.studio/ui'), { recursive: true });
    writeFileSync(join(root, '.studio/ui/prefs.json'), JSON.stringify({ version: 1, lang: 'ja' }));
    const srv = await startStudioServer({ root, uiDir: opt('--ui') ? resolve(opt('--ui')) : join(PKG, 'skills/arrange/bin/studio-ui'), log: () => {} });
    const browser = await launch();
    const page = await newPage(browser, { width: dev.width, height: dev.height, mobile: dev.mobile });
    const shot = async (name) => SHOTS && writeFileSync(join(SHOTS, `${TAG}-${tag}-${name}.png`), await page.screenshot());
    const m = async () => JSON.parse(await page.eval(MEASURE));
    const press = async (sel) => {
      const p = JSON.parse(await page.eval(center(sel)));
      assert.ok(p, `${tag}: nothing to press at ${sel}`);
      if (dev.mobile) await page.tap(p.x, p.y);
      else await page.click(p.x, p.y);
      await sleep(600);
    };
    const keys = () => page.eval(`JSON.stringify(studioShell.items().map((i) => i.key))`).then(JSON.parse);
    try {
      await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
      await page.goto(srv.url);
      await page.waitFor(READY, 30000);
      await sleep(800);
      // Start from an open sheet whatever the last run left (the fold is kept in this browser).
      await page.eval(`(() => { try { localStorage.removeItem('studio.sheetFold'); } catch {} })()`);
      await page.goto(srv.url);
      await page.waitFor(READY, 30000);
      await sleep(800);
      if ((await page.eval(`document.querySelector('.shell').dataset.sheet`)) !== 'open') await press('[data-action=sheet]');
      const all = await keys();
      const row3 = all.filter((k) => /tile-3-\d+$/.test(k));
      // 0. nothing picked, the sheet open.
      await shot('1-none');
      // 1 picked.
      await page.eval(`studioShell.actions.select(${JSON.stringify(row3[0] || all[0])})`);
      await sleep(900);
      await shot('2-one');
      // 11 picked (a whole row of tiles, as in the screenshot of that try) and the group opened in the list.
      await page.eval(`studioShell.actions.selectMany(${JSON.stringify(row3)}, ${JSON.stringify(row3[6] || row3[0])})`);
      await sleep(900);
      await page.eval(`(() => { const r = [...document.querySelectorAll('.side .list-scroll .obj.group-row')].find((e) => e.querySelector('.name')?.textContent.trim() === 'tile-3');
        const x = r && r.querySelector('.expand[aria-expanded=false]'); if (x) x.click(); })()`);
      await sleep(600);
      const many = await m();
      await shot('3-eleven');
      console.log(`  ${tag} open, 11 picked: game ${many.game}px (${many.share}); ${many.rows} rows; over: ${many.over.join(', ') || 'none'}; under the card: ${many.underCard.join(', ') || 'none'}; Deselect in the card's head: ${many.deselectInHead}`);
      check(() => {
        assert.equal(many.over.length, 0, `${tag}: list rows overlap: ${many.over.join(', ')}`);
        assert.equal(many.underCard.length, 0, `${tag}: rows under the card: ${many.underCard.join(', ')}`);
      });
      // Plan step 7 (2026-10-23): the sheet shows the list OR the card (its Scene | ×11 tabs), so "Deselect" is read on
      // the card's tab, then the list comes back for the rest of the run.
      await press('[data-part=sheet-tabs] [data-tab=pick]');
      const card = await m();
      check(() => assert.ok(card.deselectInHead, `${tag}: "Deselect" is not in the card's head`));
      await press('[data-part=sheet-tabs] [data-tab=scene]');
      // Pulled up (side window: the grip dragged up), the rows still do not overlap.
      if (!dev.mobile) {
        const g = JSON.parse(await page.eval(center('.sheet-grip')));
        if (g) {
          await page.mouseDrag(g.x, g.y, g.x, g.y - 220, 8);
          await sleep(700);
          const tall = await m();
          await shot('3b-eleven-tall');
          check(() => assert.equal(tall.over.length, 0, `${tag}: rows overlap in the tall sheet: ${tall.over.join(', ')}`));
        }
      }
      // AI asked, and working on it.
      await page.eval(`(() => { const i = document.querySelector('.ask-input'); i.value = 'これらを光らせて'; i.dispatchEvent(new Event('input', { bubbles: true })); i.form.requestSubmit(); })()`);
      let id = null;
      for (let i = 0; i < 40 && !id; i++) {
        await sleep(150);
        const dir = join(root, '.studio/requests');
        id = existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith('.json'))[0]?.replace(/\.json$/, '') : null;
      }
      assert.ok(id, `${tag}: the ask wrote no request`);
      const status = (...a) => spawnSync(process.execPath, [CLI, root, '--status', ...a, '--request', id], { encoding: 'utf8' });
      status('received');
      status('working', '--note', 'タイルを光らせています…');
      await sleep(1500);
      await shot('4-asking');

      // 1. Fold: one press on the grip (side window) / on ▾ at the bar's left (phone, where the grip is the drawn bar).
      if (!CHECK) continue;
      await press(dev.mobile ? '[data-action=sheet]' : '.sheet-grip');
      await sleep(400);
      const folded = await m();
      await shot('5-folded-asking');
      console.log(`  ${tag} folded: game ${folded.game}px (${folded.share}); sheet ${folded.sheet}, card ${folded.card}, AI line ${folded.caption}; chip "${folded.chip}"`);
      check(() => {
        assert.equal(folded.fold, 'min', `${tag}: not folded`);
        assert.equal(folded.sheet, false, `${tag}: the sheet still shows folded`);
        assert.equal(folded.card, false, `${tag}: the card still shows folded`);
        assert.equal(folded.caption, false, `${tag}: the AI's line still shows folded`);
        assert.ok(folded.share >= 0.8, `${tag}: folded, the game is seen over ${folded.share} of the window (want ≥ 0.8)`);
        assert.match(folded.chip, /11/, `${tag}: folded, the one row does not say what is picked`);
      });
      // 2. Folded: the AI answers, picks change — nothing opens.
      status('done', '--changed', '0', '--note', 'タイルを光らせました');
      await sleep(1500);
      const answered = await m();
      check(() => {
        assert.equal(answered.fold, 'min', `${tag}: the AI's answer unfolded the sheet`);
        assert.equal(answered.caption, false, `${tag}: the AI's answer showed its line over the fold`);
        assert.equal(answered.news, 'on', `${tag}: the AI's answer left no dot on ▴`);
      });
      await page.eval(`studioShell.actions.select(${JSON.stringify('player')})`);
      await sleep(800);
      const one = await m();
      await shot('6-folded-one');
      check(() => {
        assert.equal(one.fold, 'min', `${tag}: a pick unfolded the sheet`);
        assert.equal(one.card, false, `${tag}: a pick showed the card over the fold`);
        assert.ok(one.share >= 0.8, `${tag}: folded with a pick, the game is seen over ${one.share}`);
      });
      // 3. Kept across a reload.
      await page.goto(srv.url);
      await page.waitFor(READY, 30000);
      await sleep(1000);
      const again = await m();
      await shot('7-folded-reload');
      check(() => assert.equal(again.fold, 'min', `${tag}: the fold was not kept across a reload`));
      // One press on ▴ opens it again.
      await press('[data-action=sheet]');
      const open = await m();
      await shot('8-unfolded');
      check(() => {
        assert.equal(open.fold, '', `${tag}: ▴ did not unfold`);
        assert.equal(open.sheet, true, `${tag}: unfolded, the list sheet is not back`);
      });
      if (CHECK && !failed) console.log(`  ✓ ${tag}: folds in one press (game ${folded.share} of the window), stays folded through an answer, a pick and a reload, and opens in one press`);
    } catch (e) {
      fail(e);
      for (const l of page.logs.filter((x) => /exception|error/.test(x)).slice(-5)) console.log(`    ${l}`);
    } finally {
      await page.close();
      await browser.close();
      await srv.close?.();
      rmSync(root, { recursive: true, force: true });
    }
  }
}
if (failed) {
  console.log(`studio-side-sheet: ${failed} failed`);
  process.exit(1);
}
console.log('studio-side-sheet: ok');
process.exit(0);
