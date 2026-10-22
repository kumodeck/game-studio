// Pause while playing and talk to your AI (2026-10-22, CONTRACT.md §3.5.1) in a headless browser: the
// real local server, the built editor, the starters, and the stand-in AI (test/ai-feel/fake-agent.mjs), which answers a
// paused message in its `done` note.
//
//   node test/studio-pause.browser.mjs [--only cove,ruins,glow,phone,side,dark,timers] [--shots <dir>] [--lang ja]
//                                       [--before <studio-ui dir of an older build>]
//
// cove  Lantern Cove (three.js) PC 1280×800:
//   1. ▶ Play shows ❚❚ left of the corner mark.
//   2. P in the game pauses: the game's frames stop (a frame loop of the page's own counts nothing for a second), its
//      clock stops (performance.now() in the game page stays put), the game never sees the P; the chat opens with its
//      field focused and says what the AI gets.
//   3. Words + Enter keep ONE `play` request marked `paused`, with the moment (a picture file, the camera, what was
//      near); .studio/chat/<id>.json has the person's turn. Still paused.
//   4. The stand-in AI answers: the reply is in the chat (and its turn in the file); still paused, nothing reloaded.
//   5. A second message carries `chat` (the first id) and `history` (2 turns); the reply follows the talk.
//   6. Paused, keys go nowhere: a key press does not reach the game, its release does (no key stays down).
//   7. P resumes: frames run again, and the game's clock and frame times step by one frame, not by the whole pause.
//   8. ❚❚ (the corner button) pauses, Resume (the chat's button) resumes.
// ruins Firefly Ruins (PixiJS, 2D): P pauses the Ticker; a message carries what is on screen (`near`); P resumes.
// glow  Glow Garden (three.js + HTML UI, a loop that animates from the frame's own timestamp): the timestamp after
//       Resume follows on from the one before the pause.
// phone 390×844 (touch) and side 400×900 (the side window): ❚❚ in the editor's top bar, left of ✦; the chat is a sheet at
//       the foot; the same button (now ▶) resumes.
// dark  the editor in its dark look (PC and phone), paused with a reply (photos only, plus the basic checks).
// timers Lantern Cove PC, a game stepped by timers and the wall clock (polish-1022, 2026-10-22; core/play-timers.ts):
//       an interval and a setTimeout chain set by the game page, and its Date.now(). Paused: none of them move; the
//       chat still answers (the studio's own timers run). Resume: they go on, and Date.now() steps by the time since
//       Resume, not the pause. Edit (the same page, held): they stand still again, a timer set while editing waits;
//       Play: they go on.
// --before <dir>: only photos of ▶ Play with an older build's editor (`skills/arrange/bin/studio-ui` of that build);
//       with --only timers, the timers run's pause photos (the counter goes on there).
//
// Stage 2, moving things while paused (bridge/play-move.ts, 2026-10-22):
// move   Lantern Cove PC: P, then Move in the panel: no veil, the card says to pick, the game still held. A still object
//        (the cottage, the pier…) picked and dragged: it moved, the card says "Only in this play" with Put in layout
//        and Put back, the game's frames and clock still held. Put in layout: Save · 1 in the editor's top bar.
//        Something the game moves itself (a boat): "Just for this moment", no Put in layout; dragged, then Put back:
//        where it was at the pause. P: the game goes on with the moved objects where they were left. Edit: the one put
//        in the layout is there (the editor's draft), Save · 1 still.
// move2d Firefly Ruins (Pixi 2D): the same pick, drag, Put in layout.
// moveglow Glow Garden (three.js + HTML UI): Move, a pick and a drag.
// movenarrow phone 390×844 (touch) and the side window 400×900, light and dark: Move from the sheet, a tap, a drag.
// movedark PC dark: photos of the card.
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStudioServer } from '../src/server/server.mjs';
import { launch, newPage } from './adapters-2d/cdp.mjs';
import { startFakeAgent } from './ai-feel/fake-agent.mjs';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const take = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args.splice(i, 2)[1] : null;
};
const shotsArg = take('--shots');
const SHOTS = shotsArg ? resolve(shotsArg) : null;
const ONLY = take('--only')?.split(',') || null;
const LANG = take('--lang') || 'en';
const BEFORE = take('--before');
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const ja = LANG === 'ja';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FR = `document.querySelector('iframe.game:not(.leaving)')`;
const GW = `${FR}.contentWindow`;
const OV = `${FR}.contentDocument.querySelector('game-studio-play')`;
const Q = (sel) => `${OV}?.shadowRoot?.querySelector('${sel}')`;
const LAYOUTS = {
  pc: { id: 'pc', width: 1280, height: 800, mobile: false, dpr: 1 },
  side: { id: 'side', width: 400, height: 900, mobile: false, dpr: 2 },
  phone: { id: 'phone', width: 390, height: 844, mobile: true, dpr: 2 },
};
const IN = {
  ready: `document.querySelectorAll('.obj').length > 0 && !!${GW}?.__gameStudio?._debug`,
  playing: `document.querySelector('.shell').dataset.playing === 'on' && !!${Q('.mark')}`,
  // The pause's parts as the person sees them.
  ui: `JSON.stringify((() => { const h = ${OV}; if (!h) return null; const r = h.shadowRoot; const q = (s) => r.querySelector(s);
    const f = ${FR}.getBoundingClientRect(); const box = (e) => { if (!e || e.hidden) return null; const b = e.getBoundingClientRect(); return { x: f.left + b.left + b.width / 2, y: f.top + b.top + b.height / 2, w: b.width, h: b.height, top: f.top + b.top, left: f.left + b.left }; };
    const chat = q('[data-part=pause-chat]');
    return { pauseBtn: box(q('[data-part=pause-button]')), mark: !q('.mark').hidden, chat: !!chat && !chat.hidden, chatBox: box(chat), veil: !q('[data-part=pause-veil]').hidden,
      focused: !!chat && r.activeElement === chat.querySelector('input'), sees: chat ? chat.querySelector('.sees').textContent : '',
      replies: [...r.querySelectorAll('[data-part=pause-reply] .said')].map((e) => e.textContent), you: [...r.querySelectorAll('.chat .you')].map((e) => e.textContent),
      live: q('[data-part=pause-live]')?.textContent || '', resume: box(q('[data-action=pause-resume]')), line: q('.line').hidden ? '' : q('.line').textContent }; })())`,
  // A frame loop of the page's own through the game's requestAnimationFrame (what a game's loop does), and its clock.
  probe: `(() => { const w = ${GW}; if (w.__pp) return true; w.__pp = { f: 0, st: [], down: [], up: [] };
    const loop = (t) => { w.__pp.f++; w.__pp.st.push(t); if (w.__pp.st.length > 8) w.__pp.st.shift(); w.requestAnimationFrame(loop); }; w.requestAnimationFrame(loop);
    w.addEventListener('keydown', (e) => w.__pp.down.push(e.key)); w.addEventListener('keyup', (e) => w.__pp.up.push(e.key)); return true; })()`,
  pp: `JSON.stringify({ f: ${GW}.__pp.f, st: ${GW}.__pp.st.slice(), down: ${GW}.__pp.down.slice(), up: ${GW}.__pp.up.slice(), now: ${GW}.performance.now() })`,
};
const j = async (page, expr) => JSON.parse((await page.eval(expr)) || 'null');

function gameFolder(src, theme = 'light') {
  const root = mkdtempSync(join(tmpdir(), 'studio-pause-'));
  cpSync(join(PKG, src), root, { recursive: true });
  for (const f of ['placement.json', '.studio/requests', '.studio/status.json', '.studio/watch.json', '.studio/play', '.studio/chat', '.studio/undo']) rmSync(join(root, f), { recursive: true, force: true });
  mkdirSync(join(root, '.studio/ui'), { recursive: true });
  writeFileSync(join(root, '.studio/ui/prefs.json'), JSON.stringify({ version: 1, lang: LANG, theme }));
  return root;
}
const requests = (root) => {
  const out = [];
  for (const d of ['.studio/requests', '.studio/requests/done']) {
    const p = join(root, d);
    if (!existsSync(p)) continue;
    for (const n of readdirSync(p)) if (n.endsWith('.json')) out.push(JSON.parse(readFileSync(join(p, n), 'utf8')));
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : 1));
};
const chatFile = (root, id) => {
  const p = join(root, '.studio/chat', `${id}.json`);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
};
async function until(fn, ms = 10000, what = 'condition') {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timeout: ${what}`);
    await sleep(100);
  }
}

async function keyIn(page, key, code, text) {
  const vk = key === 'Enter' ? 13 : key === 'Escape' ? 27 : key.toUpperCase().charCodeAt(0);
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk, ...(text ? { text } : {}) });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk });
}
async function type(page, text) {
  await page.send('Input.insertText', { text });
}

let browser = null;
async function open(src, layout, { theme = 'light', uiDir } = {}) {
  const root = gameFolder(src, theme);
  // Started as from Claude Code (which-ai.mjs): the replies end with "More in Claude".
  const srv = await startStudioServer({ root, uiDir: uiDir || join(PKG, 'skills/arrange/bin/studio-ui'), log: () => {}, env: { CLAUDECODE: '1' } });
  if (!browser) browser = await launch();
  const page = await newPage(browser, { width: layout.width, height: layout.height, mobile: layout.mobile });
  if (!layout.mobile) await page.send('Emulation.setDeviceMetricsOverride', { width: layout.width, height: layout.height, deviceScaleFactor: layout.dpr, mobile: false });
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
  await page.goto(srv.url);
  await page.waitFor(IN.ready, 90000);
  await page.eval(`document.querySelector('button.play').click()`);
  await page.waitFor(IN.playing, 30000);
  // The game's own first frames (a starter fades in): give it a moment before the photos and the clock checks.
  await sleep(1500);
  let n = 0;
  const shot = async (tag, what) => {
    if (!SHOTS) return;
    const f = `${tag}-${String(++n).padStart(2, '0')}-${what}.png`;
    writeFileSync(join(SHOTS, f), await page.screenshot());
    console.log(`  shot ${f}`);
  };
  return { root, srv, page, shot, close: async () => { await page.close(); srv.close(); rmSync(root, { recursive: true, force: true }); } };
}

/** Is the game held? Its frame loop and its clock, over `ms`. */
async function held(page, ms = 1200) {
  const a = await j(page, IN.pp);
  await sleep(ms);
  const b = await j(page, IN.pp);
  return { frames: b.f - a.f, clock: b.now - a.now, a, b };
}

/** Send one chat message and wait for the request, then the reply. Returns { rec, ui }. */
async function chatSay(page, root, text, n) {
  await page.eval(`(${Q('[data-part=pause-chat] input')}.focus(), true)`);
  await type(page, text);
  await keyIn(page, 'Enter', 'Enter', '\r');
  const rec = await until(() => requests(root).filter((r) => r.kind === 'play' && r.paused)[n - 1], 10000, `paused request ${n}`);
  assert.equal(rec.text, text);
  const ui = await until(async () => {
    const u = await j(page, IN.ui);
    return u.replies.length >= n ? u : null;
  }, 20000, `reply ${n}`);
  return { rec, ui };
}

async function cove() {
  console.log('cove: Lantern Cove, PC 1280×800');
  const g = await open('starters/lantern-cove', LAYOUTS.pc);
  const { root, page, shot } = g;
  const agent = startFakeAgent(root);
  try {
    await page.eval(IN.probe);
    let u = await j(page, IN.ui);
    assert.ok(u.pauseBtn && u.mark, '❚❚ and the mark in the corner');
    await shot('cove', 'playing');
    const running = await held(page, 1500);
    assert.ok(running.frames >= 2, `the game runs before the pause (${running.frames} frames)`);
    // 2. P in the game.
    await page.click(640, 260);
    await keyIn(page, 'p', 'KeyP', 'p');
    await page.waitFor(`JSON.parse(${IN.ui}).chat`, 5000);
    const pausedAt = Date.now();
    u = await j(page, IN.ui);
    assert.equal(u.veil, true);
    assert.equal(u.mark, false, 'the corner steps aside while paused');
    assert.equal(u.focused, true, 'the chat has the keys');
    assert.match(u.sees, ja ? /AI はこの瞬間を見ます/ : /Your AI sees this moment/);
    const h = await held(page);
    assert.ok(h.frames <= 1, `paused: no frames (${h.frames})`);
    assert.equal(h.clock, 0, 'paused: the game\'s clock stands still');
    assert.ok(!h.b.down.includes('p') && !h.b.down.includes('P'), `the game never saw the P (${h.b.down})`);
    await shot('cove', 'paused');
    // 3. A message.
    const q1 = ja ? 'なぜ灯台はここにある？' : 'Why is the lighthouse out here?';
    await page.eval(`(${Q('[data-part=pause-chat] input')}.focus(), true)`);
    await type(page, q1);
    await shot('cove', 'typing');
    await keyIn(page, 'Enter', 'Enter', '\r');
    const rec1 = await until(() => requests(root).find((r) => r.kind === 'play' && r.paused), 10000, 'the paused request');
    assert.equal(rec1.text, q1);
    assert.match(rec1.shot || '', /^\.studio\/play\/.*\.jpg$/, 'the moment\'s picture');
    assert.ok(existsSync(join(root, rec1.shot)));
    assert.ok(rec1.view, 'the player\'s camera');
    assert.ok(rec1.near?.length, 'what was near');
    assert.equal(rec1.chat, undefined, 'the first message is the chat');
    let c = await until(() => chatFile(root, rec1.id), 5000, 'the chat file');
    assert.equal(c.turns[0].who, 'you');
    assert.equal(c.turns[0].text, q1);
    assert.equal(c.shot, rec1.shot);
    // 4. The reply.
    u = await until(async () => {
      const x = await j(page, IN.ui);
      return x.replies.length ? x : null;
    }, 20000, 'the reply');
    assert.match(u.replies[0], ja ? /止めた瞬間を見ました/ : /I see the moment you stopped at/);
    assert.ok(u.replies[0].includes(rec1.near[0].label || rec1.near[0].key), 'the reply names what was nearest (the moment reached the AI)');
    await shot('cove', 'replied');
    c = await until(() => (chatFile(root, rec1.id)?.turns.length === 2 ? chatFile(root, rec1.id) : null), 5000, 'the AI\'s turn in the file');
    assert.equal(c.turns[1].who, 'ai');
    assert.equal(c.turns[1].state, 'done');
    assert.ok((await held(page, 600)).frames <= 1, 'still paused after the reply');
    // 5. A second message: the talk so far goes with it.
    const q2 = ja ? '少し左に寄せられる？' : 'Could it sit a bit more to the left?';
    const { rec: rec2, ui: u2 } = await chatSay(page, root, q2, 2);
    assert.equal(rec2.chat, rec1.id, 'the second message names the chat');
    assert.deepEqual(rec2.history?.map((t) => t.who), ['you', 'ai']);
    assert.equal(rec2.shot, undefined, 'the moment went with the first message');
    assert.match(u2.replies[1], ja ? /2 件の話の続き/ : /Following our 2 earlier messages/);
    c = await until(() => (chatFile(root, rec1.id)?.turns.length === 4 ? chatFile(root, rec1.id) : null), 5000, 'four turns in the file');
    assert.deepEqual(c.turns.map((t) => t.who), ['you', 'ai', 'you', 'ai']);
    await shot('cove', 'second-reply');
    console.log(`  ok: paused, 2 messages, 2 replies, .studio/chat/${rec1.id}.json (${c.turns.length} turns)`);
    // 6. Keys while paused, outside the chat: presses stay out of the game, releases reach it.
    await page.eval(`(${Q('[data-part=pause-chat] input')}.blur(), ${GW}.focus(), true)`);
    const before = await j(page, IN.pp);
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'w', code: 'KeyW', windowsVirtualKeyCode: 87, text: 'w' });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'w', code: 'KeyW', windowsVirtualKeyCode: 87 });
    await sleep(200);
    const after = await j(page, IN.pp);
    assert.equal(after.down.length, before.down.length, `no key press reached the game while paused (${after.down})`);
    assert.ok(after.up.length > before.up.length, 'the release did (no key stays down after Resume)');
    // 7. P resumes, one frame on.
    const last = after.st[after.st.length - 1];
    const pausedFor = after.now; // the game's clock has not moved since the pause
    await sleep(300);
    await keyIn(page, 'p', 'KeyP', 'p');
    await page.waitFor(`!JSON.parse(${IN.ui}).chat`, 5000);
    const r = await held(page, 1500);
    assert.ok(r.frames >= 2, `frames again after Resume (${r.frames})`);
    const firstAfter = r.b.st.find((t) => t > last) ?? r.b.st[0];
    // Paused for well over 5 s (two replies); a frame here is ~50–250 ms (SwiftShader), and the probe starts a moment
    // after Resume. A clock that kept running would show the whole pause.
    const pausedMs = Date.now() - pausedAt;
    assert.ok(pausedMs > 5000, `paused long enough to tell (${pausedMs} ms)`);
    assert.ok(firstAfter - last < 1200, `the first frame time after Resume follows on (+${Math.round(firstAfter - last)} ms after ${pausedMs} ms paused)`);
    assert.ok(r.a.now - pausedFor < 1500, `the game's clock went on from where it stopped (+${Math.round(r.a.now - pausedFor)} ms after ${pausedMs} ms paused)`);
    u = await j(page, IN.ui);
    assert.ok(u.mark && u.pauseBtn, 'the corner is back');
    await shot('cove', 'resumed');
    // 8. The corner's ❚❚, then the chat's Resume.
    await page.click(u.pauseBtn.x, u.pauseBtn.y);
    await page.waitFor(`JSON.parse(${IN.ui}).chat`, 5000);
    u = await j(page, IN.ui);
    assert.equal(u.replies.length, 0, 'a new pause is a new talk');
    assert.ok((await held(page, 600)).frames <= 1, '❚❚ pauses');
    await page.click(u.resume.x, u.resume.y);
    await page.waitFor(`!JSON.parse(${IN.ui}).chat`, 5000);
    assert.ok((await held(page, 1500)).frames >= 2, 'Resume resumes');
    console.log('  ok: the game held and let go: frames, clock, keys; ❚❚ and Resume');
  } finally {
    await agent.stop();
    await g.close();
  }
}

async function ruins() {
  console.log('ruins: Firefly Ruins (PixiJS 2D), PC');
  const g = await open('starters/firefly-ruins', LAYOUTS.pc);
  const { root, page, shot } = g;
  const agent = startFakeAgent(root);
  try {
    await page.eval(IN.probe);
    // Pixi's own Ticker: the game's frame count (its test hook), not only our loop's.
    const tick = `${GW}.__ruins.stats().frames`;
    await page.click(640, 260);
    await keyIn(page, 'p', 'KeyP', 'p');
    await page.waitFor(`JSON.parse(${IN.ui}).chat`, 5000);
    const t0 = await page.eval(tick);
    const h = await held(page);
    assert.ok(h.frames <= 1, `paused: no frames (${h.frames})`);
    assert.equal(await page.eval(tick), t0, 'Pixi\'s Ticker is held');
    const { rec, ui } = await chatSay(page, root, ja ? '門の上で光っているのは何？' : 'What is glowing over the gate?', 1);
    assert.equal(rec.dim, '2d');
    assert.ok(rec.near?.length, '2D: what is on screen goes with it');
    assert.ok(ui.replies[0].length > 10);
    await shot('ruins', 'replied');
    await keyIn(page, 'Escape', 'Escape');
    await page.waitFor(`!JSON.parse(${IN.ui}).chat`, 5000);
    assert.ok((await held(page, 1500)).frames >= 2, 'Escape resumes');
    console.log(`  ok: 2D held; near ${rec.near.slice(0, 3).map((n) => n.key)}`);
  } finally {
    await agent.stop();
    await g.close();
  }
}

async function glow() {
  console.log('glow: Glow Garden (three.js + HTML UI), PC');
  const g = await open('examples/three-hud', LAYOUTS.pc);
  const { page, shot } = g;
  try {
    await page.eval(IN.probe);
    await page.click(640, 300);
    await keyIn(page, 'p', 'KeyP', 'p');
    await page.waitFor(`JSON.parse(${IN.ui}).chat`, 5000);
    const a = await j(page, IN.pp);
    await shot('glow', 'paused');
    await sleep(4000);
    // P typed in the chat's field is a letter (a message may start with "p"); out of the field it resumes.
    await page.eval(`(${Q('[data-part=pause-chat] input')}.blur(), ${GW}.focus(), true)`);
    await keyIn(page, 'p', 'KeyP', 'p');
    await page.waitFor(`!JSON.parse(${IN.ui}).chat`, 5000);
    await sleep(500);
    const b = await j(page, IN.pp);
    const last = a.st[a.st.length - 1];
    const first = b.st.find((t) => t > last);
    assert.ok(first !== undefined && first - last < 1200, `the frame time after a 4 s pause follows on (+${Math.round(first - last)} ms)`);
    console.log(`  ok: frame time +${Math.round(first - last)} ms across a 4 s pause`);
  } finally {
    await g.close();
  }
}

async function narrow(layout, theme = 'light') {
  console.log(`${layout.id} ${layout.width}×${layout.height} (${theme})`);
  const g = await open('starters/lantern-cove', layout, { theme });
  const { root, page, shot } = g;
  const agent = startFakeAgent(root);
  const tag = `${layout.id}${theme === 'dark' ? '-dark' : ''}`;
  try {
    await page.eval(IN.probe);
    const btn = `document.querySelector('[data-action=play-pause]')`;
    await page.waitFor(`!!${btn}?.offsetParent`, 8000);
    const b = await j(page, `JSON.stringify((() => { const r = (s) => document.querySelector(s).getBoundingClientRect(); const p = r('[data-action=play-pause]'), a = r('[data-action=play-ask]'), t = r('header.top');
      return { x: p.left + p.width / 2, y: p.top + p.height / 2, w: p.width, right: p.right, askLeft: a.left, inBar: p.top >= t.top && p.bottom <= t.bottom }; })())`);
    assert.ok(b.inBar && b.right <= b.askLeft + 1, `❚❚ in the top bar, left of ✦ ${JSON.stringify(b)}`);
    let u = await j(page, IN.ui);
    assert.equal(u.pauseBtn, null, 'no ❚❚ drawn over the game here');
    await shot(tag, 'playing');
    if (layout.mobile) await page.tap(b.x, b.y);
    else await page.click(b.x, b.y);
    await page.waitFor(`JSON.parse(${IN.ui}).chat`, 5000);
    assert.ok((await held(page, 800)).frames <= 1, 'paused from the top bar');
    u = await j(page, IN.ui);
    assert.ok(u.chatBox.left <= 1 && u.chatBox.top > layout.height * 0.35, `the chat is a sheet at the foot ${JSON.stringify(u.chatBox)}`);
    const b2 = await j(page, `JSON.stringify((() => { const p = document.querySelector('[data-action=play-pause]').getBoundingClientRect(); return { x: p.left + p.width / 2, y: p.top + p.height / 2 }; })())`);
    assert.ok(Math.abs(b2.x - b.x) < 1 && Math.abs(b2.y - b.y) < 1, 'the button stays under the finger (now ▶)');
    await shot(tag, 'paused');
    await chatSay(page, root, ja ? 'ここは何？' : 'What is this place?', 1);
    await shot(tag, 'replied');
    if (layout.mobile) await page.tap(b.x, b.y);
    else await page.click(b.x, b.y);
    await page.waitFor(`!JSON.parse(${IN.ui}).chat`, 5000);
    assert.ok((await held(page, 1500)).frames >= 2, 'the same button resumes');
    console.log('  ok: ❚❚ in the top bar, a sheet at the foot, a reply, resumed');
  } finally {
    await agent.stop();
    await g.close();
  }
}

async function darkPc() {
  console.log('dark: PC');
  const g = await open('starters/lantern-cove', LAYOUTS.pc, { theme: 'dark' });
  const { root, page, shot } = g;
  const agent = startFakeAgent(root);
  try {
    await page.eval(IN.probe);
    await shot('pc-dark', 'playing');
    await page.click(640, 260);
    await keyIn(page, 'p', 'KeyP', 'p');
    await page.waitFor(`JSON.parse(${IN.ui}).chat`, 5000);
    await chatSay(page, root, ja ? 'なぜ灯台はここにある？' : 'Why is the lighthouse out here?', 1);
    await shot('pc-dark', 'replied');
    console.log('  ok');
  } finally {
    await agent.stop();
    await g.close();
  }
}

// A game that steps by timers and the wall clock, as the game page's own code (the window's setInterval / setTimeout /
// Date.now, which the game would call). `n` an interval's ticks, `t` a setTimeout chain's, `d` Date.now() now.
const TIMERS = {
  // A small counter drawn in the game page (top left), so the photos show whether the timers ran: "Enemies" from the
  // interval, "Time" a 60 s countdown from Date.now().
  start: `(() => { const w = ${GW}; const d = w.document; const tp = w.__tp = { n: 0, t: 0, late: 0, from: w.Date.now() };
    const el = d.createElement('div'); el.id = 'tp-hud';
    el.style.cssText = 'position:fixed;left:16px;top:16px;z-index:5;padding:8px 12px;border-radius:10px;background:rgba(0,0,0,.55);color:#fff;font:600 18px/1.3 system-ui;pointer-events:none';
    d.body.appendChild(el);
    const draw = () => { el.textContent = 'Enemies ' + Math.floor(tp.n / 20) + ' · Time ' + Math.max(0, 60 - Math.floor((w.Date.now() - tp.from) / 1000)) + ' s'; };
    w.setInterval(() => { tp.n++; draw(); }, 50);
    const tick = () => { tp.t++; w.setTimeout(tick, 100); }; tick();
    draw(); return true; })()`,
  read: `JSON.stringify({ n: ${GW}.__tp.n, t: ${GW}.__tp.t, late: ${GW}.__tp.late, d: ${GW}.Date.now(), wall: Date.now() })`,
  // One timer set now (while held), for 300 ms: `late` counts it when it fires.
  later: `(${GW}.setTimeout(() => ${GW}.__tp.late++, 300), true)`,
};

async function timers() {
  console.log('timers: a game stepped by setInterval / setTimeout / Date.now (Lantern Cove page), PC');
  const g = await open('starters/lantern-cove', LAYOUTS.pc);
  const { root, page, shot } = g;
  const agent = startFakeAgent(root);
  const read = () => j(page, TIMERS.read);
  try {
    await page.eval(TIMERS.start);
    await sleep(3000); // a few enemies and seconds on the counter before the photos
    let a = await read();
    await sleep(1200);
    let b = await read();
    assert.ok(b.n - a.n >= 5 && b.t - a.t >= 3, `playing: the timers run (interval +${b.n - a.n}, chain +${b.t - a.t})`);
    assert.ok(b.d - a.d >= 900, `playing: Date.now() runs (+${b.d - a.d} ms)`);
    // Pause.
    await page.click(640, 260);
    await keyIn(page, 'p', 'KeyP', 'p');
    await page.waitFor(`JSON.parse(${IN.ui}).chat`, 5000);
    await sleep(200);
    a = await read();
    await shot('timers', 'paused');
    await page.eval(TIMERS.later);
    // The studio's own timers still run while the game's wait: the chat sends and the stand-in AI's reply shows.
    await chatSay(page, root, ja ? 'タイマーは止まっている？' : 'Are the timers stopped?', 1);
    await sleep(1500);
    b = await read();
    assert.deepEqual([b.n - a.n, b.t - a.t, b.late], [0, 0, 0], `paused: no timer fired (interval +${b.n - a.n}, chain +${b.t - a.t}, set while paused ${b.late})`);
    assert.equal(b.d, a.d, `paused: Date.now() stands still (+${b.d - a.d} ms over ${b.wall - a.wall} ms)`);
    await shot('timers', 'paused-later');
    const pausedMs = b.wall - a.wall;
    // Resume.
    await page.eval(`(${Q('[data-part=pause-chat] input')}.blur(), ${GW}.focus(), true)`);
    await keyIn(page, 'p', 'KeyP', 'p');
    await page.waitFor(`!JSON.parse(${IN.ui}).chat`, 5000);
    await sleep(1200);
    const c = await read();
    assert.ok(c.n - b.n >= 5 && c.t - b.t >= 3, `resumed: the timers go on (interval +${c.n - b.n}, chain +${c.t - b.t})`);
    assert.equal(c.late, 1, 'resumed: the timer set while paused fired once');
    // The browser's own clock minus the game's: it grew by the time paused (at least a→b, at most a→c), no more.
    const left = (c.wall - c.d) - (a.wall - a.d);
    assert.ok(left >= pausedMs - 50 && left <= c.wall - a.wall + 50, `resumed: Date.now() left out ${left} ms (paused ${pausedMs}–${c.wall - a.wall} ms)`);
    // Edit: the same page, held.
    await page.eval(`document.querySelector('button.play').click()`);
    await page.waitFor(IN.ready + ` && document.querySelector('.shell').dataset.playing === 'off'`, 20000);
    await sleep(800);
    const e0 = await read();
    await page.eval(TIMERS.later);
    await sleep(1500);
    const e1 = await read();
    assert.deepEqual([e1.n - e0.n, e1.t - e0.t, e1.late], [0, 0, 1], `Edit: the timers stand still (interval +${e1.n - e0.n}, chain +${e1.t - e0.t}, set in Edit ${e1.late - 1})`);
    assert.equal(e1.d, e0.d, 'Edit: Date.now() stands still');
    // The editor itself still works in a held page: a pick and an arrow step land, Save counts it.
    await page.eval(`studioShell.actions.select('cottage')`);
    await page.waitFor(`studioShell.selected() === 'cottage'`, 3000);
    await sleep(400);
    await page.eval(`document.activeElement?.blur?.()`);
    await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
    await page.waitFor(`/1/.test(document.querySelector('[data-part=save]')?.innerText || '')`, 4000);
    await shot('timers', 'edit');
    // Play again (the window before Play: try without saving).
    await page.eval(`document.querySelector('button.play').click()`);
    await sleep(500);
    await page.eval(`document.querySelector('[data-part=unsaved-guard]:not([hidden]) [data-action=guard-discard]')?.click()`);
    await page.waitFor(IN.playing, 20000);
    await sleep(1200);
    const p1 = await read();
    assert.ok(p1.n - e1.n >= 5 && p1.late === 2, `Play again: the timers go on (interval +${p1.n - e1.n}), the one set in Edit fired`);
    console.log(`  ok: held in a pause (${pausedMs} ms) and in Edit, on again after each; Date.now() with them`);
  } finally {
    await agent.stop();
    await g.close();
  }
}

// ----- stage 2: moving things while paused -----

/** Objects of the paused game that can be pressed right now: on screen, clear of the panel, nothing in front of them. */
async function movable(page, moment, mobile = false) {
  return j(page, `JSON.stringify((() => { const m = ${GW}.__gameStudio._move; const f = ${FR}.getBoundingClientRect();
    const c = ${Q('[data-part=pause-chat]')}.getBoundingClientRect(); const out = [];
    for (const it of m.list()) {
      const why = m.why(it.key); if (!!why !== ${!!moment} || it.held || it.backdrop || it.movable === false) continue;
      const a = m.anchor(it.key); if (!a || !a.visible) continue; const [x, y] = a.center;
      if (x < 40 || y < 70 || x > f.width - 40 || y > f.height - 90) continue;
      if (x > c.left - 60 && x < c.right + 10 && y > c.top - 60 && y < c.bottom + 60) continue;
      // What a press there picks (the pick's slack included: a thin lamp post in front of a sea stack picks the stack).
      if (m.under(x, y) !== it.key || m.under(x, y, ${mobile ? 28 : 12}) !== it.key) continue;
      out.push({ key: it.key, label: it.label, x: f.left + x, y: f.top + y, why, size: a.size, pose: it.pose });
    }
    return out.sort((a, b) => Math.abs(a.size - 90) - Math.abs(b.size - 90)); })())`);
}
const poseOf = (page, key) => j(page, `JSON.stringify(${GW}.__gameStudio._move.list().find((i) => i.key === ${JSON.stringify(key)})?.pose || null)`);
const playPose = (page, key) => j(page, `JSON.stringify(${GW}.__gameStudio._play.list().find((i) => i.key === ${JSON.stringify(key)})?.pose || null)`);
const gap = (a, b) => Math.hypot(...a.p.map((v, i) => v - (b.p[i] ?? 0)));
const MOVE_UI = `JSON.stringify((() => { const r = ${OV}.shadowRoot; const q = (s) => r.querySelector(s); const card = q('[data-part=pause-move-card]');
  const f = ${FR}.getBoundingClientRect(); const box = (e) => { if (!e || e.hidden || !e.offsetParent) return null; const b = e.getBoundingClientRect(); return { x: f.left + b.left + b.width / 2, y: f.top + b.top + b.height / 2 }; };
  return { card: !!card && !card.hidden, text: card ? card.textContent : '', veil: !q('[data-part=pause-veil]').hidden, sees: q('.chat .sees').textContent,
    only: !!q('[data-part=pause-move-only]'), moment: !!q('[data-part=pause-move-moment]'), inLayout: !!q('[data-part=pause-move-in]'),
    toLayout: box(q('[data-action=pause-to-layout]')), putBack: box(q('[data-action=pause-put-back]')), move: box(q('[data-action=pause-move]')),
    talk: !q('.chat .talk').hidden }; })())`;
const saveCount = (page) => page.eval(`(() => { const b = [...document.querySelectorAll('[data-action=save]')].find((e) => e.offsetParent); return b ? b.textContent : ''; })()`);

/** Pause, then Move (P and the panel's button, or the phone's ❚❚ and a tap). Returns the move UI. */
async function pauseAndMove(page, layout) {
  if (layout.mobile || layout.width < 640) {
    const b = await j(page, `JSON.stringify((() => { const p = document.querySelector('[data-action=play-pause]').getBoundingClientRect(); return { x: p.left + p.width / 2, y: p.top + p.height / 2 }; })())`);
    if (layout.mobile) await page.tap(b.x, b.y);
    else await page.click(b.x, b.y);
  } else {
    await page.click(640, 260);
    await keyIn(page, 'p', 'KeyP', 'p');
  }
  await page.waitFor(`JSON.parse(${IN.ui}).chat`, 5000);
  const u = await j(page, MOVE_UI);
  assert.ok(u.move, 'Move in the pause panel');
  if (layout.mobile) await page.tap(u.move.x, u.move.y);
  else await page.click(u.move.x, u.move.y);
  await page.waitFor(`JSON.parse(${MOVE_UI}).card`, 5000);
  return j(page, MOVE_UI);
}

/** Pick `o` and drag it by (dx, dy) px: the mouse, or a finger on a phone. */
// Pick, then drag, as in Edit (a drag on an object not picked looks around). The two presses far enough apart in time
// that they are not a double tap (which frames the object: the camera moves, the object does not).
async function pickAndDrag(page, o, dx, dy, mobile) {
  if (mobile) await page.tap(o.x, o.y);
  else await page.click(o.x, o.y);
  // Picked: the card names it.
  await until(async () => (await j(page, MOVE_UI)).text.includes(o.label), 3000, `${o.label} picked`);
  await sleep(800);
  if (mobile) await page.touchDrag(o.x, o.y, o.x + dx, o.y + dy, 10);
  else await page.mouseDrag(o.x, o.y, o.x + dx, o.y + dy, 10);
  await sleep(400);
}

async function moveCove() {
  console.log('move: Lantern Cove, PC 1280×800 — move things while paused');
  const g = await open('starters/lantern-cove', LAYOUTS.pc);
  const { root, page, shot } = g;
  try {
    await page.eval(IN.probe);
    // Long enough for Play's start to be taken (play-move.ts). Then the game "moves" the barrel by itself (as a game's
    // own code would: Lantern Cove's floats only drift when pushed), so a pause finds it moved since the start.
    await sleep(2500);
    await page.eval(`(() => { const sc = ${GW}.__studioThree.scenes[0]; let b = null; sc.traverse((o) => { if (!b && o.name === 'barrel') b = o; }); if (b) b.position.x += 1.2; return !!b; })()`);
    await sleep(300);
    let u = await pauseAndMove(page, LAYOUTS.pc);
    assert.equal(u.veil, false, 'no veil while moving: the objects are what the person looks at');
    assert.equal(u.talk, false, 'the card takes the talk\'s place');
    assert.match(u.sees, ja ? /動かす物を選ぶ/ : /Pick something to move/);
    let h = await held(page, 800);
    assert.ok(h.frames <= 1 && h.clock === 0, `still paused with the editor up (${h.frames} frames, clock +${h.clock})`);
    await shot('move', 'pick');
    // A still object: moved, then put in the layout.
    const still = (await movable(page, false))[0];
    assert.ok(still, 'something still to move');
    await pickAndDrag(page, still, -90, 30, false);
    const moved = await poseOf(page, still.key);
    // The orange outline went with it (the editor's own clock: the game's is stopped — core/native.ts nativeNow).
    const outline = await j(page, `JSON.stringify((() => { const h = ${FR}.contentDocument.querySelector('[data-studio-ui]'); const c = h?.shadowRoot?.querySelector('.layer.sel canvas');
      const b = c?.getBoundingClientRect(); const a = ${GW}.__gameStudio._move.anchor(${JSON.stringify(still.key)}); return b && a ? { dx: b.x + b.width / 2 - a.center[0], ax: a.center[0] } : null; })())`);
    assert.ok(outline && Math.abs(outline.dx) < 40, `the outline is on the moved object ${JSON.stringify(outline)}`);
    u = await j(page, MOVE_UI);
    assert.ok(u.text.includes(still.label), `the card names it (${u.text})`);
    assert.ok(u.only && u.toLayout && u.putBack, `"Only in this play", Put in layout, Put back (${u.text})`);
    h = await held(page, 800);
    assert.ok(h.frames <= 1 && h.clock === 0, `still paused after the drag (${h.frames} frames, clock +${h.clock})`);
    assert.ok(!h.b.down.length || !h.b.down.some((k) => k !== 'p'), 'the game saw no press');
    await shot('move', 'moved');
    assert.equal(await saveCount(page), '', 'nothing unsaved before Put in layout');
    await page.click(u.toLayout.x, u.toLayout.y);
    await page.waitFor(`JSON.parse(${MOVE_UI}).inLayout`, 5000);
    const save = await until(async () => {
      const t = await saveCount(page);
      return /1/.test(t) ? t : null;
    }, 5000, 'Save · 1');
    await shot('move', 'in-layout');
    console.log(`  ok: ${still.label} moved and put in the layout (${save.trim()})`);
    // Something the game moves itself: this moment only.
    const boat = (await movable(page, true))[0];
    if (boat) {
      await pickAndDrag(page, boat, 70, 20, false);
      u = await j(page, MOVE_UI);
      assert.ok(u.moment, `"Just for this moment" on ${boat.label} (${boat.why}) ${u.text}`);
      assert.equal(u.toLayout, null, 'no Put in layout for what the game moves');
      await shot('move', 'moment');
      if (u.putBack) {
        await page.click(u.putBack.x, u.putBack.y);
        await sleep(300);
        const back = await poseOf(page, boat.key);
        assert.ok(gap(back, boat.pose) < 1e-3, `Put back: where it was at the pause (${gap(back, boat.pose)})`);
      }
      console.log(`  ok: ${boat.label} is "just for this moment" (${boat.why})`);
    } else console.log('  (no object the game moves was in reach to press)');
    // Resume: the game goes on, the moved one where it was left.
    await keyIn(page, 'p', 'KeyP', 'p');
    await page.waitFor(`!JSON.parse(${IN.ui}).chat`, 5000);
    h = await held(page, 1500);
    assert.ok(h.frames >= 2, `the game runs again (${h.frames})`);
    const after = await playPose(page, still.key);
    assert.ok(gap(after, moved) < 1e-3, `after Resume ${still.label} is where it was left (${gap(after, moved)})`);
    assert.equal(await page.eval(`!!${Q('.mark')} && !${Q('.mark')}.hidden`), true, 'the corner is back');
    await shot('move', 'resumed');
    // Edit: the place put in the layout is the editor's (its draft), Save · 1 still.
    await page.eval(`document.querySelector('button.play').click()`);
    await page.waitFor(`document.querySelector('.shell').dataset.playing === 'off' && !!${GW}?.__gameStudio?._debug`, 30000);
    await page.waitFor(`!!${GW}.__gameStudio._debug.list().length`, 30000);
    await sleep(800);
    const inEdit = await j(page, `JSON.stringify(${GW}.__gameStudio._debug.list().find((i) => i.key === ${JSON.stringify(still.key)})?.pose || null)`);
    assert.ok(gap(inEdit, moved) < 0.02, `Edit shows ${still.label} where it was put (${gap(inEdit, moved).toFixed(3)})`);
    assert.match(await saveCount(page), /1/, 'Save · 1 in Edit');
    const draft = JSON.parse(readFileSync(join(root, 'placement.json'), 'utf8'));
    assert.ok(draft.objects?.[still.key], 'the draft has it (placement.json)');
    await shot('move', 'edit');
    console.log('  ok: resumed from the moved places; Edit has the one put in the layout');
  } finally {
    await g.close();
  }
}

/** One pick, drag and look at the card (2D, Glow Garden, narrow screens, dark). */
async function moveSome(src, layout, tag, { theme = 'light', layoutIn = true } = {}) {
  console.log(`${tag}: ${src} ${layout.width}×${layout.height} (${theme})`);
  const g = await open(src, layout, { theme });
  const { page, shot } = g;
  try {
    await page.eval(IN.probe);
    await sleep(2000);
    let u = await pauseAndMove(page, layout);
    assert.equal(u.veil, false);
    assert.ok((await held(page, 600)).frames <= 1, 'still paused');
    await shot(tag, 'pick');
    const o = (await movable(page, false, layout.mobile))[0] || (await movable(page, true, layout.mobile))[0];
    assert.ok(o, 'something to move');
    await pickAndDrag(page, o, layout.width < 640 ? -50 : -80, 30, layout.mobile);
    const p = await poseOf(page, o.key);
    assert.ok(gap(p, o.pose) > 0.05, `${o.label} moved (${gap(p, o.pose).toFixed(2)})`);
    u = await j(page, MOVE_UI);
    assert.ok(u.text.includes(o.label), `the card names it (${u.text})`);
    assert.ok(o.why ? u.moment : u.only, `the card says what happens to it (${u.text})`);
    assert.ok((await held(page, 600)).frames <= 1, 'still paused after the drag');
    await shot(tag, 'moved');
    if (layoutIn && !o.why && u.toLayout) {
      if (layout.mobile) await page.tap(u.toLayout.x, u.toLayout.y);
      else await page.click(u.toLayout.x, u.toLayout.y);
      await page.waitFor(`JSON.parse(${MOVE_UI}).inLayout`, 5000);
      await until(async () => /1/.test(await saveCount(page)), 5000, 'Save · 1');
      await shot(tag, 'in-layout');
    }
    await keyIn(page, 'p', 'KeyP', 'p');
    await page.waitFor(`!JSON.parse(${IN.ui}).chat`, 5000);
    assert.ok((await held(page, 1500)).frames >= 2, 'resumed');
    console.log(`  ok: ${o.label}${o.why ? ` (just for this moment: ${o.why})` : ''}`);
  } finally {
    await g.close();
  }
}

/** --before with --only timers: the counter in a pause with an older build's editor (photos; the timers run on there). */
async function timersBefore() {
  console.log(`before (timers): ${BEFORE}`);
  const g = await open('starters/lantern-cove', LAYOUTS.pc, { uiDir: resolve(BEFORE) });
  const { root, page, shot } = g;
  const agent = startFakeAgent(root);
  try {
    await page.eval(TIMERS.start);
    await sleep(3000);
    await page.click(640, 260);
    await keyIn(page, 'p', 'KeyP', 'p');
    await page.waitFor(`JSON.parse(${IN.ui}).chat`, 5000);
    await sleep(200);
    const a = await j(page, TIMERS.read);
    await shot('before-timers', 'paused');
    await chatSay(page, root, ja ? 'タイマーは止まっている？' : 'Are the timers stopped?', 1);
    await sleep(1500);
    const b = await j(page, TIMERS.read);
    await shot('before-timers', 'paused-later');
    console.log(`  before: while paused the interval ran +${b.n - a.n}, Date.now() +${b.d - a.d} ms`);
  } finally {
    await agent.stop();
    await g.close();
  }
}

async function before() {
  if (ONLY?.includes('timers')) return timersBefore();
  console.log(`before: ${BEFORE}`);
  for (const [layout, theme] of [[LAYOUTS.pc, 'light'], [LAYOUTS.pc, 'dark'], [LAYOUTS.side, 'light'], [LAYOUTS.phone, 'light'], [LAYOUTS.phone, 'dark']]) {
    const g = await open('starters/lantern-cove', layout, { theme, uiDir: resolve(BEFORE) });
    try {
      await g.shot(`before-${layout.id}${theme === 'dark' ? '-dark' : ''}`, 'playing');
    } finally {
      await g.close();
    }
  }
}

try {
  if (BEFORE) await before();
  else {
    const on = (k) => !ONLY || ONLY.includes(k);
    if (on('cove')) await cove();
    if (on('ruins')) await ruins();
    if (on('glow')) await glow();
    if (on('phone')) await narrow(LAYOUTS.phone);
    if (on('side')) await narrow(LAYOUTS.side);
    if (on('dark')) {
      await darkPc();
      await narrow(LAYOUTS.phone, 'dark');
      await narrow(LAYOUTS.side, 'dark');
    }
    if (on('timers')) await timers();
    if (on('move')) await moveCove();
    if (on('move2d')) await moveSome('starters/firefly-ruins', LAYOUTS.pc, 'move-ruins');
    if (on('moveglow')) await moveSome('examples/three-hud', LAYOUTS.pc, 'move-glow');
    if (on('movenarrow')) {
      for (const theme of ['light', 'dark']) {
        await moveSome('starters/lantern-cove', LAYOUTS.phone, `move-phone${theme === 'dark' ? '-dark' : ''}`, { theme });
        await moveSome('starters/lantern-cove', LAYOUTS.side, `move-side${theme === 'dark' ? '-dark' : ''}`, { theme });
      }
    }
    if (on('movedark')) await moveSome('starters/lantern-cove', LAYOUTS.pc, 'move-pc-dark', { theme: 'dark' });
  }
} finally {
  if (browser) await browser.close();
}
console.log('studio-pause: ok');
process.exit(0);
