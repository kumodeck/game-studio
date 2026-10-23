// fix-0140 (2026-10-23) in a headless browser: J1 and the seven small ones (① … ⑦) of the first-run check
// on Lantern Cove, one language a run (`--lang en|ja`), dark:
//   crumb  ① the path's last "/" has the same room on both sides as the others ("Scene / Level 1", not "Scene /Level 1");
//   card   J1 the card's Motion line is the motion's name only, not cut; ⑥ the files row's "Library" on one line;
//   line   ⑤ the boat has two triggers (a key, the player near): the timeline's line stays one row (PC), "When does it
//          move?" and "Ask {ai}" in words; ⑦ the sentence's repeat words in lower case ("moves back and forth in 2 s");
//   ai     ④ with the timeline open the AI bar is one row (PC): no presence line of its own above the field;
//   fine   ② "+ Another trigger"; Loop & End has Stops for the boat (back and forth) and none for the
//          buoy (Once); ③ the near trigger says "near" once;
//   lib    ⑥ the Library's motion detail: "2.0 s · …" and "N points" on lines of their own, no word broken.
// Sizes (`--sizes`, default all): pc 1280×800, wide 1440×900, side 420×800, phone 390×844 (touch).
// Pictures (`--shots <dir>`): <before|after>-<lang>-<size>-<step>.png. `--before --ui <dir>` (the build before this
// change): the same steps, pictures only, no checks.
//
//   node test/studio-fix-0140.browser.mjs [--lang en|ja] [--sizes pc,side] [--shots <dir>] [--before --ui <dir> | --with-before <dir>]
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
let UI = resolve(take('--ui', join(PKG, 'skills/arrange/bin/studio-ui')));
const LANG = take('--lang', 'en');
let BEFORE = args.includes('--before');
// `--with-before <dir>`: each size twice in one run — the build before this change (pictures only), then this one —
// so the before / after pair takes one turn of the shared browser queue, not two.
const WITH_BEFORE = take('--with-before') ? resolve(take('--with-before')) : null;
const AFTER_UI = UI;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ALL = { pc: { id: 'pc', width: 1280, height: 800 }, wide: { id: 'wide', width: 1440, height: 900 }, side: { id: 'side', width: 420, height: 800 },
  phone: { id: 'phone', width: 390, height: 844, mobile: true } };
const SIZES = take('--sizes', 'pc,wide,side,phone').split(',').map((s) => ALL[s]).filter(Boolean);
const W = LANG === 'ja'
  ? { orAdd: '＋ 別のきっかけ', near: '近づいたら', whenAsk: 'いつ動く？', pingpong: '行って戻る' }
  : { orAdd: '+ Another trigger', near: 'When player gets near', whenAsk: 'When does it move?', pingpong: 'back and forth' };

let failed = 0;
const check = (ok, what) => {
  console.log(`  ${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failed++;
};

// The boat: "Row" (back and forth, a path of three points) on E or the player near; the buoy: "Bob", once, at the start.
const K = (t, v) => ({ t, v });
const FILE = { version: 1, tool: 'placement', dim: '3d', space: 'local', objects: {},
  motions: [
    { name: 'Row', len: 2, repeat: 'pingpong', keys: { p: [K(0, [0, 0, 0]), K(1, [-2, 0, 1]), K(2, [-4, 0, 0])] } },
    { name: 'Bob', len: 1, repeat: 'once', keys: { p: [K(0, [0, 0, 0]), K(0.5, [0, 0.6, 0]), K(1, [0, 0, 0])] } }],
  motion: {
    rowboat: { clips: [{ use: 'Row', when: [{ on: 'key', key: 'KeyE' }, { on: 'enter', area: { p: [10, 0.5, 4], size: [4, 2, 3] }, who: 'player' }] }] },
    buoy: { clips: [{ use: 'Bob', when: { on: 'start' } }] } } };

const TL = 'window.__studioTimeline';
/** How many rows the timeline's line takes (distinct tops of its visible parts). */
const LINE_ROWS = `(() => { const h = document.querySelector('[data-part=tl-head]'); if (!h) return 0; const boxes = [...h.children].map((c) => c.getBoundingClientRect()).filter((r) => r.width && r.height).sort((a, b) => a.top - b.top);
  let rows = 0, bottom = -1e9; for (const r of boxes) { if (r.top > bottom - 4) { rows++; bottom = r.bottom; } else bottom = Math.max(bottom, r.bottom); } return rows; })()`;
/** The path's "/"s: for each, the room (px) between it and the words before and after it. */
const SEPS = `(() => { const out = []; const b = document.querySelector('.brand'); if (!b) return '[]';
  const words = (el) => { const r = document.createRange(); r.selectNodeContents(el); const rs = [...r.getClientRects()].filter((x) => x.width); return rs; };
  const all = [...b.querySelectorAll('*')].filter((e) => e.offsetWidth && !e.children.length && e.textContent.trim());
  for (let i = 0; i < all.length; i++) { const e = all[i]; if (e.textContent.trim() !== '/' ) continue;
    const s = e.getBoundingClientRect(); const prev = all[i - 1], next = all[i + 1]; if (!prev || !next) continue;
    const pr = words(prev).pop(), nr = words(next)[0]; if (!pr || !nr) continue;
    out.push({ before: prev.textContent.trim().slice(0, 12), after: next.textContent.trim().slice(0, 12), left: Math.round(s.left - pr.right), right: Math.round(nr.left - s.right), dy: Math.round((s.top + s.bottom) / 2 - (nr.top + nr.bottom) / 2) }); }
  return JSON.stringify(out); })()`;

async function run(size) {
  const tag = `${LANG} ${size.id}`;
  console.log(`${tag}${BEFORE ? ' (before)' : ''}`);
  const root = mkdtempSync(join(tmpdir(), 'studio-fix-0140-'));
  cpSync(join(PKG, 'starters/lantern-cove'), root, { recursive: true });
  mkdirSync(join(root, '.studio/ui'), { recursive: true });
  writeFileSync(join(root, '.studio/ui/prefs.json'), JSON.stringify({ version: 1, lang: LANG, theme: 'dark', seen: ['timeline-steps', 'open-line'] }));
  writeFileSync(join(root, 'placement.json'), JSON.stringify(FILE, null, 2));
  // No KUMODeck sign-in: the real ~/.kumo of the machine running this is never read.
  const srv = await startStudioServer({ root, kumo: { home: join(root, '.no-kumo-home'), env: {} }, uiDir: UI, log: () => {}, env: {} });
  const browser = await launch();
  try {
    const page = await newPage(browser, { width: size.width, height: size.height, mobile: !!size.mobile, cdnCache: process.env.STUDIO_CDN_CACHE });
    const j = async (expr) => JSON.parse((await page.eval(expr)) || 'null');
    const shot = async (what) => SHOTS && writeFileSync(join(SHOTS, `${BEFORE ? 'before' : 'after'}-${LANG}-${size.id}-${what}.png`), await page.screenshot());
    const select = async (k) => (await page.eval(`studioShell.actions.select(${JSON.stringify(k)})`), await sleep(900));
    const fine = (open) => page.eval(`(() => { const d = document.querySelector('[data-part=card] details.fine'); if (d) d.open = ${open}; return true; })()`);
    await page.goto(srv.url);
    await page.waitFor(`document.querySelectorAll('.obj').length > 0`, 90000);
    await sleep(2500);
    const errors = [];
    // ---- crumb ① ----
    const seps = await j(SEPS);
    await shot('1-crumb');
    // The side window and the phone show the level alone (no path, no "/"): nothing to measure there.
    if (!BEFORE && seps?.length) {
      const last = (seps || []).at(-1);
      check(!!last && last.right >= 3 && Math.abs(last.right - last.left) <= 3, `① the last "/" (before "${last?.after}") has room on both sides like the others (${JSON.stringify(seps)})`);
    }
    // ---- card: J1, ⑥ ----
    await select('rowboat');
    await fine(true);
    await sleep(400);
    const card = await j(`(() => { const s = document.querySelector('[data-part=card] [data-part=motion-timeline-line] .motion-line-text'); const a = document.querySelector('[data-part=card] [data-part=assets] .f-l');
      return JSON.stringify({ line: s ? { text: s.textContent, w: s.scrollWidth, cw: s.clientWidth } : null, lib: a && a.offsetWidth ? { text: a.textContent, h: Math.round(a.getBoundingClientRect().height), lh: parseFloat(getComputedStyle(a).lineHeight) || 16 } : null }); })()`);
    await shot('2-card');
    if (!BEFORE) {
      check(!!card?.line && card.line.text === 'Row' && card.line.cw + 1 >= card.line.w, `J1 the card's Motion line is the name only, not cut (${JSON.stringify(card?.line)})`);
      check(!card?.lib || card.lib.h < card.lib.lh * 1.6, `⑥ the files row's heading on one line (${JSON.stringify(card?.lib)})`);
    }
    // ---- the timeline: ⑤ ⑦ ④ ----
    await page.eval(`(() => { const b = document.querySelector('[data-part=card] [data-part=motion-timeline-line]'); if (b) b.click(); else ${TL}.setOpen(true); })()`);
    await sleep(1200);
    await fine(false);
    await sleep(600);
    const rows = await j(LINE_ROWS);
    const line = await j(`(() => { const h = document.querySelector('[data-part=tl-head]'); if (!h) return null; const vis = (s) => { const e = h.querySelector(s); return !!e && e.offsetWidth > 0 && getComputedStyle(e).display !== 'none'; };
      const r = h.querySelector('[data-part=tl-repeat-line]'); return JSON.stringify({ whenAsk: vis('.tl-when-lbl') ? h.querySelector('.tl-when-lbl').textContent : null, askWords: vis('.tl-ask-w'), more: h.querySelector('[data-part=tl-or-more]')?.textContent ?? null,
        repeat: r ? r.selectedOptions[0]?.textContent : null, narrow: !!document.querySelector('[data-part=timeline].narrow') }); })()`);
    const ai = await j(`(() => { const row = document.querySelector('.presence-row'); const bar = document.querySelector('[data-part=bar]'); const p = document.querySelector('.presence');
      return JSON.stringify({ rowShown: !!row && !row.hidden && row.offsetHeight > 0, barH: bar ? Math.round(bar.getBoundingClientRect().height) : null, dotOnly: !!p && p.classList.contains('dot-only'), inBar: !!p && !!bar && bar.contains(p) }); })()`);
    await shot('3-line');
    if (!BEFORE) {
      if (size.id === 'pc' || size.id === 'wide') {
        check(rows === 1 && !line?.narrow, `⑤ two triggers: the line is one row (${rows} rows, ${JSON.stringify(line)})`);
        check(line?.whenAsk === W.whenAsk && !!line.askWords && !!line.more, `⑤ "${W.whenAsk}", "Ask …" in words and the "+1" chip all on it (${JSON.stringify(line)})`);
        check(!!ai && !ai.rowShown, `④ the AI bar is one row while the timeline is open (${JSON.stringify(ai)})`);
      }
      check(line?.repeat === W.pingpong, `⑦ the sentence's repeat word "${line?.repeat}"`);
    }
    // ---- Fine-tune: ② ③ ----
    await page.eval(`document.querySelector('[data-part=tl-fine-btn]')?.click()`);
    await sleep(600);
    const more = async () => j(`(() => { const m = document.querySelector('[data-part=tl-fine]:not([hidden])'); if (!m) return null;
      const opts = [...m.querySelectorAll('[data-part=tl-more-or] select option:checked, [data-part=tl-starts] option:checked')].map((o) => o.textContent);
      return JSON.stringify({ orAdd: m.querySelector('[data-part=tl-or-add]')?.textContent ?? null, stops: !!m.querySelector('[data-part=tl-stops]'), picked: opts }); })()`);
    const m1 = await more();
    const nearOpt = await j(`JSON.stringify([...document.querySelectorAll('[data-part=timeline] option[value=enter]')].map((o) => o.textContent)[0] ?? null)`);
    await shot('4-fine');
    await select('buoy');
    await sleep(600);
    const m2 = await more();
    await shot('5-fine-once');
    if (!BEFORE) {
      check(m1?.orAdd === W.orAdd, `② the add button reads "${m1?.orAdd}"`);
      check(!!m1?.stops, `② Loop & End has Stops for a motion that goes on (back and forth)`);
      check(!!m2 && !m2.stops, `② …and none for a motion that plays once (${JSON.stringify(m2)})`);
      check(nearOpt === W.near, `③ the near trigger reads "${nearOpt}"`);
    }
    // ---- the Library: ⑥ ----
    await page.eval(`studioShell.actions.switchTool('library')`);
    await sleep(1400);
    await page.eval(`document.querySelector('.shelf-filters [data-shelf=motion]')?.click()`);
    await sleep(600);
    await page.eval(`document.querySelector('.gsl-tile[data-motion="Row"]')?.click()`);
    await sleep(700);
    const det = await j(`(() => { const d = document.querySelector('[data-part=motion-detail]'); if (!d) return null; const t = d.querySelector('.gsl-dtitle');
      const lines = (s) => { const r = document.createRange(); r.selectNodeContents(s); return new Set([...r.getClientRects()].filter((x) => x.width).map((x) => Math.round(x.top))).size; };
      // Each part ("2.0 s", "Back and forth", "3 points") whole on one line; the meta may break at its "·".
      return JSON.stringify([...t.querySelectorAll('.lib-motion-meta')].map((s) => { const parts = [...s.querySelectorAll('.lib-meta-part')];
        return [s.textContent, Math.max(...(parts.length ? parts : [s]).map(lines))]; })); })()`);
    await shot('6-library');
    if (!BEFORE) {
      const meta = det || [];
      check(meta.length === 2 && meta.every(([, n]) => n === 1) && /2\.0/.test(meta[0][0]) && /3/.test(meta[1][0]), `⑥ the motion's length · repeat and its points, each part unbroken, on lines of their own (${JSON.stringify(det)})`);
    }
    errors.push(...page.logs.filter((l) => /^exception|error:/.test(l) && !/favicon|net::/.test(l)));
    if (!BEFORE) check(errors.length === 0, `no page errors (${errors.join(' | ')})`);
  } finally {
    await browser.close();
    await srv.close?.();
  }
}

for (const s of SIZES) {
  if (WITH_BEFORE) {
    [UI, BEFORE] = [WITH_BEFORE, true];
    await run(s);
    [UI, BEFORE] = [AFTER_UI, false];
  }
  await run(s);
}
console.log(failed ? `\n${failed} failed` : '\nall ok');
process.exit(failed ? 1 : 0);
