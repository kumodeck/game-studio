// Pictures of the two moments the hands-on test of 2026-10-19 got stuck on, for one build of the editor:
//   away    a request sent while nothing could reach the AI (before: "Your AI isn't watching… type look in Claude Code
//           or Codex, or run /arrange"; after: one calm line and "Call your AI")
//   asking  the AI asked something about a pillar (before: "answer it in Claude Code"; after: its answers as buttons,
//           now → after, the pillar lit, the ask field answers)
// at the three sizes people use: PC 1280×800, the Claude app's side window 400×900, a phone 390×844.
//
//   node test/fb-ai-shots.browser.mjs --game <folder> --out <dir> [--pkg <another checkout's oss/game-studio>] [--tag after] [--lang ja]
//
// --pkg: the build to photograph (default: this one), so "before" can be shot from an older checkout with the same
// steps. The game folder is copied; nothing in it is changed.
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launch, newPage } from './adapters-2d/cdp.mjs';

const HERE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const take = (flag, d = null) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : d;
};
const PKG = resolve(take('--pkg', HERE));
const GAME = resolve(take('--game'));
const OUT = resolve(take('--out'));
const TAG = take('--tag', 'after');
const LANG = take('--lang', 'ja');
mkdirSync(OUT, { recursive: true });
const { startStudioServer } = await import(pathToFileURL(join(PKG, 'src/server/server.mjs')).href);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DBG = `document.querySelector('iframe').contentWindow.__gameStudio._debug`;
const j = async (page, expr) => JSON.parse((await page.eval(expr)) || 'null');
const SIZES = [
  { id: 'pc', width: 1280, height: 800 },
  { id: 'side', width: 400, height: 900 },
  { id: 'phone', width: 390, height: 844, mobile: true },
];
const Q = LANG === 'ja'
  ? { ask: 'この柱を少し左に', q: 'この柱はゲームが毎フレーム動かしています。置いた場所を残しますか？', choices: ['元に戻す', 'このまま反映'], before: '毎フレーム手前に流れる', after: '置いた場所に止まる' }
  : { ask: 'Move this pillar a little left', q: 'The game moves this pillar every frame. Keep the spot you gave it?', choices: ['Undo it', 'Keep it'], before: 'Flows toward you every frame', after: 'Stays where you put it' };

async function shoot(size) {
  const root = mkdtempSync(join(tmpdir(), 'studio-fb-ai-'));
  cpSync(GAME, root, { recursive: true, filter: (p) => !p.includes('/.studio/') && !p.endsWith('/.studio') });
  mkdirSync(join(root, '.studio/ui'), { recursive: true });
  writeFileSync(join(root, '.studio/ui/prefs.json'), JSON.stringify({ version: 1, lang: LANG }));
  const srv = await startStudioServer({ root, uiDir: join(PKG, 'skills/arrange/bin/studio-ui'), log: () => {} });
  const browser = await launch();
  try {
    const page = await newPage(browser, size);
    await page.goto(srv.url);
    await page.waitFor(`(document.querySelector('iframe')?.contentWindow?.__gameStudio?._debug?.list() || []).length > 0`, 90000);
    await sleep(1500);
    // One of the unnamed pillars (a Group with no name: a path: key), picked from the list like a person would.
    // The pillars are the unnamed Groups; the one nearest the game camera (z closest to it) so it is in the picture.
    const key = await j(page, `JSON.stringify((() => { const d = ${DBG}; const gs = d.list().filter((i) => i.key.startsWith('path:') && i.kinds.some((k) => /group/i.test(k)));
      const z = (i) => { const p = d.pose ? d.pose(i.key) : null; return p ? Math.abs((p.p[2] ?? 0) + 4) : 0; };
      return (gs.sort((a, b) => z(a) - z(b))[0] || d.list()[1]).key; })())`);
    assert.ok(key, 'a pillar');
    await page.eval(`(() => { document.querySelector('iframe').contentWindow.postMessage({ type: 'studio:placement/select', key: ${JSON.stringify(key)}, focus: false }, '*'); return true; })()`);
    await sleep(800);
    await page.eval(`(() => { const i = document.querySelector('.ask-input'); i.focus(); return true; })()`);
    await page.send('Input.insertText', { text: Q.ask });
    const down = { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' };
    await page.send('Input.dispatchKeyEvent', down);
    await page.send('Input.dispatchKeyEvent', { ...down, type: 'keyUp', text: undefined });
    await page.waitFor(`!document.querySelector('.ai-line').hidden`, 4000);
    await sleep(1200);
    writeFileSync(join(OUT, `${TAG}-${size.id}-away.png`), await page.screenshot());
    const line = await page.eval(`document.querySelector('.ai-line').textContent`);
    // The AI asks about it (what `--status asking --choice … --about …` writes; an older build ignores the extras).
    writeFileSync(join(root, '.studio/status.json'), JSON.stringify({ version: 1, state: 'asking', note: Q.q, choices: Q.choices, about: [key],
      before: Q.before, after: Q.after, at: new Date().toISOString() }) + '\n');
    await page.waitFor(`document.querySelector('.ai-line').classList.contains('asking')`, 5000);
    // Nothing picked (as after a click on empty ground), so the lit pillar is the AI's mark, not the selection.
    await page.eval(`(() => { document.querySelector('iframe').contentWindow.postMessage({ type: 'studio:placement/select', key: null }, '*'); return true; })()`);
    await sleep(1200);
    writeFileSync(join(OUT, `${TAG}-${size.id}-asking.png`), await page.screenshot());
    const asking = await page.eval(`document.querySelector('.ai-line').textContent`);
    console.log(`  ✓ ${TAG} ${size.id}: away "${line}" · asking "${asking}"`);
  } finally {
    await browser.close();
    await srv.close();
    rmSync(root, { recursive: true, force: true });
  }
}

for (const s of SIZES) await shoot(s);
