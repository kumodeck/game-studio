// The path's end point while making a motion (studio-fix-0164, 2026-10-25). Found filming the X clips on v0.1.64
// (the motion clip's step 4): Lantern Cove's rowboat, "Make a motion", one drag
// across the water — then a press on the path's END point, where the boat stands, went on to the boat (a Shift-press
// turned the camera), so the clip lifted the START point instead. Since studio-motion-move (2026-10-23) a press on the
// point where the object stands went on to the object while making, so that a second drag on it is the next step.
// Now the point comes first where it is drawn, while making and while the motion is picked; the boat itself, off the
// point, is still the next step.
//
// In a headless browser on a copy of starters/lantern-cove, PC 1280×800 dark, `--lang ja,en`:
//   1. making: the boat picked, Make a motion (the strip's Motion → Make a motion: the same call), one drag → two points;
//   2. making: the end point Shift-dragged up → it is lifted (still two points, the same place across the water);
//   3. making: the end point dragged across the water → it moves there (still two points: not the next step);
//   4. making: a drag on the boat off its point → the next step (a third point, the first two kept);
//   5. Done, the motion still picked: the end point Shift-dragged → it moves up (still three points);
//   6. no page errors.
//
//   node test/studio-motion-end-point.browser.mjs [--lang ja,en] [--shots <dir>]
// Exit 1 on a failure.
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStudioServer } from '../src/server/server.mjs';
import { launch, newPage } from './adapters-2d/cdp.mjs';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const take = (flag, d = null) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : d);
const SHOTS = take('--shots') ? resolve(take('--shots')) : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const LANGS = take('--lang', 'ja,en').split(',');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FRAME = `document.querySelector('iframe.game:not(.leaving), iframe')`;
const DBG = `${FRAME}.contentWindow.__gameStudio?._debug`;
const TL = `window.__studioTimeline`;
const BOAT = 'rowboat';

let failed = 0;
const check = (ok, what) => {
  console.log(`  ${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failed++;
};

async function run(lang) {
  console.log(`${lang} dark`);
  const root = mkdtempSync(join(tmpdir(), 'studio-motion-end-point-'));
  cpSync(join(PKG, 'starters/lantern-cove'), root, { recursive: true });
  mkdirSync(join(root, '.studio/ui'), { recursive: true });
  writeFileSync(join(root, '.studio/ui/prefs.json'), JSON.stringify({ version: 1, lang, theme: 'dark', seen: ['timeline-steps', 'open-line'] }));
  const srv = await startStudioServer({ root, uiDir: join(PKG, 'skills/arrange/bin/studio-ui'), log: () => {}, env: {} });
  const browser = await launch();
  try {
    const page = await newPage(browser, { width: 1280, height: 800, cdnCache: process.env.STUDIO_CDN_CACHE });
    const j = async (expr) => JSON.parse((await page.eval(expr)) || 'null');
    const shot = async (what) => SHOTS && writeFileSync(join(SHOTS, `${lang}-${what}.png`), await page.screenshot());
    // Making shows the plate's Done (timeline-panel.ts: only while making).
    const making = () => page.eval(`(() => { const b = document.querySelector('[data-part=tl-done]'); return !!b && !b.closest('[hidden]') && b.getBoundingClientRect().width > 0; })()`);
    const keys = async () => (await j(`JSON.stringify(${TL}.motionOf(${JSON.stringify(BOAT)})?.clips?.[0]?.keys?.p ?? [])`)) ?? [];
    /** The path's point `i` on the editor page (its dot in the game's timeline layer), or null. */
    const dot = (i) => j(`(() => { const f = ${FRAME}; const h = f.contentDocument.querySelector('[data-studio-timeline]'); const c = h && h.shadowRoot.querySelector('[data-point="${i}"]');
      if (!c) return 'null'; const o = f.getBoundingClientRect(); return JSON.stringify({ x: o.left + +c.getAttribute('cx'), y: o.top + +c.getAttribute('cy') }); })()`);
    /** A real mouse drag in steps; `shift`: Shift held through it (the key down too, as a hand does). */
    const drag = async (from, to, shift = false) => {
      const mod = shift ? 8 : 0;
      if (shift) await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16, modifiers: 8 });
      await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y, modifiers: mod });
      await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1, modifiers: mod });
      await sleep(80);
      for (let i = 1; i <= 10; i++) {
        await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x + ((to.x - from.x) * i) / 10, y: from.y + ((to.y - from.y) * i) / 10, button: 'left', buttons: 1, modifiers: mod });
        await sleep(40);
      }
      await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', buttons: 0, clickCount: 1, modifiers: mod });
      if (shift) await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16 });
      // Let go while making: the part just made plays (stepEnds); it stops at its end.
      await sleep(1800);
    };
    /**
     * A spot on the boat (what the game picks there is the boat) at least `away` px from its point's dot, with the
     * game's own canvas there (not the path's line: its wide stroke takes a press for "+ a point here"), the boat's
     * screen box searched outward from its middle.
     */
    const onBoat = async (from, away) => j(`(() => { const d = ${DBG}; const a = d.anchor(${JSON.stringify(BOAT)}); const f = ${FRAME}; const o = f.getBoundingClientRect(); if (!a || !a.rect) return 'null';
      const r = a.rect, from = ${JSON.stringify(from)}; let best = null;
      for (let fy = 0; fy <= 1.0001; fy += 0.1) for (let fx = 0; fx <= 1.0001; fx += 0.05) {
        const x = r.x + r.w * fx, y = r.y + r.h * fy;
        if (Math.hypot(o.left + x - from.x, o.top + y - from.y) < ${away} || d.under(x, y) !== ${JSON.stringify(BOAT)} || f.contentDocument.elementFromPoint(x, y)?.tagName !== 'CANVAS') continue;
        const m = Math.hypot(x - a.center[0], y - a.center[1]);
        if (!best || m < best.m) best = { x: o.left + x, y: o.top + y, m };
      }
      return JSON.stringify(best); })()`);

    await page.goto(srv.url);
    await page.waitFor(`document.querySelectorAll('.obj').length > 0 && !!${DBG}`, 90000);
    await sleep(2500);

    // 1. Making: the boat picked, "Make a motion", one drag across the water.
    await page.eval(`studioShell.actions.select(${JSON.stringify(BOAT)})`);
    await sleep(1600);
    await page.eval(`${TL}.make(${JSON.stringify(BOAT)})`);
    await sleep(900);
    const a = await j(`(() => { const a = ${DBG}.anchor(${JSON.stringify(BOAT)}); const o = ${FRAME}.getBoundingClientRect(); return JSON.stringify({ x: o.left + a.center[0], y: o.top + a.center[1] }); })()`);
    await drag(a, { x: a.x - 260, y: a.y + 10 });
    let k = await keys();
    check(k.length === 2, `1. making: one drag = two points (${k.length})`);
    check(await making(), '1. still making (the plate\'s Done)');
    const k1 = k[1]?.v ?? [0, 0, 0];

    // 2. Making: the end point (where the boat stands) Shift-dragged up — the film's "Shape its path in 3D".
    let end = await dot(1);
    check(!!end, '2. the end point is drawn');
    if (end) await drag(end, { x: end.x, y: end.y - 90 }, true);
    k = await keys();
    console.log(`    end point after Shift-drag: ${JSON.stringify(k[1]?.v)}`);
    check(k.length === 2, `2. making: still two points (${k.length})`);
    check((k[1]?.v?.[1] ?? 0) > k1[1] + 0.3, `2. the end point is lifted (${k1[1]} → ${k[1]?.v?.[1]})`);
    check(Math.abs((k[1]?.v?.[0] ?? 0) - k1[0]) < 0.05 && Math.abs((k[1]?.v?.[2] ?? 0) - k1[2]) < 0.05, '2. …in the same place across the water');
    await shot('2-lifted');
    const k2 = k[1]?.v ?? k1;

    // 3. Making: the end point dragged across the water (no Shift) — it moves; no next step.
    end = await dot(1);
    if (end) await drag(end, { x: end.x + 120, y: end.y });
    k = await keys();
    console.log(`    end point after a drag: ${JSON.stringify(k[1]?.v)}`);
    check(k.length === 2, `3. making: still two points — the end point moved, not the next step (${k.length})`);
    check(Math.hypot((k[1]?.v?.[0] ?? 0) - k2[0], (k[1]?.v?.[2] ?? 0) - k2[2]) > 0.3, `3. the end point moved across the water (${JSON.stringify(k2)} → ${JSON.stringify(k[1]?.v)})`);
    const k3 = k.map((x) => x.v);

    // 4. Making: a drag on the boat off its point — still the next step.
    end = await dot(1);
    const grip = end && (await onBoat(end, 24));
    console.log(`    the boat off its point: ${JSON.stringify(grip)} (point ${JSON.stringify(end)})`);
    check(!!grip, '4. a spot on the boat off its point');
    if (grip) await drag(grip, { x: grip.x - 160, y: grip.y });
    k = await keys();
    check(k.length === 3, `4. making: a drag on the boat is the next step — three points (${k.length})`);
    check(k.length === 3 && k3.every((v, i) => v.every((x, n) => Math.abs(x - k[i].v[n]) < 1e-3)), '4. …the first two kept');
    await shot('4-next');

    // 5. Done; the motion still picked: the end point comes first (Shift: up).
    await page.eval(`document.querySelector('[data-part=tl-done]')?.click()`);
    await sleep(800);
    check(!(await making()), '5. Done: making ended');
    await page.eval(`studioShell.actions.select(${JSON.stringify(BOAT)})`);
    await sleep(600);
    const last = k.length - 1;
    const before = k[last]?.v ?? [0, 0, 0];
    end = await dot(last);
    check(!!end, '5. the end point is drawn with the motion picked');
    if (end) await drag(end, { x: end.x, y: end.y - 60 }, true);
    k = await keys();
    check(k.length === 3, `5. still three points (${k.length})`);
    check((k[last]?.v?.[1] ?? 0) > before[1] + 0.2, `5. the end point moved up (${before[1]} → ${k[last]?.v?.[1]})`);
    await shot('5-picked');

    const errors = page.logs.filter((l) => /^exception|error:/.test(l) && !/favicon|net::/.test(l));
    check(!errors.length, `6. no page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
  } finally {
    await browser.close();
    srv.close();
    rmSync(root, { recursive: true, force: true });
  }
}

for (const lang of LANGS) await run(lang);
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
