// Turning several picked objects, with the turn button's ▾, in a headless browser (play test 2026-10-18: "no turn
// options with several picked").
//
//   node test/studio-multi-rotate.browser.mjs [--shots <dir>] [--only pc,phone] [--theme light|dark|both] [--game three-crates,pixi-garden]
//
// three-crates (3D: three crates) and pixi-garden (2D: house, tree, flower), PC 1280×800 with a mouse and a phone
// 390×844 with a finger, light and dark:
// - several picked: the turn button has a ▾ (inside its corner); one tap on it opens, 3D: Turn / Tilt forward /
//   Tilt sideways, and under them Together / Each in place (the size button's words, in its order); 2D: Together /
//   Each in place only (one axis). The strip does not move by 1 px while the choices open and a choice is made.
// - for each way (3D: upright / tilt forward / tilt sideways × together / each in place; 2D: together / each in
//   place), a quarter-turn drag anywhere with Turn chosen:
//   - every member that turns gets the same turn (3D: the same quaternion; 2D: the same angle), a quarter;
//   - together: the places turn round the middle of the selection by that same turn (3D: each box middle =
//     the turn of it round the middle of the box middles; 2D: the gaps on screen stay);
//   - each in place: nothing moves away (3D: each box middle stays; 2D: each pivot stays);
//   - one undo step puts all of them back; redo does it again.
// - 3D: after a tilt, Save → placement.json has `t` for the turned crates.
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
const take = (flag, d) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : d;
};
const SHOTS = take('--shots', null) ? resolve(take('--shots')) : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const LAYOUTS = take('--only', 'pc,phone').split(',');
const THEME = take('--theme', 'both');
const THEMES = THEME === 'both' ? ['light', 'dark'] : [THEME];
const GAMES = take('--game', 'three-crates,pixi-garden').split(',');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DBG = `document.querySelector('iframe').contentWindow.__gameStudio?._debug`;
const ROOT = `document.querySelector('iframe').contentDocument.querySelector('[data-studio-ui]').shadowRoot`;
const MOD = process.platform === 'darwin' ? 4 : 2;
const dist = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
const angle = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
const QUARTER = Math.PI / 2;

// The same quaternion maths as src/bridge/group.ts (three.js's XYZ Euler: x = t[0], y = r, z = t[1]).
const quatOf = (p) => {
  const [x = 0, z = 0] = p.t ?? [0, 0];
  const y = p.r ?? 0;
  const c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2);
  const s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2);
  return [s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3, c1 * c2 * s3 + s1 * s2 * c3, c1 * c2 * c3 - s1 * s2 * s3];
};
const qmul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const qinv = (q) => [-q[0], -q[1], -q[2], q[3]];
const qapply = (q, v) => {
  const [x, y, z, w] = q;
  const [vx, vy, vz] = v;
  const tx = 2 * (y * vz - z * vy), ty = 2 * (z * vx - x * vz), tz = 2 * (x * vy - y * vx);
  return [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)];
};
/** The turn from pose a to pose b (b · a⁻¹), with w ≥ 0 so the same turn compares equal. */
const turnOf = (a, b) => {
  const q = qmul(quatOf(b), qinv(quatOf(a)));
  return q[3] < 0 ? q.map((v) => -v) : q;
};
const turnAngle = (q) => 2 * Math.acos(Math.min(1, Math.abs(q[3])));

let failed = 0;

async function run(game, layout, theme) {
  const mobile = layout === 'phone';
  const three = game.startsWith('three');
  const tag = `${layout}-${theme}-${game}`;
  const root = mkdtempSync(join(tmpdir(), `studio-multi-rotate-${game}-`));
  cpSync(join(PKG, 'examples', game), root, { recursive: true });
  rmSync(join(root, 'placement.json'), { force: true });
  mkdirSync(join(root, '.studio/ui'), { recursive: true });
  writeFileSync(join(root, '.studio/ui/prefs.json'), JSON.stringify({ version: 1, lang: 'en', theme }));
  const lines = [];
  const srv = await startStudioServer({ root, uiDir: join(PKG, 'skills/arrange/bin/studio-ui'), log: (l) => lines.push(l) });
  const browser = await launch();
  const page = await newPage(browser, { ...(mobile ? { width: 390, height: 844, mobile: true } : { width: 1280, height: 800 }), cdnCache: process.env.STUDIO_CDN_CACHE });
  const ok = (m) => console.log(`  ✓ ${tag}: ${m}`);
  const shot = async (name) => {
    if (!SHOTS) return;
    await sleep(400);
    writeFileSync(join(SHOTS, `${tag}-${name}.png`), await page.screenshot());
  };
  const j = async (expr) => JSON.parse((await page.eval(expr)) || 'null');
  const list = async () => j(`JSON.stringify(${DBG}.list())`);
  const middle = async (k) => j(`JSON.stringify(${DBG}.middle(${JSON.stringify(k)}))`);
  const center = async (k) => j(`JSON.stringify(${DBG}.anchor(${JSON.stringify(k)}).center)`);
  const inStrip = async (sel) => j(`(() => { const o = document.querySelector('iframe').getBoundingClientRect();
    const b = ${ROOT}.querySelector(${JSON.stringify(sel)});
    if (!b || b.hidden || !b.getBoundingClientRect().width) return null; const r = b.getBoundingClientRect();
    return JSON.stringify({ x: o.left + r.left + r.width / 2, y: o.top + r.top + r.height / 2, l: o.left + r.left, t: o.top + r.top, w: r.width, h: r.height }); })()`);
  const strip = () => inStrip('.row');
  /** The open menu's choices in order ('*' = chosen), or null when closed. */
  const menuOpen = async () => j(`(() => { const m = ${ROOT}.querySelector('.menu'); const c = [...m.querySelectorAll('[data-studio-choice]')];
    return JSON.stringify(m.style.display !== 'none' && c.length ? c.map((b) => b.dataset.studioChoice + (b.getAttribute('aria-checked') === 'true' ? '*' : '')) : null); })()`);
  const pressed = async () => j(`JSON.stringify([...${ROOT}.querySelectorAll('[data-studio-handle]')].filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.dataset.studioHandle))`);
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
    await sleep(350);
  };
  const undo = async () => {
    if (mobile) await page.eval(`[...document.querySelectorAll('[data-action=undo]')].find(e => e.offsetParent).click()`);
    else {
      await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'z', code: 'KeyZ', modifiers: MOD, windowsVirtualKeyCode: 90 });
      await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'z', code: 'KeyZ', modifiers: MOD, windowsVirtualKeyCode: 90 });
    }
    await sleep(350);
  };
  const redo = async () => {
    await page.eval(`window.studioShell.actions.redo()`);
    await sleep(350);
  };
  const still = async (ref, when) => {
    const r = await strip();
    assert.ok(r, `${when}: the strip is gone`);
    for (const k of ['l', 't', 'w', 'h']) assert.ok(Math.abs(r[k] - ref[k]) < 0.5, `${when}: the strip moved (${k} ${ref[k]} → ${r[k]})`);
  };
  const inCorner = (more, btn) => more.l >= btn.l - 0.5 && more.t >= btn.t - 0.5 && more.l + more.w <= btn.l + btn.w + 0.5 && more.t + more.h <= btn.t + btn.h + 0.5
    && more.x > btn.x && more.y > btn.y;
  try {
    await page.goto(srv.url);
    await page.waitFor(`document.querySelectorAll('.obj').length > 0 && !!${DBG}`, 90000);
    await sleep(1200);
    const many = three ? ['crate-1', 'crate-2', 'crate-3'] : ['house', 'tree', 'flower-by-rock'];
    const items = await list();
    for (const k of many) assert.ok(items.find((i) => i.key === k)?.rotatable, `${k} does not turn`);
    await page.eval(`window.studioShell.actions.selectMany(${JSON.stringify(many)}, ${JSON.stringify(many[0])})`);
    await sleep(900);
    const s0 = await strip();
    assert.ok(s0, 'no strip for several');

    // ---- the ▾ on Turn, and what it opens ----
    const turnBtn = await inStrip('[data-studio-handle=rotate]');
    const turnMore = await inStrip('[data-studio-handle=rotate] .more');
    assert.ok(turnMore, 'several picked: no ▾ on Turn');
    assert.ok(inCorner(turnMore, turnBtn), `the ▾ is not in the turn button's corner: ${JSON.stringify({ turnMore, turnBtn })}`);
    if (mobile) assert.ok(turnBtn.w >= 44 && turnBtn.h >= 44, `a phone button is ${turnBtn.w}×${turnBtn.h}`);
    // Another tool first: a tap on the ▾ that landed on the button itself would CHOOSE Turn instead of opening.
    await tap(await inStrip('[data-studio-handle=move]'));
    await sleep(250);
    await still(s0, 'after choosing Move');
    await tap(turnMore);
    await sleep(300);
    const want = three ? ['axis:y*', 'axis:x', 'axis:z', 'turn:spread*', 'turn:inplace'] : ['turn:spread*', 'turn:inplace'];
    assert.deepEqual(await menuOpen(), want, 'the ▾ on Turn did not open the expected choices');
    assert.deepEqual(await pressed(), ['move'], 'the tap on the ▾ changed the tool');
    await still(s0, 'with the turn choices open');
    // The way row reads like the size button's: the same words, the same order.
    const words = await j(`JSON.stringify([...${ROOT}.querySelectorAll('.menu [data-studio-choice^="turn:"] span')].map((s) => s.textContent))`);
    assert.deepEqual(words, ['Together', 'Each in place']);
    await shot('1-options-open');
    ok(`▾ on Turn opens ${want.join(' · ')}`);
    await tap(turnMore);
    await sleep(250);
    assert.equal(await menuOpen(), null, 'a second tap on the ▾ did not close the choices');

    // ---- each way: choose it, turn a quarter, check, undo, redo ----
    const cases = three
      ? [['y', 'spread'], ['y', 'inplace'], ['x', 'inplace'], ['z', 'spread'], ['x', 'spread']]
      : [['y', 'spread'], ['y', 'inplace']];
    const frame = await j(`JSON.stringify(document.querySelector('iframe').getBoundingClientRect())`);
    // A quarter turn: 157 px across (0.01 rad/px, 90° snaps within ±3°), in the upper part of the game (clear of
    // the strip under the crates and of a phone's sheet).
    const from = { x: frame.left + frame.width * (mobile ? 0.2 : 0.3), y: frame.top + frame.height * (mobile ? 0.12 : 0.18) };
    const quarter = Array.from({ length: 11 }, (_, i) => ({ x: from.x + (161 * i) / 10, y: from.y }));
    let n = 0;
    for (const [axis, way] of cases) {
      const name = `${axis === 'y' ? 'turn' : axis === 'x' ? 'tilt forward' : 'tilt sideways'} ${way === 'spread' ? 'together' : 'each in place'}`;
      // The axis (3D), then the way: each choice closes the menu and chooses Turn.
      if (three) {
        await tap(turnMore);
        await sleep(300);
        await tap(await inStrip(`[data-studio-choice="axis:${axis}"]`));
        await sleep(250);
      }
      await tap(turnMore);
      await sleep(300);
      const open = await menuOpen();
      assert.ok(open.includes(`turn:${way === 'spread' ? 'spread' : 'inplace'}`) || open.includes(`turn:${way}*`), `no ${way} choice`);
      await tap(await inStrip(`[data-studio-choice="turn:${way}"]`));
      await sleep(300);
      assert.equal(await menuOpen(), null, 'a choice did not close the menu');
      assert.deepEqual(await pressed(), ['rotate'], 'a choice did not choose Turn');
      await still(s0, `after choosing ${name}`);
      const label = await page.eval(`${ROOT}.querySelector('[data-studio-handle=rotate]').getAttribute('aria-label')`);
      assert.ok(label.includes(way === 'spread' ? 'Together' : 'Each in place'), `the turn button does not say the way: ${label}`);
      if (three) assert.equal(await page.eval(`${ROOT}.querySelector('[data-studio-handle=rotate]').dataset.axis`), axis);

      const before = new Map();
      for (const k of many) before.set(k, { pose: (await list()).find((i) => i.key === k).pose, mid: three ? await middle(k) : await center(k) });
      await drag(quarter);
      const after = new Map();
      for (const k of many) after.set(k, { pose: (await list()).find((i) => i.key === k).pose, mid: three ? await middle(k) : await center(k) });

      // Every member: the same turn, a quarter.
      if (three) {
        const q0 = turnOf(before.get(many[0]).pose, after.get(many[0]).pose);
        assert.ok(Math.abs(turnAngle(q0) - QUARTER) < 0.06, `${name}: turned ${(turnAngle(q0) * 180 / Math.PI).toFixed(1)}°, not 90°`);
        for (const k of many) {
          const q = turnOf(before.get(k).pose, after.get(k).pose);
          assert.ok(dist(q, q0) < 0.02, `${name}: ${k} turned differently (${q.map((v) => v.toFixed(3))} vs ${q0.map((v) => v.toFixed(3))})`);
        }
        if (axis === 'y') for (const k of many) assert.ok(!after.get(k).pose.t, `${name}: ${k} got tilted`);
        else for (const k of many) assert.ok(after.get(k).pose.t, `${name}: ${k} has no tilt`);
        const mids0 = many.map((k) => before.get(k).mid);
        if (way === 'inplace') {
          for (const k of many) assert.ok(dist(after.get(k).mid, before.get(k).mid) < 0.02, `${name}: ${k}'s box middle moved ${dist(after.get(k).mid, before.get(k).mid).toFixed(3)} m`);
        } else {
          // Round the middle of the box middles, by the same turn.
          const lo = [0, 1, 2].map((i) => Math.min(...mids0.map((m) => m[i]))), hi = [0, 1, 2].map((i) => Math.max(...mids0.map((m) => m[i])));
          const g = lo.map((v, i) => (v + hi[i]) / 2);
          for (const k of many) {
            const m0 = before.get(k).mid;
            const wantMid = qapply(q0, m0.map((v, i) => v - g[i])).map((v, i) => v + g[i]);
            assert.ok(dist(after.get(k).mid, wantMid) < 0.03, `${name}: ${k}'s box middle is ${dist(after.get(k).mid, wantMid).toFixed(3)} m off the turn round the middle`);
          }
          assert.ok(many.some((k) => dist(after.get(k).mid, before.get(k).mid) > 0.3), `${name}: nothing moved round the middle`);
        }
      } else {
        const d0 = after.get(many[0]).pose.r - before.get(many[0]).pose.r;
        assert.ok(Math.abs(angle(d0, 0) - QUARTER) < 0.06, `${name}: turned ${(d0 * 180 / Math.PI).toFixed(1)}°, not 90°`);
        for (const k of many) assert.ok(angle(after.get(k).pose.r - before.get(k).pose.r, d0) < 0.01, `${name}: ${k} turned differently`);
        if (way === 'inplace') {
          for (const k of many) assert.ok(dist(after.get(k).pose.p, before.get(k).pose.p) < 1e-6, `${name}: ${k} moved`);
        } else {
          for (const [a, b] of [[0, 1], [1, 2], [0, 2]]) {
            const g0 = dist(before.get(many[a]).mid, before.get(many[b]).mid), g1 = dist(after.get(many[a]).mid, after.get(many[b]).mid);
            assert.ok(Math.abs(g1 - g0) < Math.max(3, g0 * 0.03), `${name}: the gap ${many[a]}–${many[b]} changed ${g0.toFixed(1)} → ${g1.toFixed(1)} px`);
          }
          assert.ok(many.some((k) => dist(after.get(k).mid, before.get(k).mid) > 5), `${name}: nothing moved round the middle`);
        }
      }
      if (n++ === (three ? 4 : 0)) await shot('2-turned');
      // One undo step: all back. Redo: all turned again.
      await undo();
      for (const k of many) {
        const p = (await list()).find((i) => i.key === k).pose;
        assert.ok(dist(p.p, before.get(k).pose.p) < 1e-6 && angle(p.r ?? 0, before.get(k).pose.r ?? 0) < 1e-6 && !!p.t === !!before.get(k).pose.t, `${name}: undo did not put ${k} back (${JSON.stringify(p)} vs ${JSON.stringify(before.get(k).pose)})`);
      }
      await redo();
      for (const k of many) {
        const p = (await list()).find((i) => i.key === k).pose;
        assert.ok(dist(p.p, after.get(k).pose.p) < 1e-6 && dist(quatOf(p), quatOf(after.get(k).pose)) < 1e-4, `${name}: redo did not turn ${k} again`);
      }
      ok(`${name}: the same quarter turn for all, ${way === 'spread' ? 'round the middle' : 'nothing moved away'}; one undo step, redo`);
      // Back to the start for the next way (the last 3D one stays, for the save below).
      if (n < cases.length) await undo();
    }

    if (three) {
      // ---- Save: the tilted crates have t in placement.json ----
      const n0 = lines.filter((l) => l.startsWith('studio: saved placement.json')).length;
      await page.eval(`[...document.querySelectorAll('[data-action=save]')].find(e => e.offsetParent).click()`);
      for (let i = 0; i < 50 && lines.filter((l) => l.startsWith('studio: saved placement.json')).length <= n0; i++) await sleep(100);
      const file = JSON.parse(readFileSync(join(root, 'placement.json'), 'utf8'));
      const live = await list();
      for (const k of many) {
        const e = file.objects[k], p = live.find((i) => i.key === k).pose;
        assert.ok(e && Array.isArray(e.t) && e.t.length === 2, `placement.json ${k}: ${JSON.stringify(e)}`);
        assert.ok(dist(e.p, p.p) < 1e-3 && angle(e.t[0], p.t[0]) < 1e-3 && angle(e.t[1], p.t[1]) < 1e-3, `placement.json ${k} is not what is shown: ${JSON.stringify(e)} vs ${JSON.stringify(p)}`);
      }
      ok(`saved: ${many.map((k) => `${k}.t = [${file.objects[k].t.map((v) => (v * 180 / Math.PI).toFixed(0)).join('°, ')}°]`).join(', ')}`);
    }
    const errors = page.logs.filter((l) => l.startsWith('exception') || l.startsWith('error'));
    assert.deepEqual(errors, [], 'page errors');
  } catch (e) {
    failed++;
    console.log(`  ✗ ${tag}: ${e.message}`);
    console.log(page.logs?.slice(-8).join('\n') ?? '');
    if (SHOTS) writeFileSync(join(SHOTS, `FAIL-${tag}.png`), await page.screenshot().catch(() => Buffer.alloc(0)));
  } finally {
    await page.close();
    await browser.close();
    await srv.close();
    if (existsSync(root)) rmSync(root, { recursive: true, force: true });
  }
}

for (const game of GAMES) for (const layout of LAYOUTS) for (const theme of THEMES) await run(game, layout, theme);
if (failed) {
  console.log(`studio-multi-rotate: ${failed} run(s) failed`);
  process.exit(1);
}
console.log('studio-multi-rotate: ok');
