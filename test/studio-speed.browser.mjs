// The speed pass (2026-10-17), in a headless browser:
//
//   node test/studio-speed.browser.mjs [--only <case>]
//
//   home        Lantern Cove (3D starter): a pick leaves the camera (W1-1); moved away by Camera up, the ⌘K row
//               "Back to the opening view" glides back to the game's own camera; ⇧F does the same.
//   home-2d     Firefly Ruins (2D starter): the same row brings back the view the editor opened on.
//   thumbs-once each list picture is drawn once (before: the shell's second request, for the rows in view, came
//               after the whole queue had run in one task, so every picture was drawn twice), and the list was
//               on screen before the last picture came.
//   loader      a starter opened on its own (no editor) shows a copy saved by the editor: its studio-placement.js
//               is the current one (before: the copy from before copies existed).
//
// Timing itself is not asserted here (it depends on the machine and on the GPU); the play test reports it
// (test/playtest). Uses the zero-dependency CDP client (adapters-2d/cdp.mjs) and the network for the starters'
// engines (STUDIO_CDN_CACHE to answer jsDelivr locally). Exit code 1 on the first failure.
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, newPage } from './adapters-2d/cdp.mjs';
import { startStudioServer } from '../src/server/server.mjs';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const onlyAt = args.indexOf('--only');
const ONLY = onlyAt >= 0 ? args[onlyAt + 1] : null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DBG = `document.querySelector('iframe').contentWindow.__gameStudio._debug`;
const READY = `document.querySelectorAll('.obj').length > 0 && !!document.querySelector('iframe').contentWindow.__gameStudio?._debug`;
const DEG = Math.PI / 180;
const CDN = process.env.STUDIO_CDN_CACHE;

// Every message the shell receives from the game frame, counted by type (installed before any page script runs).
const COUNT_MESSAGES = `(() => { if (window !== window.top) return; const n = (window.__msgCount = {});
  addEventListener('message', (e) => { const t = e.data && e.data.type; if (typeof t === 'string') n[t] = (n[t] || 0) + 1; }, true); })()`;

/** Open `dir` (relative to the package) in the editor on a temporary copy. */
async function open(dir, { phone = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'studio-speed-'));
  cpSync(join(PKG, dir), root, { recursive: true });
  const lines = [];
  const srv = await startStudioServer({ root, uiDir: join(PKG, 'skills/arrange/bin/studio-ui'), log: (l) => lines.push(l) });
  const browser = await launch();
  const page = await newPage(browser, phone ? { width: 390, height: 844, mobile: true, cdnCache: CDN } : { width: 1280, height: 800, cdnCache: CDN });
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: COUNT_MESSAGES });
  await page.goto(srv.url);
  return {
    page, root, lines, browser,
    view: async () => JSON.parse(await page.eval(`JSON.stringify(${DBG}.view())`)),
    anchor: async (k) => JSON.parse(await page.eval(`(() => { const f = document.querySelector('iframe').getBoundingClientRect(); const a = ${DBG}.anchor(${JSON.stringify(k)});
      return JSON.stringify(a ? { x: f.left + a.center[0], y: f.top + a.center[1] } : null); })()`)),
    /** Open ⌘K and press the row `action` (false when it is not listed). */
    palette: (action) => page.eval(`(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
      await new Promise((r) => setTimeout(r, 120));
      const el = [...document.querySelectorAll('.palette [data-action=${action}]')].find((e) => e.offsetParent);
      if (!el) return false; const label = el.textContent; el.click(); return label; })()`),
    async close() {
      await browser.close();
      await srv.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
const ok = (s) => console.log(`  ✓ ${s}`);
/** Where the 3D edit camera stands (view state → world position). */
const camPos = (v) => {
  const cp = Math.cos(v.pitch);
  return [v.target[0] + v.distance * cp * Math.sin(v.yaw), v.target[1] + v.distance * Math.sin(v.pitch), v.target[2] + v.distance * cp * Math.cos(v.yaw)];
};

const cases = {
  async home() {
    const s = await open('starters/lantern-cove');
    try {
      await s.page.waitFor(READY, 90000);
      await sleep(1200);
      const v0 = await s.view();
      assert.equal(v0.home, true, `did not open on the game camera: ${JSON.stringify(v0)}`);
      // The game camera stands at (8, 4.2, 35) (starters/lantern-cove/js/main.js LANDSCAPE). Checked again here
      // because the frame that places it is no longer drawn (boot.js, this pass).
      const p0 = camPos(v0);
      assert.ok(Math.hypot(p0[0] - 8, p0[1] - 4.2, p0[2] - 35) < 0.05, `opened at ${p0.map((x) => x.toFixed(2))}, the game camera is at 8, 4.2, 35`);
      // The first pick leaves the camera where it is: its glide up to a 30° editing angle went with design review wave 1
      // (W1-1, 2026-10-17, "the view belongs to whoever made the game"; bridge/editor.ts select), and plan step 2
      // (2026-10-23) keeps it so. This case asserted the glide until then.
      const a = await s.anchor('sailboat');
      await s.page.click(a.x, a.y);
      await sleep(1100);
      const v1 = await s.view();
      assert.ok(v1.home && Math.hypot(...camPos(v1).map((x, i) => x - p0[i])) < 0.05, `the first pick moved the camera: ${JSON.stringify(v1)}`);
      // Away from it by the person's own move (⌘K Camera up, three steps), then ⌘K → Back to the opening view: glides
      // (half-way it is between the two), then stands where the game camera stands.
      for (let i = 0; i < 3; i++) {
        await s.palette('camera-up');
        await sleep(400);
      }
      const va = await s.view();
      const far = Math.hypot(...camPos(va).map((x, i) => x - p0[i]));
      assert.ok(!va.home && far > 0.5, `Camera up did not move the camera away: ${JSON.stringify(va)}`);
      const label = await s.palette('home');
      assert.equal(label && label.includes('Back to the opening view'), true, `the ⌘K row: ${label}`);
      // Half-way views are only seen when frames come often (software GL draws this scene at about 1 fps), so
      // they are reported, not required.
      let between = 0;
      for (let i = 0; i < 12; i++) {
        const d = Math.hypot(...camPos(await s.view()).map((x, j) => x - p0[j]));
        if (d > 0.01 && d < far - 0.01) between++;
        await sleep(40);
      }
      await sleep(500);
      // With a real GPU (STUDIO_CHROME, see adapters-2d/cdp.mjs) frames are frequent: then a jump instead of a glide fails.
      const gl = await s.page.eval(`(() => { const c = document.createElement('canvas').getContext('webgl'); const d = c && c.getExtension('WEBGL_debug_renderer_info'); return d ? String(c.getParameter(d.UNMASKED_RENDERER_WEBGL)) : ''; })()`);
      if (!/swiftshader/i.test(gl)) assert.ok(between > 0, `jumped instead of gliding (${gl})`);
      const v2 = await s.view();
      const p2 = camPos(v2);
      assert.equal(v2.home, true, 'the view is not marked as the opening view again');
      assert.ok(Math.hypot(p2[0] - 8, p2[1] - 4.2, p2[2] - 35) < 0.05 && Math.abs(v2.pitch - v0.pitch) < 1e-3, `back at ${p2.map((x) => x.toFixed(2))}, pitch ${(v2.pitch / DEG).toFixed(1)}°`);
      ok(`⌘K "${label.trim()}" goes back to the game camera (${far.toFixed(1)} m away → there, ${between} half-way views seen)`);
      // Home again, a pick still leaves the camera.
      const b = await s.anchor('buoy');
      await s.page.click(b.x, b.y);
      await sleep(1100);
      assert.ok(Math.hypot(...camPos(await s.view()).map((x, i) => x - p0[i])) < 0.05, 'the pick after going home moved the camera');
      // ⇧F does the same.
      for (let i = 0; i < 3; i++) {
        await s.palette('camera-up');
        await sleep(400);
      }
      await s.page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'F', code: 'KeyF', modifiers: 8, windowsVirtualKeyCode: 70 });
      await s.page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'F', code: 'KeyF', modifiers: 8, windowsVirtualKeyCode: 70 });
      await sleep(900);
      const v3 = await s.view();
      assert.ok(v3.home === true && Math.hypot(...camPos(v3).map((x, i) => x - [8, 4.2, 35][i])) < 0.05, `⇧F: ${JSON.stringify(v3)}`);
      ok('⇧F does the same; a pick never moves the camera');
    } finally {
      await s.close();
    }
  },

  async 'home-2d'() {
    const s = await open('starters/firefly-ruins');
    try {
      await s.page.waitFor(READY, 60000);
      await sleep(800);
      const v0 = await s.view();
      // Look around: zoom in with the wheel over the game.
      const f = JSON.parse(await s.page.eval(`JSON.stringify(document.querySelector('iframe').getBoundingClientRect())`));
      for (let i = 0; i < 3; i++) {
        await s.page.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: f.left + f.width * 0.3, y: f.top + f.height * 0.4, deltaX: 0, deltaY: -240 });
        await sleep(80);
      }
      await sleep(300);
      assert.notDeepEqual(await s.view(), v0, 'the wheel did not change the view');
      const label = await s.palette('home');
      assert.ok(label, 'no "Back to the opening view" row in the 2D editor');
      await sleep(400);
      const v1 = await s.view();
      assert.deepEqual(JSON.parse(JSON.stringify(v1, (k, x) => (typeof x === 'number' ? Math.round(x * 1000) / 1000 : x))), JSON.parse(JSON.stringify(v0, (k, x) => (typeof x === 'number' ? Math.round(x * 1000) / 1000 : x))), 'not back to the opening view');
      ok(`2D: "${label.trim()}" brings back the view the editor opened on`);
    } finally {
      await s.close();
    }
  },

  async 'thumbs-once'() {
    for (const dir of ['starters/lantern-cove', 'starters/firefly-ruins']) {
      const s = await open(dir);
      try {
        await s.page.waitFor(READY, 90000);
        const n = Number(await s.page.eval(`document.querySelectorAll('.obj').length`));
        const atList = Number(await s.page.eval(`window.__msgCount['studio:placement/thumb'] || 0`));
        await s.page.waitFor(`(window.__msgCount['studio:placement/thumb'] || 0) >= ${n}`, 60000);
        await sleep(2500);
        const drawn = Number(await s.page.eval(`window.__msgCount['studio:placement/thumb'] || 0`));
        const items = JSON.parse(await s.page.eval(`JSON.stringify(${DBG}.list().map((i) => i.key))`));
        assert.ok(drawn <= items.length, `${drawn} pictures drawn for ${items.length} objects`);
        assert.ok(atList < items.length, `the list showed only after all ${atList} pictures were drawn`);
        ok(`${dir}: ${drawn} pictures for ${items.length} objects (list on screen with ${atList} drawn)`);
      } finally {
        await s.close();
      }
    }
  },

  async loader() {
    // 1. Make a copy in the editor and let it reach placement.json.
    const s = await open('starters/lantern-cove');
    let root;
    let key;
    try {
      await s.page.waitFor(READY, 90000);
      await s.page.eval(`window.studioShell.actions.select('buoy')`);
      await sleep(900);
      await s.page.eval('window.studioShell.actions.copy()');
      await s.page.waitFor(`${DBG}.list().some(i => i.copyOf === 'buoy')`, 8000);
      key = await s.page.eval(`${DBG}.list().find(i => i.copyOf === 'buoy').key`);
      await s.page.eval('window.studioShell.actions.save()');
      for (let i = 0; i < 50; i++) {
        const f = join(s.root, 'placement.json');
        if (existsSync(f) && (JSON.parse(readFileSync(f, 'utf8')).added || []).some((a) => a.key === key)) break;
        await sleep(100);
      }
      root = mkdtempSync(join(tmpdir(), 'studio-speed-solo-'));
      cpSync(s.root, root, { recursive: true });
    } finally {
      await s.close();
    }
    // 2. Open the starter on its own (a plain file server, no editor) and look for the copy in its scene.
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png' };
    const http = createServer((req, res) => {
      const rel = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '') || 'index.html';
      const file = join(root, rel);
      if (!file.startsWith(root) || !existsSync(file)) return res.writeHead(404).end();
      res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }).end(readFileSync(file));
    });
    await new Promise((r) => http.listen(0, '127.0.0.1', r));
    const browser = await launch();
    try {
      const page = await newPage(browser, { width: 1280, height: 800, cdnCache: CDN });
      // three announces every Scene to __THREE_DEVTOOLS__: keep them (the editor is not here to do it).
      await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__scenes = []; const h = new EventTarget(); h.addEventListener('observe', (e) => { if (e.detail && e.detail.isScene) window.__scenes.push(e.detail); }); window.__THREE_DEVTOOLS__ = h;` });
      await page.goto(`http://127.0.0.1:${http.address().port}/index.html`);
      await page.waitFor(`(() => { let n = 0; for (const sc of window.__scenes) sc.traverse((o) => { if (o.userData && o.userData.studioKey === ${JSON.stringify(key)}) n++; }); return n > 0; })()`, 30000);
      assert.equal(readFileSync(join(root, 'studio-placement.js'), 'utf8'), readFileSync(join(PKG, 'skills/arrange/bin/studio-placement.js'), 'utf8'));
      ok(`Lantern Cove on its own shows the copy ${key} from placement.json`);
    } finally {
      await browser.close();
      http.close();
      rmSync(root, { recursive: true, force: true });
    }
  },
};

let failed = false;
for (const [name, fn] of Object.entries(cases)) {
  if (ONLY && name !== ONLY) continue;
  console.log(name);
  try {
    await fn();
  } catch (e) {
    failed = true;
    console.error(`  ✗ ${name}: ${e.stack || e}`);
    break;
  }
}
console.log(failed ? 'FAILED' : 'all passed');
process.exit(failed ? 1 : 0);
