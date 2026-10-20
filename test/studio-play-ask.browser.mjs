// Ask your AI while playing (CONTRACT.md §3.5, 2026-10-20) in a headless browser: the real local server, the built
// editor, a small three.js game with a bug on purpose (test/play-ask/vanish: standing still on the pad hides the
// hero) and a stand-in agent that does what the arrange skill says for a `play` request.
//
//   node test/studio-play-ask.browser.mjs [--only pc|phone] [--shots <dir>] [--lang ja]
//
// PC 1280×800 (mouse, keys):
// 1. ▶ Play shows the corner mark ("Ask your AI `"); the game runs (no edit flag).
// 2. ` in the game opens the field over the game, focused; the game does not get the key (or the letters typed).
// 3. Enter keeps ONE `play` request: the words, a picture file (.studio/play/<id>.jpg, not black), the player's
//    camera (`view`), what was near (the hero and the pad), the console (the game's warning and an error); the game
//    is not reloaded and keeps running.
// 4. The agent: received → working → fixes the code → done. The line over the game follows ("Your AI is looking" →
//    its note → its reply with Reload); the game is NOT reloaded by itself while playing.
// 5. ` then Enter (empty) reloads: a new game page, still playing, and the fix is in (the hero stays on the pad).
// 6. The agent asks (`asking` with two choices): the question and its buttons over the game; a button keeps an
//    `answer` request.
// 7. Full screen (F, the game's own key): the corner mark is still drawn over the game (the top layer).
// Phone 390×844 (touch): a tap on the corner mark opens the field; words + Enter keep a `play` request with a picture.
// --shots <dir>: photos of each step (playing, typing, looking, fixed, full screen, phone).
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { startStudioServer } from '../src/server/server.mjs';
import { launch, newPage } from './adapters-2d/cdp.mjs';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(PKG, 'skills/arrange/bin/studio.mjs');
const args = process.argv.slice(2);
const take = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args.splice(i, 2)[1] : null;
};
const shotsArg = take('--shots');
const SHOTS = shotsArg ? resolve(shotsArg) : null;
const ONLY = take('--only');
const LANG = take('--lang');
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FR = `document.querySelector('iframe.game:not(.leaving)')`;
const OV = `${FR}.contentDocument.querySelector('game-studio-play')`;
const IN = {
  ready: `document.querySelectorAll('.obj').length > 0 && !!${FR}?.contentWindow?.__gameStudio?._debug`,
  playing: `document.querySelector('.shell').dataset.playing === 'on' && !!${OV}?.shadowRoot?.querySelector('.mark')`,
  // The overlay's parts, as the person sees them (hidden or not, the line's words, the field's focus).
  ov: `JSON.stringify((() => { const h = ${OV}; if (!h) return null; const r = h.shadowRoot; const q = (s) => r.querySelector(s);
    const f = ${FR}.getBoundingClientRect(); const box = (e) => { const b = e.getBoundingClientRect(); return { x: f.left + b.left + b.width / 2, y: f.top + b.top + b.height / 2, w: b.width, h: b.height }; };
    return { mark: !q('.mark').hidden, markBox: box(q('.mark')), markSmall: q('.mark').classList.contains('small'), bar: !q('.bar').hidden,
      focused: r.activeElement === q('input'), value: q('input').value, placeholder: q('input').placeholder,
      line: q('.line').hidden ? '' : q('.line').textContent, lineState: q('.line').hidden ? '' : (q('.line').classList.contains('busy') ? 'busy' : 'still'),
      reload: (() => { const b = q('[data-action=play-reload]'); return b ? box(b) : null; })(),
      choices: [...r.querySelectorAll('.choices button')].map((b) => ({ text: b.textContent, ...box(b) })),
      open: h.matches(':popover-open'), fs: !!${FR}.contentDocument.fullscreenElement }; })())`,
  marker: `${FR}.contentWindow.__playMark === 1`,
  heroVisible: `${FR}.contentWindow.__game.hero.visible`,
  gameKeys: `JSON.stringify(${FR}.contentWindow.__keysSeen || [])`,
};
const j = async (page, expr) => JSON.parse((await page.eval(expr)) || 'null');

function gameCopy() {
  const root = mkdtempSync(join(tmpdir(), 'studio-play-ask-'));
  cpSync(join(PKG, 'test/play-ask/vanish'), root, { recursive: true });
  if (LANG) {
    mkdirSync(join(root, '.studio/ui'), { recursive: true });
    writeFileSync(join(root, '.studio/ui/prefs.json'), JSON.stringify({ version: 1, lang: LANG }));
  }
  return root;
}
const requests = (root) => (existsSync(join(root, '.studio/requests')) ? readdirSync(join(root, '.studio/requests')) : []).filter((n) => n.endsWith('.json')).sort()
  .map((n) => JSON.parse(readFileSync(join(root, '.studio/requests', n), 'utf8')));
const status = (root, ...a) => {
  const r = spawnSync(process.execPath, [CLI, root, '--status', ...a], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
};

async function shot(page, name) {
  if (!SHOTS) return;
  writeFileSync(join(SHOTS, `${name}.png`), await page.screenshot());
  console.log(`  shot ${name}.png`);
}

async function keyIn(page, key, code, text) {
  const down = { type: 'keyDown', key, code, windowsVirtualKeyCode: key === 'Enter' ? 13 : key.toUpperCase().charCodeAt(0), text };
  await page.send('Input.dispatchKeyEvent', down);
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code });
}

async function open(root, mobile) {
  const srv = await startStudioServer({ root, uiDir: join(PKG, 'skills/arrange/bin/studio-ui'), log: () => {} });
  const browser = await launch();
  const page = await newPage(browser, mobile ? { width: 390, height: 844, mobile: true } : { width: 1280, height: 800 });
  await page.goto(srv.url);
  await page.waitFor(IN.ready, 90000);
  // ▶ Play (P in the editor page).
  await page.eval(`document.querySelector('button.play').click()`);
  await page.waitFor(IN.playing, 30000);
  // A key logger in the game page AFTER the bridge's (the game's own listeners always come after it), and a marker
  // that a reload would lose.
  await page.eval(`(() => { const w = ${FR}.contentWindow; w.__playMark = 1; w.__keysSeen = []; w.addEventListener('keydown', (e) => w.__keysSeen.push(e.key)); return true; })()`);
  return { srv, browser, page };
}

/** The stand-in agent: the watch, then received → working → the fix → done for the first `play` request. */
function agent(root, { fix = true } = {}) {
  const w = spawn(process.execPath, [CLI, root, '--watch', '--for', '5'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const lines = [];
  const handled = new Set();
  createInterface({ input: w.stdout }).on('line', async (line) => {
    lines.push(line);
    const m = /^studio: request play (\S+)/.exec(line);
    if (!m) return;
    const rec = JSON.parse(readFileSync(join(root, m[1]), 'utf8'));
    if (handled.has(rec.id)) return;
    handled.add(rec.id);
    await sleep(900);
    status(root, 'received', '--request', rec.id);
    await sleep(1500);
    status(root, 'working', '--request', rec.id, '--note', 'Keeping the hero on screen on the pad');
    await sleep(1800);
    if (fix) {
      const f = join(root, 'game.js');
      writeFileSync(f, readFileSync(f, 'utf8').split('\n').filter((l) => !l.includes('BUG')).join('\n').replace("console.warn('hero hidden: idle on pad');", ''));
    }
    await sleep(600);
    status(root, 'done', '--request', rec.id, '--changed', '0', '--note', 'Fixed: the hero no longer vanishes on the pad');
  });
  return { stop: () => w.kill(), lines };
}

async function pc() {
  console.log('PC 1280×800');
  const root = gameCopy();
  const { srv, browser, page } = await open(root, false);
  const ag = agent(root);
  try {
    let o = await j(page, IN.ov);
    assert.equal(o.mark, true, 'the corner mark is shown in Play');
    assert.equal(o.bar, false);
    assert.equal(o.open, true, 'the overlay is in the top layer');
    await shot(page, '1-playing');
    // The bug: the hero on the pad, standing still → gone. An error in the console too.
    await page.eval(`${FR}.contentWindow.__game.hero.position.set(4, 0.8, -2), ${FR}.contentWindow.console.error('TypeError: pad.material.map is undefined'), true`);
    await page.waitFor(`!${IN.heroVisible}`, 5000);
    // Focus the game (a click on it), then ` .
    await page.click(640, 300);
    await keyIn(page, '`', 'Backquote', '`');
    await page.waitFor(`JSON.parse(${IN.ov}).bar`, 3000);
    o = await j(page, IN.ov);
    assert.equal(o.focused, true, 'the field has the keys');
    assert.equal(o.mark, false, 'the mark steps aside for the field');
    const text = LANG === 'ja' ? 'ここで止まるとキャラが消えた' : 'When I stop here the character vanishes';
    for (const ch of text) await page.send('Input.insertText', { text: ch });
    await keyIn(page, 'w', 'KeyW', 'w');
    await page.eval(`(() => { const r = ${OV}.shadowRoot.querySelector('input'); return r.value; })()`);
    assert.deepEqual(await j(page, IN.gameKeys), [], 'the game saw none of the keys meant for the field');
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace' });
    await shot(page, '2-typing');
    await keyIn(page, 'Enter', 'Enter', '\r');
    await page.waitFor(`!JSON.parse(${IN.ov}).bar`, 5000);
    // 3. One play request with the moment.
    let recs = requests(root).filter((r) => r.kind === 'play');
    for (let i = 0; !recs.length && i < 50; i++) await sleep(100), recs = requests(root).filter((r) => r.kind === 'play');
    assert.equal(recs.length, 1);
    const rec = recs[0];
    assert.equal(rec.text, text);
    assert.match(rec.shot, /^\.studio\/play\/\d{8}-\d{6}-\d{3}-play-[0-9a-f]{4}\.jpg$/);
    const jpg = join(root, rec.shot);
    assert.ok(statSync(jpg).size > 4000, `the picture is a picture (${statSync(jpg).size} bytes)`);
    // Not black (a WebGL canvas read after its frame was shown is black unless its buffer is kept): the ground's green.
    const light = await page.eval(`new Promise((ok) => { const i = new Image(); i.onload = () => { const c = document.createElement('canvas'); c.width = 64; c.height = 40;
      const g = c.getContext('2d'); g.drawImage(i, 0, 0, 64, 40); const d = g.getImageData(0, 0, 64, 40).data; let s = 0; for (let k = 0; k < d.length; k += 4) s += d[k] + d[k + 1] + d[k + 2];
      ok(s / (d.length / 4) / 3); }; i.onerror = () => ok(-1); i.src = 'data:image/jpeg;base64,${readFileSync(jpg).toString('base64')}'; })`);
    assert.ok(light > 25, `the picture is not black (mean ${light})`);
    assert.ok(rec.view && Math.abs(rec.view.eye[0] - 4) < 0.6 && Math.abs(rec.view.eye[2] - 5) < 0.6, `the player's camera: ${JSON.stringify(rec.view)}`);
    const near = (rec.near || []).map((n) => n.key);
    assert.ok(near.includes('hero') && near.includes('pad'), `near: ${near}`);
    assert.ok(!near.includes('ground'), 'the ground is not "near"');
    const logs = rec.logs || [];
    assert.ok(logs.some((l) => l.level === 'warn' && l.text.includes('hero hidden')), JSON.stringify(logs));
    assert.ok(logs.some((l) => l.level === 'error' && l.text.includes('pad.material.map')), JSON.stringify(logs));
    assert.equal(rec.dim, '3d');
    assert.equal(await page.eval(IN.marker), true, 'the game was not reloaded');
    console.log(`  ok: play request with picture (${statSync(jpg).size} B), view, near ${near.slice(0, 4)}, ${logs.length} log lines`);
    if (SHOTS) cpSync(jpg, join(SHOTS, '3-what-the-ai-gets.jpg'));
    // 4. The line follows the agent; no reload by itself.
    await page.waitFor(`JSON.parse(${IN.ov}).line.length > 0`, 5000);
    const seen = new Set();
    let fixed = null;
    for (let i = 0; i < 200 && !fixed; i++) {
      o = await j(page, IN.ov);
      if (o.line && !seen.has(o.line)) {
        seen.add(o.line);
        console.log(`  line: ${o.line}`);
        if (/Keeping the hero/.test(o.line)) await shot(page, '4-fixing');
      }
      if (o.reload) fixed = o;
      else await sleep(100);
    }
    assert.ok(fixed, 'the fixed line with Reload');
    const all = [...seen].join(' | ');
    assert.match(all, LANG === 'ja' ? /AI が見ています/ : /Your AI is looking/);
    assert.match(all, /Keeping the hero on screen on the pad/);
    assert.match(fixed.line, /no longer vanishes/);
    assert.equal(await page.eval(IN.marker), true, 'not reloaded while playing, even after done');
    await shot(page, '5-fixed');
    // 5. ` then Enter on the empty field: reload, still playing, fixed.
    await page.click(640, 300);
    await keyIn(page, '`', 'Backquote', '`');
    await page.waitFor(`JSON.parse(${IN.ov}).bar`, 3000);
    await keyIn(page, 'Enter', 'Enter', '\r');
    await page.waitFor(`${FR}.contentWindow.__playMark !== 1 && !!${OV}`, 15000);
    await page.waitFor(`!!${FR}.contentWindow.__game`, 15000);
    assert.equal(await page.eval(`document.querySelector('.shell').dataset.playing`), 'on', 'still playing');
    await page.eval(`${FR}.contentWindow.__game.hero.position.set(4, 0.8, -2), true`);
    await sleep(1800);
    assert.equal(await page.eval(IN.heroVisible), true, 'the fix is in: the hero stays on the pad');
    console.log('  ok: Reload → the fixed game, still playing');
    await sleep(500);
    await shot(page, '6-reloaded');
    // 6. A question over the game, answered there.
    status(root, 'asking', '--request', rec.id, '--note', 'Should the pad still glow?', '--choice', 'Keep the glow', '--choice', 'Turn it off');
    await page.waitFor(`JSON.parse(${IN.ov}).choices.length === 2`, 8000);
    o = await j(page, IN.ov);
    assert.match(o.line, /Should the pad still glow\?/);
    await shot(page, '7-asking');
    await page.click(o.choices[0].x, o.choices[0].y);
    let ans = [];
    for (let i = 0; !ans.length && i < 50; i++) await sleep(100), ans = requests(root).filter((r) => r.kind === 'answer');
    assert.equal(ans.length, 1, 'one answer request');
    assert.equal(ans[0].text, 'Keep the glow');
    assert.equal(ans[0].to, rec.id);
    console.log('  ok: the question answered over the game');
    status(root, 'done', '--request', ans[0].id, '--note', 'Kept the glow');
    // 7. Full screen (the game's own F): the mark still over it.
    await page.click(640, 300);
    await keyIn(page, 'f', 'KeyF', 'f');
    await sleep(800);
    o = await j(page, IN.ov);
    if (o.fs) {
      assert.equal(o.open, true, 'still in the top layer in full screen');
      const top = await page.eval(`(() => { const d = ${FR}.contentDocument; const b = ${OV}.shadowRoot.querySelector('.mark').getBoundingClientRect(); return d.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)?.tagName; })()`);
      assert.equal(top, 'GAME-STUDIO-PLAY', 'the mark is on top in full screen');
      await shot(page, '8-fullscreen');
      console.log('  ok: full screen keeps the mark on top');
    } else console.log('  note: headless Chrome did not enter full screen (checked only that it does not break)');
  } finally {
    ag.stop();
    await page.close();
    browser.close();
    srv.close();
    rmSync(root, { recursive: true, force: true });
  }
}

async function phone() {
  console.log('phone 390×844');
  const root = gameCopy();
  const { srv, browser, page } = await open(root, true);
  try {
    let o = await j(page, IN.ov);
    assert.equal(o.mark, true);
    assert.ok(o.markBox.w >= 44 && o.markBox.h >= 44, `the mark is big enough to tap (44 px) (${o.markBox.w}×${o.markBox.h})`);
    await shot(page, 'phone-1-playing');
    await page.tap(o.markBox.x, o.markBox.y);
    await page.waitFor(`JSON.parse(${IN.ov}).bar`, 3000);
    await page.send('Input.insertText', { text: 'The hero vanished on the pad' });
    await shot(page, 'phone-2-typing');
    await keyIn(page, 'Enter', 'Enter', '\r');
    let recs = [];
    for (let i = 0; !recs.length && i < 60; i++) await sleep(100), recs = requests(root).filter((r) => r.kind === 'play');
    assert.equal(recs.length, 1);
    assert.ok(recs[0].shot && statSync(join(root, recs[0].shot)).size > 3000, JSON.stringify({ ...recs[0], logs: undefined }));
    await page.waitFor(`JSON.parse(${IN.ov}).line.length > 0`, 5000);
    await shot(page, 'phone-3-sent');
    console.log(`  ok: tap → words → a play request (line: ${(await j(page, IN.ov)).line})`);
  } finally {
    await page.close();
    browser.close();
    srv.close();
    rmSync(root, { recursive: true, force: true });
  }
}

if (!ONLY || ONLY === 'pc') await pc();
if (!ONLY || ONLY === 'phone') await phone();
console.log('studio-play-ask: ok');
process.exit(0);
