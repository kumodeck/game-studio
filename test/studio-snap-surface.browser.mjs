// Snap to surfaces in a headless browser (a request after a try of the editor, 2026-10-19: "in Unreal, an object moved up or down stops once when
// it meets the ground or another thing — I want to set things down exactly on the ground"). Lantern Cove (3D).
//
//   node test/studio-snap-surface.browser.mjs [--shots <dir>] [--only pc|phone]
//
// PC 1280×800 (mouse, keys):
// - End (Drop to floor): the barrel raised 1.2 m with PgUp lands with its bottom on the water;
// - the Height tool dragged down: stops with the bottom on the surface below (a little extra pull held), and a long
//   pull goes through it; with Ctrl held during the drag it does not stop;
// - the Move tool: the barrel dragged from the water (it floats half under it) onto the pier stands on the planks
//   (y 1.11, its bottom exactly on them), where the pointer put its foot; with Ctrl held during the drag it moves flat at its height;
// - the ? sheet lists Drop to floor (End) and Move without snapping (⌃ ⌥), ⌘K has Drop to floor.
// Phone 390×844 (touch): the barrel dragged by the finger onto the pier stands on it; raised, then the place's menu
// (a long press) "Drop to floor" sets it down.
// Things standing on the land (review 3 of 2026-10-20: the lighthouse dragged 20 px right jumped 8 m, 120 px flung it
// 64 m into the hills, and over the sailboat's sail it dropped to the boat's foot): PC, the side window 400×900 (mouse)
// and the phone (finger), the lighthouse, the cottage, a pine and the sea stack dragged with the Move tool —
// 20 px moves the foot 20 ± 8 px on screen and at most 2 m in the world; 20 / 60 / 120 px go on the same way (no back
// and forth, nothing flung far); up / down 30 px go away / toward the camera by a step (≤ 12 m, not 78); the
// lighthouse pulled right over the sail stays near where it was pulled (not at the boat's foot).
// Photos (--shots): <pc|phone>-1-on-pier.png, -2-before-drop.png, -3-after-drop.png; <pc|side|phone>-land-<key>-<move>.png.
//   --part land: only the things on the land (all three sizes).  --theme dark: the dark shell (photos).
//   --demo: the things on the land in the web demo instead (built into a temporary folder by build-web-demo.mjs and
//   served as the hosted demo is, test/web-demo-host.mjs): review 3 saw the same jump there.
// Each run uses a temporary copy of the starter. Needs the network for the starter's libraries (or STUDIO_CDN_CACHE).
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { startStudioServer } from '../src/server/server.mjs';
import { startHost } from './web-demo-host.mjs';
import { launch, newPage } from './adapters-2d/cdp.mjs';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const take = (flag, d) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : d;
};
const SHOTS = take('--shots', null) ? resolve(take('--shots')) : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const ONLY = take('--only', null);
const PART = take('--part', 'all');
const THEME = take('--theme', 'light');
const DEMO = args.includes('--demo');
let demoDir = null;
if (DEMO) {
  demoDir = mkdtempSync(join(tmpdir(), 'studio-snap-demo-'));
  execFileSync(process.execPath, [join(PKG, 'scripts/build-web-demo.mjs'), '--out', demoDir], { stdio: 'ignore' });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DBG = `document.querySelector('iframe').contentWindow.__gameStudio?._debug`;
const MOD = process.platform === 'darwin' ? 4 : 2; // ⌘ / Ctrl for ⌘K
const CTRL = 2;
const BARREL = 'barrel';
/** A point on the pier's planks (props.js: the pier at x 15, z 6; planks from x 4.5 to 16, 2.2 m wide, top y 1.11). */
const ON_PIER = [11, 1.11, 6];
const PIER_TOP = 1.11;

let failed = 0;

/**
 * Things on the land: [key, metres above the origin to press on (a point on the thing itself)]. The cottage at 2 m (its
 * walls' top): on the phone demo a finger at 1.3 m (the middle of the wall) does not start a move at all — before
 * this change too (checked on 512b4ec03, 2026-10-20): left for its own look, not a snapping matter.
 */
const LAND = [['lighthouse', 4], ['cottage', 2], ['pine-3', 2], ['sea-stack', 4]];
/** The drags (px on the page): Ive's measures on the lighthouse (review 3: right 20 / 60 / 120, up 30, down 30). */
const MOVES = [['r20', 20, 0], ['r60', 60, 0], ['r120', 120, 0], ['u30', 0, -30], ['d30', 0, 30]];

async function run(kind) {
  const phone = kind === 'phone';
  const tag = DEMO ? `demo-${kind}` : kind;
  const root = mkdtempSync(join(tmpdir(), `studio-snap-${tag}-`));
  cpSync(join(PKG, 'starters', 'lantern-cove'), root, { recursive: true });
  mkdirSync(join(root, '.studio/ui'), { recursive: true });
  writeFileSync(join(root, '.studio/ui/prefs.json'), JSON.stringify({ version: 1, lang: 'en', theme: THEME }));
  const srv = DEMO ? await startHost({ dir: demoDir }) : await startStudioServer({ root, uiDir: join(PKG, 'skills/arrange/bin/studio-ui'), log: () => {} });
  const browser = await launch();
  const size = phone ? { width: 390, height: 844, mobile: true } : kind === 'side' ? { width: 400, height: 900 } : { width: 1280, height: 800 };
  const page = await newPage(browser, { ...size, cdnCache: process.env.STUDIO_CDN_CACHE });
  const ok = (m) => console.log(`  ✓ ${tag}: ${m}`);
  const shot = async (name) => {
    if (!SHOTS) return;
    await sleep(500);
    writeFileSync(join(SHOTS, `${tag}${THEME === 'dark' ? '-dark' : ''}-${name}.png`), await page.screenshot());
  };
  const j = async (expr) => JSON.parse((await page.eval(expr)) || 'null');
  const rest = () => j(`JSON.stringify(${DBG}.rest(${JSON.stringify(BARREL)}))`);
  const foot = () => j(`JSON.stringify(${DBG}.foot(${JSON.stringify(BARREL)}))`);
  const pose = () => j(`JSON.stringify(${DBG}.anchor(${JSON.stringify(BARREL)}).pose)`);
  /** A scene point on the page (px), or null behind the camera. */
  const screen = (p) => j(`(() => { const f = document.querySelector('iframe').getBoundingClientRect(); const s = ${DBG}.toScreen(${JSON.stringify(p)});
    return JSON.stringify(s && { x: f.left + s[0], y: f.top + s[1] }); })()`);
  const frameBox = () => j(`JSON.stringify(document.querySelector('iframe').getBoundingClientRect())`);
  const center = () => j(`(() => { const f = document.querySelector('iframe').getBoundingClientRect(); const a = ${DBG}.anchor(${JSON.stringify(BARREL)});
    return JSON.stringify({ x: f.left + a.center[0], y: f.top + a.center[1], liftPx: a.liftPx }); })()`);
  const key = async (k, code, vk, modifiers = 0) => {
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers });
    await sleep(60);
  };
  const raise = async (n) => {
    for (let i = 0; i < n; i++) await key('PageUp', 'PageUp', 33);
    await sleep(300);
  };
  const undo = async () => {
    await page.eval(`studioShell.actions.undo()`);
    await sleep(300);
  };
  const line = (a, b, n = 20) => Array.from({ length: n + 1 }, (_, i) => ({ x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n }));
  /** A mouse drag (the left button), `modifiers` held on the moves only (Ctrl pressed after the drag began). */
  const drag = async (pts, modifiers = 0) => {
    const [a] = pts;
    if (phone) {
      await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a.x, y: a.y, id: 1 }] });
      for (const p of pts.slice(1)) await page.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p.x, y: p.y, id: 1 }] });
      await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: a.x, y: a.y });
      await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: a.x, y: a.y, button: 'left', buttons: 1, clickCount: 1 });
      for (const p of pts.slice(1)) await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'left', buttons: 1, modifiers });
      const l = pts[pts.length - 1];
      await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: l.x, y: l.y, button: 'left', buttons: 0, clickCount: 1, modifiers });
    }
    await sleep(350);
  };
  const tool = async (k) => {
    await key(k, `Key${k.toUpperCase()}`, k.toUpperCase().charCodeAt(0));
    await sleep(150);
  };
  /** Drag the barrel's foot to the screen point `to` (the drag starts on the barrel; the foot keeps its offset). */
  const footTo = async (to, modifiers = 0) => {
    const c = await center();
    // On surfaces the editor carries the point where the barrel meets what it stands on (its foot at the water's
    // level, not its sunk bottom: adapters/three grab, merge of 2026-10-19), so the pointer puts THAT point on the target.
    const ft = await foot(), r = await rest();
    const f = await screen(!modifiers && r && r.below !== null ? [ft[0], r.below, ft[2]] : ft);
    await drag(line(c, { x: c.x + to.x - f.x, y: c.y + to.y - f.y }, 30), modifiers);
  };
  const near = (a, b, eps) => Math.abs(a - b) <= eps;
  const at = (k) => j(`JSON.stringify(${DBG}.anchor(${JSON.stringify(k)}).pose.p)`);
  const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
  /** Where the edit camera stands (adapters/three/camera.js eyeOf, from the view's state). */
  const camera = async () => {
    const s = await j(`JSON.stringify(${DBG}.view())`);
    const cp = Math.cos(s.pitch);
    return [s.target[0] + s.distance * cp * Math.sin(s.yaw), s.target[1] + s.distance * Math.sin(s.pitch), s.target[2] + s.distance * cp * Math.cos(s.yaw)];
  };
  /**
   * Things on the land, dragged with the Move tool (see the header). The foot = the object's origin (Lantern Cove's
   * props stand on it: prop() puts it on the ground; the top-level groups' parent space is the world). The world box
   * is not used: the lighthouse's includes its 28 m light beams.
   */
  const land = async () => {
    let framed = false;
    for (const [k, up] of LAND) {
      // Back to the opening view after a "frame all" for the one before (⇧F), so each starts where the editor opened.
      if (framed) {
        await key('F', 'KeyF', 70, 8);
        await sleep(1200);
        framed = false;
      }
      await page.eval(`studioShell.actions.select(${JSON.stringify(k)})`);
      // Since plan step 2 (2026-10-23, "the camera stays put") a list pick moves the camera only when the object is not
      // on screen: on the PC pine-3 stays at the frame's left edge beside the list (a fifth of it is seen), and the drag
      // point at its foot is off the game. These measures are about the drag, not the pick, so then the whole scene is
      // framed first (F, the editor's own "frame all"); the metres per pixel below are measured in that view.
      await sleep(1300);
      if (!phone) await tool('m');
      const offGame = async () => {
        const pr = await screen([(await at(k))[0], (await at(k))[1] + up, (await at(k))[2]]);
        return !pr || !(await page.eval(`(() => { const f = document.querySelector('iframe').getBoundingClientRect(); const x = ${pr.x}, y = ${pr.y};
          return x > f.left + 24 && x < f.right - 24 && y > f.top + 24 && y < f.bottom - 24 && document.elementFromPoint(x, y) === document.querySelector('iframe'); })()`));
      };
      if (await offGame()) {
        await page.eval('studioShell.actions.frameAll()');
        await sleep(1300);
        framed = true;
      }
      const p0 = await at(k);
      const s0 = await screen(p0);
      const press = await screen([p0[0], p0[1] + up, p0[2]]);
      assert.ok(s0 && press, `${k} is not in view`);
      // Metres per pixel across the view at the foot (1 m along the camera's right, on screen): the side window and
      // the phone see the cove from farther, so the same 20 px is more metres there than on the PC.
      const view = await j(`JSON.stringify(${DBG}.view())`);
      const sr = await screen([p0[0] + Math.cos(view.yaw), p0[1], p0[2] - Math.sin(view.yaw)]);
      const mpp = 1 / Math.hypot(sr.x - s0.x, sr.y - s0.y);
      const seen = [];
      for (const [name, dx, dy] of MOVES) {
        const px = Math.hypot(dx, dy);
        await drag(line(press, { x: press.x + dx, y: press.y + dy }, Math.max(4, Math.round(px / 5))));
        const p1 = await at(k);
        const s1 = await screen(p1);
        const world = Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
        const d = s1 ? sub(s1, s0) : { x: NaN, y: NaN };
        // Along the drag (px): how far the foot went the way the pointer went, and how far off to the side.
        const along = (d.x * dx + d.y * dy) / px, aside = Math.abs(d.x * dy - d.y * dx) / px;
        const eye = await camera();
        const farther = Math.hypot(p1[0] - eye[0], p1[2] - eye[2]) - Math.hypot(p0[0] - eye[0], p0[2] - eye[2]);
        seen.push({ name, px, along, aside, world, farther });
        console.log(`    ${tag}: ${k} ${name}: foot ${along.toFixed(1)} px along (${aside.toFixed(1)} aside), ${world.toFixed(2)} m → (${p1.map((x) => x.toFixed(1)).join(', ')})`);
        if (name === 'r20' || name === 'u30') await shot(`land-${k}-${name}`);
        await undo();
        const back = await at(k);
        assert.ok(Math.hypot(back[0] - p0[0], back[1] - p0[1], back[2] - p0[2]) < 1e-3, `${k}: undo did not bring it back`);
      }
      for (const m of seen) {
        if (m.name[0] === 'r') {
          // Across the view the foot moves on screen as far as the pointer: 20 px is Ive's line (20 ± 8 px, ≤ 2 m),
          // longer ones ± 40 %, and the way the pointer went. Up or down a little is allowed: the cottage dragged
          // right walks up its rise (10 px up for 20 px right) — the land, not a jump.
          const tol = m.name === 'r20' ? 8 : 0.4 * m.px;
          const moved = Math.hypot(m.along, m.aside);
          assert.ok(Math.abs(moved - m.px) <= tol && m.along >= 0.5 * m.px, `${k} ${m.name}: the foot went ${m.along.toFixed(1)} px along / ${m.aside.toFixed(1)} px aside for ${m.px} px`);
          // ≤ 2 m on the PC (Ive's line); where 20 px across is already more than ~1.25 m, 1.6× that.
          if (m.name === 'r20') assert.ok(m.world <= Math.max(2, 1.6 * 20 * mpp), `${k} r20: ${m.world.toFixed(2)} m in the world (20 px across = ${(20 * mpp).toFixed(2)} m here)`);
        } else {
          // Up / down the screen: away / toward the camera, and a step, not a leap (Ive: up 30 px flung the
          // lighthouse 78 m and the cottage 77 m). On a hill seen from below its top the foot cannot follow the
          // pointer up the screen (beyond the top the land is hidden), so the screen is not asserted here.
          // 12 m on the PC (30 px × 0.06 m × 1 / GRAZE = 7.4 m, and a slope); scaled the same way where pixels are bigger.
          assert.ok(m.world <= Math.max(12, 12 * mpp / 0.062), `${k} ${m.name}: ${m.world.toFixed(2)} m for ${m.px} px (${mpp.toFixed(3)} m/px)`);
          assert.ok(m.name === 'u30' ? m.farther > -0.05 : m.farther < 0.05, `${k} ${m.name}: ${m.farther.toFixed(2)} m farther from the camera`);
        }
      }
      const r = seen.filter((m) => m.name[0] === 'r');
      for (let i = 1; i < r.length; i++) assert.ok(r[i].along >= r[i - 1].along && r[i].world >= r[i - 1].world - 0.05, `${k}: ${r[i - 1].name} → ${r[i].name} went back`);
      ok(`${k} (${mpp.toFixed(3)} m/px): 20 px → ${r[0].along.toFixed(1)} px / ${r[0].world.toFixed(2)} m; 60 → ${r[1].world.toFixed(1)} m; 120 → ${r[2].world.toFixed(1)} m; up 30 → ${seen[3].world.toFixed(1)} m`);
    }
    if (framed) {
      await key('F', 'KeyF', 70, 8);
      await sleep(1200);
    }
    // Across the sailboat's sail: the lighthouse pulled right until the pointer is over the sail (Ive, review 3: at
    // 154 px right the ray met the sail and the lighthouse dropped to the boat's foot, z 8.8, half the view) does not
    // go to the boat.
    await page.eval(`studioShell.actions.select('lighthouse')`);
    await sleep(1300);
    if (!phone) await tool('m');
    const p0 = await at('lighthouse');
    const boat = await at('sailboat');
    const press = await screen([p0[0], p0[1] + 4, p0[2]]);
    const sail = await screen([boat[0], boat[1] + 4, boat[2]]);
    const fb = await frameBox();
    if (sail && sail.x > press.x + 20 && sail.x < fb.right) {
      await drag(line(press, { x: sail.x + 10, y: press.y }, 40));
      const p1 = await at('lighthouse');
      const off = Math.hypot(p1[0] - boat[0], p1[2] - boat[2]);
      console.log(`    ${tag}: lighthouse pulled ${Math.round(sail.x + 10 - press.x)} px right, over the sail → (${p1.map((x) => x.toFixed(1)).join(', ')}), ${off.toFixed(1)} m from the boat`);
      await shot('land-lighthouse-sail');
      assert.ok(off > 6, `the lighthouse went to the boat's foot: ${off.toFixed(1)} m from it`);
      // (Not "stays on the hill": pulled far enough it walks down to the shore and on over the water, as asked.)
      ok(`lighthouse pulled right over the sail: not at the boat's foot (${off.toFixed(1)} m from the boat, y ${p1[1].toFixed(1)})`);
      await undo();
    } else console.log(`    ${tag}: the sail is not to the right of the lighthouse in this view, the sail drag skipped`);
  };
  const step = (m) => process.env.SNAP_TRACE && console.log(`    … ${tag}: ${m}`);
  try {
    await page.goto(DEMO ? `${srv.url.replace(/\/?$/, '/')}studio/?game=lantern-cove&lang=en` : srv.url);
    await page.waitFor(`document.querySelectorAll('.obj').length > 0 && !!${DBG}`, 90000);
    await sleep(1500);
    await land();
    if (PART === 'land' || kind === 'side' || DEMO) return;
    await page.eval(`studioShell.actions.select(${JSON.stringify(BARREL)})`);
    await sleep(1200); // the first pick glides from the opening view (0.6 s)
    // The barrel and the pier both in view: frame all if the glide's framing left the pier out.
    const inView = async (p) => {
      const s = await screen(p);
      const f = await frameBox();
      return s && s.x > f.left + 30 && s.x < f.right - 30 && s.y > f.top + 60 && s.y < f.bottom - (phone ? 260 : 60);
    };
    // Closer, toward the middle of the barrel and the pier (the wheel zooms toward the pointer), so the photos show
    // the barrel on the planks — while both stay in view (one step back when a step lost one of them).
    const both = async () => (await inView(ON_PIER)) && (await inView(await foot()));
    for (let i = 0; i < 6 && (await both()); i++) {
      const a = await screen(ON_PIER), b = await screen(await foot());
      const at = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      await page.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: at.x, y: at.y, deltaX: 0, deltaY: -200 });
      await sleep(150);
      if (!(await both())) {
        await page.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: at.x, y: at.y, deltaX: 0, deltaY: 200 });
        await sleep(150);
        break;
      }
    }
    await sleep(400);
    if (!(await inView(ON_PIER))) {
      await page.eval(`studioShell.actions.frameAll()`);
      await sleep(600);
    }
    assert.ok(await inView(ON_PIER), 'the pier is not in view');
    const r0 = await rest();
    assert.ok(r0 && r0.below !== null, `nothing under the barrel: ${JSON.stringify(r0)}`);
    const stand = r0.bottom - r0.below; // the barrel floats low: its bottom a little under the water
    ok(`the barrel stands on the water (bottom ${r0.bottom.toFixed(3)}, surface ${r0.below.toFixed(3)})`);

    // ---- Move: onto the pier ----
    if (!phone) await tool('m');
    const target = await screen(ON_PIER);
    await footTo(target);
    const r1 = await rest();
    const f1 = await foot();
    assert.ok(near(r1.below, PIER_TOP, 0.02), `not over the pier's planks: surface ${r1.below}`);
    // On another surface than the one it floated in, the bottom sits exactly on it (the float's sink is not kept).
    assert.ok(near(r1.bottom - r1.below, Math.max(0, stand), 0.01), `not standing on the planks: bottom ${r1.bottom}, surface ${r1.below}`);
    assert.ok(Math.hypot(f1[0] - ON_PIER[0], f1[2] - ON_PIER[2]) < 0.6, `the foot is not where the pointer put it: ${f1}`);
    ok(`dragged onto the pier: stands on the planks (bottom ${r1.bottom.toFixed(3)}, planks ${r1.below.toFixed(3)})`);
    await shot('1-on-pier');

    // ---- Drop to floor ----
    await raise(12);
    const r2 = await rest();
    assert.ok(r2.bottom - r2.below > 1.1, `PgUp did not raise it: ${JSON.stringify(r2)}`);
    await shot('2-before-drop');
    if (phone) {
      // The place's menu: a finger held still on the barrel, then "Drop to floor".
      const c = await center();
      await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: c.x, y: c.y, id: 1 }] });
      await sleep(900);
      await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitFor(`!document.querySelector('.ctx-menu').hidden`, 3000);
      await sleep(200);
      const row = await j(`(() => { const b = document.querySelector('.ctx-menu [data-action=ctx-drop]'); if (!b) return 'null'; const r = b.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }); })()`);
      assert.ok(row, 'the place\'s menu has no Drop to floor');
      await page.tap(row.x, row.y);
      await sleep(500);
    } else await key('End', 'End', 35);
    await sleep(300);
    const r3 = await rest();
    assert.ok(near(r3.bottom, r3.below, 0.005), `not set on the surface: ${JSON.stringify(r3)}`);
    assert.ok(near(r3.below, PIER_TOP, 0.02), `dropped onto something else than the planks: ${r3.below}`);
    ok(`Drop to floor (${phone ? 'the place\'s menu' : 'End'}): bottom ${r2.bottom.toFixed(2)} → ${r3.bottom.toFixed(3)} on the planks`);
    await shot('3-after-drop');
    if (phone) return;

    // ---- Height: stops on the planks, a long pull goes through, Ctrl frees it ----
    await tool('h');
    await raise(10);
    let c = await center();
    const r4 = await rest();
    const gapPx = (r4.bottom - r4.below) * c.liftPx;
    await drag(line(c, { x: c.x, y: c.y + gapPx + 12 }, 24));
    const r5 = await rest();
    assert.ok(near(r5.bottom, r5.below, 0.01), `the height drag did not stop on the planks: ${JSON.stringify(r5)} (asked ${(r4.bottom - r4.below).toFixed(2)} m + 12 px)`);
    ok(`Height: pulled ${(r4.bottom - r4.below).toFixed(2)} m + 12 px down, stopped on the planks (bottom ${r5.bottom.toFixed(3)})`);
    c = await center();
    await drag(line(c, { x: c.x, y: c.y + 120 }, 24));
    const r6 = await rest();
    assert.ok(r6.bottom < PIER_TOP - 0.05, `a long pull did not go through the planks: ${JSON.stringify(r6)}`);
    ok(`Height: a long pull goes through (bottom ${r6.bottom.toFixed(2)})`);
    step('undo ×2');
    await undo();
    await undo();
    step('rest');
    const r7 = await rest();
    assert.ok(near(r7.bottom - r7.below, r4.bottom - r4.below, 0.01), `undo did not bring the height back: ${JSON.stringify(r7)}`);
    c = await center();
    step('ctrl drag');
    await drag(line(c, { x: c.x, y: c.y + gapPx + 12 }, 24), CTRL);
    step('ctrl drag done');
    const r8 = await rest();
    assert.ok(r8.bottom < PIER_TOP - 0.01, `with Ctrl held the height drag still stopped: ${JSON.stringify(r8)}`);
    ok(`Height with Ctrl held: no stop (bottom ${r8.bottom.toFixed(3)})`);
    await undo();

    // ---- Move with Ctrl: flat at its height ----
    await key('End', 'End', 35);
    await tool('m');
    const y0 = (await pose()).p[1];
    const back = await screen([4, 0, 12]);
    await footTo(back, CTRL);
    const y1 = (await pose()).p[1];
    assert.ok(near(y0, y1, 1e-6), `with Ctrl held the move changed the height: ${y0} → ${y1}`);
    ok('Move with Ctrl held: flat, the height kept');
    await undo();

    // ---- the ? sheet and ⌘K ----
    await page.eval(`(document.activeElement?.blur?.(), document.body.focus())`);
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: '?', code: 'Slash', windowsVirtualKeyCode: 191, modifiers: 8, text: '?' });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: '?', code: 'Slash', windowsVirtualKeyCode: 191, modifiers: 8 });
    await page.waitFor(`!!document.querySelector('.keys-sheet:not([hidden])')`, 3000);
    const rows = await j(`JSON.stringify(['drop', 'free'].map((k) => document.querySelector('.keys-sheet [data-key=' + k + ']')?.textContent.trim() || null))`);
    assert.ok(rows[0] && /Drop to floor/.test(rows[0]) && /End/.test(rows[0]), `the sheet: ${rows[0]}`);
    assert.ok(rows[1] && /without snapping/.test(rows[1]), `the sheet: ${rows[1]}`);
    ok(`the ? sheet: "${rows[0]}" · "${rows[1]}"`);
    await key('Escape', 'Escape', 27);
    await key('k', 'KeyK', 75, MOD);
    await page.waitFor(`!!document.querySelector('#studio-palette:not([hidden])')`, 3000);
    const pal = await page.eval(`document.querySelector('#studio-palette [data-action=drop]')?.textContent.trim() || ''`);
    assert.match(pal, /Drop to floor/);
    ok(`⌘K: "${pal}"`);
  } catch (e) {
    failed++;
    console.error(`  ✗ ${tag}: ${e.message}`);
    if (SHOTS) writeFileSync(join(SHOTS, `${tag}-fail.png`), await page.screenshot());
  } finally {
    await browser.close();
    await srv.close();
  }
}

for (const kind of ['pc', 'side', 'phone']) {
  if (ONLY && !ONLY.split(',').includes(kind)) continue;
  await run(kind);
}
if (failed) {
  console.error(`studio-snap-surface: ${failed} failed`);
  process.exit(1);
}
console.log('studio-snap-surface: ok');
