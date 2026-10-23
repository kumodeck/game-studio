// The tool strip and the Motion button on a game that moves most of its things by itself (studio-tool-clear,
// 2026-10-23; a try of v0.1.24 on a neon runner: "the strip lost Move", "the motion menu makes no sense at all",
// "the when list — none of it makes sense"). Headless, PC 1280×800, the themes asked for (one light + one dark pair
// is the check; the photos for the review are dark). test/neon-run is the game: orange hexagons the game slides at
// you, a ring it turns, an orb it pulses, a gate and a ship nothing moves.
//   1. hex-1 picked (the game moves its place): the strip has the same four tools in the same order as anywhere —
//      Move · Height · Turn · Size — Move dimmed (not gone), its tooltip the reason in one line;
//   2. a press on the dimmed Move: one line of why + what can be done ("Set where it starts", "Ask AI"), at the
//      strip; "Set where it starts" → Move works, the hexagon moves, the line under the strip says what that does;
//   3. the ship picked (no motion): the Motion button → two choices, "Make a motion" and "Use a saved
//      motion", no list of kinds; "Make a motion" opens the timeline on the ship at 1 s, one line saying what
//      to do next, and one drag of the ship makes the motion ("✓ … moves from 0 s to 1 s");
//   4. the gate: "Use a saved motion" → Hop; its "When" menu reads as sentences: three ways up front, the rest under
//      "More", one "Ask AI";
//   5. no page errors.
// Pictures (`--shots <dir>`): <tag>-<lang>-<theme>-<1-strip|2-why|3-menu|4-made|5-when>.png. `--before --ui <dir>
// --loader <file>`: the v0.1.24 build, pictures only (1-strip, 3-menu, 5-when), no checks.
//
//   node test/studio-tool-clear.browser.mjs [--shots <dir>] [--before --ui <dir> --loader <file>] [--themes dark,light] [--lang en|ja]
// Exit 1 on a failure.
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
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
const BEFORE = args.includes('--before');
const UI = resolve(take('--ui', join(PKG, 'skills/arrange/bin/studio-ui')));
const LOADER = resolve(take('--loader', join(PKG, 'skills/arrange/bin/studio-placement.js')));
const LANG = take('--lang', 'en');
const THEMES = take('--themes', 'dark,light').split(',');
const SIZE = { width: 1280, height: 800 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failed = 0;
const check = (ok, what) => {
  console.log(`  ${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failed++;
};

const GAME = `document.querySelector('iframe.game, iframe').contentWindow`;
const DBG = `${GAME}.__gameStudio?._debug`;
const ROOT = `document.querySelector('iframe.game, iframe').contentDocument.querySelector('[data-studio-ui]').shadowRoot`;
const TL = `window.__studioTimeline`;
const W = LANG === 'ja'
  ? { why: /ゲームが動かします/, start: 'スタート位置を決める', ask: /AI に/, make: '動きを作る', saved: /保存した動き/, next: /ドラッグ/, made: /0〜1 秒/ }
  : { why: /game moves this/i, start: 'Set where it starts', ask: /Ask AI/, make: 'Make a motion', saved: /saved motion/i, next: /^Drag /, made: /0–1 s/ };

async function open(theme) {
  const root = mkdtempSync(join(tmpdir(), 'studio-tool-clear-'));
  cpSync(join(PKG, 'test/neon-run'), root, { recursive: true });
  copyFileSync(LOADER, join(root, 'studio-placement.js'));
  mkdirSync(join(root, '.studio/ui'), { recursive: true });
  writeFileSync(join(root, '.studio/ui/prefs.json'), JSON.stringify({ version: 1, lang: LANG, theme }));
  // One saved motion in the Library, on nothing yet: "Use a saved motion" has something to list.
  writeFileSync(join(root, 'placement.json'), JSON.stringify({ version: 1, tool: 'placement', dim: '3d', space: 'local', objects: {},
    motions: [{ name: 'Hop', len: 0.8, keys: { p: [{ t: 0, v: [0, 0, 0] }, { t: 0.4, v: [0, 1.4, 0] }, { t: 0.8, v: [0, 0, 0] }] } }] }, null, 2));
  const srv = await startStudioServer({ root, uiDir: UI, log: () => {}, env: {} });
  const browser = await launch();
  const page = await newPage(browser, { width: SIZE.width, height: SIZE.height, cdnCache: process.env.STUDIO_CDN_CACHE });
  await page.goto(srv.url);
  await page.waitFor(`document.querySelectorAll('.obj').length > 0 && !!${DBG}`, 90000);
  // The editor watches the game for its first moments (observe.ts) before it knows what the game moves.
  await page.waitFor(`${DBG}.list().some((i) => i.held === 'game')`, 20000).catch(() => {});
  await sleep(1500);
  return { page, close: async () => (await browser.close(), await srv.close?.()) };
}

async function run(theme) {
  console.log(`${LANG} ${theme}${BEFORE ? ' (before)' : ''}`);
  const { page, close } = await open(theme);
  const tag = `${LANG} ${theme}`;
  const j = async (expr) => JSON.parse((await page.eval(expr)) || 'null');
  const shot = async (what) => SHOTS && writeFileSync(join(SHOTS, `${BEFORE ? 'before' : 'after'}-${LANG}-${theme}-${what}.png`), await page.screenshot());
  const inStrip = (sel) => j(`(() => { const o = document.querySelector('iframe.game, iframe').getBoundingClientRect();
    const b = ${ROOT}.querySelector(${JSON.stringify(sel)});
    if (!b || b.hidden || !b.getBoundingClientRect().width) return null; const r = b.getBoundingClientRect();
    return JSON.stringify({ x: o.left + r.left + r.width / 2, y: o.top + r.top + r.height / 2, l: o.left + r.left, t: o.top + r.top, w: r.width, h: r.height,
      cls: b.className, title: b.title || '', disabled: b.getAttribute('aria-disabled') }); })()`);
  const strip = () => j(`JSON.stringify([...${ROOT}.querySelectorAll('[data-studio-handle], [data-studio-motion]')].filter((b) => !b.hidden && b.getBoundingClientRect().width)
    .map((b) => (b.dataset.studioHandle ?? 'motion') + (b.getAttribute('aria-disabled') === 'true' ? ':off' : '')))`);
  const select = async (k) => {
    await page.eval(`studioShell.actions.select(${JSON.stringify(k)})`);
    await sleep(1100);
  };
  const click = async (pt) => {
    await page.click(pt.x, pt.y);
    await sleep(700);
  };
  const menu = () => j(`(() => { const m = document.querySelector('[data-part=context-menu]'); if (!m || m.hidden) return null; const r = m.getBoundingClientRect();
    return JSON.stringify({ place: m.dataset.place, l: r.left, t: r.top, w: r.width, h: r.height,
      rows: [...m.children].map((c) => c.classList.contains('ctx-head') ? '# ' + c.textContent : c.classList.contains('ctx-sep') ? '—' : c.classList.contains('ctx-note') ? '> ' + c.textContent : c.querySelector('.ctx-label')?.textContent) }); })()`);
  const row = (action) => j(`(() => { const b = document.querySelector('[data-part=context-menu] [data-action=${JSON.stringify(action)}]'); if (!b) return null; const r = b.getBoundingClientRect();
    return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }); })()`);
  const pose = (k) => j(`JSON.stringify(${DBG}.anchor(${JSON.stringify(k)})?.pose ?? null)`);
  try {
    // ---- 1. a hexagon the game moves ----
    const held = await j(`JSON.stringify(${DBG}.list().filter((i) => i.held).map((i) => i.key + ':' + i.held + ':' + (i.driven || []).join('+')))`);
    console.log(`  held: ${held.join(', ')}`);
    await select('hex-1');
    await shot('1-strip');
    const tools = await strip();
    console.log(`  strip: ${tools.join(' ')}`);
    if (!BEFORE) {
      check(tools.slice(0, 4).join(' ') === 'move:off lift rotate scale', `${tag}: the four tools in their order, Move dimmed (${tools.join(' ')})`);
      const mv = await inStrip('[data-studio-handle=move]');
      check(!!mv && W.why.test(mv.title), `${tag}: Move's tooltip says why ("${mv?.title}")`);
      // ---- 2. press the dimmed Move: why + what to do ----
      await click(mv);
      const m = await menu();
      console.log(`  why: ${m?.rows.join(' | ')}`);
      check(m?.place === 'tool-off' && W.why.test(m.rows.join(' ')) && m.rows.includes(W.start) && m.rows.some((r) => W.ask.test(r || '')),
        `${tag}: a press says why and offers "${W.start}" and Ask AI`);
      await shot('2-why');
      const go = await row('ctx-tool-off-start');
      const p0 = await pose('hex-1');
      if (go) await click(go);
      const mv2 = await inStrip('[data-studio-handle=move]');
      check(!!mv2 && mv2.disabled !== 'true', `${tag}: after "${W.start}" Move works (${mv2?.cls})`);
      // A drag on the hexagon itself: its start spot moves.
      const a = await j(`(() => { const o = document.querySelector('iframe.game, iframe').getBoundingClientRect(); const c = ${DBG}.anchor('hex-1')?.center; return c ? JSON.stringify({ x: o.left + c[0], y: o.top + c[1] }) : 'null'; })()`);
      if (a) await page.mouseDrag(a.x, a.y, a.x + 120, a.y, 12);
      await sleep(600);
      const p1 = await pose('hex-1');
      check(!!p0 && !!p1 && Math.abs(p1.p[0] - p0.p[0]) > 0.3, `${tag}: the hexagon's start spot moved (${p0?.p?.[0]?.toFixed?.(2)} → ${p1?.p?.[0]?.toFixed?.(2)})`);
      await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await sleep(300);
    }
    // ---- 3. the ship: the Motion button (a solid thing: a drag on its middle moves it; the gate's middle is its hole) ----
    await select('ship');
    const btn = await inStrip('[data-studio-motion]');
    if (btn) await click(btn);
    const m = await menu();
    console.log(`  motion menu: ${m?.rows.join(' | ')}`);
    await shot('3-menu');
    if (!BEFORE) {
      const rows = (m?.rows ?? []).filter((r) => r && r !== '—' && !r.startsWith('#') && !r.startsWith('>'));
      check(m?.place === 'motion' && rows.length === 2 && rows[0] === W.make && W.saved.test(rows[1]), `${tag}: two choices, make one or use a saved one (${rows.join(' | ')})`);
      const mk = await row('ctx-motion-make');
      if (mk) await click(mk);
      await sleep(400);
      const st = await j(`JSON.stringify(${TL}.state())`);
      const first = await j(`JSON.stringify(document.querySelector('[data-part=tl-first]')?.textContent ?? null)`);
      const coach = await j(`JSON.stringify(!!document.querySelector('[data-part=tl-coach]:not([hidden])'))`);
      check(!!st?.open && st.time === 1 && !st.clip && !!first && first.includes('ship') && W.next.test(first) && !coach,
        `${tag}: the timeline opens on the ship at 1 s with what to do next, nothing over it ("${first}")`);
      // The next step: drag the ship. Its first motion is made, and the line says so.
      const g = await j(`(() => { const o = document.querySelector('iframe.game, iframe').getBoundingClientRect(); const c = ${DBG}.anchor('ship')?.center; return c ? JSON.stringify({ x: o.left + c[0], y: o.top + c[1] }) : 'null'; })()`);
      if (g) await page.mouseDrag(g.x, g.y, g.x + 140, g.y, 12);
      await sleep(700);
      const made = await j(`JSON.stringify(document.querySelector('[data-part=tl-made]')?.textContent ?? null)`);
      check(!!made && W.made.test(made), `${tag}: one drag makes the motion, and the line says what it does ("${made}")`);
      await shot('4-made');
    } else {
      const pp = await row('ctx-motion-new-pingpong');
      if (pp) await click(pp);
      await sleep(500);
    }
    // ---- 4. "when": the menu's words ----
    if (!BEFORE) {
      // A motion to say "when" about: one from the Library.
      await page.eval(`${TL}.setOpen(false)`);
      await sleep(300);
      await select('gate');
      const b2 = await inStrip('[data-studio-motion]');
      if (b2) await click(b2);
      const lib = await row('ctx-motion-lib');
      if (lib) await click(lib);
      const hop = await row('ctx-motion-lib-Hop');
      if (hop) await click(hop);
      await sleep(500);
    }
    const when = await j(`(() => { const s = document.querySelector('[data-part=tl-starts]'); if (!s) return null;
      return JSON.stringify([...s.children].map((c) => c.tagName === 'OPTGROUP' ? '# ' + c.label + ': ' + [...c.children].map((o) => o.textContent).join(' / ') : c.textContent)); })()`);
    console.log(`  when: ${(when ?? []).join(' | ')}`);
    await shot('5-when');
    if (!BEFORE) {
      const flat = (when ?? []).join(' | ');
      check(!!when && !/✦|cue|合図|connects|つなぐ/i.test(flat), `${tag}: no maker's words in the "when" menu`);
      check(!!when && when.filter((x) => !x.startsWith('#')).length <= 4, `${tag}: a few ways up front, the rest behind "More"`);
    }
    const errors = page.logs.filter((l) => /^exception|error:/.test(l) && !/favicon|net::/.test(l));
    check(!errors.length, `${tag}: no page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
  } finally {
    await close();
  }
}

for (const theme of THEMES) await run(theme);
console.log(failed ? `${failed} check(s) failed` : 'ok');
process.exit(failed ? 1 : 0);
