// Pictures of the AI's finished line for one build of the editor (2026-10-20: "this line is always there, it's in the way"):
//   done      right after the AI's change is in ("Added 3 crates in a row · 3 things changed · Undo AI change")
//   later     LATER_MS after that, the pointer away (before: still there; after: gone by itself, src/shell/line-fade.ts)
//   recalled  the line brought back — "● AI" in the top bar (PC), the ⌘K row on a phone / the side window
// at PC 1280×800, the Claude app's side window 400×900 and a phone 390×844, light and dark.
//
//   node test/ai-line-fade-shots.browser.mjs --out <dir> [--pkg <another checkout's oss/game-studio>] [--tag after] [--lang ja]
//
// --pkg: the build whose editor page is photographed (default: this one), so "before" is shot from an older checkout
// with the same steps (the server and the stand-in agent are this checkout's).
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStudioServer } from '../src/server/server.mjs';
import { launch, newPage } from './adapters-2d/cdp.mjs';
import { startFakeAgent } from './ai-feel/fake-agent.mjs';

const HERE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const take = (flag, d = null) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : d;
};
const PKG = resolve(take('--pkg', HERE));
const OUT = resolve(take('--out'));
const TAG = take('--tag', 'after');
const LANG = take('--lang', 'ja');
const ONLY = take('--only');
mkdirSync(OUT, { recursive: true });
// "A few seconds later": past the shortest stay (5 s) and the fade, short of the longest (10 s) — the reply here is short.
const LATER_MS = 7000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SIZES = [
  { id: 'pc', width: 1280, height: 800 },
  { id: 'side', width: 400, height: 900 },
  { id: 'phone', width: 390, height: 844, mobile: true },
];

async function key(page, k, modifiers = 0) {
  const code = { Enter: 13, Escape: 27, k: 75 }[k];
  const down = { type: 'keyDown', key: k, code: k.length === 1 ? `Key${k.toUpperCase()}` : k, windowsVirtualKeyCode: code, modifiers };
  if (k === 'Enter') down.text = '\r';
  await page.send('Input.dispatchKeyEvent', down);
  await page.send('Input.dispatchKeyEvent', { ...down, type: 'keyUp', text: undefined });
}

async function shoot(size, theme) {
  const root = mkdtempSync(join(tmpdir(), 'studio-line-fade-'));
  cpSync(join(HERE, 'examples/three-crates'), root, { recursive: true, filter: (p) => !p.includes('/.studio/') && !p.endsWith('/.studio') && !p.endsWith('placement.json') });
  mkdirSync(join(root, '.studio/ui'), { recursive: true });
  writeFileSync(join(root, '.studio/ui/prefs.json'), JSON.stringify({ version: 1, lang: LANG }));
  const srv = await startStudioServer({ root, uiDir: join(PKG, 'skills/arrange/bin/studio-ui'), log: () => {} });
  const browser = await launch();
  const agent = startFakeAgent(root, {});
  const name = (what) => join(OUT, `${TAG}-${size.id}-${theme}-${what}.png`);
  try {
    const page = await newPage(browser, size);
    await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
    await page.goto(srv.url);
    await page.waitFor(`document.querySelectorAll('.obj').length > 0`, 90000);
    await page.waitFor(`document.querySelector('.peer')?.dataset.state === 'live' || document.querySelector('.peer')?.dataset.state === 'idle'`, 10000);
    await sleep(1500);
    await page.eval(`(() => { const i = document.querySelector('.ask-input'); i.focus(); return true; })()`);
    await page.send('Input.insertText', { text: LANG === 'ja' ? '木箱を 3 つ並べて' : 'Add three crates in a row' });
    await key(page, 'Enter');
    await page.waitFor(`document.querySelector('.ai-line').classList.contains('done') && !document.querySelector('.ai-line').hidden && document.querySelectorAll('iframe.game').length === 1`, 30000);
    // The pointer away from the line (over the top bar's empty middle), the field let go.
    await page.eval(`(document.activeElement?.blur?.(), true)`);
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(size.width / 2), y: 20 });
    await sleep(900);
    writeFileSync(name('1-done'), await page.screenshot());
    await sleep(LATER_MS - 900);
    writeFileSync(name('2-later'), await page.screenshot());
    const gone = await page.eval(`document.querySelector('.ai-line').hidden`);
    console.log(`  ${TAG} ${size.id} ${theme}: line ${gone ? 'gone' : 'still there'} ${LATER_MS} ms after done`);
    if (gone) {
      if (size.mobile || size.width < 600) {
        await key(page, 'k', size.mobile ? 2 : 4);
        await page.waitFor(`document.querySelector('.shell').dataset.palette === 'open'`, 3000);
        // The row in view (it may be under the first ones), and a photo of the list with it.
        await page.eval(`(document.querySelector('.palette .p-row[data-row="ai-undo"]')?.scrollIntoView({ block: 'center' }), true)`);
        await sleep(300);
        writeFileSync(name('3-cmdk'), await page.screenshot());
        assert.equal(await page.eval(`(() => { const r = document.querySelector('.palette .p-row[data-row="ai-recall"]'); if (!r) return false; r.click(); return true; })()`), true, 'the ⌘K row');
      } else {
        writeFileSync(name('3-peer'), await page.screenshot());
        await page.eval(`(document.querySelector('.peer').click(), true)`);
      }
      await page.waitFor(`!document.querySelector('.ai-line').hidden`, 3000);
      await sleep(500);
      writeFileSync(name('4-recalled'), await page.screenshot());
    }
  } finally {
    await agent.stop();
    await browser.close();
    await srv.close();
    rmSync(root, { recursive: true, force: true });
  }
}

for (const size of SIZES.filter((s) => !ONLY || ONLY.split(',').includes(s.id))) {
  for (const theme of ['light', 'dark']) await shoot(size, theme);
}
console.log(`ai-line-fade-shots: ${OUT}`);
process.exit(0);
