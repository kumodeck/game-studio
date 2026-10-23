// Ask your AI while playing (CONTRACT.md §3.5, 2026-10-20) in a headless browser: the real local server, the built
// editor, a small three.js game with a bug on purpose (test/play-ask/vanish: standing still on the pad hides the
// hero) and a stand-in agent that does what the arrange skill says for a `play` request.
//
//   node test/studio-play-ask.browser.mjs [--only pc|others|phone] [--shots <dir>] [--lang ja]
//
// PC 1280×800 (mouse, keys):
// 1. ▶ Play shows the corner's one button, "❚❚ Pause and talk P" (plan step 6; the ✦ mark is the ` key only); the game
//    runs (no edit flag).
// 2. ` in the game opens the field over the game, focused; the game does not get the key (or the letters typed).
// 3. Enter keeps ONE `play` request: the words, a picture file (.studio/play/<id>.jpg, not black), the player's
//    camera (`view`), what was near (the hero and the pad), the console (the game's warning and an error); the game
//    is not reloaded and keeps running.
// 3b. The picture is a screenshot: the game's HTML UI is in it (the magenta score top right), the ask field is not, and
//    nothing typed in a game field goes with the request (2026-10-20: "it ignored the UI on screen").
// 4. The agent: received → working → fixes the code → done. The line over the game follows ("Your AI is looking" →
//    its note → its reply with Reload); the game is NOT reloaded by itself while playing.
// 4c. The fixed line ends with "More in Claude" (2026-10-21); the looking / fixing lines do not.
// 4b. The "fixed" line goes by itself once read (2026-10-20, src/shell/line-fade.ts): gone within 10 s + grace, the
//    corner mark's dot keeps a ring for the Reload that waits; ` brings the line back over the open field.
// 5. ` then Enter (empty) reloads: a new game page, still playing, and the fix is in (the hero stays on the pad).
// 6. The agent asks (`asking` with two choices): the question and its buttons over the game; a button keeps an
//    `answer` request.
// 7. Full screen (F, the game's own key): the corner mark is still drawn over the game (the top layer).
// Other kinds of game (2026-10-20, the picture now paints HTML too): a game made of HTML only (examples/dom-board:
// before, no canvas meant no picture at all) and a canvas game with no HTML UI (examples/canvas-stars) still give a
// picture that is not blank, and nothing breaks.
// Phone 390×844 (touch): no corner mark over the game (it sat on the game's words at its foot, Ive review 3 ④); ✦ in
// the top bar, left of Edit, opens the field; its placeholder fits on one line; words + Enter keep a `play` request
// with a picture.
// PC also checks the mark (Ive review 3 ④): ✦ (the ask field's spark), and once it is small, the pointer on it shows
// "Ask your AI `" again.
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
    return { pause: (() => { const b = q('[data-part=pause-button]'); return b && !b.hidden ? { ...box(b), text: b.textContent } : null; })(), mark: !q('.mark').hidden, markReady: q('.mark').classList.contains('ready'), markBox: box(q('.mark')), markSmall: q('.mark').classList.contains('small'), bar: !q('.bar').hidden,
      focused: r.activeElement === q('input'), value: q('input').value, placeholder: q('input').placeholder,
      line: q('.line').hidden ? '' : q('.line').textContent, lineState: q('.line').hidden ? '' : (q('.line').classList.contains('busy') ? 'busy' : 'still'),
      reload: (() => { const b = q('[data-action=play-reload]'); return b ? box(b) : null; })(),
      choices: [...r.querySelectorAll('.choices button')].map((b) => ({ text: b.textContent, ...box(b) })),
      open: h.matches(':popover-open'), fs: !!${FR}.contentDocument.fullscreenElement, spark: !!q('.mark .spark svg') && !!q('.bar .spark svg'),
      // The placeholder's width in the field's own font against the field (one line, not cut).
      phFits: (() => { const i = q('input'); const c = document.createElement('canvas').getContext('2d'); const st = getComputedStyle(i); c.font = st.font; return c.measureText(i.placeholder).width <= i.clientWidth; })() }; })())`,
  marker: `${FR}.contentWindow.__playMark === 1`,
  heroVisible: `${FR}.contentWindow.__game.hero.visible`,
  gameKeys: `JSON.stringify(${FR}.contentWindow.__keysSeen || [])`,
};
const j = async (page, expr) => JSON.parse((await page.eval(expr)) || 'null');

function gameCopy(from = 'test/play-ask/vanish') {
  const root = mkdtempSync(join(tmpdir(), 'studio-play-ask-'));
  cpSync(join(PKG, from), root, { recursive: true });
  // An example's adapter (.studio/adapter.js) stays; what earlier runs left does not.
  for (const f of ['placement.json', '.studio/requests', '.studio/status.json', '.studio/watch.json', '.studio/play', '.studio/undo']) rmSync(join(root, f), { recursive: true, force: true });
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
  // Started as from Claude Code (which-ai.mjs), whatever runs the test: the line says "More in Claude" (4c).
  const srv = await startStudioServer({ root, uiDir: join(PKG, 'skills/arrange/bin/studio-ui'), log: () => {}, env: { CLAUDECODE: '1' } });
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
    // Plan step 6: one button in the corner, with its words; the ✦ mark is not there (` still opens the field, below).
    assert.equal(o.mark, false, 'no ✦ mark in the corner');
    assert.match(o.pause?.text || '', LANG === 'ja' ? /止めて話す.*P/ : /Pause and talk.*P/, `"❚❚ Pause and talk P" in the corner: ${o.pause?.text}`);
    assert.equal(o.bar, false);
    assert.equal(o.open, true, 'the overlay is in the top layer');
    assert.equal(o.spark, true, 'the field carries ✦');
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 640, y: 300 });
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
    // 3b. The HTML UI is in the picture: the magenta score, where the game page has it (2026-10-20: a screenshot).
    const box = await j(page, `JSON.stringify((() => { const w = ${FR}.contentWindow; const r = w.document.querySelector('.score').getBoundingClientRect();
      return { x: (r.right - 6) / w.innerWidth, y: (r.top + r.height / 2) / w.innerHeight }; })())`);
    const px = await page.eval(`new Promise((ok) => { const i = new Image(); i.onload = () => { const c = document.createElement('canvas'); c.width = i.width; c.height = i.height;
      const g = c.getContext('2d'); g.drawImage(i, 0, 0); const d = g.getImageData(Math.round(${box.x} * i.width) - 4, Math.round(${box.y} * i.height) - 2, 4, 4).data; ok(JSON.stringify([d[0], d[1], d[2]])); };
      i.src = 'data:image/jpeg;base64,${readFileSync(jpg).toString('base64')}'; })`);
    const [pr, pg, pb] = JSON.parse(px);
    assert.ok(pr > 190 && pg < 110 && pb > 120, `the score's magenta is in the picture (got rgb ${px})`);
    // What is typed in a game field and the ask field's words are not in the request (only the person's words are).
    const raw = JSON.stringify({ ...rec, text: undefined });
    assert.ok(!raw.includes('my secret name') && !raw.includes(text.slice(0, 10)), 'nothing typed goes with the request but the words');
    console.log(`  ok: the picture has the HTML UI (score rgb ${px})`);
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
    // The AI's name since plan step 1 (2026-10-23): Claude / Codex in their terminal (inherited), "Your AI" elsewhere.
    assert.match(all, LANG === 'ja' ? /(Claude |Codex |AI )が見ています/ : /(Claude|Codex|Your AI) is looking/);
    assert.match(all, /Keeping the hero on screen on the pad/);
    assert.match(fixed.line, /no longer vanishes/);
    assert.equal(await page.eval(IN.marker), true, 'not reloaded while playing, even after done');
    // 4c. "More in Claude" at the end of the small row once the AI is done (2026-10-21, as the editor's line), and not
    // while it looked or fixed (shell/play-ask.ts, ai-flow.ts moreIn).
    const more = LANG === 'ja' ? '詳しくは Claude で' : 'More in Claude';
    assert.ok(fixed.line.endsWith(more + (LANG === 'ja' ? '読み込み直す×' : 'Reload×')), `the fixed line ends with "${more}": ${fixed.line}`);
    assert.ok([...seen].filter((l) => /(Claude|Codex|Your AI) is looking|が見ています|Keeping the hero/.test(l)).every((l) => !l.includes(more)), 'no "More in" while it looks / fixes');
    await shot(page, '5-fixed');
    // 4b. The fixed line goes by itself (no pointer on it: the last click was on the game); the Reload waits.
    const t0 = Date.now();
    await page.waitFor(`(() => { const o = JSON.parse(${IN.ov}); return o.line === '' && o.markReady; })()`, 10_000 + 2000 + 400 + 2000);
    const gone = Date.now() - t0;
    assert.equal(await page.eval(IN.marker), true, 'fading is not reloading');
    await shot(page, '5b-fixed-faded');
    console.log(`  ok: the fixed line went by itself (${gone} ms after it was first seen fixed); the mark keeps the Reload`);
    // 5. ` then Enter on the empty field: reload, still playing, fixed.
    await page.click(640, 300);
    await keyIn(page, '`', 'Backquote', '`');
    await page.waitFor(`JSON.parse(${IN.ov}).bar`, 3000);
    o = await j(page, IN.ov);
    assert.match(o.line, /no longer vanishes/, 'the field open again brings the faded line back');
    await shot(page, '5c-fixed-recalled');
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
      const top = await page.eval(`(() => { const d = ${FR}.contentDocument; const b = ${OV}.shadowRoot.querySelector('[data-part=pause-button]').getBoundingClientRect(); return d.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)?.tagName; })()`);
      assert.equal(top, 'GAME-STUDIO-PLAY', 'the corner button is on top in full screen');
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

/** The mean brightness and how many distinct colours a JPEG has (a blank or black picture has one). */
async function pictureLook(page, jpg) {
  return j(page, `new Promise((ok) => { const i = new Image(); i.onload = () => { const c = document.createElement('canvas'); c.width = 64; c.height = 40;
    const g = c.getContext('2d'); g.drawImage(i, 0, 0, 64, 40); const d = g.getImageData(0, 0, 64, 40).data; let s = 0; const cols = new Set();
    for (let k = 0; k < d.length; k += 4) { s += d[k] + d[k + 1] + d[k + 2]; cols.add((d[k] >> 5) + ',' + (d[k + 1] >> 5) + ',' + (d[k + 2] >> 5)); }
    ok(JSON.stringify({ mean: Math.round(s / (d.length / 4) / 3), colours: cols.size })); }; i.onerror = () => ok('null'); i.src = 'data:image/jpeg;base64,${readFileSync(jpg).toString('base64')}'; })`);
}

async function others() {
  for (const game of ['examples/dom-board', 'examples/canvas-stars']) {
    console.log(`${game} (PC)`);
    const root = gameCopy(game);
    const { srv, browser, page } = await open(root, false);
    try {
      await page.click(640, 300);
      await keyIn(page, '`', 'Backquote', '`');
      await page.waitFor(`JSON.parse(${IN.ov}).bar`, 3000);
      await page.send('Input.insertText', { text: 'Make the board bigger' });
      await keyIn(page, 'Enter', 'Enter', '\r');
      let recs = [];
      for (let i = 0; !recs.length && i < 60; i++) await sleep(100), recs = requests(root).filter((r) => r.kind === 'play');
      assert.equal(recs.length, 1, 'one play request');
      assert.ok(recs[0].shot, 'a picture');
      const look = await pictureLook(page, join(root, recs[0].shot));
      assert.ok(look && look.colours > 3 && look.mean > 20, `the picture is not blank: ${JSON.stringify(look)}`);
      assert.equal(await page.eval(IN.marker), true, 'the game was not reloaded');
      console.log(`  ok: a picture (${statSync(join(root, recs[0].shot)).size} B, ${look.colours} colours)`);
      if (SHOTS) cpSync(join(root, recs[0].shot), join(SHOTS, `other-${game.split('/').pop()}.jpg`));
    } finally {
      await page.close();
      browser.close();
      srv.close();
      rmSync(root, { recursive: true, force: true });
    }
  }
}

async function phone() {
  console.log('phone 390×844');
  const root = gameCopy();
  const { srv, browser, page } = await open(root, true);
  try {
    await page.waitFor(`!!document.querySelector('[data-action=play-ask]')?.offsetParent`, 5000);
    let o = await j(page, IN.ov);
    assert.equal(o.mark, false, 'no corner mark over the game on a phone');
    // ✦ in the top bar: left of Edit, big enough for a finger, inside the bar (not over the game).
    const b = JSON.parse(await page.eval(`JSON.stringify((() => { const r = (s) => document.querySelector(s).getBoundingClientRect(); const a = r('[data-action=play-ask]'), e = r('button.play'), t = r('header.top'), f = ${FR}.getBoundingClientRect();
      return { x: a.left + a.width / 2, y: a.top + a.height / 2, w: a.width, h: a.height, right: a.right, editLeft: e.left, inBar: a.top >= t.top && a.bottom <= t.bottom, gameTop: f.top }; })())`));
    assert.ok(b.w >= 44 && b.h >= 36, `✦ is big enough to tap (${b.w}×${b.h})`);
    assert.ok(b.right <= b.editLeft + 1 && b.inBar, `✦ is in the top bar, left of Edit ${JSON.stringify(b)}`);
    await shot(page, 'phone-1-playing');
    await page.tap(b.x, b.y);
    await page.waitFor(`JSON.parse(${IN.ov}).bar`, 3000);
    o = await j(page, IN.ov);
    assert.equal(o.phFits, true, `the placeholder fits on one line ("${o.placeholder}")`);
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
if (!ONLY || ONLY === 'others') await others();
if (!ONLY || ONLY === 'phone') await phone();
console.log('studio-play-ask: ok');
process.exit(0);
