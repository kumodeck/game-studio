// View check: does the game look the same inside the editor as when it is played?
//
//   node studio.mjs <game folder> --check-view
//
// WHY this exists: the in-editor self-check (src/bridge/selfcheck.ts) moves one object and puts it
// back, so it proves the adapter can edit. It cannot see an adapter that quietly changes how the
// game is drawn: a trial on 2026-10-16, pixi-garden with an adapter from before cc4bd6e5. Pixi
// v8's `renderer.extract.canvas({ target })` (used for library thumbnails) turns the object into a
// render group and leaves it so; from then on it is no longer drawn with its parent. In the editor
// the tree sat below the frame and the house, rocks and flowers were gone, while the game played
// normally was fine. Adapters are written by the user's AI on the spot, so the same class of bug
// (any thumbnail / selection / listing step that changes an object and does not undo it) will
// happen again. The AI cannot see the user's screen, so it needs a check it can run itself.
//
// What it does, in a fresh headless Chrome with a throwaway profile (nothing is downloaded, the
// user's own browser is never touched):
// 1. Opens the editor at 1280x800 like a person would, waits for the self-check and the library
//    thumbnails (the steps that call the adapter on every object), and shoots the game frame.
// 2. Opens the same page *without* the editor (a second, plain file server on 127.0.0.1: no edit
//    script, no adapter) at exactly the frame's size, and shoots it a few times while it runs.
// 3. Compares the editor shot with the closest plain shot on a small grid. "Closest" because the
//    game keeps animating when played (clouds drift); a real drift differs at every moment.
// Result: one stdout line `studio: check-view ok|failed|skipped …`, details and both pictures in
// .studio/view-check.md and .studio/view-check/{game,editor}.png for the AI to look at.
//
// Thresholds (tuned on the 2D examples, 2026-10-16): a grid cell "differs" when one colour channel
// is more than 48/255 apart; the check fails when more than 1% of cells differ. Measured: the
// working examples 0-0.4% (canvas-stars, whose stars keep falling, is the highest), the old
// pixi-garden adapter 1.9% (four trees, the house, two rocks and the flowers missing; they are small
// next to the sky and the ground). A share of "content" instead of the whole frame was tried: it
// makes moving objects (stars) count as much as missing ones, so it separates worse.
import http from 'node:http';
import { spawn } from 'node:child_process';
import { promises as fs, existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { mimeOf, resolveInside, writeStudioFile } from './files.mjs';

const VIEW_W = 1280;
const VIEW_H = 800;
/** Grid width for the comparison; the height follows the frame's aspect ratio. */
const GRID_W = 64;
/** A cell differs when a channel is further apart than this (0-255). */
const CELL_TOLERANCE = 48;
/** The check fails when more than this share of cells differ. */
const MAX_CHANGED = 0.01;
/**
 * Moments (ms after load) at which the plain game is shot; the closest one is compared. Every
 * 150 ms for 4.5 s: dense enough that a game that keeps moving (falling stars, drifting clouds)
 * has one shot close to the moment the editor froze it.
 */
const PLAIN_SHOTS_MS = Array.from({ length: 30 }, (_, i) => 150 + i * 150);

/**
 * Run the view check against a running studio server.
 * @param {{ url: string }} srv           the studio server (startStudioServer result)
 * @param {{ rootReal: string, entry: string, logs?: string[] }} o
 *        logs: the server's `studio:` lines so far (filled while this runs), used to wait for the self-check
 * @returns {Promise<{ status: 'ok' | 'failed' | 'skipped', changed?: number, line: string, note?: string }>}
 */
export async function runViewCheck(srv, o) {
  const bin = findHeadlessChrome();
  if (!bin) {
    return { status: 'skipped', line: 'studio: check-view skipped: no Chrome or Chromium found (set STUDIO_CHROME to its path)' };
  }
  const plain = await startPlainServer(o.rootReal);
  const browser = await launchHeadless(bin);
  try {
    // 1. Editor.
    const ed = await openTab(browser, VIEW_W, VIEW_H);
    await ed.goto(srv.url);
    const ready = await ed.waitFor(
      `(() => { const f = document.querySelector('iframe'); const s = f && f.contentWindow && f.contentWindow.__gameStudio;
        return !!(s && s._debug && document.querySelectorAll('.obj').length); })()`,
      30000,
    ).catch(() => false);
    if (!ready) {
      return { status: 'skipped', line: 'studio: check-view skipped: the editor did not list any object (fix the self-check first, see .studio/check.md)' };
    }
    // The self-check result reaches the server as a `studio: check` line; the library thumbnails
    // are asked for right after the list. Give both time, then shoot.
    for (let i = 0; i < 50 && !(o.logs || []).some((l) => l.startsWith('studio: check ')); i++) await pause(100);
    await pause(1500);
    // The editor opens with "frame everything" (a zoomed-out edit view), which is a wanted
    // difference. Put the view back to the game's own one, through the adapter's setView exactly
    // as the shell's "reset view" does; an adapter that cannot restore its view fails here too,
    // which is right (adapters.md: "restore the game's view when called with { x: 0, y: 0, zoom: 1 }").
    const kind = await ed.eval(`(() => { const f = document.querySelector('iframe'); const v = f.contentWindow.__gameStudio._debug.view();
      if (!v || typeof v.zoom !== 'number' || typeof v.x !== 'number') return '3d';
      f.contentWindow.postMessage({ type: 'studio:core/view', view: { action: 'restore', state: { x: 0, y: 0, zoom: 1 } } }, new URL(f.src, location.href).origin);
      return '2d'; })()`);
    if (kind !== '2d') {
      // three.js uses the built-in adapter and an editor camera that is meant to differ from the
      // game camera; the check is for adapters written per game (2D engines).
      return { status: 'skipped', line: 'studio: check-view skipped: only for 2D adapters (three.js uses the built-in adapter and its own editor camera)' };
    }
    // The editor's own plates float over the game since the 2026-10-16 rebrand (the ask bar, the
    // picked object's card, the first hint): they are not the game's picture, so they step aside.
    await ed.eval(`(() => { for (const el of document.querySelectorAll('.stage > :not(iframe)')) el.style.visibility = 'hidden'; return true; })()`);
    await pause(500);
    const rect = await ed.eval(`(() => { const r = document.querySelector('iframe').getBoundingClientRect();
      return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; })()`);
    const editorPng = await ed.screenshot({ x: rect.x, y: rect.y, width: rect.w, height: rect.h, scale: 1 });
    await ed.close();

    // 2. The same page, played normally, at the frame's size.
    const pl = await openTab(browser, rect.w, rect.h);
    const t0 = Date.now();
    await pl.goto(`${plain.origin}/${o.entry.split('/').map(encodeURIComponent).join('/')}`);
    const plainPngs = [];
    for (const at of PLAIN_SHOTS_MS) {
      await pause(Math.max(0, at - (Date.now() - t0)));
      plainPngs.push(await pl.screenshot());
    }

    // 3. Compare (in the browser: it decodes PNG for free).
    const cmp = await pl.eval(`(${comparePictures.toString()})(${JSON.stringify(editorPng.toString('base64'))}, ${JSON.stringify(plainPngs.map((b) => b.toString('base64')))}, ${GRID_W}, ${CELL_TOLERANCE})`);
    await pl.close();
    const best = plainPngs[cmp.best];
    await writeStudioFile(o.rootReal, 'view-check/editor.png', editorPng);
    await writeStudioFile(o.rootReal, 'view-check/game.png', best);
    const ok = cmp.changed <= MAX_CHANGED;
    const pct = Math.round(cmp.changed * 1000) / 10;
    const note = await writeStudioFile(o.rootReal, 'view-check.md', viewCheckMarkdown(ok, pct, cmp, rect));
    return ok
      ? { status: 'ok', changed: cmp.changed, line: `studio: check-view ok (${pct}% of the picture differs)`, note }
      : { status: 'failed', changed: cmp.changed, line: `studio: check-view failed: the game looks different in the editor (${pct}% of the picture differs; see ${note})`, note };
  } finally {
    await browser.close();
    await plain.close();
  }
}

/**
 * `studio.mjs <game folder> --shot`: the game played normally (no editor, no adapter), shot in a
 * private headless Chrome at 1280x800 and 390x844, written to .studio/shot/game.png and
 * game-phone.png. 2D and 3D alike.
 *
 * WHY (play test 2026-10-16): after applying placement.json the AI reported "not checked on
 * the real game screen yet". The AI cannot see the user's screen; with this it looks at the game
 * itself and compares it with what was saved before it reports. SHOT_AT_MS: games load assets
 * and settle (physics, tweens) in the first seconds; 4 s showed every example fully drawn.
 *
 * @param {{ rootReal: string, entry: string }} o
 * @returns {Promise<{ status: 'ok' | 'skipped', line: string, files?: string[] }>}
 */
const SHOT_AT_MS = 4000;
export async function runGameShot(o) {
  const bin = findHeadlessChrome();
  if (!bin) {
    return { status: 'skipped', line: 'studio: shot skipped: no Chrome or Chromium found (set STUDIO_CHROME to its path)' };
  }
  const plain = await startPlainServer(o.rootReal);
  let browser;
  try {
    browser = await launchHeadless(bin);
  } catch (e) {
    // Chrome found but it cannot start here: in Codex's default sandbox it exits at once (checked 10/17 with
    // `codex sandbox`, "headless Chrome exited (null)"), and the agent got exit 1 with no idea what to do. Same
    // answer as "no Chrome": skipped, exit 3, and the skill's §3.3 one line for the person.
    await plain.close();
    return { status: 'skipped', line: `studio: shot skipped: headless Chrome could not start here (${String(e && e.message).split('\n')[0]}; an AI sandbox often blocks it). Tell the person in one line what to look at in the game` };
  }
  try {
    const url = `${plain.origin}/${o.entry.split('/').map(encodeURIComponent).join('/')}`;
    const files = [];
    for (const [name, w, h] of [['game.png', VIEW_W, VIEW_H], ['game-phone.png', 390, 844]]) {
      const tab = await openTab(browser, w, h);
      const t0 = Date.now();
      await tab.goto(url);
      await pause(Math.max(0, SHOT_AT_MS - (Date.now() - t0)));
      files.push(await writeStudioFile(o.rootReal, `shot/${name}`, await tab.screenshot()));
      await tab.close();
    }
    return { status: 'ok', line: `studio: shot ok ${files.join(' ')}`, files };
  } finally {
    await browser.close();
    await plain.close();
  }
}

/** Runs in the page. Returns the share of grid cells that differ, for the closest plain shot. */
async function comparePictures(editorB64, plainB64s, gridW, tol) {
  const load = (b64) => new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => rej(new Error('bad screenshot'));
    im.src = 'data:image/png;base64,' + b64;
  });
  const ed = await load(editorB64);
  const gw = gridW;
  const gh = Math.max(1, Math.round((gridW * ed.height) / ed.width));
  const cells = async (im) => {
    const c = document.createElement('canvas');
    c.width = gw;
    c.height = gh;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(im, 0, 0, gw, gh);
    return g.getImageData(0, 0, gw, gh).data;
  };
  const a = await cells(ed);
  let best = 0;
  let bestChanged = 2;
  let bestBox = null;
  for (let k = 0; k < plainB64s.length; k++) {
    const b = await cells(await load(plainB64s[k]));
    let n = 0;
    let x0 = gw, y0 = gh, x1 = -1, y1 = -1;
    for (let i = 0; i < gw * gh; i++) {
      const d = Math.max(Math.abs(a[i * 4] - b[i * 4]), Math.abs(a[i * 4 + 1] - b[i * 4 + 1]), Math.abs(a[i * 4 + 2] - b[i * 4 + 2]));
      if (d > tol) {
        n++;
        const x = i % gw, y = (i / gw) | 0;
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      }
    }
    const changed = n / (gw * gh);
    if (changed < bestChanged) {
      bestChanged = changed;
      best = k;
      // Where the differences are, as a share of the frame (left, top, right, bottom).
      bestBox = n ? [x0 / gw, y0 / gh, (x1 + 1) / gw, (y1 + 1) / gh].map((v) => Math.round(v * 100) / 100) : null;
    }
  }
  return { best, changed: bestChanged, box: bestBox, grid: [gw, gh] };
}

function viewCheckMarkdown(ok, pct, cmp, rect) {
  const lines = [
    '# Game Studio view check',
    '',
    `Result: **${ok ? 'ok' : 'failed'}**. ${pct}% of the picture differs between the game inside the editor and the`,
    `same page played normally (frame ${rect.w}x${rect.h}, compared on a ${cmp.grid[0]}x${cmp.grid[1]} grid; it fails above ${MAX_CHANGED * 100}%).`,
    '',
    '- `.studio/view-check/editor.png`: the game frame in the editor, after the self-check and the library thumbnails',
    '- `.studio/view-check/game.png`: the page without the editor (no edit script, no adapter), the closest moment',
  ];
  if (cmp.box) lines.push(`- The differences are inside this part of the frame (left, top, right, bottom as a share of the frame): ${cmp.box.join(', ')}`);
  if (!ok) {
    lines.push(
      '',
      '## What it means',
      '',
      'The adapter changes how objects are drawn. Something it does while the editor lists objects, makes thumbnails',
      'or selects an object changes a game object (or the renderer) and does not put it back, so the picture in the',
      'editor is not the game the user will play. Look at both pictures: objects missing, moved, or drawn in another',
      'order point at the step that touched them.',
      '',
      'Usual causes (details in references/adapters.md, "Leave the game as you found it"):',
      '',
      '- PixiJS v8: `renderer.extract.canvas({ target })` / `extract.image` turns the target into a render group.',
      '  Remember `isRenderGroup` before and call `disableRenderGroup()` after when it was not one. Return `null` from',
      '  `capture()` when the result is blank; the editor then crops the object from the screen.',
      '- Any engine: `capture()`, `bounds()` or `objects()` that changes visibility, alpha, parent, z-order, a camera,',
      '  a render texture or a cached transform must restore it in a `finally` block.',
      '- The adapter set the view (`setView`) or a renderer option at start and never restored it.',
      '',
      'Fix `.studio/adapter.js` and run `node <skill>/bin/studio.mjs <game folder> --check-view` again.',
    );
  }
  return lines.join('\n') + '\n';
}

/** Files of the game folder, exactly as they are on disk: no edit script, no adapter. Loopback only. */
async function startPlainServer(rootReal) {
  const server = http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url, 'http://127.0.0.1');
      const r = await resolveInside(rootReal, u.pathname);
      if (!r.ok) {
        res.writeHead(r.status, { 'Content-Type': 'text/plain' });
        return res.end(r.reason);
      }
      res.writeHead(200, { 'Content-Type': mimeOf(r.abs), 'Cache-Control': 'no-store' });
      res.end(await fs.readFile(r.abs));
    } catch {
      res.writeHead(500);
      res.end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((r) => server.close(() => r())),
  };
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/** A headless-capable Chrome / Chromium binary, or null. STUDIO_CHROME wins. */
export function findHeadlessChrome() {
  if (process.env.STUDIO_CHROME) return process.env.STUDIO_CHROME;
  const found = [];
  // Playwright's browser cache (often already present on developer machines).
  for (const base of [path.join(os.homedir(), 'Library/Caches/ms-playwright'), path.join(os.homedir(), '.cache/ms-playwright')]) {
    if (!existsSync(base)) continue;
    for (const d of readdirSync(base).sort().reverse()) {
      for (const p of ['chrome-headless-shell-mac-arm64/chrome-headless-shell', 'chrome-headless-shell-mac-x64/chrome-headless-shell', 'chrome-headless-shell-linux64/chrome-headless-shell']) {
        found.push(path.join(base, d, p));
      }
    }
  }
  found.push(
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  );
  return found.find((p) => existsSync(p)) || null;
}

/**
 * A fresh headless browser with its own throwaway profile (so the user's Chrome, its sign-ins and
 * tabs are never involved). Minimal Chrome DevTools Protocol over Node's built-in WebSocket; the
 * same approach as test/adapters-2d/cdp.mjs, trimmed to what the view check needs.
 */
async function launchHeadless(bin) {
  const profile = mkdtempSync(path.join(os.tmpdir(), 'studio-view-check-'));
  const proc = spawn(bin, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check',
    // SwiftShader keeps WebGL working without a GPU.
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--hide-scrollbars', '--mute-audio', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  const wsUrl = await new Promise((resolve, reject) => {
    let buf = '';
    const t = setTimeout(() => reject(new Error('headless Chrome did not start')), 15000);
    proc.stderr.on('data', (d) => {
      buf += d;
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) {
        clearTimeout(t);
        resolve(m[1]);
      }
    });
    proc.on('exit', (c) => reject(new Error(`headless Chrome exited (${c})`)));
  });
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  let id = 0;
  const pending = new Map();
  const listeners = new Set();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    } else if (msg.method) {
      for (const l of listeners) l(msg);
    }
  };
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const n = ++id;
      pending.set(n, { resolve, reject });
      ws.send(JSON.stringify({ id: n, method, params, sessionId }));
    });
  return {
    send,
    on: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    async close() {
      try {
        await send('Browser.close');
      } catch {
        /* already gone */
      }
      proc.kill();
      try {
        rmSync(profile, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    },
  };
}

async function openTab(browser, width, height) {
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (m, p) => browser.send(m, p, sessionId);
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  const tab = {
    async goto(url) {
      const loaded = new Promise((res) => {
        const off = browser.on((m) => {
          if (m.sessionId === sessionId && m.method === 'Page.loadEventFired') {
            off();
            res();
          }
        });
      });
      await send('Page.navigate', { url });
      await Promise.race([loaded, pause(30000)]);
    },
    async eval(expr) {
      const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    },
    async waitFor(expr, ms) {
      const end = Date.now() + ms;
      for (;;) {
        const v = await tab.eval(expr).catch(() => null);
        if (v) return v;
        if (Date.now() > end) throw new Error(`timeout waiting for ${expr}`);
        await pause(100);
      }
    },
    async screenshot(clip) {
      const r = await send('Page.captureScreenshot', clip ? { format: 'png', clip } : { format: 'png' });
      return Buffer.from(r.data, 'base64');
    },
    close: () => browser.send('Target.closeTarget', { targetId }).catch(() => {}),
  };
  return tab;
}
