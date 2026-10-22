// Pause while playing and talk to your AI (2026-10-22, CONTRACT.md §3.5.1) in a headless browser: the
// real local server, the built editor, the starters, and the stand-in AI (test/ai-feel/fake-agent.mjs), which answers a
// paused message in its `done` note.
//
//   node test/studio-pause.browser.mjs [--only cove,ruins,glow,phone,side,dark] [--shots <dir>] [--lang ja]
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
// --before <dir>: only photos of ▶ Play with an older build's editor (`skills/arrange/bin/studio-ui` of that build).
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

async function before() {
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
  }
} finally {
  if (browser) await browser.close();
}
console.log('studio-pause: ok');
process.exit(0);
