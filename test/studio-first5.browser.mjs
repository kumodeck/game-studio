// The first 5 minutes, in a headless browser, from an empty folder to Save:
//
//   node test/studio-first5.browser.mjs [--real | --starters-dir <dir>] [--shots <dir>] [--video <file.mp4>] [--lang en|ja]
//
// 1. An empty folder: the real CLI (skills/arrange/bin/studio.mjs) says "no-game" (exit 4) and
//    what to ask; run again with --starter 3d it copies the sample in and prints "ready".
// 2. The editor opens on the sample, with no first-run tips (the four-step intro, "1/4 Click an
//    object…", was removed on 2026-10-17: the editor opens on the game alone).
// 3. Pick → drag → ask → Save, with no tips at any step; placement.json is written.
// 4. Phone (390): no tips either.
//
// Fake starters (test/first-run/starters) by default; --real uses the plugin's own starters/
// (or the three-crates / pixi-garden fallback while there are none). --video records the PC run
// (a picture of the real terminal lines first, then the editor) with Chrome's screencast and
// turns the frames into an mp4 with ffmpeg (no new packages). --shots writes PNGs of each step.
// Uses the zero-dependency CDP client (adapters-2d/cdp.mjs). Exit code 1 on the first failure.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, newPage } from './adapters-2d/cdp.mjs';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(PKG, 'skills/arrange/bin/studio.mjs');
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const REAL = args.includes('--real');
const SHOTS = opt('--shots') ? resolve(opt('--shots')) : null;
const VIDEO = opt('--video') ? resolve(opt('--video')) : null;
const LANG = opt('--lang') || 'en';
// --starters-dir <dir>: shoot with starters from elsewhere (e.g. the starters' branch before it is merged).
const STARTERS = opt('--starters-dir') ? ['--starters-dir', resolve(opt('--starters-dir'))] : REAL ? [] : ['--starters-dir', join(PKG, 'test/first-run/starters')];
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const step = (s) => console.log(`  ✓ ${s}`);

const IN = {
  ready: `document.querySelectorAll('.obj').length > 0 && !!document.querySelector('iframe').contentWindow.__gameStudio?._debug`,
  list: `JSON.stringify(document.querySelector('iframe').contentWindow.__gameStudio._debug.list())`,
  anchor: (key) => `(() => { const f = document.querySelector('iframe'); const r = f.getBoundingClientRect();
    const a = f.contentWindow.__gameStudio._debug.anchor(${JSON.stringify(key)}); if (!a) return null;
    return JSON.stringify({ x: r.left + a.center[0], y: r.top + a.center[1], size: a.size }); })()`,
  // The removed first-run tips: their plate must not be on screen.
  tips: `[...document.querySelectorAll('.first-hint, [data-part=intro]')].some((e) => !e.hidden && !!e.offsetParent)`,
  rect: (sel) => `(() => { const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find(e => e.offsetParent); if (!el) return null;
    const q = el.getBoundingClientRect(); return JSON.stringify({ x: q.left + q.width / 2, y: q.top + q.height / 2 }); })()`,
};
const j = async (page, expr) => JSON.parse((await page.eval(expr)) || 'null');

/** Run the CLI in the background until its "ready" line. Returns { lines, url, stop }. */
async function startCli(cliArgs) {
  const child = spawn(process.execPath, [CLI, ...cliArgs, '--no-open'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  child.stderr.on('data', (d) => (err += d));
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`no ready line\n${out}\n${err}`)), 20000);
    child.stdout.on('data', (d) => {
      out += d;
      if (/studio: ready \S+\n/.test(out)) {
        clearTimeout(t);
        res();
      }
    });
    child.on('exit', (c) => rej(new Error(`studio.mjs exited ${c}\n${out}\n${err}`)));
  });
  const lines = out.trim().split('\n');
  const url = lines.find((l) => l.startsWith('studio: ready ')).slice('studio: ready '.length) + `&lang=${LANG}`;
  return { lines, url, stop: () => new Promise((r) => { child.once('exit', r); child.kill('SIGTERM'); }) };
}

// ---- video: Chrome's screencast frames → ffmpeg (concat with each frame's real duration) ----
function recorder(browser, page) {
  const frames = [];
  let on = false;
  browser.on((m) => {
    if (m.method !== 'Page.screencastFrame') return;
    page.send('Page.screencastFrameAck', { sessionId: m.params.sessionId }).catch(() => {});
    if (on) frames.push({ t: m.params.metadata.timestamp, data: m.params.data });
  });
  return {
    async start() {
      on = true;
      await page.send('Page.startScreencast', { format: 'jpeg', quality: 85, maxWidth: 1280, maxHeight: 800, everyNthFrame: 1 });
    },
    async stop() {
      await sleep(600);
      await page.send('Page.stopScreencast').catch(() => {});
      on = false;
      return frames;
    },
  };
}

function writeVideo(frames, file) {
  assert.ok(frames.length > 10, `only ${frames.length} video frames`);
  const dir = mkdtempSync(join(tmpdir(), 'studio-first5-frames-'));
  const list = [];
  frames.forEach((f, i) => {
    const name = `f${String(i).padStart(5, '0')}.jpg`;
    writeFileSync(join(dir, name), Buffer.from(f.data, 'base64'));
    // A frame lasts until the next one (Chrome only sends a frame when the page changes).
    const dur = i + 1 < frames.length ? Math.max(0.001, frames[i + 1].t - f.t) : 1.5;
    list.push(`file '${name}'`, `duration ${dur.toFixed(3)}`);
  });
  list.push(`file 'f${String(frames.length - 1).padStart(5, '0')}.jpg'`);
  writeFileSync(join(dir, 'list.txt'), list.join('\n') + '\n');
  mkdirSync(dirname(file), { recursive: true });
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', 'list.txt',
    '-vf', 'scale=1280:800:force_original_aspect_ratio=decrease,pad=1280:800:(ow-iw)/2:(oh-ih)/2,fps=30,format=yuv420p',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-movflags', '+faststart', file], { cwd: dir, encoding: 'utf8' });
  assert.equal(r.status, 0, `ffmpeg: ${r.stderr}`);
  rmSync(dir, { recursive: true, force: true });
}

/**
 * The terminal before the editor, as a picture: the real lines the CLI printed (and what an agent
 * would say). Only for the video and the shots; nothing here is tested.
 */
function terminalPage(folder, noGame, started) {
  // The temporary folder's long path reads as ~/<name>, as it would in a person's terminal.
  const esc = (s) => s.split(folder).join(`~/${basename(folder)}`).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]).replace(/t=[\w-]+/, 't=…');
  const html = `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;height:100vh;display:grid;place-items:center;background:#0e0f12;font:15px/1.6 ui-monospace,Menlo,monospace;color:#c9ccd3}
    .w{width:1080px;border-radius:14px;background:#17181c;box-shadow:0 30px 80px #0008;overflow:hidden}
    .b{height:34px;background:#202126;display:flex;gap:8px;align-items:center;padding:0 14px}.b i{width:12px;height:12px;border-radius:50%;background:#3a3b41}
    pre{margin:0;padding:22px 26px;white-space:pre-wrap}.p{color:#8f95a3}.u{color:#fff}.a{color:#b9a7ff}.o{color:#ffb070}.d{color:#6e7380}</style>
    <div class="w"><div class="b"><i></i><i></i><i></i></div><pre id="t"></pre></div>
    <script>const L=${JSON.stringify([
      ['p', `~/${basename(folder)} $ claude`],
      ['u', '> /arrange'],
      ['d', `  studio.mjs ${basename(folder)}`],
      ['d', '  ' + esc(noGame)],
      ['a', "  There's no game here yet. Want to start from a sample?  [3D]  2D"],
      ['u', '> 3D'],
      ['d', '  ' + esc(started[0])],
      ['d', '  ' + esc(started[1])],
      ['a', '  Opened the editor. Click a thing and drag it; ask me in the box at the bottom; press Save.'],
    ])};let i=0;const t=document.getElementById('t');(function n(){if(i>=L.length)return;const s=document.createElement('span');s.className=L[i][0];s.textContent=L[i][1]+'\\n';t.append(s);i++;setTimeout(n,i===2||i===5?700:380)})();</script>`;
  return 'data:text/html;base64,' + Buffer.from(html).toString('base64');
}

/** A visible pointer for the video (headless screencasts draw none). Only moved by the test. */
const CURSOR = `(() => { if (document.getElementById('__cur')) return; const c = document.createElement('div'); c.id = '__cur';
  c.style.cssText = 'position:fixed;left:0;top:0;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;background:#fff;border:2px solid #111;box-shadow:0 2px 8px #0006;z-index:2147483647;pointer-events:none;transition:transform .08s linear,width .1s,height .1s';
  document.body.append(c); })()`;

async function run() {
  const browser = await launch();
  const results = { folders: [] };
  try {
    // ---------- 1. the empty folder ----------
    const folder = join(mkdtempSync(join(tmpdir(), 'studio-first5-')), 'my-first-game');
    mkdirSync(folder);
    results.folders.push(dirname(folder));
    const probe = spawnSync(process.execPath, [CLI, folder, ...STARTERS], { encoding: 'utf8' });
    assert.equal(probe.status, 4, probe.stderr);
    const noGame = probe.stdout.trim();
    assert.match(noGame, /^studio: no-game .* - ask once "Start from a sample\? 3D or 2D", then run again with --starter 3d \(.+\) or --starter 2d \(.+\)$/);
    assert.deepEqual(readdirSync(folder), []);
    step(`empty folder → exit 4: ${noGame.replace(folder, '<folder>')}`);
    const cli = await startCli([folder, '--starter', '3d', ...STARTERS]);
    assert.match(cli.lines[0], /^studio: started \S+ \(\d+ files\) /);
    assert.ok(existsSync(join(folder, 'index.html')));
    step(`--starter 3d → ${cli.lines[0]}`);

    const page = await newPage(browser, { width: 1280, height: 800 });
    const rec = VIDEO ? recorder(browser, page) : null;
    const shot = async (name) => {
      if (!SHOTS) return;
      await sleep(300);
      writeFileSync(join(SHOTS, `${name}.png`), await page.screenshot());
    };
    // The pointer: real input, plus (video) a dot where it is.
    let cur = { x: 640, y: 400 };
    const moveCursor = async (x, y, ms = 450) => {
      if (!VIDEO) return (cur = { x, y });
      const n = Math.max(1, Math.round(ms / 16));
      const from = cur;
      for (let i = 1; i <= n; i++) {
        const k = i / n;
        const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
        const px = from.x + (x - from.x) * e;
        const py = from.y + (y - from.y) * e;
        await page.eval(`${CURSOR}; document.getElementById('__cur').style.transform = 'translate(${px}px, ${py}px)'`);
        await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: px, y: py });
        await sleep(16);
      }
      cur = { x, y };
    };
    const click = async (x, y) => {
      await moveCursor(x, y);
      if (VIDEO) await sleep(150);
      await page.click(x, y);
      if (VIDEO) await sleep(250);
    };
    const drag = async (x0, y0, x1, y1) => {
      await moveCursor(x0, y0);
      await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y: y0, button: 'left', buttons: 1, clickCount: 1 });
      const n = VIDEO ? 40 : 10;
      for (let i = 1; i <= n; i++) {
        const x = x0 + ((x1 - x0) * i) / n;
        const y = y0 + ((y1 - y0) * i) / n;
        if (VIDEO) await page.eval(`document.getElementById('__cur').style.transform = 'translate(${x}px, ${y}px)'`);
        await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1 });
        if (VIDEO) await sleep(18);
      }
      await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x1, y: y1, button: 'left', buttons: 0, clickCount: 1 });
      cur = { x: x1, y: y1 };
    };

    if (rec) await rec.start();
    if (VIDEO || SHOTS) {
      await page.goto(terminalPage(folder, noGame, cli.lines));
      await sleep(4800);
      await shot('0-terminal');
    }

    // ---------- 2. the editor on the sample, no tips ----------
    await page.goto(cli.url);
    await page.waitFor(IN.ready, 40000);
    await sleep(1500);
    assert.equal(await page.eval(IN.tips), false, 'first-run tips on open');
    step('editor open, no first-run tips');
    if (VIDEO) await sleep(1500);
    await shot('1-open');

    // ---------- 3. pick → drag → ask → Save ----------
    const items = JSON.parse(await page.eval(IN.list));
    let target = null;
    for (const it of items) {
      if (/ground|floor|water|sea|sky/i.test(it.label) || it.movable === false) continue;
      const a = await j(page, IN.anchor(it.key));
      if (a && a.size > 12 && a.x > 300 && a.x < 1180 && a.y > 120 && a.y < 640) {
        target = { ...it, a };
        break;
      }
    }
    assert.ok(target, `no object to pick in ${items.map((i) => i.label).join(', ')}`);
    await click(target.a.x, target.a.y);
    await page.waitFor(`document.querySelector('.card strong')?.textContent`, 5000);
    assert.equal(await page.eval(IN.tips), false, 'first-run tips after the pick');
    step(`picked "${await page.eval(`document.querySelector('.card strong').textContent`)}"`);
    await shot('2-picked');

    const a = await j(page, IN.anchor(target.key));
    await drag(a.x, a.y, a.x + 140, a.y + 40);
    await page.waitFor(`/\\d/.test([...document.querySelectorAll('[data-action=save]')].find(b => b.offsetParent)?.textContent || '')`, 5000);
    assert.equal(await page.eval(IN.tips), false, 'first-run tips after the drag');
    step('dragged → Save shows 1 unsaved');
    if (VIDEO) await sleep(900);
    await shot('3-moved');

    const input = await j(page, IN.rect('.ask-input'));
    await click(input.x, input.y);
    const words = LANG === 'ja' ? 'これをあと 3 つ並べて' : 'add 3 more like this';
    if (VIDEO) {
      // Typed one key at a time, so the video reads like a person typing.
      for (const ch of words) {
        await page.send('Input.insertText', { text: ch });
        await sleep(55);
      }
      await sleep(400);
    } else {
      await page.send('Input.insertText', { text: words });
    }
    // The send button (the ⌘K list may be open while typing; the button asks the AI either way).
    const send = await j(page, IN.rect('[data-action=ask-ai]'));
    await click(send.x, send.y);
    for (let i = 0; i < 50 && !(existsSync(join(folder, '.studio/requests')) && readdirSync(join(folder, '.studio/requests')).some((f) => f.endsWith('.json'))); i++) await sleep(100);
    const reqs = readdirSync(join(folder, '.studio/requests')).filter((f) => f.endsWith('.json'));
    assert.equal(reqs.length, 1);
    assert.equal(await page.eval(IN.tips), false, 'first-run tips after the ask');
    step(`asked "${words}" → request kept`);
    if (VIDEO) await sleep(1200);
    await shot('4-asked');

    const save = await j(page, IN.rect('[data-action=save]'));
    await click(save.x, save.y);
    for (let i = 0; i < 30 && !existsSync(join(folder, 'placement.json')); i++) await sleep(100);
    assert.ok(existsSync(join(folder, 'placement.json')), 'placement.json written');
    assert.equal(await page.eval(IN.tips), false, 'first-run tips after Save');
    step('Save → placement.json written');
    if (VIDEO) await sleep(1500);
    await shot('5-saved');
    if (rec) {
      writeVideo(await rec.stop(), VIDEO);
      step(`video ${VIDEO}`);
    }
    await cli.stop();
    await page.close();

    // ---------- 4. the phone: no tips either ----------
    const folder2 = mkdtempSync(join(tmpdir(), 'studio-first5-phone-'));
    results.folders.push(folder2);
    const cli2 = await startCli([folder2, '--starter', '3d', ...STARTERS]);
    const p2 = await newPage(browser, { width: 390, height: 844, mobile: true });
    await p2.goto(cli2.url);
    await p2.waitFor(IN.ready, 40000);
    await sleep(1500);
    assert.equal(await p2.eval(IN.tips), false, 'first-run tips on the phone');
    step('phone: no first-run tips');
    if (SHOTS) writeFileSync(join(SHOTS, '6-phone-open.png'), await p2.screenshot());
    await cli2.stop();
  } finally {
    await browser.close();
    for (const f of results.folders) rmSync(f, { recursive: true, force: true });
  }
}

run().then(
  () => console.log('studio-first5: ok'),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
