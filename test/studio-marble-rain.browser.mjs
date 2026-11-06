// Marble Rain (starters/marble-rain, sample shelf, 2026-11-06) in the real editor, headless: the three things the
// shelf promises for it, in the order a person meets them, and that the marbles' physics never reaches the save.
//
//   node test/studio-marble-rain.browser.mjs [--shots <dir>] [--lang en|ja]
//
// 1. Open: the editor lists the spout and the 75 pins — and nothing else (the marbles are bare Matter bodies drawn by
//    images marked `studio = false`, so none of them can be picked, moved or saved).
// 2. Move: the top pin (`try.move`, pin-1-2) dragged with the mouse; Save writes placement.json with that pin only.
// 3. ▶ Play: the rain over the new layout, the pin where it was put. Edit, move it again, Save, ▶ Play: the rain is the
//    new layout's from step 0, worked out again up to the game's clock (so the editor's Try at the same second matches).
//    After playing, the save still holds that one pin (Matter's moving bodies did not leak into placement.json).
// 4. Paused while the marbles pour (`try.pauseAt`, P), ◎ on a spot just above the pins, "Add a spinning paddle here."
//    (`try.ask`): the stand-in AI (test/ai-feel/fake-agent.mjs marbleRainPaddle) writes one paddle at the mark into
//    game.js; the reply offers Before / After; the After is the new code at the same second, with the paddle.
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStudioServer } from '../src/server/server.mjs';
import { launch, newPage } from './adapters-2d/cdp.mjs';
import { marbleRainPaddle, startFakeAgent } from './ai-feel/fake-agent.mjs';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const UI = join(PKG, 'skills/arrange/bin/studio-ui');
const STARTER = join(PKG, 'starters/marble-rain');
const TRY = JSON.parse(readFileSync(join(STARTER, 'starter.json'), 'utf8')).try;
const args = process.argv.slice(2);
const take = (flag, d = null) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : d;
};
const SHOTS = take('--shots') ? resolve(take('--shots')) : null;
const LANG = take('--lang', 'en');
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FR = `document.querySelector('iframe.game:not(.leaving)')`;
const GW = `${FR}.contentWindow`;
const SHELL = `document.querySelector('.shell')`;
const IN = {
  edit: `${SHELL}.dataset.playing === 'off' && document.querySelectorAll('.obj, .noname').length > 0 && !!${GW}?.__gameStudio?._debug`,
  playing: `${SHELL}.dataset.playing === 'on' && !${GW}?.__gameStudio?._debug && !!${GW}?.marbleRain`,
  moment: `${SHELL}.dataset.moment === 'on' && ${SHELL}.dataset.paused === 'on'`,
};
const box = (sel) => `(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.offsetParent && !x.hidden); if (!e) return null;
  const r = e.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2, text: e.textContent.replace(/\\s+/g, ' ').trim() }); })()`;
const j = async (page, expr) => JSON.parse((await page.eval(expr)) || 'null');
async function until(fn, ms = 10000, what = 'condition') {
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
const replyButtons = (page) => j(page, `JSON.stringify([...document.querySelectorAll('.ai-line button')].filter((b) => b.offsetParent).map((b) => b.dataset.action))`);

let failed = 0;
const check = (ok, what) => {
  console.log(`  ${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failed++;
};

/** A board point (1280 × 800) on the editor's page: the game's canvas inside its frame, scaled to fit. */
const boardToPage = (x, y) => `JSON.stringify((() => { const f = ${FR}.getBoundingClientRect(), c = ${FR}.contentDocument.querySelector('canvas').getBoundingClientRect();
  const k = c.width / 1280; return [f.left + c.left + ${x} * k, f.top + c.top + ${y} * k]; })())`;
/** An object's pose point on the editor's page (Edit only: `_debug`). */
const posePage = (key) => `JSON.stringify((() => { const d = ${GW}.__gameStudio._debug, f = ${FR}.getBoundingClientRect(); const it = d.list().find((i) => i.key === ${JSON.stringify(key)});
  const q = it && d.toScreen(it.pose.p); return q ? { p: it.pose.p, x: f.left + q[0], y: f.top + q[1] } : null; })())`;
const savedKeys = (root) => {
  const f = join(root, 'placement.json');
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')).objects || {} : null;
};

async function dragPin(page, dx) {
  const a = await j(page, posePage(TRY.move));
  // Press on the pin (it is picked), then drag it in small steps (a person's drag), and let go.
  await page.click(a.x, a.y);
  await until(() => page.eval(`window.studioShell.selected() === ${JSON.stringify(TRY.move)}`), 3000, `${TRY.move} picked`);
  await sleep(400);
  await page.mouseDrag(a.x, a.y, a.x + dx, a.y, 12);
  await sleep(600);
  return { from: a.p, to: (await j(page, posePage(TRY.move))).p };
}

async function save(page, root) {
  const s = await until(() => j(page, box('[data-part=save]')), 5000, 'the Save beside Play');
  await page.click(s.x, s.y);
  await until(() => savedKeys(root), 8000, 'placement.json');
  await sleep(600);
}

async function play(page) {
  const p = await j(page, box('[data-action=play]'));
  await page.click(p.x, p.y);
  await page.waitFor(IN.playing, 30000);
}

async function run() {
  console.log(`Marble Rain in the editor, PC 1280×800, ${LANG}`);
  const root = mkdtempSync(join(tmpdir(), 'studio-marble-rain-'));
  cpSync(STARTER, root, { recursive: true, filter: (p) => !/\/(starter\.json|thumb\.png|README\.md)$/.test(p) });
  mkdirSync(join(root, '.studio/ui'), { recursive: true });
  writeFileSync(join(root, '.studio/ui/prefs.json'), JSON.stringify({ version: 1, lang: LANG }));
  const srv = await startStudioServer({ root, uiDir: UI, log: () => {}, env: { CLAUDECODE: '1' } });
  const agent = startFakeAgent(root, { fix: marbleRainPaddle });
  const browser = await launch();
  const page = await newPage(browser, { width: 1280, height: 800 });
  let n = 0;
  const shot = async (what) => {
    if (!SHOTS) return;
    const f = `marble-rain-${LANG}-${String(++n).padStart(2, '0')}-${what}.png`;
    writeFileSync(join(SHOTS, f), await page.screenshot());
    console.log(`  shot ${f}`);
  };
  try {
    await page.goto(srv.url);
    await page.waitFor(IN.edit, 90000);
    await sleep(1500);
    // 1. What the editor lists.
    const keys = await j(page, `JSON.stringify(${GW}.__gameStudio._debug.list().map((i) => i.key))`);
    const pins = keys.filter((k) => /^pin-\d+-\d+$/.test(k));
    check(pins.length === 75 && keys.includes('spout'), `the spout and 75 pins listed (${pins.length} pins)`);
    check(keys.every((k) => /^(spout|pin-\d+-\d+|paddle-\d+)$/.test(k)), `nothing else: no marble, glow or backdrop (${keys.length} in all)`);
    await shot('open');

    // 2. Move the top pin and save.
    // 40 px: half way to its neighbour (pin-1-3, 80 px to the right), so the next press still finds this pin.
    const m1 = await dragPin(page, 40);
    check(m1.to[0] - m1.from[0] > 20 && Math.abs(m1.to[1] - m1.from[1]) < 3, `${TRY.move} dragged right (${m1.from.map(Math.round)} → ${m1.to.map(Math.round)})`);
    await shot('moved');
    await save(page, root);
    let saved = savedKeys(root);
    check(JSON.stringify(Object.keys(saved)) === JSON.stringify([TRY.move]), `Save: placement.json holds ${TRY.move} only (${Object.keys(saved).join(', ')})`);

    // 3. Play: the rain over the new layout.
    await play(page);
    await sleep(3000);
    const p1 = await j(page, `JSON.stringify({ step: ${GW}.marbleRain.step(), n: ${GW}.marbleRain.count(), seen: ${GW}.marbleRain.seen(), pin: ${GW}.__gameStudio._play.list().find((i) => i.key === ${JSON.stringify(TRY.move)})?.pose.p })`);
    check(p1.n > 40 && p1.step > 120, `▶ Play: it rains (${p1.n} marbles at step ${p1.step})`);
    check(!!p1.pin && Math.abs(p1.pin[0] - m1.to[0]) < 0.5, `the pin plays where it was put (x ${p1.pin?.[0]?.toFixed(1)})`);
    await shot('play');
    // Back to Edit, move it again, Save, Play.
    await play(page).catch(() => {}); // the same button: back to Edit (waitFor playing fails: expected)
    await page.waitFor(IN.edit, 30000);
    await sleep(800);
    const m2 = await dragPin(page, -25);
    check(m2.to[0] < m2.from[0] - 10, `moved again (${m2.from.map(Math.round)} → ${m2.to.map(Math.round)})`);
    await save(page, root);
    await play(page);
    await sleep(1000);
    const p2 = await j(page, `JSON.stringify({ step: ${GW}.marbleRain.step(), seen: ${GW}.marbleRain.seen() })`);
    // The rain is worked out again with the new layout up to where the clock is (game.js replay()): the step goes on
    // (the editor's "same second" counts this clock, and its Try plays a fresh page to it), and the first seconds are
    // the new layout's (another fall than the first Play's).
    check(p2.step > p1.step, `▶ Play after the move: the rain goes on from the game's clock (step ${p2.step}, was ${p1.step})`);
    check(p2.seen[60] !== undefined && p2.seen[60] !== p1.seen[60] && p2.seen[120] !== p1.seen[120], 'and is the new layout\'s rain from step 0 (another fall at 1 s and 2 s)');
    saved = savedKeys(root);
    check(JSON.stringify(Object.keys(saved)) === JSON.stringify([TRY.move]) && Math.abs(saved[TRY.move].p[0] - m2.to[0]) < 0.5,
      `after playing: still ${TRY.move} only, where it was put (no marble or physics pose leaked: ${Object.keys(saved).join(', ')})`);

    // 4. Pause while the marbles pour, mark a spot, ask.
    await sleep(Math.max(0, TRY.pauseAt * 1000 - 1000));
    await page.eval(`(${GW}.focus(), true)`);
    await keyIn(page, 'p', 'KeyP', 'p');
    await page.waitFor(IN.moment, 3000).catch(async () => {
      console.log('  · P did not reach the game: ❚❚ pressed instead');
      await page.eval(`document.querySelector('[data-part=play-pause]').click()`);
      await page.waitFor(IN.moment, 10000);
    });
    await sleep(500);
    await page.eval(`(document.activeElement?.blur?.(), true)`);
    await shot('paused');
    const before = await j(page, `JSON.stringify({ step: ${GW}.marbleRain.step(), n: ${GW}.marbleRain.count() })`);
    const mk = await j(page, box('[data-action=moment-mark]'));
    await page.click(mk.x, mk.y);
    await sleep(200);
    const [mx, my] = await j(page, boardToPage(640, 118));
    await page.click(mx, my);
    await sleep(400);
    await page.eval(`(document.querySelector('.ask-input').focus(), true)`);
    await page.send('Input.insertText', { text: (LANG !== 'en' && JSON.parse(readFileSync(join(STARTER, 'strings.json'), 'utf8'))[LANG]?.try?.ask) || TRY.ask.en });
    await shot('ask');
    await keyIn(page, 'Enter', 'Enter', '\r');
    await until(async () => (await replyButtons(page)).includes('moment-compare'), 60000, 'the reply with Before / After');
    check(true, `the reply: ${(await replyButtons(page)).join(' · ')}`);
    const line = /const PADDLES = \[\[(\d+), (\d+)\]\];/.exec(readFileSync(join(root, 'game.js'), 'utf8'));
    check(!!line && Math.abs(line[1] - 640) < 25 && Math.abs(line[2] - 118) < 25, `the paddle went where the mark was (${line ? `${line[1]}, ${line[2]}` : 'none'})`);
    // Before / After: the Try at the same second with the new code.
    const cmp = await j(page, box('[data-action=moment-compare]'));
    await page.click(cmp.x, cmp.y);
    const AFTER = `!!document.querySelector('[data-part=moment-compare]:not([hidden]) [data-part=compare-after] img')`;
    await page.waitFor(`!!document.querySelector('[data-part=moment-compare]:not([hidden]) [data-part=compare-before] img')`, 10000);
    await until(() => page.eval(AFTER), 240000, 'the After');
    check(true, 'Before / After: both pictures');
    const after = await j(page, `JSON.stringify({ paddles: ${GW}.marbleRain?.paddles?.() ?? null, step: ${GW}.marbleRain?.step?.() ?? null })`);
    check(after.paddles === 1, `the After is the new code: one paddle in the game (${after.paddles}, step ${after.step})`);
    // The same moment of the rain: the Try's page is at the step the paused page was (the editor allows a frame or so
    // of its clock; 45 steps = 0.75 s, its "may be 0.6 s ahead" note), not a rain started at another time.
    check(Math.abs(after.step - before.step) <= 45, `Before and After are the same moment of the rain (step ${before.step} / ${after.step})`);
    await shot('before-after');
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
} catch (e) {
  console.error(e);
  failed++;
}
console.log(failed ? `✗ ${failed} check(s) failed` : '✓ all checks passed');
process.exit(failed ? 1 : 0);
