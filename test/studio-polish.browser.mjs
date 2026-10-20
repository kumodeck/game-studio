// The polish pass (2026-10-16), in a headless browser:
//
//   node test/studio-polish.browser.mjs [--only <case>]
//
//   open-view   Lantern Cove (3D starter): the editor opens on the game's own camera (a near-level dusk shot,
//               not the map from above); a press on an object in the game leaves the camera where it is (design review wave 1,
//               W1-1: the first pick used to glide up to a 30° editing angle); Turn turns at once (no axis choices first).
//   play-copy   a copy made in the editor is in the running game after ▶ Play: three-crates (its loader makes
//               it) and Lantern Cove (an older loader: the editor's page script makes it).
//   names       pixi-garden's list: no tree paths (`path:6`), no "No name", no two rows with the same name.
//   game-error  a game that throws: one line says what broke and what to do, with a Reload button.
//   phone-ask   phone: the ⌘K list over the game leaves the view alone, open and closed (W1-1; it used to slide).
//
// Design review wave 1 (2026-10-17), Lantern Cove:
//   w1-camera   PC and phone: picking (a click / a tap), the phone's list sheet and its "…" list never move the
//               camera (_debug.view() equal, the lighthouse's box within 2 px); a list pick of an object out of
//               sight slides the view only (no turn, no zoom) in about 0.35 s, into the middle 60 %.
//   w1-strip    the strip 12 px under the object, not moved by changing tools; no name tag over a picked object
//               (PC: only when the mouse comes back over it); the phone's strip 48 high, 44 px buttons, the chosen
//               tool marked by its ground only.
//   w1-pages    Ideas and Editor view (list on the left, on the right, phone) leave the game frame where it is
//               (same box, to the pixel); Esc closes them.
//   w1-cmdk     with Editor view open, ⌘K (PC) / "…" (phone) opens the list and what is typed lands in its own
//               field; the ask box keeps exactly what it had.
//   w1-card     PC: X / Y / Z read -24.0 / 6.6 / -20.0, none cut; the card's picture is the object, not an "i"
//               (opaque pixels fill most of it). Phone: no numbers on the card.
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
// Measures and keys for the wave 1 cases (page px; the game frame's own px are turned into the page's).
const w1 = {
  async key(page, k, modifiers = 0) {
    const code = k.length === 1 ? `Key${k.toUpperCase()}` : k;
    const base = { key: k, code, windowsVirtualKeyCode: k === 'Escape' ? 27 : k.toUpperCase().charCodeAt(0), modifiers };
    await page.send('Input.dispatchKeyEvent', { type: modifiers ? 'rawKeyDown' : 'keyDown', ...base, ...(k.length === 1 && !modifiers ? { text: k } : {}) });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  },
  async box(page, key) {
    return JSON.parse(await page.eval(`(() => { const f = document.querySelector('iframe').getBoundingClientRect(); const a = ${DBG}.anchor(${JSON.stringify(key)});
      const r = a.rect || { x: a.center[0] - a.size / 2, y: a.center[1] - a.size / 2, w: a.size, h: a.size };
      return JSON.stringify({ x: Math.round(f.left + r.x), y: Math.round(f.top + r.y), w: Math.round(r.w), h: Math.round(r.h) }); })()`));
  },
  /** A point on the lighthouse's tower: its world position (the base) lifted a little, on screen. */
  async tower(page) {
    return JSON.parse(await page.eval(`(() => { const f = document.querySelector('iframe'); const o = f.getBoundingClientRect(); const a = ${DBG}.anchor('lighthouse');
      const r = a.rect; const x = a.center[0]; const y = r ? r.y + r.h * 0.6 : a.center[1];
      return JSON.stringify({ x: o.left + x, y: o.top + y }); })()`));
  },
  async frame(page) {
    return JSON.parse(await page.eval(`(() => { const r = document.querySelector('iframe').getBoundingClientRect(); return JSON.stringify({ x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }); })()`));
  },
  async strip(page) {
    return JSON.parse(await page.eval(`(() => { const f = document.querySelector('iframe'); const o = f.getBoundingClientRect(); const ui = f.contentDocument.querySelector('[data-studio-ui]').shadowRoot;
      const row = ui.querySelector('.row'); if (!row || getComputedStyle(row).display === 'none') return 'null';
      const r = row.getBoundingClientRect(); const t = ui.querySelector('[data-studio-handle=rotate]'); const tr = t.getBoundingClientRect(); const bg = getComputedStyle(t).backgroundColor;
      const m = /rgba?\\(([^)]+)\\)/.exec(bg); const parts = m ? m[1].split(',').map(Number) : [0, 0, 0, 0];
      return JSON.stringify({ x: Math.round(o.left + r.left), y: Math.round(o.top + r.top), w: Math.round(r.width), h: Math.round(r.height), bw: Math.round(tr.width),
        rotate: { x: o.left + tr.left + tr.width / 2, y: o.top + tr.top + tr.height / 2 }, turnOn: t.getAttribute('aria-pressed') === 'true', turnBg: bg, turnBgAlpha: parts.length > 3 ? parts[3] : 1 }); })()`));
  },
  async tagShown(page) {
    return page.eval(`(() => { const ui = document.querySelector('iframe').contentDocument.querySelector('[data-studio-ui]').shadowRoot; const t = ui.querySelector('.tag.you');
      return !!t && getComputedStyle(t).display !== 'none' && !!t.textContent; })()`);
  },
};

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
      assert.equal(await s.page.eval('window.studioShell.selected()'), 'sailboat', 'the press did not pick the sailboat');
      assert.deepEqual(v1, v0, `the first pick moved the view (W1-1): ${JSON.stringify(v0)} → ${JSON.stringify(v1)}`);
      ok('the first pick leaves the game camera where it is (W1-1)');
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
      ok('Turn is chosen in one tap (the tilts are behind its ▾)');
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
        assert.match(note, /Save to keep it/, `the card's copy note: ${note}`);
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
      await sleep(1500); // (a list pick of an object out of sight would slide for 0.35 s)
      const v0 = await s.view();
      // Open the ⌘K list (it covers the lower half of a phone), then close it.
      await s.page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'k', code: 'KeyK', modifiers: 2, windowsVirtualKeyCode: 75 });
      await s.page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'k', code: 'KeyK', modifiers: 2, windowsVirtualKeyCode: 75 });
      await sleep(900);
      assert.deepEqual(await s.view(), v0, 'opening the ⌘K list moved the view (W1-1)');
      await s.page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await s.page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await s.page.eval(`document.activeElement && document.activeElement.blur && document.activeElement.blur()`);
      await sleep(900);
      const v1 = await s.view();
      for (let i = 0; i < 3; i++) assert.ok(Math.abs(v1.target[i] - v0.target[i]) < 1e-3, `the view did not come back: ${JSON.stringify(v0)} → ${JSON.stringify(v1)}`);
      assert.deepEqual(v1, v0, 'closing the ⌘K list moved the view');
      ok('the ⌘K list leaves the view alone, open and closed');
    } finally {
      await s.close();
    }
  },

  // ----- design review wave 1 (2026-10-17) -----
  async 'w1-camera'() {
    for (const phone of [false, true]) {
      const tag = phone ? 'phone 390' : 'PC 1280';
      const s = await open('starters/lantern-cove', { phone });
      try {
        await s.page.waitFor(READY, 90000);
        await sleep(1500);
        const v0 = await s.view();
        const b0 = await w1.box(s.page, 'lighthouse');
        // A real press on the lighthouse's tower (its box also holds the faint light beam: aim at the lower middle).
        const at = await w1.tower(s.page);
        if (phone) await s.page.tap(at.x, at.y);
        else await s.page.click(at.x, at.y);
        await sleep(1200);
        assert.equal(await s.page.eval('window.studioShell.selected()'), 'lighthouse', `${tag}: the press did not pick the lighthouse`);
        assert.deepEqual(await s.view(), v0, `${tag}: picking moved the camera`);
        const b1 = await w1.box(s.page, 'lighthouse');
        for (const k of ['x', 'y', 'w', 'h']) assert.ok(Math.abs(b1[k] - b0[k]) <= 2, `${tag}: the lighthouse's box moved: ${JSON.stringify(b0)} → ${JSON.stringify(b1)}`);
        ok(`${tag}: picking leaves the camera and the lighthouse where they were (box ${JSON.stringify(b1)})`);
        if (phone) {
          await s.page.eval(`[...document.querySelectorAll('[data-action=sheet]')].find((e) => e.offsetParent).click()`);
          await sleep(1000);
          assert.deepEqual(await s.view(), v0, `${tag}: opening the list sheet moved the camera`);
          await s.page.eval(`[...document.querySelectorAll('.sheet-more')].find((e) => e.offsetParent).click()`);
          await sleep(1000);
          assert.ok(await s.page.eval(`!!document.querySelector('#studio-palette:not([hidden])')`), `${tag}: "…" did not open the list`);
          assert.deepEqual(await s.view(), v0, `${tag}: opening the "…" list moved the camera`);
          await w1.key(s.page, 'Escape');
          await sleep(600);
          assert.deepEqual(await s.view(), v0, `${tag}: closing the "…" list moved the camera`);
          ok(`${tag}: the list sheet and the "…" list leave the camera alone`);
        }
        // An object out of sight, picked from the list: a slide only, ~0.35 s, into the middle 60 % of the seen part.
        const out = await s.page.eval(`(() => { const d = ${DBG}; const f = document.querySelector('iframe'); const W = f.clientWidth, H = f.clientHeight;
          const k = d.list().map((i) => i.key).find((k) => { const a = d.anchor(k); return a && a.visible && (a.center[0] < -40 || a.center[0] > W + 40 || a.center[1] < -40 || a.center[1] > H + 40); });
          return k || null; })()`);
        if (!out) {
          ok(`${tag}: (every object is in sight from the opening view; the slide is not tried)`);
        } else {
          // (The slide is 0.35 s by the clock, editor.ts GLIDE_MS. Not timed here: on this test's software GPU one
          // frame of Lantern Cove can take a second, so the slide is one or two frames.)
          await s.page.eval(`window.studioShell.actions.select(${JSON.stringify(out)})`);
          await s.page.waitFor(`(() => { const a = ${DBG}.anchor(${JSON.stringify(out)}); const f = document.querySelector('iframe'); return a && a.center[0] > 0 && a.center[0] < f.clientWidth && a.center[1] > 0 && a.center[1] < f.clientHeight; })()`, 8000);
          await sleep(600);
          const v2 = await s.view();
          for (const k of ['yaw', 'pitch', 'distance']) assert.ok(Math.abs(v2[k] - v0[k]) < 1e-6, `${tag}: the list pick turned or zoomed (${k} ${v0[k]} → ${v2[k]})`);
          const m = await s.page.eval(`(() => { const a = ${DBG}.anchor(${JSON.stringify(out)}); const f = document.querySelector('iframe'); return JSON.stringify({ x: a.center[0] / f.clientWidth, y: a.center[1] / f.clientHeight }); })()`);
          const c = JSON.parse(m);
          assert.ok(c.x > 0.15 && c.x < 0.85 && c.y > 0.1 && c.y < 0.9, `${tag}: ${out} is not near the middle after the slide: ${m}`);
          ok(`${tag}: ${out} (out of sight) picked from the list: slid into view, no turn, no zoom (at ${c.x.toFixed(2)}, ${c.y.toFixed(2)} of the frame)`);
        }
      } finally {
        await s.close();
      }
    }
  },

  async 'w1-strip'() {
    for (const phone of [false, true]) {
      const tag = phone ? 'phone 390' : 'PC 1280';
      const s = await open('starters/lantern-cove', { phone });
      try {
        await s.page.waitFor(READY, 90000);
        await sleep(1500);
        const at = await w1.tower(s.page);
        if (phone) await s.page.tap(at.x, at.y);
        else await s.page.click(at.x, at.y);
        await sleep(1000);
        const r0 = await w1.strip(s.page);
        const box = await w1.box(s.page, 'lighthouse');
        assert.ok(r0, `${tag}: no strip`);
        assert.ok(Math.abs(r0.y - (box.y + box.h + 12)) <= 1, `${tag}: the strip is not 12 px under the object (object bottom ${box.y + box.h}, strip top ${r0.y})`);
        assert.equal(await w1.tagShown(s.page), false, `${tag}: a name tag over the picked object`);
        // Another tool (T on PC; the strip's turn button on the phone): the strip does not move by a pixel.
        if (phone) await s.page.tap(r0.rotate.x, r0.rotate.y);
        else {
          await s.page.eval('document.activeElement?.blur?.()');
          await w1.key(s.page, 't');
        }
        await sleep(600);
        const r1 = await w1.strip(s.page);
        assert.deepEqual({ x: r1.x, y: r1.y, w: r1.w, h: r1.h }, { x: r0.x, y: r0.y, w: r0.w, h: r0.h }, `${tag}: changing tools moved the strip`);
        assert.equal(r1.turnOn, true, `${tag}: the turn button is not marked chosen`);
        if (phone) {
          assert.equal(r1.h, 48, `${tag}: the strip is ${r1.h} high (want 48)`);
          assert.equal(r1.bw, 44, `${tag}: strip buttons are ${r1.bw} px (want 44)`);
          // Its ground only: a faint fill (alpha ≤ 0.12), never the solid ink plate.
          assert.ok(r1.turnBgAlpha > 0 && r1.turnBgAlpha <= 0.12, `${tag}: the chosen tool's ground is ${r1.turnBg}`);
        } else {
          // The tag comes back only when the mouse comes back over the object (after leaving it).
          await s.page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1200, y: 700 });
          await sleep(200);
          await s.page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y });
          await sleep(400);
          assert.equal(await w1.tagShown(s.page), true, `${tag}: no name tag when the mouse comes back over the picked object`);
        }
        ok(`${tag}: strip 12 px under the object at ${JSON.stringify({ x: r1.x, y: r1.y, w: r1.w, h: r1.h })}, unmoved by Turn; no tag on pick${phone ? '; 48 high, 44 px buttons, chosen = ground only' : '; the tag on hover'}`);
      } finally {
        await s.close();
      }
    }
  },

  async 'w1-pages'() {
    for (const [phone, side] of [[false, 'left'], [false, 'right'], [true, 'phone']]) {
      const tag = phone ? 'phone 390' : `PC 1280, list on the ${side}`;
      const s = await open('starters/lantern-cove', { phone });
      try {
        await s.page.waitFor(READY, 90000);
        if (side === 'right') await s.page.eval(`window.studioShell.setPrefs({ panel: 'right' })`);
        await sleep(1200);
        const f0 = await w1.frame(s.page);
        for (const [open, name] of [['openNextSteps', 'Ideas'], ['openSettings', 'Editor view']]) {
          await s.page.eval(`window.studioShell.actions.${open}()`);
          await sleep(700);
          assert.notEqual(await s.page.eval(`document.querySelector('.shell').dataset.page`), 'tool', `${tag}: ${name} did not open`);
          const f1 = await w1.frame(s.page);
          assert.deepEqual(f1, f0, `${tag}: ${name} moved the game frame: ${JSON.stringify(f0)} → ${JSON.stringify(f1)}`);
          if (!phone) {
            const col = await s.page.eval(`Math.round(document.querySelector('.side').getBoundingClientRect().width)`);
            assert.equal(col, 248, `${tag}: ${name} widened the list column to ${col}px`);
          }
          await s.page.eval('document.activeElement?.blur?.()');
          await w1.key(s.page, 'Escape');
          await sleep(500);
          assert.equal(await s.page.eval(`document.querySelector('.shell').dataset.page`), 'tool', `${tag}: Esc did not close ${name}`);
        }
        ok(`${tag}: Ideas and Editor view keep the game frame at ${JSON.stringify(f0)}; Esc closes each`);
      } finally {
        await s.close();
      }
    }
  },

  async 'w1-cmdk'() {
    for (const phone of [false, true]) {
      const tag = phone ? 'phone 390' : 'PC 1280';
      const s = await open('starters/lantern-cove', { phone });
      try {
        await s.page.waitFor(READY, 90000);
        await sleep(1000);
        const ASK = `document.querySelector('.dock .ask-slot input')`;
        await s.page.eval(`(() => { const i = ${ASK}; i.value = 'keep this sentence'; i.dispatchEvent(new Event('input', { bubbles: true })); i.blur(); })()`);
        await s.page.eval('window.studioShell.actions.openSettings()');
        await sleep(600);
        if (phone) await s.page.eval(`[...document.querySelectorAll('.sheet-more')].find((e) => e.offsetParent).click()`);
        else await w1.key(s.page, 'k', 2);
        await sleep(400);
        await s.page.send('Input.insertText', { text: 'Editor view' });
        await sleep(400);
        const st = JSON.parse(await s.page.eval(`JSON.stringify({ open: !!document.querySelector('#studio-palette:not([hidden])'), search: document.querySelector('[data-part=palette-search]')?.value ?? null,
          ask: ${ASK}.value, focus: document.activeElement?.dataset?.part || document.activeElement?.tagName, rows: [...document.querySelectorAll('#studio-palette .p-row')].map((r) => r.textContent.trim()).slice(0, 4) })`));
        assert.equal(st.open, true, `${tag}: the list did not open`);
        assert.equal(st.search, 'Editor view', `${tag}: the typed words are not in the list's field: ${JSON.stringify(st)}`);
        assert.equal(st.ask, 'keep this sentence', `${tag}: the ask box changed: ${JSON.stringify(st)}`);
        assert.ok(st.rows.some((r) => /Editor view/.test(r)), `${tag}: the list did not find Editor view: ${st.rows.join(' | ')}`);
        // Enter on the found action runs it; the ask box still has its sentence, nothing was sent.
        await w1.key(s.page, 'Escape');
        await sleep(300);
        assert.equal(await s.page.eval(`${ASK}.value`), 'keep this sentence', `${tag}: closing the list changed the ask box`);
        ok(`${tag}: with Editor view open, ${phone ? '"…"' : '⌘K'} → the list's own field gets "Editor view"; the ask box keeps its sentence`);
      } finally {
        await s.close();
      }
    }
  },

  async 'w1-card'() {
    for (const phone of [false, true]) {
      const tag = phone ? 'phone 390' : 'PC 1280';
      const s = await open('starters/lantern-cove', { phone });
      try {
        await s.page.waitFor(READY, 90000);
        await sleep(1000);
        await s.page.eval(`window.studioShell.actions.select('lighthouse')`);
        await sleep(2500); // the card's picture arrives after the list's
        const c = JSON.parse(await s.page.eval(`(() => { const card = [...document.querySelectorAll('.card')].find((e) => !e.hidden && e.offsetParent);
          const nums = [...card.querySelectorAll('.f-cells.n3 .num input')].filter((i) => i.checkVisibility({ visibilityProperty: true, opacityProperty: true })).map((i) => ({ v: i.value, cut: i.scrollWidth > i.clientWidth + 1 }));
          return JSON.stringify({ nums, w: Math.round(card.getBoundingClientRect().width), key: card.querySelector('.head-text .key')?.textContent ?? '', thumb: card.querySelector('.card-head > .thumb')?.src || '' }); })()`));
        if (phone) {
          assert.equal(c.nums.length, 0, `${tag}: numbers on the card: ${JSON.stringify(c.nums)}`);
          assert.doesNotMatch(c.key, /\d/, `${tag}: numbers in the card's head: "${c.key}"`);
          ok(`${tag}: no numbers on the card`);
        } else {
          assert.deepEqual(c.nums.map((n) => n.v), ['-24.0', '6.6', '-20.0'], `${tag}: X / Y / Z read ${c.nums.map((n) => n.v).join(' / ')}`);
          assert.deepEqual(c.nums.filter((n) => n.cut), [], `${tag}: a number is cut: ${JSON.stringify(c.nums)}`);
          assert.equal(c.w, 272, `${tag}: the card is ${c.w}px wide`);
          ok(`${tag}: X / Y / Z = ${c.nums.map((n) => n.v).join(' / ')}, none cut, card 272 px`);
        }
        // The picture: the object fills it (the share of the square its opaque pixels' box takes, by height).
        assert.ok(c.thumb.startsWith('data:image/png'), `${tag}: no picture on the card`);
        const fill = await s.page.eval(`new Promise((res) => { const img = new Image(); img.onload = () => { const n = img.naturalWidth; const cv = document.createElement('canvas'); cv.width = cv.height = n;
          const g = cv.getContext('2d'); g.drawImage(img, 0, 0); const d = g.getImageData(0, 0, n, n).data; let y0 = n, y1 = -1;
          for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (d[(y * n + x) * 4 + 3] > 128) { y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
          res(y1 < 0 ? 0 : (y1 - y0 + 1) / n); }; img.src = ${JSON.stringify(c.thumb)}; })`);
        assert.ok(fill >= 0.6, `${tag}: the lighthouse takes only ${(fill * 100).toFixed(0)} % of its picture's height`);
        ok(`${tag}: the card's picture is the lighthouse, ${(fill * 100).toFixed(0)} % of the square's height`);
      } finally {
        await s.close();
      }
    }
  },
};

for (const [name, run] of Object.entries(cases)) {
  if (ONLY && name !== ONLY) continue;
  console.log(name);
  await run();
}
console.log('studio-polish: ok');
