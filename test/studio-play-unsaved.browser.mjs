// Play without Save keeps the unsaved changes (a try of the editor, 2026-10-21: "I moved things, pressed Play without Save, and
// everything was reset. People want to try a change in Play first, then save it").
//
// The reset came from games that do not read placement.json themselves (one the AI just made, before "add the
// loader"): Play opened the game at its code's layout, and so did the editor's own page after Play (the card and
// "Save · 1" still said "moved"). Each case below moves things WITHOUT saving, presses Play with a real click / tap,
// and compares the running game with what the editor showed, then goes back to Edit and compares again:
//
//   cove          Lantern Cove (3D, reads placement.json): the lighthouse moved; ⌘Z / ⇧⌘Z / Save after (one request)
//   cove-bare     the same game without its loader line (the case of that try): PC, the chat's side window, a phone
//   ruins / ruins-bare   Firefly Ruins (2D), with and without its loader: one object moved, one copied, one deleted
//   glow / glow-bare     Glow Garden (examples/three-hud, a three.js world with an HTML UI): the title card moved on
//                 the UI layer (its CSS translate in the running game)
//   demo          the web demo (saves in this browser), Lantern Cove: PC and a phone
// In Play the top bar says "Playing · unsaved changes" (not on a phone: the bar has no "Playing" there).
//
//   node test/studio-play-unsaved.browser.mjs [--shots <dir>] [--tag before|after] [--only cove,cove-bare,…]
//     [--layouts pc,side,phone] [--ui <a built studio-ui folder>]
// Exit 1 on failure.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStudioServer } from '../src/server/server.mjs';
import { launch, newPage } from './adapters-2d/cdp.mjs';
import { startHost } from './web-demo-host.mjs';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const SHOTS = opt('--shots') ? resolve(opt('--shots')) : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const TAG = opt('--tag') || 'after';
const ONLY = opt('--only') ? opt('--only').split(',') : null;
const LAYOUT_ONLY = opt('--layouts') ? opt('--layouts').split(',') : null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LAYOUTS = {
  pc: { id: 'pc', width: 1280, height: 800, mobile: false, dpr: 1 },
  side: { id: 'side', width: 400, height: 900, mobile: false, dpr: 2 },
  phone: { id: 'phone', width: 390, height: 844, mobile: true, dpr: 2 },
};

const GAME = `document.querySelector('iframe').contentWindow`;
const EDIT_READY = `document.querySelectorAll('.obj, .noname').length > 0 && !!${GAME}?.__gameStudio?._debug`;
// --ui <dir>: another build of the editor (the "before" photos: the build from before this fix has no `_play`, so a
// 3D game's objects are then read from three.js itself).
const UI_DIR = opt('--ui') ? resolve(opt('--ui')) : join(PKG, 'skills/arrange/bin/studio-ui');
const THREE_LIST = `(() => { const out = []; for (const s of ${GAME}.__studioThree?.scenes || []) s.traverse((o) => { const k = o.userData?.studioKey;
  if (k && o.visible) out.push({ key: k, pose: { p: [o.position.x, o.position.y, o.position.z] } }); }); return out; })()`;
const PLAY_READY = `!!${GAME}?.__gameStudio && !${GAME}.__gameStudio._debug && ((${GAME}.__gameStudio._play?.list() || ${THREE_LIST}) || []).length > 0`;
const LIST = `JSON.stringify(${GAME}.__gameStudio._debug ? ${GAME}.__gameStudio._debug.list() : (${GAME}.__gameStudio._play?.list() || ${THREE_LIST}))`;
const UI_AT = (k) => `(() => { const e = ${GAME}.document.querySelector('[data-studio-key=${JSON.stringify(k)}]'); return e ? getComputedStyle(e).translate : null; })()`;
const FAB = `(() => { const f = document.querySelector('[data-part=save-fab]'); return f && !f.hidden && f.offsetParent ? f.innerText.replace(/\\s+/g, ' ').trim() : ''; })()`;
const NOTE = `(() => { const n = document.querySelector('.brand .here-note'); return n && !n.hidden && n.offsetParent ? n.textContent : ''; })()`;
const keyDown = (k, extra = {}) => `window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true, ...${JSON.stringify(extra)} }))`;
const PLAY_BTN = `(() => { const b = [...document.querySelectorAll('[data-action=play]')].find((x) => x.offsetParent && x.getBoundingClientRect().width); if (!b) return null; const r = b.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }); })()`;

let failed = 0;
const check = (ok, what) => {
  console.log(`  ${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failed++;
};
const close = (a, b, d) => !!a && !!b && a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < d);

/** A copy of a starter / example, optionally without its loader line (a game that does not read placement.json). */
function gameFolder(src, bare) {
  const root = mkdtempSync(join(tmpdir(), 'play-unsaved-'));
  cpSync(join(PKG, src), root, { recursive: true });
  if (bare) {
    let n = 0;
    for (const f of ['js/main.js', 'game.js']) {
      const p = join(root, f);
      if (!existsSync(p)) continue;
      writeFileSync(p, readFileSync(p, 'utf8').replace(/await applyPlacement\([^)]*\);/g, () => (n++, '/* no loader (test) */')));
    }
    if (!n) throw new Error(`${src}: no applyPlacement line to take out`);
  }
  mkdirSync(join(root, '.studio/ui'), { recursive: true });
  writeFileSync(join(root, '.studio/ui/prefs.json'), JSON.stringify({ version: 1, lang: 'en' }));
  return root;
}

const browser = await launch();
async function run(name, layout, opts) {
  if (LAYOUT_ONLY && !LAYOUT_ONLY.includes(layout.id)) return;
  const tag = `${name}-${layout.id}`;
  console.log(tag);
  const page = await newPage(browser, { width: layout.width, height: layout.height, mobile: layout.mobile });
  if (!layout.mobile) await page.send('Emulation.setDeviceMetricsOverride', { width: layout.width, height: layout.height, deviceScaleFactor: layout.dpr, mobile: false });
  let n = 0;
  const shot = async (what) => SHOTS && writeFileSync(join(SHOTS, `${tag}-${TAG}-${++n}-${what}.png`), await page.screenshot());
  const list = async () => JSON.parse((await page.eval(LIST)) || '[]');
  const poseOf = async (k) => (await list()).find((i) => i.key === k)?.pose?.p || null;
  /** Wait (up to `ms`) for `fn()` to be true: the editor and the bridge glide poses, so a read right away can be mid-way. */
  const until = async (fn, ms = 6000) => {
    const t0 = Date.now();
    for (;;) {
      if (await fn().catch(() => false)) return true;
      if (Date.now() - t0 > ms) return false;
      await sleep(200);
    }
  };
  const press = async (p) => (layout.mobile ? page.tap(p.x, p.y) : page.click(p.x, p.y));
  const togglePlay = async () => {
    const b = JSON.parse((await page.eval(PLAY_BTN)) || 'null');
    if (b) await press(b);
    else await page.eval(keyDown('p'));
  };
  /** The card's first number (X), by `d`: one change, as a person types it. */
  const nudgeX = async (d) => page.eval(`(() => { const i = document.querySelector('[data-part=card] .fields input'); if (!i) return false;
    i.value = String((parseFloat(i.value) || 0) + ${d}); i.dispatchEvent(new Event('change')); return true; })()`);
  try {
    if (opts.fresh) {
      // The web demo keeps its saves in this browser, shared by the cases: start each one from the sample as shipped
      // (cleared from a plain page of the same site, so no open connection blocks the delete).
      await page.goto(opts.fresh);
      await page.eval(`new Promise((r) => { try { localStorage.clear(); } catch {} const q = indexedDB.deleteDatabase('kumodeck-game-studio-demo'); q.onsuccess = q.onerror = q.onblocked = () => r(true); })`);
    }
    await page.goto(opts.url);
    await page.waitFor(EDIT_READY, 40000);
    await sleep(1200);
    await opts.steps({ page, tag, shot, list, poseOf, until, togglePlay, nudgeX });
  } catch (e) {
    check(false, `${tag}: ${e.message}`);
  } finally {
    await page.close();
  }
}

/** The world's case: move (and copy / delete), Play, back to Edit. */
function worldSteps({ move, d, copy, del, extra }) {
  return async (t) => {
    const { page, shot, poseOf, until, togglePlay, nudgeX, list } = t;
    const start = await poseOf(move);
    await page.eval(`studioShell.actions.select(${JSON.stringify(move)})`);
    await sleep(700);
    check(await nudgeX(d), `moved ${move} with the card`);
    let copyKey = null;
    if (copy) {
      const before = new Set((await list()).map((i) => i.key));
      await page.eval(`studioShell.actions.select(${JSON.stringify(copy)})`);
      await sleep(500);
      await page.eval(`studioShell.actions.copy()`);
      await until(async () => (await list()).some((i) => !before.has(i.key)), 4000);
      copyKey = (await list()).find((i) => !before.has(i.key))?.key || null;
      check(!!copyKey, `copied ${copy} (${copyKey})`);
    }
    if (del) {
      await page.eval(`studioShell.actions.select(${JSON.stringify(del)})`);
      await sleep(500);
      await page.eval(`studioShell.actions.remove()`);
      check(await until(async () => !(await list()).some((i) => i.key === del), 4000), `deleted ${del}`);
    }
    // Where the typed X puts it (the card's X is the object's own x: both samples' objects sit right under the root).
    // The editor glides a typed move (an ease that overshoots a little), so wait until it is there.
    const moved = [start[0] + d, ...start.slice(1)];
    const t0 = Date.now();
    // The card's X, or the page's own list: a paused game page (the editor holds its frames) can list the old pose until
    // it draws again (seen on the web demo's first case under load), while the card already shows the move.
    const cardX = async () => parseFloat(await page.eval(`document.querySelector('[data-part=card] .fields input')?.value`));
    check(await until(async () => close(await poseOf(move), moved, 0.06) || Math.abs((await cardX()) - moved[0]) < 0.06, 10000),
      `${move} in the editor: ${start} → ${await poseOf(move)} / card X ${await cardX()} (want ${moved}, ${Date.now() - t0} ms)`);
    const copyAt = copyKey ? await poseOf(copyKey) : null;
    const fab = await page.eval(FAB);
    check(/\d/.test(fab), `not saved ("${fab}")`);
    await shot('edit-moved');
    const same = async () => {
      const keys = (await list()).map((i) => i.key);
      return close(await poseOf(move), moved, 0.06) && (!copyKey || (keys.includes(copyKey) && close(await poseOf(copyKey), copyAt, 0.06))) && (!del || !keys.includes(del));
    };
    const where = async () => {
      const keys = (await list()).map((i) => i.key);
      return `${move} at ${await poseOf(move)}${copyKey ? `, copy ${keys.includes(copyKey) ? 'there' : 'missing'}` : ''}${del ? `, ${del} ${keys.includes(del) ? 'still there' : 'gone'}` : ''}`;
    };

    await togglePlay();
    await page.waitFor(PLAY_READY, 40000);
    check(await until(same), `Play: as in the editor (${await where()})`);
    const note = await page.eval(NOTE);
    // A phone and the chat's side window (both the narrow layout) show only the game's name in the bar: no "Playing"
    // to stand next to, and no note either (Edit on the right says it is playing).
    if ((await page.eval(`document.querySelector('.shell').dataset.layout`)) === 'phone') check(note === '', 'narrow layout: no note (the bar has no "Playing" there)');
    else check(/unsaved/.test(note), `the top bar says it ("${note}")`);
    await sleep(800);
    await shot('play');

    await togglePlay();
    await page.waitFor(EDIT_READY, 40000);
    check(await until(same), `back to Edit: still as before (${await where()})`);
    const fab2 = await page.eval(FAB);
    check(fab2 === fab, `back to Edit: "${fab2}" as before`);
    check((await page.eval(NOTE)) === '', 'no note in Edit');
    await sleep(500);
    await shot('edit-back');
    if (extra) await extra({ ...t, start, moved });
  };
}

const roots = [];
let srv = null;
const serve = async (root) => {
  if (srv) await srv.close?.();
  srv = await startStudioServer({ root, uiDir: UI_DIR, log: () => {} });
  return srv.url;
};
const want = (name) => !ONLY || ONLY.includes(name);
try {
  // Lantern Cove with its loader, PC: also ⌘Z / ⇧⌘Z / Save after Play.
  if (want('cove')) {
    const root = gameFolder('starters/lantern-cove', false);
    roots.push(root);
    await run('cove', LAYOUTS.pc, { url: await serve(root), steps: worldSteps({ move: 'lighthouse', d: 6, extra: async ({ page, poseOf, until, start, moved }) => {
      await page.eval(keyDown('z', { metaKey: true }));
      check(await until(async () => close(await poseOf('lighthouse'), start, 0.06)), '⌘Z after Play: back where the game had it');
      await page.eval(keyDown('z', { metaKey: true, shiftKey: true }));
      check(await until(async () => close(await poseOf('lighthouse'), moved, 0.06)), '⇧⌘Z: moved again');
      await page.eval(`studioShell.actions.save()`);
      await sleep(1500);
      const file = JSON.parse(readFileSync(join(root, 'placement.json'), 'utf8'));
      check(Math.abs((file.objects?.lighthouse?.p?.[0] ?? 0) - moved[0]) < 0.05, 'Save: placement.json has the move');
      const reqs = existsSync(join(root, '.studio/requests')) ? readdirSync(join(root, '.studio/requests')).filter((f) => f.endsWith('.json')) : [];
      check(reqs.length === 1, `Save: one request for the AI (${reqs.length})`);
      // The button says "✓ Saved" for a moment, then goes; no count either way.
      const fabAfter = await page.eval(FAB);
      check(!/\d/.test(fabAfter), `Save: no count left ("${fabAfter}")`);
    } }) });
  }
  // The case of that try: a game that does not read placement.json. PC, the side window, a phone.
  if (want('cove-bare')) {
    for (const l of [LAYOUTS.pc, LAYOUTS.side, LAYOUTS.phone]) {
      const root = gameFolder('starters/lantern-cove', true);
      roots.push(root);
      await run('cove-bare', l, { url: await serve(root), steps: worldSteps({ move: 'lighthouse', d: 6 }) });
    }
  }
  for (const bare of [true, false]) {
    const name = bare ? 'ruins-bare' : 'ruins';
    if (!want(name)) continue;
    const root = gameFolder('starters/firefly-ruins', bare);
    roots.push(root);
    await run(name, LAYOUTS.pc, { url: await serve(root), steps: worldSteps({ move: 'urn', d: 40, copy: 'lantern', del: 'banner' }) });
  }
  // Glow Garden: the title card moved on the UI layer.
  for (const bare of [false, true]) {
    const name = bare ? 'glow-bare' : 'glow';
    if (!want(name)) continue;
    const root = gameFolder('examples/three-hud', bare);
    roots.push(root);
    await run(name, LAYOUTS.pc, { url: await serve(root), steps: async ({ page, shot, until, togglePlay, nudgeX }) => {
      const K = 'title-card';
      const at0 = await page.eval(UI_AT(K));
      await page.eval(keyDown('u'));
      await sleep(900);
      await page.eval(`studioShell.actions.select(${JSON.stringify(K)})`);
      await sleep(700);
      check(await nudgeX(60), 'moved the title card with the card');
      await sleep(800);
      const at1 = await page.eval(UI_AT(K));
      check(at1 !== at0, `the title card: ${at0} → ${at1}`);
      await shot('edit-moved');
      await togglePlay();
      await page.waitFor(`!!${GAME}?.__gameStudio && !${GAME}.__gameStudio._debug`, 40000);
      check(await until(async () => (await page.eval(UI_AT(K))) === at1), `Play: the title card where it was put (${await page.eval(UI_AT(K))})`);
      check(/unsaved/.test(await page.eval(NOTE)), 'the top bar says it');
      await shot('play');
      await togglePlay();
      await page.waitFor(EDIT_READY, 40000);
      check(await until(async () => (await page.eval(UI_AT(K))) === at1), `back to Edit: still there (${await page.eval(UI_AT(K))})`);
      check(/\d/.test(await page.eval(FAB)), `back to Edit: not saved ("${await page.eval(FAB)}")`);
      await shot('edit-back');
    } });
  }
  // The web demo (saves in this browser): Lantern Cove, PC and a phone.
  if (want('demo')) {
    const dir = join(mkdtempSync(join(tmpdir(), 'play-unsaved-demo-')), 'site');
    roots.push(dirname(dir));
    execFileSync(process.execPath, [join(PKG, 'scripts/build-web-demo.mjs'), '--out', dir], { stdio: 'ignore' });
    const host = await startHost({ dir });
    try {
      for (const l of [LAYOUTS.pc, LAYOUTS.phone]) {
        await run('demo', l, { fresh: `${host.url}studio/games.json`, url: `${host.url}studio/?game=lantern-cove&lang=en`, steps: worldSteps({ move: 'lighthouse', d: 6 }) });
      }
    } finally {
      await host.close?.();
    }
  }
} finally {
  await browser.close?.();
  await srv?.close?.();
  for (const r of roots) rmSync(r, { recursive: true, force: true });
}
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
