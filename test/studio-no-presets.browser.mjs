// No motion presets, in a headless browser (studio-no-presets, 2026-10-23; the review on "Back and forth / Round /
// Once / Spin": "what is this? presets?" — "we don't need them"). Only the screens this change touched, PC 1280×800,
// light and dark (`--themes`), in one language (`--lang en|ja`):
//   1. 3D (Lantern Cove), the lighthouse picked (no motion), the strip's Motion button: the menu has "No motion yet",
//      "Make a motion" and "Use a saved motion" — nothing else;
//   2. "Make a motion": the timeline opens at 1 s, its one line "Drag the lighthouse to where it should move (Esc to cancel)";
//   3. the drag's end (as the bridge reports it: the drag itself is test/studio-tool-clear.browser.mjs): two keys, 0 s and
//      1 s; it plays at once; the line "✓ … keep moving it to add a second" with "Done";
//   4. a second move: a key at 2 s;
//   5. the clip menu: "+ Make a motion" and the scene, no kind; the "When" menu: "Trigger" (six) and "Ask AI to Set Up";
//   6. Esc right after "Make a motion" (the crate): nothing made, the line gone;
//   7. no page errors.
// Pictures (`--shots <dir>`): after-<lang>-<theme>-<1-menu|2-drag|3-made|4-more|5-when>.png. `--before --ui <dir>` (the
// build before this change): before-<lang>-<theme>-<1-menu|2-make>.png (the menu, and the plate after its "make").
//
//   node test/studio-no-presets.browser.mjs [--shots <dir>] [--before] [--ui <dir>] [--themes light,dark] [--lang en|ja]
// Exit 1 on a failure.
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStudioServer } from '../src/server/server.mjs';
import { launch, newPage } from './adapters-2d/cdp.mjs';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const take = (flag, d = null) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : d;
};
const SHOTS = take('--shots') ? resolve(take('--shots')) : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const UI = resolve(take('--ui', join(PKG, 'skills/arrange/bin/studio-ui')));
const LANG = take('--lang', 'en');
const THEMES = take('--themes', 'light,dark').split(',');
const BEFORE = args.includes('--before');
const SIZE = { width: 1280, height: 800 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failed = 0;
const check = (ok, what) => {
  console.log(`  ${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failed++;
};

const ROOT = `document.querySelector('iframe.game, iframe').contentDocument.querySelector('[data-studio-ui]').shadowRoot`;
const DBG = `document.querySelector('iframe.game, iframe').contentWindow.__gameStudio?._debug`;
const TL = `window.__studioTimeline`;
const WORDS = LANG === 'ja'
  ? { rows: ['> まだ動きはありません。', '動きを作る', '保存した動きを使う'], drag: /を、動いてほしい所までドラッグしてください（Esc でやめる）/, made: /^✓ 0〜1 秒の動きができました。続けて動かすと 1 秒ずつ足されます$/,
    done: '終わる', make: '＋ 動きを作る', self: 'きっかけを選ぶ', ai: 'AI に仕掛けを作ってもらう', kinds: /行ったり来たり|ぐるっと回る|1 回だけ|その場で回る|空/ }
  : { rows: ['> No motion yet.', 'Make a motion', 'Use a saved motion'], drag: /^Drag .+ to where it should move \(Esc to cancel\)$/, made: /^✓ Moves 0–1 s\. Keep moving to add a second\.$/,
    done: 'Done', make: '+ Make a motion', self: 'Trigger', ai: 'Ask AI to Set Up', kinds: /Back and forth|Round|Once|Spin|Empty/ };

// The Library has a motion (so "Use a saved motion" shows); the lighthouse and the crate have none.
const FILE = { version: 1, tool: 'placement', dim: '3d', space: 'local', objects: {},
  motions: [{ name: 'Row', len: 3, repeat: 'pingpong', keys: { p: [{ t: 0, v: [0, 0, 0] }, { t: 3, v: [-5, 0, 0] }] } }],
  motion: { rowboat: { clips: [{ use: 'Row', when: { on: 'start' } }] } } };

async function open(theme) {
  const root = mkdtempSync(join(tmpdir(), 'studio-no-presets-'));
  cpSync(join(PKG, 'starters', 'lantern-cove'), root, { recursive: true });
  mkdirSync(join(root, '.studio/ui'), { recursive: true });
  writeFileSync(join(root, '.studio/ui/prefs.json'), JSON.stringify({ version: 1, lang: LANG, theme }));
  writeFileSync(join(root, 'placement.json'), JSON.stringify(FILE, null, 2));
  const srv = await startStudioServer({ root, uiDir: UI, log: () => {}, env: {} });
  const browser = await launch();
  const page = await newPage(browser, { width: SIZE.width, height: SIZE.height, cdnCache: process.env.STUDIO_CDN_CACHE });
  await page.goto(srv.url);
  await page.waitFor(`document.querySelectorAll('.obj').length > 0 && !!${DBG}`, 90000);
  await sleep(2500);
  return { page, close: async () => (await browser.close(), await srv.close?.()) };
}

async function run(theme) {
  const tag = `${LANG} ${theme}`;
  console.log(`${tag}${BEFORE ? ' (before)' : ''}`);
  const { page, close } = await open(theme);
  try {
    const j = async (expr) => JSON.parse((await page.eval(expr)) || 'null');
    const shot = async (what) => SHOTS && writeFileSync(join(SHOTS, `${BEFORE ? 'before' : 'after'}-${LANG}-${theme}-${what}.png`), await page.screenshot());
    const select = async (k) => (await page.eval(`studioShell.actions.select(${JSON.stringify(k)})`), await sleep(1100));
    const click = async (pt) => (await page.click(pt.x, pt.y), await sleep(700));
    const strip = (sel) => j(`(() => { const o = document.querySelector('iframe.game, iframe').getBoundingClientRect(); const b = ${ROOT}.querySelector(${JSON.stringify(sel)});
      if (!b || b.hidden || !b.getBoundingClientRect().width) return null; const r = b.getBoundingClientRect(); return JSON.stringify({ x: o.left + r.left + r.width / 2, y: o.top + r.top + r.height / 2 }); })()`);
    const menu = () => j(`(() => { const m = document.querySelector('[data-part=context-menu]'); if (!m || m.hidden) return null;
      return JSON.stringify([...m.children].map((c) => c.classList.contains('ctx-head') ? '# ' + c.textContent : c.classList.contains('ctx-sep') ? '—' : c.classList.contains('ctx-note') ? '> ' + c.textContent : c.querySelector('.ctx-label')?.textContent)); })()`);
    const row = (action) => j(`(() => { const b = document.querySelector('[data-part=context-menu] [data-action=${JSON.stringify(action)}]'); if (!b) return null; const r = b.getBoundingClientRect();
      return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }); })()`);
    const text = (part) => j(`JSON.stringify(document.querySelector('[data-part=${part}]')?.textContent ?? null)`);
    const keysOf = (k) => j(`JSON.stringify((${TL}.motionOf(${JSON.stringify(k)})?.clips ?? []).map((c) => (c.keys.p ?? []).map((x) => x.t)))`);
    /** The end of a drag of `k` by dx (the editor's own message, as the bridge sends it at the drag's end). */
    const drag = (k, dx) => page.eval(`(() => { const p = ${TL}.shownPose(${JSON.stringify(k)}); ${TL}.moved(${JSON.stringify(k)}, { ...p, p: [p.p[0] + ${dx}, p.p[1], p.p[2]] }, true, p); })()`);

    // ---- 1. the strip's Motion button → the menu ----
    await select('lighthouse');
    // A busy machine (the first run, 10/23): the strip may not be up yet — wait for it, and press again once if no menu came.
    await page.waitFor(`!!${ROOT}.querySelector('[data-studio-motion]:not([hidden])')`, 15000).catch(() => {});
    const btn = await strip('[data-studio-motion]');
    if (btn) await click(btn);
    if (!(await menu()) && btn) (await sleep(1500), await click(btn));
    const rows = (await menu()) ?? [];
    await shot('1-menu');
    if (!BEFORE) check(JSON.stringify(rows) === JSON.stringify(WORDS.rows), `${tag}: the menu — make one, use a saved one, nothing else (${rows.join(' | ')})`);
    // ---- 2. "Make a motion" ----
    const mk = await row('ctx-motion-make');
    if (mk) await click(mk);
    await sleep(500);
    if (BEFORE) {
      await shot('2-make');
      return;
    }
    const st = await j(`JSON.stringify(${TL}.state())`);
    const first = await text('tl-first');
    check(!!st?.open && st.time === 1 && !st.clip && WORDS.drag.test(first || ''), `${tag}: the timeline at 1 s, one line ("${first}")`);
    await shot('2-drag');
    // ---- 3. the drag → two keys, it plays ----
    await drag('lighthouse', 2.5);
    await sleep(150);
    const playing = (await j(`JSON.stringify(${TL}.state())`))?.playing;
    const k1 = await keysOf('lighthouse');
    const made = await text('tl-made');
    const done = await text('tl-done');
    check(JSON.stringify(k1) === '[[0,1]]', `${tag}: two keys, 0 s and 1 s (${JSON.stringify(k1)})`);
    check(playing === true, `${tag}: it plays at once`);
    check(WORDS.made.test(made || '') && done === WORDS.done, `${tag}: the line says it and how to go on ("${made}" · ${done})`);
    await sleep(1400);
    await shot('3-made');
    // ---- 4. a second move → a key at 2 s ----
    await drag('lighthouse', -2.5);
    await sleep(1400);
    const k2 = await keysOf('lighthouse');
    check(JSON.stringify(k2) === '[[0,1,2]]', `${tag}: the next move adds a second (${JSON.stringify(k2)})`);
    await shot('4-more');
    // ---- 5. the menus ----
    const clipOpts = await j(`JSON.stringify([...document.querySelectorAll('[data-part=tl-clip] option')].map((o) => [o.value, o.textContent]))`);
    check(clipOpts.some(([v, t]) => v === 'new:make' && t === WORDS.make) && clipOpts.some(([v]) => v === 'new:scene')
      && !clipOpts.some(([v, t]) => /^new:(?!make$|scene$)/.test(v) || WORDS.kinds.test(t)), `${tag}: the clip menu — make one, a scene, no kind (${clipOpts.map((o) => o[1]).join(' | ')})`);
    const when = await j(`JSON.stringify([...document.querySelectorAll('[data-part=tl-starts] optgroup')].map((g) => [g.label, [...g.children].map((o) => o.textContent)]))`);
    check(when?.[0]?.[0] === WORDS.self && when[0][1].length >= 5 && when?.[1]?.[0] === WORDS.ai, `${tag}: "When" — ${JSON.stringify(when)}`);
    // A picture of the "When" menu: a native menu does not show in a screenshot, so it is drawn as a list for the shot only.
    // (the select's own groups and rows, drawn in the editor's menu style over its button; removed after the shot).
    await page.eval(`(() => { const s = document.querySelector('[data-part=tl-starts]'); const r = s.getBoundingClientRect();
      const m = document.createElement('div'); m.id = 'shot-when'; m.className = 'ctx-menu'; m.dataset.part = 'context-menu-shot';
      m.style.cssText = 'position:fixed;z-index:999;min-width:240px;left:' + Math.min(r.left, innerWidth - 280) + 'px;bottom:' + (innerHeight - r.top + 6) + 'px';
      for (const g of s.querySelectorAll('optgroup')) { const hd = document.createElement('div'); hd.className = 'ctx-head'; hd.textContent = g.label; m.append(hd);
        for (const o of g.children) { const b = document.createElement('button'); b.className = 'ctx-row'; const l = document.createElement('span'); l.className = 'ctx-label'; l.textContent = (o.selected ? '✓ ' : '') + o.textContent; b.append(l); m.append(b); } }
      document.body.append(m); })()`);
    await sleep(200);
    await shot('5-when');
    await page.eval(`document.getElementById('shot-when')?.remove()`);
    // ---- 6. Esc right after "Make a motion" ----
    await page.eval(`${TL}.setOpen(false)`);
    await sleep(300);
    await select('crate');
    await page.waitFor(`!!${ROOT}.querySelector('[data-studio-motion]:not([hidden])')`, 15000).catch(() => {});
    const b2 = await strip('[data-studio-motion]');
    if (b2) await click(b2);
    if (!(await row('ctx-motion-make')) && b2) (await sleep(1500), await click(b2));
    const mk2 = await row('ctx-motion-make');
    if (mk2) await click(mk2);
    await sleep(400);
    await page.eval(`(document.activeElement?.blur?.(), window.focus(), document.body.focus())`);
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await sleep(500);
    const after = await j(`JSON.stringify({ t: ${TL}.state().time, m: ${TL}.motionOf('crate'), line: document.querySelector('[data-part=tl-first]')?.textContent ?? null })`);
    check(after?.t === 0 && after.m === null && !WORDS.drag.test(after.line || ''), `${tag}: Esc — nothing made, the line gone (${JSON.stringify(after)})`);
    const errors = page.logs.filter((l) => /^exception|error:/.test(l) && !/favicon|net::/.test(l));
    check(!errors.length, `${tag}: no page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
  } finally {
    await close();
  }
}

for (const theme of THEMES) await run(theme);
console.log(failed ? `${failed} check(s) failed` : 'ok');
process.exit(failed ? 1 : 0);
