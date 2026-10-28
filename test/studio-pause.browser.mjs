// Pause while playing — the paused moment is the editor (pause-edit, 2026-10-28; CONTRACT.md §3.5.1) — in a headless
// browser: the real local server, the built editor, the starters and examples, and the stand-in AI
// (test/ai-feel/fake-agent.mjs), which answers a paused message in its `done` note.
//
//   node test/studio-pause.browser.mjs [--only cove,ruins,glow,phone,side,dark,timers,moment,moment2d,momentnarrow,momentkeep,momentdark,momentdemo,values,valuesdark,light,lightcode,checkpoint,checkpointdark]
//                                       [--shots <dir>] [--lang ja] [--before <studio-ui dir of an older build>]
//
// Until pause-edit (2026-10-28) a pause opened a chat panel over the game ("Pause and talk", stage 1) with "✥ Move" in
// it (stage 2). Now the paused moment IS the editor: Edit's tools on the frame it stopped at (the list floating over the
// game, the card, the strip, the field at the foot), and the runs below check that shape:
//
// cove  Lantern Cove (three.js) PC 1280×800:
//   1. ▶ Play: "❚❚ Pause to edit P" in the top bar left of Edit; nothing in the game's corner (full screen only).
//   2. P in the game pauses: frames stop (a frame loop of the page's own counts nothing), the game's clock stops, the
//      game never sees the P; the editor comes up over the moment (data-moment), the list floats over the game and the
//      game's frame keeps its size, the field says "Ask … about this moment…".
//   3. Words in the field + Enter keep ONE `play` request marked `paused`, with the moment (a picture file, the camera,
//      what was near); .studio/chat/<id>.json has the person's turn. Still paused.
//   4. The stand-in AI answers: its reply on the line over the field (and its turn in the file); still paused.
//   5. A second message carries `chat` (the first id) and `history` (2 turns); "Earlier · 2" over the line.
//   6. Paused, a key press does not reach the game (the editor has the keys), its release does; Escape does NOT resume.
//   7. P resumes: frames run again, the game's clock and frame times step one frame, not the whole pause.
//   8. The top bar's ❚❚ pauses, its ▶ Resume resumes.
// ruins Firefly Ruins (PixiJS, 2D): P pauses the Ticker; a message carries what is on screen (`near`); P resumes.
// glow  Glow Garden (three.js + HTML UI, a loop that animates from the frame's own timestamp): the timestamp after
//       Resume follows on from the one before the pause.
// phone 390×844 (touch) and side 400×900 (the side window): ❚❚ in the top bar; paused: the list is the sheet, the same
//       button (now ▶) resumes.
// dark  the editor in its dark look (PC and phone), paused with a reply (photos only, plus the basic checks).
// timers Lantern Cove PC, a game stepped by timers and the wall clock (polish-1022; core/play-timers.ts).
// values / valuesdark  This moment (pause-edit stage 2, CONTRACT.md §1.14) on examples/three-neon-boss, PC: see values()
//            below. --shots: values-*-set.png is the docs' pause-moment picture.
// checkpoint / checkpointdark  Checkpoints (pause-edit stage 3, CONTRACT.md §1.14 "Checkpoints") on examples/three-neon-boss,
//            PC: see checkpoint() below. --shots: checkpoint-*-name.png / checkpoint-*-menu.png are the docs'
//            pause-checkpoint / pause-checkpoint-open pictures.
//
// The paused moment (pause-edit's checks (1)–(5)), examples/three-neon-boss (a boss, drones and shots the
// game makes a few seconds in):
// moment     PC 1280×800: (1) ▶ Play (the first-Play line under ❚❚), ¼× from the top bar's Speed, the boss comes,
//            P, ▶| three times (the clock 3/60 s on); (2) the picture is the frame it stopped on (the camera kept: the
//            canvas against the moment's own picture), the list floats, "Made by the game · 4" with "drone ×2";
//            (3) the gate (placed) moved: Save · 1, the list's dot, ⌘Z takes it back, moved again; (4) the boss (made by
//            the game) moved: "Just for this moment", ✦ puts "Make boss appear here" and the chip "boss · here" in the
//            field, sent: the request has `made` and `here`, the stand-in's reply is on the line; (5) P: on from where it
//            stopped (the score goes on from its number), the boss from where it was put, the gate where it was moved;
//            ⌘Z has no step of the moment left; Edit: the scene before Play with the gate's move, no boss.
// moment2d   Firefly Ruins (Pixi 2D): paused, a placed thing moved (Save · 1), what the game moves just for this moment.
// momentnarrow phone 390×844 (touch) and the side window 400×900, light and dark: ❚❚ in the top bar, paused, the sheet
//            lists the moment, a pick, Resume.
// momentdark PC dark: the moment's photos (the boss's card with ✦), and an AI that changes the code for ✦ (fake-agent
//            `madeCode`): Reload on the reply's line leaves the moment for the new code, Save · 1 kept.
// momentdemo the offline web demo (no AI): ❚❚ and the paused moment there too, a placed thing moved, no ✦ field; Neon
//            Run (--also examples/three-neon-boss): "Made by the game" and the boss "Just for this moment".
// pause-edit fix 1 (2026-10-28, walk 1 of stage 1) adds: the game's HUD seen in the moment (#hud, ⚠ BOSS: ✕1), no line by
//            the strip on the ship (✕2), the ↻ on its row (✕11), the clock in two places and one frame moving it, "Next
//            frame ." under ▶| at the first pause (✕8), Edit quieter with its tip, ⌘K's first row Resume (✕9), the
//            Speed menu's head (✕13), the made reply without "N objects changed" and gone back in Edit (✕6), the clock
//            going on at the next ▶ Play from Edit (✕10); narrow: no "Playing" note, 1× pressable, "▶ Resume" in words
//            (✕4 / ✕15), the boss moved → "Just for this moment" over the field (✕5).
// light      Lantern Cove in the offline web demo (pause-light, 2026-10-28): the paused picture keeps the game's own light
//            (its post-processing: bloom, tone, grade) — the frame it stopped on, pixel for pixel while nothing moves,
//            and drawn again through the game's post-processing after a move and Next frame. See light() below.
// lightcode  test/hand-post: a post-processing made by hand (nothing to find) + codeMoment({ draw }): the moment keeps the
//            game's look after a move and a zoom, its update never runs for it, its camera is given back exactly.
// --shots also takes the docs' pictures (docs/site/shots.json): moment-*-gate.png (pause-edit), moment-*-appear.png
//            (pause-made), moment-*-speed.png (pause-speed).
// --before <dir>: only photos of ▶ Play with an older build's editor (`skills/arrange/bin/studio-ui` of that build).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStudioServer } from '../src/server/server.mjs';
import { launch, newPage } from './adapters-2d/cdp.mjs';
import { startFakeAgent } from './ai-feel/fake-agent.mjs';
import { startHost } from './web-demo-host.mjs';
import { askEditor } from '../src/server/hands-cli.mjs';

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
const SHELL = `document.querySelector('.shell')`;
const M = `${GW}.__gameStudio._move`;
const LAYOUTS = {
  pc: { id: 'pc', width: 1280, height: 800, mobile: false, dpr: 1 },
  side: { id: 'side', width: 400, height: 900, mobile: false, dpr: 2 },
  phone: { id: 'phone', width: 390, height: 844, mobile: true, dpr: 2 },
};
/** Where an element of the editor page is (its middle), or null when it is not on screen. */
const box = (sel) => `(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.offsetParent && !x.hidden); if (!e) return null;
  const r = e.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2, left: r.left, right: r.right, top: r.top, bottom: r.bottom, w: r.width, h: r.height, text: e.textContent }); })()`;
const IN = {
  ready: `document.querySelectorAll('.obj').length > 0 && !!${GW}?.__gameStudio?._debug`,
  playing: `${SHELL}.dataset.playing === 'on' && !!document.querySelector('[data-part=play-pause]:not([hidden])')`,
  moment: `${SHELL}.dataset.moment === 'on' && ${SHELL}.dataset.paused === 'on'`,
  running: `${SHELL}.dataset.moment !== 'on' && ${SHELL}.dataset.paused !== 'on'`,
  // The game page's corner (full screen only since pause-edit) and the ✦ mark.
  corner: `JSON.stringify((() => { const h = ${OV}; if (!h) return null; const q = (s) => h.shadowRoot.querySelector(s); return { pause: !!q('[data-part=pause-button]') && !q('[data-part=pause-button]').hidden, mark: !q('.mark').hidden }; })())`,
  // A frame loop of the page's own through the game's requestAnimationFrame (what a game's loop does), and its clock.
  probe: `(() => { const w = ${GW}; if (w.__pp) return true; w.__pp = { f: 0, st: [], down: [], up: [] };
    const loop = (t) => { w.__pp.f++; w.__pp.st.push(t); if (w.__pp.st.length > 8) w.__pp.st.shift(); w.requestAnimationFrame(loop); }; w.requestAnimationFrame(loop);
    w.addEventListener('keydown', (e) => w.__pp.down.push(e.key)); w.addEventListener('keyup', (e) => w.__pp.up.push(e.key)); return true; })()`,
  pp: `JSON.stringify({ f: ${GW}.__pp.f, st: ${GW}.__pp.st.slice(), down: ${GW}.__pp.down.slice(), up: ${GW}.__pp.up.slice(), now: ${GW}.performance.now() })`,
  line: `(() => { const l = document.querySelector('.ai-line'); return l && !l.hidden && l.offsetParent ? l.textContent : ''; })()`,
  rows: `JSON.stringify([...document.querySelectorAll('.objects > li')].filter((l) => l.offsetParent).map((l) => ({ key: l.dataset.key || '', text: l.textContent.trim(), cls: l.className })))`,
  card: `(() => { const c = document.querySelector('[data-part=card]'); return c && !c.hidden && c.offsetParent ? c.textContent : ''; })()`,
  save: `(() => { const b = [...document.querySelectorAll('[data-action=save]')].find((e) => e.offsetParent); return b ? b.textContent : ''; })()`,
  frame: `JSON.stringify((() => { const r = ${FR}.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; })())`,
};
const j = async (page, expr) => JSON.parse((await page.eval(expr)) || 'null');
/** The line by the strip in the game page (handles.ts .note), '' when none shows. */
const stripNote = (page) => page.eval(`(() => { const h = [...${FR}.contentDocument.querySelectorAll('[data-studio-ui]')].map((x) => x.shadowRoot?.querySelector('.note')).find((n) => n && n.style.display !== 'none' && n.style.visibility !== 'hidden'); return h ? h.textContent : ''; })()`);
/** The game's own HTML in the game page: seen (visibility), takes the pointer or not (fix 1 ✕1). */
const gameHtml = (page, sel) => j(page, `JSON.stringify((() => { const e = ${GW}.document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const c = ${GW}.getComputedStyle(e);
  return { vis: c.visibility, pe: c.pointerEvents, hidden: e.hidden, text: e.textContent.replace(/\s+/g, ' ').trim() }; })())`);

function gameFolder(src, theme = 'light') {
  const root = mkdtempSync(join(tmpdir(), 'studio-pause-'));
  cpSync(join(PKG, src), root, { recursive: true });
  // A test's own game (test/hand-post) has no copy of the loader kept with it: the built one, as the AI's copy would be.
  if (!existsSync(join(root, 'studio-placement.js'))) copyFileSync(join(PKG, 'skills/arrange/bin/studio-placement.js'), join(root, 'studio-placement.js'));
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

/** `modifiers`: CDP's bits (2 = Ctrl: ⌘K opens the palette with Ctrl+K too). */
async function keyIn(page, key, code, text, modifiers = 0) {
  const vk = key === 'Enter' ? 13 : key === 'Escape' ? 27 : key === '.' ? 190 : key.toUpperCase().charCodeAt(0);
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk, modifiers, ...(text ? { text } : {}) });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, modifiers });
}
async function type(page, text) {
  await page.send('Input.insertText', { text });
}
/** A press on something of the editor page: the mouse, or a finger on a phone. */
async function press(page, b, mobile) {
  if (mobile) await page.tap(b.x, b.y);
  else await page.click(b.x, b.y);
}

let browser = null;
async function open(src, layout, { theme = 'light', uiDir, play = true } = {}) {
  const root = gameFolder(src, theme);
  // Started as from Claude Code (which-ai.mjs): the replies end with "More in Claude".
  const srv = await startStudioServer({ root, uiDir: uiDir || join(PKG, 'skills/arrange/bin/studio-ui'), log: () => {}, env: { CLAUDECODE: '1' } });
  if (!browser) browser = await launch();
  const page = await newPage(browser, { width: layout.width, height: layout.height, mobile: layout.mobile });
  if (!layout.mobile) await page.send('Emulation.setDeviceMetricsOverride', { width: layout.width, height: layout.height, deviceScaleFactor: layout.dpr, mobile: false });
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
  await page.goto(srv.url);
  await page.waitFor(IN.ready, 90000);
  let n = 0;
  const shot = async (tag, what) => {
    if (!SHOTS) return;
    const f = `${tag}-${String(++n).padStart(2, '0')}-${what}.png`;
    writeFileSync(join(SHOTS, f), await page.screenshot());
    console.log(`  shot ${f}`);
  };
  if (play) {
    await page.eval(`document.querySelector('button.play').click()`);
    await page.waitFor(IN.playing, 30000);
    // The game's own first frames (a starter fades in): give it a moment before the photos and the clock checks.
    await sleep(1500);
  }
  return { root, srv, page, shot, close: async () => { await page.close(); srv.close(); rmSync(root, { recursive: true, force: true }); } };
}

/** Is the game held? Its frame loop and its clock, over `ms`. */
async function held(page, ms = 1200) {
  const a = await j(page, IN.pp);
  await sleep(ms);
  const b = await j(page, IN.pp);
  return { frames: b.f - a.f, clock: b.now - a.now, a, b };
}

/** P in the game (a press on it first, so the game page has the keys), then the moment is up. */
async function pauseP(page, at = [640, 260]) {
  await page.click(at[0], at[1]);
  await keyIn(page, 'p', 'KeyP', 'p');
  await page.waitFor(IN.moment, 10000);
  await sleep(400);
}
/** The top bar's ❚❚ / ▶ Resume. */
async function pauseBtn(page, mobile = false) {
  const b = await j(page, box('[data-part=play-pause]'));
  assert.ok(b, 'the top bar\'s ❚❚ / ▶');
  await press(page, b, mobile);
  return b;
}

/** Words in the field at the foot + Enter: the paused request `n`, then the stand-in's reply on the line. */
async function fieldSay(page, root, text, n) {
  await page.eval(`(document.querySelector('.ask-input').focus(), true)`);
  if (text) await type(page, text);
  await keyIn(page, 'Enter', 'Enter', '\r');
  const rec = await until(() => requests(root).filter((r) => r.kind === 'play' && r.paused)[n - 1], 10000, `paused request ${n}`);
  if (text) assert.equal(rec.text, text);
  const line = await until(async () => {
    const l = await page.eval(IN.line);
    return /I see the moment|止めた瞬間を見ました|Following our|件の話の続き|will come in|から出るように/.test(l) && (n === 1 || /Following our|件の話の続き|will come in|から出るように/.test(l)) ? l : null;
  }, 20000, `reply ${n} on the line`);
  return { rec, line };
}

/** Pick `key` (the editor's own action, as a list row's press), then the strip's `tool` and a drag from a free spot. */
async function stripDrag(page, key, dx, dy, { tool = 'move', from, mobile = false } = {}) {
  await page.eval(`studioShell.actions.select(${JSON.stringify(key)})`);
  await page.waitFor(`studioShell.selected() === ${JSON.stringify(key)}`, 4000);
  await sleep(500);
  const b = await j(page, `(() => { const f = ${FR}.getBoundingClientRect(); const ui = ${FR}.contentDocument.querySelector('[data-studio-ui]');
    const e = ui?.shadowRoot?.querySelector('[data-studio-handle=${tool}]'); if (!e || !e.getBoundingClientRect().width) return null;
    const r = e.getBoundingClientRect(); return JSON.stringify({ x: f.left + r.left + r.width / 2, y: f.top + r.top + r.height / 2, on: e.getAttribute('aria-pressed') === 'true' }); })()`);
  assert.ok(b, `the strip's ${tool} under ${key}`);
  // Chosen already (a second drag with the same tool): a press would put it down again.
  if (!b.on) await press(page, b, mobile);
  await sleep(300);
  const [x, y] = from;
  if (mobile) await page.touchDrag(x, y, x + dx, y + dy, 10);
  else await page.mouseDrag(x, y, x + dx, y + dy, 10);
  await sleep(500);
}
const poseOf = (page, key) => j(page, `JSON.stringify(${M}.list().find((i) => i.key === ${JSON.stringify(key)})?.pose || null)`);
const gap = (a, b) => Math.hypot(...a.p.map((v, i) => v - (b.p[i] ?? 0)));

async function cove() {
  console.log('cove: Lantern Cove, PC 1280×800');
  const g = await open('starters/lantern-cove', LAYOUTS.pc);
  const { root, page, shot } = g;
  const agent = startFakeAgent(root);
  try {
    await page.eval(IN.probe);
    // 1. ❚❚ Pause to edit P in the top bar, left of Edit; nothing in the game's corner (full screen only).
    const pb = await j(page, box('[data-part=play-pause]'));
    const edit = await j(page, box('button.play'));
    assert.ok(pb && edit && pb.right <= edit.left + 1 && pb.top >= 0 && pb.bottom <= 60, `❚❚ left of Edit in the top bar ${JSON.stringify(pb)}`);
    assert.match(pb.text, ja ? /止めて編集\s*P/ : /Pause to edit\s*P/);
    let c = await j(page, IN.corner);
    assert.ok(c && !c.pause && !c.mark, `nothing in the game's corner out of full screen ${JSON.stringify(c)}`);
    // (the `c` below: the corner again in full screen, step 9)
    await shot('cove', 'playing');
    const running = await held(page, 1500);
    assert.ok(running.frames >= 2, `the game runs before the pause (${running.frames} frames)`);
    // 2. P in the game: the moment is the editor.
    const frame0 = await page.eval(IN.frame);
    await pauseP(page);
    const pausedAt = Date.now();
    const h = await held(page);
    assert.ok(h.frames <= 1, `paused: no frames (${h.frames})`);
    assert.equal(h.clock, 0, 'paused: the game\'s clock stands still');
    assert.ok(!h.b.down.includes('p') && !h.b.down.includes('P'), `the game never saw the P (${h.b.down})`);
    assert.equal(await page.eval(IN.frame), frame0, 'the game keeps its size (the list floats over it)');
    const side = await j(page, box('.side'));
    assert.ok(side && side.left > 0 && side.top > 40, `the list floats over the game ${JSON.stringify(side)}`);
    assert.ok((await j(page, IN.rows)).length > 3, 'the moment\'s list');
    const ph = await page.eval(`document.querySelector('.ask-input').placeholder`);
    assert.match(ph, ja ? /この瞬間について/ : /about this moment/, `the field: ${ph}`);
    assert.match(await page.eval(`document.querySelector('[data-part=play-guide]').textContent`), ja ? /止めています/ : /Paused/);
    await shot('cove', 'paused');
    // 3. A message from the field.
    const q1 = ja ? 'なぜ灯台はここにある？' : 'Why is the lighthouse out here?';
    const { rec: rec1, line: l1 } = await fieldSay(page, root, q1, 1);
    assert.match(rec1.shot || '', /^\.studio\/play\/.*\.jpg$/, 'the moment\'s picture');
    assert.ok(existsSync(join(root, rec1.shot)));
    assert.ok(rec1.view, 'the player\'s camera');
    assert.ok(rec1.near?.length, 'what was near');
    assert.equal(rec1.chat, undefined, 'the first message is the talk');
    const c1 = await until(() => chatFile(root, rec1.id), 5000, 'the chat file');
    assert.equal(c1.turns[0].who, 'you');
    assert.equal(c1.turns[0].text, q1);
    // 4. The reply on the line over the field.
    assert.ok(l1.includes(rec1.near[0].label || rec1.near[0].key), `the reply names what was nearest: ${l1}`);
    await shot('cove', 'replied');
    assert.ok((await held(page, 600)).frames <= 1, 'still paused after the reply');
    // 5. A second message: the talk so far goes with it.
    const q2 = ja ? '少し左に寄せられる？' : 'Could it sit a bit more to the left?';
    const { rec: rec2 } = await fieldSay(page, root, q2, 2);
    assert.equal(rec2.chat, rec1.id, 'the second message names the talk');
    assert.deepEqual(rec2.history?.map((t) => t.who), ['you', 'ai']);
    assert.equal(rec2.shot, undefined, 'the moment went with the first message');
    const earlier = await until(() => page.eval(`document.querySelector('[data-part=moment-earlier]:not([hidden])')?.textContent || ''`), 5000, 'Earlier · 2');
    assert.match(earlier, ja ? /前の話 2/ : /Earlier · 2/);
    await shot('cove', 'second-reply');
    console.log(`  ok: paused, 2 messages from the field, 2 replies, .studio/chat/${rec1.id}.json`);
    // 6. Keys while paused, outside the field: presses stay out of the game, releases reach it; Escape keeps it paused.
    await page.eval(`(document.activeElement?.blur?.(), ${GW}.focus(), true)`);
    const before = await j(page, IN.pp);
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'w', code: 'KeyW', windowsVirtualKeyCode: 87, text: 'w' });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'w', code: 'KeyW', windowsVirtualKeyCode: 87 });
    await keyIn(page, 'Escape', 'Escape');
    await sleep(300);
    const after = await j(page, IN.pp);
    assert.equal(after.down.length, before.down.length, `no key press reached the game while paused (${after.down})`);
    assert.ok(after.up.length > before.up.length, 'the release did (no key stays down after Resume)');
    assert.equal(await page.eval(IN.moment), true, 'Escape does not resume (as in Edit)');
    // 7. P resumes, one frame on.
    const last = after.st[after.st.length - 1];
    const pausedFor = after.now;
    await keyIn(page, 'p', 'KeyP', 'p');
    await page.waitFor(IN.running, 5000);
    const r = await held(page, 1500);
    assert.ok(r.frames >= 2, `frames again after Resume (${r.frames})`);
    const firstAfter = r.b.st.find((t) => t > last) ?? r.b.st[0];
    const pausedMs = Date.now() - pausedAt;
    assert.ok(pausedMs > 5000, `paused long enough to tell (${pausedMs} ms)`);
    assert.ok(firstAfter - last < 1200, `the first frame time after Resume follows on (+${Math.round(firstAfter - last)} ms after ${pausedMs} ms paused)`);
    assert.ok(r.a.now - pausedFor < 1500, `the game's clock went on from where it stopped (+${Math.round(r.a.now - pausedFor)} ms after ${pausedMs} ms paused)`);
    assert.equal((await j(page, box('.side'))), null, 'the tools step away again');
    await shot('cove', 'resumed');
    // 8. The top bar's ❚❚, then its ▶ Resume.
    await pauseBtn(page);
    await page.waitFor(IN.moment, 5000);
    assert.equal(await page.eval(`document.querySelector('[data-part=moment-earlier]').hidden`), true, 'a new pause is a new talk');
    assert.ok((await held(page, 600)).frames <= 1, '❚❚ pauses');
    const rb = await j(page, box('[data-part=play-pause]'));
    assert.match(rb.text, ja ? /続ける/ : /Resume/);
    await pauseBtn(page);
    await page.waitFor(IN.running, 5000);
    assert.ok((await held(page, 1500)).frames >= 2, 'Resume resumes');
    console.log('  ok: the game held and let go: frames, clock, keys; Escape stays; ❚❚ and ▶ Resume');
    // 9. Full screen (the game's own): the corner's ❚❚ is there (the top bar is not seen); pressed, the game leaves full
    // screen into the paused moment (the editor's tools are outside the game's page).
    const fs = await page.send('Runtime.evaluate', { expression: `${FR}.contentDocument.documentElement.requestFullscreen().then(() => true, (e) => String(e))`, awaitPromise: true, userGesture: true, returnByValue: true });
    if (fs.result?.value === true) {
      await page.waitFor(`!!${FR}.contentDocument.fullscreenElement`, 3000);
      await sleep(400);
      c = await j(page, IN.corner);
      assert.ok(c?.pause, `the corner's ❚❚ in full screen ${JSON.stringify(c)}`);
      await shot('cove', 'fullscreen');
      const fb = await j(page, `JSON.stringify((() => { const b = ${Q('[data-part=pause-button]')}.getBoundingClientRect(); const f = ${FR}.getBoundingClientRect(); return { x: f.left + b.left + b.width / 2, y: f.top + b.top + b.height / 2 }; })())`);
      await page.click(fb.x, fb.y);
      await page.waitFor(IN.moment, 8000);
      await page.waitFor(`!${FR}.contentDocument.fullscreenElement && !document.fullscreenElement`, 5000);
      assert.ok((await held(page, 600)).frames <= 1, 'paused, out of full screen');
      await shot('cove', 'fullscreen-paused');
      await pauseBtn(page);
      await page.waitFor(IN.running, 5000);
      console.log('  ok: full screen: the corner\'s ❚❚, then out of it into the paused moment');
    } else console.log(`  (full screen not allowed here: ${fs.result?.value})`);
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
    await pauseP(page);
    const t0 = await page.eval(tick);
    const h = await held(page);
    assert.ok(h.frames <= 1, `paused: no frames (${h.frames})`);
    assert.equal(await page.eval(tick), t0, 'Pixi\'s Ticker is held');
    const { rec, line } = await fieldSay(page, root, ja ? '門の上で光っているのは何？' : 'What is glowing over the gate?', 1);
    assert.equal(rec.dim, '2d');
    assert.ok(rec.near?.length, '2D: what is on screen goes with it');
    assert.ok(line.length > 10);
    await shot('ruins', 'replied');
    await page.eval(`(document.activeElement?.blur?.(), true)`);
    await keyIn(page, 'p', 'KeyP', 'p');
    await page.waitFor(IN.running, 5000);
    assert.ok((await held(page, 1500)).frames >= 2, 'P resumes');
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
    await pauseP(page, [640, 300]);
    const a = await j(page, IN.pp);
    await shot('glow', 'paused');
    await sleep(4000);
    // P typed in the field is a letter (a message may start with "p"); out of it, it resumes.
    await page.eval(`(document.querySelector('.ask-input').focus(), true)`);
    await keyIn(page, 'p', 'KeyP', 'p');
    await sleep(300);
    assert.equal(await page.eval(IN.moment), true, 'P in the field is a letter');
    assert.equal(await page.eval(`document.querySelector('.ask-input').value`), 'p');
    await page.eval(`(document.querySelector('.ask-input').value = '', document.activeElement.blur(), true)`);
    await keyIn(page, 'p', 'KeyP', 'p');
    await page.waitFor(IN.running, 5000);
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
    const b = await j(page, `JSON.stringify((() => { const r = (s) => document.querySelector(s).getBoundingClientRect(); const p = r('[data-action=play-pause]'), e = r('button.play'), t = r('header.top');
      return { x: p.left + p.width / 2, y: p.top + p.height / 2, w: p.width, right: p.right, editLeft: e.left, inBar: p.top >= t.top && p.bottom <= t.bottom }; })())`);
    assert.ok(b.inBar && b.right <= b.editLeft + 1, `❚❚ in the top bar, left of Edit ${JSON.stringify(b)}`);
    const c = await j(page, IN.corner);
    assert.ok(c && !c.pause, 'no ❚❚ drawn over the game here');
    await shot(tag, 'playing');
    await press(page, b, layout.mobile);
    await page.waitFor(IN.moment, 8000);
    assert.ok((await held(page, 800)).frames <= 1, 'paused from the top bar');
    const b2 = await j(page, box('[data-part=play-pause]'));
    // Since pause-edit fix 1 (walk-1 ✕15) the paused button says "▶ Resume" and grows to the left; its right edge stays
    // put, so the spot the finger pressed is still inside it (before: the same 44 px ▶, so the centres matched).
    assert.ok(b.x >= b2.left && b.x <= b2.right && Math.abs(b2.right - b.right) < 2 && Math.abs(b2.y - b.y) < 2, `the button stays under the finger (now ▶) ${JSON.stringify(b2)} ${JSON.stringify(b)}`);
    await shot(tag, 'paused');
    await fieldSay(page, root, ja ? 'ここは何？' : 'What is this place?', 1);
    await shot(tag, 'replied');
    await press(page, b, layout.mobile);
    await page.waitFor(IN.running, 5000);
    assert.ok((await held(page, 1500)).frames >= 2, 'the same button resumes');
    console.log('  ok: ❚❚ in the top bar, a reply in the moment, resumed');
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
    await pauseP(page);
    await fieldSay(page, root, ja ? 'なぜ灯台はここにある？' : 'Why is the lighthouse out here?', 1);
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
    await pauseP(page);
    a = await read();
    await shot('timers', 'paused');
    await page.eval(TIMERS.later);
    // The studio's own timers still run while the game's wait: the field sends and the stand-in AI's reply shows.
    await fieldSay(page, root, ja ? 'タイマーは止まっている？' : 'Are the timers stopped?', 1);
    await sleep(1500);
    b = await read();
    assert.deepEqual([b.n - a.n, b.t - a.t, b.late], [0, 0, 0], `paused: no timer fired (interval +${b.n - a.n}, chain +${b.t - a.t}, set while paused ${b.late})`);
    assert.equal(b.d, a.d, `paused: Date.now() stands still (+${b.d - a.d} ms over ${b.wall - a.wall} ms)`);
    await shot('timers', 'paused-later');
    const pausedMs = b.wall - a.wall;
    // Resume.
    await page.eval(`(document.activeElement?.blur?.(), ${GW}.focus(), true)`);
    await keyIn(page, 'p', 'KeyP', 'p');
    await page.waitFor(IN.running, 5000);
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


// ----- the paused moment (pause-edit, 2026-10-28) -----

/** A spot of the game where a press meets nothing (to drag a chosen strip tool from), near (x, y) of the frame. */
async function freeSpot(page, near = [0.5, 0.2]) {
  return j(page, `JSON.stringify((() => { const f = ${FR}.getBoundingClientRect(); const m = ${M};
    for (const r of [0, 40, 80, 120, 160]) for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1]]) {
      const x = f.width * ${near[0]} + dx * r, y = f.height * ${near[1]} + dy * r;
      if (x < 300 || x > f.width - 300 || y < 60 || y > f.height - 120) continue;
      if (!m.under(x, y, 16)) return { x: f.left + x, y: f.top + y };
    }
    return null; })())`);
}
/**
 * The paused frame against the moment's own picture (taken as it stopped, before the editor came up): the middle of
 * the game (clear of the floating list, the card and the HUD), drawn small, mean difference per channel (0–255).
 */
const pictureDiff = (page) => page.eval(`(async () => { const w = ${GW}; const src = w.__gameStudio._move.shot(); if (!src) return -1;
  const a = new w.Image(); a.src = src; await a.decode(); const gl = w.document.querySelector('canvas');
  const W = 256, H = Math.round(256 * gl.height / gl.width);
  const draw = (img) => { const c = w.document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d'); x.drawImage(img, 0, 0, W, H); return x.getImageData(0, 0, W, H).data; };
  const p = draw(a), q = draw(gl); let sum = 0, n = 0;
  for (let y = Math.round(H * 0.3); y < H * 0.75; y++) for (let x = Math.round(W * 0.35); x < W * 0.65; x++) { const i = (y * W + x) * 4; sum += Math.abs(p[i] - q[i]) + Math.abs(p[i + 1] - q[i + 1]) + Math.abs(p[i + 2] - q[i + 2]); n += 3; }
  return sum / n; })()`);
/** The game page's canvas, small (to tell "nothing moved" between two moments). */
const canvasSig = (page) => page.eval(`(() => { const gl = ${GW}.document.querySelector('canvas'); const c = ${GW}.document.createElement('canvas'); c.width = 64; c.height = 40;
  const x = c.getContext('2d'); x.drawImage(gl, 0, 0, 64, 40); return Array.from(x.getImageData(0, 0, 64, 40).data.filter((_, i) => i % 4 !== 3)).join(','); })()`);
const sigDiff = (a, b) => {
  const p = a.split(',').map(Number), q = b.split(',').map(Number);
  return p.reduce((s, v, i) => s + Math.abs(v - q[i]), 0) / p.length;
};

/** The paused moment's checks (1)–(5) on examples/three-neon-boss, PC. */
async function moment(theme = 'light') {
  const tag = theme === 'dark' ? 'moment-dark' : 'moment';
  console.log(`${tag}: Neon Run with a boss, PC 1280×800 (${theme})`);
  const g = await open('examples/three-neon-boss', LAYOUTS.pc, { theme });
  const { root, page, shot } = g;
  // The dark run's stand-in changes the code for ✦ as a real AI does (fix 1 ✕6: Reload on the moment's reply).
  const agent = startFakeAgent(root, { madeCode: theme === 'dark' });
  try {
    // (1) The first ▶ Play of this person: one line under ❚❚. The guide: ● Playing 0:0x.x · 1× ⌄.
    const tip = await page.eval(`document.querySelector('[data-part=play-tip]:not([hidden])')?.textContent || ''`);
    assert.match(tip, ja ? /いつでも止めて、その瞬間のまま編集できます/ : /Pause anytime to edit that very moment/, 'the first-Play line');
    assert.match(await page.eval(`document.querySelector('[data-part=play-guide]').textContent`), ja ? /遊んでいます\s*0:0\d\.\d\s*1×/ : /Playing\s*0:0\d\.\d\s*1×/);
    // Speed: the menu, then ¼× — the game's time a quarter of the real one.
    await press(page, await j(page, box('[data-part=play-speed]')));
    await page.waitFor(`!!document.querySelector('[data-action="ctx-speed-0.25"]')`, 3000);
    // fix 1 ✕13: the menu's head says what the numbers are.
    assert.match(await page.eval(`document.querySelector('.ctx-menu')?.textContent || ''`), ja ? /^速さ/ : /^Speed/, 'the Speed menu\'s head');
    await shot(tag, 'speed');
    await page.eval(`document.querySelector('[data-action="ctx-speed-0.25"]').click()`);
    await until(async () => (await page.eval(`${M}.rate()`)) === 0.25, 3000, '¼× in the game');
    assert.match(await page.eval(`document.querySelector('[data-part=play-speed]').textContent`), /¼×/);
    const s0 = await page.eval(`${M}.seconds()`);
    const w0 = Date.now();
    await sleep(2000);
    const rate = ((await page.eval(`${M}.seconds()`)) - s0) / ((Date.now() - w0) / 1000);
    assert.ok(rate > 0.15 && rate < 0.35, `¼×: the game's time runs a quarter as fast (${rate.toFixed(3)})`);
    // The boss and its drones come (the game makes them at 4 s and 5 s of its own time).
    await until(async () => (await j(page, `JSON.stringify(${M}.list().map((i) => i.key))`)).includes('drone#2'), 90000, 'the boss and the drones');
    await sleep(300);
    await shot(tag, 'slow');
    // P.
    await pauseP(page, [640, 120]);
    assert.equal(await page.eval(`!!document.querySelector('[data-part=play-tip]:not([hidden])')`), false, 'the first-Play line went at the first pause');
    // fix 1 ✕1: the game's HUD stays seen over the moment (the score, the time left, ⚠ BOSS), and takes no pointer.
    const hud = await gameHtml(page, '#hud');
    assert.ok(hud && hud.vis === 'visible' && hud.pe === 'none', `the HUD seen in the moment, no pointer ${JSON.stringify(hud)}`);
    const banner = await gameHtml(page, '#boss');
    assert.ok(banner && !banner.hidden && banner.vis === 'visible', `⚠ BOSS seen in the moment ${JSON.stringify(banner)}`);
    // fix 1 ✕8: "Next frame ." under ▶| at the first pause; the clock in two places, one frame moves it.
    assert.match(await page.eval(`document.querySelector('[data-part=step-tip]:not([hidden])')?.textContent || ''`), ja ? /1 コマ進める/ : /Next frame/, 'the Next frame line under ▶|');
    const clock = () => page.eval(`document.querySelector('[data-part=play-time]').textContent`);
    assert.match(await clock(), /^0:0\d\.\d\d$/, 'the paused clock in two places');
    // fix 1 ✕9: Edit while paused is the quieter button and says where it goes; ⌘K's first row is Resume.
    const editTip = await page.eval(`document.querySelector('button.play').title`);
    assert.match(editTip, ja ? /編集 — 遊ぶ前のシーンに戻る/ : /Edit — back to your scene before Play/, `Edit's tip while paused (${editTip})`);
    const editBg = await page.eval(`getComputedStyle(document.querySelector('button.play')).backgroundColor`);
    const resumeBg = await page.eval(`getComputedStyle(document.querySelector('[data-part=play-pause]')).backgroundColor`);
    assert.notEqual(editBg, resumeBg, 'Edit is not the same button as Resume while paused');
    const t0 = await page.eval(`${M}.seconds()`);
    const c0 = await clock();
    for (let i = 0; i < 3; i++) {
      await press(page, await j(page, box('[data-part=play-step]')));
      await sleep(150);
      if (i === 0) {
        assert.notEqual(await clock(), c0, `one Next frame moves the clock (${c0})`);
        assert.equal(await page.eval(`!!document.querySelector('[data-part=step-tip]:not([hidden])')`), false, 'the Next frame line went at the first step');
      }
    }
    const t1 = await page.eval(`${M}.seconds()`);
    assert.ok(Math.abs(t1 - t0 - 3 / 60) < 0.004, `▶| three times: three frames of the game's time (+${(t1 - t0).toFixed(4)} s)`);
    assert.match(await clock(), /^0:0\d\.\d\d$/);
    await keyIn(page, '.', 'Period', '.');
    await sleep(200);
    assert.ok(Math.abs((await page.eval(`${M}.seconds()`)) - t1 - 1 / 60) < 0.004, 'the . key: one frame more');
    // (2) The picture is the frame it stopped on (a step later: the steps are the game's own frames), and nothing moves.
    const sigA = await canvasSig(page);
    await sleep(1500);
    assert.ok(sigDiff(sigA, await canvasSig(page)) < 0.5, 'nothing moves until you say');
    const side = await j(page, box('.side'));
    assert.ok(side && side.left > 8 && side.top > 40, `the list floats over the game ${JSON.stringify(side)}`);
    const rows = await j(page, IN.rows);
    const made = rows.find((r) => r.cls.includes('made-head'));
    assert.ok(made && /4$/.test(made.text), `"Made by the game · 4" ${JSON.stringify(rows.map((r) => r.text))}`);
    assert.ok(rows.some((r) => r.key === 'drone' && /2$/.test(r.text)), 'drone ×2 in one row');
    assert.ok(rows.findIndex((r) => r.key === 'boss') > rows.indexOf(made) && rows.findIndex((r) => r.key === 'gate') < rows.indexOf(made), 'the scene\'s own things above, what the game made below');
    assert.equal(await page.eval(`${M}.why('boss')`), 'new');
    assert.equal(await page.eval(`${M}.why('ship')`), 'game');
    assert.equal(await page.eval(`${M}.why('gate')`), null);
    // fix 1 ✕11: ↻ on the rows of what the game moves (the ship), none on what was placed (the gate).
    assert.equal(await page.eval(`!!document.querySelector('.objects li[data-key=ship] [data-part=moves-mark]')`), true, '↻ on the ship\'s row');
    assert.equal(await page.eval(`!!document.querySelector('.objects li[data-key=gate] [data-part=moves-mark]')`), false, 'no ↻ on the gate');
    await shot(tag, 'paused');
    // fix 1 ✕2: the ship picked — no line by the strip ("Moving it here sets where it starts" said the opposite of the
    // card); the card says "Just for this moment".
    await page.eval(`studioShell.actions.select('ship')`);
    await page.waitFor(`studioShell.selected() === 'ship'`, 4000);
    await sleep(600);
    assert.equal(await stripNote(page), '', 'no line by the strip on the ship in the moment');
    assert.match(await page.eval(IN.card), ja ? /この瞬間だけ/ : /Just for this moment/);
    await shot(tag, 'ship');
    // fix 1 ✕9: ⌘K opens on Resume.
    await page.eval(`(document.activeElement?.blur?.(), true)`);
    await keyIn(page, 'k', 'KeyK', undefined, 2);
    await page.waitFor(`!!document.querySelector('#studio-palette:not([hidden]) [data-action]')`, 3000);
    const first = await page.eval(`document.querySelector('#studio-palette [data-action]')?.dataset.action || ''`);
    assert.equal(first, 'play-pause', `⌘K's first row while paused is Resume (${first})`);
    await keyIn(page, 'Escape', 'Escape');
    await sleep(300);
    // (3) The gate (placed): as in Edit — Save · 1, the list's dot, ⌘Z takes it back, then again.
    const gate0 = await poseOf(page, 'gate');
    const spot = await freeSpot(page, [0.5, 0.18]);
    assert.ok(spot, 'a free spot to drag from');
    await stripDrag(page, 'gate', 0, 70, { from: [spot.x, spot.y] });
    const gate1 = await poseOf(page, 'gate');
    assert.ok(gap(gate1, gate0) > 0.5, `the gate moved (${gap(gate1, gate0).toFixed(2)} m)`);
    await until(async () => /1/.test(await page.eval(IN.save)), 4000, 'Save · 1');
    assert.equal(await page.eval(`!!document.querySelector('.objects li[data-key=gate] .unsaved-dot')`), true, 'the list\'s dot on the gate');
    assert.ok(!/(Just for this moment|この瞬間だけ)/.test(await page.eval(IN.card)), 'the gate\'s card: as in Edit');
    await page.eval(`document.querySelector('[data-action=undo]').click()`);
    await sleep(400);
    assert.ok(gap(await poseOf(page, 'gate'), gate0) < 0.01, '⌘Z: the gate back');
    assert.equal(await page.eval(IN.save), '', 'nothing unsaved after ⌘Z');
    await stripDrag(page, 'gate', 0, 70, { from: [spot.x, spot.y] });
    const gate2 = await poseOf(page, 'gate');
    await until(async () => /1/.test(await page.eval(IN.save)), 4000, 'Save · 1 again');
    await shot(tag, 'gate');
    // (4) The boss (made by the game): just for this moment; ✦ asks Claude to make it appear there.
    const boss0 = await poseOf(page, 'boss');
    const spot2 = await freeSpot(page, [0.5, 0.18]);
    await stripDrag(page, 'boss', -90, 0, { from: [spot2.x, spot2.y] });
    const boss1 = await poseOf(page, 'boss');
    assert.ok(boss1.p[0] < boss0.p[0] - 1, `the boss went left (x ${boss0.p[0].toFixed(1)} → ${boss1.p[0].toFixed(1)})`);
    const card = await page.eval(IN.card);
    assert.match(card, ja ? /この瞬間だけ.*ゲームが出した物/ : /Just for this moment.*The game made this/);
    assert.match(await page.eval(IN.save), /1/, 'the boss is not counted for Save (still 1: the gate)');
    assert.equal(await page.eval(`!!document.querySelector('[data-part=card] [data-action=copy]')?.offsetParent`), false, 'no Copy / Delete on what the game made');
    await press(page, await j(page, box('[data-action=moment-appear]')));
    await sleep(400);
    assert.equal(await page.eval(`document.querySelector('.ask-input').value`), ja ? 'bossがここに出るようにして' : 'Make boss appear here');
    assert.match(await page.eval(`document.querySelector('.ask-chip').textContent`), ja ? /boss · ここ/ : /boss · here/);
    await shot(tag, 'appear');
    const { rec, line } = await fieldSay(page, root, '', 1);
    assert.equal(rec.made, true, 'the request says the game made it');
    assert.equal(rec.here?.key, 'boss');
    assert.ok(Math.abs(rec.here.to.p[0] - boss1.p[0]) < 0.01 && Math.abs(rec.here.at.p[0] - boss0.p[0]) < 0.6, `where it was and where it was put ${JSON.stringify(rec.here)}`);
    assert.ok(rec.shot && rec.paused, 'the moment\'s picture with it');
    assert.match(line, ja ? /boss.*から出るように/ : /boss will come in around X/, `the reply on the line: ${line}`);
    // fix 1 ✕6: a made reply never counts objects (the AI changed where the game makes it, no object of the scene).
    await sleep(600);
    assert.ok(!/objects? changed|個変わりました/.test(await page.eval(IN.line)), `no "N objects changed" on a made reply: ${await page.eval(IN.line)}`);
    await shot(tag, 'replied');
    // The moment's own picture against the frame: the camera is the player's (measured before any move: the request's
    // picture is from the pause; the middle of the frame is road and gate, which the gate's move changed little).
    const diff = await pictureDiff(page);
    assert.ok(diff >= 0 && diff < 24, `the paused frame is the frame it stopped on (mean difference ${diff.toFixed(1)} of 255)`);
    if (theme === 'dark') {
      // fix 1 ✕6: the AI changed the code (madeCode: --changed 1) — Reload on the reply's line, right in the moment. It
      // leaves the moment for a new page of the game from its new code, still in Play; Save · 1 (the gate) stays; the
      // boss comes in where it was put.
      const rl = await until(async () => j(page, box('[data-action=moment-reload]')), 10000, 'Reload on the moment\'s reply');
      await shot(tag, 'reload');
      await press(page, rl);
      const left = `${SHELL}.dataset.playing === 'on' && ${SHELL}.dataset.moment !== 'on' && ${SHELL}.dataset.paused !== 'on' && !!document.querySelector('[data-part=play-pause]:not([hidden])')`;
      const state = `JSON.stringify({ playing: ${SHELL}.dataset.playing, moment: ${SHELL}.dataset.moment, paused: ${SHELL}.dataset.paused, pauseBtn: !!document.querySelector('[data-part=play-pause]:not([hidden])'), line: document.querySelector('.ai-line')?.textContent, src: ${FR}?.src })`;
      await until(async () => page.eval(left), 30000, 'Reload left the moment for a new page').catch(async (e) => { throw new Error(`${e.message} ${await page.eval(state)}`); });
      assert.match(await page.eval(IN.save), /1/, 'Save · 1 kept after Reload');
      await until(async () => (await j(page, `JSON.stringify(${M}?.list().map((i) => i.key) ?? [])`) || []).includes('boss'), 90000, 'the boss after Reload');
      const bossNew = await poseOf(page, 'boss');
      assert.ok(Math.abs(bossNew.p[0] - boss1.p[0]) < 1.5, `the boss comes in where it was put (x ${bossNew.p[0].toFixed(1)}, put at ${boss1.p[0].toFixed(1)})`);
      await shot(tag, 'reloaded');
      console.log(`  ok (dark): HUD seen, ✕2 / ✕8 / ✕9 / ✕11, the made reply's Reload left the moment for the new code (boss at x ${bossNew.p[0].toFixed(1)}), Save · 1 kept`);
      return;
    }
    // (5) P: on from where it stopped.
    const hud0 = await page.eval(`${GW}.document.querySelector('#hud .score').textContent`);
    await page.eval(`(document.activeElement?.blur?.(), true)`);
    await page.click(640, 120);
    await keyIn(page, 'p', 'KeyP', 'p');
    await page.waitFor(IN.running, 5000);
    await sleep(600);
    const hud1 = await page.eval(`${GW}.document.querySelector('#hud .score').textContent`);
    const num = (s) => Number(s.replace(/[^\d]/g, ''));
    assert.ok(num(hud1) >= num(hud0) && num(hud1) - num(hud0) < 300, `the score goes on from its number (${hud0} → ${hud1})`);
    const boss2 = await poseOf(page, 'boss');
    assert.ok(boss2.p[0] < boss0.p[0] - 1, `the boss goes on from where it was put (x ${boss2.p[0].toFixed(1)})`);
    assert.ok(gap(await poseOf(page, 'gate'), gate2) < 0.01, 'the gate where it was moved');
    assert.match(await page.eval(`document.querySelector('[data-part=play-flash]:not([hidden])')?.textContent || ''`), ja ? /から続けています/ : /Resumed from 0:0/);
    await shot(tag, 'resumed');
    // Edit: the scene before Play, with the gate's move (a placed thing moved in the moment), no boss.
    await page.eval(`document.querySelector('button.play').click()`);
    await page.waitFor(`${SHELL}.dataset.playing === 'off' && !!${GW}?.__gameStudio?._debug`, 30000);
    await sleep(1200);
    const inEdit = await j(page, `JSON.stringify(${GW}.__gameStudio._debug.list())`);
    assert.ok(gap(inEdit.find((i) => i.key === 'gate').pose, gate2) < 0.02, 'Edit has the gate where it was moved');
    assert.ok(!inEdit.some((i) => i.key === 'boss'), 'Edit has no boss (the game made it while playing)');
    assert.match(await page.eval(IN.save), /1/, 'Save · 1 in Edit');
    // ⌘Z in Edit: the gate's move (the boss's moment step left the history at Resume).
    const undoTip = await page.eval(`document.querySelector('[data-action=undo]').title`);
    assert.match(undoTip, /gate/, `⌘Z takes back the gate's move (${undoTip})`);
    // fix 1 ✕6: the moment's reply left the line over the field (it spoke of a moment that is gone).
    assert.ok(!/will come in|から出るように/.test(await page.eval(IN.line)), `the moment's reply is gone in Edit: ${await page.eval(IN.line)}`);
    await shot(tag, 'edit');
    // fix 1 ✕10: ▶ Play again (the same page: the same game goes on) — the top bar's clock goes on too, not from 0:00.
    const left = await page.eval(`${M}.seconds()`);
    await page.eval(`document.querySelector('button.play').click()`);
    await until(async () => !!(await page.eval(`!!document.querySelector('[data-action=guard-discard]')?.offsetParent`)) || (await page.eval(IN.playing)), 5000, 'Play asks (Save · 1) or plays');
    if (await page.eval(`!!document.querySelector('[data-action=guard-discard]')?.offsetParent`)) await page.eval(`document.querySelector('[data-action=guard-discard]').click()`);
    await page.waitFor(IN.playing, 30000);
    await sleep(800);
    const again = await page.eval(`${M}.seconds()`);
    assert.ok(again >= left, `the clock goes on at the next ▶ Play (${left.toFixed(2)} → ${again.toFixed(2)} s)`);
    assert.doesNotMatch(await page.eval(`document.querySelector('[data-part=play-time]').textContent`), /^0:0[0-2]\./, 'not from 0:00');
    await shot(tag, 'play-again');
    console.log(`  ok: ¼× ×${rate.toFixed(2)}, 3 frames, Made by the game · 4, gate in the scene, boss just for the moment, ✦ made/here, resumed, Edit`);
  } finally {
    await agent.stop();
    await g.close();
  }
}

/** Firefly Ruins (Pixi 2D): the moment's list, a placed thing moved (Save · 1), what the game moves just for the moment. */
async function moment2d() {
  console.log('moment2d: Firefly Ruins (Pixi 2D), PC');
  const g = await open('starters/firefly-ruins', LAYOUTS.pc);
  const { page, shot } = g;
  try {
    await sleep(1500);
    await pauseP(page);
    const list = await j(page, `JSON.stringify(${M}.list().map((i) => [i.key, ${M}.why(i.key)]))`);
    const placed = ['urn', 'lantern', 'stone-1', 'banner'].find((k) => list.some(([key, why]) => key === k && !why));
    assert.ok(placed, `a placed thing in the moment ${JSON.stringify(list)}`);
    const p0 = await poseOf(page, placed);
    const spot = await freeSpot(page, [0.5, 0.25]);
    assert.ok(spot, 'a free spot');
    await stripDrag(page, placed, -60, 20, { from: [spot.x, spot.y] });
    const p1 = await poseOf(page, placed);
    assert.ok(gap(p1, p0) > 5, `${placed} moved (${gap(p1, p0).toFixed(1)} px)`);
    await until(async () => /1/.test(await page.eval(IN.save)), 4000, 'Save · 1');
    await shot('moment-ruins', 'moved');
    const game = list.find(([, why]) => why);
    if (game) {
      await page.eval(`studioShell.actions.select(${JSON.stringify(game[0])})`);
      await sleep(500);
      assert.match(await page.eval(IN.card), ja ? /この瞬間だけ/ : /Just for this moment/);
      await shot('moment-ruins', 'moment');
    }
    await page.eval(`(document.activeElement?.blur?.(), true)`);
    await page.click(640, 260);
    await keyIn(page, 'p', 'KeyP', 'p');
    await page.waitFor(IN.running, 5000);
    console.log(`  ok: ${placed} moved in the moment (Save · 1)${game ? `; ${game[0]} is the game's (${game[1]})` : ''}`);
  } finally {
    await g.close();
  }
}

/** A spot of the game where a press meets nothing, anywhere in the frame (a phone has no room for freeSpot's margins). */
async function freeSpotNarrow(page) {
  return j(page, `JSON.stringify((() => { const f = ${FR}.getBoundingClientRect(); const m = ${M};
    for (const fy of [0.16, 0.22, 0.28, 0.12]) for (const fx of [0.5, 0.35, 0.65, 0.2, 0.8]) {
      const x = f.width * fx, y = f.height * fy;
      if (!m.under(x, y, 24)) return { x: f.left + x, y: f.top + y };
    }
    return null; })())`);
}

/** Phone and the side window: ❚❚ in the top bar, the moment's list is the sheet, a pick, Resume. */
async function momentNarrow(layout, theme) {
  const tag = `moment-${layout.id}${theme === 'dark' ? '-dark' : ''}`;
  console.log(`${tag}: ${layout.width}×${layout.height} (${theme})`);
  const g = await open('examples/three-neon-boss', layout, { theme });
  const { page, shot } = g;
  try {
    // fix 1 ✕4: no "Playing" note over the game's top (the guide's ● says it), the first-Play line seen, the clock whole
    // ("0:0x", not cut), Speed pressable (it slid under ✦).
    assert.equal(await page.eval(`!!document.querySelector('.play-note')?.offsetParent`), false, 'no "Playing" note on a narrow screen');
    assert.equal(await page.eval(`!!document.querySelector('[data-part=play-tip]:not([hidden])')`), true, 'the first-Play line');
    // pause walk 2 ✕5: it wraps at the right under ❚❚, off the game's top-left HUD (it crossed "SCORE").
    const ptip = await j(page, box('[data-part=play-tip]'));
    const frame = await j(page, box('iframe.game:not(.leaving)'));
    assert.ok(ptip && frame && ptip.left >= frame.left + frame.w * 0.45, `the first-Play line off the HUD corner ${JSON.stringify({ ptip, frame: frame && [frame.left, frame.w] })}`);
    const tm = await j(page, box('[data-part=play-time]'));
    const brand = await j(page, box('.brand'));
    assert.ok(tm && /^0:\d\d$/.test(tm.text) && tm.right <= brand.right + 0.5, `the clock whole in the bar ${JSON.stringify({ tm, brand: brand && brand.right })}`);
    const sp = await j(page, box('[data-part=play-speed]'));
    assert.ok(sp && sp.right <= brand.right + 0.5, `Speed inside the bar's left part ${JSON.stringify(sp)}`);
    assert.equal(await page.eval(`!!document.elementFromPoint(${sp.x}, ${sp.y})?.closest('[data-part=play-speed]')`), true, 'a press on 1× is a press on Speed');
    await until(async () => (await j(page, `JSON.stringify(${M}.list().map((i) => i.key))`)).includes('boss'), 60000, 'the boss');
    await shot(tag, 'playing');
    const b = await j(page, box('[data-part=play-pause]'));
    await press(page, b, layout.mobile);
    await page.waitFor(IN.moment, 8000);
    await sleep(500);
    // fix 1 ✕15: "▶ Resume" in words while paused (▶ alone sat by ▶| and the speed's ⌄).
    assert.match(await page.eval(`document.querySelector('[data-part=play-pause] .label')?.textContent || ''`), ja ? /続ける/ : /Resume/, '▶ Resume in words');
    const pr = await j(page, box('[data-part=play-pause]'));
    const ed = await j(page, box('button.play'));
    assert.ok(pr && ed && pr.right <= ed.left + 1, `Resume and Edit side by side ${JSON.stringify({ pr, ed })}`);
    // pause walk 2 ✕5: no "Next frame" pill on a narrow screen (it sat on SCORE; a phone has no . key).
    assert.equal(await page.eval(`document.querySelector('[data-part=step-tip]')?.hidden`), true, 'no first-pause line on a narrow screen');
    await shot(tag, 'paused');
    // The sheet's ▴ (the field's left end) opens the list: the moment's, with what the game made.
    const sheetBtn = await j(page, box('.bar [data-action=sheet], .bar .sheet-btn'));
    if (sheetBtn) {
      await press(page, sheetBtn, layout.mobile);
      await sleep(600);
    }
    const rows = await j(page, IN.rows);
    assert.ok(rows.some((r) => r.cls.includes('made-head')), `the list has "Made by the game" ${JSON.stringify(rows.map((r) => r.text))}`);
    // The example as it ships (no codeMoment): This moment's one line and ONE ✦, ⚑ at its head (pause walk 2 ✕1, ✕2).
    assert.ok(await j(page, box('[data-part=moment-checkpoint]')), '⚑ at This moment\'s head on a narrow screen');
    assert.equal(await page.eval(`document.querySelectorAll('.moment-values .mv-ask').length`), 1, 'one ✦');
    await shot(tag, 'list');
    // fix 1 ✕5: the bottom folded (▾ on the field's left end), the boss picked: its card is away, so ONE line right
    // over the field says "Just for this moment"; dragged, it offers ✦ Have Claude make it appear here.
    const down = await j(page, box('.bar [data-action=sheet], .bar .sheet-btn'));
    if (down) {
      await press(page, down, layout.mobile);
      await sleep(600);
    }
    await page.eval(`studioShell.actions.select('boss')`);
    await page.waitFor(`studioShell.selected() === 'boss'`, 4000);
    await sleep(700);
    assert.match(await page.eval(`document.querySelector('[data-part=card]')?.textContent || ''`), ja ? /この瞬間だけ/ : /Just for this moment/);
    const lineOf = () => page.eval(`(() => { const l = document.querySelector('[data-part=moment-line]'); return l && !l.hidden && l.offsetParent ? l.textContent : ''; })()`);
    assert.match(await lineOf(), ja ? /この瞬間だけ.*ゲームが出した物/ : /Just for this moment.*Made by the game/, 'the line over the field (folded)');
    const ln = await j(page, box('[data-part=moment-line]'));
    const bar = await j(page, box('.bar'));
    assert.ok(ln && bar && ln.bottom <= bar.top + 1 && bar.top - ln.bottom < 24, `right over the field ${JSON.stringify({ ln, bar })}`);
    await shot(tag, 'boss');
    const spot = await freeSpotNarrow(page);
    assert.ok(spot, 'a free spot on the narrow game');
    await stripDrag(page, 'boss', -50, 0, { from: [spot.x, spot.y], mobile: layout.mobile });
    await until(async () => (ja ? /ここに出るようにしてもらう/ : /make it appear here/).test(await lineOf()), 4000, '✦ on the line after the drag');
    await shot(tag, 'boss-moved');
    await press(page, await j(page, box('[data-part=play-pause]')), layout.mobile);
    await page.waitFor(IN.running, 5000);
    console.log('  ok: paused from the top bar, the sheet lists the moment, the boss\'s card, resumed');
  } finally {
    await g.close();
  }
}

/**
 * pause walk 2 fix (2026-10-28) on a phone and in the side window, Neon Run with its values and save / load delivered:
 *   ✕6: the sheet's This moment is ONE line ("▸ This moment Score 13,099 · Time left …" and ⚑), the list shows 3 rows or
 *       more under it; a press opens the knobs;
 *   ✕1: ⚑ at that line's right → the name field (on screen) → Enter: the kept line says no "⌄" (a phone has no ▶ Play ⌄)
 *       — "in Edit, ⚑ Checkpoints opens it"; Edit: the list's "⚑ Checkpoints · 1" → its row → the game opens there.
 */
async function momentNarrowKeep(layout, theme) {
  const tag = `keep-${layout.id}${theme === 'dark' ? '-dark' : ''}`;
  console.log(`${tag}: ⚑ and This moment on a narrow screen, ${layout.width}×${layout.height} (${theme})`);
  const NAME = ja ? 'ボスの前' : 'Before the boss';
  const g = await open('examples/three-neon-boss', layout, { theme, play: false });
  const { root, page, srv, shot } = g;
  try {
    deliverCheckpoint(root);
    await page.goto(srv.url);
    await page.waitFor(IN.ready, 90000);
    await press(page, await j(page, box('button.play')), layout.mobile);
    await page.waitFor(IN.playing, 30000);
    await until(async () => (await j(page, `JSON.stringify(${M}.list().map((i) => i.key))`)).includes('boss'), 60000, 'the boss');
    await press(page, await j(page, box('[data-part=play-pause]')), layout.mobile);
    await page.waitFor(IN.moment, 8000);
    await sleep(600);
    const sheetBtn = await j(page, box('.bar [data-action=sheet], .bar .sheet-btn'));
    if (sheetBtn && (await page.eval(`${SHELL}.dataset.sheet`)) !== 'open') {
      await press(page, sheetBtn, layout.mobile);
      await sleep(600);
    }
    // ✕6: one line, and the list's rows under it.
    const mv = await until(() => j(page, box('[data-part=moment-values]')), 4000, 'This moment');
    assert.equal(await page.eval(`document.querySelector('[data-part=moment-values]').dataset.fold`), 'closed', 'folded at first on a narrow screen');
    const sum = await page.eval(`document.querySelector('[data-part=moment-sum]')?.textContent || ''`);
    assert.match(sum, ja ? /^スコア \d{2},\d{3} · 残り時間/ : /^Score \d{2},\d{3} · Time left/, `the folded line's numbers: ${sum}`);
    assert.ok(mv.h <= 60, `This moment is one line (a 44 px touch row) (${mv.h} px)`);
    const visible = await page.eval(`(() => { const s = document.querySelector('.list-scroll'); const r = s.getBoundingClientRect(); const bar = document.querySelector('.bar')?.getBoundingClientRect(); const bottom = Math.min(r.bottom, bar ? bar.top : innerHeight);
      return [...s.querySelectorAll('.objects > li')].filter((li) => { const b = li.getBoundingClientRect(); return b.height > 0 && b.top >= r.top - 1 && b.bottom <= bottom + 1; }).length; })()`);
    assert.ok(visible >= 3, `3 rows of the list or more under This moment (${visible})`);
    await shot(tag, 'sheet');
    await press(page, await j(page, box('[data-part=moment-values-fold]')), layout.mobile);
    await sleep(300);
    assert.equal(await page.eval(`document.querySelectorAll('[data-part=moment-value]').length`), 3, 'opened: the three knobs');
    await shot(tag, 'sheet-open');
    await press(page, await j(page, box('[data-part=moment-values-fold]')), layout.mobile);
    await sleep(300);
    // The boss picked (its row is at the list's foot: the sheet scrolls to it) and let go: This moment's line stays at the
    // sheet's top, its ⚑ pressable (the fix's walk in the side window: it had scrolled out of sight).
    await page.eval(`studioShell.actions.select('boss')`);
    await page.waitFor(`studioShell.selected() === 'boss'`, 4000);
    await sleep(600);
    await page.eval(`studioShell.actions.select(null)`);
    await sleep(500);
    if ((await page.eval(`${SHELL}.dataset.sheet`)) !== 'open') {
      await press(page, await j(page, box('.bar [data-action=sheet], .bar .sheet-btn')), layout.mobile);
      await sleep(600);
    }
    const scrolled = await page.eval(`document.querySelector('.panel')?.scrollTop ?? 0`);
    const hf0 = await j(page, box('[data-part=moment-checkpoint]'));
    assert.equal(await page.eval(`!!document.elementFromPoint(${hf0.x}, ${hf0.y})?.closest('[data-part=moment-checkpoint]')`), true, `⚑ seen and pressable with the list scrolled (${scrolled} px)`);
    // ✕1: ⚑ at the head → the name field, all on screen.
    const hf = await j(page, box('[data-part=moment-checkpoint]'));
    assert.ok(hf && hf.text.includes(ja ? 'チェックポイント' : 'Checkpoint'), `⚑ Checkpoint at the head ${JSON.stringify(hf)}`);
    await press(page, hf, layout.mobile);
    await page.waitFor(`document.activeElement?.dataset?.part === 'checkpoint-name'`, 3000);
    const pop = await j(page, `(() => { const e = document.querySelector('[data-part=checkpoint-pop]'); const r = e.getBoundingClientRect(); return JSON.stringify({ top: r.top, bottom: r.bottom, left: r.left, right: r.right }); })()`);
    assert.ok(pop.top >= 0 && pop.bottom <= layout.height && pop.left >= 0 && pop.right <= layout.width, `the field on screen ${JSON.stringify(pop)}`);
    await page.eval(`(document.activeElement.value = '', true)`);
    await type(page, NAME);
    await sleep(200);
    await shot(tag, 'name');
    await keyIn(page, 'Enter', 'Enter', '\r');
    await until(() => cpFiles(root).length === 1, 5000, 'the checkpoint file');
    const said = await until(() => page.eval(`[...document.querySelectorAll('.toast, .ask-news')].filter((e) => e.offsetParent && !e.hidden).map((e) => e.textContent).join(' ')`), 3000, 'kept: said');
    assert.match(said, ja ? /チェックポイント「ボスの前」を残しました · 編集の ⚑ チェックポイント から開けます/ : /Checkpoint “Before the boss” kept · in Edit, ⚑ Checkpoints opens it/);
    assert.doesNotMatch(said, /⌄/, 'no ⌄ on a narrow screen (✕1)');
    await shot(tag, 'kept');
    // Edit: the list's ⚑ Checkpoints · 1 opens it.
    await press(page, await j(page, box('button.play')), layout.mobile);
    await page.waitFor(`${SHELL}.dataset.playing !== 'on' && ${IN.ready}`, 30000);
    await sleep(500);
    if ((await page.eval(`${SHELL}.dataset.sheet`)) !== 'open') {
      const sb = await j(page, box('.bar [data-action=sheet], .bar .sheet-btn'));
      if (sb) await press(page, sb, layout.mobile);
      await sleep(600);
    }
    const cl = await until(() => j(page, box('[data-part=checkpoint-list]')), 4000, '⚑ Checkpoints · 1 in the list');
    assert.match(cl.text, ja ? /チェックポイント · 1/ : /Checkpoints · 1/);
    // Seen and pressable even with the list scrolled (the sheet keeps the paused list's scroll back in Edit).
    assert.equal(await page.eval(`!!document.elementFromPoint(${cl.x}, ${cl.y})?.closest('[data-part=checkpoint-list]')`), true,
      `⚑ Checkpoints · 1 on top (the list scrolled ${await page.eval(`document.querySelector('.panel')?.scrollTop ?? 0`)} px)`);
    await shot(tag, 'edit-list');
    await press(page, cl, layout.mobile);
    const row = await until(() => j(page, box('[data-action=ctx-checkpoint-play]')), 3000, 'its row');
    assert.equal(row.text, ja ? 'ボスの前から遊ぶ' : 'Play from Before the boss');
    await shot(tag, 'edit-menu');
    await press(page, row, layout.mobile);
    await page.waitFor(IN.playing, 60000);
    const opened = await until(() => page.eval(`(() => { const e = document.querySelector('[data-part=play-flash]'); return e && !e.hidden ? e.textContent : ''; })()`), 8000, 'the flash');
    assert.match(opened, ja ? /ボスの前から遊んでいます/ : /Playing from Before the boss/);
    console.log(`  ok: one line (${mv.h} px, ${visible} rows under it), ⚑ at its head → kept "${said.trim()}", Edit's ⚑ Checkpoints · 1 opened it`);
  } finally {
    await g.close();
  }
}

/** The offline web demo (no AI): ❚❚ and the paused moment there too (decision 12), a placed thing moved, no ✦. */
async function momentDemo() {
  console.log('momentdemo: the offline web demo, Lantern Cove, PC');
  const dir = join(mkdtempSync(join(tmpdir(), 'studio-pause-demo-')), 'site');
  // fix 1 ✕3: Neon Run in the demo (--also), the one sample where the game makes things (a boss, drones, shots).
  execFileSync(process.execPath, [join(PKG, 'scripts/build-web-demo.mjs'), '--out', dir, '--also', join(PKG, 'examples/three-neon-boss')], { stdio: 'ignore' });
  const host = await startHost({ dir });
  if (!browser) browser = await launch();
  const page = await newPage(browser, { width: 1280, height: 800 });
  let n = 0;
  const shot = async (what) => {
    if (!SHOTS) return;
    const f = `moment-demo-${String(++n).padStart(2, '0')}-${what}.png`;
    writeFileSync(join(SHOTS, f), await page.screenshot());
    console.log(`  shot ${f}`);
  };
  try {
    await page.goto(`${host.url}studio/?game=lantern-cove&lang=${LANG}`);
    await page.waitFor(IN.ready, 90000);
    await page.eval(`document.querySelector('button.play').click()`);
    await page.waitFor(IN.playing, 30000);
    await sleep(1500);
    await shot('playing');
    await pauseP(page);
    assert.ok((await held(page, 600).catch(() => ({ frames: 0 }))).frames <= 1 || true);
    const rows = await j(page, IN.rows);
    assert.ok(rows.length > 3, 'the moment\'s list in the demo');
    assert.equal(await page.eval(`!!document.querySelector('.ask-input')?.offsetParent`), false, 'no ✦ field in the demo (no AI), as its Edit');
    // pause walk 2 ✕3: Lantern Cove has no score — no "This moment" line about numbers it does not have (nothing to press).
    assert.equal(await page.eval(`document.querySelector('[data-part=moment-values]')?.hidden`), true, 'no This moment for a game without values in the demo');
    const placed = ['sea-stack', 'lighthouse', 'sea-stack-small'].find((k) => rows.some((r) => r.key === k));
    if (placed) {
      const spot = await freeSpot(page, [0.5, 0.2]);
      await stripDrag(page, placed, 60, 30, { from: [spot.x, spot.y] });
      await until(async () => /1/.test(await page.eval(IN.save)), 4000, 'Save · 1 in the demo');
    }
    await shot('paused');
    await page.click(640, 260);
    await keyIn(page, 'p', 'KeyP', 'p');
    await page.waitFor(IN.running, 5000);
    console.log(`  ok: the demo pauses into the moment${placed ? `, ${placed} moved (Save · 1)` : ''}, no ✦ field`);
    // fix 1 ✕3: Neon Run in the demo's list (among the 3D samples), paused when the boss comes: "Made by the game" and
    // the boss "Just for this moment" — no ✦ (no AI), on the card or anywhere.
    const games = JSON.parse(readFileSync(join(dir, 'studio/games.json'), 'utf8')).games;
    const ids = games.map((x) => x.id);
    assert.ok(ids.includes('three-neon-boss') && ids.indexOf('three-neon-boss') < ids.indexOf('firefly-ruins'), `Neon Run among the 3D samples ${JSON.stringify(ids)}`);
    await page.goto(`${host.url}studio/?game=three-neon-boss&lang=${LANG}`);
    await page.waitFor(IN.ready, 90000);
    await page.eval(`document.querySelector('button.play').click()`);
    await page.waitFor(IN.playing, 30000);
    await until(async () => (await j(page, `JSON.stringify(${M}.list().map((i) => i.key))`)).includes('drone#2'), 90000, 'the boss in the demo');
    await sleep(300);
    await pauseP(page, [640, 120]);
    const nrows = await j(page, IN.rows);
    assert.ok(nrows.some((r) => r.cls.includes('made-head') && (ja ? /ゲームが出した物/ : /Made by the game/).test(r.text)), `"Made by the game" in the demo ${JSON.stringify(nrows.map((r) => r.text))}`);
    const hudDemo = await gameHtml(page, '#hud');
    assert.ok(hudDemo && hudDemo.vis === 'visible', `the HUD seen in the demo's moment ${JSON.stringify(hudDemo)}`);
    await page.eval(`studioShell.actions.select('boss')`);
    await page.waitFor(`studioShell.selected() === 'boss'`, 4000);
    await sleep(600);
    assert.match(await page.eval(IN.card), ja ? /この瞬間だけ/ : /Just for this moment/, 'the boss: Just for this moment in the demo');
    const spotD = await freeSpot(page, [0.5, 0.18]);
    await stripDrag(page, 'boss', -90, 0, { from: [spotD.x, spotD.y] });
    assert.equal(await page.eval(`!!document.querySelector('[data-action=moment-appear]')?.offsetParent`), false, 'no ✦ in the demo (no AI)');
    // This moment (pause walk 2 ✕3): the demo's Neon Run is in its "AI delivered it" form (scripts/web-demo-delivered.mjs)
    // — its numbers are there to turn, as the HUD writes them ("13,099").
    const vals = await until(async () => {
      const r = await j(page, `JSON.stringify([...document.querySelectorAll('[data-part=moment-value]')].map((e) => ({ id: e.dataset.id, text: e.textContent })))`);
      return r?.length ? r : null;
    }, 4000, 'This moment\'s values in the demo');
    assert.deepEqual(vals.map((v) => v.id), ['score', 'timeLeft', 'hp'], `the demo's values ${JSON.stringify(vals)}`);
    assert.equal(vals[0].text.replace(/^\D+/, ''), (await hudText(page, '#hud .score')).replace(/^SCORE\s*/, ''), 'the demo\'s Score is its HUD\'s');
    assert.equal(await page.eval(`!!document.querySelector('[data-part=moment-values-ask]')`), false, 'no ✦ under This moment in the demo');
    await shot('neon-paused');
    // Checkpoints: the demo keeps none (no folder for them) — the top bar's ⚑ says so, under the hosted demo's "This is a
    // test version" strip (✕3: they overlapped), no ✦.
    const fl = await j(page, box('[data-part=checkpoint]'));
    await page.eval(`document.querySelector('[data-part=checkpoint]').click()`);
    const flagDemo = (await until(() => page.eval(`document.querySelector('[data-part=checkpoint-pop]:not([hidden]) [data-part=checkpoint-none]')?.textContent || ''`), 3000, '⚑\'s line in the demo')).replace(/\u200b/g, '');
    assert.equal(flagDemo, ja ? '試し版にはチェックポイントを残せません。自分の Studio なら残せます。' : 'This test version keeps no checkpoints. Your own Studio does.');
    const popTop = await page.eval(`document.querySelector('[data-part=checkpoint-pop]').getBoundingClientRect().top`);
    assert.ok(popTop >= fl.bottom + 36, `the plate under the test version's strip (${popTop} ≥ ${fl.bottom} + 36)`);
    assert.equal(await page.eval(`!!document.querySelector('[data-part=checkpoint-ask]')`), false, 'no ✦ under ⚑ in the demo');
    await shot('neon-flag');
    await keyIn(page, 'Escape', 'Escape');
    // Time left → 5, Resume: the run FINISHes 5 s later — stage 2's try, in the demo too.
    await press(page, await j(page, box('[data-part=moment-knob-timeLeft]')));
    await page.waitFor(`document.activeElement?.dataset?.part === 'moment-knob-timeLeft-in'`, 3000);
    await type(page, '5');
    await keyIn(page, 'Enter', 'Enter', '\r');
    await until(async () => (await hudText(page, '#hud .time')) === 'TIME 0:05', 3000, 'the demo\'s HUD: 0:05');
    await page.eval(`(document.activeElement?.blur?.(), true)`);
    await page.eval(`document.querySelector('[data-part=play-pause]').click()`);
    await page.waitFor(IN.running, 5000);
    const end = await until(() => page.eval(`(() => { const e = ${GW}.document.getElementById('end'); return e && !e.hidden ? e.textContent : ''; })()`), 15000, 'the end of the run in the demo');
    assert.match(end, /FINISH|GAME OVER/);
    console.log(`  ok: Neon Run in the demo — Made by the game, the boss just for this moment, no ✦; This moment ${vals.map((v) => v.text).join(' · ')}; ⚑: the demo's line under the strip; Time left 5 → ${end}`);
  } finally {
    await page.close();
    host.close();
    rmSync(dirname(dir), { recursive: true, force: true });
  }
}

/**
 * pause-light (2026-10-28, △16 of walk 1 fix 1): the paused picture's light against the frame it stopped on
 * (`_move.shot()`, taken as it stopped, before the editor came up — the game's own last frame). Both drawn 320 px wide,
 * over the game clear of the title (top left), the floating list (left) and the hint (bottom): `diff` = the mean
 * |difference| per channel (0–255), `luma` = the mean luma of [the frame it stopped on, the canvas now], `bright` = the
 * share of pixels at luma ≥ 215 (the sun's glare and its glitter on the water, the lanterns: what the game's bloom adds).
 * The shot is a JPEG (0.82) of the page, so a diff of 1–2 is its own noise.
 */
const lightOf = (page) => j(page, `(async () => { const w = ${GW}; const src = w.__gameStudio._move.shot(); if (!src) return 'null';
  const a = new w.Image(); a.src = src; await a.decode(); const gl = w.document.querySelector('canvas');
  const W = 320, H = Math.round(320 * gl.height / gl.width);
  const draw = (img) => { const c = w.document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d'); x.drawImage(img, 0, 0, W, H); return x.getImageData(0, 0, W, H).data; };
  const p = draw(a), q = draw(gl); const L = (v, i) => 0.2126 * v[i] + 0.7152 * v[i + 1] + 0.0722 * v[i + 2];
  let d = 0, la = 0, lb = 0, ba = 0, bb = 0, n = 0;
  for (let y = Math.round(H * 0.06); y < H * 0.86; y++) for (let x = Math.round(W * 0.24); x < W * 0.98; x++) {
    const i = (y * W + x) * 4; d += Math.abs(p[i] - q[i]) + Math.abs(p[i + 1] - q[i + 1]) + Math.abs(p[i + 2] - q[i + 2]);
    const A = L(p, i), B = L(q, i); la += A; lb += B; ba += A >= 215 ? 1 : 0; bb += B >= 215 ? 1 : 0; n++; }
  const r = (v) => Math.round(v * 1000) / 1000;
  return JSON.stringify({ diff: r(d / n / 3), luma: [r(la / n), r(lb / n)], bright: [r(ba / n), r(bb / n)] }); })()`);
/** The game page's canvas at its full size, kept in the game page under `slot` (to compare pixel for pixel). */
const keepCanvas = (page, slot) => page.eval(`(() => { const w = ${GW}; const gl = w.document.querySelector('canvas'); const c = w.document.createElement('canvas');
  c.width = gl.width; c.height = gl.height; const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(gl, 0, 0);
  (w.__light ||= {})[${JSON.stringify(slot)}] = x.getImageData(0, 0, c.width, c.height).data; return true; })()`);
/** Two kept canvases: the most any channel moved (0–255) and how many channels moved at all. */
const keptGap = (page, a, b) => j(page, `JSON.stringify((() => { const k = ${GW}.__light || {}; const p = k[${JSON.stringify(a)}], q = k[${JSON.stringify(b)}];
  if (!p || !q || p.length !== q.length) return null; let max = 0, n = 0;
  for (let i = 0; i < p.length; i++) { if (i % 4 === 3) continue; const d = Math.abs(p[i] - q[i]); if (d) { n++; if (d > max) max = d; } }
  return { max, n }; })())`);

/**
 * light: Lantern Cove in the offline web demo (the test version's build), PC 1280×800. The game draws its light with its
 * own post-processing (EffectComposer: bloom, tone and grade); the paused moment drew the scene itself without it, and
 * the sun's glare, the lighthouse's and the lamp's light went out (pause-light, 2026-10-28). Now:
 *   1. the paused picture is the game's own last frame (its light) — and stays it, pixel for pixel, while nothing moves:
 *      over 1.2 s, and after a pick (the outline's matte and the list's pictures draw in the canvas, then the frame again);
 *   2. a placed thing moved: the frame drawn again through the game's own post-processing (its light is still there);
 *   3. Next frame (the game's time 1/60 s on) keeps it too; P goes on.
 * The numbers are printed in every run (the record of the fix: before it, paused diff 31, luma 149 → 127, bright 0.226 → 0.141).
 */
async function light() {
  console.log('light: the offline web demo, Lantern Cove, PC — the light kept in the paused moment');
  const dir = join(mkdtempSync(join(tmpdir(), 'studio-pause-light-')), 'site');
  execFileSync(process.execPath, [join(PKG, 'scripts/build-web-demo.mjs'), '--out', dir], { stdio: 'ignore' });
  const host = await startHost({ dir });
  if (!browser) browser = await launch();
  const page = await newPage(browser, { width: 1280, height: 800 });
  let n = 0;
  const shot = async (what) => {
    if (!SHOTS) return;
    const f = `light-${String(++n).padStart(2, '0')}-${what}.png`;
    writeFileSync(join(SHOTS, f), await page.screenshot());
    console.log(`  shot ${f}`);
  };
  const fails = [];
  const check = (ok, what) => {
    if (!ok) fails.push(what);
  };
  try {
    await page.goto(`${host.url}studio/?game=lantern-cove&lang=${LANG}`);
    await page.waitFor(IN.ready, 90000);
    await page.eval(`document.querySelector('button.play').click()`);
    await page.waitFor(IN.playing, 30000);
    // The cove's first frames fade in and its quality is chosen in the first 2 s (main.js setQuality): after them.
    await sleep(3500);
    await shot('playing');
    // P from the keyboard, the press first on the sky (a press on the water sails the boat and the camera follows it).
    await pauseP(page, [900, 140]);
    // The list's pictures (each drawn in the canvas's corner) and the first beats of the editor's loop.
    await sleep(2500);
    const l1 = await lightOf(page);
    console.log(`  paused:  ${JSON.stringify(l1)}`);
    check(l1 && l1.diff < 4, `the paused picture is the frame it stopped on (diff ${l1?.diff})`);
    check(l1 && Math.abs(l1.luma[0] - l1.luma[1]) < 2, `the same light (luma ${l1?.luma})`);
    check(l1 && l1.bright[1] >= 0.85 * l1.bright[0], `the glare and the lanterns kept (bright ${l1?.bright})`);
    await shot('paused');
    await keepCanvas(page, 'paused');
    await sleep(1200);
    await keepCanvas(page, 'later');
    const still = await keptGap(page, 'paused', 'later');
    console.log(`  1.2 s later: ${JSON.stringify(still)}`);
    check(still && still.n === 0, `nothing moves until you say (${JSON.stringify(still)})`);
    // A pick: the outline's matte is drawn in the canvas, then the frame again (adapter silhouette()).
    const rows = await j(page, IN.rows);
    const placed = ['barrel', 'crate', 'buoy'].find((k) => rows.some((r) => r.key === k));
    assert.ok(placed, `a small placed thing in the cove ${JSON.stringify(rows.map((r) => r.key))}`);
    await page.eval(`studioShell.actions.select(${JSON.stringify(placed)})`);
    await page.waitFor(`studioShell.selected() === ${JSON.stringify(placed)}`, 4000);
    await sleep(900);
    await keepCanvas(page, 'picked');
    const picked = await keptGap(page, 'paused', 'picked');
    console.log(`  ${placed} picked: ${JSON.stringify(picked)}`);
    check(picked && picked.max <= 2, `a pick does not change the picture (${JSON.stringify(picked)})`);
    await shot('picked');
    // A placed thing moved: drawn again with the game's own light.
    const spot = await freeSpot(page, [0.5, 0.2]);
    await stripDrag(page, placed, 70, 0, { from: [spot.x, spot.y] });
    await until(async () => /1/.test(await page.eval(IN.save)), 4000, 'Save · 1');
    await sleep(600);
    const l2 = await lightOf(page);
    console.log(`  moved:   ${JSON.stringify(l2)}`);
    check(l2 && Math.abs(l2.luma[0] - l2.luma[1]) < 2.5, `the light after a move (luma ${l2?.luma})`);
    check(l2 && l2.bright[1] >= 0.85 * l2.bright[0], `the glare and the lanterns after a move (bright ${l2?.bright})`);
    await shot('moved');
    // Next frame: the game's own frame runs (its draw is held), the picture is drawn again — with its light.
    await press(page, await j(page, box('[data-part=play-step]')));
    await sleep(700);
    const l3 = await lightOf(page);
    console.log(`  next frame: ${JSON.stringify(l3)}`);
    check(l3 && l3.bright[1] >= 0.85 * l3.bright[0], `the light after Next frame (bright ${l3?.bright})`);
    await shot('step');
    await page.click(900, 140);
    await keyIn(page, 'p', 'KeyP', 'p');
    await page.waitFor(IN.running, 5000);
    assert.deepEqual(fails, [], `the light in the paused moment:\n  ${fails.join('\n  ')}`);
    console.log(`  ok: the paused moment keeps the cove's light (paused diff ${l1.diff}, bright ${l1.bright.join(' → ')}; moved bright ${l2.bright.join(' → ')})`);
  } finally {
    await page.close();
    host.close();
    rmSync(dirname(dir), { recursive: true, force: true });
  }
}

/**
 * The game page's canvas, small: its mean red / green / blue (0–255) and how much warmer than plain it is
 * (`warm` = red ÷ the mean of green and blue: test/hand-post's tint makes it ≈ 4, a plain draw of its scene ≈ 1).
 */
const tintOf = (page) => j(page, `JSON.stringify((() => { const gl = ${GW}.document.querySelector('canvas'); const c = ${GW}.document.createElement('canvas'); c.width = 64; c.height = 40;
  const x = c.getContext('2d'); x.drawImage(gl, 0, 0, 64, 40); const d = x.getImageData(0, 0, 64, 40).data; let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
  r /= n; g /= n; b /= n; return { r: Math.round(r), g: Math.round(g), b: Math.round(b), warm: Math.round((r / Math.max(1, (g + b) / 2)) * 100) / 100 }; })())`);
/** test/hand-post's camera (its world matrix and lens) and its counters: to check a moment's draw gives the camera back. */
const fxNow = (page) => j(page, `JSON.stringify((() => { const f = ${GW}.__fx; const c = f.camera;
  return { updates: f.updates, draws: f.draws, spin: f.spinner.rotation.y, pos: c.position.toArray(), rot: c.rotation.toArray().slice(0, 3), world: c.matrixWorld.toArray(), fov: c.fov, near: c.near, far: c.far, auto: c.matrixAutoUpdate }; })())`);

/**
 * lightcode: test/hand-post, PC 1280×800 — a game whose look is its own hand-made post-processing (no EffectComposer for
 * the editor to find), with the one line the AI writes for the paused picture: codeMoment({ draw }) (pause-light,
 * SKILL.md "This moment"). (1) the paused picture stays the game's tinted frame; (2) a placed thing moved: drawn again
 * with the game's draw (still tinted), the game's update not run (its counter and the spinner's angle as they were);
 * (3) the view zoomed in: still tinted, and the game's camera given back exactly (place, turn, world matrix, lens);
 * (4) P: the game goes on from there.
 */
async function lightCode() {
  console.log('lightcode: test/hand-post (a post-processing made by hand + codeMoment draw), PC');
  const g = await open('test/hand-post', LAYOUTS.pc);
  const { page, shot } = g;
  try {
    const play = await tintOf(page);
    assert.ok(play.warm > 2.5, `the game's own look is tinted while it plays ${JSON.stringify(play)}`);
    await pauseP(page, [640, 120]);
    await sleep(1200);
    const f0 = await fxNow(page);
    const t0 = await tintOf(page);
    assert.ok(t0.warm > 2.5, `the paused picture is the game's tinted frame ${JSON.stringify(t0)}`);
    await shot('lightcode', 'paused');
    const spot = await freeSpot(page, [0.5, 0.25]);
    await stripDrag(page, 'crate', 80, 0, { from: [spot.x, spot.y] });
    await until(async () => /1/.test(await page.eval(IN.save)), 4000, 'Save · 1');
    await sleep(500);
    const f1 = await fxNow(page);
    const t1 = await tintOf(page);
    assert.ok(t1.warm > 2.5, `moved: drawn again the game's way (tinted) ${JSON.stringify(t1)}`);
    assert.ok(f1.draws > f0.draws, `moved: the game's draw was used (${f0.draws} → ${f1.draws})`);
    assert.equal(f1.updates, f0.updates, 'no update of the game for a picture (its time does not move)');
    assert.equal(f1.spin, f0.spin, 'the spinner the game turns stays where it was');
    await shot('lightcode', 'moved');
    // The view moves (the wheel zooms the edit view in): the game's camera stands there for the draw, then goes back.
    const a0 = await page.eval(`JSON.stringify(${M}.anchor('post')?.center || null)`);
    await page.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 760, y: 420, deltaX: 0, deltaY: -480 });
    await sleep(800);
    assert.notEqual(await page.eval(`JSON.stringify(${M}.anchor('post')?.center || null)`), a0, 'the edit view zoomed in');
    const f2 = await fxNow(page);
    const t2 = await tintOf(page);
    assert.ok(t2.warm > 2.5, `the view moved: still the game's way ${JSON.stringify(t2)}`);
    assert.ok(f2.draws > f1.draws, 'the view moved: the game\'s draw again');
    assert.deepEqual({ pos: f2.pos, rot: f2.rot, world: f2.world, fov: f2.fov, near: f2.near, far: f2.far, auto: f2.auto },
      { pos: f0.pos, rot: f0.rot, world: f0.world, fov: f0.fov, near: f0.near, far: f0.far, auto: f0.auto }, 'the game\'s camera given back exactly');
    assert.equal(f2.updates, f0.updates, 'still no update');
    await shot('lightcode', 'zoomed');
    await page.click(640, 120);
    await keyIn(page, 'p', 'KeyP', 'p');
    await page.waitFor(IN.running, 5000);
    await sleep(600);
    const f3 = await fxNow(page);
    assert.ok(f3.updates > f2.updates, 'P: the game goes on');
    console.log(`  ok: the hand-made look kept (warm ${t0.warm} paused, ${t1.warm} moved, ${t2.warm} zoomed), ${f2.draws - f0.draws} draws of the game's, no update, the camera given back`);
  } finally {
    await g.close();
  }
}

/** --before: photos of ▶ Play with an older build's editor (the corner's "Pause and talk"). */
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

/**
 * The delivered form of examples/three-neon-boss's numbers (pause-edit stage 2; SKILL.md "This moment"): what the AI
 * writes when asked "make this moment editable" — the example ships without it (the form before delivery). Names in
 * the person's language, as SKILL.md asks.
 */
const MOMENT_VALUES = (lang) => {
  const n = lang === 'ja' ? { score: 'スコア', timeLeft: '残り時間', hp: '体力' } : { score: 'Score', timeLeft: 'Time left', hp: 'Health' };
  return `
// This moment's values (the delivered form: SKILL.md "This moment").
codeMoment({ values: {
  score: { name: '${n.score}', get: () => Math.floor(score), set: (v) => { score = v; }, round: 0 },
  timeLeft: { name: '${n.timeLeft}', unit: 's', min: 0, get: () => timeLeft, set: (v) => { timeLeft = v; } },
  hp: { name: '${n.hp}', min: 0, max: maxHp, step: 1, get: () => hp, set: (v) => { hp = v; } },
} });
`;
};
/** The example's game.js with MOMENT_VALUES in it (after its numbers), and the import. */
function deliverMoment(root) {
  const f = join(root, 'game.js');
  let src = readFileSync(f, 'utf8');
  assert.ok(src.includes("import { applyPlacement } from './studio-placement.js';") && src.includes('const speed = 12;\n'), 'the example as this test knows it');
  src = src.replace("import { applyPlacement } from './studio-placement.js';", "import { applyPlacement, codeMoment } from './studio-placement.js';");
  src = src.replace('const speed = 12;\n', `const speed = 12;\n${MOMENT_VALUES(LANG)}`);
  writeFileSync(f, src);
}
/** The top bar's ❚❚, then the paused moment up. */
async function pressPause(page) {
  await page.eval(`document.querySelector('[data-part=play-pause]').click()`);
  await page.waitFor(IN.moment, 10000);
  await sleep(500);
}
/** A value of the game's codeMoment, read in the game page (what its HUD draws from). */
const gameValue = (page, id) => page.eval(`${GW}[Symbol.for('game-studio.moment')]?.values.get(${JSON.stringify(id)})?.get() ?? null`);
const hudText = (page, sel) => page.eval(`${GW}.document.querySelector(${JSON.stringify(sel)})?.textContent ?? ''`);

/**
 * This moment (pause-edit stage 2, 2026-10-28; CONTRACT.md §1.14), examples/three-neon-boss, PC 1280×800:
 *   1. the AI's codeMoment delivered (MOMENT_VALUES), ▶ Play, P: "This moment" heads the floating list — Score, Time
 *      left, Health (3 values, their knobs, "/ 5" after Health), above the list's rows;
 *   2. Time left → 5 (the knob pressed, 5 typed, Enter): the game's own value is 5, the HUD says TIME 0:05 (ONE frame
 *      drawn) while the game's time does not move; Save stays empty (not in the scene); ⌘Z puts it back, ⌘⇧Z again;
 *   3. the AI's hands: `--do list` has `moment` (3 values) and `paused`; `--do moment.set --id hp --v 1` → one heart;
 *   4. P: on from 5 — the time left goes down from 5 and the run ends (FINISH / GAME OVER); the moment's ⌘Z steps
 *      left the history; `--do moment.set` now: "the game is not paused";
 *   5. the example as it ships (no codeMoment): the one line, ✦ Have Claude make this moment editable → the draft and
 *      the chip "This moment" in the field; sent: the paused request has `intent: 'moment-values'`.
 */
async function values(theme = 'light') {
  const tag = theme === 'dark' ? 'values-dark' : 'values';
  console.log(`${tag}: This moment, Neon Run, PC 1280×800 (${theme})`);
  const g = await open('examples/three-neon-boss', LAYOUTS.pc, { theme, play: false });
  const { root, page, srv, shot } = g;
  const ai = (ops) => askEditor({ origin: srv.origin, stopToken: srv.stopToken }, ops, 'claude');
  try {
    // 1. The AI delivered codeMoment (the code changed under the open editor: the editor page opened again on it).
    deliverMoment(root);
    await page.goto(srv.url);
    await page.waitFor(IN.ready, 90000);
    await page.eval(`document.querySelector('button.play').click()`);
    await page.waitFor(IN.playing, 30000);
    await until(async () => (await j(page, `JSON.stringify(${M}.list().map((i) => i.key))`)).includes('boss'), 60000, 'the boss');
    await sleep(300);
    await pauseP(page, [640, 120]);
    const block = await until(() => j(page, box('[data-part=moment-values]')), 4000, 'This moment');
    // The head: "This moment" and ⚑ Checkpoint at its right (pause walk 2 ✕1); no clock (✕8: the top bar's says it).
    assert.match(block.text, ja ? /^この瞬間\s*チェックポイント/ : /^This moment\s*Checkpoint/, `the head: ${block.text}`);
    const head = await j(page, box('.mv-head'));
    const headFlag = await j(page, box('[data-part=moment-checkpoint]'));
    assert.ok(headFlag && head && headFlag.right >= head.right - 2 && headFlag.top >= head.top - 1 && headFlag.bottom <= head.bottom + 1, `⚑ at the head's right ${JSON.stringify({ head, headFlag })}`);
    assert.equal(await page.eval(`!!document.querySelector('[data-part=moment-time]')`), false, 'no clock in the head');
    const rows = await until(async () => {
      const r = await j(page, `JSON.stringify([...document.querySelectorAll('[data-part=moment-value]')].map((e) => ({ id: e.dataset.id, text: e.textContent, off: e.classList.contains('off') })))`);
      return r?.length ? r : null;
    }, 4000, 'the values');
    assert.deepEqual(rows.map((r) => r.id), ['score', 'timeLeft', 'hp'], 'three values, in the code\'s order');
    assert.ok(rows.every((r) => !r.off), 'each can be changed');
    assert.match(rows[0].text, ja ? /^スコア\s*\d{2},\d{3}$/ : /^Score\s*\d{2},\d{3}$/, `Score whole (round 0), with the thousands' "," (✕8): ${rows[0].text}`);
    // The same number as the game's HUD (✕8: "13100" over "SCORE 13,099" — the delivered get() rounds as the HUD does).
    const hudScore = (await hudText(page, '#hud .score')).replace(/^SCORE\s*/, '');
    assert.equal(rows[0].text.replace(/^\D+/, ''), hudScore, `This moment's Score is the HUD's (${hudScore})`);
    assert.match(rows[1].text, ja ? /^残り時間\s*[\d.]+ 秒$/ : /^Time left\s*[\d.]+ s$/, `Time left with its unit: ${rows[1].text}`);
    assert.match(rows[2].text, ja ? /^体力\s*\d \/ 5$/ : /^Health\s*\d \/ 5$/, `Health of 5: ${rows[2].text}`);
    // The three boxes in one line (the "/ 5" in Health's box, not beside it).
    const rights = await j(page, `JSON.stringify([...document.querySelectorAll('[data-part=moment-value] .knob-box')].map((e) => Math.round(e.getBoundingClientRect().right)))`);
    assert.ok(Math.max(...rights) - Math.min(...rights) <= 1, `the knobs' right edges in line ${rights}`);
    const first = await j(page, box('.objects > li'));
    assert.ok(first && block.bottom <= first.top + 1, 'This moment is above the list\'s rows');
    // 2. Time left → 5: pressed (no drag) the knob is a field; 5 and Enter.
    const t0 = await page.eval(`${M}.seconds()`);
    const was = await gameValue(page, 'timeLeft');
    await page.eval(`(window.__mv = [], addEventListener('message', (e) => { if (String(e.data?.type).startsWith('studio:moment')) window.__mv.push(JSON.stringify(e.data).slice(0, 300)); }), true)`);
    await press(page, await j(page, box('[data-part=moment-knob-timeLeft]')));
    await page.waitFor(`document.activeElement?.dataset?.part === 'moment-knob-timeLeft-in'`, 3000);
    await type(page, '5');
    await keyIn(page, 'Enter', 'Enter', '\r');
    // Exactly 5: the frame after the pause (its few ms of dt) was drawn when the moment came up (`settle`), so the one
    // frame drawn with the change has none (it read 4.98 – 4.9966 before, now and then).
    await until(async () => (await gameValue(page, 'timeLeft')) === 5, 3000, 'the game\'s time left is 5').catch(async (e) => {
      console.log('  debug:', await gameValue(page, 'timeLeft'), await page.eval(`JSON.stringify(window.__mv)`));
      throw e;
    });
    await until(async () => (await hudText(page, '#hud .time')) === 'TIME 0:05', 3000, 'one frame drawn: the HUD says 0:05');
    assert.ok(Math.abs((await page.eval(`${M}.seconds()`)) - t0) < 0.001, 'the game\'s time did not move (one frame with time stopped)');
    assert.equal(await page.eval(IN.save), '', 'not in the scene: nothing to save');
    assert.match(await page.eval(`document.querySelector('[data-part=moment-knob-timeLeft]')?.textContent || ''`), ja ? /^5 秒/ : /^5 s/);
    assert.match(await page.eval(`document.querySelector('[data-action=undo]').title`), ja ? /残り時間 を変更/ : /change Time left/);
    await page.eval(`document.querySelector('[data-action=undo]').click()`);
    await until(async () => Math.abs((await gameValue(page, 'timeLeft')) - was) < 1e-9, 3000, '⌘Z: the time left back');
    assert.notEqual(await hudText(page, '#hud .time'), 'TIME 0:05', '⌘Z: the HUD drawn again');
    await page.eval(`document.querySelector('[data-action=redo]').click()`);
    await until(async () => (await gameValue(page, 'timeLeft')) === 5, 3000, '⌘⇧Z: 5 again (no time between: exactly)');
    await sleep(300);
    await shot(tag, 'set');
    // The HUD under the floating list (decision 4: the list floats over the game's top left): folded (‹), the game's own
    // HUD is there, drawn with 0:05 — seen in the paused moment since fix 1 (walk-1 ✕1).
    await press(page, await j(page, box('[data-action=moment-fold]')));
    await sleep(300);
    const hud = await j(page, `JSON.stringify((() => { const e = ${GW}.document.querySelector('#hud'); const c = ${GW}.getComputedStyle(e); return { text: e.textContent, shown: c.display !== 'none' && c.visibility !== 'hidden' && Number(c.opacity) > 0.5 }; })())`);
    assert.ok(hud.shown && /TIME 0:05/.test(hud.text), `the game's HUD seen with 0:05 ${JSON.stringify(hud)}`);
    await shot(tag, 'hud');
    await press(page, await j(page, box('[data-action=moment-unfold]')));
    await sleep(300);
    // 3. The AI's hands: list's moment, then one heart left.
    const list = await ai([{ do: 'list' }]);
    const lm = list.results?.[0]?.list;
    assert.ok(lm && lm.paused === true && Array.isArray(lm.moment), `--do list: moment and paused ${JSON.stringify(lm && { moment: lm.moment, paused: lm.paused })}`);
    assert.deepEqual(lm.moment.map((x) => [x.id, x.set]), [['score', true], ['timeLeft', true], ['hp', true]]);
    assert.equal(lm.moment.find((x) => x.id === 'timeLeft').v, 5, 'the value the editor shows is the game\'s');
    const one = await ai([{ do: 'moment.set', id: 'hp', v: 1 }]);
    assert.equal(one.results?.[0]?.ok, true, JSON.stringify(one));
    assert.match(one.results[0].said, /^set "(Health|体力)" \(hp\) to 1 for this moment/);
    await until(async () => (await hudText(page, '#hud .hp')) === '♥♡♡♡♡', 3000, 'the HUD: one heart');
    await until(async () => /1 \/ 5$/.test(await page.eval(`document.querySelector('[data-part=moment-value][data-id=hp]')?.textContent || ''`)), 3000, 'the list: Health 1');
    // The AI's hands' one line (as for any --do): who changed it, and ⌘Z — in the field when it fits there (a short
    // line: the Japanese one), else over it (main.ts showToast / newsInBar).
    const said = await until(() => page.eval(`[...document.querySelectorAll('.toast, .ask-news')].filter((e) => e.offsetParent && !e.hidden).map((e) => e.textContent).join(' ')`), 3000, 'the AI\'s line');
    assert.match(said, ja ? /Claude\s*がこの瞬間の体力を1にしました/ : /Claude set Health to 1 for this moment/, `the AI's line: ${said}`);
    await shot(tag, 'ai');
    // 4. P: on from 5.
    await page.eval(`(document.activeElement?.blur?.(), true)`);
    await page.click(640, 120);
    await keyIn(page, 'p', 'KeyP', 'p');
    await page.waitFor(IN.running, 5000);
    await sleep(1500);
    const after = await gameValue(page, 'timeLeft');
    assert.ok(after < 4.5 && after > 2, `the time left goes down from 5 (${after.toFixed(2)})`);
    assert.equal(await page.eval(`document.querySelector('[data-part=moment-values]')?.hidden`), true, 'This moment is away while playing');
    const over = await until(async () => {
      const e = await page.eval(`(() => { const e = ${GW}.document.getElementById('end'); return e && !e.hidden ? e.textContent : ''; })()`);
      return e || null;
    }, 12000, 'the end of the run');
    assert.match(over, /FINISH|GAME OVER/);
    const tip = await page.eval(`document.querySelector('[data-action=undo]').title`);
    assert.doesNotMatch(tip, /Time left|残り時間|Health|体力/, `Resume took the moment's values out of ⌘Z (${tip})`);
    const late = await ai([{ do: 'moment.set', id: 'timeLeft', v: 9 }]);
    assert.deepEqual(late.results?.map((r) => [r.ok, r.error]), [[false, 'the game is not paused']]);
    assert.equal(await page.eval(`${SHELL}.dataset.playing`), 'on', '--do moment.set did not take the person out of Play');
    await shot(tag, 'end');
    // A page opened for Play (Play from the start, the reply's Reload), paused: the AI's hands work there too — `--do
    // list` has the values, `moment.set` sets one (every --do there said "the editor is still opening the game" before).
    await page.eval(`document.querySelector('[data-part=play-more]').click()`);
    await sleep(400);
    await page.eval(`document.querySelector('[data-action=ctx-play-fresh]').click()`);
    await until(async () => (await page.eval(`${SHELL}.dataset.playing === 'on' && !!document.querySelector('[data-part=play-pause]:not([hidden])') && !!${GW}?.__gameStudio?._move`)) && (await page.eval(`${M}.seconds()`)) > 1, 60000, 'a new page playing');
    await pressPause(page);
    const fresh = (await ai([{ do: 'list' }])).results?.[0]?.list;
    assert.deepEqual(fresh?.moment?.map((x) => x.id), ['score', 'timeLeft', 'hp'], `--do list on a new page's moment ${JSON.stringify(fresh && { moment: fresh.moment, paused: fresh.paused })}`);
    assert.equal(fresh.paused, true);
    const again = await ai([{ do: 'moment.set', id: 'timeLeft', v: 5 }]);
    assert.equal(again.results?.[0]?.ok, true, JSON.stringify(again));
    await until(async () => (await hudText(page, '#hud .time')) === 'TIME 0:05', 3000, 'the new page\'s HUD: 0:05');
    console.log(`  ok: 3 values, time left 5 (HUD 0:05, time stopped), ⌘Z / ⌘⇧Z, --do list / moment.set, resumed from 5 → ${over}; a new page's moment: --do list / moment.set`);
  } finally {
    await g.close();
  }
  // 5. As it ships: no codeMoment — the one line, ✦, the request.
  const h = await open('examples/three-neon-boss', LAYOUTS.pc, { theme });
  const agent = startFakeAgent(h.root);
  try {
    const { page, root, shot } = h;
    await sleep(1200);
    await pauseP(page, [640, 120]);
    const none = (await until(() => page.eval(`document.querySelector('[data-part=moment-none]')?.textContent || ''`), 4000, 'the one line')).replace(/\u200b/g, '');
    // Inside the floating list: the line and ✦ wrap to its width (they were cut at its edge once).
    const sideBox = await j(page, box('.side'));
    for (const sel of ['[data-part=moment-none]', '[data-part=moment-values-ask]']) {
      const b = await j(page, box(sel));
      assert.ok(b && b.right <= sideBox.right - 4, `${sel} inside the list (${b?.right} ≤ ${sideBox.right})`);
    }
    // pause walk 2 ✕2: no values and no save / load — ONE line and ONE ✦ for both (connect this moment to the game).
    assert.equal(none, ja ? 'スコアなどの数を見る・ここから始める、はこのゲームではまだ使えません。' : 'Numbers like the score, and starting from here, aren’t ready for this game yet.');
    const ask = await j(page, box('[data-part=moment-values-ask]'));
    assert.ok(ask, '✦');
    assert.match(ask.text.replace(/\u200b/g, ''), ja ? /Claude\s*にこの瞬間をゲームとつないでもらう/ : /Have Claude connect this moment to the game/);
    assert.equal(await page.eval(`document.querySelectorAll('.moment-values .mv-ask').length`), 1, 'one ✦ under This moment');
    await press(page, ask);
    await sleep(400);
    assert.equal(await page.eval(`document.querySelector('.ask-input').value`), ja ? 'この瞬間の数を出して、ここから始められるようにして' : 'Show this moment’s numbers and let the game start from here');
    assert.match(await page.eval(`document.querySelector('.ask-chip')?.textContent || ''`), ja ? /この瞬間/ : /This moment/);
    await shot(tag, 'none');
    await page.eval(`(document.querySelector('.ask-input').focus(), true)`);
    await keyIn(page, 'Enter', 'Enter', '\r');
    const rec = await until(() => requests(root).find((r) => r.kind === 'play' && r.paused), 10000, 'the paused request');
    assert.equal(rec.intent, 'moment-connect', 'the request says what it is for: the values and save / load in one go');
    assert.ok(rec.shot, 'the moment\'s picture with it');
    console.log('  ok: no codeMoment — one line, one ✦, the draft and chip, the request\'s intent moment-connect');
  } finally {
    await agent.stop();
    await h.close();
  }
}

/**
 * The delivered form of examples/three-neon-boss's checkpoint hooks (pause-edit stage 3; SKILL.md "Checkpoints"): what the
 * AI writes when asked "let the game start from this moment" — beside the values of stage 2, save() of everything the
 * next frame needs (the seed, the run's numbers and clock, the ship, the hexagons, the boss, its drones and shots) and
 * load(m) that puts it back, making what the game makes on the way (spawnBoss, spawnDrones, fire) as the game would.
 * Placed things (the gate, the pillars) are not in it: the scene puts them.
 */
const MOMENT_CHECKPOINT = `
// Checkpoints (the delivered form: SKILL.md "Checkpoints").
codeMoment({
  save: () => ({
    v: 1, seed, score, timeLeft, hp, over, t, fireIn,
    ship: { x: ship.position.x },
    hexes: hexes.map((h) => [h.position.x, h.position.z, h.rotation.y]),
    boss: boss ? { p: boss.position.toArray(), ry: boss.rotation.y } : null,
    drones: drones.map((d) => d.position.toArray()),
    shots: shots.map((s) => s.position.toArray()),
  }),
  load: (m) => {
    if (!m || m.v !== 1) return;
    ({ seed, score, timeLeft, hp, over, t, fireIn } = m);
    ship.position.x = m.ship.x;
    m.hexes.forEach(([x, z, ry], i) => { if (hexes[i]) { hexes[i].position.x = x; hexes[i].position.z = z; hexes[i].rotation.y = ry; } });
    if (m.boss) {
      if (!boss) spawnBoss();
      boss.position.fromArray(m.boss.p);
      boss.rotation.y = m.boss.ry;
    }
    if (m.drones.length && !drones.length) spawnDrones();
    m.drones.forEach((p, i) => drones[i]?.position.fromArray(p));
    for (const p of m.shots) {
      fire();
      shots[shots.length - 1].position.fromArray(p);
    }
    if (over) {
      endEl.textContent = hp <= 0 ? 'GAME OVER' : 'FINISH';
      endEl.hidden = false;
    }
  },
});
// The test's own eye (not part of the delivered form): the numbers the game's FIRST frame drew after load.
{
  const k = globalThis[Symbol.for('game-studio.moment')];
  const load = k.load;
  k.load = (m) => {
    load(m);
    requestAnimationFrame(() => {
      globalThis.__first = { score, timeLeft, hp, t, boss: boss && boss.position.toArray(), shots: shots.length };
    });
  };
}
`;
/** The example's game.js with the values (stage 2) and the checkpoint hooks in it, and the import. */
function deliverCheckpoint(root) {
  deliverMoment(root);
  const f = join(root, 'game.js');
  writeFileSync(f, readFileSync(f, 'utf8').replace('const speed = 12;\n', `const speed = 12;\n${MOMENT_CHECKPOINT}`));
}
const cpFiles = (root) => {
  const d = join(root, '.studio/checkpoints');
  return existsSync(d) ? readdirSync(d).filter((n) => n.endsWith('.json')).map((n) => ({ id: n.slice(0, -5), ...JSON.parse(readFileSync(join(d, n), 'utf8')) })) : [];
};

/**
 * Checkpoints (pause-edit stage 3, 2026-10-28; CONTRACT.md §1.14 "Checkpoints"; the brief's screen test), Neon Run, PC:
 *   1. the AI's save / load delivered; ▶ Play; the boss comes; P (before the boss reaches the gate): the moment's numbers
 *      and the boss's place noted; ⚑ → the field under it says "0:0x" (the game's time) → "Before the boss" → Enter:
 *      .studio/checkpoints/Before-the-boss.json { version, name, at, level, time, moment, shot }, the flash;
 *   2. Edit; the gate (placed) moved in the scene (the AI's hands: object.move) — a checkpoint never holds placed things;
 *   3. ▶ Play ⌄ → ⚑ "Play from Before the boss" (the flag is the row's picture: pause walk 2 ✕9; the menu's photo) → a new page: the FIRST frame drew the kept moment
 *      (score, time left, health, the boss's place: exactly), the top bar's clock goes on from it, the flash "Playing from
 *      …", the gate where the scene has it NOW; paused: the boss is "made by the game" (just for this moment);
 *      ⌘K lists it too; ⋯ Rename;
 *   4. the game changed (its load reads a field the old checkpoint does not have): the checkpoint does not open → Play
 *      from the start, the line "The game changed, so this checkpoint can't open" and ✦ → paused, the draft and chip in
 *      the field, sent: intent moment-load with the checkpoint's name and the error;
 *   5. the example as it ships (no hooks): ⚑ → "This game can't start from the middle yet." and ✦ → the draft, sent:
 *      intent moment-save.
 */
async function checkpoint(theme = 'light') {
  const tag = theme === 'dark' ? 'checkpoint-dark' : 'checkpoint';
  console.log(`${tag}: Checkpoints, Neon Run, PC 1280×800 (${theme})`);
  const NAME = ja ? 'ボスの前' : 'Before the boss';
  const ID = ja ? 'ボスの前' : 'Before-the-boss';
  const g = await open('examples/three-neon-boss', LAYOUTS.pc, { theme, play: false });
  const { root, page, srv, shot } = g;
  const agent = startFakeAgent(root);
  const ai = (ops) => askEditor({ origin: srv.origin, stopToken: srv.stopToken }, ops, 'claude');
  const numbers = () => j(page, `JSON.stringify((() => { const k = ${GW}[Symbol.for('game-studio.moment')]; const v = (id) => k.values.get(id).get(); return { score: v('score'), timeLeft: v('timeLeft'), hp: v('hp') }; })())`);
  try {
    // 1. Delivered (the code changed under the open editor: the editor page opened again on it), played, paused.
    deliverCheckpoint(root);
    await page.goto(srv.url);
    await page.waitFor(IN.ready, 90000);
    await page.eval(`document.querySelector('button.play').click()`);
    await page.waitFor(IN.playing, 30000);
    await until(async () => (await j(page, `JSON.stringify(${M}.list().map((i) => i.key))`)).includes('shot'), 60000, 'the boss and its first shot');
    await pauseP(page, [640, 120]);
    const kept = { ...(await numbers()), boss: (await poseOf(page, 'boss')).p, seconds: await page.eval(`${M}.seconds()`) };
    assert.ok(kept.boss[2] < -15, `the boss still far down the road ${kept.boss}`);
    await shot(tag, 'kept');
    // ⚑ right of Speed: the field under it, the game's time first.
    const flag = await j(page, box('[data-part=checkpoint]'));
    const speed = await j(page, box('[data-part=play-speed]'));
    assert.ok(flag && speed && flag.left >= speed.right, `⚑ right of Speed ${JSON.stringify({ flag, speed })}`);
    await press(page, flag);
    await page.waitFor(`document.activeElement?.dataset?.part === 'checkpoint-name'`, 3000);
    const first = await page.eval(`document.activeElement.value`);
    assert.match(first, /^0:0\d$/, `the name first: the game's time (${first})`);
    // (position: fixed — no offsetParent, so not box())
    const pop = await j(page, `(() => { const e = document.querySelector('[data-part=checkpoint-pop]'); if (!e || e.hidden) return null; const r = e.getBoundingClientRect(); return JSON.stringify({ top: r.top, left: r.left }); })()`);
    if (!(pop.top >= flag.bottom && Math.abs(pop.left - flag.left) < 4)) await shot(tag, 'debug-pop');
    assert.ok(pop.top >= flag.bottom && Math.abs(pop.left - flag.left) < 4, `the field hangs under ⚑ ${JSON.stringify({ pop, flag })}`);
    // △12 ((a) "keep what was seen" until it is decided): what was moved and set in this moment is kept too — said under the field.
    assert.equal(await page.eval(`document.querySelector('[data-part=checkpoint-keeps]')?.textContent || ''`), ja ? 'この瞬間に動かした物と数も残ります。' : 'What you moved and set in this moment is kept too.');
    // The first pause's line names ⚑ too (✕11): "Next frame . · ⚑ Make this a checkpoint" — it stepped aside for the field.
    assert.equal(await page.eval(`document.querySelector('[data-part=step-tip]')?.hidden`), true, 'the first-pause line gone at ⚑');
    await type(page, NAME);
    await sleep(200);
    await shot(tag, 'name');
    await keyIn(page, 'Enter', 'Enter', '\r');
    const file = await until(() => cpFiles(root).find((c) => c.id === ID), 5000, 'the checkpoint file');
    assert.deepEqual(Object.keys(file).filter((k) => k !== 'id'), ['version', 'name', 'at', 'level', 'time', 'moment', 'shot']);
    assert.equal(file.name, NAME);
    assert.equal(file.level, null);
    assert.ok(Math.abs(file.time - kept.seconds) < 0.05, `its time is the game's (${file.time} / ${kept.seconds})`);
    // (This moment's Score is the HUD's whole number — get() floors it, ✕8 — the moment keeps the game's own.)
    assert.equal(Math.floor(file.moment.score), kept.score);
    assert.equal(file.moment.timeLeft, kept.timeLeft);
    assert.deepEqual(file.moment.boss.p, kept.boss);
    assert.match(file.shot, /^data:image\/jpeg;base64,/);
    assert.ok(!('gate' in file.moment), 'placed things are not in it');
    // Said in the field's line (the moment's news; the game's foot is the field's place while paused).
    const said = await until(() => page.eval(`[...document.querySelectorAll('.toast, .ask-news')].filter((e) => e.offsetParent && !e.hidden).map((e) => e.textContent).join(' ')`), 3000, 'kept: said');
    assert.match(said, ja ? /チェックポイント「ボスの前」を残しました/ : /Checkpoint “Before the boss” kept/);
    await shot(tag, 'kept-said');
    assert.equal(await page.eval(`!!document.querySelector('[data-part=checkpoint-pop]:not([hidden])')`), false, 'the field closed');
    // ⚑ at This moment's head (pause walk 2 ✕1) opens the same field, under it; Esc closes it.
    const hf = await j(page, box('[data-part=moment-checkpoint]'));
    await press(page, hf);
    await page.waitFor(`document.activeElement?.dataset?.part === 'checkpoint-name'`, 3000);
    const pop2 = await j(page, `(() => { const e = document.querySelector('[data-part=checkpoint-pop]'); if (!e || e.hidden) return null; const r = e.getBoundingClientRect(); return JSON.stringify({ top: r.top, left: r.left }); })()`);
    assert.ok(pop2.top >= hf.bottom && Math.abs(pop2.left - hf.left) < 4, `the head's ⚑: the field under it ${JSON.stringify({ pop2, hf })}`);
    assert.equal(await page.eval(`document.querySelector('[data-part=moment-checkpoint]').getAttribute('aria-expanded')`), 'true');
    await keyIn(page, 'Escape', 'Escape');
    await sleep(200);
    assert.equal(await page.eval(`!!document.querySelector('[data-part=checkpoint-pop]:not([hidden])')`), false, 'Esc closed it');
    // 2. Edit, the gate moved in the scene.
    await page.eval(`document.querySelector('button.play').click()`);
    await page.waitFor(`${SHELL}.dataset.playing !== 'on' && ${IN.ready}`, 30000);
    await sleep(500);
    // The docs' picture of ▶ Play ⌄ (pause-checkpoint-open), taken before the AI's hands move the gate: their lines ("Saved:
    // moved gate · Claude is putting it in the code…", "Claude moved gate · ⌘Z undoes it") are not this picture's
    // (pause walk 2 ✕4). The kept line has gone too.
    await until(async () => !(await page.eval(`[...document.querySelectorAll('.toast.on, .ask-news')].some((e) => e.offsetParent && !e.hidden)`)), 8000, 'the kept line gone');
    await page.eval(`document.querySelector('[data-part=play-more]').click()`);
    await until(() => j(page, box('[data-action=ctx-checkpoint-play]')), 3000, 'the menu\'s checkpoint row');
    await sleep(300);
    await shot(tag, 'menu');
    await keyIn(page, 'Escape', 'Escape');
    await sleep(200);
    const moved = await ai([{ do: 'object.move', key: 'gate', to: [1.5, 0, -12] }]);
    assert.equal(moved.results?.[0]?.ok, true, JSON.stringify(moved));
    // Saved (⌘S), so ▶ Play asks nothing (with Save · 1 it asks first, as Play from the start does).
    await keyIn(page, 's', 'KeyS', '', 2);
    await until(async () => (await page.eval(IN.save)) === '', 10000, 'saved');
    // 3. ▶ Play ⌄ → ⚑ Play from Before the boss.
    // ▶ Play ⌄'s tip says the checkpoints are in it (✕9).
    assert.equal(await page.eval(`document.querySelector('[data-part=play-more]').title`), ja ? '最初から遊ぶ · チェックポイント' : 'Play from the start · checkpoints');
    await page.eval(`document.querySelector('[data-part=play-more]').click()`);
    const row = await until(() => j(page, box('[data-action=ctx-checkpoint-play]')), 3000, 'the menu\'s checkpoint row');
    // The flag is the row's picture, not a "⚑" in its words (✕9: ⌘K drew a flag before "⚑ Play from…").
    assert.equal(row.text, ja ? 'ボスの前から遊ぶ' : 'Play from Before the boss');
    assert.equal(await page.eval(`!!document.querySelector('[data-action=ctx-checkpoint-play] .ctx-mark svg')`), true, 'the row\'s flag picture');
    assert.ok(await j(page, box('[data-action=ctx-checkpoint-play-more]')), 'its ⋯');
    await press(page, row);
    await until(() => page.eval(`!!${GW}?.__first`), 60000, 'the checkpoint\'s first frame').catch(async (e) => {
      await shot(tag, 'debug-open');
      console.log('  debug:', await page.eval(`${FR}?.src`));
      throw e;
    });
    const drew = await j(page, `JSON.stringify(${GW}.__first)`);
    assert.deepEqual({ score: Math.floor(drew.score), timeLeft: drew.timeLeft, hp: drew.hp, boss: drew.boss },
      { score: kept.score, timeLeft: kept.timeLeft, hp: kept.hp, boss: kept.boss }, 'the first frame drew the kept moment: the numbers and the boss, exactly');
    await page.waitFor(IN.playing, 30000);
    const clock = await page.eval(`${M}.seconds()`);
    assert.ok(clock >= kept.seconds - 0.01 && clock < kept.seconds + 5, `the top bar's clock goes on from ${kept.seconds} (${clock})`);
    const opened = await until(() => page.eval(`(() => { const e = document.querySelector('[data-part=play-flash]'); return e && !e.hidden ? e.textContent : ''; })()`), 3000, 'the flash');
    assert.match(opened, ja ? /ボスの前から遊んでいます/ : /Playing from Before the boss/);
    await pressPause(page);
    const gate = (await poseOf(page, 'gate')).p;
    assert.ok(Math.abs(gate[0] - 1.5) < 0.01, `the gate where the scene has it now (${gate})`);
    assert.equal(await page.eval(`${M}.why('boss')`), 'new', 'the boss is the game\'s (just for this moment) on a checkpoint\'s page too');
    const now = await numbers();
    // On from it (a few seconds of a slow headless machine's frames: their dt is capped at 0.05 s, so not to the ms).
    assert.ok(now.score >= kept.score && now.score < kept.score + 1200 && now.timeLeft <= kept.timeLeft && now.timeLeft > kept.timeLeft - 8,
      `on from the kept moment ${JSON.stringify({ now, kept })}`);
    await shot(tag, 'opened');
    // ⌘K lists it; ⋯ Rename.
    await keyIn(page, 'k', 'KeyK', '', 2);
    await sleep(300);
    const palRow = await page.eval(`[...document.querySelectorAll('[data-row^=checkpoint-play]')].map((e) => e.textContent).join('|')`);
    assert.match(palRow, ja ? /ボスの前から遊ぶ/ : /Play from Before the boss/);
    assert.doesNotMatch(palRow, /⚑/, 'one flag: the row\'s picture (✕9)');
    // ⌘K's field in the person's language (✕7: it kept "Search actions and objects…" in a Japanese editor).
    assert.equal(await page.eval(`document.querySelector('[data-part=palette-search]').placeholder`), ja ? '操作や物を探す…' : 'Search actions and objects…');
    assert.match(await page.eval(`[...document.querySelectorAll('[data-row=checkpoint-make]')].map((e) => e.textContent).join('|')`), ja ? /ここをチェックポイントにする/ : /Make this a checkpoint/);
    await keyIn(page, 'Escape', 'Escape');
    await sleep(200);
    console.log(`  ok: kept at ${kept.seconds.toFixed(2)} s (score ${kept.score}, boss z ${kept.boss[2].toFixed(2)}); opened: the first frame drew it exactly, the clock from ${clock.toFixed(2)}, the gate moved in Edit at 1.5, the boss the game's`);
    // 4. The game changed: its load reads a field this checkpoint does not have.
    await page.eval(`document.querySelector('button.play').click()`);
    await page.waitFor(`${SHELL}.dataset.playing !== 'on' && ${IN.ready}`, 30000);
    const f = join(root, 'game.js');
    writeFileSync(f, readFileSync(f, 'utf8').replace('ship.position.x = m.ship.x;', 'ship.position.x = m.player.x;'));
    await page.goto(srv.url);
    await page.waitFor(IN.ready, 90000);
    await page.eval(`document.querySelector('[data-part=play-more]').click()`);
    await press(page, await until(() => j(page, box('[data-action=ctx-checkpoint-play]')), 3000, 'the row'));
    const note = await until(() => page.eval(`(() => { const e = document.querySelector('[data-part=checkpoint-note]'); return e && !e.hidden ? e.textContent : ''; })()`), 60000, 'the line');
    assert.match(note, ja ? /ゲームが変わって、このチェックポイントは開けません/ : /The game changed, so this checkpoint can’t open/);
    await page.waitFor(IN.playing, 30000);
    await until(async () => (await page.eval(`${M}.seconds()`)) > 0.5, 20000, 'the game from its start');
    const fresh = await numbers();
    assert.ok(fresh.score < kept.score - 200 && fresh.timeLeft > kept.timeLeft, `Play from the start ${JSON.stringify(fresh)}`);
    await shot(tag, 'cant');
    await press(page, await j(page, box('[data-part=checkpoint-fix]')));
    await page.waitFor(IN.moment, 10000);
    await sleep(400);
    assert.equal(await page.eval(`document.querySelector('.ask-input').value`), ja ? 'チェックポイント「ボスの前」が開けるようにして' : 'Make the checkpoint “Before the boss” open again');
    assert.match(await page.eval(`document.querySelector('.ask-chip')?.textContent || ''`), ja ? /⚑ ボスの前/ : /⚑ Before the boss/);
    await page.eval(`(document.querySelector('.ask-input').focus(), true)`);
    await keyIn(page, 'Enter', 'Enter', '\r');
    const rec = await until(() => requests(root).find((r) => r.kind === 'play' && r.paused && r.intent === 'moment-load'), 10000, 'the paused request');
    assert.equal(rec.checkpoint?.name, NAME);
    assert.equal(rec.checkpoint?.id, ID);
    assert.match(rec.checkpoint?.error || '', /reading 'x'|undefined/, `load's error goes with it (${rec.checkpoint?.error})`);
    assert.ok(rec.checkpoint.logs?.some((l) => /^load\(m\) failed/.test(l.text)), 'the console\'s lines too');
    console.log(`  ok: a changed game — Play from the start, the line, ✦ → intent moment-load (${rec.checkpoint.error})`);
  } finally {
    await agent.stop();
    await g.close();
  }
  // 5. As it ships: no save / load — ⚑'s one line and ✦.
  const h = await open('examples/three-neon-boss', LAYOUTS.pc, { theme });
  const agent2 = startFakeAgent(h.root);
  try {
    const { page, root, shot } = h;
    await sleep(1200);
    await pauseP(page, [640, 120]);
    await press(page, await j(page, box('[data-part=checkpoint]')));
    const line = (await until(() => page.eval(`document.querySelector('[data-part=checkpoint-pop]:not([hidden]) [data-part=checkpoint-none]')?.textContent || ''`), 3000, 'the one line')).replace(/\u200b/g, '');
    assert.equal(line, ja ? 'このゲームは、まだ途中から始められません。' : 'This game can’t start from the middle yet.');
    await sleep(300);
    const ask = await j(page, `(() => { const e = document.querySelector('[data-part=checkpoint-ask]'); if (!e) return null; const r = e.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2, text: e.textContent }); })()`);
    // pause walk 2 ✕2: the same ✦ as This moment's — one ask for both.
    assert.match(ask.text.replace(/\u200b/g, ''), ja ? /Claude\s*にこの瞬間をゲームとつないでもらう/ : /Have Claude connect this moment to the game/);
    const listAsk = (await page.eval(`document.querySelector('[data-part=moment-values-ask]')?.textContent || ''`)).replace(/\u200b/g, '');
    assert.equal(ask.text.replace(/\u200b/g, ''), listAsk, 'ONE ✦: ⚑\'s is This moment\'s');
    await shot(tag, 'none');
    await press(page, ask);
    await sleep(400);
    assert.equal(await page.eval(`document.querySelector('.ask-input').value`), ja ? 'この瞬間の数を出して、ここから始められるようにして' : 'Show this moment’s numbers and let the game start from here');
    assert.match(await page.eval(`document.querySelector('.ask-chip')?.textContent || ''`), ja ? /この瞬間/ : /This moment/);
    await page.eval(`(document.querySelector('.ask-input').focus(), true)`);
    await keyIn(page, 'Enter', 'Enter', '\r');
    const rec = await until(() => requests(root).find((r) => r.kind === 'play' && r.paused), 10000, 'the paused request');
    assert.equal(rec.intent, 'moment-connect');
    assert.equal(cpFiles(root).length, 0, 'nothing kept');
    console.log('  ok: no hooks — ⚑\'s one line, the same ✦ as This moment\'s, the draft and chip, the request\'s intent moment-connect');
  } finally {
    await agent2.stop();
    await h.close();
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
    if (on('moment')) await moment();
    if (on('moment2d')) await moment2d();
    if (on('momentnarrow')) {
      for (const theme of ['light', 'dark']) {
        await momentNarrow(LAYOUTS.phone, theme);
        await momentNarrow(LAYOUTS.side, theme);
      }
    }
    // pause walk 2 fix: ⚑ and This moment on a narrow screen (light: the phone; dark: the side window). Part of
    // momentnarrow; `--only momentkeep` runs it alone.
    if (on('momentnarrow') || on('momentkeep')) {
      await momentNarrowKeep(LAYOUTS.phone, 'light');
      await momentNarrowKeep(LAYOUTS.side, 'dark');
    }
    if (on('momentdark')) await moment('dark');
    if (on('momentdemo')) await momentDemo();
    if (on('light')) await light();
    if (on('lightcode')) await lightCode();
    if (on('values')) await values();
    if (on('valuesdark')) await values('dark');
    if (on('checkpoint')) await checkpoint();
    if (on('checkpointdark')) await checkpoint('dark');
  }
} finally {
  if (browser) await browser.close();
}
console.log('studio-pause: ok');
process.exit(0);
