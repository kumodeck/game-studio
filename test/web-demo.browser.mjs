// The browser-only web demo, end to end in a headless browser: build the
// static folder, serve it the way KUMODeck's test version does
// (test/web-demo-host.mjs: the test-version bar in every page and frame, a sub
// path, its cache headers and ETags, 404 pages, a CSP), and use it the way a
// visitor would.
//
//   node test/web-demo.browser.mjs [--dir <built folder>] [--shots <dir>] [--video <dir>]
//                                  [--lang ja|en] [--only pc,390,430,280] [--game <id>]
//                                  [--plain | --url <hosted demo URL>]
//
// Without --dir it builds into a temporary folder first (scripts/build-web-demo.mjs).
// --plain serves it with python3 -m http.server at the root instead (the first
// version of this test); --url runs the same steps against a hosted copy
// (headless, its own throwaway profile; nothing is built or served).
// --video records each run (screencast frames on a 30 fps timeline → mp4 with ffmpeg).
//
// The samples are the two starters (2026-10-17): Lantern Cove (3D, three.js) and
// Firefly Ruins (2D, PixiJS). Each at 1280×800 with a mouse, and with touch at the two
// phones of the brief (390×844, 430×932) and at 280×640 (the phone the "save does not
// stick" report used, 2026-10-16):
//   1. the front page (2026-10-19: it replaced the sample list; its own checks are test/web-demo-lp.browser.mjs) → the
//      editor opens the sample on its own page: PC the sample's switch then "Open full size", phones a tap on the
//      sample's card; the demo line is on top;
//      (PC) Assets answers with the sample's files — never "Reading the folder…" for good
//   2. tap an object in the game, drag it → it moves
//   3. the strip's turn tool, then a drag from anywhere → it turns; the size tool → it grows
//   4. Save, pressed with real input → "saved in this browser"; the same spot
//      pressed again does nothing (it once was Undo, sliding in: the object
//      jumped back and "Save · 1" returned); no ask box and no "● AI" (nobody would read it, design review wave 1,
//      W1-6), and nothing in their place (the "Get Game Studio →" line was taken out, 2026-10-18)
//   5. ▶ Play (real press) → the game runs without the editor, from the save; it keeps
//      drawing (not frozen); Lantern Cove's own auto quality settles (on this test's
//      SwiftShader, a stand-in for a weak phone GPU, it must drop to "low"); back to editing
//   6. open the page again → the object is where it was left, nothing unsaved; the game's
//      own fetch('placement.json') gets the save (so Play shows it too)
//   7. nothing was loaded from another origin (no CDN, no API); no page errors; the
//      adapter's self-check passed, every check (W1-5, 2026-10-17: "screen-changes" is no longer let off);
//      and Firefly Ruins' stage is fitted to the frame on every open (it once was not)
// Exit 1 on failure.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, newPage } from './adapters-2d/cdp.mjs';
import { startHost } from './web-demo-host.mjs';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const SHOTS = opt('--shots') ? resolve(opt('--shots')) : null;
const VIDEO = opt('--video') ? resolve(opt('--video')) : null;
const LANG = opt('--lang') || 'ja';
const URL_ARG = opt('--url');
const PLAIN = args.includes('--plain');
const ONLY = opt('--only');
const ONLY_GAME = opt('--game');
let DIR = opt('--dir') ? resolve(opt('--dir')) : null;
for (const d of [SHOTS, VIDEO]) if (d) mkdirSync(d, { recursive: true });
if (!DIR && !URL_ARG) {
  DIR = join(mkdtempSync(join(tmpdir(), 'studio-web-demo-')), 'site');
  execFileSync(process.execPath, [join(PKG, 'scripts/build-web-demo.mjs'), '--out', DIR], { stdio: 'inherit' });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((res) => {
  const s = createServer();
  s.listen(0, '127.0.0.1', () => {
    const { port } = s.address();
    s.close(() => res(port));
  });
});

// The screens: a laptop with a mouse, and phones held upright with touch.
const SIZES = [
  { tag: 'pc', width: 1280, height: 800, mobile: false },
  { tag: '390', width: 390, height: 844, mobile: true },
  { tag: '430', width: 430, height: 932, mobile: true },
  { tag: '280', width: 280, height: 640, mobile: true },
].filter((v) => !ONLY || ONLY.split(',').includes(v.tag));
// What a person would move: the first of these that is on screen (the 3D camera sees less on a
// narrow phone). 3D: things that stand still in Play (the boats, buoy, barrel and crate float, so
// their place in Play is not the saved one to the millimetre), and wide ones: a click at the middle
// of the thin lamp post's box did not pick it on PC (2026-10-17), so it is not on the list.
const PICK = {
  'lantern-cove': ['sea-stack', 'lighthouse', 'sea-stack-small'],
  'firefly-ruins': ['urn', 'lantern', 'stone-1', 'banner'],
};
const lastKey = {};
const GAMES = Object.keys(PICK).filter((g) => !ONLY_GAME || g === ONLY_GAME);

const FRAME = `document.querySelector('iframe')`;
const DBG = `${FRAME}.contentWindow.__gameStudio._debug`;
const UI = `${FRAME}.contentDocument.querySelector('[data-studio-ui]').shadowRoot`;
const IN = {
  ready: `document.querySelectorAll('.obj').length > 0 && !!${FRAME}?.contentWindow.__gameStudio?._debug`,
  list: `JSON.stringify(${DBG}.list())`,
  at: (key) => `(() => { const f = ${FRAME}.getBoundingClientRect(); const a = ${DBG}.anchor(${JSON.stringify(key)});
    return a ? JSON.stringify({ x: f.left + a.center[0], y: f.top + a.center[1], visible: a.visible, w: a.rect.w, h: a.rect.h }) : null; })()`,
  saveLabel: `[...document.querySelectorAll('[data-action=save]')].find(b => b.offsetParent)?.textContent || ''`,
  button: (sel) => `(() => { const b = [...document.querySelectorAll(${JSON.stringify(sel)})].find(e => e.offsetParent); if (!b) return null; const r = b.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }); })()`,
  strip: (k) => `(() => { const f = ${FRAME}; const o = f.getBoundingClientRect(); const b = ${UI}.querySelector('[data-studio-handle=${k}]');
    if (!b || b.hidden || !b.getBoundingClientRect().width) return null; const r = b.getBoundingClientRect();
    return JSON.stringify({ x: o.left + r.left + r.width / 2, y: o.top + r.top + r.height / 2 }); })()`,
  aiLine: `document.querySelector('.ai-line:not([hidden])')?.textContent || ''`,
  banner: `document.querySelector('.demo-banner')?.textContent || ''`,
  // Every resource the editor page and the game page loaded, with their origins.
  origins: `JSON.stringify([...new Set([...performance.getEntriesByType('resource'), ...${FRAME}.contentWindow.performance.getEntriesByType('resource')].map(e => new URL(e.name).origin))])`,
};
const unsaved = (label) => Number((/(\d+)\s*$/.exec(label) || [])[1] || 0);
const scaleOf = (pose) => (Array.isArray(pose.s) ? pose.s[0] : pose.s ?? 1);
const turn = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
// The heading of a pose. Past ±90° the 3D editor may keep a turn as r with t = [π, π] (x and z flipped):
// Rx(π)·Ry(r)·Rz(π) = Ry(π − r), the same heading written another way (seen on a second visit, 2026-10-17).
const yawOf = (pose) => (Array.isArray(pose.t) && Math.abs(Math.abs(pose.t[0]) - Math.PI) < 1e-3 && Math.abs(Math.abs(pose.t[1]) - Math.PI) < 1e-3 ? Math.PI - (pose.r ?? 0) : pose.r ?? 0);
const WORDS = { ja: { banner: '試し版・AI にはつながっていません・保存はこのブラウザの中だけ', saved: 'ブラウザの中に保存', noAi: 'AI にはつながっていません', ask: 'もっと左に寄せて', reading: 'フォルダを読んでいます…' },
  en: { banner: 'Demo · Not connected to an AI · Saves stay in this browser', saved: 'Saved in this browser', noAi: 'isn’t connected to an AI', ask: 'move it further left', reading: 'Reading the folder…' } }[LANG];

let server;
let base;
if (URL_ARG) {
  server = { kill() {} };
  base = URL_ARG.replace(/\/?$/, '/');
} else if (PLAIN) {
  const port = await freePort();
  const py = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', DIR], { stdio: 'ignore' });
  server = { kill: () => py.kill() };
  base = `http://127.0.0.1:${port}/`;
} else {
  const host = await startHost({ dir: DIR });
  server = { kill: () => void host.close() };
  base = host.url;
}
// The hosted test version adds its own beacon (Cloudflare's page insights); nothing of ours.
const HOST_EXTRA = URL_ARG ? ['https://static.cloudflareinsights.com'] : [];
console.log(`web demo at ${base}${URL_ARG ? '' : PLAIN ? ' (python http.server)' : ' (served like the KUMODeck test version)'}`);
let failed = false;
const notes = [];
try {
  for (let i = 0; i < 50; i++) {
    if (await fetch(base).then((r) => r.ok, () => false)) break;
    await sleep(100);
  }
  const browser = await launch();
  try {
    for (const size of SIZES) {
      for (const game of GAMES) {
        const tag = `${size.tag}-${game}`;
        try {
          await run(browser, game, size, tag);
        } catch (e) {
          failed = true;
          console.log(`  ✗ ${tag}: ${e.message} (${(/web-demo\.browser\.mjs:(\d+)/.exec(e.stack || "") || [])[1] || "?"})`);
        }
      }
    }
  } finally {
    await browser.close();
  }
} finally {
  server.kill();
}
for (const n of notes) console.log(`  · ${n}`);
if (failed) process.exit(1);
console.log('web demo: all passed');

async function run(browser, game, size, tag) {
  const mobile = size.mobile;
  const page = await newPage(browser, size);
  const step = (name) => console.log(`  ✓ ${tag}: ${name}`);
  const shot = async (name) => {
    if (!SHOTS) return;
    await sleep(500);
    writeFileSync(join(SHOTS, `${tag}-${name}.png`), await page.screenshot());
  };
  const j = async (expr) => JSON.parse((await page.eval(expr)) || 'null');
  const poseOf = async (key) => (await j(IN.list)).find((i) => i.key === key)?.pose;
  // A real tap / click at a point of the page (not el.click(): what is under the finger counts).
  const touch = async (pt) => (mobile ? page.tap(pt.x, pt.y) : page.click(pt.x, pt.y));
  const pointer = async (x0, y0, x1, y1) => {
    if (mobile) await page.touchDrag(x0, y0, x1, y1, 10);
    else await page.mouseDrag(x0, y0, x1, y1, 10);
    await sleep(400);
  };
  // Warnings with objects (the self-check result) show as "Object" in the log: write them out.
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { const w = console.warn; console.warn = (...a) => w(...a.map((x) => (x && typeof x === 'object' ? JSON.stringify(x).slice(0, 2000) : x))); })()` });
  // Firefly Ruins sizes its stage after `await applyPlacement()`; frozen before that (the bug of 2026-10-17)
  // the editor showed a small picture squeezed into the left part of the frame. The stone arch stands in the
  // middle of the 1280-px world, so in a well fitted stage it is near the middle of the frame.
  const fitted = async (when) => {
    const at = await j(IN.at('arch'));
    const f = await j(`JSON.stringify(${FRAME}.getBoundingClientRect())`);
    const fx = at && (at.x - f.left) / f.width;
    assert.ok(at && fx > 0.3 && fx < 0.7, `${when}: the arch is at ${fx?.toFixed(2)} of the frame width, not near the middle (stage not fitted?)`);
  };
  const stopVideo = VIDEO ? await record(page, browser) : null;
  try {
    // A fresh browser profile per run would be cleaner, but one profile shared by the runs is
    // what a visitor has: the two samples must not see each other's saves (keys are per sample).
    // --- 1. the front page, then the sample on its own page ---
    await page.goto(`${base}index.html?lang=${LANG}`);
    await page.waitFor(`document.querySelectorAll('a.sample').length === 2 && [...document.querySelectorAll('a.sample img')].every((i) => i.complete && i.naturalWidth > 0)`);
    await shot('0-list');
    // On a phone: one column, the cards fit the width (no sideways scroll), and no frame (the editor opens on its own page).
    assert.ok(await page.eval(`document.documentElement.scrollWidth <= innerWidth`), 'the front page scrolls sideways');
    if (mobile) assert.equal(await page.eval(`document.querySelectorAll('iframe').length`), 0, 'an iframe on the phone front page');
    // The card / switch can be below the fold on a small phone: scroll it into view first, like a thumb would.
    await page.eval(`document.querySelector('a.sample[data-game=${game}]').scrollIntoView({ block: 'center' })`);
    await sleep(300);
    const card2 = await j(`(() => { const r = document.querySelector('a.sample[data-game=${game}]').getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }); })()`);
    await touch(card2);
    if (!mobile) {
      // PC: the switch puts the sample in the page's frame; "Open full size" opens the same editor without it.
      await page.waitFor(`document.querySelector('#stage iframe')?.getAttribute('src')?.includes('game=${game}')`, 10000);
      await page.eval(`document.getElementById('full').scrollIntoView({ block: 'center' })`);
      await sleep(300);
      const full = await j(IN.button('#full'));
      assert.ok(full, 'no "Open full size" link');
      await touch(full);
    }
    await page.waitFor(`location.pathname.endsWith('/studio/')`);
    const t0 = Date.now();
    await page.waitFor(IN.ready, 60000);
    const openMs = Date.now() - t0;
    await sleep(800);
    assert.ok((await page.eval(IN.banner)).includes(WORDS.banner), `demo line: ${await page.eval(IN.banner)}`);
    if (!PLAIN && !URL_ARG) {
      // The host's bar is in the editor page and in the game's frame (it must not get in the way of either).
      assert.equal(await page.eval(`!!document.querySelector('test-version-bar') && !!${FRAME}.contentDocument.querySelector('test-version-bar')`), true, 'the test-version bar is not in both pages');
    }
    if (game === 'firefly-ruins') await fitted('open');
    step(`the front page opens the sample in ${(openMs / 1000).toFixed(1)} s; the demo line is on top`);
    await shot('1-open');

    // --- 1b. Assets ends in an answer (PC; the phone's sheet is covered by studio-e2e) ---
    // Play test 2026-10-17, "the assets don't show up": the hosted demo said "0 files" + "Reading the
    // folder…" for good, because both samples draw everything in code (no asset files) and that
    // build only left "Reading…" after a read that found something. Since the same day each starter loads a few real
    // files (starters/<id>/assets/), so the list must show them; test/web-demo-assets.browser.mjs checks them in detail.
    if (!mobile) {
      await page.eval(`document.querySelector('[data-tool=library]').click()`);
      await page.waitFor(`(() => { const e = document.querySelector('.gsl-empty'); return document.querySelector('.gsl-tile[data-path] .gsl-name') || document.querySelector('.gsl-readfail:not([hidden])') || (e && e.textContent !== ${JSON.stringify(WORDS.reading)}); })()`, 10000);
      const lib = await j(`JSON.stringify({ empty: document.querySelector('.gsl-empty')?.textContent ?? null, count: document.querySelector('.gsl-count')?.textContent ?? '', fail: document.querySelector('.gsl-readfail:not([hidden])')?.textContent ?? null, files: document.querySelectorAll('.gsl-tile[data-path] .gsl-name').length })`);
      assert.equal(lib.fail, null, `Assets: ${lib.fail}`);
      assert.ok(lib.files >= 4, `Assets: ${JSON.stringify(lib)}`);
      step(`Assets → ${lib.files ? `${lib.files} files` : `"${lib.empty}"`}`);
      await shot('1b-assets');
      await page.eval(`document.querySelector('[data-tool=placement]').click()`);
      await page.waitFor(`document.querySelector('[data-tool=placement]')?.getAttribute('aria-selected') === 'true'`);
      await sleep(300);
    }

    // --- 2. pick and move ---
    const items = await j(IN.list);
    let key = null;
    // Where a person would put a finger on `k`: the point nearest its middle, inside the game frame with the game
    // itself there (not the sheet or the ask bar), where `k` is the thing right in front. The middle when it can be:
    // a tap on the lighthouse's middle on the 430 phone picked a pine beside it (W1 merge, 2026-10-17, fixed in
    // pick.js). Else a visible part of it: the earlier visits' saves move things around, and at 280 the small sea
    // stack stood behind the sailboat's sail and the lighthouse's middle was off the left edge. `under` has no finger
    // slack, so it does not decide what the real tap below picks. null = nowhere.
    // middleOnly: only its middle (the first pass over the candidates). Else a finger's width (24 px) in from the
    // frame's edges: a sliver of rock at the edge is not where a person taps.
    const spot = (k, middleOnly = false) => j(`(() => { const f = ${FRAME}.getBoundingClientRect(); const a = ${DBG}.anchor(${JSON.stringify(k)});
      if (!a || !a.visible || !a.rect) return 'null';
      const r = a.rect, pts = [], m = ${middleOnly ? 0 : 24};
      const x0 = Math.max(r.x, m), x1 = Math.min(r.x + r.w, f.width - m), y0 = Math.max(r.y, m), y1 = Math.min(r.y + r.h, f.height - m);
      if (x1 <= x0 || y1 <= y0) return 'null';
      // Not one that covers most of the screen (an earlier visit moved the sea stack right up to the camera): a drag
      // on that looks around by design (input.ts grabbable, 60 % of the window on screen).
      if ((x1 - x0) * (y1 - y0) >= 0.6 * f.width * f.height) return 'null';
      const others = new Set(${DBG}.list().filter((i) => !i.backdrop && i.key !== ${JSON.stringify(k)}).map((i) => i.key));
      pts.push([a.center[0], a.center[1]]);
      if (!${middleOnly}) for (let i = 0; i <= 8; i++) for (let jj = 0; jj <= 8; jj++) pts.push([x0 + ((x1 - x0) * i) / 8, y0 + ((y1 - y0) * jj) / 8]);
      pts.sort((p, q) => Math.hypot(p[0] - a.center[0], p[1] - a.center[1]) - Math.hypot(q[0] - a.center[0], q[1] - a.center[1]));
      for (const [x, y] of pts) {
        if (x < 0 || y < 0 || x > f.width || y > f.height) continue;
        if (document.elementFromPoint(f.left + x, f.top + y) !== ${FRAME}) continue;
        if (${DBG}.under(x, y) !== ${JSON.stringify(k)}) continue;
        // A finger picks within about 10 px: no other thing that close (merge of 2026-10-19: after the PC visit
        // saved the sea stack behind a sailboat, the phone's tap on the stack's edge took the boat).
        const near = [[12, 0], [-12, 0], [0, 12], [0, -12], [9, 9], [-9, 9], [9, -9], [-9, -9]].map(([u, v]) => ${DBG}.under(x + u, y + v));
        if (near.some((n) => n && n !== ${JSON.stringify(k)} && others.has(n))) continue;
        return JSON.stringify({ x: f.left + x, y: f.top + y });
      }
      return 'null'; })()`);
    // The same object as on an earlier visit when it is still on screen (a saved, moved rock can stand in
    // front of the next candidate and take its tap).
    let a = null;
    for (const middleOnly of [true, false]) {
      for (const k of [...(lastKey[game] ? [lastKey[game]] : []), ...PICK[game]]) {
        if (!items.some((i) => i.key === k)) continue;
        a = await spot(k, middleOnly);
        if (a) {
          key = k;
          break;
        }
      }
      if (key) break;
    }
    assert.ok(key, `${game}: none of ${PICK[game].join(', ')} is on screen to pick`);
    await touch(a);
    await sleep(600);
    const picked = await page.eval(`window.studioShell.selected()`);
    // What is under the finger is what a person picks: on a later visit the saved, bigger rock can stand in
    // front of the lighthouse. Fine when it is one of the candidates; anything else (nothing, the sea) fails.
    assert.ok(PICK[game].includes(picked), `a tap on "${key}" picked "${picked}"`);
    if (picked !== key) notes.push(`${tag}: a tap on "${key}" picked "${picked}" (in front of it); went on with that`);
    key = picked;
    const before = items.find((i) => i.key === key).pose;
    lastKey[game] = key;
    await shot('2-picked');
    // Drag from where the finger is on it (its middle can be off screen, see spot()).
    const b = (await spot(key, true)) || (await spot(key)) || (await j(IN.at(key)));
    await pointer(b.x, b.y, b.x - Math.min(60, size.width * 0.12), b.y + 30);
    const moved = await poseOf(key);
    const dist = Math.hypot(...moved.p.map((v, i) => v - before.p[i]));
    assert.ok(dist > (game === 'lantern-cove' ? 0.1 : 5), `"${key}" did not move: ${JSON.stringify({ before, moved })}`);
    step(`picked "${key}" with a ${mobile ? 'tap' : 'click'} and dragged it (moved ${dist.toFixed(2)})`);
    await shot('3-moved');

    // --- 3. turn and size, with the strip's tools (a drag from anywhere uses the chosen tool) ---
    const away = async () => {
      const m = await j(IN.at(key));
      const f = await j(`JSON.stringify(${FRAME}.getBoundingClientRect())`);
      const cands = [];
      for (const fx of [0.15, 0.35, 0.5, 0.65, 0.85]) for (const fy of [0.1, 0.2, 0.3, 0.4, 0.5, 0.6]) {
        const c = { x: f.left + f.width * fx, y: f.top + f.height * fy };
        if (!(await page.eval(`document.elementFromPoint(${c.x}, ${c.y}) === ${FRAME}`))) continue;
        // Not on the editor's own buttons inside the game (the tool strip, the camera ↑↓: shadow roots marked
        // data-studio-ui): a press there is that button (merge of 2026-10-19: at 430 the farthest spot fell on the strip).
        if (await page.eval(`(() => { const f = ${FRAME}.getBoundingClientRect(); const e = ${FRAME}.contentDocument.elementFromPoint(${c.x} - f.left, ${c.y} - f.top); return !!e?.closest?.('[data-studio-ui]'); })()`)) continue;
        // Not on any object either (a press on another object is about that object): on a second visit the
        // saved, bigger rock covered the spot the first visit used.
        const onSome = await page.eval(`(() => { const f = ${FRAME}.getBoundingClientRect(); return ${DBG}.list().some((i) => { const a = ${DBG}.anchor(i.key);
          return a && a.visible && ${c.x} > f.left + a.rect.x - 10 && ${c.x} < f.left + a.rect.x + a.rect.w + 10 && ${c.y} > f.top + a.rect.y - 10 && ${c.y} < f.top + a.rect.y + a.rect.h + 10; }); })()`);
        if (!onSome) cands.push(c);
      }
      cands.sort((p, q) => Math.hypot(q.x - m.x, q.y - m.y) - Math.hypot(p.x - m.x, p.y - m.y));
      assert.ok(cands.length, 'no free spot in the game to drag from');
      return cands[0];
    };
    const useTool = async (k, dx, dy) => {
      const btn = await j(IN.strip(k));
      assert.ok(btn, `no "${k}" button on the strip`);
      await touch(btn);
      await sleep(300);
      const s0 = await away();
      await pointer(s0.x, s0.y, s0.x + dx, s0.y + dy);
    };
    await useTool('rotate', 105, 0);
    const turned = await poseOf(key);
    const deg = (turn(yawOf(turned), yawOf(moved)) * 180) / Math.PI;
    assert.ok(deg > 20, `"${key}" did not turn: ${deg.toFixed(1)}°`);
    await shot('4-turned');
    await useTool('scale', 70, -40);
    const sized = await poseOf(key);
    const grow = scaleOf(sized) / scaleOf(turned);
    assert.ok(grow > 1.2, `"${key}" did not grow: ×${grow.toFixed(2)}`);
    step(`turn tool → turned ${deg.toFixed(0)}°; size tool → ×${grow.toFixed(2)}`);
    await shot('5-sized');
    // Drop the tool (tap it again), like a person done with it; Escape on PC.
    const sc = await j(IN.strip('scale'));
    if (sc) await touch(sc);
    await sleep(300);

    // --- 4. save, and ask the AI ---
    const sv = await j(IN.button('[data-action=save]'));
    assert.ok(sv, 'no Save button on screen');
    await touch(sv);
    // A big move (25 m sideways, 5 m up or down, 3× the size: shell/safe-save.ts, fb-safe 2026-10-19) is told before
    // it is saved; the PC drag flings the sea stack ~40 m, so the sheet comes; then "Save
    // anyway", as a person who meant it would (merge of 2026-10-19: the two branches met here).
    const sheetUp = `(() => { const e = document.querySelector('[data-part=safe-save]'); return !!e && !e.hidden; })()`;
    await page.waitFor(`${sheetUp} || (${IN.aiLine}).includes(${JSON.stringify(WORDS.saved)})`, 5000).catch(() => {});
    const sheet = await page.eval(sheetUp);
    if (sheet) {
      const go = await j(IN.button('[data-action=safe-save]'));
      assert.ok(go, 'the check before saving has no "Save anyway" on screen');
      await touch(go);
    }
    await page.waitFor(`(${IN.aiLine}).includes(${JSON.stringify(WORDS.saved)})`, 5000);
    assert.equal(unsaved(await page.eval(IN.saveLabel)), 0);
    await sleep(300);
    // The second press on the same spot (people tap again when the first seems to do little):
    // "✓ Saved" is there now, and nothing else may have slid under the finger. Since 2026-10-20 Save is in the game
    // (main.ts saveFab): the same button says "✓ Saved" for a moment in the same place, and a press on it does nothing.
    const under = await page.eval(`(() => { const e = document.elementFromPoint(${sv.x}, ${sv.y}); const b = e?.closest('[data-action],[data-part]'); return (b?.dataset.action === 'save' ? 'save:' + (b.dataset.state || '') : b?.dataset.action || e?.closest('[data-part]')?.dataset.part || e?.tagName || '') + ''; })()`);
    assert.equal(under, 'save:done', `after Save the spot of Save shows "${under}", not "✓ Saved"`);
    await touch(sv);
    await sleep(700);
    const kept = await poseOf(key);
    assert.ok(Math.hypot(...kept.p.map((v, i) => v - sized.p[i])) < 1e-6 && Math.abs(scaleOf(kept) - scaleOf(sized)) < 1e-6, `a second press on Save changed "${key}": ${JSON.stringify(kept)}`);
    assert.equal(unsaved(await page.eval(IN.saveLabel)), 0, `a second press on Save left "${await page.eval(IN.saveLabel)}"`);
    step('Save (real press) → kept in this browser; pressing the same spot again changes nothing');
    await shot('6-saved');
    // W1-6 (design review wave 1, 2026-10-17): the demo has no AI behind it, so no ask box and no "● AI". W1-6 put one grey
    // line and a "Get Game Studio →" link in the ask box's place; it was taken out on 2026-10-18 (the person is already
    // using Game Studio), so nothing stands there now: the top line alone says the demo isn't connected to an AI.
    const demo = await j(`JSON.stringify({ ask: !!document.querySelector('.ask-input'), askShown: !!document.querySelector('.ask-input')?.offsetParent, peer: !!document.querySelector('[data-part=peer]'), presence: !!document.querySelector('[data-part=presence]'),
      slot: document.querySelector('[data-part=bar] .ask-slot')?.textContent ?? null, slotShown: !!document.querySelector('[data-part=bar] .ask-slot')?.offsetParent,
      offlineLine: !!document.querySelector('[data-part=offline-line]'), get: !!document.querySelector('[data-part=bar] a'),
      top: document.querySelector('.demo-banner')?.textContent || '' })`);
    assert.equal(demo.askShown, false, 'the ask box is on screen in the demo');
    assert.equal(demo.peer, false, 'the "● AI" is in the demo');
    assert.equal(demo.presence, false, '"Claude is watching / not sure" is in the demo (no AI behind it)');
    assert.ok(!demo.offlineLine && !demo.get && !demo.slot && !demo.slotShown, `something in the ask box's place: ${JSON.stringify(demo)}`);
    assert.ok(!/Get Game Studio|入手/.test(await page.eval('document.body.innerText')), 'a "Get Game Studio" line is on the page');
    assert.ok(demo.top.includes(WORDS.banner), `the top line: ${demo.top}`);
    assert.ok(await page.eval(`document.documentElement.scrollWidth <= innerWidth`), 'the demo page scrolls sideways');
    step('no ask box, no "● AI", nothing in their place');
    await shot('7-ask');

    // --- 5. ▶ Play, then back to editing ---
    const play = await j(IN.button('[data-action=play]'));
    assert.ok(play, 'no ▶ Play button on screen');
    await touch(play);
    const hook = game === 'lantern-cove' ? '__cove' : '__ruins';
    // Playing: the page on screen itself since the fast switch (2026-10-22: `_play.playing()`), or a Play page (no studio=edit).
    await page.waitFor(`(${FRAME}.contentWindow.__gameStudio?._play?.playing?.() === true || !${FRAME}.contentWindow.location.search.includes('studio=edit')) && !${FRAME}.contentWindow.__gameStudio?._debug && !!${FRAME}.contentWindow.${hook}`, 60000);
    const frames = game === 'lantern-cove' ? `${FRAME}.contentWindow.__cove.frames` : `${FRAME}.contentWindow.__ruins.stats().frames`;
    await page.waitFor(`${frames} > 3`, 60000);
    const f0 = await page.eval(frames);
    await sleep(2500);
    const f1 = await page.eval(frames);
    assert.ok(f1 > f0, `Play is frozen: ${f0} → ${f1} frames in 2.5 s`);
    let playNote = `${((f1 - f0) / 2.5).toFixed(1)} fps here`;
    // Ask while playing (§3.5) needs an AI behind the host: the try-out shows no field and no mark in Play.
    assert.equal(await page.eval(`!!${FRAME}.contentDocument.querySelector('game-studio-play')`), false, 'the try-out shows the ask-while-playing mark');
    if (game === 'lantern-cove') {
      // The saved place in the game itself (not the editor's copy): the rocks and the lighthouse stand still in Play.
      const inPlay = await j(`(() => { let o = null; ${FRAME}.contentWindow.__cove.scene.traverse((x) => { if (!o && (x.userData?.studioKey === ${JSON.stringify(key)} || x.name === ${JSON.stringify(key)})) o = x; });
        return o ? JSON.stringify({ p: o.position.toArray(), s: o.scale.x }) : null; })()`);
      assert.ok(inPlay, `"${key}" not found in the game in Play`);
      assert.ok(Math.hypot(inPlay.p[0] - sized.p[0], inPlay.p[2] - sized.p[2]) < 0.01 && Math.abs(inPlay.s - scaleOf(sized)) < 0.01,
        `in Play "${key}" is at ${JSON.stringify(inPlay)}, not the saved ${JSON.stringify(sized)}`);
      // Auto quality: the game measures frames 30–120 once and drops MSAA + pixel ratio below ~45 fps.
      // On SwiftShader (no GPU) that must end in "low"; wait for the decision only on the 390 phone (it takes a while here).
      if (size.tag === '390' && !URL_ARG) {
        await page.waitFor(`${FRAME}.contentWindow.__cove.quality !== 'auto'`, 240000);
        const q = await page.eval(`${FRAME}.contentWindow.__cove.quality`);
        // SwiftShader (the default here) runs a few fps → "low". With a real GPU (STUDIO_CHROME, for videos) → "high".
        const fps = (f1 - f0) / 2.5;
        if (fps < 30) assert.equal(q, 'low', `auto quality at ${fps.toFixed(1)} fps settled on "${q}"`);
        else if (fps > 55) assert.equal(q, 'high', `auto quality at ${fps.toFixed(1)} fps settled on "${q}"`);
        playNote += `, auto quality → ${q}`;
      }
    }
    step(`▶ Play (real press) → the game runs from the save (${playNote})`);
    await shot('8-play');
    const edit = await j(IN.button('[data-action=play]'));
    await touch(edit);
    await page.waitFor(`${FRAME}.contentWindow.location.search.includes('studio=edit')`, 20000);
    await page.waitFor(IN.ready, 60000);
    await sleep(800);
    const backPose = await poseOf(key);
    assert.ok(Math.hypot(...backPose.p.map((v, i) => v - sized.p[i])) < (game === 'lantern-cove' ? 2e-3 : 0.15), `back from Play "${key}" is at ${JSON.stringify(backPose.p)}`);
    if (game === 'firefly-ruins') await fitted('back from Play');
    step('back to editing → the object is where it was saved');

    // --- 6. open again ---
    await page.goto(`${base}studio/?game=${game}&lang=${LANG}`);
    await page.waitFor(IN.ready, 60000);
    await sleep(1500);
    const again = await poseOf(key);
    // placement.json keeps rounded numbers (2D 0.1 px, 3D 1 mm), so "the same place" = within that.
    assert.ok(Math.hypot(...again.p.map((v, i) => v - sized.p[i])) < (game === 'lantern-cove' ? 2e-3 : 0.15), `after reopening "${key}" is at ${JSON.stringify(again.p)}, not ${JSON.stringify(sized.p)}`);
    assert.ok(Math.abs(scaleOf(again) - scaleOf(sized)) < 0.01 && turn(yawOf(again), yawOf(sized)) < 0.01, `after reopening "${key}": ${JSON.stringify(again)} vs ${JSON.stringify(sized)}`);
    const left = unsaved(await page.eval(IN.saveLabel));
    const flipped = Array.isArray(again.t) && again.t.every((v) => Math.abs(Math.abs(v) - Math.PI) < 1e-3);
    if (left === 1 && flipped) {
      // KNOWN (2026-10-17, the editor, not the demo): a 3D object turned past ±90° is kept as t = [π, π];
      // placement.json rounds π, the adapter reads back −3.14158…, and the editor counts that as one
      // unsaved change on every open. The object is where it was left (checked above). Reported, not fixed here.
      notes.push(`${tag}: KNOWN — after reopening, "${key}" (turned past 90°, t = [π, π]) shows "Save · 1" with nothing changed`);
    } else assert.equal(left, 0, `after reopening the Save button says "${await page.eval(IN.saveLabel)}" (${JSON.stringify(again)})`);
    // The game itself reads the save as its placement.json (game-placement.js), so Play shows it too.
    const own = await page.eval(`${FRAME}.contentWindow.fetch('placement.json').then(async (r) => r.status + ' ' + JSON.stringify(Object.keys((await r.json()).objects || {})))`);
    assert.ok(own.startsWith('200 ') && own.includes(JSON.stringify(key)), `the game's placement.json: ${own}`);
    if (game === 'firefly-ruins') await fitted('reopened');
    step('reopened → still where it was left (place, turn, size); the game reads the save as placement.json');
    await shot('9-reopened');

    // --- 7. nothing from another origin; no errors; the adapter's self-check passed ---
    const origins = await j(IN.origins);
    assert.deepEqual(origins.filter((o) => o !== new URL(base).origin && o !== 'null' && !HOST_EXTRA.includes(o)), [], `other origins: ${origins.join(', ')}`);
    const errors = page.logs.filter((l) => /^(error|exception)/.test(l) && !/placement\.json|404/.test(l));
    assert.deepEqual(errors, [], 'page errors');
    // Every check, "screen-changes" included: it used to compare a 32×32 copy of the whole canvas and missed the
    // small bell's move on a phone, so it was only noted here. It now compares the pixels around the object
    // (src/bridge/selfcheck.ts), and our own samples must never show the warning (Ive review N1 / W1-5).
    // The demo host logs the result as an object (the log line reads "… self-check failed Object"), so any such
    // line is a failure; the ids are not in the text.
    const failedChecks = page.logs.filter((l) => l.includes('self-check failed'));
    assert.deepEqual(failedChecks, [], `the adapter self-check failed: ${failedChecks.join(' / ')}`);
    step('everything came from the demo folder; no page errors; self-check passed');
  } finally {
    if (stopVideo) await stopVideo(join(VIDEO, `${tag}.mp4`));
    await page.close();
  }
}

/**
 * Record the page: screencast frames placed on a 30 fps timeline by their timestamps, then ffmpeg.
 * (Chrome DevTools Protocol frames + ffmpeg; no new packages.)
 */
async function record(page, browser) {
  const frames = [];
  const off = browser.on((m) => {
    if (m.method !== 'Page.screencastFrame') return;
    frames.push({ t: m.params.metadata.timestamp, data: m.params.data });
    page.send('Page.screencastFrameAck', { sessionId: m.params.sessionId }).catch(() => {});
  });
  await page.send('Page.startScreencast', { format: 'jpeg', quality: 85, everyNthFrame: 1 });
  return async (out) => {
    await page.send('Page.stopScreencast').catch(() => {});
    if (typeof off === 'function') off();
    if (frames.length < 2) return;
    const dir = mkdtempSync(join(tmpdir(), 'web-demo-video-'));
    const t0 = frames[0].t;
    const last = frames[frames.length - 1].t;
    let k = 0;
    for (let n = 0; n <= Math.round((last - t0) * 30); n++) {
      const at = t0 + n / 30;
      while (k + 1 < frames.length && frames[k + 1].t <= at) k++;
      writeFileSync(join(dir, `f${String(n).padStart(5, '0')}.jpg`), Buffer.from(frames[k].data, 'base64'));
    }
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '30', '-i', join(dir, 'f%05d.jpg'),
      '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '28', '-movflags', '+faststart', out]);
  };
}
