// Headless browser test of the three.js adapter with REAL input (CDP mouse, touch and key events), on all four
// three.js samples, at desktop (1280×800, mouse) and phone (390×844, touch) sizes:
//
//   list → look around (orbit, zoom / pinch) → select by clicking/tapping the object → move / rotate / lift / scale
//   with the handles → undo ×4 (back to the exact start pose) → redo ×4 (exact end pose) → thumbnail + assets →
//   save placement.json → reload → the game's loader applies it → the editor lists exactly the saved poses.
//
// Run:  node --test oss/game-studio/src/adapters/three/test/browser.test.mjs
// Needs a headless Chrome (STUDIO_CHROME, or a Playwright chrome-headless-shell, or the system Chrome); skipped
// otherwise. Offline: STUDIO_THREE_DIRS maps CDN three versions to local copies (see lib/cdn-mirror.mjs).
// STUDIO_SHOTS=<dir> writes a screenshot per run there.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChrome, launch } from './lib/cdp.mjs';
import { startServer } from './lib/server.mjs';
import { enableMirror, mirrorDirs } from './lib/cdn-mirror.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..'); // oss/game-studio
const chrome = findChrome();
const SHOTS = process.env.STUDIO_SHOTS || null;

// target: how to find the object this run edits. keys: candidates that must be listed.
const SAMPLES = [
  { name: 'three-orb-garden', target: (list) => list.find((i) => i.kinds[0] === 'sphere').key, minItems: 30, allUnstable: true },
  { name: 'three-sky-duel', target: () => 'island', keys: ['plane-you', 'plane-rival', 'ring', 'ring#5', 'cloud#6', 'island'] },
  { name: 'three-crates', target: () => 'crate-4', keys: ['ground', 'crate-1', 'crate-4', 'barrel', 'lamp'], assets: true },
  { name: 'three-tumble', target: () => 'block-4', keys: ['table', 'block-1', 'block-8'] }
];
const SIZES = [
  { tag: 'desktop', w: 1280, h: 800, mobile: false },
  { tag: 'phone', w: 390, h: 844, mobile: true }
];

const H = '__studioHarness';
const nearly = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b} (±${eps})`);

test('three.js adapter with real input on the samples', { skip: chrome ? false : 'no headless Chrome found' }, async (t) => {
  const server = await startServer(ROOT);
  const browser = await launch(chrome);
  t.after(async () => {
    await browser.close();
    await server.close();
  });
  const dirs = mirrorDirs();

  for (const sample of SAMPLES) {
    for (const size of SIZES) {
      await t.test(`${sample.name} @ ${size.tag}`, async () => {
        const page = await browser.newPage();
        const errors = [];
        await page.send('Runtime.enable');
        await page.send('Page.enable');
        page.on('Runtime.exceptionThrown', (p) => errors.push(p.exceptionDetails.exception?.description || p.exceptionDetails.text));
        await enableMirror(page, dirs);
        await page.viewport(size.w, size.h, size.mobile);
        const url = `${server.url}/examples/${sample.name}/index.html?studio=edit`;
        server.saved.delete(`/examples/${sample.name}/placement.json`);
        await page.goto(url);
        const ready = () => page.eval(`Promise.race([${H}.ready.then(() => true), new Promise((_, j) => setTimeout(() => j(new Error('editor not ready')), 20000))])`);
        await ready();
        await page.frames();

        // ---------------------------------------------------------------- list
        const list = await page.eval(`${H}.adapter.list()`);
        assert.ok(list.length >= (sample.minItems || 1), `listed ${list.length}`);
        for (const k of sample.keys || []) assert.ok(list.some((i) => i.key === k), `${k} is listed`);
        if (sample.allUnstable) assert.ok(list.every((i) => i.unstable), 'anonymous scene → every key is a path key');
        const key = sample.target(list);
        const input = size.mobile ? page.touch : page.mouse;

        // ---------------------------------------------------------------- look around (never moves objects)
        const v0 = await page.eval(`${H}.adapter.view.state()`);
        await input.drag([size.w * 0.2, size.h * 0.85], [size.w * 0.45, size.h * 0.8]);
        await page.frames();
        const v1 = await page.eval(`${H}.adapter.view.state()`);
        assert.ok(Math.abs(v1.yaw - v0.yaw) > 0.1, 'drag orbits the view');
        if (size.mobile) await page.touch.pinch(size.w / 2, size.h / 2, 80, 160);
        else await page.mouse.wheel(size.w / 2, size.h / 2, -300);
        await page.frames();
        const v2 = await page.eval(`${H}.adapter.view.state()`);
        assert.ok(v2.distance < v1.distance, 'wheel / pinch zooms in');
        const unmoved = await page.eval(`${H}.adapter.list()`);
        assert.deepEqual(unmoved.map((i) => i.pose), list.map((i) => i.pose), 'looking around moved nothing');
        await page.eval(`${H}.adapter.view.focus(${JSON.stringify(key)})`);
        await page.frames();

        // ---------------------------------------------------------------- select with a real click / tap
        const anchor = () => page.eval(`${H}.adapter.anchor(${JSON.stringify(key)})`);
        let a = await anchor();
        assert.ok(a && a.onScreen, 'target on screen after focus');
        for (let i = 0; i < 8; i++) {
          await input[size.mobile ? 'tap' : 'click'](a.centerPx[0], a.centerPx[1]);
          await new Promise((r) => setTimeout(r, 400)); // > 350 ms: the next press on the same spot cycles to the next candidate
          if ((await page.eval(`${H}.selected`)) === key) break;
        }
        assert.equal(await page.eval(`${H}.selected`), key, 'the click selected the target');
        await page.frames();
        const handle = (n) => page.eval(`(() => { const r = ${H}.handles[${JSON.stringify(n)}].getBoundingClientRect(); return r.width ? [r.left + r.width / 2, r.top + r.height / 2] : null; })()`);
        const start = (await anchor()).pose;

        // ---------------------------------------------------------------- move handle: the pivot follows the finger exactly
        a = await anchor();
        let h = await handle('move');
        assert.ok(h, 'move handle shown');
        const d = size.mobile ? [40, 50] : [70, 35];
        await input.drag(h, [h[0] + d[0], h[1] + d[1]]);
        await page.frames();
        const afterMove = await anchor();
        const err = Math.hypot(afterMove.centerPx[0] - (a.centerPx[0] + d[0]), afterMove.centerPx[1] - (a.centerPx[1] + d[1]));
        assert.ok(err < 0.05, `pivot follows the finger (error ${err.toFixed(5)} px)`);
        nearly(afterMove.pose.p[1], start.p[1], 1e-9, 'moving keeps the height');
        assert.ok(Math.hypot(afterMove.pose.p[0] - start.p[0], afterMove.pose.p[2] - start.p[2]) > 0.01, 'moved horizontally');

        // ---------------------------------------------------------------- rotate handle: trace 60° counter-clockwise around the pivot
        a = await anchor();
        h = await handle('rotate');
        assert.ok(h, 'rotate handle shown');
        const R = Math.hypot(h[0] - a.centerPx[0], h[1] - a.centerPx[1]);
        const a0 = Math.atan2(-(h[1] - a.centerPx[1]), h[0] - a.centerPx[0]);
        const arc = [];
        for (let i = 0; i <= 12; i++) {
          const ang = a0 + ((Math.PI / 3) * i) / 12;
          arc.push([a.centerPx[0] + R * Math.cos(ang), a.centerPx[1] - R * Math.sin(ang)]);
        }
        if (size.mobile) await page.touch.path(arc);
        else {
          await page.mouse.move(...arc[0]);
          await page.mouse.down(...arc[0]);
          for (const p of arc.slice(1)) await page.mouse.move(p[0], p[1], 1);
          await page.mouse.up(...arc[arc.length - 1]);
        }
        await page.frames();
        const afterRot = (await anchor()).pose;
        let dr = afterRot.r - afterMove.pose.r;
        dr = Math.atan2(Math.sin(dr), Math.cos(dr));
        nearly(dr, Math.PI / 3, 0.02, 'rotated +60°');

        // ---------------------------------------------------------------- lift handle: 60 px up
        a = await anchor();
        h = await handle('lift');
        await input.drag(h, [h[0], h[1] - 60]);
        await page.frames();
        const afterLift = (await anchor()).pose;
        nearly(afterLift.p[1] - afterRot.p[1], 60 / a.liftPx, (60 / a.liftPx) * 0.02, 'lifted by 60 px worth of metres');

        // ---------------------------------------------------------------- scale handle: 60 px right = ×e^0.3
        h = await handle('scale');
        await input.drag(h, [h[0] + 60, h[1]]);
        await page.frames();
        const afterScale = (await anchor()).pose;
        const s0 = Array.isArray(afterLift.s) ? afterLift.s[0] : afterLift.s;
        const s1 = Array.isArray(afterScale.s) ? afterScale.s[0] : afterScale.s;
        nearly(s1 / s0, Math.exp(0.3), 1e-9, 'scaled');

        // ---------------------------------------------------------------- undo ×4 → exact start; redo ×4 → exact end
        assert.equal(await page.eval(`${H}.undo.length`), 4, 'four gestures = four undo steps');
        for (let i = 0; i < 4; i++) await page.key('z', 'KeyZ', 90, 2);
        await page.frames();
        assert.deepEqual((await anchor()).pose, start, 'undo returns to the exact start pose');
        for (let i = 0; i < 4; i++) await page.key('y', 'KeyY', 89, 2);
        await page.frames();
        assert.deepEqual((await anchor()).pose, afterScale, 'redo returns to the exact end pose');

        // ---------------------------------------------------------------- thumbnail, assets
        const shot = await page.eval(`${H}.adapter.capture(${JSON.stringify(key)}, { size: 96 })`);
        assert.ok(shot.ok && shot.dataUrl.startsWith('data:image/png;base64,') && shot.dataUrl.length > 1500, 'thumbnail captured');
        if (sample.assets) {
          const crate = await page.eval(`${H}.adapter.assetsOf('crate-1')`);
          assert.deepEqual(crate, [{ url: 'assets/crate.glb', how: 'model', sure: true }]);
          const ground = await page.eval(`${H}.adapter.assetsOf('ground')`);
          assert.deepEqual(ground, [{ url: 'assets/grass.png', how: 'texture', sure: true }]);
          const lamp = await page.eval(`${H}.adapter.assetsOf('lamp')`);
          assert.ok(lamp.some((x) => x.url === 'assets/lamp.glb' && x.sure), 'lamp → its glb');
        }
        await page.eval(`${H}.place()`);
        await page.frames();
        if (SHOTS) {
          mkdirSync(SHOTS, { recursive: true });
          writeFileSync(join(SHOTS, `${sample.name}-${size.tag}.png`), await page.screenshot());
        }

        // ---------------------------------------------------------------- save → reload → the loader applies it
        const saved = await page.eval(`${H}.save()`);
        assert.ok(saved.objects[key], 'the edited object is in placement.json');
        assert.equal(Object.keys(saved.objects).length, 1, 'only the edited object is saved');
        const e = saved.objects[key];
        assert.deepEqual(e.was.p, start.p.map((x) => Math.round(x * 1000) / 1000), '"was" holds the start position');
        await page.eval(`fetch('./placement.json', { method: 'PUT', body: ${JSON.stringify(JSON.stringify(saved))} }).then(r => r.status)`);
        await page.goto(url);
        await ready();
        const reloaded = (await page.eval(`${H}.adapter.list()`)).find((i) => i.key === key);
        assert.ok(reloaded, 'same key after reload');
        assert.deepEqual(reloaded.pose.p, e.p, 'position applied exactly');
        assert.equal(reloaded.pose.r, e.r, 'rotation applied exactly');
        assert.deepEqual(reloaded.pose.s, e.s, 'scale applied exactly');
        assert.deepEqual(errors, [], 'no page errors');
        await page.send('Page.close').catch(() => {});
      });
    }
  }
});
