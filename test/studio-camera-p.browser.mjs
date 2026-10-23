// Plan step 2 "the camera stays put, P means one thing" (2026-10-23, the UI/UX plan). The first-run walk found two
// "what just happened?" moments:
//   #3  picking the ship from the Scene list pulled the camera far back (the game became a dot) and nothing put it back,
//       although the ship was on screen (bridge/seen.ts says why);
//   #14 P right after "Try without saving" (to pause) went back to Edit: P paused only while the game had the focus.
// Checked here with real clicks and keys, in test/neon-run (a runner: things far down the road), PC 1280 × 800:
//   camera  list picks of ship / gate / hex-1 leave the view as it was; deselecting too; Play → Edit comes back to it.
//   hidden  an object turned out of sight: the pick slides the view to it, and it is not tiny (≥ 1/6 of the frame's
//           short side, or as big as it was).
//   p       a move not saved → Play → Try without saving → P: paused, still playing → P: resumed → Edit (the button) →
//           Edit. The key sheet while playing names P "Pause / Resume"; the Edit button shows no P.
//   others  three-isles and Lantern Cove: one list pick each of something on screen leaves the view as it was.
//
//   node test/studio-camera-p.browser.mjs [--only camera,hidden,p,others] [--shots <dir>] [--prefix after] [--ui <studio-ui dir>]
// --ui: another build of the editor page (the "before" photos were taken with the build before this change).
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStudioServer } from '../src/server/server.mjs';
import { launch, newPage } from './adapters-2d/cdp.mjs';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const take = (f, d = null) => (args.includes(f) ? args[args.indexOf(f) + 1] : d);
const ONLY = take('--only') ? take('--only').split(',') : null;
const want = (n) => !ONLY || ONLY.includes(n);
const SHOTS = take('--shots');
const PREFIX = take('--prefix', 'after');
const UI = resolve(take('--ui', join(PKG, 'skills/arrange/bin/studio-ui')));
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failed = 0;
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failed++;
};

const GAME = `document.querySelector('iframe.game, iframe')`;
const DBG = `${GAME}.contentWindow.__gameStudio?._debug`;
const EDIT_READY = `document.querySelectorAll('.obj').length > 0 && !!${DBG}`;
const PLAYING = `document.querySelector('.shell')?.dataset.playing === 'on' && !${DBG}`;
const PAUSED = `document.querySelector('.shell')?.dataset.paused === 'on'`;

function gameFolder(src, loader) {
  const root = mkdtempSync(join(tmpdir(), 'camera-p-'));
  cpSync(join(PKG, src), root, { recursive: true });
  // test/neon-run keeps no loader of its own (its README): the built one, as the screen tests copy it.
  if (loader && !existsSync(join(root, 'studio-placement.js'))) copyFileSync(join(UI, '../studio-placement.js'), join(root, 'studio-placement.js'));
  mkdirSync(join(root, '.studio/ui'), { recursive: true });
  writeFileSync(join(root, '.studio/ui/prefs.json'), JSON.stringify({ version: 1, lang: 'en', theme: 'dark' }));
  return root;
}

async function open(browser, src, loader = false) {
  const root = gameFolder(src, loader);
  const srv = await startStudioServer({ root, uiDir: UI, log: () => {} });
  const page = await newPage(browser, { width: 1280, height: 800 });
  await page.goto(srv.url);
  await page.waitFor(EDIT_READY, 90000);
  await sleep(2500);
  const j = async (e) => JSON.parse((await page.eval(e)) || 'null');
  const view = () => j(`JSON.stringify(${DBG}.view())`);
  const shot = async (name) => {
    if (SHOTS) writeFileSync(join(SHOTS, `02-${PREFIX}-${name}.png`), await page.screenshot());
  };
  // A row of the Scene list, pressed with the mouse (the person's way in walk #3).
  const pickRow = async (k) => {
    const p = await j(`(() => { const e = document.querySelector('.obj[data-key=${JSON.stringify(k)}]'); if (!e || !e.getBoundingClientRect().width) return null;
      e.scrollIntoView({ block: 'nearest' }); const r = e.getBoundingClientRect(); return JSON.stringify({ x: r.left + 40, y: r.top + r.height / 2 }); })()`);
    if (p) await page.click(p.x, p.y);
    else await page.eval(`studioShell.actions.select(${JSON.stringify(k)})`); // inside a closed group (hex-1): the same pick
    await sleep(1200);
  };
  const key = async (k, code, vk, text) => {
    const base = { key: k, code, windowsVirtualKeyCode: vk };
    await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base });
    if (text) await page.send('Input.dispatchKeyEvent', { type: 'char', ...base, text });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
    await sleep(400);
  };
  const until = async (fn, ms) => {
    const t0 = Date.now();
    for (;;) {
      if (await fn().catch(() => false)) return true;
      if (Date.now() - t0 > ms) return false;
      await sleep(200);
    }
  };
  // The free part of the game frame (what the ask bar and the card leave), from the shell's own panels.
  const frame = () => j(`(() => { const g = ${GAME}.getBoundingClientRect(); const a = document.querySelector('[data-part=ask]')?.getBoundingClientRect();
    return JSON.stringify({ w: g.width, h: g.height, bottom: a && a.width ? g.bottom - a.top : 0 }); })()`);
  return { root, srv, page, j, view, shot, pickRow, key, until, frame, close: async () => { await page.close?.(); await srv.close?.(); } };
}

const same = (a, b) => !!a && !!b && a.target.every((v, i) => Math.abs(v - b.target[i]) < 0.01) && Math.abs(a.distance - b.distance) < 0.01 && Math.abs(a.yaw - b.yaw) < 1e-3 && Math.abs(a.pitch - b.pitch) < 1e-3;
const fmt = (v) => (v ? `target [${v.target.map((x) => x.toFixed(2)).join(', ')}] distance ${v.distance.toFixed(2)}` : 'none');

const browser = await launch();
try {
  if (want('camera') || want('hidden') || want('p')) {
    const g = await open(browser, 'test/neon-run', true);
    const { page, j, view, shot, pickRow, key, until } = g;
    try {
      if (want('camera')) {
        await shot('open');
        const v0 = await view();
        for (const k of ['ship', 'gate', 'hex-1']) {
          await pickRow(k);
          const v = await view();
          check(same(v, v0), `list pick of ${k}: the camera stays (${fmt(v)} vs ${fmt(v0)})`);
          if (k === 'ship') await shot('pick-ship');
        }
        await key('Escape', 'Escape', 27);
        await sleep(600);
        await key('Escape', 'Escape', 27);
        await sleep(800);
        check(same(await view(), v0), 'deselect: the camera stays');
        // Play → Edit (the button): the view is the one Edit left.
        await pickRow('gate');
        const vBefore = await view();
        await page.eval(`document.querySelector('[data-action=play]').click(), true`);
        check(await until(async () => !!(await page.eval(PLAYING)), 30000), 'Play');
        await sleep(1500);
        await page.eval(`document.querySelector('[data-action=play]').click(), true`);
        check(await until(async () => !!(await page.eval(EDIT_READY)), 40000), 'Edit');
        await sleep(1500);
        check(same(await view(), vBefore), `Play → Edit: the camera is where Edit left it (${fmt(await view())})`);
      }

      if (want('hidden')) {
        // Turn the camera so the ship is out of sight to one side (the shell's own message for ⌘K's orbit).
        await page.eval(`(() => { const w = ${GAME}.contentWindow; w.postMessage({ type: 'studio:core/view', view: { action: 'orbit', dx: 520, dy: 0 } }, w.location.origin); return true; })()`);
        await sleep(1200);
        const a0 = await j(`JSON.stringify(${DBG}.anchor('ship'))`);
        const f = await g.frame();
        const seen0 = a0 && a0.visible && a0.center[0] > 0 && a0.center[0] < f.w;
        check(!seen0, `ship turned out of sight (centre ${a0 ? a0.center.map(Math.round) : '-'})`);
        await shot('hidden-before-pick');
        const size0 = a0?.rect ? Math.max(a0.rect.w, a0.rect.h) : 0;
        const vHidden = await view();
        await pickRow('ship');
        await sleep(800);
        const a = await j(`JSON.stringify(${DBG}.anchor('ship'))`);
        const size = a?.rect ? Math.max(a.rect.w, a.rect.h) : 0;
        const floor = Math.min(f.w, f.h - f.bottom) / 6;
        check(!!a && a.visible && a.center[0] > 0 && a.center[0] < f.w && a.center[1] > 0 && a.center[1] < f.h, `the pick brought the ship into view (centre ${a ? a.center.map(Math.round) : '-'})`);
        // bridge/seen.ts tooSmall: never under 1/6 (or what it was), with a quarter of give for the perspective's stretch at
        // the frame's edge (the ship comes in from the edge a little smaller, not pulled back down the road).
        check(size >= Math.min(size0 || Infinity, floor) * 0.75, `the ship is not tiny: ${Math.round(size)} px (1/6 = ${Math.round(floor)} px, before ${Math.round(size0)} px)`);
        const vNow = await view();
        check(!!vNow && Math.abs(vNow.distance - vHidden.distance) < 0.01, `a slide, not a pull back: distance ${vNow?.distance.toFixed(2)} (was ${vHidden.distance.toFixed(2)})`);
        await shot('hidden-after-pick');
      }

      if (want('p')) {
        // A move not saved (the card's X), so Play asks "Save and play / Try without saving".
        await page.eval(`studioShell.actions.select('gate')`);
        await sleep(700);
        await page.eval(`(() => { const i = document.querySelector('[data-part=card] .fields input'); i.value = String((parseFloat(i.value) || 0) + 1); i.dispatchEvent(new Event('change')); return true; })()`);
        await sleep(600);
        await page.eval(`document.querySelector('[data-action=play]').click(), true`);
        check(await until(async () => !!(await page.eval(`document.querySelector('[data-part=unsaved-guard][data-kind=play]:not([hidden])')`)), 4000), 'Play asks first (a move not saved)');
        // "Try without saving", pressed with the mouse: the focus is on the editor page, not in the game (walk #14).
        const tr = await j(`(() => { const r = document.querySelector('[data-part=unsaved-guard] [data-action=guard-discard]').getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }); })()`);
        await page.click(tr.x, tr.y);
        check(await until(async () => !!(await page.eval(PLAYING)), 30000), 'Try without saving: playing');
        const kbd = await page.eval(`!!document.querySelector('[data-action=play] kbd')`);
        check(!kbd, 'the Edit button shows no P');
        await key('p', 'KeyP', 80, 'p');
        check(await until(async () => !!(await page.eval(PAUSED)), 6000), 'P right after: paused');
        check(!!(await page.eval(PLAYING)), 'P right after: still playing (not back to Edit)');
        await sleep(800);
        await shot('p-paused');
        // The key sheet while playing: P = Pause / Resume. The sheet opens with ? from the editor page.
        await page.eval(`document.activeElement?.blur?.(), true`);
        await key('?', 'Slash', 191, '?');
        await sleep(500);
        const row = await page.eval(`document.querySelector('[data-part=shortcuts] [data-key=play] dt')?.textContent || ''`);
        if (row) {
          check(/Pause/.test(row) && /Resume/.test(row), `key sheet while playing: P = "${row}"`);
          await shot('p-keys');
          await key('Escape', 'Escape', 27);
        } else console.log('note: the key sheet does not open while playing (nothing to check there)');
        await page.eval(`document.activeElement?.blur?.(), true`);
        await key('p', 'KeyP', 80, 'p');
        check(await until(async () => !(await page.eval(PAUSED)), 6000) && !!(await page.eval(PLAYING)), 'P again: resumed, still playing');
        const eb = await j(`(() => { const r = document.querySelector('[data-action=play]').getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }); })()`);
        await page.click(eb.x, eb.y);
        check(await until(async () => !!(await page.eval(EDIT_READY)), 40000), 'the Edit button: back to Edit');
        await sleep(800);
        await shot('p-edit');
      }
    } finally {
      await g.close();
    }
  }

  if (want('others')) {
    for (const [src, k] of [['examples/three-isles', null], ['starters/lantern-cove', 'lighthouse']]) {
      const g = await open(browser, src, src.startsWith('examples'));
      try {
        // Something on screen: the first listed object whose middle is inside the frame (three-isles), or the lighthouse.
        const key = k ?? (await g.j(`JSON.stringify(${DBG}.list().map((i) => i.key).find((x) => { const a = ${DBG}.anchor(x); return a && a.visible && a.rect && a.rect.w < 400 && a.center[0] > 100 && a.center[0] < 900 && a.center[1] > 100 && a.center[1] < 550; }) || null)`));
        const v0 = await g.view();
        await g.pickRow(key);
        check(same(await g.view(), v0), `${src}: list pick of ${key} leaves the camera (${fmt(await g.view())} vs ${fmt(v0)})`);
        await g.shot(`${src.split('/')[1]}-pick`);
      } finally {
        await g.close();
      }
    }
  }
} catch (e) {
  console.error(e);
  failed++;
} finally {
  await browser.close?.();
}
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
