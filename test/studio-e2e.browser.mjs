// End-to-end check of the whole studio in a headless browser: the real local
// server, the built shell and edit script, an example game and its adapter.
//
//   node test/studio-e2e.browser.mjs [example ...] [--shots <dir>]
//
// For each example, at 1280×800 with a mouse and at 390×844 with touch:
// select an object, move / rotate / resize it with its tool strip, drag the
// picked object itself, look around, undo / redo, the change written to
// placement.json as a draft (quietly, nothing on screen), Save (the request and the
// stdout line, then "✓ Saved"), switch to Assets, open a next step from the ⌘K list and hand
// it to the AI (.studio/next-step.md). Each example runs in
// a temporary copy of its folder, so the repository is never written to.
//
// Uses the zero-dependency CDP client from the 2D adapter tests. Exit code 1
// on the first failed expectation.
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
const EXAMPLES = args.length ? args : ['phaser-garden'];
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Code run inside the shell page. `G` = the game window inside the iframe.
const IN = {
  ready: `document.querySelectorAll('.obj').length > 0 && !!document.querySelector('iframe').contentWindow.__gameStudio?._debug`,
  list: `JSON.stringify(document.querySelector('iframe').contentWindow.__gameStudio._debug.list())`,
  /** Screen point of an object's pivot in shell-page coordinates. */
  anchor: (key) => `(() => { const f = document.querySelector('iframe'); const r = f.getBoundingClientRect();
    const a = f.contentWindow.__gameStudio._debug.anchor(${JSON.stringify(key)}); if (!a) return null;
    return JSON.stringify({ x: r.left + a.center[0], y: r.top + a.center[1], pose: a.pose, size: a.size, rect: a.rect }); })()`,
  handle: (kind) => `(() => { const f = document.querySelector('iframe'); const r = f.getBoundingClientRect();
    const b = f.contentDocument.querySelector('[data-studio-ui]')?.shadowRoot?.querySelector('[data-studio-handle=${kind}]');
    if (!b || b.hidden || b.offsetParent === null && getComputedStyle(b).display === 'none') return null;
    const q = b.getBoundingClientRect(); if (!q.width) return null;
    return JSON.stringify({ x: r.left + q.left + q.width / 2, y: r.top + q.top + q.height / 2 }); })()`,
  view: `JSON.stringify(document.querySelector('iframe').contentWindow.__gameStudio._debug.view())`,
  selectedName: `document.querySelector('.card strong')?.textContent || ''`,
  saveLabel: `[...document.querySelectorAll('[data-action=save]')].find(b => b.offsetParent)?.textContent || ''`,
  click: (sel) => `(() => { const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find(e => e.offsetParent); if (!el) return false; el.click(); return true; })()`,
  /** Open the ⌘K list (press the ask field) and press one of its rows. */
  palette: (action) => `(async () => { const i = document.querySelector('.ask-input'); i.focus(); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true })); await new Promise((r) => setTimeout(r, 50));
    const el = [...document.querySelectorAll('.palette [data-action=${action}]')].find(e => e.offsetParent); if (!el) return false; el.click(); return true; })()`,
};

const j = async (page, expr) => JSON.parse((await page.eval(expr)) || 'null');

async function shot(page, name) {
  if (!SHOTS) return;
  await sleep(250);
  writeFileSync(join(SHOTS, `${name}.png`), await page.screenshot());
}

/** Pick a mid-sized, visible, named object to edit. */
async function pickTarget(page) {
  const items = JSON.parse(await page.eval(IN.list));
  const scored = [];
  for (const it of items) {
    const a = await j(page, IN.anchor(it.key));
    if (!a || a.size < 8 || a.size > 300) continue;
    if (a.x < 12 || a.y < 12) continue;
    scored.push({ key: it.key, label: it.label, a, score: Math.abs(a.size - 80) + (it.unstable ? 1000 : 0) });
  }
  scored.sort((p, q) => p.score - q.score);
  assert.ok(scored.length, 'no suitable object to edit');
  return scored[0];
}

const poseOf = async (page, key) => (await j(page, IN.anchor(key))).pose;
const near = (a, b, eps = 1e-6) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= eps);

async function run(example, layout) {
  const mobile = layout === 'phone';
  const tag = `${example}-${mobile ? '390' : '1280'}`;
  const root = mkdtempSync(join(tmpdir(), `studio-e2e-${example}-`));
  cpSync(join(PKG, 'examples', example), root, { recursive: true });
  const lines = [];
  const srv = await startStudioServer({ root, uiDir: join(PKG, 'skills/arrange/bin/studio-ui'), log: (l) => lines.push(l) });
  const browser = await launch();
  const page = await newPage(browser, mobile ? { width: 390, height: 844, mobile: true } : { width: 1280, height: 800 });
  const drag = (x0, y0, x1, y1, steps = 8) => (mobile ? page.touchDrag(x0, y0, x1, y1, steps) : page.mouseDrag(x0, y0, x1, y1, steps));
  const press = (x, y) => (mobile ? page.tap(x, y) : page.click(x, y));
  const step = (name) => console.log(`  ✓ ${tag}: ${name}`);
  try {
    await page.goto(srv.url);
    await page.waitFor(IN.ready, 30000);
    step(`opened (${JSON.parse(await page.eval(IN.list)).length} objects)`);
    // The adapter self-check ran and found nothing to fix (no warning banner, server got "check ok").
    for (let i = 0; i < 30 && !lines.some((l) => l.startsWith('studio: check ')); i++) await sleep(100);
    assert.ok(lines.some((l) => l.startsWith('studio: check ok')), `self-check: ${lines.filter((l) => l.startsWith('studio: check')).join(' | ') || 'not reported'}`);
    assert.equal(await page.eval(`!!document.querySelector('.status.warn')`), false, 'warning banner shown');
    step('adapter self-check ok');
    await shot(page, `${tag}-1-open`);

    // --- select by pressing the object in the game ---
    let target = await pickTarget(page);
    await press(target.a.x, target.a.y);
    await page.waitFor(`!!(${IN.handle('move')})`);
    // Stacked objects: the press may pick the one in front (nearest/smallest
    // first, by design). Continue with whatever was selected.
    await page.waitFor(`(${IN.selectedName}) !== ''`, 3000);
    // Read the picked key from the shell itself. The card shows the name a person reads ("tree 2",
    // "rock" for an unnamed rock.svg) and no longer the key (polish pass: no `tree#2` / `path:6` on
    // screen), so matching the card text against the adapter's labels no longer finds the object.
    const picked = await page.eval(`window.studioShell.selected() || ''`);
    if (picked !== target.key) {
      const it = JSON.parse(await page.eval(IN.list)).find((i) => i.key === picked);
      assert.ok(it, `picked "${picked}" is not in the object list`);
      target = { key: it.key, label: it.label, a: await j(page, IN.anchor(it.key)) };
    }
    const from = target.a.pose;
    // The card (PC: top right; phone: above the ask bar) names what is picked: its label, "tree 2" for the
    // second `tree` (key `tree#2`), never a key such as `tree#2` or `path:6`.
    const nth = /^(.*)#(\d+)$/.exec(target.key);
    const shown = nth && nth[2] !== '1' && nth[1] === target.label ? `${target.label} ${nth[2]}` : target.label;
    const unnamed = JSON.parse(await page.eval(IN.list)).find((i) => i.key === target.key)?.unstable;
    if (unnamed) await page.waitFor(`(() => { const n = ${IN.selectedName}; return n !== '' && !/#\\d|path:/.test(n); })()`, 3000);
    else await page.waitFor(`(${IN.selectedName}) === ${JSON.stringify(shown)}`, 3000);
    target.label = await page.eval(IN.selectedName);
    step(`selected "${target.label}" (${target.key})`);
    await shot(page, `${tag}-2-selected`);

    // --- move handle ---
    let h = await j(page, IN.handle('move'));
    await drag(h.x, h.y, h.x + 40, h.y + 25);
    let p = await poseOf(page, target.key);
    assert.ok(!near(p.p, from.p, 0.01), `move handle did not move the object (${JSON.stringify(p.p)})`);
    step(`moved ${JSON.stringify(from.p)} → ${JSON.stringify(p.p.map((v) => Math.round(v * 100) / 100))}`);

    // --- drag the picked object itself: it moves too (one more undo step) ---
    const a0 = await j(page, IN.anchor(target.key));
    const fr = JSON.parse(await page.eval(`JSON.stringify(document.querySelector('iframe').getBoundingClientRect())`));
    // The middle of its screen box (its pivot may sit at its foot, outside the drawn shape).
    const grabAt = a0.rect && a0.rect.w > 4 ? { x: fr.left + a0.rect.x + a0.rect.w / 2, y: fr.top + a0.rect.y + a0.rect.h / 2 } : { x: a0.x, y: a0.y };
    const before = p;
    await drag(grabAt.x, grabAt.y, grabAt.x + 30, grabAt.y + 20);
    p = await poseOf(page, target.key);
    const draggedBody = !near(p.p, before.p, 0.01);
    if (draggedBody) step(`dragged the object itself ${JSON.stringify(before.p.map((v) => Math.round(v * 100) / 100))} → ${JSON.stringify(p.p.map((v) => Math.round(v * 100) / 100))}`);
    else step('dragging the object itself: not grabbable here (too large or covered), skipped');

    // --- rotate handle: circle a quarter turn around the pivot ---
    const a1 = await j(page, IN.anchor(target.key));
    h = await j(page, IN.handle('rotate'));
    if (h) {
      const r0 = p.r ?? 0;
      const cx = a1.x, cy = a1.y, rad = Math.hypot(h.x - cx, h.y - cy);
      const ang0 = Math.atan2(h.y - cy, h.x - cx);
      const pts = Array.from({ length: 9 }, (_, i) => [cx + rad * Math.cos(ang0 + (i * Math.PI) / 2 / 8), cy + rad * Math.sin(ang0 + (i * Math.PI) / 2 / 8)]);
      if (mobile) {
        await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: h.x, y: h.y, id: 1 }] });
        for (const [x, y] of pts) await page.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y, id: 1 }] });
        await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      } else {
        await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: h.x, y: h.y, button: 'left', buttons: 1, clickCount: 1 });
        for (const [x, y] of pts) await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1 });
        const [x, y] = pts[pts.length - 1];
        await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
      }
      p = await poseOf(page, target.key);
      const turned = Math.abs(((p.r ?? 0) - r0 + 3 * Math.PI) % (2 * Math.PI) - Math.PI);
      assert.ok(turned > 1.2 && turned < 1.9, `rotate handle turned ${turned} rad, expected about π/2`);
      step(`rotated by ${(turned * 180 / Math.PI).toFixed(1)}°`);
    }

    // --- height handle (3D): drag up, the object rises ---
    h = await j(page, IN.handle('lift'));
    if (h) {
      const y0 = p.p[1];
      await drag(h.x, h.y, h.x, h.y - 40);
      p = await poseOf(page, target.key);
      assert.ok(p.p[1] > y0 + 0.05, `height handle: y ${y0} → ${p.p[1]}`);
      step(`raised y ${y0.toFixed(2)} → ${p.p[1].toFixed(2)}`);
    }

    // --- scale handle: drag away from the pivot ---
    h = await j(page, IN.handle('scale'));
    if (h) {
      const a2 = await j(page, IN.anchor(target.key));
      const s0 = Array.isArray(p.s) ? p.s[0] : p.s ?? 1;
      const dx = h.x - a2.x, dy = h.y - a2.y;
      await drag(h.x, h.y, a2.x + dx * 1.5, a2.y + dy * 1.5);
      p = await poseOf(page, target.key);
      const s1 = Array.isArray(p.s) ? p.s[0] : p.s ?? 1;
      assert.ok(s1 > s0 * 1.2, `scale handle: ${s0} → ${s1}`);
      step(`resized ×${(s1 / s0).toFixed(2)}`);
    }
    await shot(page, `${tag}-3-edited`);
    const edited = p;

    // --- look around / pan on empty space (and over objects): view changes, poses do not ---
    const v0 = await page.eval(IN.view);
    // A spot of the game away from the picked object (dragging that would move it) and the floating
    // card: of a few spots on the game (PC: it starts at x 248), the farthest from the object.
    const at = await j(page, IN.anchor(target.key));
    const spots = mobile ? [[195, 110], [80, 560], [310, 560]] : [[560, 110], [420, 640], [900, 640]];
    const [lx, ly] = spots.sort((a, b) => Math.hypot(b[0] - at.x, b[1] - at.y) - Math.hypot(a[0] - at.x, a[1] - at.y))[0];
    await drag(lx, ly, lx - 80, ly + 40);
    const v1 = await page.eval(IN.view);
    assert.notEqual(v1, v0, 'dragging empty space did not change the view');
    assert.ok(near((await poseOf(page, target.key)).p, edited.p), 'looking around moved the object');
    step('looked around (view changed, object did not move)');

    // --- undo all three steps, then redo one ---
    const undo = async () => {
      if (mobile) await page.eval(IN.click('[data-action=undo]'));
      else {
        await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'z', code: 'KeyZ', modifiers: 2, windowsVirtualKeyCode: 90 });
        await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'z', code: 'KeyZ', modifiers: 2, windowsVirtualKeyCode: 90 });
      }
      await sleep(80);
    };
    const steps = ((await j(page, IN.handle('lift'))) ? 4 : 3) + (draggedBody ? 1 : 0);
    for (let i = 0; i < steps; i++) await undo();
    p = await poseOf(page, target.key);
    assert.ok(near(p.p, from.p, 1e-6), `undo did not return to the start: ${JSON.stringify(p.p)} vs ${JSON.stringify(from.p)}`);
    step(`undo ×${steps} → exact start pose`);
    // Redo: ⇧⌘Z / Ctrl+Shift+Z on PC; on a phone, a row of the ⌘K list.
    if (mobile) assert.ok(await page.eval(IN.palette('redo')), 'no Redo in the ⌘K list');
    else {
      await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Z', code: 'KeyZ', modifiers: 10, windowsVirtualKeyCode: 90 });
      await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Z', code: 'KeyZ', modifiers: 10, windowsVirtualKeyCode: 90 });
    }
    await sleep(120);
    p = await poseOf(page, target.key);
    assert.ok(!near(p.p, from.p, 0.01), 'redo did not re-apply the move');
    step('redo → move re-applied');

    // --- the draft: placement.json is written without a word to the AI, and nothing on screen says "saved" ---
    const file = join(root, 'placement.json');
    for (let i = 0; i < 40 && !existsSync(file); i++) await sleep(100);
    assert.ok(existsSync(file), 'the change was not written as a draft to placement.json');
    assert.ok(!lines.some((l) => l.startsWith('studio: saved')), 'the draft printed a stdout line (it must stay quiet)');
    assert.equal(await page.eval(`!!document.querySelector('.save-state')?.offsetParent`), false, '"Saved" shown before Save (only the draft was written)');
    step('draft in placement.json (no stdout line, no "Saved" on screen)');

    // --- Save: "Save · 1", then the file, the request and the line, then "✓ Saved" ---
    assert.match(await page.eval(IN.saveLabel), /·\s*1/);
    await page.eval(IN.click('[data-action=save]'));
    for (let i = 0; i < 40 && !lines.some((l) => l.startsWith('studio: saved placement.json')); i++) await sleep(100);
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(saved.tool, 'placement');
    assert.ok(saved.objects[target.key], `placement.json has no entry for ${target.key}`);
    assert.ok(near(saved.objects[target.key].was.p, from.p, 0.11), '`was` is the original pose');
    assert.ok(lines.some((l) => l.startsWith('studio: saved placement.json')));
    await page.waitFor(`!/\\d/.test(${IN.saveLabel})`);
    await page.waitFor(`!!document.querySelector('.save-state')?.offsetParent`, 3000);
    step(`saved placement.json (${Object.keys(saved.objects).length} object), "✓ Saved" shown`);
    await shot(page, `${tag}-4-saved`);

    // --- switch to the Library ---
    // Phone: the Library tab is in the sheet (the bar no longer has a second
    // copy of the switch); open the sheet first if it is closed.
    if (mobile && !(await page.eval(`!!document.querySelector('[data-tool=library]')?.offsetParent`))) await page.eval(IN.click('[data-action=sheet]'));
    await page.eval(IN.click('[data-tool=library]'));
    await page.waitFor(`document.querySelector('[data-tool=library]')?.getAttribute('aria-selected') === 'true'`);
    // The panel shows files, or its "nothing here" line (a game may have no asset files at all).
    await page.waitFor(`!!document.querySelector('.gsl-name, .gsl-empty')`, 10000);
    await sleep(600);
    const nFiles = await page.eval(`document.querySelectorAll('.gsl-tile[data-path] .gsl-name').length`);
    step(`switched to Library (${nFiles} files listed)`);
    await shot(page, `${tag}-5-library`);

    // --- next step: publish → ask my AI (from the ⌘K list) ---
    assert.ok(await page.eval(IN.palette('next')), 'no "Ideas for your AI" in the ⌘K list');
    await page.waitFor(`!!document.querySelector('[data-step=publish]')`);
    await shot(page, `${tag}-6-next`);
    await page.eval(IN.click('[data-step=publish]'));
    await page.waitFor(`!!document.querySelector('[data-action=ask]')`);
    await page.eval(IN.click('[data-action=ask]'));
    await page.waitFor(`document.querySelector('.note')?.textContent.length > 0`);
    assert.ok(existsSync(join(root, '.studio/next-step.md')), '.studio/next-step.md was not written');
    assert.ok(lines.some((l) => l.startsWith('studio: next-step publish')));
    step('next step "Publish to KUMODeck" handed to the AI');
    await shot(page, `${tag}-7-next-sent`);

    const errors = page.logs.filter((l) => l.startsWith('exception') || l.startsWith('error'));
    assert.deepEqual(errors, [], 'page errors');
  } catch (e) {
    console.log(page.logs.slice(-20).join('\n'));
    console.log(lines.join('\n'));
    await shot(page, `${tag}-FAIL`).catch(() => {});
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
