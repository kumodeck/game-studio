// ● Clip, stage 1 (decided 2026-11-05; src/shell/clip.ts, src/bridge/play-clip.ts, src/shell/mp4.ts, src/server/clips.mjs) in
// a headless browser: the real local server, the built editor, examples/three-neon-boss (three.js + an HTML HUD).
//
//   node test/studio-clip.browser.mjs [--only local,demo] [--shots <dir>] [--lang en|ja] [--keep <dir>]
//
// local  PC 1280×800, the local editor:
//   1. In Edit, "● Clip ⌄" in the top bar right of Undo / Redo; ⌄ lists 6 / 8 / 12 s (8 checked), the mark (checked),
//      where clips go and "Nothing leaves this computer.".
//   2. ● Clip in Edit → ▶ Play, recording: the button red "0:0N · Stop", the red frame on the game (data-clip=rec), the
//      bar of the time left. Pressed again ~1 s in: the clip ends one second later (~2 s).
//   3. The line: "Clip saved · neon-run-clip-1.mp4", "… s · Wide 1280×720 · Movies › KUMODeck", Show in Finder (the
//      server's command, no window), Remove mark, ✕; the post with the address and "N / 280", Copy post.
//   4. The file in the clips folder (not the game folder): an MP4 (ftyp isom, moov before mdat, avc1, 1280×720) about
//      2 s long (stopped ~1 s in, plus the mark's second), at most 30 frames a second (real time: a slow machine gives
//      fewer frames, never a faster clip), the length the line says, key frames at the start and at the mark; it plays
//      in the page's <video> when this browser can play H.264 (its length and size read back).
//   5. Remove mark: the same file written again with the other end, the post without the address, the choice kept in
//      .studio/ui/prefs.json (clip.mark false).
// demo   the offline web demo (no server folder): ● Clip downloads the MP4 (the browser's download, checked on disk), the
//        line says "Clip downloaded", no Show in Finder.
// --shots: clip-*.png (the docs' clip / clip-saved pictures). --keep: copies the saved MP4 there (a sample to look at).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStudioServer } from '../src/server/server.mjs';
import { launch, newPage } from './adapters-2d/cdp.mjs';
import { startHost } from './web-demo-host.mjs';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const UI = join(PKG, 'skills/arrange/bin/studio-ui');
const args = process.argv.slice(2);
const take = (flag, d = null) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : d;
};
const ONLY = (take('--only') || 'local,demo').split(',');
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
      count: line.querySelector('[data-part=clip-count]')?.textContent || '', where: line.querySelector('.clip-where')?.textContent || '',
      reveal: box(line.querySelector('[data-action=clip-reveal]')), mark: box(line.querySelector('[data-action=clip-mark]')),
      copy: box(line.querySelector('[data-action=clip-copy]')), close: box(line.querySelector('[data-action=clip-close]')) } : null,
    toast: [...document.querySelectorAll('.toast.on')].map((e) => e.textContent).join(' '),
    menu: (() => { const m = document.querySelector('[data-part=context-menu]:not([hidden])'); return m && m.getBoundingClientRect().width ? m.innerText.replace(/\\s+/g, ' ').trim() : ''; })(),
  });
})()`;

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
  const srv = await startStudioServer({ root, uiDir: UI, log: () => {}, clips: { dir: clips, where: 'movies', reveal: 'finder', run: (c, a) => reveals.push([c, ...a]) } });
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
    check(!!s.clip && /Clip|クリップ/.test(s.clip.text), `"● Clip" in the top bar ("${s.clip?.text}")`);
    check(!!s.clip && !!s.redo && s.clip.l > s.redo.r && !!s.play && s.clip.r < s.play.l && Math.abs(s.clip.y - s.redo.y) < 3, 'right of Undo / Redo, left of ▶ Play, on the same line');
    // ⌄: lengths, the mark, where, nothing leaves.
    await page.click(s.more.x, s.more.y);
    s = await until((x) => !!x.menu, 3000);
    check(!!s && /6/.test(s.menu) && /8/.test(s.menu) && /12/.test(s.menu), `⌄ lists 6 / 8 / 12 s ("${s?.menu}")`);
    check(!!s && (ja ? /このパソコンの外には何も送りません/ : /Nothing leaves this computer\./).test(s.menu), '⌄ says nothing leaves this computer');
    check(!!s && (ja ? /ムービー|ビデオ/ : /Movies|Videos/).test(s.menu), '⌄ says where clips go');
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
    check(/0:0\d · (Stop|止める)/.test(s.clip?.text || ''), `the button says the time and Stop ("${s.clip?.text}")`);
    check(s.clipOn && /inset/.test(s.frame) && !!s.time, `red button (${s.clip?.bg}), red frame on the game, the bar of the time left`);
    await shot('recording');
    const pressed = Date.now();
    await page.click(s.clip.x, s.clip.y);
    s = await until((x) => !!x.line, 60000);
    console.log(`  saved ${Date.now() - pressed} ms after Stop`);
    check(!!s, 'the line came');
    if (!s) return;
    console.log(`  line: ${s.line.text}`);
    const files = readdirSync(clips);
    // The game's name is "Neon Run — a boss comes in": its file stem.
    check(files.length === 1 && files[0] === 'neon-run-a-boss-comes-in-clip-1.mp4', `one clip in the clips folder (${files.join(', ')})`);
    check(!readdirSync(root).some((f) => f.endsWith('.mp4')), 'nothing in the game folder');
    check((ja ? /クリップを保存しました · neon-run-a-boss-comes-in-clip-1\.mp4/ : /Clip saved · neon-run-a-boss-comes-in-clip-1\.mp4/).test(s.line.text), 'row 1: saved and its name');
    check((ja ? /秒 · 横 1280×720 · ムービー › KUMODeck/ : / s · Wide 1280×720 · Movies › KUMODeck/).test(s.line.text), 'row 1: length, Wide 1280×720, Movies › KUMODeck');
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
    check(info.keys >= 2, `key frames at the start and at the mark's second (${info.keys})`);
    if (KEEP) copyFileSync(join(clips, files[0]), join(KEEP, `clip-sample-${ja ? 'ja' : 'en'}.mp4`));
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
      check(/Add mark|印を付ける/.test(s.line.text), 'the line now offers Add mark');
    }
    await sleep(500);
    const after = readFileSync(join(clips, files[0]));
    check(readdirSync(clips).length === 1 && after.length !== before && mp4Info(after).samples === info.samples, `the same file, its end swapped (${before} → ${after.length} bytes, ${mp4Info(after).samples} frames)`);
    const prefs = JSON.parse(readFileSync(join(root, '.studio/ui/prefs.json'), 'utf8'));
    check(prefs.clip && prefs.clip.mark === false, `remembered: prefs.json clip ${JSON.stringify(prefs.clip)}`);
    await shot('mark-removed');
  } finally {
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
    await page.click(s.clip.x, s.clip.y);
    let line = null;
    for (const t1 = Date.now(); Date.now() - t1 < 20000 && !line; await sleep(200)) line = (await state()).line;
    check(!!line && (ja ? /クリップをダウンロードしました/ : /Clip downloaded · neon/).test(line.text), `the line says downloaded ("${line?.text}")`);
    check(!!line && !line.reveal, 'no Show in Finder in the demo');
    let got = [];
    for (const t2 = Date.now(); Date.now() - t2 < 8000 && !got.length; await sleep(250)) got = readdirSync(downloads).filter((f) => f.endsWith('.mp4'));
    check(got.length === 1, `the browser downloaded it (${got.join(', ')})`);
    if (got.length) {
      const info = mp4Info(readFileSync(join(downloads, got[0])));
      check(info.codec === 'avc1' && info.samples >= 2 && info.seconds >= 1.5 && info.seconds <= 3.5, `the download is the MP4 (${info.samples} frames, ${info.seconds?.toFixed(3)} s)`);
    }
    if (SHOTS) writeFileSync(join(SHOTS, `clip-${ja ? 'ja' : 'en'}-demo-downloaded.png`), await page.screenshot());
  } finally {
    await host.close?.();
    rmSync(downloads, { recursive: true, force: true });
  }
}

try {
  if (ONLY.includes('local')) await local();
  if (ONLY.includes('demo')) await demo();
} catch (e) {
  console.error(e);
  failed++;
} finally {
  await browser?.close();
}
console.log(failed ? `✗ ${failed} check(s) failed` : '✓ all checks passed');
process.exit(failed ? 1 : 0);
