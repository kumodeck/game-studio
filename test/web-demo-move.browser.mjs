// The move button (the cross on the strip under a picked object) in the web
// demo, in the orders a person really uses it, with real mouse / touch input:
//
//   node test/web-demo-move.browser.mjs [--dir <built folder> | --url <hosted demo URL>]
//                                       [--shots <dir>] [--only pc,390] [--game <id>] [--lang ja|en]
//                                       [--old]   (a build from before 2026-10-17: the tips are only noted)
//
// Written for the report "the move button stopped working" (2026-10-17, the
// hosted demo on a PC). Each step ends with a drag of the object itself and
// checks that it moved:
//   1. open → click the object in the picture right away (the 2D sample once
//      did not pick it while the first-run tips were up) → drag
//   2. the cross pressed → drag the object; drag empty ground (the chosen tool
//      works from anywhere)
//   3. turn tool → back to the cross → drag
//   4. keyboard: T (turn) then M (move) → drag
//   5. another object picked, then the first again → drag
//   6. picked from the list on the left (PC) → the cross → drag
//   7. Undo (⌘Z / Ctrl+Z) → drag again
// Also: no first-run tips on screen at any point (removed 2026-10-17).
// Without --dir / --url it builds the demo into a temporary folder. Exit 1 on failure.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, newPage } from './adapters-2d/cdp.mjs';
import { startHost } from './web-demo-host.mjs';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const SHOTS = opt('--shots') ? resolve(opt('--shots')) : null;
const LANG = opt('--lang') || 'ja';
const URL_ARG = opt('--url');
const ONLY = opt('--only');
const ONLY_GAME = opt('--game');
const OLD = args.includes('--old');
let DIR = opt('--dir') ? resolve(opt('--dir')) : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
if (!DIR && !URL_ARG) {
  DIR = join(mkdtempSync(join(tmpdir(), 'studio-web-demo-')), 'site');
  execFileSync(process.execPath, [join(PKG, 'scripts/build-web-demo.mjs'), '--out', DIR], { stdio: 'inherit' });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SIZES = [
  { tag: 'pc', width: 1280, height: 800, mobile: false },
  { tag: '390', width: 390, height: 844, mobile: true },
].filter((v) => !ONLY || ONLY.split(',').includes(v.tag));
// Two objects per sample: the one to move, and another to pick in between.
// The boats first (the report's own example), then wide, still things.
const PICK = {
  'lantern-cove': ['sailboat', 'sea-stack', 'lighthouse', 'sea-stack-small'],
  'firefly-ruins': ['boat', 'urn', 'lantern', 'stone-1', 'banner'],
};
const GAMES = Object.keys(PICK).filter((g) => !ONLY_GAME || g === ONLY_GAME);

const FRAME = `document.querySelector('iframe')`;
const DBG = `${FRAME}.contentWindow.__gameStudio._debug`;
const UI = `${FRAME}.contentDocument.querySelector('[data-studio-ui]').shadowRoot`;
const IN = {
  ready: `document.querySelectorAll('.obj').length > 0 && !!${FRAME}?.contentWindow.__gameStudio?._debug`,
  list: `JSON.stringify(${DBG}.list())`,
  at: (key) => `(() => { const f = ${FRAME}.getBoundingClientRect(); const a = ${DBG}.anchor(${JSON.stringify(key)});
    return a ? JSON.stringify({ x: f.left + a.center[0], y: f.top + a.center[1], visible: a.visible, w: a.rect.w, h: a.rect.h }) : null; })()`,
  strip: (k) => `(() => { const o = ${FRAME}.getBoundingClientRect(); const b = ${UI}.querySelector('[data-studio-handle=${k}]');
    if (!b || b.hidden || !b.getBoundingClientRect().width) return null; const r = b.getBoundingClientRect();
    return JSON.stringify({ x: o.left + r.left + r.width / 2, y: o.top + r.top + r.height / 2, on: b.getAttribute('aria-pressed') === 'true' || b.classList.contains('on') }); })()`,
  // The removed first-run tips: their plate, or any of their words, must not be on screen.
  tips: `[...document.querySelectorAll('.first-hint, [data-part=intro]')].some((e) => !e.hidden && !!e.offsetParent)`,
};

const host = URL_ARG ? null : await startHost({ dir: DIR });
const base = URL_ARG ? URL_ARG.replace(/\/?$/, '/') : host.url;
const browser = await launch();
const fails = [];
try {
  for (const size of SIZES) for (const game of GAMES) {
    const tag = `${size.tag}-${game}`;
    const page = await newPage(browser, size);
    const j = async (e) => JSON.parse((await page.eval(e)) || 'null');
    const step = (s) => console.log(`  ✓ ${tag}: ${s}`);
    let n = 0;
    const shot = async (name) => {
      if (SHOTS) writeFileSync(join(SHOTS, `${tag}-${++n}-${name}.png`), await page.screenshot());
    };
    const press = (p) => (size.mobile ? page.tap(p.x, p.y) : page.click(p.x, p.y));
    const drag = (x0, y0, x1, y1) => (size.mobile ? page.touchDrag(x0, y0, x1, y1, 8) : page.mouseDrag(x0, y0, x1, y1, 8));
    const pose = async (key) => (await j(IN.list)).find((i) => i.key === key).pose;
    const selected = () => page.eval('window.studioShell.selected()');
    const noTips = async (when) => {
      const up = await page.eval(IN.tips);
      if (OLD) console.log(`  · ${tag}: first-run tips ${up ? 'on screen' : 'not shown'} (${when})`);
      else assert.equal(up, false, `${tag}: first-run tips on screen (${when})`);
    };
    /** Is the game itself (not the card, the bar or the sheet) under this point? */
    const gameAt = (p) => page.eval(`document.elementFromPoint(${p.x}, ${p.y}) === ${FRAME}`);
    /** Drag `key` by (dx, dy) from its middle (or from `from`), and check it moved. */
    // Back and forth, so the object stays near its place (and in front of its neighbours) for the later picks.
    let way = 1;
    const moveIt = async (key, what, from) => {
      const before = await pose(key);
      const a = from || (await j(IN.at(key)));
      way = -way;
      await drag(a.x, a.y, a.x + 40 * way, a.y + 25 * way);
      await sleep(250);
      const after = await pose(key);
      const d = Math.hypot(...after.p.map((v, i) => v - before.p[i]));
      assert.ok(d > (game === 'lantern-cove' ? 0.05 : 5), `${tag}: "${key}" did not move (${what}): ${JSON.stringify({ before: before.p, after: after.p })}`);
      return d;
    };
    /** A spot in the game away from every object (for "drag empty ground"). */
    const freeSpot = async (key) => {
      const m = await j(IN.at(key));
      const f = await j(`JSON.stringify(${FRAME}.getBoundingClientRect())`);
      const c = [];
      for (const fx of [0.15, 0.3, 0.5, 0.7, 0.85]) for (const fy of [0.15, 0.25, 0.35, 0.45, 0.55]) {
        const p = { x: f.left + f.width * fx, y: f.top + f.height * fy };
        if (!(await gameAt(p))) continue;
        const onSome = await page.eval(`(() => { const f = ${FRAME}.getBoundingClientRect(); return ${DBG}.list().some((i) => { const a = ${DBG}.anchor(i.key);
          return a && a.visible && ${p.x} > f.left + a.rect.x - 12 && ${p.x} < f.left + a.rect.x + a.rect.w + 12 && ${p.y} > f.top + a.rect.y - 12 && ${p.y} < f.top + a.rect.y + a.rect.h + 12; }); })()`);
        if (!onSome) c.push(p);
      }
      c.sort((p, q) => Math.hypot(q.x - m.x, q.y - m.y) - Math.hypot(p.x - m.x, p.y - m.y));
      return c[0] || null;
    };
    const strip = async (k) => {
      const b = await j(IN.strip(k));
      assert.ok(b, `${tag}: no "${k}" button under the object`);
      return b;
    };
    try {
      // --- 1. open, click the object in the picture right away ---
      await page.goto(`${base}studio/?game=${game}&lang=${LANG}`);
      await page.waitFor(IN.ready, 60000);
      const items = await j(IN.list);
      const keys = [];
      for (const k of PICK[game]) {
        if (!items.some((i) => i.key === k && i.movable !== false)) continue;
        const a = await j(IN.at(k));
        if (a && a.visible && a.w > 12 && a.h > 12 && (await gameAt(a))) keys.push(k);
      }
      assert.ok(keys.length >= 2, `${tag}: fewer than 2 of ${PICK[game].join(', ')} on screen`);
      let [key, other] = keys;
      await noTips('open');
      await shot('open');
      // No wait: the first thing a person does once they see the picture.
      await press(await j(IN.at(key)));
      await page.waitFor(`!!window.studioShell.selected()`, 3000).catch(() => {});
      const got = await selected();
      // In 3D another candidate can stand in front (the floating sailboat bobs in front of the sea stack on a
      // phone): what is under the finger is what a person picks. Nothing, or the sea, fails.
      assert.ok(PICK[game].includes(got), `${tag}: a ${size.mobile ? 'tap' : 'click'} on "${key}" right after opening picked ${JSON.stringify(got)}`);
      if (got !== key) {
        if (got === other) other = key;
        key = got;
      }
      await sleep(300);
      const cross = await strip('move');
      await noTips('picked');
      await shot('picked');
      let d = await moveIt(key, 'right after the pick');
      step(`opened, ${size.mobile ? 'tapped' : 'clicked'} "${key}" in the picture at once → picked; dragged it (${d.toFixed(2)}); the cross is ${cross.on ? 'already on' : 'not marked'}`);
      await shot('moved');

      // --- 2. the cross, then drag the object / empty ground ---
      await press(await strip('move'));
      await sleep(250);
      const marked = await j(IN.strip('move'));
      await shot('cross-pressed');
      d = await moveIt(key, 'after pressing the cross');
      const spot = await freeSpot(key);
      let ground = 'no free ground on screen';
      if (spot) {
        const g = await moveIt(key, 'dragging empty ground with the cross', spot);
        ground = `empty ground moved it too (${g.toFixed(2)})`;
      }
      step(`cross pressed (${marked?.on ? 'shown as on' : 'not shown as on'}) → drag moved it (${d.toFixed(2)}); ${ground}`);

      // --- 3. turn, then back to the cross ---
      await press(await strip('rotate'));
      await sleep(250);
      await press(await strip('move'));
      await sleep(250);
      d = await moveIt(key, 'turn → cross');
      step(`turn tool → cross → moved (${d.toFixed(2)})`);

      // --- 4. keyboard (PC): T then M ---
      if (!size.mobile) {
        for (const c of ['t', 'm']) {
          await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: c, text: c, code: `Key${c.toUpperCase()}` });
          await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: c, code: `Key${c.toUpperCase()}` });
          await sleep(150);
        }
        d = await moveIt(key, 'keys T → M');
        step(`keys T → M → moved (${d.toFixed(2)})`);
      }

      // --- 5. another object, then this one again ---
      await press(await j(IN.at(other)));
      await sleep(300);
      assert.equal(await selected(), other, `${tag}: "${other}" not picked`);
      // A tap on bare ground first: on a phone the other object's strip can sit over this one.
      const bare = await freeSpot(other);
      if (bare) {
        await press(bare);
        await sleep(300);
      }
      await press(await j(IN.at(key)));
      await sleep(300);
      assert.equal(await selected(), key, `${tag}: "${key}" not picked again`);
      await press(await strip('move'));
      await sleep(200);
      d = await moveIt(key, 'picked again');
      step(`picked "${other}", then "${key}" again → cross → moved (${d.toFixed(2)})`);

      // --- 6. from the list (PC: the left column) ---
      if (!size.mobile) {
        await press(await j(IN.at(other)));
        await sleep(300);
        const row = await j(`(() => { const r = [...document.querySelectorAll('.obj')].find(e => e.offsetParent && e.dataset.key === ${JSON.stringify(key)}); if (!r) return null; const q = r.getBoundingClientRect(); return JSON.stringify({ x: q.left + q.width / 2, y: q.top + q.height / 2 }); })()`);
        if (row) {
          await press(row);
          await sleep(500);
          assert.equal(await selected(), key, `${tag}: the list row did not pick "${key}"`);
          await press(await strip('move'));
          await sleep(200);
          d = await moveIt(key, 'picked from the list');
          step(`picked from the list → cross → moved (${d.toFixed(2)})`);
          await shot('from-list');
        } else step('(no list row with data-key; skipped the list step)');
      }

      // --- 7. Undo, then drag again ---
      if (!size.mobile) {
        const mac = process.platform === 'darwin';
        await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'z', code: 'KeyZ', modifiers: mac ? 4 : 2, commands: ['undo'] });
        await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'z', code: 'KeyZ', modifiers: mac ? 4 : 2 });
      } else {
        const u = await j(`(() => { const b = [...document.querySelectorAll('[data-action=undo]')].find(e => e.offsetParent && !e.disabled); if (!b) return null; const q = b.getBoundingClientRect(); return JSON.stringify({ x: q.left + q.width / 2, y: q.top + q.height / 2 }); })()`);
        if (u) await press(u);
      }
      await sleep(500);
      if ((await selected()) !== key) {
        await press(await j(IN.at(key)));
        await sleep(300);
      }
      d = await moveIt(key, 'after Undo');
      await noTips('end');
      await shot('after-undo');
      step(`Undo → dragged again → moved (${d.toFixed(2)})${OLD ? "" : "; no first-run tips at any point"}`);
      const errs = page.logs.filter((l) => l.startsWith('exception'));
      assert.equal(errs.length, 0, `${tag}: page errors: ${errs.join(' | ')}`);
    } catch (e) {
      fails.push(e.message);
      console.log(`  ✗ ${e.message}`);
      await shot('fail').catch(() => {});
    }
    await page.close();
  }
} finally {
  await browser.close();
  host?.close();
}
if (fails.length) {
  console.error(`web demo move: ${fails.length} failed`);
  process.exit(1);
}
console.log('web demo move: all passed');
