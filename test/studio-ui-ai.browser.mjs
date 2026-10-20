// UI stage 1, the real-AI check (2026-10-19): the two browser halves around an AI that applies a saved `ui` by
// skills/arrange/SKILL.md §4 "The UI (`ui`)". In between, a person (or a script) runs the AI on the folder.
//
//   node test/studio-ui-ai.browser.mjs --prepare <game dir> [--shots <dir>]
//       the editor on <game dir> (a copy of examples/three-hud): U, pick the title, drag it 60 right / 80 up,
//       "+" twice, Save. Prints the saved `ui` and the drag.
//   node test/studio-ui-ai.browser.mjs --check <game dir> [--dx 60 --dy -80 --s 1.21] [--shots <dir>]
//       the game WITHOUT the editor (a plain static server), 1280×800: the title's middle must be where the game's
//       CSS puts it plus the drag, at the saved size (±2 px). Exit 1 when not.
//   node test/studio-ui-ai.browser.mjs --reopen <game dir> [--dx 60 --dy -80]
//       the editor again after the AI wrote it into the CSS: on the UI layer the title is listed at offset 0 / size 1
//       (the CSS is its own place now), drawn where the AI put it, and nothing is unsaved.
//   node test/studio-ui-ai.browser.mjs --demo <web demo dir> [--shots <dir>]
//       a try-out build (scripts/build-web-demo.mjs --also examples/three-hud) behind the hosting's test server
//       (test/web-demo-host.mjs): the sample opens, U switches to the UI, the title moves, Save · 1 shows.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';
import { startStudioServer } from '../src/server/server.mjs';
import { launch, newPage } from './adapters-2d/cdp.mjs';
import { startHost } from './web-demo-host.mjs';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const SHOTS = opt('--shots') ? resolve(opt('--shots')) : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WIN = `document.querySelector('iframe').contentWindow`;
const DBG = `${WIN}.__gameStudio._debug`;
const MOD = process.platform === 'darwin' ? 4 : 2;
const key = async (page, k, modifiers = 0) => {
  const [code, vk] = k === '+' ? ['Equal', 187] : [`Key${k.toUpperCase()}`, k.toUpperCase().charCodeAt(0)];
  const base = { key: k, code, windowsVirtualKeyCode: vk, modifiers };
  await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base });
  if (!(modifiers & (2 | 4))) await page.send('Input.dispatchKeyEvent', { type: 'char', ...base, text: k });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  await sleep(150);
};

const browser = await launch();
try {
  if (opt('--prepare')) {
    const root = resolve(opt('--prepare'));
    const srv = await startStudioServer({ root, uiDir: join(PKG, 'skills/arrange/bin/studio-ui'), log: () => {} });
    try {
      const page = await newPage(browser, { width: 1280, height: 800 });
      await page.goto(srv.url);
      await page.waitFor(`!!${WIN}.__gameStudio?._debug && studioShell.items().length > 0`, 45000);
      await sleep(1200);
      await key(page, 'u');
      await page.waitFor(`${DBG}.layer() === 'ui'`, 5000);
      const box = async () => JSON.parse(await page.eval(`(() => { const f = document.querySelector('iframe').getBoundingClientRect();
        const r = ${WIN}.document.querySelector('[data-studio-key="title-card"]').getBoundingClientRect();
        return JSON.stringify({ cx: f.left + r.left + r.width / 2, cy: f.top + r.top + r.height / 2 }); })()`));
      const b0 = await box();
      await page.click(b0.cx, b0.cy);
      await page.waitFor(`studioShell.selected() === 'title-card'`, 3000);
      await page.mouseDrag(b0.cx, b0.cy, b0.cx + 60, b0.cy - 80, 10);
      await sleep(400);
      await key(page, '+');
      await key(page, '+');
      await sleep(300);
      const b1 = await box();
      if (SHOTS) writeFileSync(join(SHOTS, 'ai-editor-before-save.png'), await page.screenshot());
      await key(page, 's', MOD);
      const file = join(root, 'placement.json');
      for (let i = 0; i < 60 && !(existsSync(file) && JSON.parse(readFileSync(file, 'utf8')).ui); i++) await sleep(150);
      await sleep(600);
      const saved = JSON.parse(readFileSync(file, 'utf8'));
      assert.ok(saved.ui?.['title-card'], 'saved');
      console.log(JSON.stringify({ ui: saved.ui, uiView: saved.uiView, drag: [b1.cx - b0.cx, b1.cy - b0.cy] }));
    } finally {
      await srv.close();
    }
  } else if (opt('--demo')) {
    const host = await startHost({ dir: resolve(opt('--demo')) });
    try {
      const page = await newPage(browser, { width: 1280, height: 800 });
      await page.goto(`${host.url}studio/?game=three-hud&lang=en`);
      await page.waitFor(`!!${WIN}.__gameStudio?._debug && studioShell.items().length > 0`, 60000);
      await sleep(1500);
      // On the world the game's UI is hidden, the eye says so (a try of the editor, 2026-10-20, test/studio-ui-layer.browser.mjs).
      const hidden = JSON.parse(await page.eval(`JSON.stringify({ filter: ${WIN}.getComputedStyle(${WIN}.document.querySelector('[data-studio-key="title-card"]')).filter,
        eye: document.querySelector('[data-part=ui-peek]')?.getAttribute('aria-pressed') ?? null })`));
      assert.deepEqual(hidden, { filter: 'opacity(0)', eye: 'false' }, 'the try-out build hides the UI on the world');
      if (SHOTS) writeFileSync(join(SHOTS, 'demo-world.png'), await page.screenshot());
      await key(page, 'u');
      await page.waitFor(`${DBG}.layer() === 'ui' && studioShell.items().length === 3`, 5000);
      const b0 = JSON.parse(await page.eval(`(() => { const f = document.querySelector('iframe').getBoundingClientRect();
        const r = ${WIN}.document.querySelector('[data-studio-key="title-card"]').getBoundingClientRect();
        return JSON.stringify({ cx: f.left + r.left + r.width / 2, cy: f.top + r.top + r.height / 2 }); })()`));
      await page.click(b0.cx, b0.cy);
      await page.waitFor(`studioShell.selected() === 'title-card'`, 3000);
      await page.mouseDrag(b0.cx, b0.cy, b0.cx + 40, b0.cy - 60, 8);
      await sleep(500);
      const p = JSON.parse(await page.eval(`JSON.stringify(${DBG}.list().find((i) => i.key === 'title-card').pose.p)`));
      assert.ok(Math.abs(p[0] - 40) < 2 && Math.abs(p[1] + 60) < 2, `moved: ${p}`);
      const save = await page.eval(`document.querySelector('[data-action=save]')?.innerText.replace(/\\s+/g, ' ').trim()`);
      assert.match(save, /Save\s*·?\s*1/, `Save shows one change: ${save}`);
      if (SHOTS) writeFileSync(join(SHOTS, 'demo-ui-moved.png'), await page.screenshot());
      const errors = page.logs.filter((l) => l.startsWith('exception'));
      assert.deepEqual(errors, [], 'page errors');
      console.log('studio-ui-ai: the try-out build edits the UI');
    } finally {
      await host.close?.();
    }
  } else if (opt('--reopen')) {
    const root = resolve(opt('--reopen'));
    const dx = Number(opt('--dx') ?? 60), dy = Number(opt('--dy') ?? -80);
    const srv = await startStudioServer({ root, uiDir: join(PKG, 'skills/arrange/bin/studio-ui'), log: () => {} });
    try {
      const page = await newPage(browser, { width: 1280, height: 800 });
      await page.goto(srv.url);
      await page.waitFor(`!!${WIN}.__gameStudio?._debug && studioShell.items().length > 0`, 45000);
      await sleep(1200);
      await key(page, 'u');
      await page.waitFor(`${DBG}.layer() === 'ui'`, 5000);
      await sleep(500);
      const r = JSON.parse(await page.eval(`(() => { const w = ${WIN}; const e = w.document.querySelector('[data-studio-key="title-card"]'); const b = e.getBoundingClientRect();
        return JSON.stringify({ pose: ${DBG}.list().find((i) => i.key === 'title-card').pose, cx: b.left + b.width / 2, cy: b.top + b.height / 2, vw: w.innerWidth, vh: w.innerHeight,
          save: !!document.querySelector('[data-action=save]:not([hidden])') && getComputedStyle(document.querySelector('[data-action=save]')).display !== 'none' }); })()`));
      console.log(JSON.stringify(r));
      assert.deepEqual([Math.round(r.pose.p[0]), Math.round(r.pose.p[1]), r.pose.s], [0, 0, 1], 'listed at its own place');
      assert.ok(Math.abs(r.cx - (r.vw / 2 + dx)) <= 2 && Math.abs(r.cy - (r.vh * 0.42 + dy)) <= 2, 'drawn where the AI put it');
      assert.equal(r.save, false, 'nothing unsaved');
      if (SHOTS) writeFileSync(join(SHOTS, 'ai-editor-reopened.png'), await page.screenshot());
      console.log('studio-ui-ai: reopened — offset 0, drawn in place, nothing unsaved');
    } finally {
      await srv.close();
    }
  } else if (opt('--check')) {
    const root = resolve(opt('--check'));
    const dx = Number(opt('--dx') ?? 60), dy = Number(opt('--dy') ?? -80), s = Number(opt('--s') ?? 1.21);
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css' };
    const http = createServer((req, res) => {
      const p = join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
      if (!p.startsWith(root) || !existsSync(p)) return res.writeHead(404).end();
      res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' }).end(readFileSync(p));
    });
    await new Promise((ok) => http.listen(0, '127.0.0.1', ok));
    try {
      const page = await newPage(browser, { width: 1280, height: 800 });
      await page.goto(`http://127.0.0.1:${http.address().port}/index.html`);
      await page.waitFor(`!!document.querySelector('canvas')`, 30000);
      await sleep(1500);
      // Where the game's CSS alone (as first written: left 50 %, top 42 %, centred by its transform) puts the middle.
      const m = JSON.parse(await page.eval(`(() => { const e = document.querySelector('[data-studio-key="title-card"]'); const r = e.getBoundingClientRect();
        return JSON.stringify({ cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, ow: e.offsetWidth, loader: !!window.__gameStudio, css: getComputedStyle(e).translate + ' | ' + getComputedStyle(e).scale + ' | ' + getComputedStyle(e).transformOrigin }); })()`));
      if (SHOTS) writeFileSync(join(SHOTS, 'ai-game-after.png'), await page.screenshot());
      console.log(JSON.stringify(m));
      assert.ok(Math.abs(m.cx - (640 + dx)) <= 2, `x: ${m.cx} vs ${640 + dx}`);
      assert.ok(Math.abs(m.cy - (800 * 0.42 + dy)) <= 2, `y: ${m.cy} vs ${800 * 0.42 + dy}`);
      assert.ok(Math.abs(m.w / m.ow - s) <= 0.01, `size: ${m.w / m.ow} vs ${s}`);
      console.log('studio-ui-ai: the title is where it was put, at that size');
    } finally {
      http.close();
    }
  }
} finally {
  await browser.close();
}
