// Glow Garden's camera in the editor, in a headless browser (glow-camera pass 2026-10-20; a try of the demo: "the
// camera tilts, but around the wrong axis").
//
//   node test/studio-glow-camera.browser.mjs [--shots <dir>] [--only pc,phone]
//
// WHY this test: the turn itself was always the same as Lantern Cove's (yaw round the world's up, pitch round the
// camera's side, both round the turning point). What was wrong was the sample: its ground was a 10 m disc and the edit
// camera turns from 16 m out, so every turn left the disc — its rim became a slanted "horizon" and the sky showed
// under the ground, which reads as the camera rolling around a wrong axis. examples/three-hud/game.js now runs the
// lawn to the fog. This keeps both halves:
// - the maths (PC mouse, phone finger): a drag up / down changes only the pitch, left / right only the yaw; the
//   turning point and the distance stay; the world's vertical stays upright on the screen (no roll);
// - the picture, after each turn, F (frame all) and zooming all the way out: no sky colour along the bottom of the
//   game, and the horizon (the lowest sky pixel of each third of the width) level within 1.5°.
// Photos (--shots): <pc|phone>-<n>-<step>.png. Each run uses a temporary copy of the sample. Needs the network for
// three.js from the CDN (or STUDIO_CDN_CACHE).
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { startStudioServer } from '../src/server/server.mjs';
import { launch, newPage } from './adapters-2d/cdp.mjs';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const take = (flag, d) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : d;
};
const SHOTS = take('--shots', null) ? resolve(take('--shots')) : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const LAYOUTS = take('--only', 'pc,phone').split(',');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DBG = `document.querySelector('iframe').contentWindow.__gameStudio?._debug`;
const DEG = 180 / Math.PI;
/** The sample's sky / fog colour (scene.background 0x1d2340 = 29, 35, 64). Narrow on purpose: the shaded side of a
 * lantern's glass is 47, 50, 75 and must not count as sky. */
const isSky = (r, g, b) => Math.abs(r - 29) < 8 && Math.abs(g - 35) < 8 && Math.abs(b - 64) < 9;

let failed = 0;

async function run(layout) {
  const mobile = layout === 'phone';
  const root = mkdtempSync(join(tmpdir(), 'studio-glow-camera-'));
  cpSync(join(PKG, 'examples/three-hud'), root, { recursive: true });
  mkdirSync(join(root, '.studio/ui'), { recursive: true });
  writeFileSync(join(root, '.studio/ui/prefs.json'), JSON.stringify({ version: 1, lang: 'en', theme: 'dark' }));
  const srv = await startStudioServer({ root, uiDir: join(PKG, 'skills/arrange/bin/studio-ui'), log: () => {} });
  const browser = await launch();
  const W = mobile ? 390 : 1280;
  const page = await newPage(browser, { ...(mobile ? { width: 390, height: 844, mobile: true } : { width: 1280, height: 800 }), cdnCache: process.env.STUDIO_CDN_CACHE });
  const ok = (m) => console.log(`  ✓ ${layout}: ${m}`);
  let n = 0;
  const j = async (expr) => JSON.parse((await page.eval(expr)) || 'null');
  const view = () => j(`JSON.stringify(${DBG}.view())`);
  const drag = (x0, y0, x1, y1) => (mobile ? page.touchDrag(x0, y0, x1, y1, 10) : page.mouseDrag(x0, y0, x1, y1, 10));
  try {
    await page.goto(srv.url);
    await page.waitFor(`document.querySelectorAll('.obj').length > 0 && !!${DBG}`, 90000);
    await sleep(1500);
    const f = await j(`JSON.stringify(document.querySelector('iframe').getBoundingClientRect())`);
    // The part of the game no editor panel covers: above the ask bar, clear of the ↑↓ buttons and the phone's switch.
    const askTop = await page.eval(`Math.min(...[...document.querySelectorAll('[class*=ask]')].map((e) => e.getBoundingClientRect())
      .filter((r) => r.width > 100 && r.top > ${f.y + f.height / 2}).map((r) => r.top), ${f.y + f.height})`);
    const x0 = f.x + 6, x1 = f.x + f.width - (mobile ? 70 : 60), yTop = f.y + (mobile ? 70 : 8), yBottom = askTop - 12;

    /** World vertical through the turning point on screen, in degrees from straight up (0 = no roll). */
    const roll = async (v) => {
      const a = await j(`JSON.stringify(${DBG}.toScreen(${JSON.stringify(v.target)}))`);
      const b = await j(`JSON.stringify(${DBG}.toScreen(${JSON.stringify([v.target[0], v.target[1] + 1, v.target[2]])}))`);
      return Math.atan2(b[0] - a[0], -(b[1] - a[1])) * DEG;
    };
    /** The picture: the sky colour along the bottom, and the horizon's tilt (see the header). */
    const picture = async (step) => {
      await sleep(400);
      const png = await page.screenshot();
      if (SHOTS) writeFileSync(join(SHOTS, `${layout}-${n++}-${step}.png`), png);
      const img = decodePng(png);
      const k = img.width / W;
      const sky = (x, y) => {
        const i = (Math.round(y * k) * img.width + Math.round(x * k)) * 4;
        return isSky(img.data[i], img.data[i + 1], img.data[i + 2]);
      };
      let bottomSky = 0;
      const cols = [];
      for (let x = x0; x <= x1; x += 4) {
        if (sky(x, yBottom)) bottomSky++;
        // The edge: the first pixel (going up) with 10 px of sky above it — the dark side of a lantern's glass is
        // close to the sky colour, but never that tall.
        let y = yBottom;
        const run = (yy) => { for (let d = 0; d < 10; d++) if (!sky(x, yy - d)) return false; return true; };
        while (y > yTop + 10 && !run(y)) y--;
        cols.push([x, y]);
      }
      assert.equal(bottomSky, 0, `${step}: the sky shows under the ground (${bottomSky} of ${cols.length} columns at the bottom)`);
      // A tree only lifts a column's edge (its top stands above the horizon; on a phone one tree can fill most of a
      // third), so each third's lowest edge is the horizon there.
      const third = (i) => {
        const c = cols.filter(([x]) => x >= x0 + ((x1 - x0) * i) / 3 && x < x0 + ((x1 - x0) * (i + 1)) / 3);
        return c.reduce((m, q) => (q[1] > m[1] ? q : m));
      };
      const [l, r] = [third(0), third(2)];
      const tilt = Math.atan2(l[1] - r[1], r[0] - l[0]) * DEG;
      assert.ok(Math.abs(tilt) <= 1.5, `${step}: the horizon is slanted ${tilt.toFixed(1)}° (left ${l[1]}, right ${r[1]})`);
      return tilt;
    };

    const v0 = await view();
    assert.equal(v0.home, true);
    assert.ok(Math.abs(await roll(v0)) < 0.01, 'the opening view is rolled');
    await picture('open');
    ok('the opening view: no roll, the ground reaches a level horizon');

    // Turns: only pitch for up / down, only yaw for left / right; round the same point at the same distance.
    const cx = f.x + f.width / 2, cy = f.y + f.height * 0.3;
    const steps = [
      ['drag-down', [cx, cy, cx, cy + 150], 'pitch', 1],
      ['drag-up', [cx, cy + 150, cx, cy - 120], 'pitch', -1],
      ['drag-right', [cx - 100, cy, cx + 100, cy], 'yaw', -1],
      ['drag-left-far', [cx + 120, cy, cx - 120, cy], 'yaw', 1],
      ['drag-down-again', [cx, cy, cx, cy + 120], 'pitch', 1]
    ];
    for (const [step, d, which, sign] of steps) {
      const a = await view();
      await drag(...d);
      await sleep(300);
      const b = await view();
      const other = which === 'pitch' ? 'yaw' : 'pitch';
      assert.ok(Math.abs(b[other] - a[other]) < 1e-9, `${step}: ${other} changed (${a[other]} → ${b[other]})`);
      assert.ok(Math.sign(b[which] - a[which]) === sign && Math.abs(b[which] - a[which]) > 0.05, `${step}: ${which} went ${a[which]} → ${b[which]}`);
      assert.deepEqual(b.target, a.target, `${step}: the turning point moved`);
      assert.ok(Math.abs(b.distance - a.distance) < 1e-9, `${step}: the distance changed`);
      assert.ok(Math.abs(await roll(b)) < 0.01, `${step}: the view is rolled`);
      const tilt = await picture(step);
      ok(`${step}: only the ${which} (${(a[which] * DEG).toFixed(0)}° → ${(b[which] * DEG).toFixed(0)}°), round the same point, horizon ${tilt.toFixed(1)}°`);
    }

    // F (frame all) and zooming all the way out: still no edge of the world.
    if (!mobile) {
      await page.eval(`document.querySelector('iframe').contentWindow.focus()`);
      await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'f', code: 'KeyF', windowsVirtualKeyCode: 70, text: 'f' });
      await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'f', code: 'KeyF', windowsVirtualKeyCode: 70 });
      await sleep(900);
      await picture('frame-all');
      for (let i = 0; i < 12; i++) await page.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: cx, y: f.y + f.height / 2, deltaX: 0, deltaY: 600 });
    } else {
      // Pinch in (fingers together) a few times.
      for (let i = 0; i < 4; i++) {
        await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx - 120, y: cy + 200, id: 1 }, { x: cx + 120, y: cy + 200, id: 2 }] });
        for (let s = 1; s <= 8; s++) await page.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx - 120 + s * 13, y: cy + 200, id: 1 }, { x: cx + 120 - s * 13, y: cy + 200, id: 2 }] });
        await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await sleep(150);
      }
    }
    await sleep(400);
    const far = await view();
    assert.ok(far.distance > v0.distance * 2, `zooming out went only to ${far.distance}`);
    await picture('zoomed-out');
    ok(`${mobile ? '' : 'F and '}zoomed out to ${far.distance.toFixed(0)} m: the ground still reaches the horizon`);
  } catch (e) {
    failed++;
    console.error(`  ✗ ${layout}: ${e.message}`);
    console.error(page.logs.slice(-10).join('\n'));
  } finally {
    await browser.close();
    await srv.close?.();
    rmSync(root, { recursive: true, force: true });
  }
}

/** The PNGs Chrome writes: 8-bit RGB or RGBA, not interlaced → { width, height, data: RGBA } (as web-demo-assets). */
function decodePng(buf) {
  let o = 8, width = 0, height = 0, type = 0;
  const idat = [];
  while (o < buf.length) {
    const len = buf.readUInt32BE(o), kind = buf.toString('latin1', o + 4, o + 8), body = buf.subarray(o + 8, o + 8 + len);
    if (kind === 'IHDR') {
      width = body.readUInt32BE(0); height = body.readUInt32BE(4); type = body[9];
      assert.ok(body[8] === 8 && (type === 2 || type === 6) && body[12] === 0, 'unexpected PNG format');
    } else if (kind === 'IDAT') idat.push(body);
    o += 12 + len;
  }
  const bpp = type === 6 ? 4 : 3, stride = width * bpp, raw = inflateSync(Buffer.concat(idat));
  const px = Buffer.alloc(stride * height), data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), row = y * stride;
    for (let x = 0; x < stride; x++) {
      const left = x >= bpp ? px[row + x - bpp] : 0, up = y ? px[row - stride + x] : 0, ul = y && x >= bpp ? px[row - stride + x - bpp] : 0;
      let v = line[x];
      if (f === 1) v += left;
      else if (f === 2) v += up;
      else if (f === 3) v += (left + up) >> 1;
      else if (f === 4) {
        const pa = Math.abs(up - ul), pb = Math.abs(left - ul), pc = Math.abs(left + up - 2 * ul);
        v += pa <= pb && pa <= pc ? left : pb <= pc ? up : ul;
      }
      px[row + x] = v & 0xff;
    }
  }
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = px[i * bpp]; data[i * 4 + 1] = px[i * bpp + 1]; data[i * 4 + 2] = px[i * bpp + 2]; data[i * 4 + 3] = bpp === 4 ? px[i * bpp + 3] : 255;
  }
  return { width, height, data };
}

for (const layout of LAYOUTS) {
  console.log(`studio-glow-camera: ${layout}`);
  await run(layout);
}
if (failed) {
  console.error(`studio-glow-camera: ${failed} failed`);
  process.exit(1);
}
console.log('studio-glow-camera: ok');
process.exit(0);
