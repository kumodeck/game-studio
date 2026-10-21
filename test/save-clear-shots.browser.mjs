// Pictures (and a few checks) for the two asks of a try of v0.1.8 (2026-10-21): ① "More in Claude" on the AI line,
// ② Save that says where the change goes. One run per build of the editor, same steps:
//   1-ai      the AI's change is in: "Added 3 crates in a row / “Add three crates in a row” · 3 things changed · More in Claude"
//   2-save    one object moved without saving: the Save ("Save to game · 1" in the game's corner until v0.1.9; since the
//             "why two Saves?" of a try of v0.1.9 (2026-10-21) the one "Save · 1" beside ▶ Play, its tooltip saying where it goes)
//   3-tip     the pointer on it (PC and the side window: a mouse is there): its tooltip, the one-sentence why
//   4-play    ▶ Play with that change not saved: the top bar's note (PC; the narrow layouts have no note there)
// at PC 1280×800, the Claude app's side window 400×900 and a phone 390×844, light and dark.
//
//   node test/save-clear-shots.browser.mjs --out <dir> [--tag after|before] [--ui <a built studio-ui folder>]
//     [--agent claude|codex|none] [--lang ja|en] [--only pc,side,phone] [--themes light,dark] [--mock b|c]
//
// --ui: the editor page photographed (default: this checkout's build), so "before" is shot from the old build with the
// same server and the same stand-in agent. --agent: the environment the editor is started in (which-ai.mjs).
// --mock b|c: the two ideas for ② that were NOT built, drawn into the page for their photos only (README.md there):
//   b  the Play note says it in full, with "Save" beside it in the top bar
//   c  a one-time hint over the Save the first time something is moved
// Exit 1 when a check fails (not with --tag before or --mock).
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
const OUT = resolve(take('--out'));
const TAG = take('--tag', 'after');
const UI = resolve(take('--ui', join(HERE, 'skills/arrange/bin/studio-ui')));
const LANG = take('--lang', 'ja');
const AGENT = take('--agent', 'claude');
const ONLY = take('--only');
const THEMES = take('--themes', 'light,dark').split(',');
const MOCK = take('--mock');
const STRICT = TAG !== 'before' && !MOCK;
mkdirSync(OUT, { recursive: true });
const ENV = AGENT === 'claude' ? { CLAUDECODE: '1' } : AGENT === 'codex' ? { CODEX_SANDBOX: 'seatbelt' } : {};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SIZES = [
  { id: 'pc', width: 1280, height: 800 },
  { id: 'side', width: 400, height: 900 },
  { id: 'phone', width: 390, height: 844, mobile: true },
];
let failed = 0;
const check = (ok, what) => {
  console.log(`  ${ok ? '✓' : STRICT ? '✗' : '·'} ${what}`);
  if (!ok && STRICT) failed++;
};

async function key(page, k) {
  const down = { type: 'keyDown', key: k, code: k, windowsVirtualKeyCode: 13, text: '\r' };
  await page.send('Input.dispatchKeyEvent', down);
  await page.send('Input.dispatchKeyEvent', { ...down, type: 'keyUp', text: undefined });
}

const FAB = `(() => { const b = document.querySelector('[data-part=save]') || document.querySelector('[data-part=save-fab]'); if (!b || b.hidden || !b.offsetParent) return null; const r = b.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2, l: r.left, r: r.right, w: r.width, text: b.textContent }); })()`;
const PLAY = `(() => { const b = [...document.querySelectorAll('[data-action=play]')].find((x) => x.offsetParent && x.getBoundingClientRect().width); if (!b) return null; const r = b.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }); })()`;
// The grey row of the AI line: one line (its height ≈ one line of text), and "More in …" whole (not cut).
const ROW = `(() => { const s = document.querySelector('.ai-line:not([hidden]) .ai-sub'); if (!s) return null; const m = s.querySelector('.ai-more'); const lh = parseFloat(getComputedStyle(s).lineHeight) || 18; return JSON.stringify({ text: s.textContent, more: m ? m.textContent : '', oneLine: s.getBoundingClientRect().height <= lh * 1.5, moreWhole: !m || m.scrollWidth <= m.clientWidth + 1, moreIn: !m || m.getBoundingClientRect().right <= s.getBoundingClientRect().right + 1 }); })()`;

async function shoot(size, theme) {
  const root = mkdtempSync(join(tmpdir(), 'studio-save-clear-'));
  cpSync(join(HERE, 'examples/three-crates'), root, { recursive: true, filter: (p) => !p.includes('/.studio/') && !p.endsWith('/.studio') && !p.endsWith('placement.json') });
  mkdirSync(join(root, '.studio/ui'), { recursive: true });
  writeFileSync(join(root, '.studio/ui/prefs.json'), JSON.stringify({ version: 1, lang: LANG }));
  const srv = await startStudioServer({ root, uiDir: UI, log: () => {}, env: ENV });
  const browser = await launch();
  const agent = startFakeAgent(root, {});
  const name = (what) => join(OUT, `${TAG}-${size.id}-${theme}-${what}.png`);
  console.log(`${TAG} ${size.id} ${theme} (agent: ${AGENT})`);
  try {
    const page = await newPage(browser, size);
    await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
    await page.goto(srv.url);
    await page.waitFor(`document.querySelectorAll('.obj').length > 0`, 90000);
    await sleep(1500);
    if (!MOCK) {
      // ① Ask the AI; its change comes in and the line says where the rest of its answer is.
      await page.eval(`(() => { const i = document.querySelector('.ask-input'); i.focus(); return true; })()`);
      await page.send('Input.insertText', { text: LANG === 'ja' ? '木箱を 3 つ並べて' : 'Add three crates in a row' });
      await key(page, 'Enter');
      await page.waitFor(`document.querySelector('.ai-line').classList.contains('done') && !document.querySelector('.ai-line').hidden && document.querySelectorAll('iframe.game').length === 1`, 30000);
      await page.eval(`(document.activeElement?.blur?.(), true)`);
      await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(size.width / 2), y: 20 });
      await sleep(700);
      writeFileSync(name('1-ai'), await page.screenshot());
      const row = JSON.parse((await page.eval(ROW)) || 'null');
      console.log(`  line: ${row?.text}`);
      const want = { claude: LANG === 'ja' ? '詳しくは Claude で' : 'More in Claude', codex: LANG === 'ja' ? '詳しくは Codex で' : 'More in Codex', none: LANG === 'ja' ? '詳しくはお使いの AI で' : 'More in your AI' }[AGENT];
      check(row?.more === want, `the line ends with "${want}"`);
      check(!!row?.oneLine, 'the grey row is one line');
      check(!!row?.moreWhole && !!row?.moreIn, '"More in …" is whole, not cut');
      // Let the finished line fade (line-fade.ts) so the next photos show the Save alone.
      await sleep(9000);
    }
    // ② One object moved, not saved.
    const k = await page.eval(`(() => { const i = studioShell.items().find((x) => x.movable !== false && !x.held); return i ? i.key : null; })()`);
    await page.eval(`studioShell.actions.select(${JSON.stringify(k)})`);
    await sleep(800);
    await page.eval(`(() => { const i = document.querySelector('[data-part=card] .fields input'); if (!i) return false; i.value = String((parseFloat(i.value) || 0) + 0.5); i.dispatchEvent(new Event('change')); return true; })()`);
    await sleep(900);
    if (MOCK === 'c') {
      // Not built: a one-time hint over the Save.
      await page.eval(`(() => { const b = document.querySelector('[data-part=save]') || document.querySelector('[data-part=save-fab]'); const r = b.getBoundingClientRect(); const d = document.createElement('div');
        d.textContent = ${JSON.stringify(LANG === 'ja' ? 'まだこのエディタの中だけ。保存すると AI がゲームに入れます' : 'Only in this editor so far. Save, and your AI puts it in the game')};
        Object.assign(d.style, { position: 'fixed', right: (innerWidth - r.right) + 'px', bottom: (innerHeight - r.top + 8) + 'px', maxWidth: '300px', padding: '8px 12px', borderRadius: '10px', font: '13px/1.4 system-ui', background: 'var(--glass-thick, #222)', color: 'var(--text, #fff)', boxShadow: 'var(--shadow)', zIndex: 50 });
        document.body.append(d); return true; })()`);
    }
    const fab = JSON.parse((await page.eval(FAB)) || 'null');
    console.log(`  save: ${fab?.text} (${Math.round(fab?.w || 0)} px wide)`);
    writeFileSync(name('2-save'), await page.screenshot());
    if (!MOCK) {
      check(!!fab && /1/.test(fab.text), 'Save with the count');
      check(!!fab && fab.text.startsWith(LANG === 'ja' ? '保存' : 'Save') && !/ゲームへ|to game/.test(fab.text), `the word is plain "Save" ("${fab?.text}")`);
      check(/AI/.test(await page.eval(`document.querySelector('[data-part=save]')?.title || ''`)), 'its tooltip says where the change goes');
      check(!!fab && fab.l >= 0 && fab.r <= size.width, 'whole on screen');
    }
    if (!size.mobile && fab && !MOCK) {
      await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(fab.x), y: Math.round(fab.y) });
      await sleep(1400);
      writeFileSync(name('3-tip'), await page.screenshot());
      await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(size.width / 2), y: 20 });
    }
    // ▶ Play without saving (the 10/21 "Play without saving" keeps the move).
    const p = JSON.parse((await page.eval(PLAY)) || 'null');
    if (p) {
      if (size.mobile) await page.tap(p.x, p.y);
      else await page.click(p.x, p.y);
      // Since 2026-10-21 (later the same day) ▶ Play with changes asks first — Save and play / Try without saving
      // (unsaved-guard.ts): take Try, as this photo was "Play without saving".
      const asked = await page.waitFor(`!!document.querySelector('[data-part=unsaved-guard][data-kind=play]:not([hidden])')`, 3000).then(() => true, () => false);
      if (asked) {
        const tr = JSON.parse(await page.eval(`(() => { const r = document.querySelector('[data-part=unsaved-guard] [data-action=guard-discard]').getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }); })()`));
        if (size.mobile) await page.tap(tr.x, tr.y);
        else await page.click(tr.x, tr.y);
      }
      await page.waitFor(`document.querySelector('.shell').dataset.playing === 'on'`, 15000).catch(() => {});
      await sleep(2500);
      if (MOCK === 'b') {
        await page.eval(`(() => { const n = document.querySelector('.brand .here-note'); if (n) { n.hidden = false; n.textContent = ${JSON.stringify(LANG === 'ja' ? '· 保存していない変更込み（ゲームのファイルにはまだ入っていません）' : '· with unsaved changes (not in the game’s files yet)')}; }
          const b = document.createElement('button'); b.textContent = ${JSON.stringify(LANG === 'ja' ? '保存' : 'Save')}; b.className = 'btn'; Object.assign(b.style, { marginLeft: '8px', height: '28px', padding: '0 12px', borderRadius: '999px', background: 'var(--solid)', color: 'var(--solid-fg)', font: '600 12px system-ui' });
          (n || document.querySelector('.brand')).after(b); return true; })()`);
      }
      writeFileSync(name('4-play'), await page.screenshot());
      // The grey note after "Playing" (this round), then the strip over the game (the second look, B), then neither: Play
      // asks first (the third look of 2026-10-21), so it is said in the window before Play.
      if (!MOCK && size.id === 'pc') check(asked, 'Play asks first (Save and play / Try without saving)');
    }
  } finally {
    await agent.stop();
    await browser.close();
    await srv.close();
    rmSync(root, { recursive: true, force: true });
  }
}

for (const size of SIZES.filter((s) => !ONLY || ONLY.split(',').includes(s.id))) {
  for (const theme of THEMES) await shoot(size, theme);
}
console.log(`save-clear-shots: ${OUT}${failed ? ` — ${failed} check(s) failed` : ''}`);
process.exit(failed ? 1 : 0);
