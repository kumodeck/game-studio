// Resizing several objects two ways, and turning around three axes, in a headless browser.
//
//   node test/studio-transform.browser.mjs [--shots <dir>]
//
// three-crates (PC 1280 with a mouse, phone 390 with a finger):
// - three crates picked; a tap on the strip's size button opens "Together /
//   Each in place". Together: every crate 1.5×, the gaps between their feet
//   1.5× too, the feet still on the ground. Each in place: every crate 1.5×,
//   each foot where it was. Both one undo step.
// - one crate; a tap on the turn button opens "Turn / Tip forward / Tip
//   sideways"; tip forward a quarter turn → pose.t[0], around the middle of
//   its box (the box middle stays put); R → tip sideways → pose.t[1].
// - Save → placement.json has `t` for that crate only; the game opened
//   again (its loader applies placement.json) shows the same tilt.
// pixi-garden (PC): the two resize ways on screen (2D has no tilt).
// Each run uses a temporary copy of the example.
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStudioServer } from '../src/server/server.mjs';
import { launch, newPage } from './adapters-2d/cdp.mjs';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const shotsAt = args.indexOf('--shots');
const SHOTS = shotsAt >= 0 ? resolve(args[shotsAt + 1]) : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DBG = `document.querySelector('iframe').contentWindow.__gameStudio._debug`;
const MOD = process.platform === 'darwin' ? 4 : 2;
const dist = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
const angle = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
const s0 = (p) => (Array.isArray(p.s) ? p.s[0] : p.s ?? 1);

async function run(example, layout) {
  const mobile = layout === 'phone';
  const tag = `${example}-${mobile ? '390' : '1280'}`;
  const root = mkdtempSync(join(tmpdir(), `studio-transform-${example}-`));
  cpSync(join(PKG, 'examples', example), root, { recursive: true });
  rmSync(join(root, 'placement.json'), { force: true });
  mkdirSync(join(root, '.studio/ui'), { recursive: true });
  writeFileSync(join(root, '.studio/ui/prefs.json'), JSON.stringify({ version: 1, lang: 'ja' }));
  const lines = [];
  const srv = await startStudioServer({ root, uiDir: join(PKG, 'skills/arrange/bin/studio-ui'), log: (l) => lines.push(l) });
  const browser = await launch();
  const page = await newPage(browser, mobile ? { width: 390, height: 844, mobile: true } : { width: 1280, height: 800 });
  const ok = (m) => console.log(`  ✓ ${tag}: ${m}`);
  const shot = async (name) => {
    if (!SHOTS) return;
    await sleep(500);
    writeFileSync(join(SHOTS, `${mobile ? 'ph' : 'pc'}-dark-${example}-${name}.png`), await page.screenshot());
  };
  const j = async (expr) => JSON.parse((await page.eval(expr)) || 'null');
  const list = async () => j(`JSON.stringify(${DBG}.list())`);
  const pose = async (k) => (await list()).find((i) => i.key === k).pose;
  const foot = async (k) => j(`JSON.stringify(${DBG}.foot(${JSON.stringify(k)}))`);
  /** Middle of an object's screen box, in page px. */
  const mid = async (k) => j(`(() => { const f = document.querySelector('iframe').getBoundingClientRect(); const r = ${DBG}.anchor(${JSON.stringify(k)}).rect;
    return JSON.stringify([f.left + r.x + r.w / 2, f.top + r.y + r.h / 2]); })()`);
  /** Centre of something in the game page's shadow root (a strip button or a menu choice), page px. */
  const inStrip = async (sel) => j(`(() => { const f = document.querySelector('iframe'); const o = f.getBoundingClientRect();
    const b = f.contentDocument.querySelector('[data-studio-ui]').shadowRoot.querySelector(${JSON.stringify(sel)});
    if (!b || b.hidden || !b.getBoundingClientRect().width) return null; const r = b.getBoundingClientRect();
    return JSON.stringify({ x: o.left + r.left + r.width / 2, y: o.top + r.top + r.height / 2 }); })()`);
  const tap = async (pt) => (mobile ? page.tap(pt.x, pt.y) : page.click(pt.x, pt.y));
  const drag = async (pts) => {
    const [a] = pts;
    if (mobile) {
      await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a.x, y: a.y, id: 1 }] });
      for (const p of pts.slice(1)) await page.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p.x, y: p.y, id: 1 }] });
      await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: a.x, y: a.y });
      await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: a.x, y: a.y, button: 'left', buttons: 1, clickCount: 1 });
      for (const p of pts.slice(1)) await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'left', buttons: 1 });
      const l = pts[pts.length - 1];
      await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: l.x, y: l.y, button: 'left', buttons: 0, clickCount: 1 });
    }
    await sleep(300);
  };
  const line = (a, b, n = 10) => Array.from({ length: n + 1 }, (_, i) => ({ x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n }));
  const undo = async () => {
    if (mobile) await page.eval(`[...document.querySelectorAll('[data-action=undo]')].find(e => e.offsetParent).click()`);
    else {
      await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'z', code: 'KeyZ', modifiers: MOD, windowsVirtualKeyCode: 90 });
      await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'z', code: 'KeyZ', modifiers: MOD, windowsVirtualKeyCode: 90 });
    }
    await sleep(300);
  };
  /** Pick from the strip's menu: a tap on `button` opens it, then a tap on the choice. */
  const choose = async (button, choice) => {
    await tap(await inStrip(`[data-studio-handle=${button}]`));
    await sleep(250);
    let c = await inStrip(`[data-studio-choice="${choice}"]`);
    // The turn button turns at once when first chosen; its choices are the second tap (polish pass 2026-10-16).
    if (!c) {
      await tap(await inStrip(`[data-studio-handle=${button}]`));
      await sleep(250);
      c = await inStrip(`[data-studio-choice="${choice}"]`);
    }
    assert.ok(c, `the ${button} button's menu has no "${choice}"`);
    return c;
  };
  /** Drag the size button outward from the selection's middle by `k`. */
  const growBy = async (center, k) => {
    const h = await inStrip('[data-studio-handle=scale]');
    await drag(line(h, { x: center.x + (h.x - center.x) * k, y: center.y + (h.y - center.y) * k }));
  };
  try {
    await page.goto(srv.url);
    await page.waitFor(`document.querySelectorAll('.obj').length > 0 && !!document.querySelector('iframe').contentWindow.__gameStudio?._debug`, 30000);
    await sleep(800);
    const three = example.startsWith('three');
    const many = three ? ['crate-1', 'crate-2', 'crate-3'] : ['house', 'tree', 'flower-by-rock'];

    // ---- several: the two ways of resizing ----
    for (const mode of ['spread', 'inplace']) {
      await page.eval(`window.studioShell.actions.selectMany(${JSON.stringify(many)}, ${JSON.stringify(many[0])})`);
      await sleep(500);
      const before = new Map();
      for (const k of many) before.set(k, { pose: await pose(k), foot: three ? await foot(k) : null, mid: await mid(k) });
      const c = await choose('scale', `scale:${mode}`);
      if (mode === 'spread') await shot('8-scale-modes');
      await tap(c);
      await sleep(250);
      // The middle of the selection on screen (the size button's drag is measured from it).
      const mids = [...before.values()].map((b) => b.mid);
      const center = { x: mids.reduce((a, m) => a + m[0], 0) / mids.length, y: mids.reduce((a, m) => a + m[1], 0) / mids.length };
      await growBy(center, 1.5);
      const after = new Map();
      for (const k of many) after.set(k, { pose: await pose(k), foot: three ? await foot(k) : null, mid: await mid(k) });
      const ks = [...before.keys()];
      const f = s0(after.get(ks[0]).pose) / s0(before.get(ks[0]).pose);
      assert.ok(f > 1.15, `${mode}: not resized (${f})`);
      for (const k of ks) assert.ok(Math.abs(s0(after.get(k).pose) / s0(before.get(k).pose) - f) < 0.02, `${mode}: ${k} resized differently`);
      if (three) {
        const gap = (m, a, b) => Math.hypot(m.get(a).foot[0] - m.get(b).foot[0], m.get(a).foot[2] - m.get(b).foot[2]);
        const g0 = gap(before, ks[0], ks[1]), g1 = gap(after, ks[0], ks[1]);
        const low0 = Math.min(...ks.map((k) => before.get(k).foot[1])), low1 = Math.min(...ks.map((k) => after.get(k).foot[1]));
        assert.ok(Math.abs(low1 - low0) < 0.02, `${mode}: the lowest foot left the ground (${low0} → ${low1})`);
        if (mode === 'spread') assert.ok(Math.abs(g1 / g0 - f) < 0.08, `together: the gap grew ×${(g1 / g0).toFixed(2)}, the size ×${f.toFixed(2)}`);
        else for (const k of ks) assert.ok(Math.hypot(after.get(k).foot[0] - before.get(k).foot[0], after.get(k).foot[2] - before.get(k).foot[2]) < 0.02, `each in place: ${k}'s foot moved`);
        ok(`${mode === 'spread' ? 'together' : 'each in place'}: ×${f.toFixed(2)}, gap ${g0.toFixed(2)} → ${g1.toFixed(2)} m, lowest foot ${low0.toFixed(3)} → ${low1.toFixed(3)}`);
      } else {
        // 2D: the bottom middle of each picture on screen.
        const bottom = async (k) => j(`(() => { const r = ${DBG}.anchor(${JSON.stringify(k)}).rect; return JSON.stringify([r.x + r.w / 2, r.y + r.h]); })()`);
        const bs = await Promise.all(ks.map(bottom));
        await undo();
        const b0 = await Promise.all(ks.map(bottom));
        await page.eval(`window.studioShell.actions.redo()`);
        await sleep(250);
        if (mode === 'inplace') ks.forEach((k, i) => assert.ok(dist(b0[i], bs[i]) < 2.5, `each in place: ${k}'s foot moved ${dist(b0[i], bs[i]).toFixed(1)} px`));
        else {
          const g0 = dist(b0[0], b0[1]), g1 = dist(bs[0], bs[1]);
          assert.ok(Math.abs(g1 / g0 - f) < 0.12, `together: the gap grew ×${(g1 / g0).toFixed(2)}, the size ×${f.toFixed(2)}`);
        }
        ok(`${mode === 'spread' ? 'together' : 'each in place'}: ×${f.toFixed(2)}`);
      }
      // One undo step brings all of them back.
      await undo();
      for (const k of ks) assert.ok(dist((await pose(k)).p, before.get(k).pose.p) < 1e-6 && Math.abs(s0(await pose(k)) - s0(before.get(k).pose)) < 1e-6, `${mode}: undo did not put ${k} back`);
    }
    ok('each resize is one undo step');

    if (three) {
      // ---- one: tip forward around the middle of the box, then R → sideways ----
      const one = 'crate-4';
      await page.eval(`window.studioShell.actions.select(${JSON.stringify(one)})`);
      // The first single pick from the opening (game camera) view glides for 0.6 s (polish pass): let it land.
      await sleep(900);
      const c = await choose('rotate', 'axis:x');
      await shot('7-turn-axes');
      await tap(c);
      await sleep(250);
      assert.equal(await page.eval(`document.querySelector('iframe').contentDocument.querySelector('[data-studio-ui]').shadowRoot.querySelector('[data-studio-handle=rotate]').dataset.axis`), 'x');
      const turnQuarter = async () => {
        const m = await mid(one);
        const h = await inStrip('[data-studio-handle=rotate]');
        const R = Math.hypot(h.x - m[0], h.y - m[1]), a0 = Math.atan2(h.y - m[1], h.x - m[0]);
        await drag(Array.from({ length: 13 }, (_, i) => ({ x: m[0] + R * Math.cos(a0 + (Math.PI / 2) * (i / 12)), y: m[1] + R * Math.sin(a0 + (Math.PI / 2) * (i / 12)) })));
      };
      const m0 = await mid(one);
      await turnQuarter();
      const p1 = await pose(one);
      assert.ok(p1.t && Math.abs(p1.t[0]) > 0.6, `tip forward: t = ${JSON.stringify(p1.t)}`);
      const m1 = await mid(one);
      const size = (await j(`JSON.stringify(${DBG}.anchor(${JSON.stringify(one)}).rect)`));
      assert.ok(dist(m0, m1) < Math.max(size.w, size.h) * 0.6, `the box middle moved ${dist(m0, m1).toFixed(0)} px (it should turn on the spot)`);
      ok(`tip forward: t = [${p1.t.map((v) => (v * 180 / Math.PI).toFixed(0)).join('°, ')}°], box middle moved ${dist(m0, m1).toFixed(0)} px`);
      // R: the next axis (z), from the shell (the editor page has focus).
      await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'r', code: 'KeyR', windowsVirtualKeyCode: 82 });
      await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'r', code: 'KeyR', windowsVirtualKeyCode: 82 });
      await sleep(300);
      // R shows the choices with the next axis (z) chosen; a tap on it closes them. (A phone with no
      // keyboard opens the same choices with a tap on the turn button.)
      const zc = await inStrip('[data-studio-choice="axis:z"]');
      assert.ok(zc, 'R did not show the axis choices');
      await tap(zc);
      await sleep(250);
      assert.equal(await page.eval(`document.querySelector('iframe').contentDocument.querySelector('[data-studio-ui]').shadowRoot.querySelector('[data-studio-handle=rotate]').dataset.axis`), 'z');
      await turnQuarter();
      const p2 = await pose(one);
      assert.ok(p2.t && (angle(p2.t[1], p1.t[1]) > 0.4 || angle(p2.t[0], p1.t[0]) > 0.4), `tip sideways: t ${JSON.stringify(p1.t)} → ${JSON.stringify(p2.t)}`);
      ok(`R → sideways: t = [${p2.t.map((v) => (v * 180 / Math.PI).toFixed(0)).join('°, ')}°]`);
      // The card shows the tilt.
      await page.waitFor(`[...document.querySelectorAll('.card .f-l')].some((e) => e.textContent === '傾き')`, 3000);

      // ---- Save, then the game opened again ----
      const n0 = lines.filter((l) => l.startsWith('studio: saved placement.json')).length;
      await page.eval(`[...document.querySelectorAll('[data-action=save]')].find(e => e.offsetParent).click()`);
      for (let i = 0; i < 50 && lines.filter((l) => l.startsWith('studio: saved placement.json')).length <= n0; i++) await sleep(100);
      const file = JSON.parse(readFileSync(join(root, 'placement.json'), 'utf8'));
      const e = file.objects[one];
      assert.ok(e && Array.isArray(e.t) && e.t.length === 2, `placement.json: ${JSON.stringify(e)}`);
      assert.ok(Object.entries(file.objects).every(([k, v]) => k === one || v.t === undefined), 'only the tipped crate has t');
      ok(`saved: ${one}.t = [${e.t.join(', ')}]`);
      await page.goto(srv.url);
      await page.waitFor(`document.querySelectorAll('.obj').length > 0 && !!document.querySelector('iframe').contentWindow.__gameStudio?._debug`, 30000);
      await sleep(800);
      const back = await pose(one);
      assert.ok(back.t && angle(back.t[0], e.t[0]) < 0.01 && angle(back.t[1], e.t[1]) < 0.01, `reopened: t = ${JSON.stringify(back.t)}`);
      assert.ok(angle(back.r, e.r ?? 0) < 0.01, 'reopened: the turn kept');
      ok('opened again: the game shows the same tilt (its loader applies t)');
    }
    const errors = page.logs.filter((l) => l.startsWith('exception') || l.startsWith('error'));
    assert.deepEqual(errors, [], 'page errors');
  } catch (err) {
    console.log(page.logs.slice(-15).join('\n'));
    if (SHOTS) writeFileSync(join(SHOTS, `transform-${tag}-FAIL.png`), await page.screenshot().catch(() => Buffer.alloc(0)));
    throw err;
  } finally {
    await page.close();
    await browser.close();
    await srv.close();
    if (existsSync(root)) rmSync(root, { recursive: true, force: true });
  }
}

for (const [ex, layout] of [['three-crates', 'pc'], ['three-crates', 'phone'], ['pixi-garden', 'pc']]) {
  console.log(`${ex} · ${layout}`);
  await run(ex, layout);
}
console.log('all passed');
