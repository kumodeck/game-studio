#!/usr/bin/env node
// Ask your AI while playing, with a REAL AI (CONTRACT.md §3.5, 2026-10-20). One run:
//
//   node test/playtest/realplay.mjs --out <dir> [--model claude-opus-5-5] [--max-min 20] [--game <folder>]
//
// 1. Claude Code (this checkout's plugin, `claude -p`) makes a small three.js game in an empty folder with ONE bug on
//    purpose (somewhere on the map the character vanishes) and says, in its last message only, where it is. It also
//    exposes the character as `window.__player` so this script can walk it there with real key presses.
//    (--game <folder>: skip this and use that game; its bug is in <folder>/../bug.json.)
// 2. A NEW Claude Code session (it does not know the bug) is told the editor is open and to wait for requests.
//    The editor starts here (`studio.mjs --detach --no-open`; its link with the pass is read from the log and never
//    printed).
// 3. A headless Chrome opens the editor, presses ▶ Play, walks the character to the place with WASD and stops there:
//    it vanishes. Then ` , the words, Enter. The game keeps running. Pictures every ~1.5 s and a video (screencast).
// 4. The AI handles the `play` request (picture + log + where the player was) and fixes the code; the line over the
//    game says what it is doing; the game is NOT reloaded under the player. When Reload shows: ` then Enter, walk to
//    the same place again, stop: the character must still be there.
// Writes <out>/report.md (timeline, the AI's words, costs), <out>/shots/*.jpg, <out>/play-ask.mp4, <out>/game/ (the
// game as the AI left it) and <out>/request.json + the picture the AI got. It records; it never fixes anything.
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChrome, launch, newPage } from '../adapters-2d/cdp.mjs';
import { agentEnv, claudeAgent, fakeOpener } from './agents.mjs';
import { shooter, startVideo } from './recorder.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(here, '../..');
const CLI = join(PKG, 'skills/arrange/bin/studio.mjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const a = process.argv.slice(2);
const arg = (f, d) => {
  const i = a.indexOf(f);
  return i >= 0 ? a[i + 1] : d;
};
const OUT = resolve(arg('--out', join(tmpdir(), `realplay-${Date.now()}`)));
const MODEL = arg('--model', 'claude-opus-5-5');
const MAX_MIN = Number(arg('--max-min', '20'));
const GAME = arg('--game', null);
const WORDS = arg('--words', 'When I stop here, my character disappears');
// --make-only: step 1 alone (no browser), the game to <out>/game-made and its bug to <out>/bug.json; then run again with
// --game <out>/game-made inside the one-at-a-time browser lock (the browser part stays under its 15 minutes).
const MAKE_ONLY = a.includes('--make-only');
/** The editor's link carries a one-time pass (t=…): never in a report, a transcript or a log line. */
const scrub = (s) => String(s).replace(/([?&]t=)[^\s&)"'`<>]+/g, '$1…');
mkdirSync(join(OUT, 'shots'), { recursive: true });
const work = mkdtempSync(join(tmpdir(), 'studio-realplay-'));
const T0 = Date.now();
const t = () => +((Date.now() - T0) / 1000).toFixed(1);
const timeline = [];
const note = (what) => {
  timeline.push({ s: t(), what });
  console.log(`[${t()}s] ${scrub(what)}`);
};

// macOS: the same headless Chrome on the GPU (Metal) instead of SwiftShader, so the game runs at speed.
function gpuChrome(dir) {
  const bin = findChrome();
  if (!bin || process.platform !== 'darwin') return null;
  const f = join(dir, 'chrome-gpu.sh');
  writeFileSync(f, `#!/bin/bash\nargs=()\nfor a in "$@"; do case "$a" in --use-angle=swiftshader|--enable-unsafe-swiftshader) ;; *) args+=("$a");; esac; done\nexec '${bin}' "\${args[@]}" --use-angle=metal\n`, { mode: 0o755 });
  return f;
}
const gpu = gpuChrome(work);
if (gpu) process.env.STUDIO_CHROME = gpu;

const folder = join(work, 'game');
mkdirSync(folder, { recursive: true });
const opened = join(work, 'opened.log');
const env = agentEnv(fakeOpener(join(work, 'bin'), opened));
const transcripts = {};

/** 1. The game, made by the AI, with its bug. */
async function makeGame() {
  if (GAME) {
    cpSync(resolve(GAME), folder, { recursive: true });
    return JSON.parse(readFileSync(join(resolve(GAME), '..', 'bug.json'), 'utf8'));
  }
  const A = claudeAgent({ cwd: folder, env, pluginDir: PKG, permissionMode: 'auto', model: MODEL });
  transcripts.maker = A.st.log;
  A.say(`Make a small 3D game with three.js in this folder (index.html + game.js; three from a CDN with an import map,
no build step). A character the player walks with WASD or the arrow keys on a ground with a few named things (give each
object3D a .name: crates, a tree or two, a glowing platform, a bridge — whatever fits), the camera following from
behind and above. Expose the character as window.__player (the Object3D the keys move) so a test can find it.
Put exactly ONE bug in it on purpose, of this kind: in one place on the map, when the player stops there (no key held),
the character disappears. Make it a plausible mistake a developer could make (not a comment saying "bug"), and have the
game write one console.warn or console.error line around it, as real code often does. Don't run a server or open a
browser. In your last message, and nowhere in the files, write one JSON line like
{"x": 6, "z": -4, "radius": 1.5, "how": "stop on the platform for a second"} with the place (world x / z of the
middle of the place, how close counts) and how to trigger it.`);
  await A.st.waitIdle(12 * 60000, 3000);
  await A.stop();
  const m = /\{[^{}]*"x"\s*:[^{}]*\}/.exec(A.st.lastTurnText || A.st.lastText || '');
  if (!m) throw new Error(`the maker did not say where the bug is: ${(A.st.lastTurnText || '').slice(0, 400)}`);
  const bug = JSON.parse(m[0]);
  writeFileSync(join(OUT, 'bug.json'), JSON.stringify(bug, null, 2) + '\n');
  note(`game made (${readdirSync(folder).join(', ')}); bug: ${JSON.stringify(bug)}; cost $${A.st.cost?.toFixed?.(2) ?? '?'}`);
  return bug;
}

async function main() {
  note(`out ${OUT}`);
  const bug = await makeGame();
  if (MAKE_ONLY) {
    cpSync(folder, join(OUT, 'game-made'), { recursive: true });
    writeFileSync(join(OUT, 'transcripts.json'), scrub(JSON.stringify(transcripts, null, 1)));
    note(`made: ${join(OUT, 'game-made')}`);
    return;
  }
  cpSync(folder, join(OUT, 'game-before'), { recursive: true, filter: (p) => !p.includes('/.studio') });

  // 2. The editor (no browser of its own), then a fresh AI told to wait for requests from it.
  execFileSync(process.execPath, [CLI, folder, '--detach', '--no-open'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const log = readFileSync(join(folder, '.studio/studio.log'), 'utf8');
  const url = /studio: ready (http\S+)/.exec(log)?.[1];
  if (!url) throw new Error('no studio: ready line in .studio/studio.log');
  note('editor started (link read from .studio/studio.log, not printed)');
  const B = claudeAgent({ cwd: folder, env, pluginDir: PKG, permissionMode: 'auto', model: MODEL });
  transcripts.fixer = B.st.log;
  B.say('/arrange The Game Studio editor is already running for this folder and open in my browser (do not start another one or open a browser). I am going to play the game in it. Wait for my requests from the editor and handle them.');
  await B.st.waitIdle(5 * 60000, 4000);
  note(`AI waiting (its words: ${(B.st.lastTurnText || '').slice(0, 160).replace(/\s+/g, ' ')})`);

  // 3. Play, walk there, stop, ask.
  const browser = await launch();
  const page = await newPage(browser, { width: 1280, height: 800 });
  page.onEvent = (method, fn) => browser.on((m) => { if (m.method === method) fn(m.params); });
  const shots = shooter(page, join(OUT, 'shots'), 'pc');
  await page.goto(url);
  const FR = `document.querySelector('iframe.game:not(.leaving)')`;
  const OV = `${FR}.contentDocument.querySelector('game-studio-play')`;
  await page.waitFor(`!!${FR}?.contentWindow?.__gameStudio`, 90000);
  await sleep(2500);
  const video = await startVideo(page, { maxWidth: 1280, maxHeight: 800, minGapMs: 66 });
  await shots.shot('editor', 'The editor on the game the AI made');
  await page.eval(`document.querySelector('button.play').click()`);
  await page.waitFor(`document.querySelector('.shell').dataset.playing === 'on' && !!${OV}?.shadowRoot?.querySelector('.mark')`, 60000);
  await page.waitFor(`!!${FR}.contentWindow.__player`, 30000);
  note('playing');
  await sleep(1500);
  await shots.shot('playing', 'Play: the game runs; the mark bottom right is "Ask your AI `"');
  await page.click(640, 400);
  const walkTo = async (x, z) => {
    // Real keys, held: W/S along z, A/D along x, until close enough. The camera follows from behind (-z is forward).
    const KEYS = { w: ['w', 'KeyW', 87], a: ['a', 'KeyA', 65], s: ['s', 'KeyS', 83], d: ['d', 'KeyD', 68] };
    const held = new Set();
    const hold = async (k, on) => {
      if (on === held.has(k)) return;
      const [key, code, vk] = KEYS[k];
      await page.send('Input.dispatchKeyEvent', { type: on ? 'keyDown' : 'keyUp', key, code, windowsVirtualKeyCode: vk, ...(on ? { text: key } : {}) });
      if (on) held.add(k);
      else held.delete(k);
    };
    const r = Math.max(0.35, Math.min(0.8, (bug.radius || 1.5) / 3));
    for (let i = 0; i < 600; i++) {
      const p = JSON.parse(await page.eval(`JSON.stringify((() => { const o = ${FR}.contentWindow.__player; o.updateMatrixWorld(true); const e = o.matrixWorld.elements; return [e[12], e[14]]; })())`));
      const dx = x - p[0], dz = z - p[1];
      await hold('d', dx > r);
      await hold('a', dx < -r);
      await hold('s', dz > r);
      await hold('w', dz < -r);
      if (Math.abs(dx) <= r && Math.abs(dz) <= r) break;
      await sleep(40);
    }
    for (const k of [...held]) await hold(k, false);
  };
  const visible = () => page.eval(`(() => { let o = ${FR}.contentWindow.__player; for (; o; o = o.parent) if (!o.visible) return false; return true; })()`);
  await walkTo(bug.x, bug.z);
  note('walked to the place and stopped');
  let gone = false;
  for (let i = 0; i < 40 && !gone; i++) {
    await sleep(150);
    gone = !(await visible());
  }
  // Some bugs hide it by other means (scale 0, far away): the picture still shows it.
  note(gone ? 'the character vanished (visible = false)' : 'the character did not report visible = false (see the pictures)');
  await sleep(800);
  await shots.shot('vanished', 'Stopped there: the character is gone');
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: '`', code: 'Backquote', windowsVirtualKeyCode: 192, text: '`' });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: '`', code: 'Backquote', windowsVirtualKeyCode: 192 });
  await page.waitFor(`!${OV}.shadowRoot.querySelector('.bar').hidden`, 5000);
  for (const ch of WORDS) {
    await page.send('Input.insertText', { text: ch });
    await sleep(45);
  }
  await shots.shot('typing', 'The ` key: one field over the running game');
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  note(`asked: "${WORDS}"`);
  await page.eval(`${FR}.contentWindow.__playMark = 1, true`);

  // 4. Watch the line over the game until Reload shows (or time runs out). A picture every ~1.5 s and on each change.
  const deadline = T0 + MAX_MIN * 60000;
  let last = '';
  let reload = false;
  let k = 0;
  while (Date.now() < deadline && !reload) {
    const o = JSON.parse(await page.eval(`JSON.stringify((() => { const r = ${OV}.shadowRoot; const l = r.querySelector('.line');
      return { line: l.hidden ? '' : l.textContent, reload: !!r.querySelector('[data-action=play-reload]'), choices: [...r.querySelectorAll('.choices button')].map((b) => b.textContent) }; })())`));
    if (o.line !== last) {
      last = o.line;
      note(`line over the game: ${o.line}`);
      await shots.shot(`line-${String(++k).padStart(2, '0')}`, `Over the game: ${o.line}`);
    } else if (k < 60 && Date.now() % 1500 < 400) await shots.shot('playing-on', 'Still playing while the AI works');
    if (o.choices.length) note(`the AI asked, with ${o.choices.join(' / ')} (not answered by this script)`);
    reload = o.reload;
    if (!reload) await sleep(400);
  }
  const notReloaded = await page.eval(`${FR}.contentWindow.__playMark === 1`);
  note(`game reloaded by itself while playing: ${notReloaded ? 'no (as it should)' : 'YES'}`);
  const reqs = readdirSync(join(folder, '.studio/requests/done')).filter((n) => n.includes('-play-')).concat(readdirSync(join(folder, '.studio/requests')).filter((n) => n.includes('-play-')));
  const reqFile = [join(folder, '.studio/requests/done', reqs[0] || ''), join(folder, '.studio/requests', reqs[0] || '')].find((f) => reqs[0] && existsSync(f));
  if (reqFile) {
    const rec = JSON.parse(readFileSync(reqFile, 'utf8'));
    writeFileSync(join(OUT, 'request.json'), JSON.stringify(rec, null, 2) + '\n');
    if (rec.shot && existsSync(join(folder, rec.shot))) cpSync(join(folder, rec.shot), join(OUT, 'what-the-ai-got.jpg'));
  }
  let fixed = null;
  if (reload) {
    await sleep(1500);
    await shots.shot('fixed', 'Done: the AI\'s reply and Reload, the game still running');
    await page.click(640, 400);
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: '`', code: 'Backquote', windowsVirtualKeyCode: 192, text: '`' });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: '`', code: 'Backquote', windowsVirtualKeyCode: 192 });
    await sleep(400);
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    note('` then Enter: reload');
    await page.waitFor(`${FR}.contentWindow.__playMark !== 1 && !!${FR}.contentWindow.__player`, 60000);
    await sleep(2000);
    await shots.shot('reloaded', 'Reloaded, still in Play');
    await page.click(640, 400);
    await walkTo(bug.x, bug.z);
    await sleep(3000);
    fixed = await visible();
    note(`walked to the same place and stopped: the character is ${fixed ? 'still there (fixed)' : 'GONE again'}`);
    await shots.shot('after-fix', fixed ? 'Same place after Reload: the character stays' : 'Same place after Reload: still gone');
  } else note('no Reload before the time ran out');
  await sleep(1500);
  const v = await video.stop(join(OUT, 'play-ask.mp4'));
  note(v.error ? `video: ${v.error}` : `video ${v.seconds}s, ${(v.bytes / 1e6).toFixed(1)} MB`);
  await page.close();
  await browser.close();
  await B.st.waitIdle(60000, 3000);
  await B.stop();
  spawnSync(process.execPath, [CLI, folder, '--stop'], { env });
  // The game only: .studio/ holds the editor's log, whose link carries the pass (request.json and the picture are kept above).
  cpSync(folder, join(OUT, 'game'), { recursive: true, filter: (p) => !p.includes('/.studio') });
  const diff = spawnSync('diff', ['-ru', join(OUT, 'game-before'), join(OUT, 'game'), '-x', '.studio'], { encoding: 'utf8' }).stdout;
  writeFileSync(join(OUT, 'fix.diff'), diff);
  const cost = (B.st.cost || 0) + 0;
  const lines = [
    '# Ask while playing — a real AI run', '',
    `- Model: ${MODEL} (Claude Code, this checkout's plugin, \`--permission-mode auto\`)`,
    `- Words: "${WORDS}"`, `- The bug the maker put in: \`${JSON.stringify(bug)}\``,
    `- Reload shown: ${reload ? 'yes' : 'no'} · reloaded by itself while playing: ${notReloaded ? 'no' : 'yes'} · fixed after Reload: ${fixed === null ? '—' : fixed ? 'yes' : 'no'}`,
    `- Fixer cost: $${cost.toFixed(2)}`, '',
    '## Timeline', '', ...timeline.map((e) => `- ${e.s}s — ${e.what}`), '',
    '## Pictures', '', ...shots.taken.filter((s) => s.file).map((s) => `- \`shots/${s.file}\` — ${s.caption}`), '',
    '## The fix (diff)', '', '```diff', diff.slice(0, 6000), '```', '',
    '## What the fixing AI did', '', ...(transcripts.fixer || []).map((e) => `- ${e.s}s **${e.who}**: ${String(e.text).replace(/\s+/g, ' ').slice(0, 400)}`), '',
  ];
  writeFileSync(join(OUT, 'report.md'), scrub(lines.join('\n')));
  writeFileSync(join(OUT, 'transcripts.json'), scrub(JSON.stringify(transcripts, null, 1)));
  note(`report ${join(OUT, 'report.md')}`);
  rmSync(work, { recursive: true, force: true });
}

main().then(() => process.exit(0), (e) => {
  console.error(e);
  try {
    spawnSync(process.execPath, [CLI, folder, '--stop'], { env });
    writeFileSync(join(OUT, 'timeline.json'), scrub(JSON.stringify({ timeline, transcripts, error: String(e && e.stack) }, null, 1)));
  } catch {
    /* best effort */
  }
  process.exit(1);
});
