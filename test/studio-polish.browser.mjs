// The polish pass (2026-10-16), in a headless browser:
//
//   node test/studio-polish.browser.mjs [--only <case>]
//
//   open-view   Lantern Cove (3D starter): the editor opens on the game's own camera (a near-level dusk shot,
//               not the map from above); the first press on an object in the game glides up to a 30° editing
//               angle around it; Turn turns at once (no axis choices first).
//   play-copy   a copy made in the editor is in the running game after ▶ Play: three-crates (its loader makes
//               it) and Lantern Cove (an older loader: the editor's page script makes it).
//   names       pixi-garden's list: no tree paths (`path:6`), no "No name", no two rows with the same name.
//   game-error  a game that throws: one line says what broke and what to do, with a Reload button.
//   phone-ask   phone: the ⌘K list over the game slides the picked object up; closing it puts the view back.
//
// Uses the zero-dependency CDP client (adapters-2d/cdp.mjs) and the network for the starters' three.js
// (STUDIO_CDN_CACHE to answer jsDelivr locally). Exit code 1 on the first failure.
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
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

/** Open `dir` (relative to the package) in the editor on a temporary copy; `edit(root)` may change the copy first. */
async function open(dir, { phone = false, edit } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'studio-polish-'));
  cpSync(join(PKG, dir), root, { recursive: true });
  if (edit) edit(root);
  const lines = [];
  const srv = await startStudioServer({ root, uiDir: join(PKG, 'skills/arrange/bin/studio-ui'), log: (l) => lines.push(l) });
  const browser = await launch();
  const page = await newPage(browser, phone ? { width: 390, height: 844, mobile: true, cdnCache: process.env.STUDIO_CDN_CACHE } : { width: 1280, height: 800, cdnCache: process.env.STUDIO_CDN_CACHE });
  await page.goto(srv.url);
  return {
    page, root, lines,
    view: async () => JSON.parse(await page.eval(`JSON.stringify(${DBG}.view())`)),
    anchor: async (k) => JSON.parse(await page.eval(`(() => { const f = document.querySelector('iframe').getBoundingClientRect(); const a = ${DBG}.anchor(${JSON.stringify(k)});
      return JSON.stringify(a ? { x: f.left + a.center[0], y: f.top + a.center[1] } : null); })()`)),
    async close() {
      await browser.close();
      await srv.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
const ok = (s) => console.log(`  ✓ ${s}`);
const cases = {
  async 'open-view'() {
    const s = await open('starters/lantern-cove');
    try {
      await s.page.waitFor(READY, 90000);
      await sleep(1500);
      const v0 = await s.view();
      assert.equal(v0.home, true, `the opening view is not the game camera: ${JSON.stringify(v0)}`);
      assert.ok(v0.pitch < 8 * DEG, `the opening view looks down ${(v0.pitch / DEG).toFixed(1)}° (the game's shot is almost level)`);
      // The game camera stands at (8, 4.2, 35) (starters/lantern-cove/js/main.js LANDSCAPE): the edit camera too.
      const cp = Math.cos(v0.pitch);
      const pos = [v0.target[0] + v0.distance * cp * Math.sin(v0.yaw), v0.target[1] + v0.distance * Math.sin(v0.pitch), v0.target[2] + v0.distance * cp * Math.cos(v0.yaw)];
      assert.ok(Math.hypot(pos[0] - 8, pos[1] - 4.2, pos[2] - 35) < 0.05, `edit camera at ${pos.map((x) => x.toFixed(2))}, the game's at 8, 4.2, 35`);
      ok(`opens on the game camera (pitch ${(v0.pitch / DEG).toFixed(1)}°, at ${pos.map((x) => x.toFixed(1)).join(', ')})`);
      const a = await s.anchor('sailboat');
      await s.page.click(a.x, a.y);
      await sleep(1200);
      const v1 = await s.view();
      assert.ok(!v1.home && Math.abs(v1.pitch - 30 * DEG) < 0.02, `after the first pick: ${JSON.stringify(v1)}`);
      const b = await s.anchor('sailboat');
      ok(`the first pick glides to 30° around the sailboat (now at ${b.x.toFixed(0)}, ${b.y.toFixed(0)} px)`);
      // A second pick does not move the view.
      const c = await s.anchor('buoy');
      await s.page.click(c.x, c.y);
      await sleep(900);
      assert.deepEqual(await s.view(), v1, 'a second pick moved the view');
      ok('a second pick leaves the view alone');
      // Turn: one tap and it turns (no "Turn / Tip forward / Tip sideways" first).
      const btn = JSON.parse(await s.page.eval(`(() => { const f = document.querySelector('iframe'); const b = f.contentDocument.querySelector('[data-studio-ui]').shadowRoot.querySelector('[data-studio-handle=rotate]');
        const r = b.getBoundingClientRect(), o = f.getBoundingClientRect(); return JSON.stringify({ x: o.left + r.left + r.width / 2, y: o.top + r.top + r.height / 2 }); })()`));
      await s.page.click(btn.x, btn.y);
      await sleep(400);
      const menu = await s.page.eval(`!!document.querySelector('iframe').contentDocument.querySelector('[data-studio-ui]').shadowRoot.querySelector('[data-studio-choice="axis:y"]')?.getBoundingClientRect().width`);
      assert.equal(menu, false, 'Turn opened the axis choices');
      ok('Turn is chosen in one tap (the tilts are a second tap away)');
    } finally {
      await s.close();
    }
  },

  async 'play-copy'() {
    for (const [dir, from] of [['examples/three-crates', 'crate-4'], ['starters/lantern-cove', 'buoy']]) {
      const s = await open(dir);
      try {
        await s.page.waitFor(READY, 90000);
        await s.page.eval(`window.studioShell.actions.select(${JSON.stringify(from)})`);
        await sleep(900);
        await s.page.eval('window.studioShell.actions.copy()');
        await s.page.waitFor(`${DBG}.list().some(i => i.copyOf === ${JSON.stringify(from)})`, 8000);
        const key = await s.page.eval(`${DBG}.list().find(i => i.copyOf === ${JSON.stringify(from)}).key`);
        const note = await s.page.eval(`document.querySelector('.copy-note')?.textContent || ''`);
        assert.match(note, /shows up in Play/, `the card's copy note: ${note}`);
        await s.page.eval(`[...document.querySelectorAll('[data-action=play]')].find((b) => b.offsetParent || b.offsetHeight)?.click()`);
        const found = `(() => { const w = document.querySelector('iframe').contentWindow; const b = w.__studioThree; if (!b || w.location.search.includes('studio=edit')) return 0;
          let n = 0; for (const sc of b.scenes) sc.traverse((o) => { if (o.userData && o.userData.studioKey === ${JSON.stringify(key)} && o.visible !== false) n++; }); return n; })()`;
        await s.page.waitFor(found, 30000);
        const file = JSON.parse(readFileSync(join(s.root, 'placement.json'), 'utf8'));
        assert.ok((file.added || []).some((x) => x.key === key), 'the copy is not in placement.json');
        ok(`${dir}: the copy ${key} is in the running game after ▶ Play`);
      } finally {
        await s.close();
      }
    }
  },

  async names() {
    const s = await open('examples/pixi-garden');
    try {
      await s.page.waitFor(READY, 60000);
      await sleep(800);
      const names = JSON.parse(await s.page.eval(`JSON.stringify([...document.querySelectorAll('li.obj')].map((r) => r.textContent.trim()))`));
      for (const n of names) assert.doesNotMatch(n, /path:|No name/, `an internal word in the list: "${n}"`);
      const seen = new Set();
      for (const n of names.map((x) => x.replace(/\d+$/, (d) => d))) {
        assert.ok(!seen.has(n), `two rows read "${n}": ${names.join(' | ')}`);
        seen.add(n);
      }
      ok(`pixi-garden list reads: ${names.join(' · ')}`);
    } finally {
      await s.close();
    }
  },

  async 'game-error'() {
    const s = await open('examples/pixi-garden', {
      edit: (root) => {
        const f = join(root, 'index.html');
        writeFileSync(f, readFileSync(f, 'utf8').replace('</body>', '<script>setTimeout(() => { throw new Error("boom from the test"); }, 200);</script></body>'));
      },
    });
    try {
      await s.page.waitFor(`document.querySelector('[data-part=status]')?.textContent.includes('boom from the test')`, 30000);
      const text = await s.page.eval(`document.querySelector('[data-part=status]').textContent`);
      assert.match(text, /^The game stopped on an error:/);
      assert.match(text, /Ask your AI to fix it/);
      assert.ok(await s.page.eval(`!!document.querySelector('[data-action=reload-game]')`), 'no Reload button');
      ok(`one line: "${text}"`);
    } finally {
      await s.close();
    }
  },

  async 'phone-ask'() {
    const s = await open('examples/three-crates', { phone: true });
    try {
      await s.page.waitFor(READY, 60000);
      await sleep(800);
      await s.page.eval(`window.studioShell.actions.select('crate-4')`);
      await sleep(1500); // the first pick's glide
      const v0 = await s.view();
      // Open the ⌘K list (it covers the lower half of a phone), then close it.
      await s.page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'k', code: 'KeyK', modifiers: 2, windowsVirtualKeyCode: 75 });
      await s.page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'k', code: 'KeyK', modifiers: 2, windowsVirtualKeyCode: 75 });
      await sleep(900);
      const moved = JSON.stringify(await s.view()) !== JSON.stringify(v0);
      await s.page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await s.page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await s.page.eval(`document.activeElement && document.activeElement.blur && document.activeElement.blur()`);
      await sleep(900);
      const v1 = await s.view();
      for (let i = 0; i < 3; i++) assert.ok(Math.abs(v1.target[i] - v0.target[i]) < 1e-3, `the view did not come back: ${JSON.stringify(v0)} → ${JSON.stringify(v1)}`);
      ok(`the list ${moved ? 'slid the view, and closing it put it back' : 'did not need to slide the view'}`);
    } finally {
      await s.close();
    }
  },
};

for (const [name, run] of Object.entries(cases)) {
  if (ONLY && name !== ONLY) continue;
  console.log(name);
  await run();
}
console.log('studio-polish: ok');
