// The tool strip's tool modes, in a headless browser (play test 2026-10-16:
// "only move works by clicking the button and then dragging anywhere; the others
// need the button held while the mouse moves").
//
//   node test/studio-tool-modes.browser.mjs [--shots <dir>] [--only pc|phone]
//
// three-crates (PC 1280 with a mouse, phone 390 with a finger), pixi-garden (PC):
// - a tap on a strip button CHOOSES its tool: the button stays pressed
//   (aria-pressed), the first time a line at the bottom says how to look around;
// - then a drag that starts far from the object (not on it, not on the strip)
//   does that tool to the picked object: height = vertical drag, turn = sideways
//   drag (15° steps), size = right / up bigger, move = follows the drag;
//   while dragging, a readout next to the strip says by how much;
//   each drag is one undo step and leaves the view (camera) alone;
// - looking around does not mix with the tool: Option-drag and right-drag
//   (mouse), two fingers (touch) change the view and leave the object alone;
// - the keys M / H / T / S choose the tools (in the game frame and in the
//   editor page), Escape drops the tool (then a drag looks around again);
// - several picked: the turn tool turns all of them, one undo step.
// Each run uses a temporary copy of the example.
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStudioServer } from '../src/server/server.mjs';
import { launch, newPage } from './adapters-2d/cdp.mjs';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const shotsAt = args.indexOf('--shots');
const SHOTS = shotsAt >= 0 ? resolve(args[shotsAt + 1]) : null;
const onlyAt = args.indexOf('--only');
const ONLY = onlyAt >= 0 ? args[onlyAt + 1] : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DBG = `document.querySelector('iframe').contentWindow.__gameStudio._debug`;
const ROOT = `document.querySelector('iframe').contentDocument.querySelector('[data-studio-ui]').shadowRoot`;
const MOD = process.platform === 'darwin' ? 4 : 2;
const dist = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
const angle = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
const s0 = (p) => (Array.isArray(p.s) ? p.s[0] : p.s ?? 1);

async function run(example, layout) {
  const mobile = layout === 'phone';
  const tag = `${example}-${mobile ? '390' : '1280'}`;
  const root = mkdtempSync(join(tmpdir(), `studio-tools-${example}-`));
  cpSync(join(PKG, 'examples', example), root, { recursive: true });
  rmSync(join(root, 'placement.json'), { force: true });
  mkdirSync(join(root, '.studio/ui'), { recursive: true });
  writeFileSync(join(root, '.studio/ui/prefs.json'), JSON.stringify({ version: 1, lang: 'ja' }));
  const srv = await startStudioServer({ root, uiDir: join(PKG, 'skills/arrange/bin/studio-ui'), log: () => {} });
  const browser = await launch();
  const page = await newPage(browser, mobile ? { width: 390, height: 844, mobile: true } : { width: 1280, height: 800 });
  const ok = (m) => console.log(`  ✓ ${tag}: ${m}`);
  const shot = async (name) => {
    if (!SHOTS) return;
    writeFileSync(join(SHOTS, `${mobile ? 'phone' : 'pc'}-${example}-${name}.png`), await page.screenshot());
  };
  const j = async (expr) => JSON.parse((await page.eval(expr)) || 'null');
  const list = async () => j(`JSON.stringify(${DBG}.list())`);
  const pose = async (k) => (await list()).find((i) => i.key === k).pose;
  const view = async () => j(`JSON.stringify(${DBG}.view())`);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  /** Middle of an object's screen box, in page px. */
  const mid = async (k) => j(`(() => { const f = document.querySelector('iframe').getBoundingClientRect(); const r = ${DBG}.anchor(${JSON.stringify(k)}).rect;
    return JSON.stringify({ x: f.left + r.x + r.w / 2, y: f.top + r.y + r.h / 2, w: r.w, h: r.h }); })()`);
  const inStrip = async (sel) => j(`(() => { const f = document.querySelector('iframe'); const o = f.getBoundingClientRect();
    const b = ${ROOT}.querySelector(${JSON.stringify(sel)});
    if (!b || b.hidden || !b.getBoundingClientRect().width) return null; const r = b.getBoundingClientRect();
    return JSON.stringify({ x: o.left + r.left + r.width / 2, y: o.top + r.top + r.height / 2 }); })()`);
  const pressed = async () => j(`JSON.stringify([...${ROOT}.querySelectorAll('[data-studio-handle]')].filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.dataset.studioHandle))`);
  const shown = async (cls) => j(`(() => { const e = ${ROOT}.querySelector('.${cls}'); return JSON.stringify(e && e.style.display !== 'none' && e.style.visibility !== 'hidden' ? e.textContent : null); })()`);
  const tap = async (pt) => (mobile ? page.tap(pt.x, pt.y) : page.click(pt.x, pt.y));
  const strip = async (k) => {
    const b = await inStrip(`[data-studio-handle=${k}]`);
    assert.ok(b, `no ${k} button on the strip`);
    await tap(b);
    await sleep(250);
  };
  /**
   * A drag along `pts`. mouse: `button` left / right, `modifiers` (1 = Option / Alt);
   * `during` runs before the release (to read the readout). touch: one finger, or two with `fingers: 2`.
   */
  const drag = async (pts, { button = 'left', modifiers = 0, fingers = 1, during = null } = {}) => {
    const [a] = pts;
    if (mobile) {
      const tp = (p) => (fingers === 2 ? [{ x: p.x - 40, y: p.y, id: 1 }, { x: p.x + 40, y: p.y, id: 2 }] : [{ x: p.x, y: p.y, id: 1 }]);
      await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp(a) });
      for (const p of pts.slice(1)) await page.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp(p) });
      if (during) await during();
      await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      const buttons = button === 'right' ? 2 : 1;
      await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: a.x, y: a.y, modifiers });
      await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: a.x, y: a.y, button, buttons, clickCount: 1, modifiers });
      for (const p of pts.slice(1)) await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button, buttons, modifiers });
      if (during) await during();
      const l = pts[pts.length - 1];
      await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: l.x, y: l.y, button, buttons: 0, clickCount: 1, modifiers });
    }
    await sleep(300);
  };
  const line = (a, dx, dy, n = 12) => Array.from({ length: n + 1 }, (_, i) => ({ x: a.x + (dx * i) / n, y: a.y + (dy * i) / n }));
  const undo = async () => {
    await page.eval(`window.studioShell.actions.undo()`);
    await sleep(300);
  };
  const key = async (k, code, where) => {
    // 'game': the game frame has focus (its own keys); 'shell': the editor page has focus.
    if (where === 'game') await page.eval(`document.querySelector('iframe').contentWindow.focus()`);
    else await page.eval(`(document.activeElement && document.activeElement.blur && document.activeElement.blur(), document.querySelector('iframe').blur(), window.focus(), document.body.focus())`);
    await sleep(100);
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: k.length === 1 ? k.toUpperCase().charCodeAt(0) : 27 });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: k.length === 1 ? k.toUpperCase().charCodeAt(0) : 27 });
    await sleep(250);
  };
  try {
    await page.goto(srv.url);
    await page.waitFor(`document.querySelectorAll('.obj').length > 0 && !!document.querySelector('iframe').contentWindow.__gameStudio?._debug`, 30000);
    await sleep(800);
    const three = example.startsWith('three');
    const one = three ? 'crate-4' : 'house';
    const many = three ? ['crate-1', 'crate-2', 'crate-3'] : ['house', 'tree', 'flower-by-rock'];
    await page.eval(`window.studioShell.actions.select(${JSON.stringify(one)})`);
    await sleep(700);
    const iframe = await j(`JSON.stringify(document.querySelector('iframe').getBoundingClientRect())`);
    /**
     * A spot far from the picked object and from the strip, inside the game and clear of the card / sheet:
     * the drag must work "anywhere", so it never starts on the object.
     */
    const away = async () => {
      const m = await mid(one);
      const b = await inStrip('[data-studio-handle=move]');
      const cands = [];
      for (const fx of [0.2, 0.5, 0.8]) for (const fy of [0.25, 0.4, 0.55]) {
        const c = { x: iframe.left + iframe.width * fx, y: iframe.top + iframe.height * fy };
        // Only where the game itself is under the pointer (not the card, the sheet or the ask bar over it).
        if (await page.eval(`document.elementFromPoint(${c.x}, ${c.y}) === document.querySelector('iframe')`)) cands.push(c);
      }
      cands.sort((p, q) => Math.min(dist([q.x, q.y], [m.x, m.y]), dist([q.x, q.y], [b.x, b.y])) - Math.min(dist([p.x, p.y], [m.x, m.y]), dist([p.x, p.y], [b.x, b.y])));
      const p = cands[0];
      assert.ok(dist([p.x, p.y], [m.x, m.y]) > Math.max(m.w, m.h) / 2 + 30, 'no spot away from the object');
      return p;
    };

    // ---- nothing chosen: move rests lightly, no button pressed ----
    assert.deepEqual(await pressed(), [], 'a tool is pressed before any was chosen');

    // ---- height (3D) / turn: tap the button, then drag from anywhere ----
    const tools = three ? ['lift', 'rotate', 'scale', 'move'] : ['rotate', 'scale', 'move'];
    let first = true;
    for (const k of tools) {
      await strip(k);
      // The turn button (3D, one object) turns at once when chosen: no axis choices in the way (polish pass,
      // play test stumble 7). They are one more tap on it away.
      if (k === 'rotate' && three) {
        assert.equal(await inStrip('[data-studio-choice="axis:y"]'), null, 'choosing the turn tool opened the axis choices');
      }
      assert.deepEqual(await pressed(), [k], `after a tap on ${k}, pressed = ${JSON.stringify(await pressed())}`);
      if (first) {
        const hint = await shown('hint');
        assert.ok(hint && (mobile ? hint.includes('2 本指') : hint.includes('Esc')) && hint.length <= 40, `the first-time line (40 characters at most since review 2 ③): ${hint}`);
        if (k === tools[0]) await shot('1-tool-chosen-hint');
      }
      const v0 = await view();
      const p0 = await pose(one);
      const start = await away();
      // height: up; turn: right (~105 px ≈ 60°: a 15° step); size: right and up; move: left and down a bit.
      const [dx, dy] = k === 'lift' ? [0, -90] : k === 'rotate' ? [105, 0] : k === 'scale' ? [70, -40] : [-80, 40];
      let read = null;
      await drag(line(start, dx, dy), { during: async () => {
        read = await shown('chip');
        if (k === 'rotate') await shot('2-turn-anywhere-readout');
        if (k === 'scale') await shot('3-size-anywhere-readout');
      } });
      const p1 = await pose(one);
      assert.ok(read, `${k}: no readout while dragging`);
      if (k === 'lift') {
        assert.ok(p1.p[1] - p0.p[1] > 0.05, `height: y ${p0.p[1]} → ${p1.p[1]}`);
        assert.ok(Math.hypot(p1.p[0] - p0.p[0], p1.p[2] - p0.p[2]) < 1e-6, 'height: it moved on the ground too');
        assert.ok(read.includes('高さ'), `height readout: ${read}`);
      } else if (k === 'rotate') {
        const d = angle(p1.r ?? 0, p0.r ?? 0);
        assert.ok(Math.abs(d * 180 / Math.PI - 60) < 1, `turn: ${(d * 180 / Math.PI).toFixed(1)}° (wanted 60° in a 15° step)`);
        assert.ok(read.includes('回す') && read.includes('60°'), `turn readout: ${read}`);
      } else if (k === 'scale') {
        const f = s0(p1) / s0(p0);
        assert.ok(f > 1.5 && f < 2, `size: ×${f.toFixed(2)}`);
        assert.ok(read.includes('大きさ') && read.includes('×'), `size readout: ${read}`);
      } else {
        assert.ok(dist(p1.p, p0.p) > (three ? 0.2 : 20), `move: ${JSON.stringify(p0.p)} → ${JSON.stringify(p1.p)}`);
        assert.ok(read.includes('移動'), `move readout: ${read}`);
      }
      assert.ok(same(await view(), v0), `${k}: the view moved while using the tool`);
      assert.equal(await shown('chip'), null, `${k}: the readout stayed after the drag`);
      if (first) {
        assert.equal(await shown('hint'), null, 'the first-time line stayed after the first drag');
        first = false;
      }
      assert.deepEqual(await pressed(), [k], `${k} is not pressed any more after the drag`);
      // One undo step puts it back.
      await undo();
      const back = await pose(one);
      assert.ok(dist(back.p, p0.p) < 1e-6 && angle(back.r ?? 0, p0.r ?? 0) < 1e-6 && Math.abs(s0(back) - s0(p0)) < 1e-6, `${k}: one undo did not put it back`);
      ok(`${k}: tap the button, drag from anywhere → ${read} (view unchanged, one undo step)`);
    }

    // ---- looking around does not mix with the chosen tool (move is chosen now) ----
    {
      const start = await away();
      const p0 = await pose(one);
      const v0 = await view();
      if (mobile) await drag(line(start, 60, 30), { fingers: 2 });
      else await drag(line(start, 60, 30), { modifiers: 1 });
      assert.ok(!same(await view(), v0), `${mobile ? 'two fingers' : 'Option-drag'}: the view did not move`);
      assert.ok(same(await pose(one), p0), `${mobile ? 'two fingers' : 'Option-drag'}: the object moved`);
      ok(`${mobile ? 'two fingers' : 'Option-drag'} with a tool chosen looks around; the object stays`);
      if (!mobile) {
        const v1 = await view();
        await drag(line(await away(), -50, 20), { button: 'right' });
        assert.ok(!same(await view(), v1), 'right-drag: the view did not move');
        assert.ok(same(await pose(one), p0), 'right-drag: the object moved');
        ok('right-drag with a tool chosen pans; the object stays');
      }
    }

    // ---- keys: in the game frame and in the editor page; Escape drops the tool ----
    if (!mobile) {
      await key('t', 'KeyT', 'game');
      assert.deepEqual(await pressed(), ['rotate'], 'T in the game');
      await key('s', 'KeyS', 'shell');
      assert.deepEqual(await pressed(), ['scale'], 'S in the editor page');
      if (three) {
        await key('h', 'KeyH', 'game');
        assert.deepEqual(await pressed(), ['lift'], 'H in the game');
      }
      await key('m', 'KeyM', 'shell');
      assert.deepEqual(await pressed(), ['move'], 'M in the editor page');
      await key('Escape', 'Escape', 'game');
      assert.deepEqual(await pressed(), [], 'Escape did not drop the tool');
      assert.equal(await page.eval(`window.studioShell.selected()`), one, 'the first Escape dropped the pick, not the tool');
      ok('M / H / T / S choose (game frame and editor page); Escape drops the tool first, the pick stays');
    } else {
      // A tap on the chosen button puts it down (move has no choices).
      await strip('move');
      assert.deepEqual(await pressed(), [], 'a tap on the chosen move button did not put it down');
      ok('a tap on the chosen move button puts it down');
    }
    // No tool: a drag away from the object looks around again.
    {
      const p0 = await pose(one);
      const v0 = await view();
      await drag(line(await away(), 60, 20));
      assert.ok(!same(await view(), v0), 'no tool: the drag did not look around');
      assert.ok(same(await pose(one), p0), 'no tool: the object moved');
      ok('no tool chosen: a drag away from the object looks around');
    }

    // ---- several: the turn tool turns all of them, one undo step ----
    {
      await page.eval(`window.studioShell.actions.selectMany(${JSON.stringify(many)}, ${JSON.stringify(many[0])})`);
      await sleep(600);
      await strip('rotate');
      assert.deepEqual(await pressed(), ['rotate']);
      const before = await Promise.all(many.map(pose));
      const start = await away();
      await drag(line(start, -105, 0));
      const after = await Promise.all(many.map(pose));
      many.forEach((k, i) => assert.ok(Math.abs(angle(after[i].r ?? 0, before[i].r ?? 0) * 180 / Math.PI - 60) < 1.5, `several: ${k} turned ${(angle(after[i].r ?? 0, before[i].r ?? 0) * 180 / Math.PI).toFixed(1)}°`));
      await undo();
      const back = await Promise.all(many.map(pose));
      many.forEach((k, i) => assert.ok(dist(back[i].p, before[i].p) < 1e-6 && angle(back[i].r ?? 0, before[i].r ?? 0) < 1e-6, `several: undo did not put ${k} back`));
      ok('several picked: the turn tool from anywhere turns all three 60°, one undo step');
    }

    // ---- nothing picked: a drag looks around even with a tool chosen ----
    {
      await page.eval(`window.studioShell.actions.select(null)`);
      await sleep(400);
      const v0 = await view();
      const p0 = await list();
      await drag(line({ x: iframe.left + iframe.width * 0.5, y: iframe.top + iframe.height * 0.4 }, 60, 20));
      assert.ok(!same(await view(), v0), 'nothing picked: the drag did not look around');
      assert.ok(same(await list(), p0), 'nothing picked: something moved');
      ok('nothing picked: a drag looks around (the tool waits for a pick)');
    }
    const errors = page.logs.filter((l) => l.startsWith('exception') || l.startsWith('error'));
    assert.deepEqual(errors, [], 'page errors');
  } catch (err) {
    console.log(page.logs.slice(-15).join('\n'));
    if (SHOTS) writeFileSync(join(SHOTS, `tools-${tag}-FAIL.png`), await page.screenshot().catch(() => Buffer.alloc(0)));
    throw err;
  } finally {
    await page.close();
    await browser.close();
    await srv.close();
    if (existsSync(root)) rmSync(root, { recursive: true, force: true });
  }
}

for (const [ex, layout] of [['three-crates', 'pc'], ['three-crates', 'phone'], ['pixi-garden', 'pc']]) {
  if (ONLY && ONLY !== layout) continue;
  console.log(`${ex} · ${layout}`);
  await run(ex, layout);
}
console.log('all passed');
