// Pictures for the wave 1 merge fixes (2026-10-17), the same steps every time:
//   - Lantern Cove: a real press (click / tap) on the middle of the lighthouse → what got picked, as the starter
//     opens and as test/web-demo had left it (moved, ×1.73). There the pine beside it used to win on a phone
//     (pick.js now sizes the part under the finger, not the tower + its light beam).
//   - Firefly Ruins: a real press on the urn → its card. On a phone the card is name, copy, delete and "…" only;
//     the Layer row is inside "…" (the review's "what to cut" 6 / D13), so a second picture with "…" open.
// No assertions (test/web-demo, test/studio-narrow and test/studio-layers check these); it prints what was picked.
// The barn (a drag on a phone moves it): node test/studio-unnamed.browser.mjs --shots <dir>.
//
//   node test/w1-merge-shots.browser.mjs --shots <dir> [--only pc,phone,phone430] [--theme light|dark|both]
//
// Needs the network for the starters' libraries (or STUDIO_CDN_CACHE).
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
const SHOTS = resolve(take('--shots', join(tmpdir(), 'studio-w1-merge-shots')));
const ONLY = take('--only', 'pc,phone,phone430').split(',');
const THEME = take('--theme', 'both');
const THEMES = THEME === 'both' ? ['light', 'dark'] : [THEME];
mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LAYOUTS = {
  pc: { width: 1280, height: 800 },
  phone: { width: 390, height: 844, mobile: true },
  // The phone the lighthouse tap failed on (test/web-demo 430).
  phone430: { width: 430, height: 932, mobile: true },
};
// `saved`: a placement.json written before the editor opens. 'lantern-cove-moved' is what test/web-demo had saved by
// its 430 visit (PC moved the sea stack, the 390 visit moved, turned and sized the lighthouse ×1.73): the scene where
// a tap on the lighthouse's middle picked "pine-3".
const SAVED = { version: 1, tool: 'placement', dim: '3d', space: 'local', objects: {
  'sea-stack': { p: [4.014, 0, 18.782], r: -1.0472, s: 1.7333 },
  lighthouse: { p: [-39.822, 6.635, -45.756], r: -1.0472, s: 1.7333 },
} };
const SCENES = [
  { id: 'lantern-cove', starter: 'lantern-cove', pick: 'lighthouse' },
  { id: 'lantern-cove-moved', starter: 'lantern-cove', pick: 'lighthouse', saved: SAVED },
  { id: 'firefly-ruins', starter: 'firefly-ruins', pick: 'urn', more: true },
];
const DBG = `document.querySelector('iframe').contentWindow.__gameStudio?._debug`;

async function run(layout, theme, scene) {
  const size = LAYOUTS[layout];
  const mobile = !!size.mobile;
  const root = mkdtempSync(join(tmpdir(), 'studio-w1-merge-shots-'));
  cpSync(join(PKG, 'starters', scene.starter), root, { recursive: true });
  if (scene.saved) writeFileSync(join(root, 'placement.json'), JSON.stringify(scene.saved, null, 1));
  mkdirSync(join(root, '.studio/ui'), { recursive: true });
  writeFileSync(join(root, '.studio/ui/prefs.json'), JSON.stringify({ version: 1, lang: 'en', theme }));
  const srv = await startStudioServer({ root, uiDir: join(PKG, 'skills/arrange/bin/studio-ui'), log: () => {} });
  const browser = await launch();
  const page = await newPage(browser, { ...size, cdnCache: process.env.STUDIO_CDN_CACHE });
  const tag = `${scene.id}-${layout}-${theme}`;
  const shot = async (name, wait = 700) => {
    await sleep(wait);
    writeFileSync(join(SHOTS, `${tag}-${name}.png`), await page.screenshot());
  };
  try {
    await page.goto(srv.url);
    await page.waitFor(`document.querySelectorAll('.obj').length > 0 && !!${DBG}`, 90000);
    await sleep(1500);
    const at = JSON.parse(await page.eval(`(() => { const f = document.querySelector('iframe').getBoundingClientRect(); const a = ${DBG}.anchor(${JSON.stringify(scene.pick)});
      return JSON.stringify({ x: f.left + a.center[0], y: f.top + a.center[1] }); })()`));
    if (mobile) await page.tap(at.x, at.y);
    else await page.click(at.x, at.y);
    await shot('picked', 1200);
    const picked = await page.eval(`window.studioShell.selected()`);
    // checkVisibility, not offsetParent: the content of a closed <details> ("…") keeps an offsetParent.
    const shown = `(() => { const r = document.querySelector('.card .layer-row'); return !!(r && r.checkVisibility() && r.getBoundingClientRect().height > 0); })()`;
    const layerOnCard = await page.eval(shown);
    const cardH = await page.eval(`Math.round(document.querySelector('.card')?.getBoundingClientRect().height || 0)`);
    console.log(`  ✓ ${tag}: a press on the middle of "${scene.pick}" picked "${picked}"; card ${cardH}px high, Layer row ${layerOnCard ? 'shown' : 'not shown'}`);
    if (scene.more && mobile) {
      await page.eval(`(() => { const f = document.querySelector('.card .fine'); if (f && !f.open) f.querySelector('summary').click(); })()`);
      const inMore = await page.eval(shown);
      await shot('more', 700);
      console.log(`  ✓ ${tag}: "…" open → Layer row ${inMore ? 'shown' : 'NOT shown'}`);
    }
  } catch (e) {
    console.log(`  ✗ ${tag}: ${e.message}`);
  } finally {
    await page.close();
    await browser.close();
    await srv.close();
    rmSync(root, { recursive: true, force: true });
  }
}

for (const layout of Object.keys(LAYOUTS).filter((l) => ONLY.includes(l))) {
  for (const theme of THEMES) for (const scene of SCENES) await run(layout, theme, scene);
}
console.log(`shots in ${SHOTS}`);
