// The Motion button in the object's tool strip (studio-motion-tool, 2026-10-22; a review of the strip under a
// picked object: "wouldn't a motion button go well here?"), in a headless browser — every size (PC 1280×800, the side
// window 400×900, a phone 390×844 with touch) × light and dark, the checks in every one:
//   1. 3D (Lantern Cove), the crate picked (no motion): the strip has the Motion button after the four tools and a
//      hairline — the tools' own size, no dot — and its tooltip says what it does;
//   2. a press on it (the mouse; a finger on the phone): the editor's small menu at the button — "New motion" with
//      Back and forth / Round / Once / Spin, then "From the Library" with its motions; the button looks pressed and the
//      menu does not cover it;
//   3. "Back and forth": the crate has it, the timeline opens on it with "✓ … attached · When does it move?" and
//      Starts focused (as a drop from the Library, v0.1.19); the button wears its dot;
//   4. the timeline folded, the button again: no menu — the timeline opens on the crate's motion;
//   5. the lighthouse (no motion) → the button → "Hop" from the Library: on the lighthouse, "“Hop” attached";
//   6. the keys (not on the phone): A with the editor page focused, 5 with the game focused — the same menu; Esc closes;
//   7. 2D (Firefly Ruins): the strip has its tools and no Motion button (motion is 3D only today) and no stray hairline;
//   8. no page errors.
// Pictures (`--shots <dir>`): after-<size>-<theme>-<1-strip|2-menu|3-made|4-dot|5-2d>.png. `--before --ui <dir>` (the
// v0.1.19 build): before-<size>-<theme>-1-strip.png only (the crate picked, the strip as it was).
//
//   node test/studio-motion-tool.browser.mjs [--shots <dir>] [--before] [--ui <dir>] [--only pc,side,phone] [--themes light,dark] [--lang en|ja] [--no-2d]
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
const ONLY = take('--only', 'pc,side,phone').split(',');
const THEMES = take('--themes', 'light,dark').split(',');
const BEFORE = args.includes('--before');
const TWO_D = !args.includes('--no-2d') && !BEFORE;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SIZES = [
  { id: 'pc', width: 1280, height: 800 },
  { id: 'side', width: 400, height: 900 },
  { id: 'phone', width: 390, height: 844, mobile: true },
].filter((s) => ONLY.includes(s.id));

let failed = 0;
const check = (ok, what) => {
  console.log(`  ${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failed++;
};

const DBG = `document.querySelector('iframe.game, iframe').contentWindow.__gameStudio?._debug`;
const ROOT = `document.querySelector('iframe.game, iframe').contentDocument.querySelector('[data-studio-ui]').shadowRoot`;
const TL = `window.__studioTimeline`;
const WORDS = LANG === 'ja'
  ? { tip: /動き — 作る・付ける/, has: /動き: 行ったり来たり — タイムラインで開く/, made: '行ったり来たり', heads: ['新しい動き', 'ライブラリから'], attached: /“Hop”/ }
  : { tip: /Motion — make one or attach one/, has: /Motion: Back and forth — open on the timeline/, made: 'Back and forth', heads: ['New motion', 'From the Library'], attached: /“Hop” attached/ };

// The Library has three motions; the crate and the lighthouse have none (the case from the review: a thing with no motion yet).
const FILE = { version: 1, tool: 'placement', dim: '3d', space: 'local', objects: {},
  motions: [
    { name: 'Row', len: 3, repeat: 'pingpong', keys: { p: [{ t: 0, v: [0, 0, 0] }, { t: 1.5, v: [-2.5, 1.2, -1.5] }, { t: 3, v: [-5, 0, 0] }] } },
    { name: 'Bob', len: 2, repeat: 'pingpong', keys: { p: [{ t: 0, v: [0, 0, 0] }, { t: 2, v: [0, 0.4, 0] }] } },
    { name: 'Hop', len: 0.8, keys: { p: [{ t: 0, v: [0, 0, 0] }, { t: 0.4, v: [0, 1.4, 0] }, { t: 0.8, v: [0, 0, 0] }] } },
  ],
  motion: { rowboat: { clips: [{ use: 'Row', when: { on: 'start' } }] } } };

async function open(game, size, theme, file) {
  const root = mkdtempSync(join(tmpdir(), `studio-motion-tool-${game}-`));
  cpSync(join(PKG, 'starters', game), root, { recursive: true });
  mkdirSync(join(root, '.studio/ui'), { recursive: true });
  writeFileSync(join(root, '.studio/ui/prefs.json'), JSON.stringify({ version: 1, lang: LANG, theme }));
  if (file) writeFileSync(join(root, 'placement.json'), JSON.stringify(file, null, 2));
  const srv = await startStudioServer({ root, uiDir: UI, log: () => {}, env: {} });
  const browser = await launch();
  const page = await newPage(browser, { width: size.width, height: size.height, mobile: !!size.mobile, cdnCache: process.env.STUDIO_CDN_CACHE });
  await page.goto(srv.url);
  await page.waitFor(`document.querySelectorAll('.obj').length > 0 && !!${DBG}`, 90000);
  await sleep(2500);
  return { page, close: async () => (await browser.close(), await srv.close?.()) };
}

function helpers(page, size, theme) {
  const j = async (expr) => JSON.parse((await page.eval(expr)) || 'null');
  const shot = async (what) => SHOTS && writeFileSync(join(SHOTS, `${BEFORE ? 'before' : 'after'}-${size.id}-${theme}-${what}.png`), await page.screenshot());
  /** An element in the strip's shadow root, in the editor page's px, or null when hidden. */
  const inStrip = (sel) => j(`(() => { const o = document.querySelector('iframe.game, iframe').getBoundingClientRect();
    const b = ${ROOT}.querySelector(${JSON.stringify(sel)});
    if (!b || b.hidden || !b.getBoundingClientRect().width) return null; const r = b.getBoundingClientRect();
    return JSON.stringify({ x: o.left + r.left + r.width / 2, y: o.top + r.top + r.height / 2, l: o.left + r.left, t: o.top + r.top, w: r.width, h: r.height,
      cls: b.className, title: b.title || '', expanded: b.getAttribute('aria-expanded') }); })()`);
  const select = async (k) => {
    await page.eval(`studioShell.actions.select(${JSON.stringify(k)})`);
    await sleep(1100);
  };
  const tap = async (pt) => {
    if (size.mobile) await page.tap(pt.x, pt.y);
    else await page.click(pt.x, pt.y);
    await sleep(700);
  };
  /** The editor's menu now: its place and rows ("# head", "—", label). */
  const menu = () => j(`(() => { const m = document.querySelector('[data-part=context-menu]'); if (!m || m.hidden) return null; const r = m.getBoundingClientRect();
    return JSON.stringify({ place: m.dataset.place, l: r.left, t: r.top, w: r.width, h: r.height,
      rows: [...m.children].map((c) => c.classList.contains('ctx-head') ? '# ' + c.textContent : c.classList.contains('ctx-sep') ? '—' : c.querySelector('.ctx-label')?.textContent) }); })()`);
  const row = (action) => j(`(() => { const b = document.querySelector('[data-part=context-menu] [data-action=${JSON.stringify(action)}]'); if (!b) return null; const r = b.getBoundingClientRect();
    return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }); })()`);
  const state = () => j(`JSON.stringify(${TL}.state())`);
  const after = () => j(`(() => { const a = document.querySelector('[data-part=tl-attached]'); const s = document.querySelector('[data-part=tl-starts]');
    return JSON.stringify({ text: a ? a.textContent : null, focused: !!s && document.activeElement === s }); })()`);
  const key = async (where, k, code) => {
    if (where === 'game') await page.eval(`document.querySelector('iframe.game, iframe').contentWindow.focus()`);
    else await page.eval(`(document.activeElement?.blur?.(), document.querySelector('iframe.game, iframe').blur(), window.focus(), document.body.focus())`);
    await sleep(120);
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, text: k.length === 1 ? k : undefined, windowsVirtualKeyCode: k.length === 1 ? k.toUpperCase().charCodeAt(0) : 27 });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: k.length === 1 ? k.toUpperCase().charCodeAt(0) : 27 });
    await sleep(700);
  };
  return { j, shot, inStrip, select, tap, menu, row, state, after, key };
}

async function run3d(size, theme) {
  console.log(`3D ${size.id} ${theme}${BEFORE ? ' (before)' : ''}`);
  const { page, close } = await open('lantern-cove', size, theme, FILE);
  const tag = `${size.id} ${theme}`;
  try {
    const h = helpers(page, size, theme);
    // ---- 1. the strip ----
    await h.select('crate');
    await h.shot('1-strip');
    if (BEFORE) return;
    const btn = await h.inStrip('[data-studio-motion]');
    const move = await h.inStrip('[data-studio-handle=move]');
    const sizeBtn = await h.inStrip('[data-studio-handle=scale]');
    const rowBox = await h.inStrip('.row');
    const sep = await h.inStrip('.tsep');
    check(!!btn && !!move && Math.abs(btn.w - move.w) < 0.5 && Math.abs(btn.h - move.h) < 0.5 && Math.abs(btn.t - move.t) < 0.5,
      `${tag}: the Motion button is in the strip, the tools' own size (${btn?.w}×${btn?.h} / ${move?.w}×${move?.h})`);
    check(!!btn && !!sizeBtn && !!sep && sep.l > sizeBtn.l + sizeBtn.w - 0.5 && btn.l > sep.l, `${tag}: after the four tools and a hairline`);
    check(!!rowBox && !!btn && btn.l + btn.w <= rowBox.l + rowBox.w + 0.5 && rowBox.l >= -0.5 && rowBox.l + rowBox.w <= size.width + 0.5, `${tag}: inside the strip, the strip inside the window`);
    if (size.mobile) check(!!btn && btn.w >= 44, `${tag}: a finger's size (${btn?.w})`);
    check(!!btn && !/\bhas\b/.test(btn.cls) && WORDS.tip.test(btn.title), `${tag}: no dot yet; its words: "${btn?.title}"`);
    // ---- 2. press → the menu ----
    await h.tap(btn);
    const m = await h.menu();
    const pressed = await h.inStrip('[data-studio-motion]');
    check(m?.place === 'motion', `${tag}: a press opens the small menu (${m?.place})`);
    const rows = m?.rows ?? [];
    check(rows[0] === `# ${WORDS.heads[0]}` && rows.length >= 8 && rows.includes(`# ${WORDS.heads[1]}`) && rows.includes('Hop') && rows.includes('Bob'),
      `${tag}: New motion (four kinds), then From the Library (${rows.join(' | ')})`);
    check(/\bon\b/.test(pressed?.cls || '') && pressed?.expanded === 'true', `${tag}: the button looks pressed while it is open`);
    const covers = m && btn && m.l < btn.l + btn.w && m.l + m.w > btn.l && m.t < btn.t + btn.h && m.t + m.h > btn.t;
    check(!!m && !covers && m.l >= 0 && m.l + m.w <= size.width + 0.5 && m.t >= 0 && m.t + m.h <= size.height + 0.5, `${tag}: the menu is in the window, not over the button`);
    await h.shot('2-menu');
    // ---- 3. Back and forth ----
    const pp = await h.row('ctx-motion-new-pingpong');
    if (pp) await h.tap(pp);
    await sleep(500);
    let st = await h.state();
    const a = await h.after();
    check(!!st?.open && st.clip === WORDS.made, `${tag}: Back and forth is on the crate, the timeline open on it (${st?.clip})`);
    check(!!a.text && a.focused, `${tag}: "attached · When does it move?" with Starts focused (${JSON.stringify(a)})`);
    // Read off the element (PC: the timeline at the foot of the game covers the crate, so the strip under it is hidden
    // until the plate folds — the editor's rule for anything under a panel; the 4-dot picture shows it folded).
    const dot = await h.j(`(() => { const b = ${ROOT}.querySelector('[data-studio-motion]'); return JSON.stringify({ cls: b.className, title: b.title }); })()`);
    check(/\bhas\b/.test(dot?.cls || '') && WORDS.has.test(dot?.title || '') && !(await h.menu()), `${tag}: the button wears the dot; its words name the motion ("${dot?.title}")`);
    await h.shot('3-made');
    // ---- 4. folded, the button again: the timeline (no menu) ----
    await page.eval(`${TL}.setOpen(false)`);
    await sleep(400);
    await h.shot('4-dot');
    const b2 = await h.inStrip('[data-studio-motion]');
    if (b2) await h.tap(b2);
    st = await h.state();
    check(!(await h.menu()) && !!st?.open && st.clip === WORDS.made, `${tag}: with a motion, a press opens the timeline on it (open ${st?.open}, ${st?.clip})`);
    await page.eval(`${TL}.setOpen(false)`);
    await sleep(400);
    // ---- 5. from the Library ----
    await h.select('lighthouse');
    const b3 = await h.inStrip('[data-studio-motion]');
    if (b3) await h.tap(b3);
    const hop = await h.row('ctx-motion-lib-Hop');
    if (hop) await h.tap(hop);
    await sleep(500);
    const on = await h.j(`JSON.stringify(${TL}.usage('Hop').map((u) => u.key))`);
    const a2 = await h.after();
    check(on.includes('lighthouse') && WORDS.attached.test(a2.text || ''), `${tag}: Hop from the Library is on the lighthouse, "${a2.text}"`);
    await page.eval(`${TL}.setOpen(false)`);
    await sleep(400);
    // ---- 6. the keys (a keyboard: not the phone) ----
    if (!size.mobile) {
      await h.select('sailboat');
      await h.key('shell', 'a', 'KeyA');
      const k1 = await h.menu();
      await h.key('shell', 'Escape', 'Escape');
      const gone = !(await h.menu());
      await h.key('game', '5', 'Digit5');
      const k2 = await h.menu();
      await h.key('shell', 'Escape', 'Escape');
      check(k1?.place === 'motion' && gone && k2?.place === 'motion', `${tag}: A (editor page) and 5 (game) open it, Esc closes (${k1?.place}, ${k2?.place})`);
    }
    const errors = page.logs.filter((l) => /^exception|error:/.test(l) && !/favicon|net::/.test(l));
    check(!errors.length, `${tag}: no page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
  } finally {
    await close();
  }
}

async function run2d(size, theme) {
  console.log(`2D ${size.id} ${theme}`);
  const { page, close } = await open('firefly-ruins', size, theme, null);
  const tag = `2D ${size.id} ${theme}`;
  try {
    const h = helpers(page, size, theme);
    const items = await h.j(`JSON.stringify(${DBG}.list())`);
    const one = items.find((i) => i.rotatable && i.scalable)?.key;
    await h.select(one);
    const btn = await h.inStrip('[data-studio-motion]');
    const sep = await h.inStrip('.tsep');
    const rowBox = await h.inStrip('.row');
    const tools = await h.j(`JSON.stringify([...${ROOT}.querySelectorAll('[data-studio-handle]')].filter((b) => !b.hidden).map((b) => b.dataset.studioHandle))`);
    // The strip and its last tool read in one go (two reads could straddle a frame where the strip moved).
    const gap = await h.j(`(() => { const r = ${ROOT}.querySelector('.row').getBoundingClientRect(); const bs = [...${ROOT}.querySelectorAll('[data-studio-handle]')].filter((b) => !b.hidden);
      const l = bs.at(-1).getBoundingClientRect(); return JSON.stringify(r.right - l.right); })()`);
    check(!!rowBox && tools.length >= 2 && !btn && !sep, `${tag}: the tools (${tools.join(', ')}), no Motion button and no hairline (motion is 3D only)`);
    // The strip ends right after its last tool (4 px in on the mouse strip, 2 on the finger one): no room kept for the button.
    check(typeof gap === 'number' && gap <= 4.5, `${tag}: the strip is no wider than its tools (${gap} px after the last)`);
    await h.shot('5-2d');
    const errors = page.logs.filter((l) => /^exception|error:/.test(l) && !/favicon|net::/.test(l));
    check(!errors.length, `${tag}: no page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
  } finally {
    await close();
  }
}

for (const size of SIZES) for (const theme of THEMES) await run3d(size, theme);
if (TWO_D) for (const size of SIZES) for (const theme of THEMES) await run2d(size, theme);
console.log(failed ? `${failed} check(s) failed` : 'ok');
process.exit(failed ? 1 : 0);
