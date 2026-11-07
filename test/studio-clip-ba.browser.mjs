// ● Clip Before / After (stage 2, decided 2026-11-05; src/shell/clip.ts beforeAfter, src/bridge/play-clip.ts `before`,
// src/shell/moment-try.ts's panel) in a headless browser: the real local server, the built editor,
// examples/three-neon-boss and the stand-in AI (test/ai-feel/fake-agent.mjs) that moves where the boss comes in.
//
//   node test/studio-clip-ba.browser.mjs [--shots <dir>] [--lang en|ja] [--keep <dir>] [--tall] [--slow N]
//
// PC 1280×800:
//   1. ▶ Play until the boss is out, P (paused), ◎ a mark on it, "Bring the boss in from here." + Enter: the stand-in
//      changes game.js (the boss 2 m to the left) and replies; the reply has ▶ Try · Before / After · ↶ Undo.
//   2. Before / After: the Try opens the same second with the new code; once the After is there, the panel's foot has
//      "● Clip Before / After" (not before: there is nothing to film yet).
//   3. Pressed: the panel closes, the game resumes only once the still part is encoded (the clip's `started`), the
//      button is red, then the line: "neon-run-…-before-after-1.mp4", "10 s · Wide 1280×720", the post "Paused my game
//      at 0:0N, marked a spot and told Claude “bring the boss in from here”. It fixed the code. Before → After 👇 <address>".
//   4. The file: an MP4 of 10 s (2 s still + 8 s of the After), 1280×720, a key frame at 0, at 2 s and at the mark
//      (9 s); its frames read back with ffmpeg (when there): 1 s = the Before (the still frame, "Before"), 2.1 s = the
//      wipe, 5 s = the After, 9.5 s = the mark — and the still part's frames are the same picture (it is held).
//   5. (stage 3, decided 2026-11-07) The sound: the Try's page makes a 440 Hz tone (Web Audio) while it waits at the
//      moment; the clip has an AAC track 10 s long, silent over the Before (its 2 s still part) and with the tone over
//      the After (read back with ffmpeg / ffprobe, when there).
// --tall: the same with Clip ⌄ → Tall (720×1280). --shots: clip-ba-*.png (and the frames as PNG). --keep: the MP4.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStudioServer } from '../src/server/server.mjs';
import { launch, newPage } from './adapters-2d/cdp.mjs';
import { startFakeAgent } from './ai-feel/fake-agent.mjs';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const UI = join(PKG, 'skills/arrange/bin/studio-ui');
const args = process.argv.slice(2);
const take = (flag, d = null) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : d;
};
const SHOTS = take('--shots') ? resolve(take('--shots')) : null;
const KEEP = take('--keep') ? resolve(take('--keep')) : null;
const LANG = take('--lang', 'en');
const TALL = args.includes('--tall');
// --slow N: the page's CPU N times slower (DevTools' throttling) — a busy machine, where the Try's pause comes late.
const SLOW = Number(take('--slow', '0')) || 0;
const ja = LANG === 'ja';
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
if (KEEP) mkdirSync(KEEP, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FR = `document.querySelector('iframe.game:not(.leaving)')`;
const GW = `${FR}.contentWindow`;
const M = `${GW}.__gameStudio._move`;
const SHELL = `document.querySelector('.shell')`;
const IN = {
  playing: `${SHELL}.dataset.playing === 'on'`,
  moment: `${SHELL}.dataset.moment === 'on' && ${SHELL}.dataset.paused === 'on'`,
  line: `(() => { const l = document.querySelector('.ai-line'); return l && !l.hidden && l.offsetParent ? l.textContent : ''; })()`,
  frame: `JSON.stringify((() => { const r = ${FR}.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; })())`,
};
const box = (sel) => `(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.offsetParent && !x.hidden); if (!e) return null;
  const r = e.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2, left: r.left, right: r.right, top: r.top, bottom: r.bottom, text: e.textContent.replace(/\\s+/g, ' ').trim() }); })()`;
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
  const vk = key === 'Enter' ? 13 : key === 'Escape' ? 27 : key.toUpperCase().charCodeAt(0);
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk, ...(text ? { text } : {}) });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk });
}
const replyButtons = (page) => j(page, `JSON.stringify([...document.querySelectorAll('.ai-line button')].filter((b) => b.offsetParent).map((b) => b.dataset.action))`);

// The boxes of an MP4 (as studio-clip.browser.mjs reads them) and its key frames' times.
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
      if (ty === 'tkhd') (info.width = b.readUInt32BE(at + size - 8) / 65536, info.height = b.readUInt32BE(at + size - 4) / 65536);
      else if (ty === 'mdhd') (info.scale = b.readUInt32BE(body + 12), info.seconds = b.readUInt32BE(body + 16) / b.readUInt32BE(body + 12));
      else if (ty === 'stsz') info.samples = b.readUInt32BE(body + 8);
      else if (ty === 'stss') info.keyIdx = Array.from({ length: b.readUInt32BE(body + 4) }, (_, k) => b.readUInt32BE(body + 8 + k * 4));
      else if (ty === 'stts') {
        const n = b.readUInt32BE(body + 4);
        info.deltas = [];
        for (let k = 0; k < n; k++) for (let c = b.readUInt32BE(body + 8 + k * 8), d = b.readUInt32BE(body + 12 + k * 8); c > 0; c--) info.deltas.push(d);
      } else if (ty === 'stsd') info.codec = type(body + 12);
      // The first trak only (the video): a clip with sound has a second one (stage 3), whose boxes would overwrite these.
      if (ty === 'trak') info.traks = (info.traks || 0) + 1;
      if (['moov', 'mdia', 'minf', 'stbl'].includes(ty) || (ty === 'trak' && info.traks === 1)) walk(body, at + size, depth + 1);
      at += size;
    }
  };
  walk(0, b.length, 0);
  // Each key frame's time (s): the sum of the durations before it.
  const starts = [];
  let t = 0;
  for (const d of info.deltas || []) (starts.push(t / info.scale), (t += d));
  info.keyTimes = (info.keyIdx || []).map((k) => +(starts[k - 1] ?? 0).toFixed(3));
  return info;
}

let failed = 0;
const check = (ok, what) => {
  console.log(`  ${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failed++;
};

/** The stand-in's fix (as studio-pause.browser.mjs nudgeBoss): the boss comes in 2 m more to the left. */
function nudgeBoss(folder, rec) {
  const f = join(folder, 'game.js');
  const src = readFileSync(f, 'utf8');
  const m = /boss\.position\.set\((-?[\d.]+), (-?[\d.]+), (-?[\d.]+)\);/.exec(src);
  if (!m) return null;
  const x = (Number(m[1]) - 2).toFixed(1);
  writeFileSync(f, src.replace(m[0], `boss.position.set(${x}, ${m[2]}, ${m[3]});`));
  return { files: ['game.js'], note: rec.lang === 'ja' ? `ボスは X ${x} から出るようにしました。` : `The boss now comes in at X ${x}, more to the left.` };
}

async function run() {
  console.log(`before / after: Neon Run with a boss, PC 1280×800, ${TALL ? 'Tall' : 'Wide'}${SLOW > 1 ? `, CPU ${SLOW}× slower` : ''}`);
  const root = mkdtempSync(join(tmpdir(), 'studio-clip-ba-'));
  const clips = mkdtempSync(join(tmpdir(), 'studio-clip-ba-movies-'));
  cpSync(join(PKG, 'examples/three-neon-boss'), root, { recursive: true, filter: (p) => !p.includes('/.studio/') && !p.endsWith('/.studio') });
  mkdirSync(join(root, '.studio/ui'), { recursive: true });
  writeFileSync(join(root, '.studio/ui/prefs.json'), JSON.stringify({ version: 1, lang: LANG, ...(TALL ? { clip: { seconds: 8, mark: true, words: true, shape: 'tall' } } : {}) }));
  const srv = await startStudioServer({ root, uiDir: UI, log: () => {}, env: { CLAUDECODE: '1' }, clips: { dir: clips, where: 'movies', reveal: 'finder', run: () => {} } });
  const agent = startFakeAgent(root, { fix: nudgeBoss });
  const browser = await launch();
  const page = await newPage(browser, { width: 1280, height: 800 });
  let n = 0;
  const shot = async (what) => {
    if (!SHOTS) return;
    const f = `clip-ba-${ja ? 'ja' : 'en'}${TALL ? '-tall' : ''}-${String(++n).padStart(2, '0')}-${what}.png`;
    writeFileSync(join(SHOTS, f), await page.screenshot());
    console.log(`  shot ${f}`);
  };
  try {
    if (SLOW > 1) await page.send('Emulation.setCPUThrottlingRate', { rate: SLOW });
    await page.goto(srv.url);
    await page.waitFor(`document.querySelectorAll('.obj').length > 0 && !!${GW}?.__gameStudio?._debug`, 90000);
    await sleep(1000);
    // 1. Play until the boss is out, pause, a mark on it, ask.
    await page.eval(`document.querySelector('button.play').click()`);
    await page.waitFor(IN.playing, 30000);
    await until(async () => (await j(page, `JSON.stringify(${M}.list().map((i) => i.key))`)).includes('boss'), 90000, 'the boss');
    await sleep(600);
    await page.click(640, 120);
    await keyIn(page, 'p', 'KeyP', 'p');
    await page.waitFor(IN.moment, 10000);
    await sleep(500);
    await page.eval(`(document.activeElement?.blur?.(), true)`);
    const mk = await j(page, box('[data-action=moment-mark]'));
    await page.click(mk.x, mk.y);
    await sleep(200);
    const fr = await j(page, IN.frame);
    await page.click(fr[0] + fr[2] * 0.5, fr[1] + fr[3] * 0.4);
    await sleep(400);
    await page.eval(`(document.querySelector('.ask-input').focus(), true)`);
    await page.send('Input.insertText', { text: ja ? 'ここからボスを出して。' : 'Bring the boss in from here.' });
    await keyIn(page, 'Enter', 'Enter', '\r');
    await until(async () => (await replyButtons(page)).includes('moment-compare'), 60000, 'the reply with Before / After');
    check(true, `the reply: ${(await replyButtons(page)).join(' · ')}`);
    // 2. Before / After: the Try at the same second, the After, then the clip button.
    const cmp = await j(page, box('[data-action=moment-compare]'));
    await page.click(cmp.x, cmp.y);
    await page.waitFor(`!!document.querySelector('[data-part=moment-compare]:not([hidden]) [data-part=compare-before] img')`, 5000);
    const early = await page.eval(`!!document.querySelector('[data-part=moment-compare]:not([hidden]) [data-action=compare-clip]')`);
    // The Try plays again up to the ask's second: slow in software GL. On a timeout, the screen and the editor's state.
    // No pressing again (decided 2026-11-06): the panel closed at the Try's pause 3 runs in 4 in Japanese on a busy
    // machine, and this test pressed Before / After again for it. The cause was the editor's (it judged the Try's pause
    // on its estimate of the held second; moment-try.ts tryPauseVerdict); --slow 20 shows it again on any machine.
    const AFTER = `!!document.querySelector('[data-part=moment-compare]:not([hidden]) [data-part=compare-after] img')`;
    await page.waitFor(AFTER, 240000).catch(async (e) => {
      if (SHOTS) writeFileSync(join(SHOTS, `clip-ba-${ja ? 'ja' : 'en'}-timeout.png`), await page.screenshot());
      throw new Error(`${e.message} ${await page.eval(`JSON.stringify({ shell: { ...${SHELL}.dataset }, flash: document.querySelector('[data-part=play-flash]')?.textContent, time: document.querySelector('[data-part=play-time]')?.textContent, line: document.querySelector('.ai-line')?.textContent, toast: [...document.querySelectorAll('.toast.on')].map((t) => t.textContent).join(' ') })`)}`);
    });
    const clipBtn = await until(() => j(page, box('[data-part=moment-compare]:not([hidden]) [data-action=compare-clip]')), 10000, 'the clip button');
    check(!early, 'no clip button before the After was there (nothing to film yet)');
    // ja uses one word for Before / After everywhere since 2026-11-06.
    check((ja ? /前 \/ 後をクリップに/ : /Clip Before \/ After/).test(clipBtn.text), `the panel's "${clipBtn.text}"`);
    await shot('panel');
    // 5. (stage 3) The Try's page makes a sound of its own: a steady 440 Hz tone through its AudioContext (the editor's
    // frame allows autoplay, and this page was opened by the person's press).
    const toned = await page.eval(`(async () => { const w = ${GW}; const ctx = new w.AudioContext(); await Promise.race([ctx.resume(), new Promise((r) => setTimeout(r, 800))]).catch(() => {});
      const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = 440; g.gain.value = 0.3; o.connect(g).connect(ctx.destination); o.start(); w.__tone = ctx; return ctx.state; })()`);
    console.log(`  the Try's tone: ${toned}`);
    // 3. Pressed.
    const t0 = Date.now();
    await page.click(clipBtn.x, clipBtn.y);
    await sleep(150);
    check(!(await page.eval(`!!document.querySelector('[data-part=moment-compare]:not([hidden])')`)), 'the panel closed');
    // Held until the still part is encoded: still paused while the clip is starting.
    const starting = await page.eval(`${SHELL}.dataset.clip || ''`);
    const heldThen = await page.eval(`${SHELL}.dataset.paused === 'on'`);
    check(starting === 'starting' ? heldThen : true, `the Try's moment held while the still part is made (clip ${starting}, paused ${heldThen})`);
    await until(async () => (await page.eval(`${SHELL}.dataset.clip || ''`)) === 'rec', 30000, 'recording');
    await sleep(300);
    check(await page.eval(`${SHELL}.dataset.paused !== 'on'`), 'then the game goes on (the After is played)');
    if (TALL) {
      const g = await j(page, IN.frame);
      check(Math.abs(g[2] / g[3] - 9 / 16) < 0.02, `the game's window 9:16 while recording (${g[2]}×${g[3]})`);
    }
    await sleep(1500);
    await shot('recording');
    const line = await until(() => j(page, `JSON.stringify((() => { const l = document.querySelector('[data-part=clip-line]'); return l && !l.hidden ? { text: l.innerText.replace(/\\s+/g, ' ').trim(),
      post: l.querySelector('[data-part=clip-post]')?.textContent || '', where: l.querySelector('.clip-where')?.textContent || '' } : null; })())`), 90000, 'the line');
    console.log(`  saved ${Date.now() - t0} ms after the press; line: ${line.text}`);
    const files = readdirSync(clips);
    check(files.length === 1 && /^neon-run-a-boss-comes-in-before-after-1\.mp4$/.test(files[0]), `the file's name (${files.join(', ')})`);
    check((ja ? /10 秒 · (横 1280×720|縦 720×1280)/ : /10 s · (Wide 1280×720|Tall 720×1280)/).test(line.where), `10 s and its shape (${line.where})`);
    const post = line.post;
    // The post is written in the screen's language since 2026-11-06 (a ja post mixed English with the ask).
    check((ja
      ? /^\d:\d\d で止めて印を付け、Claude に「.+」と頼んだら、コードを直してくれた。前 → 後 👇 https:\/\/github\.com\/kumodeck\/game-studio$/
      : /^Paused my game at \d:\d\d, marked a spot and told Claude “.+”\. It fixed the code\. Before → After 👇 https:\/\/github\.com\/kumodeck\/game-studio$/).test(post), `the post ("${post}")`);
    await shot('saved');
    // 4. The file.
    const fileP = join(clips, files[0]);
    const info = mp4Info(readFileSync(fileP));
    console.log(`  mp4: ${info.width}×${info.height}, ${info.samples} frames, ${info.seconds?.toFixed(3)} s, key frames at ${info.keyTimes.join(', ')} s`);
    check(info.codec === 'avc1' && info.width === (TALL ? 720 : 1280) && info.height === (TALL ? 1280 : 720), 'avc1 in the shape asked for');
    check(Math.abs(info.seconds - 10) < 0.05, `10 s (${info.seconds?.toFixed(3)})`);
    check(info.keyTimes[0] === 0 && info.keyTimes.some((k) => Math.abs(k - 2) < 0.04) && info.keyTimes.some((k) => Math.abs(k - 9) < 0.04), 'key frames at 0, at the After (2 s) and at the mark (9 s)');
    if (KEEP) copyFileSync(fileP, join(KEEP, `clip-ba-sample-${ja ? 'ja' : 'en'}${TALL ? '-tall' : ''}.mp4`));
    // 5. The sound (stage 3): a track as long as the clip, quiet over the Before, the tone over the After.
    const pr = spawnSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', fileP], { encoding: 'utf8' });
    if (pr.status === 0 && toned === 'running') {
      const a = JSON.parse(pr.stdout).streams.find((x) => x.codec_type === 'audio');
      check(a?.codec_name === 'aac' && Math.abs(Number(a.duration) - 10) < 0.15, `a sound track, AAC, ${a?.duration} s`);
      if (a) {
        const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', fileP, '-vn', '-af', 'pan=mono|c0=c0', '-ar', '48000', '-f', 'f32le', '-'], { maxBuffer: 64 << 20 });
        const x = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);
        // Goertzel: how loud 440 Hz is over [from, to) seconds (≈ the sine's amplitude).
        const level = (from, to) => {
          const seg = x.subarray(Math.round(from * 48000), Math.round(to * 48000));
          const w = (2 * Math.PI * 440) / 48000, c = 2 * Math.cos(w);
          let s1 = 0, s2 = 0;
          for (let k = 0; k < seg.length; k++) { const s0 = seg[k] + c * s1 - s2; s2 = s1; s1 = s0; }
          return (2 * Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - c * s1 * s2))) / Math.max(1, seg.length);
        };
        const before = level(0.1, 1.8), after = level(2.4, 8.8);
        console.log(`  440 Hz: Before ${before.toFixed(3)} · After ${after.toFixed(3)} (0.30 made)`);
        check(before < 0.02, `the Before is silent (${before.toFixed(3)}): the still frame has no sound`);
        check(after > 0.15 && after < 0.42, `the After has the game's sound, once (${after.toFixed(3)})`);
      }
    } else console.log(`  · the sound not read back (ffprobe ${pr.status === 0 ? 'here' : 'missing'}, the tone ${toned})`);
    // Its frames, read back by ffmpeg (when this machine has it).
    const ff = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' });
    if (ff.status === 0) {
      const tmp = mkdtempSync(join(tmpdir(), 'studio-clip-ba-frames-'));
      const grab = (at, name) => {
        const out = join(tmp, `${name}.png`);
        execFileSync('ffmpeg', ['-v', 'error', '-ss', String(at), '-i', fileP, '-frames:v', '1', '-y', out]);
        if (SHOTS) copyFileSync(out, join(SHOTS, `clip-ba-${ja ? 'ja' : 'en'}${TALL ? '-tall' : ''}-frame-${name}.png`));
        // …and the same frame small and grey, raw (to compare pictures: two encodes of one still picture differ by a
        // little noise, so their PNG bytes are never equal).
        return execFileSync('ffmpeg', ['-v', 'error', '-ss', String(at), '-i', fileP, '-frames:v', '1', '-vf', 'scale=64:36,format=gray', '-f', 'rawvideo', '-']);
      };
      const diff = (x, y) => x.reduce((acc, v, k) => acc + Math.abs(v - y[k]), 0) / x.length;
      const a = grab(0.3, '0.3s-before');
      const b = grab(1.7, '1.7s-before');
      grab(2.1, '2.1s-wipe');
      const c = grab(5, '5s-after');
      grab(9.5, '9.5s-mark');
      const still = diff(a, b), moved = diff(a, c);
      check(still < 2, `the Before is held still (0.3 s against 1.7 s: ${still.toFixed(2)} of 255 a pixel)`);
      check(moved > still * 2 && moved > 2, `the After is another picture (${moved.toFixed(2)})`);
      rmSync(tmp, { recursive: true, force: true });
    } else console.log('  · no ffmpeg here: the frames were not read back');
  } finally {
    await agent.stop();
    await page.close().catch(() => {});
    await browser.close();
    await srv.close();
    rmSync(root, { recursive: true, force: true });
    rmSync(clips, { recursive: true, force: true });
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
