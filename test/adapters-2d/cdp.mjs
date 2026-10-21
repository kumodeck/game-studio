// A very small Chrome DevTools Protocol client for the 2D adapter browser tests.
//
// WHY not Playwright/Puppeteer: the studio has zero dependencies and must stay
// that way. Node >= 22 ships a global WebSocket, and a headless Chrome speaks
// CDP over it, so ~120 lines are enough to open pages, run code in them,
// dispatch real mouse/touch input and take screenshots.
//
// The browser binary comes from STUDIO_CHROME, or the first headless Chrome
// found in the usual places. Nothing is downloaded.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

/** Find a Chrome / Chromium / headless shell binary, or return null. */
export function findChrome() {
  if (process.env.STUDIO_CHROME) return process.env.STUDIO_CHROME;
  const found = [];
  // Playwright's browser cache (often already present on developer machines).
  for (const base of [join(homedir(), 'Library/Caches/ms-playwright'), join(homedir(), '.cache/ms-playwright')]) {
    if (!existsSync(base)) continue;
    for (const d of readdirSync(base).sort().reverse()) {
      for (const p of [
        `${d}/chrome-headless-shell-mac-arm64/chrome-headless-shell`,
        `${d}/chrome-headless-shell-mac-x64/chrome-headless-shell`,
        `${d}/chrome-headless-shell-linux64/chrome-headless-shell`,
      ]) found.push(join(base, p));
    }
  }
  found.push(
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  );
  return found.find((p) => existsSync(p)) || null;
}

/**
 * Launch a fresh headless browser with its own throwaway profile.
 * Only this process is ever killed by close().
 */
export async function launch() {
  const bin = findChrome();
  if (!bin) throw new Error('no headless Chrome found (set STUDIO_CHROME)');
  const profile = mkdtempSync(join(tmpdir(), 'studio-2d-chrome-'));
  const proc = spawn(bin, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu-sandbox',
    // SwiftShader keeps WebGL working without a GPU (CI, sandboxes).
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--hide-scrollbars', '--mute-audio', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  const wsUrl = await new Promise((resolve, reject) => {
    let buf = '';
    const t = setTimeout(() => reject(new Error('browser did not start')), 15000);
    proc.stderr.on('data', (d) => {
      buf += d;
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) { clearTimeout(t); resolve(m[1]); }
    });
    proc.on('exit', (c) => reject(new Error(`browser exited (${c})`)));
  });
  const browser = await connect(wsUrl);
  browser.close = async () => {
    try { await browser.send('Browser.close'); } catch { /* already gone */ }
    proc.kill();
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* best effort */ }
  };
  return browser;
}

/** Raw CDP connection with session support (flattened target sessions). */
async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  const listeners = new Set();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(`${msg.error.message} ${msg.error.data || ''}`));
      else resolve(msg.result);
    } else if (msg.method) {
      for (const l of listeners) l(msg);
    }
  };
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const n = ++id;
    pending.set(n, { resolve, reject });
    ws.send(JSON.stringify({ id: n, method, params, sessionId }));
  });
  return { send, on: (fn) => { listeners.add(fn); return () => listeners.delete(fn); } };
}

/**
 * Open a new page (tab). `cdnCache` maps CDN URLs to local files so tests do
 * not depend on the network: requests to https://cdn.jsdelivr.net/npm/<x> are
 * answered from <cdnCache>/<x> when that file exists, else fetched normally.
 */
export async function newPage(browser, { width, height, mobile = false, cdnCache } = {}) {
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (m, p) => browser.send(m, p, sessionId);
  const logs = [];
  browser.on((msg) => {
    if (msg.sessionId !== sessionId) return;
    if (msg.method === 'Runtime.consoleAPICalled') {
      logs.push(`${msg.params.type}: ${msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`);
    } else if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      logs.push(`exception: ${d.exception?.description || d.text}`);
    } else if (msg.method === 'Fetch.requestPaused') {
      const { requestId, request } = msg.params;
      const rel = request.url.replace(/^https:\/\/cdn\.jsdelivr\.net\/npm\//, '');
      const file = cdnCache && join(cdnCache, rel);
      if (file && existsSync(file)) {
        const type = file.endsWith('.mjs') || file.endsWith('.js') ? 'text/javascript' : 'application/octet-stream';
        send('Fetch.fulfillRequest', {
          requestId, responseCode: 200,
          responseHeaders: [{ name: 'Content-Type', value: type }, { name: 'Access-Control-Allow-Origin', value: '*' }],
          body: readFileSync(file).toString('base64'),
        }).catch(() => {});
      } else {
        send('Fetch.continueRequest', { requestId }).catch(() => {});
      }
    }
  });
  await send('Runtime.enable');
  await send('Page.enable');
  if (cdnCache) await send('Fetch.enable', { patterns: [{ urlPattern: 'https://cdn.jsdelivr.net/*' }] });
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile });
  if (mobile) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

  const page = {
    logs,
    send,
    async goto(url) {
      const loaded = new Promise((res) => {
        const off = browser.on((m) => {
          if (m.sessionId === sessionId && m.method === 'Page.loadEventFired') { off(); res(); }
        });
      });
      // A test's goto is a person choosing to go: the editor's "Leave site?" (beforeunload while something is unsaved,
      // 2026-10-21) is answered Leave, or the navigation would wait on it forever (studio-save-fab reloads with a change).
      const offAsk = browser.on((m) => {
        if (m.sessionId === sessionId && m.method === 'Page.javascriptDialogOpening' && m.params.type === 'beforeunload') {
          send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});
        }
      });
      try {
        await send('Page.navigate', { url });
        await loaded;
      } finally {
        offAsk();
      }
    },
    /** Evaluate an expression (or `async () => …` source) in the page and return its JSON value. */
    async eval(expr) {
      const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(`page: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
      return r.result.value;
    },
    /** Poll until `expr` is truthy (or throw after `ms`). */
    async waitFor(expr, ms = 15000) {
      const end = Date.now() + ms;
      for (;;) {
        const v = await page.eval(expr).catch(() => null);
        if (v) return v;
        if (Date.now() > end) throw new Error(`timeout waiting for ${expr}\n${logs.slice(-15).join('\n')}`);
        await new Promise((r) => setTimeout(r, 100));
      }
    },
    /** Mouse press-move-release from (x0,y0) to (x1,y1) in `steps` moves. */
    async mouseDrag(x0, y0, x1, y1, steps = 6) {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0, y: y0 });
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y: y0, button: 'left', buttons: 1, clickCount: 1 });
      for (let i = 1; i <= steps; i++) {
        const x = x0 + ((x1 - x0) * i) / steps, y = y0 + ((y1 - y0) * i) / steps;
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1 });
      }
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x1, y: y1, button: 'left', buttons: 0, clickCount: 1 });
    },
    async click(x, y) { await page.mouseDrag(x, y, x, y, 0); },
    /** One-finger touch drag (a tap when the points are equal). */
    async touchDrag(x0, y0, x1, y1, steps = 6) {
      await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0, id: 1 }] });
      for (let i = 1; i <= steps; i++) {
        const x = x0 + ((x1 - x0) * i) / steps, y = y0 + ((y1 - y0) * i) / steps;
        await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y, id: 1 }] });
      }
      await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    },
    async tap(x, y) { await page.touchDrag(x, y, x, y, 0); },
    async screenshot() {
      const r = await send('Page.captureScreenshot', { format: 'png' });
      return Buffer.from(r.data, 'base64');
    },
    async close() { await browser.send('Target.closeTarget', { targetId }).catch(() => {}); },
  };
  return page;
}
