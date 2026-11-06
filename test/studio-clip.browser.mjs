// ● Clip, stage 1 (decided 2026-11-05; src/shell/clip.ts, src/bridge/play-clip.ts, src/shell/mp4.ts, src/server/clips.mjs) in
// a headless browser: the real local server, the built editor, examples/three-neon-boss (three.js + an HTML HUD).
//
//   node test/studio-clip.browser.mjs [--only local,demo,tall,phone,refuse] [--shots <dir>] [--lang en|ja] [--keep <dir>]
//
// local  PC 1280×800, the local editor:
//   1. In Edit, "● Clip ⌄" in the top bar right of Undo / Redo; ⌄ lists 6 / 8 / 12 s (8 checked), the mark (checked),
//      where clips go and "Nothing leaves this computer.".
//   2. ● Clip in Edit → ▶ Play, recording: the button red "0:0N · Stop", the red frame on the game (data-clip=rec), the
//      bar of the time left. Pressed again ~1 s in: the clip ends one second later (~2 s).
//   3. The line: "Saved to Movies › KUMODeck" (the name in its tooltip; walk 2 △9), "… s · Wide 1280×720 ⌄", Show in
//      Finder (the server's command, no window), Remove “Made with”, ✕; the post with the address and "N / 280", Copy post.
//   4. The file in the clips folder (not the game folder): an MP4 (ftyp isom, moov before mdat, avc1, 1280×720) about
//      2 s long (stopped ~1 s in, plus the mark's second), at most 30 frames a second (real time: a slow machine gives
//      fewer frames, never a faster clip), the length the line says, key frames at the start and at the mark; it plays
//      in the page's <video> when this browser can play H.264 (its length and size read back).
//   5. Remove mark: the same file written again with the other end, the post without the address, the choice kept in
//      .studio/ui/prefs.json (clip.mark false).
//   6. (stage 2) The length is cut at the PRESS: the clip ends one second after the moment ● Clip was pressed again
//      (the game page's own count of it, __studioClipStats, against this test's clock), however late the busy game page
//      read the message — on a loaded machine it was 4–6 s for a 2 s press.
//   7. (stage 2) ✦ Rewrite (a stand-in AI is watching): the post replaced by the AI's, its count, the address kept;
//      the AI line over the field does not show that reply.
// demo   the offline web demo (no server folder): ● Clip downloads the MP4 (the browser's download, checked on disk), the
//        line says "Clip downloaded", no Show in Finder, no ✦ Rewrite (no AI there).
// tall   (stage 2) Clip ⌄ → Tall 720×1280: while recording the game's window is 9:16 in the middle of the stage, the
//        line says "Tall 720×1280", the MP4 is 720×1280; ⌄ remembers it (prefs.json clip.shape).
// phone  (stage 2) a phone 390×844: ● Clip in the bar while playing, Tall by default, the line has Share… (or "Save to
//        this phone" where the browser cannot share files) and no Show in Finder.
// studio-clip-3 (decided 2026-11-06):
//   local  the button says the time LEFT ("0:0N left · Stop"), "Ending…" after Stop; the line's "N s · Wide …" opens
//          Clip options; Post on X… opens X's compose page with the post (window.open, caught here) and shows the clip
//          in its folder.
//   phone  holding ● opens Clip options (no recording); recording, the round ● says the seconds left; the line's
//          shape opens Clip options too.
//   refuse a game that draws an image from another site (another port here): the line says so and what to do, with
//          ✦ Ask …; pressed, the game pauses and the request is in the field (not sent).
// --shots: clip-*.png (the docs' clip / clip-saved pictures). --keep: copies the saved MP4 there (a sample to look at).
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
import { translate } from '../src/shell/i18n.ts';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const UI = join(PKG, 'skills/arrange/bin/studio-ui');
const args = process.argv.slice(2);
const take = (flag, d = null) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : d;
};
const ONLY = (take('--only') || 'local,demo,tall,phone,refuse').split(',');
const SHOTS = take('--shots') ? resolve(take('--shots')) : null;
const KEEP = take('--keep') ? resolve(take('--keep')) : null;
const LANG = take('--lang', 'en');
const ja = LANG === 'ja';
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
if (KEEP) mkdirSync(KEEP, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The boxes of an MP4 as shell/mp4.ts writes them (a copy of mp4Info: this file runs on plain Node, without types).
function mp4Info(b) {
  const type = (at) => b.toString('latin1', at, at + 4);
  const info = { order: [] };
  const walk = (from, to, depth) => {
    let at = from;
    while (at + 8 <= to) {
      const size = b.readUInt32BE(at);
      const ty = type(at + 4);
      if (size < 8 || at + size > to) return;
      if (depth === 0) info.order.push(ty);
      const body = at + 8;
      if (ty === 'ftyp') info.brand = type(body);
      else if (ty === 'tkhd') (info.width = b.readUInt32BE(at + size - 8) / 65536, info.height = b.readUInt32BE(at + size - 4) / 65536);
      else if (ty === 'mdhd') info.seconds = b.readUInt32BE(body + 16) / b.readUInt32BE(body + 12);
      else if (ty === 'stsz') info.samples = b.readUInt32BE(body + 8);
      else if (ty === 'stss') info.keys = b.readUInt32BE(body + 4);
      else if (ty === 'stsd') info.codec = type(body + 12);
      if (['moov', 'trak', 'mdia', 'minf', 'stbl'].includes(ty)) walk(body, at + size, depth + 1);
      at += size;
    }
  };
  walk(0, b.length, 0);
  info.fastStart = info.order.indexOf('moov') >= 0 && info.order.indexOf('moov') < info.order.indexOf('mdat');
  return info;
}

const STATE = `(() => {
  const box = (e) => { if (!e || e.hidden || !e.offsetParent) return null; const r = e.getBoundingClientRect(); if (!r.width) return null;
    const cs = getComputedStyle(e); return { l: r.left, t: r.top, r: r.right, b: r.bottom, x: r.left + r.width / 2, y: r.top + r.height / 2,
      text: e.innerText.replace(/\\s+/g, ' ').trim(), bg: cs.backgroundColor }; };
  const line = document.querySelector('[data-part=clip-line]');
  return JSON.stringify({
    clip: box(document.querySelector('[data-part=clip]')), clipOn: !!document.querySelector('[data-part=clip].on'), more: box(document.querySelector('[data-part=clip-more]')),
    redo: box(document.querySelector('.top [data-action=redo]')), play: box([...document.querySelectorAll('[data-action=play]')].find((x) => x.offsetParent)),
    state: document.querySelector('.shell').dataset.clip || 'idle', playing: document.querySelector('.shell').dataset.playing === 'on',
    frame: (() => { const s = document.querySelector('.stage'); return s ? getComputedStyle(s, '::after').boxShadow : ''; })(),
    time: box(document.querySelector('[data-part=clip-time]')),
    line: line && !line.hidden ? { text: line.innerText.replace(/\\s+/g, ' ').trim(), post: line.querySelector('[data-part=clip-post]')?.textContent || '',
      count: line.querySelector('[data-part=clip-count]')?.textContent || '', head: line.querySelector('.clip-head')?.title || '',
      headCut: (() => { const e = line.querySelector('[data-part=clip-saved]'); return !!e && e.scrollWidth > e.clientWidth + 1; })(), where: line.querySelector('.clip-where')?.textContent || '',
      reveal: box(line.querySelector('[data-action=clip-reveal]')), mark: box(line.querySelector('[data-action=clip-mark]')),
      rewrite: box(line.querySelector('[data-action=clip-rewrite]')), share: box(line.querySelector('[data-action=clip-share]')), save: box(line.querySelector('[data-action=clip-save]')),
      copy: box(line.querySelector('[data-action=clip-copy]')), close: box(line.querySelector('[data-action=clip-close]')),
      options: box(line.querySelector('[data-action=clip-options]')), postX: box(line.querySelector('[data-action=clip-post-x]')) } : null,
    left: document.querySelector('[data-part=clip-left]')?.textContent || '',
    note: (() => { const n = document.querySelector('[data-part=clip-note]'); return n && !n.hidden && n.offsetParent ? n.innerText.replace(/\\s+/g, ' ').trim() : ''; })(),
    acts: [...document.querySelectorAll('[data-part=clip-note]:not([hidden]) [data-action=clip-note-act]')].map((b) => { const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, text: b.textContent }; }),
    toast: [...document.querySelectorAll('.toast.on')].map((e) => e.textContent).join(' '),
    aiLine: (() => { const l = document.querySelector('.ai-line'); return l && !l.hidden && l.offsetParent ? l.textContent : ''; })(),
    game: (() => { const f = document.querySelector('iframe.game:not(.leaving)'); if (!f) return null; const r = f.getBoundingClientRect(); return { w: r.width, h: r.height, l: r.left }; })(),
    shape: document.querySelector('.shell').dataset.clipShape || '',
    menu: (() => { const m = document.querySelector('[data-part=context-menu]:not([hidden])'); return m && m.getBoundingClientRect().width ? m.innerText.replace(/\\s+/g, ' ').trim() : ''; })(),
  });
})()`;

// The game page's own count of the clip (bridge/play-clip.ts, not enumerable): the press in the clip's time, how late
// the message came, how many frames that dropped, and the clip's 0:00 on the shared clock (timeOrigin + now).
const STATS = `JSON.stringify((() => { const f = document.querySelector('iframe.game:not(.leaving)'); const s = f && f.contentWindow.__studioClipStats; return s ? { ...s } : null; })())`;
/** clip-model.ts endAfterStop (this file runs on plain Node, without types): one second after the press, on the 1/30 s grid. */
const endAfterStop = (ms, endMs = 8000) => Math.min(endMs, (Math.ceil((Math.max(ms, 1000 / 30) + 1000) / (1000 / 30)) * 1000) / 30);
const j = async (page, expr) => JSON.parse((await page.eval(expr)) || 'null');
/** Wait until `fn(state)` holds (null after `ms`). */
async function untilOn(state, fn, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const s = await state();
    if (fn(s)) return s;
    await sleep(150);
  }
  return null;
}
let browser = null;
let failed = 0;
const check = (ok, what) => {
  console.log(`  ${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failed++;
};

async function local() {
  console.log('local: examples/three-neon-boss, PC 1280×800');
  const root = mkdtempSync(join(tmpdir(), 'studio-clip-'));
  const clips = mkdtempSync(join(tmpdir(), 'studio-clip-movies-'));
  cpSync(join(PKG, 'examples/three-neon-boss'), root, { recursive: true, filter: (p) => !p.includes('/.studio/') && !p.endsWith('/.studio') });
  mkdirSync(join(root, '.studio/ui'), { recursive: true });
  writeFileSync(join(root, '.studio/ui/prefs.json'), JSON.stringify({ version: 1, lang: LANG }));
  const reveals = [];
  const srv = await startStudioServer({ root, uiDir: UI, log: () => {}, env: { CLAUDECODE: '1' }, clips: { dir: clips, where: 'movies', reveal: 'finder', run: (c, a) => reveals.push([c, ...a]) } });
  // Stage 2: an AI watching (the stand-in), so the line has ✦ Rewrite.
  const agent = startFakeAgent(root, { clipPost: (rec) => `Neon Run's boss fight in ${rec.clip?.seconds ?? '?'} seconds. Made it in my browser 👇` });
  browser ??= await launch();
  const page = await newPage(browser, { width: 1280, height: 800 });
  const state = async () => JSON.parse(await page.eval(STATE));
  const until = async (fn, ms = 20000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const s = await state();
      if (fn(s)) return s;
      await sleep(150);
    }
    return null;
  };
  let n = 0;
  const shot = async (what) => {
    if (!SHOTS) return;
    const f = `clip-${ja ? 'ja' : 'en'}-${String(++n).padStart(2, '0')}-${what}.png`;
    writeFileSync(join(SHOTS, f), await page.screenshot());
    console.log(`  shot ${f}`);
  };
  try {
    await page.goto(srv.url);
    await page.waitFor(`document.querySelectorAll('.obj').length > 0`, 90000);
    await sleep(1200);
    let s = await state();
    // Walk 2 ✕4 (decided 2026-11-06): in the person's language from the start (prefs.json says it) — it was "Clip" in
    // English on a Japanese screen until the first clip, and /Clip|<ja>/ here let that pass.
    check(!!s.clip && s.clip.text.trim() === translate(LANG, 'clip.btn'), `"● ${translate(LANG, 'clip.btn')}" in the top bar ("${s.clip?.text}")`);
    check(!!s.clip && !!s.redo && s.clip.l > s.redo.r && !!s.play && s.clip.r < s.play.l && Math.abs(s.clip.y - s.redo.y) < 3, 'right of Undo / Redo, left of ▶ Play, on the same line');
    // ⌄: lengths, the mark, where, nothing leaves.
    await page.click(s.more.x, s.more.y);
    s = await until((x) => !!x.menu, 3000);
    check(!!s && /6/.test(s.menu) && /8/.test(s.menu) && /12/.test(s.menu), `⌄ lists 6 / 8 / 12 s ("${s?.menu}")`);
    check(!!s && (ja ? /このパソコンの外には何も送りません/ : /Nothing leaves this computer\./).test(s.menu), '⌄ says nothing leaves this computer');
    check(!!s && (ja ? /ムービー|ビデオ/ : /Movies|Videos/).test(s.menu), '⌄ says where clips go');
    // Walk 2 △10: under the lengths, what a Before / After adds (its line said 10 s under "8 seconds ✓").
    check(!!s && s.menu.includes(translate(LANG, 'clip.baAdds', { s: 2 })), '⌄ says Before / After adds 2 s');
    await shot('menu');
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await sleep(300);

    // ● Clip in Edit: Play, then recording.
    s = await state();
    await page.click(s.clip.x, s.clip.y);
    s = await until((x) => x.state === 'rec', 20000);
    check(!!s && s.playing, '● Clip in Edit: ▶ Play, then recording');
    await sleep(700);
    s = await state();
    check((ja ? /残り 0:0\d · 止める/ : /0:0\d left · Stop/).test(s.clip?.text || ''), `the button says the time left and Stop ("${s.clip?.text}")`);
    check(s.clipOn && /inset/.test(s.frame) && !!s.time, `red button (${s.clip?.bg}), red frame on the game, the bar of the time left`);
    await shot('recording');
    const pressed = Date.now();
    // The press on the clock both pages share (the editor's performance.timeOrigin + now), just before the click.
    const pressWall = await page.eval('performance.timeOrigin + performance.now()');
    await page.click(s.clip.x, s.clip.y);
    // studio-clip-3: the mark's second after Stop is "Ending…", then "Saving…" (not the time any more).
    const ending = await until((x) => /Ending…|仕上げ中…|Saving…|保存中…/.test(x.clip?.text || '') || !!x.line, 3000);
    check(!!ending && (/Ending…|仕上げ中…|Saving…|保存中…/.test(ending.clip?.text || '') || !!ending.line), `after Stop: "${ending?.clip?.text}"`);
    s = await until((x) => !!x.line, 60000);
    console.log(`  saved ${Date.now() - pressed} ms after Stop`);
    check(!!s, 'the line came');
    if (!s) return;
    console.log(`  line: ${s.line.text}`);
    const files = readdirSync(clips);
    // The game's name is "Neon Run — a boss comes in": its file stem.
    check(files.length === 1 && files[0] === 'neon-run-a-boss-comes-in-clip-1.mp4', `one clip in the clips folder (${files.join(', ')})`);
    check(!readdirSync(root).some((f) => f.endsWith('.mp4')), 'nothing in the game folder');
    const savedTo = translate(LANG, 'clip.saved', { dir: translate(LANG, 'clip.dir.movies') });
    check(s.line.text.includes(savedTo) && !s.line.headCut, `row 1: "${savedTo}", whole`);
    check(s.line.head === 'neon-run-a-boss-comes-in-clip-1.mp4', `the file's name in its tooltip ("${s.line.head}")`);
    check(s.line.where.includes(translate(LANG, 'clip.shape.wide')) && !s.line.where.includes('KUMODeck'), `row 1: length and shape, the folder said once ("${s.line.where}")`);
    check(s.line.text.includes(translate(LANG, 'clip.markRemove')), `"${translate(LANG, 'clip.markRemove')}" (not "Remove mark")`);
    // Walk 2 △11: the post in the editor's language (English is clip-model's own).
    if (ja) check(!/clip from my web game/.test(s.line.post), `the post in Japanese ("${s.line.post}")`);
    check(!!s.line.reveal && !!s.line.mark && !!s.line.close && !!s.line.copy, 'Show in Finder, Remove mark, ✕ and Copy post');
    check(s.line.post.includes('https://github.com/kumodeck/game-studio') && /KUMODeck Game Studio/.test(s.line.post), `the post with the address ("${s.line.post}")`);
    check(/^\d+ \/ 280$/.test(s.line.count), `the count (${s.line.count})`);
    await shot('saved');

    // The file.
    const file = readFileSync(join(clips, files[0]));
    const info = mp4Info(file);
    console.log(`  mp4: ${JSON.stringify(info)} ${(file.length / 1024).toFixed(0)} KB`);
    check(info.brand === 'isom' && info.fastStart && info.codec === 'avc1' && info.width === 1280 && info.height === 720, 'an MP4: isom, moov first, avc1, 1280×720');
    // Stopped about 1 s in: the clip ends one second after the press (~2 s), stamped with real time on the 1/30 s grid —
    // a slow machine (headless software GL) gives fewer frames, never a shorter or faster clip.
    console.log(`  ${(info.samples / info.seconds).toFixed(1)} frames a second recorded here`);
    // Stop was pressed ~1 s in; the game page takes it when it next runs (in headless software GL it draws ~1–2 frames a
    // second, so that is up to ~3 s late here). Shorter than the 8 s asked for, and one mark-second after the press.
    check(info.seconds >= 1.5 && info.seconds < 7.5, `stopped early: ${info.seconds.toFixed(3)} s, not 8`);
    check(info.samples >= 2 && info.samples <= Math.round(info.seconds * 30) + 1, `${info.samples} frames: at most 30 a second`);
    const saidS = parseFloat(s.line.where);
    check(Math.abs(saidS - info.seconds) < 0.051, `the line says its length (${saidS} s, the file ${info.seconds.toFixed(3)} s)`);
    // 6. Cut at the press (stage 2): the game page's own record of the press matches this test's clock, and the clip is
    // one second after it however late the message was read.
    const st = await j(page, STATS);
    if (!st || !st.t0Wall) check(false, `the game page's count of the clip (${JSON.stringify(st)})`);
    else {
      const pressMs = pressWall - st.t0Wall;
      console.log(`  press at ${pressMs.toFixed(0)} ms of the clip, read ${st.late} ms late, ${st.dropped} frame(s) after it dropped`);
      check(Math.abs(st.stoppedAt - pressMs) < 60, `the game page knows when Stop was pressed (${st.stoppedAt} ms, this test ${pressMs.toFixed(0)} ms)`);
      check(Math.abs(info.seconds * 1000 - endAfterStop(pressMs)) < 45, `the clip ends one second after the press: ${info.seconds.toFixed(3)} s for a press at ${(pressMs / 1000).toFixed(3)} s`);
    }
    check(info.keys >= 2, `key frames at the start and at the mark's second (${info.keys})`);
    if (KEEP) copyFileSync(join(clips, files[0]), join(KEEP, `clip-sample-${ja ? 'ja' : 'en'}.mp4`));
    // 7. ✦ Rewrite (stage 2): the stand-in's post, the address put back (the mark is on), the AI line left as it was.
    check(!!s.line.rewrite, '✦ Rewrite on the post\'s row (an AI is watching)');
    if (s.line.rewrite) {
      const aiBefore = s.aiLine;
      await page.click(s.line.rewrite.x, s.line.rewrite.y);
      const r = await until((x) => /boss fight/.test(x.line?.post || ''), 30000);
      check(!!r, `the post rewritten by the AI ("${r?.line?.post}")`);
      if (r) {
        check(r.line.post.endsWith('https://github.com/kumodeck/game-studio'), 'the address kept (the mark is on), though the AI left it out');
        check(/^\d+ \/ 280$/.test(r.line.count) && Number(r.line.count.split(' ')[0]) <= 280, `its count (${r.line.count})`);
        check(!/boss fight/.test(r.aiLine) && r.aiLine === aiBefore, `the AI line does not show the post ("${r.aiLine}")`);
        await shot('rewritten');
      }
      s = await state();
    }
    // Does it play here? (headless shells may have no H.264 decoder: then only said.)
    const b64 = file.toString('base64');
    const played = await page.eval(`(async () => {
      const v = document.createElement('video');
      if (!v.canPlayType('video/mp4; codecs="avc1.42E01F"')) return { skip: true };
      const bin = atob(${JSON.stringify(b64)}); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      v.muted = true; v.src = URL.createObjectURL(new Blob([u], { type: 'video/mp4' }));
      const r = await new Promise((res) => { v.onloadeddata = () => res({ d: v.duration, w: v.videoWidth, h: v.videoHeight }); v.onerror = () => res({ err: v.error && v.error.code }); setTimeout(() => res({ err: 'timeout' }), 8000); });
      return r;
    })()`);
    if (played.skip) console.log('  · this browser plays no H.264: the file was read back only');
    else check(!played.err && Math.abs(played.d - info.seconds) < 0.05 && played.w === 1280 && played.h === 720, `it plays in <video>: ${JSON.stringify(played)}`);

    // Show in Finder: the server's command (no window in the test).
    await page.click(s.line.reveal.x, s.line.reveal.y);
    await sleep(500);
    check(reveals.length === 1 && reveals[0].some((a) => a.includes(files[0]) || a === clips), `Show in Finder ran the system's command (${JSON.stringify(reveals[0])})`);

    // studio-clip-3: Post on X… — X's compose page with the post (caught: no tab in the test) and the clip in its folder.
    check(!!s.line.postX && (ja ? /X に投稿…/ : /Post on X…/).test(s.line.postX.text), `Post on X… on the post's row ("${s.line.postX?.text}")`);
    if (s.line.postX) {
      await page.eval(`(window.__opened = [], window.open = (u) => (window.__opened.push(String(u)), null), true)`);
      await page.click(s.line.postX.x, s.line.postX.y);
      await sleep(500);
      const opened = JSON.parse(await page.eval('JSON.stringify(window.__opened)'));
      const u = opened[0] ? new URL(opened[0]) : null;
      check(!!u && `${u.origin}${u.pathname}` === 'https://x.com/intent/post' && u.searchParams.get('text') === s.line.post, `X opened with the post (${opened[0]?.slice(0, 60)}…)`);
      check(reveals.length === 2, `…and the clip shown in its folder (${reveals.length} reveals)`);
      const told = await until((x) => /X/.test(x.note) && /(Movies|ムービー)/.test(x.note), 3000);
      check(!!told, `the line says what is next ("${told?.note}")`);
      await shot('post-x');
    }
    // studio-clip-3: the line's "N s · Wide 1280×720 ⌄" opens Clip options (for the next clip).
    s = await state();
    check(!!s.line.options, 'the line\'s shape and length is a button');
    if (s.line.options) {
      await page.click(s.line.options.x, s.line.options.y);
      const m = await until((x) => !!x.menu, 3000);
      check(!!m && (ja ? /横 1280×720/ : /Wide 1280×720/).test(m.menu) && (ja ? /縦 720×1280/ : /Tall 720×1280/).test(m.menu) && /12/.test(m.menu), `…it opens Clip options ("${m?.menu}")`);
      await shot('line-options');
      await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await sleep(300);
    }
    s = await state();

    // Copy post.
    await page.send('Browser.grantPermissions', { permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'], origin: srv.origin }).catch(() => undefined);
    await page.click(s.line.copy.x, s.line.copy.y);
    s = await until((x) => /Copied|コピーしました/.test(x.line?.text || ''), 3000);
    check(!!s, 'Copy post: "Copied"');
    s = await state();

    // Remove mark: the other end, the post without the address, remembered.
    const before = file.length;
    await page.click(s.line.mark.x, s.line.mark.y);
    s = await until((x) => !!x.line && !x.line.post.includes('github.com'), 8000);
    check(!!s, 'Remove mark: the post without the address');
    if (s) {
      check(!/KUMODeck/.test(s.line.post), `…and without "Made with KUMODeck" ("${s.line.post}")`);
      check(s.line.text.includes(translate(LANG, 'clip.markAdd')), 'the line now offers Add “Made with”');
    }
    await sleep(500);
    const after = readFileSync(join(clips, files[0]));
    check(readdirSync(clips).length === 1 && after.length !== before && mp4Info(after).samples === info.samples, `the same file, its end swapped (${before} → ${after.length} bytes, ${mp4Info(after).samples} frames)`);
    const prefs = JSON.parse(readFileSync(join(root, '.studio/ui/prefs.json'), 'utf8'));
    check(prefs.clip && prefs.clip.mark === false, `remembered: prefs.json clip ${JSON.stringify(prefs.clip)}`);
    await shot('mark-removed');
  } finally {
    await agent.stop();
    await srv.close();
    rmSync(root, { recursive: true, force: true });
    rmSync(clips, { recursive: true, force: true });
  }
}

async function demo() {
  console.log('demo: the offline web demo, Neon Run, PC 1280×800');
  const dir = join(mkdtempSync(join(tmpdir(), 'studio-clip-demo-')), 'site');
  execFileSync(process.execPath, [join(PKG, 'scripts/build-web-demo.mjs'), '--out', dir, '--also', join(PKG, 'examples/three-neon-boss')], { stdio: 'ignore' });
  const games = JSON.parse(readFileSync(join(dir, 'studio/games.json'), 'utf8')).games;
  const neon = games.find((g) => /neon/i.test(g.id)) || games[0];
  const host = await startHost({ dir });
  const downloads = mkdtempSync(join(tmpdir(), 'studio-clip-dl-'));
  browser ??= await launch();
  await browser.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads }).catch((e) => console.log(`  · no download setting: ${e.message}`));
  const page = await newPage(browser, { width: 1280, height: 800 });
  const state = async () => JSON.parse(await page.eval(STATE));
  try {
    await page.goto(`${host.url}studio/?game=${neon.id}&lang=${LANG}`);
    await page.waitFor(`document.querySelectorAll('.obj').length > 0`, 90000);
    await sleep(1200);
    let s = await state();
    check(!!s.clip, '● Clip in the demo too');
    await page.click(s.clip.x, s.clip.y);
    const t0 = Date.now();
    while (Date.now() - t0 < 20000 && (await state()).state !== 'rec') await sleep(150);
    await sleep(1000);
    s = await state();
    const pressWall = await page.eval('performance.timeOrigin + performance.now()');
    await page.click(s.clip.x, s.clip.y);
    let line = null;
    for (const t1 = Date.now(); Date.now() - t1 < 20000 && !line; await sleep(200)) line = (await state()).line;
    check(!!line && line.text.includes(translate(LANG, 'clip.downloaded', { dir: translate(LANG, 'clip.dir.downloads') })), `the line says downloaded ("${line?.text}")`);
    check(!!line && !line.reveal, 'no Show in Finder in the demo');
    check(!!line && !line.rewrite, 'no ✦ Rewrite in the demo (no AI)');
    let got = [];
    for (const t2 = Date.now(); Date.now() - t2 < 8000 && !got.length; await sleep(250)) got = readdirSync(downloads).filter((f) => f.endsWith('.mp4'));
    check(got.length === 1, `the browser downloaded it (${got.join(', ')})`);
    if (got.length) {
      const info = mp4Info(readFileSync(join(downloads, got[0])));
      check(info.codec === 'avc1' && info.samples >= 2 && info.seconds >= 1.5, `the download is the MP4 (${info.samples} frames, ${info.seconds?.toFixed(3)} s)`);
      // Cut at the press (stage 2), as in the local run: one second after it, however busy the page was.
      const st = await j(page, STATS).catch(() => null);
      if (st && st.t0Wall) {
        const pressMs = pressWall - st.t0Wall;
        console.log(`  press at ${pressMs.toFixed(0)} ms of the clip, read ${st.late} ms late, ${st.dropped} frame(s) dropped`);
        check(Math.abs(info.seconds * 1000 - endAfterStop(pressMs)) < 45, `the clip ends one second after the press: ${info.seconds.toFixed(3)} s for a press at ${(pressMs / 1000).toFixed(3)} s`);
      } else check(info.seconds <= 3.5, `stopped about a second after the press (${info.seconds?.toFixed(3)} s)`);
    }
    if (SHOTS) writeFileSync(join(SHOTS, `clip-${ja ? 'ja' : 'en'}-demo-downloaded.png`), await page.screenshot());
  } finally {
    await host.close?.();
    rmSync(downloads, { recursive: true, force: true });
  }
}

/** Tall (stage 2): Clip ⌄ → Tall, the game's 9:16 window while recording, a 720×1280 MP4, remembered. */
async function tall() {
  console.log('tall: Clip ⌄ → Tall 720×1280, PC 1280×800');
  const root = mkdtempSync(join(tmpdir(), 'studio-clip-'));
  const clips = mkdtempSync(join(tmpdir(), 'studio-clip-movies-'));
  cpSync(join(PKG, 'examples/three-neon-boss'), root, { recursive: true, filter: (p) => !p.includes('/.studio/') && !p.endsWith('/.studio') });
  mkdirSync(join(root, '.studio/ui'), { recursive: true });
  writeFileSync(join(root, '.studio/ui/prefs.json'), JSON.stringify({ version: 1, lang: LANG }));
  const srv = await startStudioServer({ root, uiDir: UI, log: () => {}, clips: { dir: clips, where: 'movies', reveal: 'finder', run: () => {} } });
  browser ??= await launch();
  const page = await newPage(browser, { width: 1280, height: 800 });
  const state = async () => JSON.parse(await page.eval(STATE));
  const until = (fn, ms) => untilOn(state, fn, ms);
  try {
    await page.goto(srv.url);
    await page.waitFor(`document.querySelectorAll('.obj').length > 0`, 90000);
    await sleep(1200);
    let s = await state();
    await page.click(s.more.x, s.more.y);
    await page.waitFor(`!!document.querySelector('[data-action="ctx-clip-tall"]')`, 3000);
    const menu = (await state()).menu;
    check((ja ? /形.*横 1280×720.*縦 720×1280/ : /Shape.*Wide 1280×720.*Tall 720×1280/).test(menu), `⌄ has the shape: ${menu}`);
    check((ja ? /頼んだ言葉/ : /my words on Before \/ After/).test(menu), '⌄ has the words on Before / After');
    if (SHOTS) writeFileSync(join(SHOTS, `clip-${ja ? 'ja' : 'en'}-06-menu-shape.png`), await page.screenshot());
    await page.eval(`document.querySelector('[data-action="ctx-clip-tall"]').click()`);
    await sleep(300);
    s = await state();
    await page.click(s.clip.x, s.clip.y);
    s = await until((x) => x.state === 'rec', 20000);
    check(!!s && s.shape === 'tall', 'recording Tall');
    await sleep(900);
    s = await state();
    check(!!s.game && Math.abs(s.game.w / s.game.h - 9 / 16) < 0.02, `the game's window is 9:16 while recording (${s.game?.w}×${s.game?.h})`);
    if (SHOTS) writeFileSync(join(SHOTS, `clip-${ja ? 'ja' : 'en'}-07-recording-tall.png`), await page.screenshot());
    await page.click(s.clip.x, s.clip.y);
    s = await until((x) => !!x.line, 60000);
    check(!!s, 'the line came');
    if (!s) return;
    check((ja ? /縦 720×1280/ : /Tall 720×1280/).test(s.line.where), `the line says Tall (${s.line.where})`);
    check(!!s.game && s.game.w / s.game.h > 1.2, 'the game\'s window is back to the stage\'s shape');
    const files = readdirSync(clips);
    const info = mp4Info(readFileSync(join(clips, files[0])));
    check(info.width === 720 && info.height === 1280 && info.codec === 'avc1', `a 720×1280 MP4 (${info.width}×${info.height})`);
    const prefs = JSON.parse(readFileSync(join(root, '.studio/ui/prefs.json'), 'utf8'));
    check(prefs.clip && prefs.clip.shape === 'tall', `remembered: ${JSON.stringify(prefs.clip)}`);
    if (SHOTS) writeFileSync(join(SHOTS, `clip-${ja ? 'ja' : 'en'}-08-saved-tall.png`), await page.screenshot());
    if (KEEP) copyFileSync(join(clips, files[0]), join(KEEP, `clip-sample-tall-${ja ? 'ja' : 'en'}.mp4`));
  } finally {
    await srv.close();
    rmSync(root, { recursive: true, force: true });
    rmSync(clips, { recursive: true, force: true });
  }
}

/** A phone (stage 2): ● Clip while playing, Tall by default, Share… (or Save to this phone), no Show in Finder. */
async function phone() {
  console.log('phone: 390×844, the local editor');
  const root = mkdtempSync(join(tmpdir(), 'studio-clip-'));
  const clips = mkdtempSync(join(tmpdir(), 'studio-clip-movies-'));
  cpSync(join(PKG, 'examples/three-neon-boss'), root, { recursive: true, filter: (p) => !p.includes('/.studio/') && !p.endsWith('/.studio') });
  mkdirSync(join(root, '.studio/ui'), { recursive: true });
  writeFileSync(join(root, '.studio/ui/prefs.json'), JSON.stringify({ version: 1, lang: LANG }));
  const srv = await startStudioServer({ root, uiDir: UI, log: () => {}, clips: { dir: clips, where: 'movies', reveal: 'finder', run: () => {} } });
  browser ??= await launch();
  const page = await newPage(browser, { width: 390, height: 844, mobile: true });
  const state = async () => JSON.parse(await page.eval(STATE));
  const until = (fn, ms) => untilOn(state, fn, ms);
  try {
    await page.goto(srv.url);
    await page.waitFor(`document.querySelectorAll('.obj').length > 0`, 90000);
    await sleep(1200);
    let s = await state();
    check(!s.clip, 'no ● Clip in Edit on a phone (the bar has no room; a clip is made while playing)');
    await page.eval(`document.querySelector('button.play').click()`);
    s = await until((x) => x.playing && !!x.clip, 30000);
    check(!!s, '● Clip in the bar while playing');
    if (!s) return;
    await sleep(800);
    // Measured again now: the bar settles after Play starts (✦ and ❚❚ come in), and the first box was a stale place.
    s = await state();
    const t0 = Date.now();
    // What is really under the finger there (2026-11-05: "● Clip ⌄" overflowed the phone's bar and lay under ✦).
    // studio-clip-3: given up to 5 s to settle (the bar fills in as Play starts); a button that STAYS over ● still fails.
    let hit = '';
    for (const t1 = Date.now(); Date.now() - t1 < 5000; await sleep(250)) {
      s = await state();
      hit = await page.eval(`(() => { const e = document.elementFromPoint(${s.clip.x}, ${s.clip.y}); return e?.closest('[data-action]')?.dataset.action || ''; })()`);
      if (hit === 'clip') break;
    }
    check(hit === 'clip', `the tap lands on ● Clip, nothing over it (${hit})`);
    const bar = await page.eval(`JSON.stringify([...document.querySelectorAll('.top button')].filter((b) => b.offsetParent).map((b) => b.getBoundingClientRect()).filter((r) => r.width).map((r) => [Math.round(r.left), Math.round(r.right)]))`);
    console.log(`  the bar's buttons (left, right): ${bar}`);
    // studio-clip-3: holding ● opens Clip options (a phone has no ⌄), and does not record.
    await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: s.clip.x, y: s.clip.y, id: 1 }] });
    await sleep(800);
    await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const held = await until((x) => !!x.menu, 3000);
    check(!!held && (ja ? /縦 720×1280/ : /Tall 720×1280/).test(held.menu) && /12/.test(held.menu), `holding ● opens Clip options ("${held?.menu}")`);
    await sleep(400);
    check((await state()).state === 'idle', 'holding ● did not start a clip');
    if (SHOTS) writeFileSync(join(SHOTS, `clip-${ja ? 'ja' : 'en'}-phone-0-hold-options.png`), await page.screenshot());
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await sleep(400);
    s = await state();
    await page.tap(s.clip.x, s.clip.y);
    const seen = [];
    s = await until((x) => (seen.push(`${Date.now() - t0}:${x.state}/${x.shape}`), x.state === 'rec'), 20000);
    check(!!s && s.shape === 'tall', `a phone records Tall until the person chooses (${s ? s.shape : `not recording after the tap: ${seen.slice(-1)}`})`);
    await sleep(900);
    s = (await state()) || s;
    check(/^\d+$/.test(s.left) && Number(s.left) <= 8, `the round ● says the seconds left ("${s.left}")`);
    if (SHOTS) writeFileSync(join(SHOTS, `clip-${ja ? 'ja' : 'en'}-phone-1-recording.png`), await page.screenshot());
    if (s?.clip) await page.tap(s.clip.x, s.clip.y);
    s = await until((x) => !!x.line, 60000);
    check(!!s, 'the line came');
    if (!s) return;
    console.log(`  line: ${s.line.text}`);
    check(!s.line.reveal, 'no Show in Finder on a phone');
    check(!!s.line.share || !!s.line.save, `Share… (or Save to this phone where files can't be shared): ${s.line.share ? 'Share…' : s.line.save ? 'Save' : 'none'}`);
    check((ja ? /縦 720×1280/ : /Tall 720×1280/).test(s.line.where), `Tall (${s.line.where})`);
    const pf = readdirSync(clips);
    const pinfo = pf.length ? mp4Info(readFileSync(join(clips, pf[0]))) : {};
    check(pinfo.width === 720 && pinfo.height === 1280, `a phone's clip is Tall: ${pinfo.width}×${pinfo.height}`);
    const r = s.line.share || s.line.save;
    check(!!r && r.l >= 0 && r.r <= 390, 'its button on screen');
    check(!!s.line.options && s.line.options.l >= 0 && s.line.options.r <= 390, 'the line\'s shape (Clip options) on screen');
    check(!s.line.postX, 'no Post on X… on a phone (Share… hands X the video and the post)');
    if (SHOTS) writeFileSync(join(SHOTS, `clip-${ja ? 'ja' : 'en'}-phone-2-saved.png`), await page.screenshot());
  } finally {
    await srv.close();
    rmSync(root, { recursive: true, force: true });
    rmSync(clips, { recursive: true, force: true });
  }
}

/**
 * studio-clip-3: a picture from another site (another port = another origin, no CORS) drawn on a canvas over the game:
 * the clip is refused in one line that says what to do, with ✦ Ask …; pressed, the game pauses and the request is in
 * the field (not sent).
 */
async function refuse() {
  console.log('refuse: a canvas with an image from another site, PC 1280×800');
  const root = mkdtempSync(join(tmpdir(), 'studio-clip-'));
  const clips = mkdtempSync(join(tmpdir(), 'studio-clip-movies-'));
  cpSync(join(PKG, 'examples/three-neon-boss'), root, { recursive: true, filter: (p) => !p.includes('/.studio/') && !p.endsWith('/.studio') });
  mkdirSync(join(root, '.studio/ui'), { recursive: true });
  writeFileSync(join(root, '.studio/ui/prefs.json'), JSON.stringify({ version: 1, lang: LANG }));
  const srv = await startStudioServer({ root, uiDir: UI, log: () => {}, env: { CLAUDECODE: '1' }, clips: { dir: clips, where: 'movies', reveal: 'finder', run: () => {} } });
  // "Another site": a 2×2 PNG from another port, with no Access-Control-Allow-Origin.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGNwaPgPRAwQCgAt9gb9K5p4SgAAAABJRU5ErkJggg==', 'base64');
  const { createServer } = await import('node:http');
  const other = createServer((_, res) => (res.writeHead(200, { 'Content-Type': 'image/png' }), res.end(png)));
  await new Promise((r) => other.listen(0, '127.0.0.1', r));
  const imgUrl = `http://127.0.0.1:${other.address().port}/sky.png`;
  browser ??= await launch();
  const page = await newPage(browser, { width: 1280, height: 800 });
  const state = async () => JSON.parse(await page.eval(STATE));
  const until = (fn, ms) => untilOn(state, fn, ms);
  try {
    await page.goto(srv.url);
    await page.waitFor(`document.querySelectorAll('.obj').length > 0`, 90000);
    await sleep(1200);
    await page.eval(`document.querySelector('button.play').click()`);
    let s = await until((x) => x.playing, 30000);
    check(!!s, 'playing');
    // The Play page is a new page: wait until it is the one on screen and its clock runs (the image goes in THAT page).
    await page.waitFor(`(() => { const f = document.querySelector('iframe.game:not(.leaving)'); const t = document.querySelector('[data-part=play-time]')?.textContent || '';
      return !!f?.contentWindow?.__gameStudio && document.querySelectorAll('iframe.game').length === 1 && /0:0[1-9]/.test(t); })()`, 30000).catch(() => null);
    await sleep(500);
    // The game draws that image on a canvas of its own (a HUD's sky, say).
    const drawn = await page.eval(`(async () => { const w = document.querySelector('iframe.game:not(.leaving)').contentWindow; const d = w.document;
      const c = d.createElement('canvas'); c.width = 120; c.height = 60; c.style.cssText = 'position:fixed;left:8px;top:8px;width:120px;height:60px;z-index:5';
      d.body.append(c); const img = new w.Image(); img.src = ${JSON.stringify(imgUrl)}; await img.decode(); c.getContext('2d').drawImage(img, 0, 0, 120, 60);
      try { c.getContext('2d').getImageData(0, 0, 1, 1); return 'clean'; } catch { return 'tainted'; } })()`);
    check(drawn === 'tainted', `the canvas is tainted (${drawn})`);
    s = await state();
    await page.click(s.clip.x, s.clip.y);
    // On the stage, where it is seen while playing (the editor's toast is in the dock, put away while playing).
    s = await until((x) => /another site|別のサイト/.test(x.note), 30000);
    check(!!s, `refused in one line on the stage ("${s?.note}")`);
    if (!s) return console.log(`  · ${page.logs.slice(-6).join('\n  · ')}\n  · line: ${await page.eval(`document.querySelector('[data-part=clip-line]')?.outerHTML.slice(0, 300)`)}`);
    await sleep(300);
    s = await state();
    if (SHOTS) writeFileSync(join(SHOTS, `clip-${ja ? 'ja' : 'en'}-refuse-1-tainted.png`), await page.screenshot());
    check((ja ? /画像をゲームのフォルダへ移して/ : /can move them into the game’s folder/).test(s.note), 'the line says what to do next');
    check(s.state === 'idle' && !s.clipOn, 'not recording');
    check(s.acts.length > 0, `with ✦ Ask (${s.acts.map((a) => a.text).join(', ')})`);
    if (!s.acts.length) return;
    const act = s.acts[0];
    check(/✦/.test(act.text), `its button: "${act.text}"`);
    const under = await page.eval(`document.elementFromPoint(${act.x}, ${act.y})?.closest('[data-action]')?.dataset.action || ''`);
    check(under === 'clip-note-act', `nothing over it (${under})`);
    await page.click(act.x, act.y);
    await page.waitFor(`document.querySelector('.shell').dataset.paused === 'on'`, 10000).catch(() => null);
    const field = await page.waitFor(`(() => { const i = document.querySelector('.ask-input'); return i && i.value ? i.value : ''; })()`, 10000).catch(() => '');
    const paused = await page.eval(`document.querySelector('.shell').dataset.paused === 'on'`);
    check(paused, 'the game paused for the request');
    if (!paused) console.log(`  · ${page.logs.slice(-8).join('\n  · ')}\n  · shell ${await page.eval(`JSON.stringify({ ...document.querySelector('.shell').dataset })`)}`);
    check((ja ? /別のサイトから読んでいる画像をゲームのフォルダに置いて/ : /Put the images this game loads from other sites into the game’s folder/).test(field), `the request in the field, not sent ("${field}")`);
    if (SHOTS) writeFileSync(join(SHOTS, `clip-${ja ? 'ja' : 'en'}-refuse-2-asked.png`), await page.screenshot());
  } finally {
    await page.close().catch(() => {});
    other.close();
    await srv.close();
    rmSync(root, { recursive: true, force: true });
    rmSync(clips, { recursive: true, force: true });
  }
}

try {
  if (ONLY.includes('local')) await local();
  if (ONLY.includes('demo')) await demo();
  if (ONLY.includes('tall')) await tall();
  if (ONLY.includes('phone')) await phone();
  if (ONLY.includes('refuse')) await refuse();
} catch (e) {
  console.error(e);
  failed++;
} finally {
  await browser?.close();
}
console.log(failed ? `✗ ${failed} check(s) failed` : '✓ all checks passed');
process.exit(failed ? 1 : 0);
