// Draw order (2D layers) end to end in a headless browser: the real local
// server, the built shell and edit script, an example game and its adapter.
//
//   node test/studio-layers.browser.mjs [example ...] [--shots <dir>] [--lang ja]
//
// --lang ja opens the editor in Japanese (a .studio/ui/prefs.json in the
// temporary copy), for screenshots meant for Japanese readers.
//
// For each example, at 1280×800 with a mouse and at 390×844 with touch:
//   1. the list shows the draw order, front on top
//   2. put the back-most object on top of the front-most one (typed numbers)
//   3. "To front" → the picture changes and the list follows
//   4. undo puts it back exactly (same picture), redo again
//   5. PC: ⌘[ / ⇧⌘] shortcuts; both: drag the grip in the list (mouse / finger)
//      "To back" stops just in front of the ground / background (Item.backdrop)
//   6. save → placement.json has `order` (back → front, with `was`)
//   7. reload → the game applies the saved order itself, nothing unsaved
// Each example runs in a temporary copy of its folder, so the repository is
// never written to. Exit code 1 on the first failed expectation.
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
const SHOTS = shotsAt >= 0 ? resolve(args.splice(shotsAt, 2)[1]) : null;
const langAt = args.indexOf('--lang');
const LANG = langAt >= 0 ? args.splice(langAt, 2)[1] : null;
const EXAMPLES = args.length ? args : ['pixi-garden', 'pixi-bubbles', 'canvas-stars'];
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DBG = `document.querySelector('iframe').contentWindow.__gameStudio._debug`;
const IN = {
  ready: `document.querySelectorAll('.obj').length > 0 && !!document.querySelector('iframe').contentWindow.__gameStudio?._debug`,
  list: `JSON.stringify(${DBG}.list())`,
  anchor: (key) => `(() => { const f = document.querySelector('iframe'); const r = f.getBoundingClientRect();
    const a = ${DBG}.anchor(${JSON.stringify(key)}); if (!a) return null;
    const inside = !!a.rect && a.center[0] > a.rect.x + 6 && a.center[0] < a.rect.x + a.rect.w - 6 && a.center[1] > a.rect.y + 6 && a.center[1] < a.rect.y + a.rect.h - 6;
    const rect = a.rect && { x: r.left + a.rect.x, y: r.top + a.rect.y, w: a.rect.w, h: a.rect.h };
    return JSON.stringify({ x: r.left + a.center[0], y: r.top + a.center[1], size: a.size, visible: a.visible, inside, rect, frame: { x: r.left, y: r.top, w: r.width, h: r.height } }); })()`,
  /** Keys of one list as the panel shows them (front first). */
  rows: (layer) => `JSON.stringify([...document.querySelectorAll('li.obj[data-layer]')].filter(r => r.dataset.layer === ${JSON.stringify(layer)}).map(r => r.dataset.key))`,
  saveLabel: `[...document.querySelectorAll('[data-action=save]')].find(b => b.offsetParent)?.textContent || ''`,
  click: (sel) => `(() => { const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find(e => e.offsetParent); if (!el || el.disabled) return false; el.click(); return true; })()`,
};
const j = async (page, expr) => JSON.parse((await page.eval(expr)) || 'null');

async function run(example, layout) {
  const mobile = layout === 'phone';
  const tag = `${example}-${mobile ? '390' : '1280'}${LANG ? `-${LANG}` : ''}`;
  const root = mkdtempSync(join(tmpdir(), `studio-layers-${example}-`));
  cpSync(join(PKG, 'examples', example), root, { recursive: true });
  rmSync(join(root, 'placement.json'), { force: true });
  if (LANG) {
    mkdirSync(join(root, '.studio/ui'), { recursive: true });
    writeFileSync(join(root, '.studio/ui/prefs.json'), JSON.stringify({ version: 1, lang: LANG }));
  }
  const lines = [];
  const srv = await startStudioServer({ root, uiDir: join(PKG, 'skills/arrange/bin/studio-ui'), log: (l) => lines.push(l) });
  const browser = await launch();
  const page = await newPage(browser, mobile ? { width: 390, height: 844, mobile: true } : { width: 1280, height: 800 });
  const step = (name) => console.log(`  ✓ ${tag}: ${name}`);
  const shot = async (name) => {
    if (!SHOTS) return;
    await sleep(300);
    writeFileSync(join(SHOTS, `layers-${tag}-${name}.png`), await page.screenshot());
  };
  /** PNG (base64) of one page rectangle: compares what the game draws there. */
  const pixels = async (c) => {
    await sleep(250);
    const s = await page.send('Page.captureScreenshot', { format: 'png', clip: { ...c, scale: 1 } });
    return s.data;
  };
  const list = async () => JSON.parse(await page.eval(IN.list));
  const zOf = async (key) => (await list()).find((i) => i.key === key).pose.z;
  const press = async (sel) => assert.ok(await page.eval(IN.click(sel)), `no enabled ${sel}`);
  const MOD = process.platform === 'darwin' ? 4 : 2;
  // Undo / redo (rebrand 2026-10-16: no toolbar buttons on PC): ⌘Z / ⇧⌘Z there; on a
  // phone Undo is in the top bar and Redo a row of the ⌘K list (press the ask field).
  const keyZ = async (modifiers) => {
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'z', code: 'KeyZ', modifiers, windowsVirtualKeyCode: 90 });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'z', code: 'KeyZ', modifiers, windowsVirtualKeyCode: 90 });
    await sleep(150);
  };
  const undo = async () => (mobile ? press('[data-action=undo]') : keyZ(MOD));
  const redo = async () => {
    if (!mobile) return keyZ(MOD | 8);
    await page.eval(`(() => { const i = document.querySelector('.ask-input'); i.focus(); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true })); })()`);
    await sleep(100);
    await press('.palette [data-action=redo]');
  };
  const openSheet = async () => {
    if (!mobile || (await page.eval(`document.querySelector('.shell').dataset.sheet === 'open'`))) return;
    await press('[data-action=sheet]');
    await sleep(500);
  };
  // Phone: the list is a sheet over the game since the rebrand; pictures are compared with it closed.
  const closeSheet = async () => {
    if (!mobile || (await page.eval(`document.querySelector('.shell').dataset.sheet !== 'open'`))) return;
    await press('[data-action=sheet]');
    await sleep(500);
  };
  const key = async (k, code, modifiers) => {
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, modifiers, windowsVirtualKeyCode: code === 'BracketLeft' ? 219 : 221 });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, modifiers, windowsVirtualKeyCode: code === 'BracketLeft' ? 219 : 221 });
    await sleep(150);
  };
  try {
    await page.goto(srv.url);
    await page.waitFor(IN.ready, 30000);
    for (let i = 0; i < 40 && !lines.some((l) => l.startsWith('studio: check ')); i++) await sleep(100);
    assert.ok(lines.some((l) => l.startsWith('studio: check ok')), `self-check: ${lines.filter((l) => l.startsWith('studio: check')).join(' | ')}`);
    if (mobile) {
      await press('[data-action=sheet]');
      await sleep(600);
    }

    // --- the list in draw order, front on top ---
    const items = await list();
    const layers = new Map();
    for (const it of items) if (it.layer) layers.set(it.layer, [...(layers.get(it.layer) || []), it]);
    const [layer, members] = [...layers].sort((a, b) => b[1].length - a[1].length)[0] || [];
    assert.ok(members && members.length >= 2, `no list with two objects to reorder: ${JSON.stringify(items.map((i) => [i.key, i.layer, i.pose.z]))}`);
    const backToFront = members.slice().sort((a, b) => a.pose.z - b.pose.z).map((i) => i.key);
    assert.deepEqual(await j(page, IN.rows(layer)), backToFront.slice().reverse(), 'the list is not in draw order (front first)');
    step(`list in draw order "${layer}": ${backToFront.slice().reverse().join(' > ')}`);
    await shot('1-open');

    // Back-most and front-most objects that are on screen and not huge.
    // Prefer objects whose pivot is inside their drawing (a ground strip's
    // pivot is its corner: moved "onto" another object it would not cover it).
    const all = [], inside = [];
    for (const k of backToFront) {
      const a = await j(page, IN.anchor(k));
      // On screen or not does not matter: A is brought into view after the move.
      if (!(a && a.visible && a.size > 8 && a.size < 600)) continue;
      all.push(k);
      if (a.inside) inside.push(k);
    }
    const usable = inside.length >= 2 ? inside : all;
    assert.ok(usable.length >= 2, `not enough visible objects in "${layer}": ${JSON.stringify(await Promise.all(backToFront.map(async (k) => [k, await j(page, IN.anchor(k))])))}`);
    const A = usable[0], B = usable[usable.length - 1];
    const bPose = items.find((i) => i.key === B).pose;

    // --- put A on top of B's place, with the number fields (2 undo steps) ---
    await page.eval(`document.querySelector('li.obj[data-key=${JSON.stringify(A)}]').click()`);
    await page.waitFor(`document.querySelectorAll('.card .num input').length >= 2`);
    await page.eval(`(() => { const ins = document.querySelectorAll('.card .num input');
      ins[0].value = ${bPose.p[0]}; ins[0].dispatchEvent(new Event('change'));
      ins[1].value = ${bPose.p[1]}; ins[1].dispatchEvent(new Event('change')); })()`);
    await sleep(200);
    // Picking it in the list again brings it into view (it moved away from where the view was).
    await page.eval(`document.querySelector('li.obj[data-key=${JSON.stringify(A)}]').click()`);
    await sleep(300);
    // Phone: the game frame is short (sheet open, ask strip and its line under
    // the game since the "apple" design pass) and a list pick no longer
    // recentres the view: when the other object is cut by the frame, show
    // everything and make the sheet shorter.
    {
      const b0 = await j(page, IN.anchor(B));
      const r = b0.rect, f0 = b0.frame;
      if (mobile && (r.y + r.h > f0.y + f0.h || r.y < f0.y || r.x < f0.x || r.x + r.w > f0.x + f0.w)) {
        // A fixed-size canvas (canvas-stars) cannot be panned: give the game
        // more height with a shorter sheet (View → sheet height), as a person would.
        await page.eval(`window.studioShell.actions.frameAll(); window.studioShell.setPrefs({ height: 30 })`);
        await sleep(600);
      }
    }
    await closeSheet();
    // Compare where both are drawn: the overlap of their rectangles, inside the game frame.
    const ra = (await j(page, IN.anchor(A))).rect, bAt = await j(page, IN.anchor(B)), rb = bAt.rect, fr = bAt.frame;
    const x0 = Math.max(ra.x, rb.x, fr.x), y0 = Math.max(ra.y, rb.y, fr.y);
    const x1 = Math.min(ra.x + ra.w, rb.x + rb.w, fr.x + fr.w), y1 = Math.min(ra.y + ra.h, rb.y + rb.h, fr.y + fr.h);
    assert.ok(x1 - x0 > 4 && y1 - y0 > 4, `"${A}" and "${B}" do not overlap on screen: ${JSON.stringify({ ra, rb })}`);
    const clip = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
    const zA0 = await zOf(A);
    const before = await pixels(clip);
    step(`"${A}" (back) placed on "${B}" (front)`);

    // --- To front: the picture changes, the list follows, Save counts it ---
    const saveBefore = await page.eval(IN.saveLabel);
    await press('[data-action=layer-toFront]');
    await page.waitFor(`(${IN.rows(layer)}).startsWith(${JSON.stringify(JSON.stringify([A]).slice(0, -1))})`, 5000);
    assert.equal(await zOf(A), Math.max(...(await list()).filter((i) => i.layer === layer).map((i) => i.pose.z)));
    const front = await pixels(clip);
    assert.notEqual(front, before, 'the picture did not change after "To front"');
    assert.notEqual(await page.eval(IN.saveLabel), saveBefore, 'Save count did not change');
    step(`"To front" → "${A}" drawn over "${B}", list top = ${A}, ${await page.eval(IN.saveLabel)}`);
    await page.eval(`document.querySelector('.panel').scrollTop = 0`); // phone: show the card with the buttons
    await shot('2-to-front');

    // --- undo / redo: one step each, exact ---
    await undo();
    await page.waitFor(`${DBG}.list().find(i => i.key === ${JSON.stringify(A)}).pose.z === ${zA0}`, 5000);
    assert.equal(await pixels(clip), before, 'undo did not restore the picture exactly');
    await redo();
    await page.waitFor(`(${IN.rows(layer)}).startsWith(${JSON.stringify(JSON.stringify([A]).slice(0, -1))})`, 5000);
    step('undo → back where it was (same picture) · redo → in front again');

    // --- PC shortcuts: ⌘[ one back, ⇧⌘] to the front again ---
    if (!mobile) {
      const zFront = await zOf(A);
      await key('[', 'BracketLeft', 4);
      assert.ok((await zOf(A)) < zFront, '⌘[ did not move it backward');
      assert.equal((await j(page, IN.rows(layer)))[1], A, '⌘[ should pass exactly one object');
      await key('}', 'BracketRight', 4 | 8);
      assert.equal(await zOf(A), zFront, '⇧⌘] did not bring it to the front');
      step('⌘[ → one back · ⇧⌘] → front');
    }

    // --- drag the grip in the list: two places down (mouse on PC, finger on phone) ---
    await openSheet();
    await page.eval(`document.querySelector('li.obj[data-key=${JSON.stringify(A)}]').scrollIntoView({ block: 'start' })`);
    await sleep(200);
    const geo = await j(page, `JSON.stringify((() => {
      const rows = [...document.querySelectorAll('li.obj[data-layer]')].filter(r => r.dataset.layer === ${JSON.stringify(layer)});
      const g = rows.find(r => r.dataset.key === ${JSON.stringify(A)}).querySelector('.grip').getBoundingClientRect();
      const others = rows.filter(r => r.dataset.key !== ${JSON.stringify(A)}).map(r => r.getBoundingClientRect());
      return { gx: g.left + g.width / 2, gy: g.top + g.height / 2, others: others.map(r => [r.top, r.bottom]) };
    })())`);
    const want = Math.min(2, geo.others.length);
    const dropY = want < geo.others.length ? (geo.others[want - 1][1] + geo.others[want][0]) / 2 : geo.others[want - 1][1] + 4;
    if (mobile) await page.touchDrag(geo.gx, geo.gy, geo.gx, dropY, 10);
    else await page.mouseDrag(geo.gx, geo.gy, geo.gx, dropY, 10);
    await page.waitFor(`JSON.parse(${IN.rows(layer)})[${want}] === ${JSON.stringify(A)}`, 5000);
    step(`dragged the grip ${want} places down (${mobile ? 'finger' : 'mouse'}) → ${(await j(page, IN.rows(layer))).join(' > ')}`);
    await shot('3-dragged');
    // --- "To back" stops in front of the ground / background (play test 2026-10-16:
    // a rock sent "to back" went behind the ground and vanished) ---
    {
      const now = (await list()).filter((i) => i.layer === layer);
      const grounds = now.filter((i) => i.backdrop);
      // Already at the back after the drag (a two-object list): the button is off, nothing to press.
      if (!(await page.eval(`document.querySelector('[data-action=layer-toBack]').disabled`))) await press('[data-action=layer-toBack]');
      const minZ = grounds.length ? Math.max(...grounds.map((i) => i.pose.z)) + 1 : Math.min(...now.map((i) => i.pose.z));
      await page.waitFor(`${DBG}.list().find(i => i.key === ${JSON.stringify(A)}).pose.z === ${minZ}`, 5000);
      if (grounds.length) {
        assert.ok(await page.eval(`!document.querySelector('li.obj[data-key=${JSON.stringify(grounds[0].key)}] .grip:not(.off)')`), 'the ground has a grip');
        assert.ok(await page.eval(`document.querySelector('[data-action=layer-backward]').disabled && document.querySelector('[data-action=layer-toBack]').disabled`), 'backward / to back still possible below the ground');
      }
      step(`"To back" → "${A}" at ${minZ}${grounds.length ? `, just in front of ${grounds.map((g) => `"${g.label}"`).join(', ')} (ground / background stays at the back)` : ''}`);
      await page.eval(`document.querySelector('.panel').scrollTop = 0`);
      await shot('4-to-back');
      if (grounds.length) {
        await page.eval(`document.querySelector('li.obj[data-key=${JSON.stringify(grounds[0].key)}]').click()`);
        await page.waitFor(`!!document.querySelector('.card .layer-fixed')`, 5000);
        step(`ground card: "${await page.eval(`document.querySelector('.card .layer-fixed').textContent`)}"`);
        await shot('5-ground-card');
        await page.eval(`document.querySelector('li.obj[data-key=${JSON.stringify(A)}]').click()`);
        await page.waitFor(`!!document.querySelector('[data-action=layer-toFront]')`, 5000);
      }
    }
    // Back to the front so the saved picture shows the change.
    await press('[data-action=layer-toFront]');
    await page.waitFor(`JSON.parse(${IN.rows(layer)})[0] === ${JSON.stringify(A)}`, 5000);

    // --- save: placement.json has the order ---
    const handed0 = lines.filter((l) => l.startsWith('studio: saved placement.json')).length;
    await press('[data-action=save]');
    const file = join(root, 'placement.json');
    // Wait for the hand-off itself (its stdout line): the draft is also written as you go, so it exists before.
    for (let i = 0; i < 50 && lines.filter((l) => l.startsWith('studio: saved placement.json')).length <= handed0; i++) await sleep(100);
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    const nowOrder = (await list()).filter((i) => i.layer === layer).sort((a, b) => a.pose.z - b.pose.z).map((i) => i.key);
    const entry = (saved.order || []).find((o) => o.in === layer);
    assert.ok(entry, `placement.json has no order for "${layer}": ${JSON.stringify(saved)}`);
    assert.deepEqual(entry.keys, nowOrder);
    assert.deepEqual(entry.was, backToFront);
    assert.equal(entry.keys[entry.keys.length - 1], A);
    assert.ok(lines.some((l) => l.startsWith('studio: saved placement.json') && l.includes('draw order changed')), lines.join('\n'));
    await page.waitFor(`!/\\(\\d/.test(${IN.saveLabel})`);
    step(`saved: order.${layer} = ${entry.keys.join(' < ')}`);
    await shot('4-saved');

    // --- reopen: the game applies placement.json (order included) itself ---
    await page.goto(srv.url);
    await page.waitFor(IN.ready, 30000);
    await sleep(800);
    if (mobile) {
      await press('[data-action=sheet]');
      await sleep(400);
    }
    assert.deepEqual(await j(page, IN.rows(layer)), nowOrder.slice().reverse(), 'reopened game does not show the saved order');
    assert.ok(!/\(\d/.test(await page.eval(IN.saveLabel)), `unsaved changes after reopening: ${await page.eval(IN.saveLabel)}`);
    step('reopened: the game drew the saved order, nothing unsaved');
    await shot('5-reopened');

    const errors = page.logs.filter((l) => l.startsWith('exception') || l.startsWith('error'));
    assert.deepEqual(errors, [], 'page errors');
  } catch (e) {
    console.log(page.logs.slice(-20).join('\n'));
    console.log(lines.join('\n'));
    if (SHOTS) writeFileSync(join(SHOTS, `layers-${tag}-FAIL.png`), await page.screenshot().catch(() => Buffer.alloc(0)));
    throw e;
  } finally {
    await page.close();
    await browser.close();
    await srv.close();
    rmSync(root, { recursive: true, force: true });
  }
}

for (const ex of EXAMPLES) {
  for (const layout of ['pc', 'phone']) {
    console.log(`${ex} · ${layout}`);
    await run(ex, layout);
  }
}
console.log('all passed');
