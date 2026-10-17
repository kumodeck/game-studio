// The list's pictures with hundreds of objects, in a headless browser (tool-modes pass, 2026-10-16).
//
//   node test/studio-thumbs.browser.mjs [--shots <dir>]
//
// pixi-garden with a crowd added in a temporary copy (283 objects; the same
// crowd as rebrand-shots.browser.mjs), PC 1280 and phone 390:
// - the list scrolled to its end: every row in view gets its picture within a
//   few seconds (the shell asks for the rows in view; the bridge draws the
//   newest request first). Before, the editor asked for the first 200 in list
//   order once, so the rows further down stayed empty boxes;
// - one picked far down (rock-202, from ⌘K-like code): its row is in view and
//   drawn too; on the phone the list sheet opened with it picked shows its row
//   and the picked object above the sheet (not under it).
import assert from 'node:assert/strict';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

/** 270 more sprites from 90 files (flower / rock / post), written into the copy only. */
function addCrowd(dir) {
  const pad = (n) => String(n).padStart(3, '0');
  mkdirSync(join(dir, 'assets/props'), { recursive: true });
  const kinds = ['flower', 'rock', 'post'];
  for (let i = 0; i < 90; i++) copyFileSync(join(dir, `assets/${kinds[i % 3]}.svg`), join(dir, `assets/props/${kinds[i % 3]}-${pad(i + 1)}.svg`));
  const f = join(dir, 'game.js');
  const src = readFileSync(f, 'utf8');
  const at = 'app.stage.addChild(bg, ground, cloud, house, tree1, tree2, rock, flower, fence, ui);';
  assert.ok(src.includes(at), 'pixi-garden game.js changed: update the crowd');
  writeFileSync(f, src.replace(at, `const kinds = ['flower', 'rock', 'post'];
const crowd = [];
for (let i = 0; i < 90; i++) {
  const t = await Assets.load(\`assets/props/\${kinds[i % 3]}-\${String(i + 1).padStart(3, '0')}.svg\`);
  for (let j = 0; j < 3; j++) { const n = i * 3 + j; const s = new Sprite(t); s.anchor.set(0.5); s.scale.set(0.45);
    s.position.set(30 + (n % 30) * 25, 300 + Math.floor(n / 30) * 28); s.label = \`\${kinds[i % 3]}-\${n + 1}\`; crowd.push(s); }
}
app.stage.addChild(bg, ground, cloud, house, tree1, tree2, rock, flower, fence, ...crowd, ui);`));
}

async function run(layout) {
  const mobile = layout === 'phone';
  const tag = `pixi-garden-crowd-${mobile ? '390' : '1280'}`;
  const root = mkdtempSync(join(tmpdir(), 'studio-thumbs-'));
  cpSync(join(PKG, 'examples', 'pixi-garden'), root, { recursive: true });
  rmSync(join(root, 'placement.json'), { force: true });
  addCrowd(root);
  mkdirSync(join(root, '.studio/ui'), { recursive: true });
  writeFileSync(join(root, '.studio/ui/prefs.json'), JSON.stringify({ version: 1, lang: 'ja' }));
  const srv = await startStudioServer({ root, uiDir: join(PKG, 'skills/arrange/bin/studio-ui'), log: () => {} });
  const browser = await launch();
  const page = await newPage(browser, mobile ? { width: 390, height: 844, mobile: true } : { width: 1280, height: 800 });
  const ok = (m) => console.log(`  ✓ ${tag}: ${m}`);
  const shot = async (name) => {
    if (SHOTS) writeFileSync(join(SHOTS, `${mobile ? 'phone' : 'pc'}-${tag}-${name}.png`), await page.screenshot());
  };
  // The rows in view of the list's scroller, and how many of their pictures are still empty.
  const inView = `(() => { const box = document.querySelector('.objects').closest('.panel').getBoundingClientRect();
    const rows = [...document.querySelectorAll('.objects .obj')].filter((r) => { const b = r.getBoundingClientRect(); return b.height && b.bottom > box.top + 4 && b.top < box.bottom - 4; });
    const imgs = rows.flatMap((r) => [...r.querySelectorAll('img.thumb')]);
    return JSON.stringify({ rows: rows.length, pics: imgs.length, empty: imgs.filter((i) => i.classList.contains('empty') || !i.getAttribute('src')).length, keys: rows.map((r) => r.dataset.key) }); })()`;
  const j = async (expr) => JSON.parse((await page.eval(expr)) || 'null');
  const waitDrawn = async (what, ms = 15000) => {
    let v;
    for (let t = 0; t < ms; t += 250) {
      v = await j(inView);
      if (v.pics > 0 && v.empty === 0) return v;
      await sleep(250);
    }
    assert.fail(`${what}: ${v.empty} of ${v.pics} pictures in view still empty (${v.keys.slice(0, 6).join(', ')}…)`);
  };
  try {
    await page.goto(srv.url);
    await page.waitFor(`document.querySelectorAll('.obj').length > 0 && !!document.querySelector('iframe').contentWindow.__gameStudio?._debug`, 30000);
    const n = await page.eval(`${DBG}.list().length`);
    assert.ok(n >= 270, `the crowd did not load (${n} objects)`);
    if (mobile) {
      await page.eval(`[...document.querySelectorAll('[data-action=sheet]')].find(e => e.offsetParent).click()`);
      await sleep(800);
    }
    // Every kind open, so there are hundreds of rows to scroll through.
    for (let i = 0; i < 6; i++) {
      const closed = await page.eval(`(() => { const b = [...document.querySelectorAll('.objects [data-expand][aria-expanded=false]')]; b.forEach((e) => e.click()); return b.length; })()`);
      if (!closed) break;
      await sleep(200);
    }
    const rows = await page.eval(`document.querySelectorAll('.objects .obj').length`);
    assert.ok(rows > 250, `the list shows ${rows} rows`);
    // Through the whole list, top to end, in screens: every screen gets its pictures. (The list is front on
    // top, so the crowd added last is at the TOP: the old "first 200 in the game's order" left those empty.)
    const H = await page.eval(`document.querySelector('.objects').closest('.panel').clientHeight`);
    const total = await page.eval(`document.querySelector('.objects').closest('.panel').scrollHeight`);
    let screens = 0, pics = 0;
    for (let y = 0; y <= total; y += Math.max(100, H - 40)) {
      await page.eval(`document.querySelector('.objects').closest('.panel').scrollTop = ${y}`);
      const v = await waitDrawn(`the list at ${y} px of ${total}`);
      if (screens === 1) await shot('1-list-scrolled');
      screens++;
      pics += v.pics;
    }
    ok(`${rows} rows; scrolled through all of it (${screens} screens): every picture in view drawn (${pics} seen)`);

    // One picked far down: its row comes into view (and on a phone the object stays above the sheet).
    if (mobile) {
      await page.eval(`[...document.querySelectorAll('[data-action=sheet]')].find(e => e.offsetParent).click()`);
      await sleep(500);
    }
    await page.eval(`window.studioShell.actions.select('rock-202')`);
    await sleep(600);
    if (mobile) {
      await page.eval(`[...document.querySelectorAll('[data-action=sheet]')].find(e => e.offsetParent).click()`);
      await sleep(1200);
    }
    const sel = await j(inView);
    assert.ok(sel.keys.includes('rock-202'), `rock-202's row is not in view (${sel.keys.slice(0, 4).join(', ')}…)`);
    if (mobile) {
      const a = await j(`(() => { const f = document.querySelector('iframe').getBoundingClientRect(); const r = ${DBG}.anchor('rock-202').rect;
        return JSON.stringify({ bottom: f.top + r.y + r.h, top: f.top + r.y, sheet: document.querySelector('.side').getBoundingClientRect().top }); })()`);
      assert.ok(a.bottom < a.sheet && a.top > 0, `rock-202 is under the sheet (object ${a.top.toFixed(0)}–${a.bottom.toFixed(0)}, sheet from ${a.sheet.toFixed(0)})`);
      ok(`the sheet opened with rock-202 picked: its row in view, the object above the sheet (${a.bottom.toFixed(0)} < ${a.sheet.toFixed(0)})`);
    } else ok('rock-202 picked: its row is in view');
    await shot('2-picked-far-down');
    const errors = page.logs.filter((l) => l.startsWith('exception') || l.startsWith('error'));
    assert.deepEqual(errors, [], 'page errors');
  } catch (err) {
    console.log(page.logs.slice(-15).join('\n'));
    if (SHOTS) writeFileSync(join(SHOTS, `thumbs-${tag}-FAIL.png`), await page.screenshot().catch(() => Buffer.alloc(0)));
    throw err;
  } finally {
    await page.close();
    await browser.close();
    await srv.close();
    if (existsSync(root)) rmSync(root, { recursive: true, force: true });
  }
}

for (const layout of ['pc', 'phone']) {
  console.log(`pixi-garden-crowd · ${layout}`);
  await run(layout);
}
console.log('all passed');
