// Domino Spiral in the editor (starters/domino-spiral, the shelf's sample 4, 2026-11-06): the sample's three tries, end
// to end, as a person does them.
//
//   node test/studio-domino.browser.mjs [--lang en|ja] [--shots <dir>]
//
//   1. Open: the editor lists the three placed points (head, bend, center) and none of the ~400 dominoes.
//   2. Move: drag the head with the Move tool — the whole line follows it while still in Edit (the first domino stands
//      on the new head), and Save counts one change.
//   3. Save: placement.json holds the three points only (never a domino).
//   4. ▶ Play: the line starts at the saved head; the fall runs; P at the starter's `try.pauseAt` (about half down).
//   5. Ask the starter's `try.ask` ("Make the dominoes twice as tall."): the stand-in AI (fake-agent shelfFix) doubles
//      DOMINO_HEIGHT; the reply offers Before / After; the After is the same second with dominoes twice as tall.
//
// WHY one test for the whole round: the sample exists to show those three hands in one go (the shelf's promise); a
// part that works alone but not after the one before it (a drag that is lost at Play, a save that writes 400 objects)
// is exactly what a person would hit.
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStudioServer } from '../src/server/server.mjs';
import { starterFiles } from '../src/server/starters.mjs';
import { launch, newPage } from './adapters-2d/cdp.mjs';
import { shelfFix, startFakeAgent } from './ai-feel/fake-agent.mjs';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(PKG, 'starters/domino-spiral');
const UI = join(PKG, 'skills/arrange/bin/studio-ui');
const args = process.argv.slice(2);
const take = (flag, d = null) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : d);
const LANG = take('--lang', 'en');
const SHOTS = take('--shots');
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const META = JSON.parse(readFileSync(join(SRC, 'starter.json'), 'utf8'));
// The ask: English in starter.json, other languages in strings.json (decided 2026-11-06: non-English text lives in
// translation files only).
const ASK = LANG === 'en' ? META.try.ask.en : JSON.parse(readFileSync(join(SRC, 'strings.json'), 'utf8'))[LANG]?.try?.ask || META.try.ask.en;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FR = `document.querySelector('iframe.game:not(.leaving)')`;
const GW = `${FR}.contentWindow`;
const SHELL = `document.querySelector('.shell')`;
const IN = {
  ready: `document.querySelectorAll('.obj').length > 0 && !!${GW}?.__gameStudio?._debug && !!${GW}.dominoSpiral`,
  playing: `${SHELL}.dataset.playing === 'on'`,
  moment: `${SHELL}.dataset.moment === 'on' && ${SHELL}.dataset.paused === 'on'`,
  game: `JSON.stringify((() => { const d = ${GW}.dominoSpiral; return d ? { t: d.t, down: d.down, count: d.count, first: d.first, height: d.height } : null; })())`,
  keys: `JSON.stringify(${GW}.__gameStudio._debug.list().map((i) => i.key))`,
  save: `(() => { const b = [...document.querySelectorAll('[data-action=save]')].find((e) => e.offsetParent); return b ? b.textContent : ''; })()`,
  handle: (kind) => `(() => { const f = ${FR}.getBoundingClientRect(); const ui = ${FR}.contentDocument.querySelector('[data-studio-ui]');
    const e = ui?.shadowRoot?.querySelector('[data-studio-handle=${kind}]'); if (!e || !e.getBoundingClientRect().width) return null;
    const r = e.getBoundingClientRect(); return JSON.stringify({ x: f.left + r.left + r.width / 2, y: f.top + r.top + r.height / 2, on: e.getAttribute('aria-pressed') === 'true' }); })()`,
  pose: (key) => `JSON.stringify(${GW}.__gameStudio._debug.anchor(${JSON.stringify(key)})?.pose || null)`,
};
const box = (sel) => `(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.offsetParent && !x.hidden); if (!e) return null;
  const r = e.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2, text: e.textContent.replace(/\\s+/g, ' ').trim() }); })()`;
const j = async (page, expr) => JSON.parse((await page.eval(expr)) || 'null');
async function until(fn, ms, what) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timeout: ${what}`);
    await sleep(150);
  }
}
async function keyIn(page, key, code, text) {
  const vk = key === 'Enter' ? 13 : key.toUpperCase().charCodeAt(0);
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk, ...(text ? { text } : {}) });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk });
}

async function run() {
  console.log(`domino: Domino Spiral in the editor, PC 1280×800, ${LANG}`);
  const root = mkdtempSync(join(tmpdir(), 'studio-domino-'));
  // What `--starter domino-spiral` copies into an empty folder (no starter.json / thumb.png / README.md).
  for (const f of await starterFiles(SRC)) cpSync(join(SRC, f), join(root, f), { recursive: true });
  mkdirSync(join(root, '.studio/ui'), { recursive: true });
  writeFileSync(join(root, '.studio/ui/prefs.json'), JSON.stringify({ version: 1, lang: LANG }));
  const srv = await startStudioServer({ root, uiDir: UI, log: () => {}, env: { CLAUDECODE: '1' } });
  const agent = startFakeAgent(root, { fix: shelfFix }); // the paused-ask fix: DOMINO_HEIGHT × 2 for this sample
  const browser = await launch();
  const page = await newPage(browser, { width: 1280, height: 800 });
  let n = 0;
  const shot = async (what) => {
    if (!SHOTS) return;
    const f = `domino-${LANG}-${String(++n).padStart(2, '0')}-${what}.png`;
    writeFileSync(join(SHOTS, f), await page.screenshot());
    console.log(`  shot ${f}`);
  };
  const errors = () => page.logs.filter((l) => /^(error|exception)/.test(l) && !/favicon|placement\.json/.test(l));
  try {
    // 1. Open.
    await page.goto(srv.url);
    await page.waitFor(IN.ready, 90000);
    await sleep(800);
    const keys = await j(page, IN.keys);
    for (const k of ['head', 'bend', 'center']) assert.ok(keys.includes(k), `the editor lists ${k} (${keys.join(', ')})`);
    assert.ok(keys.length <= 6, `the dominoes, the ramp and the ball are not in the list (${keys.length} objects: ${keys.join(', ')})`);
    const g0 = await j(page, IN.game);
    assert.ok(g0.count >= 380 && g0.count <= 480, `about 400 dominoes (${g0.count})`);
    console.log(`  ok: opened — ${keys.join(', ')}; ${g0.count} dominoes`);
    await shot('open');

    // 2. Move the head (the starter's try.move) with the Move tool: the line follows it in Edit.
    assert.equal(META.try.move, 'head');
    await page.eval(`studioShell.actions.select('head')`);
    await page.waitFor(`studioShell.selected() === 'head'`, 4000);
    await sleep(500);
    const h = await j(page, IN.handle('move'));
    assert.ok(h, 'the Move handle under the head');
    const p0 = await j(page, IN.pose('head'));
    // A drag up and to the right: the head walks toward the middle of the picture, the lead-in gets shorter.
    await page.mouseDrag(h.x, h.y, h.x + 90, h.y - 50, 12);
    await sleep(600);
    const p1 = await j(page, IN.pose('head'));
    const moved = Math.hypot(p1.p[0] - p0.p[0], p1.p[2] - p0.p[2]);
    assert.ok(moved > 1, `the head moved (${moved.toFixed(2)} m)`);
    const g1 = await j(page, IN.game);
    const onHead = Math.hypot(g1.first.x - p1.p[0], g1.first.z - p1.p[2]);
    assert.ok(onHead < 1e-6, `in Edit, the first domino stands on the new head (${onHead.toExponential(1)} m off)`);
    assert.notEqual(g1.count, g0.count, `the line was laid again along the new path (${g0.count} → ${g1.count} dominoes)`);
    await until(async () => /1/.test(await page.eval(IN.save)), 4000, 'Save · 1');
    console.log(`  ok: dragged the head ${moved.toFixed(2)} m — the line followed in Edit (${g0.count} → ${g1.count} dominoes), Save · 1`);
    await shot('moved');

    // 3. Save: the three points only.
    await page.eval(`studioShell.actions.save()`);
    const file = join(root, 'placement.json');
    await until(() => existsSync(file) && JSON.parse(readFileSync(file, 'utf8')).objects?.head, 10000, 'placement.json with the head');
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    const savedKeys = Object.keys(saved.objects);
    assert.deepEqual(savedKeys, ['head'], `placement.json keeps the moved point only, never a domino (${savedKeys.join(', ')})`);
    assert.ok(Math.abs(saved.objects.head.p[0] - p1.p[0]) < 1e-3 && Math.abs(saved.objects.head.p[2] - p1.p[2]) < 1e-3, 'where it was dragged');
    await until(async () => !/\d/.test(await page.eval(IN.save)), 6000, 'nothing left to save');
    console.log(`  ok: saved — placement.json objects: ${savedKeys.join(', ')}`);

    // 4. ▶ Play: the saved line, the fall; P about half down.
    await page.eval(`document.querySelector('button.play').click()`);
    await page.waitFor(IN.playing, 30000);
    const gp = await until(async () => {
      const g = await j(page, IN.game);
      return g && g.t > 0.05 ? g : null;
    }, 20000, 'the game running');
    assert.ok(Math.hypot(gp.first.x - p1.p[0], gp.first.z - p1.p[2]) < 1e-3, 'in Play the line starts at the saved head');
    const at = META.try.pauseAt;
    await until(async () => (await j(page, IN.game)).t >= at - 0.25, (at + 20) * 1000, `the game's second ${at}`);
    await page.click(640, 120);
    await keyIn(page, 'p', 'KeyP', 'p');
    await page.waitFor(IN.moment, 10000);
    await sleep(500);
    const gm = await j(page, IN.game);
    const half = gm.down / gm.count;
    assert.ok(half > 0.3 && half < 0.7, `paused about half down (${gm.down} / ${gm.count} at ${gm.t.toFixed(2)} s)`);
    console.log(`  ok: ▶ Play from the saved head, P at ${gm.t.toFixed(2)} s — ${gm.down} / ${gm.count} down`);
    await shot('paused');

    // 5. Ask the try's words; Before / After.
    await page.eval(`(document.activeElement?.blur?.(), true)`);
    await page.eval(`(document.querySelector('.ask-input').focus(), true)`);
    await page.send('Input.insertText', { text: ASK });
    await keyIn(page, 'Enter', 'Enter', '\r');
    const buttons = () => j(page, `JSON.stringify([...document.querySelectorAll('.ai-line button')].filter((b) => b.offsetParent).map((b) => b.dataset.action))`);
    await until(async () => (await buttons()).includes('moment-compare'), 60000, 'the reply with Before / After');
    assert.match(readFileSync(join(root, 'game.js'), 'utf8'), /const DOMINO_HEIGHT = 2\.0;/, 'the stand-in doubled DOMINO_HEIGHT');
    const line = await page.eval(`document.querySelector('.ai-line')?.innerText.replace(/\\s+/g, ' ') || ''`);
    console.log(`  ok: asked — the reply: ${line}`);
    const cmp = await j(page, box('[data-action=moment-compare]'));
    await page.click(cmp.x, cmp.y);
    const AFTER = `!!document.querySelector('[data-part=moment-compare]:not([hidden]) [data-part=compare-after] img')`;
    await until(async () => (await page.eval(AFTER)) || null, 240000, 'the After').catch(async (e) => {
      // Seen with the Big Swell clip (2026-11-05): the Try held at the second but the panel had closed — press again.
      const again = await j(page, box('[data-action=moment-compare]'));
      if (!again) throw e;
      await page.click(again.x, again.y);
      await page.waitFor(AFTER, 60000);
    });
    const ga = await j(page, IN.game);
    assert.equal(ga.height, 2, 'the After runs the new code (DOMINO_HEIGHT 2.0)');
    assert.ok(Math.abs(ga.t - gm.t) < 0.5, `the After is the same second (${ga.t.toFixed(2)} s, asked at ${gm.t.toFixed(2)} s)`);
    assert.ok(Math.hypot(ga.first.x - p1.p[0], ga.first.z - p1.p[2]) < 1e-3, 'the After keeps the dragged head (the saved layout)');
    const pics = await j(page, `JSON.stringify([...document.querySelectorAll('[data-part=moment-compare]:not([hidden]) [data-part^=compare-] img')].map((i) => i.src.length + ':' + i.src.slice(-40)))`);
    assert.ok(pics.length === 2 && pics[0] !== pics[1], 'Before and After are two different pictures');
    console.log(`  ok: Before / After at ${ga.t.toFixed(2)} s — ${ga.down} / ${ga.count} down with dominoes twice as tall (Before ${gm.down})`);
    await shot('before-after');
    assert.deepEqual(errors(), [], 'no errors in the console');
  } finally {
    await agent.stop();
    await page.close().catch(() => {});
    await browser.close();
    await srv.close();
    rmSync(root, { recursive: true, force: true });
  }
}

try {
  await run();
  console.log('✓ domino: all checks passed');
} catch (e) {
  console.error(e);
  console.log('✗ domino: failed');
  process.exitCode = 1;
}
