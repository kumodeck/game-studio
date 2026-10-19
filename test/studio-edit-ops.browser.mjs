// Copy, delete and several at once, end to end in a headless browser
// (CONTRACT.md §1.8): the real local server, the built shell and edit script,
// an example game with its adapter, and a small "AI" that puts the saved
// copies and deletions into the game's code.
//
//   node test/studio-edit-ops.browser.mjs [example ...] [--shots <dir>] [--lang ja]
//   (STUDIO_CDN_CACHE=<dir> answers cdn.jsdelivr.net from local copies, see cdp.mjs)
//
// For each example, at 1280×800 with a mouse and at 390×844 with touch:
//   1. copy an object (⌘D on PC, the card's Copy button on the phone) → a real
//      copy next to it, one Save count; copy the copy → same spacing again
//   2. delete another object (Delete key / button) → gone; undo → back; redo
//   3. select two objects (Shift+click on PC; "Select several" + taps on the
//      phone) and turn them a quarter with the rotate handle → both turn the
//      same and keep their distance (around the middle of the group)
//   4. undo / redo of the group turn is one step
//   5. save → placement.json has `added` (2), `removed` (1) and the 2 moves
//   6. the "AI": rewrites the game code for the copies and the deletion
//   7. reopen → the same arrangement, the copies are plain game objects now,
//      nothing unsaved
// Plus, once (PC): an adapter without clone()/remove() (dom-board) gets a
// see-through stand-in copy and a hidden deletion.
// Each example runs in a temporary copy of its folder. Exit 1 on failure.
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
const EXAMPLES = args.length ? args : ['three-crates', 'pixi-garden', 'canvas-stars'];
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DBG = `document.querySelector('iframe').contentWindow.__gameStudio._debug`;
const IN = {
  ready: `document.querySelectorAll('.obj').length > 0 && !!document.querySelector('iframe').contentWindow.__gameStudio?._debug`,
  list: `JSON.stringify(${DBG}.list())`,
  /** Pivot of an object in PAGE px (the iframe offset added). */
  at: (key) => `(() => { const f = document.querySelector('iframe').getBoundingClientRect(); const a = ${DBG}.anchor(${JSON.stringify(key)});
    return a ? JSON.stringify({ x: f.left + a.center[0], y: f.top + a.center[1], visible: a.visible, rect: a.rect }) : null; })()`,
  /** Centre of one handle button (page px), or null when hidden. */
  handle: (kind) => `(() => { const f = document.querySelector('iframe'); const host = f.contentDocument.querySelector('[data-studio-ui]');
    const b = host && host.shadowRoot.querySelector('[data-studio-handle=${kind}]'); if (!b || b.hidden) return null;
    const r = b.getBoundingClientRect(), o = f.getBoundingClientRect(); if (!r.width) return null;
    return JSON.stringify({ x: o.left + r.left + r.width / 2, y: o.top + r.top + r.height / 2 }); })()`,
  saveLabel: `[...document.querySelectorAll('[data-action=save]')].find(b => b.offsetParent)?.textContent || ''`,
  click: (sel) => `(() => { const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find(e => e.offsetParent); if (!el || el.disabled) return false; el.click(); return true; })()`,
  selected: `JSON.stringify([...document.querySelectorAll('li.obj[aria-selected=true]')].map(r => r.dataset.key))`,
};
const j = async (page, expr) => JSON.parse((await page.eval(expr)) || 'null');
// "Save · 3": the count of changes not saved (the button is hidden at 0).
const unsaved = (label) => Number((/(\d+)\s*$/.exec(label) || [])[1] || 0);

/**
 * The objects each example uses, and how the "AI" writes copies into its code.
 * copy: the object to copy (twice: the copy is copied again); del: the one to
 * delete; pair: the two turned together. All have stable names.
 */
const PLAN = {
  'three-crates': {
    copy: 'crate-1', del: 'lamp', pair: ['barrel', 'crate-2'],
    ai(code, file) {
      // Copies: written out one by one after the crates (the way the skill says for single objects).
      const lines = (file.added || []).map((a) => `{ const c = crate.scene.clone(); c.userData.studioKey = '${a.key}'; c.position.set(${a.p.join(', ')}); c.rotation.y = ${a.r ?? 0}; c.scale.setScalar(${typeof a.s === 'number' ? a.s : 1}); shadows(c); scene.add(c); crates.push(c); } // studio: copy of ${a.from}`);
      code = code.replace(/(\n\nconst barrel1 = )/, `\n${lines.join('\n')}$1`);
      for (const r of file.removed || []) {
        assert.equal(r.key, 'lamp');
        code = code.replace('scene.add(lamp.scene);\n', '// studio: lamp deleted\n');
      }
      return code;
    },
  },
  'pixi-garden': {
    copy: 'house', del: 'flower-by-rock', pair: ['house', 'tree'],
    ai(code, file) {
      const tex = { house: 'house', tree: 'tree' };
      const lines = (file.added || []).map((a) => {
        const kind = tex[a.from] || tex[a.from.replace(/-\d+$/, '')];
        return `{ const c = sprite('${kind}', ${a.p[0]}, ${a.p[1]}, '${a.key}'); c.studioKey = '${a.key}'; c.rotation = ${a.r ?? 0}; c.scale.set(${typeof a.s === 'number' ? a.s : 1});`
          + ` const after = app.stage.children.find((o) => o.studioKey === '${a.from}' || (!o.studioKey && o.label === '${a.from}')); app.stage.addChildAt(c, app.stage.getChildIndex(after) + 1); } // studio: copy of ${a.from}`;
      });
      code = code.replace(/(app\.stage\.addChild\(bg[^\n]*\n)/, `$1${lines.join('\n')}\n`);
      for (const r of file.removed || []) {
        assert.equal(r.key, 'flower-by-rock');
        code = code.replace('rock, flower, fence', 'rock, fence');
      }
      return code;
    },
  },
  'canvas-stars': {
    copy: 'star-1', del: 'star-3', pair: ['basket', 'star-2'],
    ai(code, file) {
      // The things live in one array: copies become new entries right after their original.
      const lines = code.split('\n');
      for (const a of file.added || []) {
        const at = lines.findIndex((l) => l.includes(`name: '${a.from}'`) || l.includes(`key: '${a.from}'`));
        assert.ok(at >= 0, `no line for ${a.from}`);
        const line = lines[at]
          .replace(/name: '[^']*'|key: '[^']*'/, `key: '${a.key}'`)
          .replace(/x: [-\d.]+/, `x: ${a.p[0]}`).replace(/y: [-\d.]+/, `y: ${a.p[1]}`)
          .replace(/angle: [-\d.]+/, `angle: ${a.r ?? 0}`).replace(/scale: [-\d.]+/, `scale: ${typeof a.s === 'number' ? a.s : 1}`)
          .replace(/\/\/.*$/, '// studio: copy');
        lines.splice(at + 1, 0, line);
      }
      for (const r of file.removed || []) {
        const at = lines.findIndex((l) => l.includes(`name: '${r.key}'`));
        assert.ok(at >= 0, `no line for ${r.key}`);
        lines.splice(at, 1);
      }
      return lines.join('\n');
    },
  },
};

async function run(example, layout) {
  const mobile = layout === 'phone';
  const plan = PLAN[example];
  const tag = `${example}-${mobile ? '390' : '1280'}${LANG ? `-${LANG}` : ''}`;
  const root = mkdtempSync(join(tmpdir(), `studio-ops-${example}-`));
  cpSync(join(PKG, 'examples', example), root, { recursive: true });
  rmSync(join(root, 'placement.json'), { force: true });
  if (LANG) {
    mkdirSync(join(root, '.studio/ui'), { recursive: true });
    writeFileSync(join(root, '.studio/ui/prefs.json'), JSON.stringify({ version: 1, lang: LANG }));
  }
  const lines = [];
  const srv = await startStudioServer({ root, uiDir: join(PKG, 'skills/arrange/bin/studio-ui'), log: (l) => lines.push(l) });
  const browser = await launch();
  const page = await newPage(browser, { ...(mobile ? { width: 390, height: 844, mobile: true } : { width: 1280, height: 800 }), cdnCache: process.env.STUDIO_CDN_CACHE });
  const step = (name) => console.log(`  ✓ ${tag}: ${name}`);
  const shot = async (name) => {
    if (!SHOTS) return;
    await sleep(400);
    writeFileSync(join(SHOTS, `edit-ops-${tag}-${name}.png`), await page.screenshot());
  };
  const list = async () => JSON.parse(await page.eval(IN.list));
  const poseOf = async (key) => (await list()).find((i) => i.key === key)?.pose;
  const press = async (sel) => assert.ok(await page.eval(IN.click(sel)), `no enabled ${sel}`);
  /** Press one object's row in the list (opening "name ×N" groups first: their heading selects them all). */
  const pickRow = (key) => page.eval(`(() => {
    const K = ${JSON.stringify(JSON.stringify(key))};
    const find = () => document.querySelector('li.obj.sub[data-key=' + K + ']') || document.querySelector('li.obj:not(.group-row)[data-key=' + K + ']');
    if (!find()) document.querySelectorAll('li.obj .expand[aria-expanded=false]').forEach((b) => b.click());
    find().click();
  })()`);
  const key = async (k, code, modifiers = 0, vk = 0) => {
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, modifiers, windowsVirtualKeyCode: vk });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, modifiers, windowsVirtualKeyCode: vk });
    await sleep(250);
  };
  const MOD = process.platform === 'darwin' ? 4 : 2; // meta / ctrl
  // Undo / redo (rebrand 2026-10-16: no toolbar buttons on PC): ⌘Z / ⇧⌘Z there; on a
  // phone Undo is in the top bar and Redo a row of the ⌘K list (press the ask field).
  const undo = async () => {
    if (mobile) await press('[data-action=undo]');
    else await key('z', 'KeyZ', MOD, 90);
    await sleep(150);
  };
  const redo = async () => {
    if (mobile) {
      await page.eval(`(() => { const i = document.querySelector('.ask-input'); i.focus(); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true })); })()`);
      await sleep(100);
      await press('.palette [data-action=redo]');
    } else await key('Z', 'KeyZ', MOD | 8, 90);
    await sleep(150);
  };
  /** Press on an object in the game: mouse click (Shift optional) or a finger tap. */
  const pressObject = async (k, shift = false) => {
    let a = await j(page, IN.at(k));
    assert.ok(a && a.visible, `"${k}" is not on screen`);
    // The pivot can sit just outside the game frame (a basket standing on the
    // bottom edge of a fixed-size canvas, with the toolbar and the ask strip
    // taking height since the "apple" design pass): press the middle of the
    // part of the object that is on screen instead.
    const f = await j(page, `JSON.stringify(document.querySelector('iframe').getBoundingClientRect())`);
    if (a.rect && (a.x < f.left || a.x > f.right || a.y < f.top || a.y > f.bottom)) {
      const x0 = Math.max(f.left, f.left + a.rect.x), x1 = Math.min(f.right, f.left + a.rect.x + a.rect.w);
      const y0 = Math.max(f.top, f.top + a.rect.y), y1 = Math.min(f.bottom, f.top + a.rect.y + a.rect.h);
      assert.ok(x1 - x0 > 4 && y1 - y0 > 4, `"${k}" is not on screen: ${JSON.stringify({ a, f })}`);
      a = { ...a, x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
    }
    if (mobile) return page.tap(a.x, a.y);
    const m = shift ? 8 : 0;
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: a.x, y: a.y, modifiers: m });
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: a.x, y: a.y, button: 'left', buttons: 1, clickCount: 1, modifiers: m });
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: a.x, y: a.y, button: 'left', buttons: 0, clickCount: 1, modifiers: m });
    await sleep(250);
  };
  /** Drag along a path of page points (mouse or one finger). */
  const dragPath = async (pts) => {
    const [p0] = pts;
    if (mobile) {
      await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p0.x, y: p0.y, id: 1 }] });
      for (const p of pts.slice(1)) await page.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p.x, y: p.y, id: 1 }] });
      await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p0.x, y: p0.y });
      await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p0.x, y: p0.y, button: 'left', buttons: 1, clickCount: 1 });
      for (const p of pts.slice(1)) await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'left', buttons: 1 });
      const l = pts[pts.length - 1];
      await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: l.x, y: l.y, button: 'left', buttons: 0, clickCount: 1 });
    }
    await sleep(300);
  };
  const openSheet = async () => {
    if (!mobile) return;
    if (await page.eval(`document.querySelector('.shell').dataset.sheet === 'open'`)) return;
    await press('[data-action=sheet]');
    await sleep(500);
  };
  const closeSheet = async () => {
    if (!mobile) return;
    if (await page.eval(`document.querySelector('.shell').dataset.sheet !== 'open'`)) return;
    await press('[data-action=sheet]');
    await sleep(500);
  };
  try {
    await page.goto(srv.url);
    await page.waitFor(IN.ready, 40000);
    for (let i = 0; i < 60 && !lines.some((l) => l.startsWith('studio: check ')); i++) await sleep(100);
    assert.ok(lines.some((l) => l.startsWith('studio: check ok')), `self-check: ${lines.filter((l) => l.startsWith('studio: check')).join(' | ')}`);
    await sleep(500);
    const start = await list();
    const keys0 = new Set(start.map((i) => i.key));
    for (const k of [plan.copy, plan.del, ...plan.pair]) assert.ok(keys0.has(k), `${example} has no "${k}": ${[...keys0].join(', ')}`);

    // --- 0. a "name ×N" heading selects the whole group ---
    const groupRow = await page.eval(`(() => { const r = document.querySelector('li.obj.group-row'); return r ? JSON.stringify({ key: r.dataset.key, n: Number(r.querySelector('.count').textContent.replace(/\D/g, '')) }) : null; })()`);
    if (groupRow) {
      await openSheet();
      const g = JSON.parse(groupRow);
      await page.eval(`document.querySelector('li.obj.group-row[data-key=${JSON.stringify(g.key)}]').click()`);
      await page.waitFor(`document.querySelectorAll('.card .group-head').length === 1`, 5000);
      assert.equal(JSON.parse(await page.eval(IN.selected)).length >= g.n, true, 'every member is marked selected');
      step(`the "×${g.n}" heading selects all ${g.n}`);
      await shot('0-group-heading');
    }

    // --- 1. copy, then copy the copy: same spacing, real objects, one Save count each ---
    await openSheet();
    await pickRow(plan.copy);
    await page.waitFor(`!!document.querySelector('.card [data-action=copy]')`);
    await shot('1-selected');
    if (mobile) await press('.card [data-action=copy]');
    else await key('d', 'KeyD', MOD, 68);
    await page.waitFor(`${DBG}.list().some(i => i.copyOf === ${JSON.stringify(plan.copy)})`, 5000);
    const c1 = (await list()).find((i) => i.copyOf === plan.copy);
    assert.ok(!c1.ghost, 'the adapter makes real copies');
    const p0 = (await poseOf(plan.copy)).p;
    assert.ok(Math.hypot(...c1.pose.p.map((v, i) => v - p0[i])) > 0.1, 'the copy sits next to the original, not on it');
    assert.equal(unsaved(await page.eval(IN.saveLabel)), 1);
    // The copy is really DRAWN (a Pixi object added while frozen once stayed invisible
    // although every number was right): its spot looks different without it.
    // Undo takes the copy away, redo brings it back.
    // The phone's list sheet and the card float over the game since the rebrand: out of the way
    // first, and nothing picked (the picked copy's orange outline and name tag are not the copy).
    await closeSheet();
    await page.eval(`window.studioShell.actions.select(null)`);
    await sleep(300);
    const r1 = (await j(page, IN.at(c1.key))).rect;
    const fr = await j(page, `JSON.stringify(document.querySelector('iframe').getBoundingClientRect())`);
    const clip = { x: fr.left + Math.max(0, r1.x), y: fr.top + Math.max(0, r1.y), width: Math.max(4, Math.min(r1.w, fr.width - r1.x)), height: Math.max(4, Math.min(r1.h, fr.height - r1.y)), scale: 1 };
    const shotAt = async () => (await sleep(300), (await page.send('Page.captureScreenshot', { format: 'png', clip })).data);
    const withCopy = await shotAt();
    await undo();
    await page.waitFor(`!${DBG}.list().some(i => i.key === ${JSON.stringify(c1.key)})`, 5000);
    assert.equal(unsaved(await page.eval(IN.saveLabel)), 0, 'undo of the copy leaves nothing to save');
    assert.notEqual(await shotAt(), withCopy, 'the copy is not drawn in the game');
    await redo();
    await page.waitFor(`${DBG}.list().some(i => i.key === ${JSON.stringify(c1.key)})`, 5000);
    // Redo picks the copy again: compare without the outline, as above.
    await page.eval(`window.studioShell.actions.select(null)`);
    assert.equal(await shotAt(), withCopy, 'redo brings the same copy back to the same place');
    assert.equal(unsaved(await page.eval(IN.saveLabel)), 1);
    step('the copy is drawn · undo removes it · redo brings it back');
    if (mobile) await openSheet();
    await pickRow(c1.key);
    // The copy is selected: copy again.
    await page.waitFor(`document.querySelector('li.obj[data-key=${JSON.stringify(c1.key)}][aria-selected=true]') || document.querySelector('.card .key')?.textContent === ${JSON.stringify(c1.key)} || [...document.querySelectorAll('.card strong')].some(s => s.textContent === ${JSON.stringify(c1.key)})`, 5000);
    if (mobile) await press('.card [data-action=copy]');
    else await key('d', 'KeyD', MOD, 68);
    await page.waitFor(`${DBG}.list().some(i => i.copyOf === ${JSON.stringify(c1.key)})`, 5000);
    const c2 = (await list()).find((i) => i.copyOf === c1.key);
    const gap1 = c1.pose.p.map((v, i) => v - p0[i]);
    const gap2 = c2.pose.p.map((v, i) => v - c1.pose.p[i]);
    gap1.forEach((g, i) => assert.ok(Math.abs(g - gap2[i]) < 0.05, `same spacing: ${gap1} vs ${gap2}`));
    assert.equal(unsaved(await page.eval(IN.saveLabel)), 2);
    step(`copied "${plan.copy}" → ${c1.key}, then → ${c2.key} at the same spacing (${gap1.map((v) => v.toFixed(2)).join(', ')})`);
    await closeSheet();
    await shot('2-copied');

    // --- 2. delete: gone, undo brings it back, redo deletes again ---
    await openSheet();
    await pickRow(plan.del);
    await page.waitFor(`!!document.querySelector('.card [data-action=remove]')`);
    const delPose = await poseOf(plan.del);
    if (mobile) await press('.card [data-action=remove]');
    else await key('Backspace', 'Backspace', 0, 8);
    await page.waitFor(`!${DBG}.list().some(i => i.key === ${JSON.stringify(plan.del)})`, 5000);
    assert.equal(await page.eval(`!!document.querySelector('li.obj[data-key=${JSON.stringify(plan.del)}]')`), false, 'still in the list');
    assert.equal(unsaved(await page.eval(IN.saveLabel)), 3);
    await undo();
    await page.waitFor(`${DBG}.list().some(i => i.key === ${JSON.stringify(plan.del)})`, 5000);
    assert.deepEqual(await poseOf(plan.del), delPose, 'undo puts it back exactly');
    await redo();
    await page.waitFor(`!${DBG}.list().some(i => i.key === ${JSON.stringify(plan.del)})`, 5000);
    step(`deleted "${plan.del}" (${mobile ? 'button' : 'Delete key'}) · undo → back where it was · redo → gone`);

    // --- 3. two objects together: select both, turn a quarter with the rotate handle ---
    const [A, B] = plan.pair;
    await closeSheet();
    // Picking a row brings that object into view; show everything again before pressing in the game.
    await page.eval(`window.studioShell.actions.frameAll()`);
    await sleep(500);
    if (mobile) {
      // Multi-select is in "…" (the ⌘K list) on a phone since plan 1 (2026-10-18): the sheet's head has "Grid" in its
      // place, and shows "Done" only while picking several.
      await openSheet();
      await press('.sheet-more');
      await press('.palette [data-action=multi]');
      await closeSheet();
      await pressObject(A);
      await pressObject(B);
    } else {
      await pressObject(A);
      await pressObject(B, true);
    }
    await page.waitFor(`document.querySelector('iframe').contentWindow.__gameStudio && document.querySelectorAll('.card .group-head').length === 1`, 5000).catch(async (e) => {
      throw new Error(`no group card (selected: ${await page.eval(IN.selected)})\n${e.message}`);
    });
    if (mobile) {
      // "Select several" off again so later taps select one object.
      await openSheet();
      await press('[data-action=multi]');
      await closeSheet();
    }
    await shot('3-two-selected');
    const before = await list();
    const pa = before.find((i) => i.key === A).pose, pb = before.find((i) => i.key === B).pose;
    const sa = await j(page, IN.at(A)), sb = await j(page, IN.at(B));
    const h = await j(page, IN.handle('rotate'));
    assert.ok(h, 'no rotate handle under the group');
    // Group middle on screen = middle of the two rectangles together.
    const box = [sa.rect, sb.rect].reduce((u, r) => ({ x0: Math.min(u.x0, r.x), y0: Math.min(u.y0, r.y), x1: Math.max(u.x1, r.x + r.w), y1: Math.max(u.y1, r.y + r.h) }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
    const f = await j(page, `JSON.stringify(document.querySelector('iframe').getBoundingClientRect())`);
    const C = { x: f.left + (box.x0 + box.x1) / 2, y: f.top + (box.y0 + box.y1) / 2 };
    const R = Math.hypot(h.x - C.x, h.y - C.y), a0 = Math.atan2(h.y - C.y, h.x - C.x);
    const pts = [];
    for (let i = 0; i <= 12; i++) pts.push({ x: C.x + R * Math.cos(a0 + (Math.PI / 2) * (i / 12)), y: C.y + R * Math.sin(a0 + (Math.PI / 2) * (i / 12)) });
    await dragPath(pts);
    const after = await list();
    const qa = after.find((i) => i.key === A).pose, qb = after.find((i) => i.key === B).pose;
    const wrap = (x) => Math.atan2(Math.sin(x), Math.cos(x));
    const da = wrap((qa.r ?? 0) - (pa.r ?? 0)), db = wrap((qb.r ?? 0) - (pb.r ?? 0));
    assert.ok(Math.abs(Math.abs(da) - Math.PI / 2) < 0.02, `"${A}" turned ${da} rad, want a quarter`);
    assert.ok(Math.abs(da - db) < 0.02, `both turn the same (${da} vs ${db})`);
    const dist = (p, q) => Math.hypot(p.p[0] - q.p[0], p.p[p.p.length - 1] - q.p[q.p.length - 1]);
    assert.ok(Math.abs(dist(pa, pb) - dist(qa, qb)) < dist(pa, pb) * 0.02 + 0.05, `distance kept: ${dist(pa, pb)} → ${dist(qa, qb)}`);
    assert.ok(Math.hypot(qa.p[0] - pa.p[0], qa.p[qa.p.length - 1] - pa.p[pa.p.length - 1]) > 0.05, 'positions turned around the middle too');
    step(`"${A}" + "${B}" turned together by ${(da * 180 / Math.PI).toFixed(0)}°, distance kept`);
    await shot('4-turned');

    // --- 4. the group turn is ONE undo step ---
    const n = unsaved(await page.eval(IN.saveLabel));
    await undo();
    await page.waitFor(`${DBG}.list().find(i => i.key === ${JSON.stringify(A)}).pose.r === ${pa.r ?? 0}`, 5000);
    assert.deepEqual((await list()).find((i) => i.key === B).pose, pb, 'one undo puts both back');
    await redo();
    await page.waitFor(`Math.abs(${DBG}.list().find(i => i.key === ${JSON.stringify(B)}).pose.r - ${qb.r}) < 1e-6`, 5000);
    assert.equal(unsaved(await page.eval(IN.saveLabel)), n);
    step('undo → both back · redo → both turned (one step)');

    // --- 5. save ---
    const handed0 = lines.filter((l) => l.startsWith('studio: saved placement.json')).length;
    await press('[data-action=save]');
    const file = join(root, 'placement.json');
    // Wait for the hand-off itself (its stdout line): the draft is also written as you go, so it exists before.
    for (let i = 0; i < 50 && lines.filter((l) => l.startsWith('studio: saved placement.json')).length <= handed0; i++) await sleep(100);
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    assert.deepEqual(saved.added.map((a) => [a.key, a.from]), [[c1.key, plan.copy], [c2.key, c1.key]]);
    assert.deepEqual(saved.removed.map((r) => r.key), [plan.del]);
    assert.ok(saved.objects[A] && saved.objects[B], 'both turned objects are in objects');
    assert.ok(lines.some((l) => l.startsWith('studio: saved placement.json') && l.includes('2 copies added') && l.includes('1 deleted')), lines.join('\n'));
    await page.waitFor(`!/\\d\\s*$/.test(${IN.saveLabel})`);
    step(`saved: added ${saved.added.map((a) => a.key).join(', ')} · removed ${plan.del} · moved ${Object.keys(saved.objects).join(', ')}`);
    await shot('5-saved');
    const arranged = new Map((await list()).map((i) => [i.key, i.pose]));

    // --- 6. the "AI" puts the copies and the deletion into the code ---
    const gameFile = join(root, 'game.js');
    const code = plan.ai(readFileSync(gameFile, 'utf8'), saved);
    writeFileSync(gameFile, code);
    // Then it takes them out of placement.json (the skill: the file keeps only what the code does not do yet).
    const rest = { ...saved };
    delete rest.added;
    delete rest.removed;
    writeFileSync(file, JSON.stringify(rest, null, 2) + '\n');
    step('AI: copies and deletion written into game.js');

    // --- 7. reopen: the same arrangement, from the code ---
    await page.goto(srv.url);
    await page.waitFor(IN.ready, 40000);
    await sleep(1200);
    const reopened = await list();
    const now = new Map(reopened.map((i) => [i.key, i]));
    assert.ok(!now.has(plan.del), `"${plan.del}" is back after reopening`);
    for (const k of [c1.key, c2.key]) {
      assert.ok(now.has(k), `copy "${k}" missing after reopening`);
      assert.equal(now.get(k).copyOf, undefined, `"${k}" should be a plain game object now`);
    }
    const tol = example.startsWith('three') ? 0.01 : 2;
    // Exact for everything the person touched; the others only have to be there (the 2D
    // examples keep animating until the editor freezes them: a drifting cloud, falling stars).
    const touched = new Set([plan.copy, c1.key, c2.key, A, B]);
    for (const [k, p] of arranged) {
      if (k.startsWith('path:')) continue; // tree positions shift when code adds objects (the skill says so)
      if (!touched.has(k)) {
        assert.ok(now.has(k), `"${k}" missing after reopening`);
        continue;
      }
      const q = now.get(k)?.pose;
      assert.ok(q, `"${k}" missing after reopening`);
      p.p.forEach((v, i) => assert.ok(Math.abs(v - q.p[i]) < tol, `"${k}" moved: ${p.p} → ${q.p}`));
      // 2D examples keep animating until the editor freezes them (falling, spinning stars): a little slack.
      assert.ok(Math.abs(wrap((p.r ?? 0) - (q.r ?? 0))) < (example.startsWith('three') ? 0.01 : 0.05), `"${k}" turned: ${p.r} → ${q.r}`);
    }
    assert.ok(!/\d\s*$/.test(await page.eval(IN.saveLabel)), `unsaved after reopening: ${await page.eval(IN.saveLabel)}`);
    step('reopened: same arrangement, copies are game objects, nothing unsaved');
    await shot('6-reopened');

    const errors = page.logs.filter((l) => l.startsWith('exception') || l.startsWith('error'));
    assert.deepEqual(errors, [], 'page errors');
  } catch (e) {
    console.log(page.logs.slice(-20).join('\n'));
    console.log(lines.join('\n'));
    if (SHOTS) writeFileSync(join(SHOTS, `edit-ops-${tag}-FAIL.png`), await page.screenshot().catch(() => Buffer.alloc(0)));
    throw e;
  } finally {
    await page.close();
    await browser.close();
    await srv.close();
    rmSync(root, { recursive: true, force: true });
  }
}

/** An adapter without clone()/remove(): stand-in copy (see-through picture) and a hidden deletion. */
async function standIns() {
  const example = 'dom-board';
  const root = mkdtempSync(join(tmpdir(), `studio-ops-${example}-`));
  cpSync(join(PKG, 'examples', example), root, { recursive: true });
  rmSync(join(root, 'placement.json'), { force: true });
  if (LANG) {
    mkdirSync(join(root, '.studio/ui'), { recursive: true });
    writeFileSync(join(root, '.studio/ui/prefs.json'), JSON.stringify({ version: 1, lang: LANG }));
  }
  const lines = [];
  const srv = await startStudioServer({ root, uiDir: join(PKG, 'skills/arrange/bin/studio-ui'), log: (l) => lines.push(l) });
  const browser = await launch();
  const page = await newPage(browser, { width: 1280, height: 800 });
  try {
    await page.goto(srv.url);
    await page.waitFor(IN.ready, 30000);
    // The self-check moves one object for a moment: read the list after it.
    for (let i = 0; i < 60 && !lines.some((l) => l.startsWith('studio: check ')); i++) await sleep(100);
    await sleep(300);
    const items = JSON.parse(await page.eval(IN.list));
    const [a, b] = items;
    await page.eval(`document.querySelector('li.obj[data-key=${JSON.stringify(a.key)}]').click()`);
    await page.waitFor(`!!document.querySelector('.card [data-action=copy]')`);
    await page.eval(IN.click('.card [data-action=copy]'));
    await page.waitFor(`${DBG}.list().some(i => i.ghost)`, 5000);
    const ghost = JSON.parse(await page.eval(IN.list)).find((i) => i.ghost);
    const orig = JSON.parse(await page.eval(IN.list)).find((i) => i.key === a.key);
    assert.deepEqual(orig.pose, a.pose, 'the original did not move');
    await page.waitFor(`(() => { const host = document.querySelector('iframe').contentDocument.querySelector('[data-studio-ui]'); return host && host.shadowRoot.querySelectorAll('.ghost').length === 1; })()`, 5000);
    assert.ok(await page.eval(`!!document.querySelector('li.obj[data-key=${JSON.stringify(ghost.key)}] .tag.ghost')`), 'the list marks it as a stand-in');
    console.log(`  ✓ ${example}: no clone() → stand-in copy ${ghost.key} drawn see-through, original untouched`);
    if (SHOTS) {
      await sleep(400);
      writeFileSync(join(SHOTS, `edit-ops-${example}-1280${LANG ? `-${LANG}` : ''}-standin.png`), await page.screenshot());
    }
    await page.eval(`document.querySelector('li.obj[data-key=${JSON.stringify(b.key)}]').click()`);
    await page.waitFor(`!!document.querySelector('.card [data-action=remove]')`);
    await page.eval(IN.click('.card [data-action=remove]'));
    await page.waitFor(`!${DBG}.list().some(i => i.key === ${JSON.stringify(b.key)})`, 5000);
    // ⌘Z (PC, no toolbar Undo since the rebrand).
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'z', code: 'KeyZ', modifiers: process.platform === 'darwin' ? 4 : 2, windowsVirtualKeyCode: 90 });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'z', code: 'KeyZ', modifiers: process.platform === 'darwin' ? 4 : 2, windowsVirtualKeyCode: 90 });
    await page.waitFor(`${DBG}.list().some(i => i.key === ${JSON.stringify(b.key)})`, 5000);
    assert.deepEqual(JSON.parse(await page.eval(IN.list)).find((i) => i.key === b.key).pose, b.pose, 'undo of a hidden deletion is exact');
    const handed0 = lines.filter((l) => l.startsWith('studio: saved placement.json')).length;
    await page.eval(IN.click('[data-action=save]'));
    const file = join(root, 'placement.json');
    // Wait for the hand-off itself (its stdout line): the draft is also written as you go, so it exists before.
    for (let i = 0; i < 50 && lines.filter((l) => l.startsWith('studio: saved placement.json')).length <= handed0; i++) await sleep(100);
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    assert.deepEqual(saved.added.map((x) => x.from), [a.key]);
    console.log(`  ✓ ${example}: no remove() → hidden, undo exact · saved added = ${saved.added[0].key}`);
  } finally {
    await page.close();
    await browser.close();
    await srv.close();
    rmSync(root, { recursive: true, force: true });
  }
}

// dom-board is the stand-in check (its adapter has no clone()/remove()); it runs with the default set.
for (const ex of EXAMPLES.filter((e) => e !== 'dom-board')) {
  for (const layout of ['pc', 'phone']) {
    console.log(`${ex} · ${layout}`);
    await run(ex, layout);
  }
}
if (!args.length || EXAMPLES.includes('dom-board')) {
  console.log('dom-board · pc (stand-ins)');
  await standIns();
}
console.log('all passed');
