// Minimal Chrome DevTools Protocol client for headless tests: no dependencies (Node 22's global WebSocket).
// Launches a headless Chrome / chrome-headless-shell, opens one page, and offers real input (mouse, touch, keys).
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

/** STUDIO_CHROME, else a Playwright-installed headless shell, else the system Chrome. null when none is found. */
export function findChrome() {
  if (process.env.STUDIO_CHROME) return process.env.STUDIO_CHROME;
  const cache = join(homedir(), 'Library', 'Caches', 'ms-playwright');
  const linuxCache = join(homedir(), '.cache', 'ms-playwright');
  for (const root of [cache, linuxCache]) {
    if (!existsSync(root)) continue;
    const dirs = readdirSync(root).filter((d) => d.startsWith('chromium_headless_shell-')).sort().reverse();
    for (const d of dirs) {
      for (const sub of ['chrome-headless-shell-mac-arm64', 'chrome-headless-shell-mac-x64', 'chrome-headless-shell-linux64']) {
        const p = join(root, d, sub, 'chrome-headless-shell');
        if (existsSync(p)) return p;
      }
    }
  }
  for (const p of ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium']) if (existsSync(p)) return p;
  return null;
}

export async function launch(chromePath) {
  const profile = mkdtempSync(join(tmpdir(), 'studio-cdp-'));
  const args = ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--hide-scrollbars', '--mute-audio', 'about:blank'];
  const proc = spawn(chromePath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  const wsUrl = await new Promise((resolve, reject) => {
    let buf = '';
    const t = setTimeout(() => reject(new Error('chrome did not start')), 20000);
    proc.stderr.on('data', (d) => {
      buf += d;
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) clearTimeout(t), resolve(m[1]);
    });
    proc.on('exit', (c) => reject(new Error(`chrome exited ${c}`)));
  });
  const ws = new WebSocket(wsUrl);
  await new Promise((r, j) => ((ws.onopen = r), (ws.onerror = j)));
  let id = 0;
  const pending = new Map();
  const handlers = new Map(); // `${sessionId}:${method}` → fn
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? reject(new Error(`${m.error.message} ${m.error.data || ''}`)) : resolve(m.result);
    } else if (m.method) {
      const h = handlers.get(`${m.sessionId || ''}:${m.method}`);
      if (h) h(m.params);
    }
  };
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const mid = ++id;
      pending.set(mid, { resolve, reject });
      ws.send(JSON.stringify({ id: mid, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  const browser = {
    async newPage() {
      const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
      return makePage(send, handlers, sessionId);
    },
    async close() {
      try { await send('Browser.close'); } catch { /* already gone */ }
      ws.close();
      const gone = new Promise((r) => (proc.exitCode !== null ? r() : proc.once('exit', r)));
      proc.kill();
      await gone;
      try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* temp dir; the OS cleans it */ }
    }
  };
  return browser;
}

function makePage(send, handlers, sessionId) {
  const s = (m, p) => send(m, p, sessionId);
  const page = {
    send: s,
    on: (method, fn) => handlers.set(`${sessionId}:${method}`, fn),
    async eval(expr) {
      const r = await s('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(`page: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
      return r.result.value;
    },
    async viewport(width, height, mobile) {
      await s('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile: !!mobile });
      await s('Emulation.setTouchEmulationEnabled', { enabled: !!mobile, maxTouchPoints: mobile ? 5 : 1 });
    },
    async goto(url) {
      const loaded = new Promise((r) => page.on('Page.loadEventFired', r));
      await s('Page.navigate', { url });
      await loaded;
    },
    /** Two real frames of the page (the native rAF: the game's rAF is held while editing). */
    frames: () => page.eval('new Promise(r => { const f = (globalThis.__studioThree && __studioThree.nativeRAF) || requestAnimationFrame; f(() => f(() => r(true))); })'),
    mouse: {
      async move(x, y, buttons = 0) { await s('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons, button: buttons ? 'left' : 'none' }); },
      async down(x, y) { await s('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 }); },
      async up(x, y) { await s('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 }); },
      async wheel(x, y, deltaY) { await s('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY }); },
      async click(x, y) { await page.mouse.move(x, y); await page.mouse.down(x, y); await page.mouse.up(x, y); },
      /** Press at a, move in `steps` real events to b, release. */
      async drag(a, b, steps = 12) {
        await page.mouse.move(a[0], a[1]);
        await page.mouse.down(a[0], a[1]);
        for (let i = 1; i <= steps; i++) await page.mouse.move(a[0] + ((b[0] - a[0]) * i) / steps, a[1] + ((b[1] - a[1]) * i) / steps, 1);
        await page.mouse.up(b[0], b[1]);
      }
    },
    touch: {
      async tap(x, y) {
        await s('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
        await s('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      },
      /** One finger along a path of points. */
      async path(points) {
        await s('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: points[0][0], y: points[0][1], id: 1 }] });
        for (const p of points.slice(1)) await s('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p[0], y: p[1], id: 1 }] });
        await s('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      },
      async drag(a, b, steps = 12) {
        const pts = [];
        for (let i = 0; i <= steps; i++) pts.push([a[0] + ((b[0] - a[0]) * i) / steps, a[1] + ((b[1] - a[1]) * i) / steps]);
        await page.touch.path(pts);
      },
      /** Two fingers moving apart (factor > 1) around a centre. */
      async pinch(cx, cy, d0, d1, steps = 10) {
        const pts = (d) => [{ x: cx - d / 2, y: cy, id: 1 }, { x: cx + d / 2, y: cy, id: 2 }];
        await s('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(d0) });
        for (let i = 1; i <= steps; i++) await s('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(d0 + ((d1 - d0) * i) / steps) });
        await s('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      }
    },
    async key(key, code, vk, modifiers = 0) {
      await s('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode: vk, modifiers });
      await s('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, modifiers });
    },
    async screenshot() {
      const { data } = await s('Page.captureScreenshot', { format: 'png' });
      return Buffer.from(data, 'base64');
    }
  };
  return page;
}
