// Big Swell on the sample shelf (stage 1 and 2, decided 2026-11-06) in a headless browser, in two parts:
//
//   node test/studio-shelf-swell.browser.mjs --part game   [--shots <dir>]
//   node test/studio-shelf-swell.browser.mjs [--part editor] [--lang en|ja] [--shots <dir>] [--keep <dir>]
//
// --part game: starters/big-swell alone (no editor), from a small static server:
//   1. PC 1280×720: frames per second, the quality it settles on, no errors in the console;
//   2. a phone (390×844, touch, the CPU 4× and 20× slower): below ~45 fps it drops to pixel ratio 1 (setQuality, as
//      Lantern Cove); at 20× it must;
//   3. --shots: thumb.png's picture (640×400 at the big swell, 8.5 s, ?fixed=30 so it is the same frame every time).
// --part editor (the default): the sample's "Try" (starter.json `try`) in the real local server and the built editor,
//   with the stand-in AI (test/ai-feel/fake-agent.mjs, shelfFix):
//   1. the thing to move (`try.move`) is among the editor's objects;
//   2. ▶ Play until the game's clock reaches `try.pauseAt`, P, ◎ a mark, `try.ask` in the screen's language + Enter:
//      the stand-in changes WAVE_HEIGHT 1.0 → 2.0; the reply has Before / After;
//   3. Before / After: the After is shown, then "● Clip Before / After" (not before);
//   4. pressed: a 10 s MP4 named big-swell-…-before-after-1.mp4, 1280×720, key frames at 0, 2 and 9 s; the Before held
//      still and the After another picture (read back with ffmpeg when there). --keep: the MP4 as
//      shelf-swell-<lang>.mp4. The post says "marked a spot" (ja: clip.post.baMarked) only when the ask had a mark.
//   --no-mark: the same without ◎ (decided 2026-11-06: an unmarked ask's post must not say it marked a spot).
// Smooth clips: STUDIO_ANGLE=metal (the GPU; test/adapters-2d/cdp.mjs).
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStudioServer } from '../src/server/server.mjs';
import { copyStarter, readStarters } from '../src/server/starters.mjs';
import { launch, newPage } from './adapters-2d/cdp.mjs';
import { startFakeAgent, shelfFix } from './ai-feel/fake-agent.mjs';
import { translate } from '../src/shell/i18n.ts';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const UI = join(PKG, 'skills/arrange/bin/studio-ui');
const GAME = join(PKG, 'starters/big-swell');
const TRY = JSON.parse(readFileSync(join(GAME, 'starter.json'), 'utf8')).try;
// The Try's words in other languages are in strings.json (the package keeps non-English text in translation files).
const TRY_WORDS = { en: TRY.ask.en, ...Object.fromEntries(Object.entries(JSON.parse(readFileSync(join(GAME, 'strings.json'), 'utf8'))).map(([l, v]) => [l, v.try?.ask])) };
const args = process.argv.slice(2);
const take = (flag, d = null) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : d;
};
const PART = take('--part', 'editor');
const SHOTS = take('--shots') ? resolve(take('--shots')) : null;
const KEEP = take('--keep') ? resolve(take('--keep')) : null;
const LANG = take('--lang', 'en');
const ja = LANG === 'ja';
const MARK = !args.includes('--no-mark');
// The editor's words in the screen's language, from the editor's own strings (so a reworded label never breaks this).
const T = (key) => translate(LANG, key);
const head = (key) => T(key).split(/[{·]/)[0].trim(); // the words before the first value or dot
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
      if (['moov', 'trak', 'mdia', 'minf', 'stbl'].includes(ty)) walk(body, at + size, depth + 1);
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

/** The game alone: a static server over starters/big-swell. */
async function gamePart() {
  const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png' };
  const srv = createServer((req, res) => {
    const p = join(GAME, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    const f = existsSync(p) && statSync(p).isDirectory() ? join(p, 'index.html') : p;
    if (!f.startsWith(GAME) || !existsSync(f)) return res.writeHead(404).end();
    res.writeHead(200, { 'Content-Type': TYPES[extname(f)] || 'application/octet-stream' }).end(readFileSync(f));
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${srv.address().port}/`;
  const browser = await launch();
  const SW = 'window.__swell';
  try {
    // 1. PC.
    console.log('game alone: PC 1280×720');
    let page = await newPage(browser, { width: 1280, height: 720 });
    await page.goto(url);
    await page.waitFor(`!!${SW} && ${SW}.frames > 130`, 60000);
    const pc = JSON.parse(await page.eval(`JSON.stringify({ fps: ${SW}.fps(), q: ${SW}.quality, r: ${SW}.pixelRatio })`));
    console.log(`  ${pc.fps.toFixed(0)} fps, quality ${pc.q}, pixel ratio ${pc.r}`);
    check(pc.q !== 'auto', 'the quality was decided in the first frames');
    const bad = page.logs.filter((l) => /^(error|exception)/.test(l));
    check(!bad.length, `no errors in the console${bad.length ? `: ${bad.join(' | ')}` : ''}`);
    await page.close();
    // 2. A phone, the CPU 4× slower (a mid phone is about that much slower than this machine's CPU), then 20× slower
    // (an old phone: it must fall below 45 fps and drop to pixel ratio 1).
    for (const rate of [4, 20]) {
      console.log(`game alone: phone 390×844 (touch, pixel ratio 2, CPU ${rate}× slower)`);
      page = await newPage(browser, { width: 390, height: 844, mobile: true });
      await page.send('Emulation.setCPUThrottlingRate', { rate });
      await page.goto(url);
      await page.waitFor(`!!${SW} && ${SW}.quality !== 'auto'`, 180000);
      await sleep(1000);
      const ph = JSON.parse(await page.eval(`JSON.stringify({ fps: ${SW}.fps(), q: ${SW}.quality, r: ${SW}.pixelRatio, dpr: devicePixelRatio })`));
      console.log(`  ${ph.fps.toFixed(0)} fps, quality ${ph.q}, pixel ratio ${ph.r} (screen ${ph.dpr})`);
      check(ph.q === 'low' ? ph.r === 1 : ph.r === Math.min(ph.dpr, 2), `pixel ratio follows the quality (${ph.q} → ${ph.r})`);
      if (rate === 20) check(ph.q === 'low', `an old phone drops to pixel ratio 1 (${ph.q})`);
      const badP = page.logs.filter((l) => /^(error|exception)/.test(l));
      check(!badP.length, `no errors on the phone${badP.length ? `: ${badP.join(' | ')}` : ''}`);
      await page.close();
    }
    // 3. thumb.png's picture: 640×400 at the big swell (8.5 s), every frame exactly 1/30 s.
    if (SHOTS) {
      page = await newPage(browser, { width: 640, height: 400 });
      await page.goto(`${url}?fixed=30&quality=high`);
      await page.waitFor(`!!${SW} && ${SW}.t >= 8.5`, 120000);
      // ?fixed advances 1/30 s a frame, so the picture is the same swell every time (a frame or two either way).
      const f = join(SHOTS, 'big-swell-thumb-640x400.png');
      writeFileSync(f, await page.screenshot());
      console.log(`  shot ${f} (t ${(await page.eval(`${SW}.t`)).toFixed(2)} s)`);
      await page.close();
    }
  } finally {
    await browser.close();
    srv.close();
  }
}

async function editorPart() {
  console.log(`the Try on Big Swell (${LANG}): ▶ → ${TRY.pauseAt} s → P → “${TRY_WORDS[LANG]}” → Before / After → ● Clip, PC 1280×800`);
  const root = mkdtempSync(join(tmpdir(), 'studio-shelf-swell-'));
  const clips = mkdtempSync(join(tmpdir(), 'studio-shelf-swell-movies-'));
  // The folder as `--starter big-swell` fills it (the game's files only).
  const [swell] = (await readStarters(join(PKG, 'starters'))).filter((s) => s.id === 'big-swell');
  await copyStarter(swell, root);
  mkdirSync(join(root, '.studio/ui'), { recursive: true });
  writeFileSync(join(root, '.studio/ui/prefs.json'), JSON.stringify({ version: 1, lang: LANG }));
  const srv = await startStudioServer({ root, uiDir: UI, log: () => {}, env: { CLAUDECODE: '1' }, clips: { dir: clips, where: 'movies', reveal: 'finder', run: () => {} } });
  const agent = startFakeAgent(root, { fix: shelfFix });
  const browser = await launch();
  const page = await newPage(browser, { width: 1280, height: 800 });
  let n = 0;
  const shot = async (what) => {
    if (!SHOTS) return;
    const f = `shelf-swell-${LANG}-${String(++n).padStart(2, '0')}-${what}.png`;
    writeFileSync(join(SHOTS, f), await page.screenshot());
    console.log(`  shot ${f}`);
  };
  try {
    await page.goto(srv.url);
    await page.waitFor(`document.querySelectorAll('.obj').length > 0 && !!${GW}?.__gameStudio?._debug`, 90000);
    await sleep(1000);
    // 1. The thing to move is one of the editor's objects.
    const keys = await j(page, `JSON.stringify(${M}.list().map((i) => i.key))`);
    check(keys.some((k) => k === TRY.move || k.startsWith(`${TRY.move}-`) || k.startsWith(`${TRY.move}#`)), `"${TRY.move}" is in the editor (${keys.join(', ')})`);
    await shot('edit');
    // 2. Play to the second the Try names (the game's own clock), pause, a mark, ask.
    await page.eval(`document.querySelector('button.play').click()`);
    await page.waitFor(IN.playing, 30000);
    await until(async () => (await page.eval(`${GW}.__swell?.t ?? 0`).catch(() => 0)) >= TRY.pauseAt, 120000, `the game at ${TRY.pauseAt} s`);
    await page.click(640, 120);
    await keyIn(page, 'p', 'KeyP', 'p');
    await page.waitFor(IN.moment, 10000);
    const at = await page.eval(`${GW}.__swell?.t ?? 0`).catch(() => 0);
    check(at >= TRY.pauseAt && at < TRY.pauseAt + 1.5, `paused at ${at.toFixed(2)} s (the Try's ${TRY.pauseAt} s)`);
    await sleep(500);
    await page.eval(`(document.activeElement?.blur?.(), true)`);
    if (MARK) {
      const mk = await j(page, box('[data-action=moment-mark]'));
      await page.click(mk.x, mk.y);
      await sleep(200);
      const fr = await j(page, IN.frame);
      await page.click(fr[0] + fr[2] * 0.5, fr[1] + fr[3] * 0.4);
      await sleep(400);
    }
    await page.eval(`(document.querySelector('.ask-input').focus(), true)`);
    await page.send('Input.insertText', { text: TRY_WORDS[LANG] });
    await shot('ask');
    await keyIn(page, 'Enter', 'Enter', '\r');
    await until(async () => (await replyButtons(page)).includes('moment-compare'), 60000, 'the reply with Before / After');
    check(true, `the reply: ${(await replyButtons(page)).join(' · ')}`);
    check(/const WAVE_HEIGHT = 2\.0;/.test(readFileSync(join(root, 'game.js'), 'utf8')), 'the stand-in made the waves twice as tall (WAVE_HEIGHT 2.0)');
    // 3. Before / After.
    const cmp = await j(page, box('[data-action=moment-compare]'));
    await page.click(cmp.x, cmp.y);
    await page.waitFor(`!!document.querySelector('[data-part=moment-compare]:not([hidden]) [data-part=compare-before] img')`, 5000);
    const early = await page.eval(`!!document.querySelector('[data-part=moment-compare]:not([hidden]) [data-action=compare-clip]')`);
    // The Try plays again up to the ask's second (slow in software GL). Seen 2026-11-05 on Neon Run
    // (test/studio-clip-ba.browser.mjs): the Try held at the second but the panel had closed — then Before / After is
    // pressed again, as a person would (said in the log).
    const AFTER = `!!document.querySelector('[data-part=moment-compare]:not([hidden]) [data-part=compare-after] img')`;
    const held = [head('try.opened'), head('try.sameRun')].filter(Boolean); // "New code · same moment" / "New code, played…"
    const panelOpen = () => page.eval(`!!document.querySelector('[data-part=moment-compare]:not([hidden])')`);
    const flash = () => page.eval(`document.querySelector('[data-part=play-flash]:not([hidden])')?.textContent || ''`);
    const tryHeld = async () => (await page.eval(IN.moment)) && !(await panelOpen()) && (await flash().then((f) => held.some((w) => f.includes(w))));
    await until(async () => (await page.eval(AFTER)) || (await tryHeld()), 240000, 'the After or the Try held')
      .catch(() => null);
    if (!(await page.eval(AFTER)) && !(await panelOpen())) {
      console.log('  · the panel closed at the Try\'s pause: Before / After pressed again');
      const again = await j(page, box('[data-action=moment-compare]'));
      if (again) await page.click(again.x, again.y);
    }
    await page.waitFor(AFTER, 60000).catch(async (e) => {
      if (SHOTS) writeFileSync(join(SHOTS, `shelf-swell-${LANG}-timeout.png`), await page.screenshot());
      throw new Error(`${e.message} ${await page.eval(`JSON.stringify({ shell: { ...${SHELL}.dataset }, flash: document.querySelector('[data-part=play-flash]')?.textContent, line: document.querySelector('.ai-line')?.textContent })`)}`);
    });
    const clipBtn = await until(() => j(page, box('[data-part=moment-compare]:not([hidden]) [data-action=compare-clip]')), 10000, 'the clip button');
    check(!early, 'no clip button before the After was there');
    check(clipBtn.text.includes(T('clip.ba')), `the panel's "${clipBtn.text}"`);
    await shot('before-after');
    // 4. ● Clip.
    const t0 = Date.now();
    await page.click(clipBtn.x, clipBtn.y);
    await until(async () => (await page.eval(`${SHELL}.dataset.clip || ''`)) === 'rec', 30000, 'recording');
    await sleep(1500);
    await shot('recording');
    const line = await until(() => j(page, `JSON.stringify((() => { const l = document.querySelector('[data-part=clip-line]'); return l && !l.hidden ? { text: l.innerText.replace(/\\s+/g, ' ').trim(),
      post: l.querySelector('[data-part=clip-post]')?.textContent || '', where: l.querySelector('.clip-where')?.textContent || '' } : null; })())`), 90000, 'the line');
    console.log(`  saved ${Date.now() - t0} ms after the press; line: ${line.text}`);
    const files = readdirSync(clips);
    check(files.length === 1 && /^big-swell.*before-after-1\.mp4$/.test(files[0]), `the file's name (${files.join(', ')})`);
    check(line.where.includes(translate(LANG, 'clip.where', { s: 10, shape: T('clip.shape.wide') })), `10 s, wide (${line.where})`);
    console.log(`  the post: ${line.post}`);
    // "marked a spot" only when the ask had a mark (decided 2026-11-06: seen in a post of an ask without one).
    const said = line.post.includes(T('clip.post.baMarked').replace(/^[,、\s]+|[,、\s]+$/g, ''));
    check(said === MARK, MARK ? 'the post says the spot was marked' : 'the post does not say a spot was marked (no ◎)');
    await shot('saved');
    const fileP = join(clips, files[0]);
    const info = mp4Info(readFileSync(fileP));
    console.log(`  mp4: ${info.width}×${info.height}, ${info.samples} frames, ${info.seconds?.toFixed(3)} s, key frames at ${info.keyTimes.join(', ')} s`);
    check(info.codec === 'avc1' && info.width === 1280 && info.height === 720, 'avc1, 1280×720');
    check(Math.abs(info.seconds - 10) < 0.05, `10 s (${info.seconds?.toFixed(3)})`);
    check(info.keyTimes[0] === 0 && info.keyTimes.some((k) => Math.abs(k - 2) < 0.04) && info.keyTimes.some((k) => Math.abs(k - 9) < 0.04), 'key frames at 0, at the After (2 s) and at the mark (9 s)');
    if (KEEP) copyFileSync(fileP, join(KEEP, `shelf-swell-${LANG}.mp4`));
    if (spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' }).status === 0) {
      // Small and grey, raw: two encodes of one still picture differ by a little noise, so PNG bytes are never equal.
      const grab = (s) => execFileSync('ffmpeg', ['-v', 'error', '-ss', String(s), '-i', fileP, '-frames:v', '1', '-vf', 'scale=64:36,format=gray', '-f', 'rawvideo', '-']);
      const diff = (x, y) => x.reduce((acc, v, k) => acc + Math.abs(v - y[k]), 0) / x.length;
      const a = grab(0.3), b = grab(1.7), c = grab(5);
      const still = diff(a, b), moved = diff(a, c);
      check(still < 2, `the Before is held still (0.3 s against 1.7 s: ${still.toFixed(2)} of 255 a pixel)`);
      check(moved > still * 2 && moved > 2, `the After is another picture (${moved.toFixed(2)})`);
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
  await (PART === 'game' ? gamePart() : editorPart());
} catch (e) {
  console.error(e);
  failed++;
}
console.log(failed ? `✗ ${failed} check(s) failed` : '✓ all checks passed');
process.exit(failed ? 1 : 0);
